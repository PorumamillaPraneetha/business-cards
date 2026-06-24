# Business Card Scanner

Scan a business card → Claude AI extracts the contact details → save to **Google Sheets** as a database → download a `.vcf` file to add to iPhone/Android Contacts.

---

## Quick start (local)

```bash
npm install
cp .env.example .env   # then fill in your keys — see setup sections below
npm start              # http://localhost:3000
```

---

## 1. Anthropic API key

Get your key at https://console.anthropic.com and add it to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 2. Google Sheets setup (step by step)

### Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **"New Project"** → name it (e.g. `card-scanner`) → **Create**
3. Make sure the new project is selected in the top dropdown

### Step 2 — Enable the Google Sheets API

1. In the left menu: **APIs & Services → Library**
2. Search for **"Google Sheets API"**
3. Click it → **Enable**

### Step 3 — Create a Service Account

1. Left menu: **APIs & Services → Credentials**
2. Click **"+ Create Credentials" → Service Account**
3. Fill in a name (e.g. `card-scanner-bot`) → **Create and continue**
4. Skip the optional role/user steps → **Done**

### Step 4 — Generate a JSON key

1. Click the service account you just created
2. Go to the **Keys** tab
3. Click **"Add Key" → Create new key → JSON** → **Create**
4. A `.json` file downloads — keep it safe, you'll need values from it

### Step 5 — Create the Google Sheet

1. Go to https://sheets.google.com → **Blank spreadsheet**
2. Rename it (e.g. `Business Cards`)
3. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   ```

### Step 6 — Share the sheet with the service account

1. In the sheet: **Share** (top-right)
2. Paste the service account email from the JSON file — it looks like:
   ```
   your-bot@your-project.iam.gserviceaccount.com
   ```
3. Give it **Editor** access → **Send**

### Step 7 — Add values to `.env`

Open the downloaded JSON file and copy:

```
GOOGLE_SHEET_ID=paste_sheet_id_from_url

GOOGLE_SERVICE_ACCOUNT_EMAIL=paste_client_email_from_json

GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
```

> **Important:** For `GOOGLE_PRIVATE_KEY`, copy the entire `private_key` value from the JSON file — including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Make sure the whole value is wrapped in **double quotes** in `.env`. The literal `\n` characters in the key are expected and handled automatically.

The app auto-creates the header row (`Date Scanned`, `First Name`, etc.) on the first save — you don't need to set it up manually.

---

## Using on iPhone

1. Run `npm start` on your Mac.
2. Find your Mac's local IP: **System Preferences → Network** (e.g. `192.168.1.42`).
3. On iPhone Safari, go to `http://192.168.1.42:3000`.
4. Tap **Scan Card (Camera)** — opens the rear camera directly.
5. Take a photo → review/edit fields → **Save Contact**.
6. The `.vcf` file downloads. Tap it from Safari's download list (arrow icon) → iOS shows **"Add to Contacts"**.
7. Switch to **All Contacts** tab to see all saved cards.

## Using on Android

Same steps — the camera button uses `capture="environment"` which opens the rear camera on Android Chrome as well. The `.vcf` download also works: open the file from the notification/downloads → Android will prompt to import the contact.

---

## App features

| Feature | Detail |
|---|---|
| Scan | Camera or photo library |
| AI extraction | Claude Sonnet 4.6 vision — name, phone, email, company, title, address, website |
| Edit | All fields editable before saving |
| Save | Downloads `.vcf` + saves row to Google Sheets |
| All Contacts | Lists all rows from the Sheet |
| Search | Real-time filter by name, company, phone, email |
| Detail view | Slide-up sheet with all fields + tap phone/email/website |
| Export | Download all contacts as `.csv` |
| Dark mode | Automatic via system preference |

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

After deploy, go to your Vercel project:

1. **Settings → Environment Variables**
2. Add all four vars from your `.env`:
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY` — paste the full key including `-----BEGIN/END PRIVATE KEY-----`
3. **Redeploy**: `vercel --prod`

---

## Project structure

```
business-cards/
├── public/
│   └── index.html      ← two-page SPA (Scan + All Contacts)
├── server.js           ← Express: /api/scan, /api/save-contact, /api/contacts
├── package.json
├── vercel.json
├── .env                ← your secrets (gitignored)
└── .env.example        ← template
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ANTHROPIC_API_KEY is not set` | Add it to `.env` |
| `Google Sheets not configured` | All three `GOOGLE_*` vars must be set in `.env` |
| `The caller does not have permission` | Re-share the Sheet with the service account email as **Editor** |
| `Error: invalid_grant` | Check that the service account email and private key are from the same JSON file |
| Camera doesn't open on iPhone | Access the app via HTTP (not `file://`) using your Mac's LAN IP |
| `.vcf` doesn't add contact on iPhone | Tap the file from Safari's download list (↓ arrow icon in top-right of Safari) |
| Private key formatting error | Make sure `GOOGLE_PRIVATE_KEY` is wrapped in double quotes in `.env` and includes `\n` escapes |
