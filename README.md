# Nimbus Finance

A personal finance dashboard: income/expense tracking, budgets, savings goals,
net worth, GCash receipt OCR, an AI financial coach, and a daily quote system.
Pure static frontend (HTML/CSS/ES modules + Chart.js + Tesseract.js) backed by
Supabase (Postgres + Auth), so it hosts for free on GitHub Pages.

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's ready, open **SQL Editor → New query**, paste the entire contents
   of `supabase/schema.sql`, and run it. This creates every table, enables
   Row Level Security, and adds a trigger that auto-creates default
   categories for each new signup.
3. If the storage bucket statements at the bottom of the SQL fail (some
   Supabase plans restrict direct SQL on `storage.objects`), instead go to
   **Storage → New bucket**, create a **private** bucket named `receipts`,
   then add three policies (owner can select/insert/delete where the first
   folder segment of the path equals `auth.uid()`).
4. Go to **Authentication → Providers** and make sure **Email** is enabled.
   Optionally enable **Google** and follow Supabase's OAuth setup guide to
   add your Google client ID/secret.
5. Go to **Authentication → URL Configuration** and add your future GitHub
   Pages URL (e.g. `https://yourname.github.io/nimbus-finance/`) to both
   **Site URL** and **Redirect URLs** — required for password reset and
   Google sign-in to redirect back correctly.
6. Go to **Project Settings → API** and copy your **Project URL** and
   **anon public** key (never the `service_role` key).

## 2. Configure the app

Open `js/config.js` and paste your values:

```js
export const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

The anon key is safe to ship in frontend code — Row Level Security (already
set up by `schema.sql`) is what actually keeps each user's data private.

## 3. Run it locally

Any static file server works, e.g.:

```bash
cd nimbus-finance
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly via `file://` will NOT work — ES modules and
the Supabase SDK require a real HTTP origin.

## 4. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Nimbus Finance"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/nimbus-finance.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch →
Branch: main / (root)**. Your app will be live at
`https://YOUR-USERNAME.github.io/nimbus-finance/` within a minute or two.

Because everything (auth, database, storage) lives in Supabase, GitHub Pages
only ever serves static files — there's no backend to deploy separately.

## 5. iPhone / mobile

Once deployed, open the GitHub Pages URL in Safari on iPhone and use
**Share → Add to Home Screen** for an app-like icon and full-screen feel.
The layout switches to a bottom tab bar + floating "+" button under 860px
width, and respects the iPhone's safe-area insets.

## Project structure

```
nimbus-finance/
├── index.html              Single-page app shell (all views + modals)
├── css/
│   └── main.css             Design system: tokens, glassmorphism, layout
├── js/
│   ├── config.js            ← put your Supabase URL/key here
│   ├── supabaseClient.js     Supabase SDK singleton
│   ├── auth.js               Sign up / in / out, forgot password, Google
│   ├── app.js                Routing, dashboard rendering, modal wiring
│   ├── transactions.js        Transaction CRUD, search/sort/filter
│   ├── budgets.js             Monthly budgets + progress calculation
│   ├── goals.js               Savings goals + completion celebration
│   ├── netWorth.js            Manual assets/liabilities, net worth
│   ├── coach.js                Rule-based AI financial coach (offline)
│   ├── quotes.js               Daily quote rotation + favorites
│   ├── charts.js               Chart.js wrappers + health-ring SVG
│   ├── ocr.js                  Tesseract.js GCash receipt parsing
│   ├── importExport.js         CSV / Excel / JSON import & export
│   ├── reports.js              Monthly/yearly/category/growth reports
│   └── utils.js                Formatting, health-score math, helpers
├── data/
│   └── quotes.json            320 original motivational finance quotes
└── supabase/
    └── schema.sql              Full Postgres schema + RLS policies
```

## What's implemented vs. what's scaffolded for later

**Fully working:** auth (email/password + password reset + optional Google),
manual transactions with all fields/filters, categories, monthly budgets
with progress bars, savings goals with contributions and a confetti
celebration on completion, manual net worth tracking, all the specified
charts, CSV/Excel/JSON import and export, GCash receipt OCR with an
editable confirmation step before saving, a rule-based financial coach card,
and the full daily-quote system with 320 original quotes, favoriting, and
special contextual quotes.

**Intentionally simplified / left as clean extension points**, since a
single response can't stand up a full production system end-to-end:
- The "AI Financial Coach" is rule-based against your own data (fast, free,
  works offline) rather than calling an external LLM. If you want actual
  LLM-generated commentary, `coach.js` is the one file to swap — call your
  model of choice with the same `{transactions, budgetsProgress, goals}`
  input and render its response into `#coach-card-body`.
- Recurring transactions have a database table and a manual "recurring"
  checkbox, but automatic month-to-month generation isn't wired up yet —
  a small scheduled function (Supabase Edge Function on a cron trigger)
  is the natural way to add that without needing a server of your own.
- PWA/offline mode, push notifications, multi-currency, and bank
  integrations are structured for (see table names and settings JSONB
  column) but not built — each is realistically its own project.
- OCR field extraction uses pattern-matching on the recognized text, which
  works well on clear GCash screenshots but will need occasional correction
  on blurry or unusual receipt formats — that's exactly why the confirmation
  step is always shown before saving.

## Security notes

- Every table has Row Level Security scoped to `auth.uid()`, so one user's
  Supabase queries can never return another user's rows, even if someone
  tampered with frontend requests.
- Only the `anon` key ships to the browser. Never paste your `service_role`
  key into any frontend file.
- All amounts are validated (`>= 0` / `> 0`) at the database level as a
  second line of defense beyond the frontend's own input validation.
