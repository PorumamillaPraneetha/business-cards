require('dotenv').config();
const express = require('express');
const path    = require('path');
const OpenAI  = require('openai');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const EMPTY_CONTACT = {
  firstName: '', lastName: '', phone: '', phone2: '', email: '',
  company: '', title: '', address: '', city: '', state: '',
  zip: '', country: '', website: '', notes: '',
};

// ── Scan card via OpenRouter (Llama 4 Scout free tier) ────────
app.post('/api/scan', async (req, res) => {
  try {
    const { image, mimeType, side, emptyFields } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    const apiKey = process.env.SAMBANOVA_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'SAMBANOVA_API_KEY is not set in environment.' });

    if (side === 'back' && (!Array.isArray(emptyFields) || emptyFields.length === 0)) {
      return res.json({ contact: EMPTY_CONTACT });
    }

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.sambanova.ai/v1',
    });

    const base64Data = image.replace(/^data:image\/[a-z+]+;base64,/, '');
    const mediaType  = mimeType || 'image/jpeg';
    const emptyList  = Array.isArray(emptyFields) && emptyFields.length
      ? emptyFields.join(', ')
      : '';

    const prompt = side === 'back'
      ? `This is the BACK of a business card. The front was already scanned.

Your job:
1. Look for these fields that are still missing: ${emptyList}. If found, fill them in.
2. Collect ALL other text on the back (services, benefits, taglines, GSTIN, social handles, descriptions — anything) into "notes" as a newline-separated list.

Return ONLY a raw JSON object — no markdown, no explanation, just the JSON:
{"firstName":"","lastName":"","phone":"","phone2":"","email":"","company":"","title":"","address":"","city":"","state":"","zip":"","country":"","website":"","notes":""}

Critical rules:
- If a field value is NOT found on the card, use exactly "" (empty string). NEVER write "not found", "not visible", "N/A", "none", or any placeholder text.
- Only fill fields from this list: ${emptyList}. Leave all other contact fields as "".
- "notes" is special: always fill it with any text on the back that doesn't belong in the above fields, even if notes is not in the empty list. Format notes like this:
  • If the back has a section heading (e.g. "Benefits", "Features", "Services"), write it as "Benefits:" on its own line, then list each item as "• item" on a new line.
  • If there is an email address in notes, write it as "Email: address@example.com"
  • If there is a phone number in notes, write it as "Phone: +91XXXXXXXXXX"
  • If there is a website in notes, write it as "Website: www.example.com"
  • Separate different sections with a blank line.`
      : `Extract contact information from this business card image.

Return ONLY a raw JSON object — no markdown, no explanation, just the JSON:
{"firstName":"","lastName":"","phone":"","phone2":"","email":"","company":"","title":"","address":"","city":"","state":"","zip":"","country":"","website":""}

Rules:
- YOU ARE A COPIER, NOT A GENERATOR. Every character you output must be physically visible on the card image. Never guess, infer, auto-complete, or hallucinate any value.
- PHONE NUMBERS: Copy each digit one at a time exactly as printed. Do not add, remove, rearrange, or guess any digit. If a number is "+91 90325 63636", output exactly "+91 90325 63636".
- NAMES ARE CRITICAL: Read every single letter before writing. Do NOT truncate. "Chelluboina" = 11 letters, write all 11. Never shorten a name.
- Split the full name into firstName (first + middle names) and lastName (family name/surname). Copy every character exactly as printed.
- EMAIL: Copy character by character. Do not guess the domain or username.
- Two phone numbers: first in "phone", second in "phone2". Never merge them.
- Include country dialing codes exactly as shown. Copy website exactly as printed.
- State and ZIP are SEPARATE fields. "AP" goes in state, "531173" goes in zip — never combined.`;

    const messages = [
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
    ];

    function parseResponse(content) {
      let raw = (content || '').trim()
        .replace(/^```(?:json)?\r?\n?/, '')
        .replace(/\r?\n?```$/, '')
        .trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) raw = jsonMatch[0];
      return JSON.parse(raw);
    }

    let contact;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await client.chat.completions.create({
          model: 'Meta-Llama-4-Scout-17B-16E-Instruct',
          max_tokens: 1024,
          temperature: 0,
          messages,
        });
        contact = parseResponse(response.choices[0].message.content);
        break;
      } catch (parseErr) {
        console.error('Attempt', attempt, 'error:', parseErr.message);
        console.error('Raw content:', response?.choices?.[0]?.message?.content);
        if (attempt === 1) {
          if (side === 'back') return res.json({ contact: EMPTY_CONTACT });
          return res.status(500).json({ error: parseErr.message || 'AI returned an unexpected response.' });
        }
      }
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
