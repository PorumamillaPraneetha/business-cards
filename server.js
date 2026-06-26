require('dotenv').config();
const express = require('express');
const path    = require('path');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Scan card with Groq ────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    const { image, mimeType, side } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not set in .env' });
    }

    const groq      = new Groq({ apiKey });
    const base64Data = image.replace(/^data:image\/[a-z+]+;base64,/, '');
    const mediaType  = mimeType || 'image/jpeg';

    const prompt = side === 'back'
      ? `This is the BACK side of a business card. Capture ALL visible text on it.
Return ONLY a valid JSON object with exactly this field (use "" if nothing useful is visible):
{
  "notes": ""
}
Rules:
- Put ALL content from the back in "notes" as clean, readable text.
- For addresses, label them clearly (e.g. "Registered Office: 1079, Sudama Nagar, Indore, MP" or "Branch Office: B-22, Azad Sonali, Mumbai, MH").
- Include services, GSTIN, benefits, company description, or any other text you see.
- Separate different items with a newline.
- Do NOT wrap the JSON in markdown fences or add any other text.`
      : `Extract the contact information from this business card image.
Return ONLY a valid JSON object with exactly these fields (use "" for any field not visible):

{
  "firstName": "",
  "lastName": "",
  "phone": "",
  "phone2": "",
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
- Split name into firstName and lastName correctly. Copy each character exactly — do not truncate or alter any name.
- Phone numbers: if you see TWO separate phone numbers, put the FIRST number ONLY in "phone" and the SECOND number ONLY in "phone2". NEVER merge or concatenate two phone numbers into one string. Each field must contain exactly one phone number or be empty.
- Include country dialing codes in phone numbers if shown.
- Copy the website URL exactly as printed on the card.
- Do NOT wrap the JSON in markdown fences or add any other text.`;

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    let raw = (response.choices[0].message.content || '').trim()
      .replace(/^```(?:json)?\r?\n?/, '')
      .replace(/\r?\n?```$/, '')
      .trim();

    let contact;
    try {
      contact = JSON.parse(raw);
    } catch {
      console.error('Gemini returned non-JSON:', raw);
      return res.status(500).json({ error: 'AI returned an unexpected response. Please try again.' });
    }

    res.json({ contact });
  } catch (err) {
    console.error('Scan error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to scan card.' });
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
