require('dotenv').config();
const express = require('express');
const path    = require('path');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const EMPTY_CONTACT = {
  firstName: '', lastName: '', phone: '', phone2: '', email: '',
  company: '', title: '', address: '', city: '', state: '',
  zip: '', country: '', website: '', notes: '',
};

// ── Scan card with Groq ────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    const { image, mimeType, side, emptyFields } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY is not set in .env' });

    // If back-side scan but nothing is empty, skip AI call
    if (side === 'back' && (!Array.isArray(emptyFields) || emptyFields.length === 0)) {
      return res.json({ contact: EMPTY_CONTACT });
    }

    const groq       = new Groq({ apiKey });
    const base64Data = image.replace(/^data:image\/[a-z+]+;base64,/, '');
    const mediaType  = mimeType || 'image/jpeg';
    const emptyList  = Array.isArray(emptyFields) && emptyFields.length
      ? emptyFields.join(', ')
      : '';

    const prompt = side === 'back'
      ? `This is the BACK of a business card. Look for these specific fields that were not found on the front: ${emptyList}.

Return ONLY a raw JSON object — no markdown, no explanation, just the JSON:
{"firstName":"","lastName":"","phone":"","phone2":"","email":"","company":"","title":"","address":"","city":"","state":"","zip":"","country":"","website":"","notes":""}

Fill ONLY the fields listed above (${emptyList}) if you can see them. Leave all other fields as "".
Put any extra information that does not fit into any field into "notes".`
      : `Extract contact information from this business card image.

Return ONLY a raw JSON object — no markdown, no explanation, just the JSON:
{"firstName":"","lastName":"","phone":"","phone2":"","email":"","company":"","title":"","address":"","city":"","state":"","zip":"","country":"","website":""}

Rules:
- Split name into firstName and lastName. Copy each character exactly.
- Two phone numbers: first in "phone", second in "phone2". Never merge them.
- Include country dialing codes. Copy website exactly as printed.`;

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 1024,
      messages: [
        {
          role: 'system',
          content: 'You are a data extraction assistant. You ONLY output valid JSON. Never add explanations, markdown, or any other text.',
        },
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

    // Extract the first {...} block in case model added surrounding text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) raw = jsonMatch[0];

    let contact;
    try {
      contact = JSON.parse(raw);
    } catch {
      console.error('Model returned non-JSON:', raw);
      // For back-side, return empty contact rather than failing
      if (side === 'back') return res.json({ contact: EMPTY_CONTACT });
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
