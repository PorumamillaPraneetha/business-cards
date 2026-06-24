require('dotenv').config();
const express = require('express');
const path    = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Scan card with Gemini ────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set in .env' });
    }

    const ai         = new GoogleGenAI({ apiKey });
    const base64Data = image.replace(/^data:image\/[a-z+]+;base64,/, '');
    const mediaType  = mimeType || 'image/jpeg';

    const prompt = `Extract the contact information from this business card image.
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
- Split name into firstName and lastName correctly.
- If there are multiple phone numbers on the card, put the first in "phone" and the second in "phone2". Never concatenate them into one string.
- Include country dialing codes in phone numbers if shown.
- Copy the website URL exactly as printed on the card.
- Do NOT wrap the JSON in markdown fences or add any other text.`;

    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: base64Data } },
            { text: prompt },
          ],
        },
      ],
    });

    let raw = result.text.trim()
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
