require('dotenv').config();
const express = require('express');
const path    = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Timeout wrapper — prevents Google API calls hanging forever ──
function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Google Sheets request timed out after ${ms / 1000}s. ` +
          'Verify the Sheets API is enabled and the service account has Editor access to the sheet.')),
        ms,
      )
    ),
  ]);
}

// ── Google Sheets helpers ────────────────────────────────────
const SHEET_HEADERS = [
  'Date Scanned', 'First Name', 'Last Name', 'Company',
  'Job Title', 'Phone', 'Email', 'Address', 'Website',
];

function getSheetsClient() {
  const email   = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey  = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  // Reject missing or placeholder values
  if (!email || !rawKey || !sheetId) return null;
  if (email.includes('your-service-account')) return null;
  if (sheetId.includes('your_google_sheet'))  return null;
  if (rawKey.includes('YOUR_PRIVATE_KEY_HERE')) return null;

  const privateKey = rawKey.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT(
    email,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId };
}

async function ensureHeaders(sheets, sheetId) {
  const res = await withTimeout(
    sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A1:I1' }),
  );
  const firstRow = res.data.values?.[0];
  if (!firstRow || firstRow[0] !== 'Date Scanned') {
    await withTimeout(
      sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        resource: { values: [SHEET_HEADERS] },
      }),
    );
  }
}

// ── Helpful auth diagnostics in server logs ──────────────────
function sheetsErrorHint(err) {
  const msg = err.message || '';
  if (msg.includes('unregistered callers') || msg.includes('API Key')) {
    return 'The Google Sheets API may not be enabled. Go to console.cloud.google.com → APIs & Services → Library → enable "Google Sheets API".';
  }
  if (msg.includes('PERMISSION_DENIED') || msg.includes('does not have')) {
    return 'Share the Google Sheet with your service account email as Editor.';
  }
  if (msg.includes('invalid_grant') || msg.includes('Invalid JWT')) {
    return 'Check GOOGLE_PRIVATE_KEY in .env — it may be malformed or from the wrong service account.';
  }
  return null;
}

// ── Scan card with Claude ────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });
    }

    const client     = new Anthropic({ apiKey });
    const base64Data = image.replace(/^data:image\/[a-z+]+;base64,/, '');
    const mediaType  = mimeType || 'image/jpeg';

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            {
              type: 'text',
              text: `Extract the contact information from this business card image.
Return ONLY a valid JSON object with exactly these fields (use "" for any field not visible):

{
  "firstName": "",
  "lastName": "",
  "phone": "",
  "email": "",
  "company": "",
  "title": "",
  "address": "",
  "city": "",
  "state": "",
  "zip": "",
  "country": "",
  "website": ""
}

Rules:
- Split name into firstName and lastName correctly.
- Include country dialing codes in phone numbers if shown.
- Copy the website URL exactly as printed on the card.
- Do NOT wrap the JSON in markdown fences or add any other text.`,
            },
          ],
        },
      ],
    });

    let raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\r?\n?/, '')
      .replace(/\r?\n?```$/, '')
      .trim();

    let contact;
    try {
      contact = JSON.parse(raw);
    } catch {
      console.error('Claude returned non-JSON:', raw);
      return res.status(500).json({ error: 'AI returned an unexpected response. Please try again.' });
    }

    res.json({ contact });
  } catch (err) {
    console.error('Scan error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to scan card.' });
  }
});

// ── Save contact → Google Sheets ────────────────────────────
app.post('/api/save-contact', async (req, res) => {
  const client = getSheetsClient();
  if (!client) {
    return res.status(503).json({
      sheetsError: true,
      error: 'Google Sheets not configured — set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY in .env.',
    });
  }

  try {
    const { contact } = req.body;
    const { sheets, sheetId } = client;

    await ensureHeaders(sheets, sheetId);

    const now = new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const addressLine = [
      contact.address, contact.city, contact.state, contact.zip, contact.country,
    ].filter(Boolean).join(', ');

    await withTimeout(
      sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1!A:I',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            now,
            contact.firstName || '',
            contact.lastName  || '',
            contact.company   || '',
            contact.title     || '',
            contact.phone     || '',
            contact.email     || '',
            addressLine,
            contact.website   || '',
          ]],
        },
      }),
    );

    res.json({ success: true });
  } catch (err) {
    const hint = sheetsErrorHint(err);
    if (hint) console.error('Sheets hint:', hint);
    console.error('Sheets save error:', err.message);

    // Return a user-friendly message with an actionable hint
    const userMsg = hint
      ? `${err.message} — ${hint}`
      : (err.message || 'Failed to save to Google Sheets.');
    res.status(500).json({ error: userMsg });
  }
});

// ── Fetch all contacts from Google Sheets ────────────────────
app.get('/api/contacts', async (req, res) => {
  const client = getSheetsClient();
  if (!client) {
    return res.status(503).json({
      sheetsError: true,
      error: 'Google Sheets not configured — fill in the three GOOGLE_* vars in .env.',
      contacts: [],
    });
  }

  try {
    const { sheets, sheetId } = client;

    const response = await withTimeout(
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:I' }),
    );

    const rows = response.data.values || [];
    const contacts = rows.slice(1).map((row, i) => ({
      id:          i,
      dateScanned: row[0] || '',
      firstName:   row[1] || '',
      lastName:    row[2] || '',
      company:     row[3] || '',
      title:       row[4] || '',
      phone:       row[5] || '',
      email:       row[6] || '',
      address:     row[7] || '',
      website:     row[8] || '',
    }));

    res.json({ contacts });
  } catch (err) {
    const hint = sheetsErrorHint(err);
    if (hint) console.error('Sheets hint:', hint);
    console.error('Sheets fetch error:', err.message);

    const userMsg = hint
      ? `${err.message} — ${hint}`
      : (err.message || 'Failed to fetch contacts.');
    res.status(500).json({ error: userMsg, contacts: [] });
  }
});

// Catch-all → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅  Running at http://localhost:${PORT}`));
}

module.exports = app;
