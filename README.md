# TVShowManiacs

Track the series and movies you watch, know when the next episode drops and where to stream it, and see what your friends are watching.

- `public/` — the web app (one HTML file + PWA files). Hosted on **Cloudflare Pages**.
- `worker/` — a tiny **Cloudflare Worker** that hides the TMDB/OMDb keys and caches API answers.
- `netlify.toml` — tells Netlify to serve the `public` folder.
- `supabase/schema.sql` — the **Supabase** database: accounts, lists, watched episodes, follows, friend recommendations. Row-level security keeps every user's data private unless they choose a public profile.

Everything runs on free tiers. No servers to maintain.

---

## Deploying — click-by-click (about 40 minutes the first time)

You need: a GitHub account, a Cloudflare account, a Supabase project, a TMDB API token, and a Google Cloud project for the sign-in button. All free.

### 1. Put the code on GitHub

On your Mac, in a terminal:

```bash
cd ~/Downloads/tvshowmaniacs        # wherever you unzipped this folder
git init && git add -A && git commit -m "TVShowManiacs"
git branch -M main
git remote add origin https://github.com/guedouaromar/tvshowmaniacs.git
git push -u origin main
```

(Create the empty repo first at github.com/new, name `tvshowmaniacs`. If `git push` asks for a password, use a personal access token from GitHub → Settings → Developer settings → Tokens.)

### 2. Database — Supabase

1. supabase.com → your project → **SQL Editor** → **New query**.
2. Paste the whole content of `supabase/schema.sql` → **Run**. You should see "Success". (Safe to re-run any time.)
3. **Authentication → URL Configuration**:
   - Site URL: `https://tvshowmaniacs.pages.dev` (change later if you add a domain)
   - Redirect URLs: add `https://tvshowmaniacs.pages.dev/**` and `http://localhost:8788/**`
4. **Project Settings → API**: copy the **Project URL** (`https://xxxx.supabase.co`) — you'll paste it into `public/config.js` in step 5. The publishable key is already in that file.

### 3. Google sign-in

1. console.cloud.google.com → create a project "TVShowManiacs".
2. **APIs & Services → OAuth consent screen** → External → App name `TVShowManiacs`, support email = yours, developer email = yours → Save. Under *Audience* click **Publish app** (otherwise only test users can sign in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Web application:
   - Authorised JavaScript origins: `https://tvshowmaniacs.pages.dev` and `https://xxxx.supabase.co` (your project URL)
   - Authorised redirect URIs: `https://xxxx.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret** into Supabase → **Authentication → Sign In / Providers → Google** → enable → Save.

E-mail sign-in links also work out of the box, but Supabase's free built-in mailer is limited to a few messages per hour — fine as a fallback, not as the main door.

### 4. API proxy — Cloudflare Worker

On your Mac (Node.js 18+ required; `brew install node` if missing):

```bash
cd worker
npx wrangler login                     # opens the browser once
npx wrangler deploy                    # prints your worker URL, e.g. https://tvshowmaniacs-api.omar-tv.workers.dev
# First deploy asks you to pick a workers.dev SUBDOMAIN: this is a name for your whole Cloudflare account,
# it must be unique worldwide, e.g. "omar-tvsm" or "tvshowmaniacs-omar". Short names like "y" are taken.
npx wrangler secret put TMDB_TOKEN     # paste the "API Read Access Token" (starts with eyJ…) from themoviedb.org/settings/api
npx wrangler secret put OMDB_KEY       # optional, for IMDb ratings (omdbapi.com/apikey.aspx). Press Ctrl-C to skip.
```

No terminal? Cloudflare dashboard → **Workers & Pages → Create → Worker**, paste `worker/src/index.js`, deploy, then **Settings → Variables and Secrets** → add `TMDB_TOKEN` (secret) and `ALLOWED_ORIGINS` (text, value `https://tvshowmaniacs.pages.dev`).

### 5. Configure the app

Edit `public/config.js`:

```js
SUPABASE_URL: 'https://xxxx.supabase.co',      // from step 2.4
SUPABASE_ANON: 'sb_publishable_…',              // already filled in
API: 'https://tvshowmaniacs-api.omar.workers.dev', // from step 4
```

Commit and push (`git add -A && git commit -m "config" && git push`).

### 6. Host the site — Netlify (or Cloudflare Pages)

**Netlify:** app.netlify.com → Add new site → Import an existing project → GitHub → `tvshowmaniacs`. Build command empty, **Publish directory `public`** (the repo's `netlify.toml` sets this too) → Deploy. Site name → `tvshowmaniacs` gives `https://tvshowmaniacs.netlify.app`. Every `git push` redeploys. Use that URL everywhere the steps above say `tvshowmaniacs.pages.dev`.

**Cloudflare Pages (alternative):**

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick `tvshowmaniacs`.
2. Project name: `tvshowmaniacs` (this gives you `tvshowmaniacs.pages.dev`; if the name is taken, pick another and update `ALLOWED_ORIGINS` in `worker/wrangler.toml` + the URLs in steps 2 and 3).
3. Build settings: Framework preset **None**, build command *(empty)*, build output directory **`public`** → **Save and Deploy**.

Every `git push` now redeploys the site in about 30 seconds.

### 7. Try it

Open `https://tvshowmaniacs.pages.dev`, sign in with Google, add a show. On a phone: Share → **Add to Home Screen** and it installs like an app.

If you used the earlier single-file version in the same browser, the app offers to import those shows into your account on first sign-in. Otherwise Settings → Import accepts the JSON backup.

---

## Sharing with friends

Send them the link. Their profile is public by default (they can switch to private in Settings). Your profile link is `https://tvshowmaniacs.pages.dev/#u/<username>`; anyone who opens it can follow you. The **Friends** tab shows what people you follow are watching, what they've seen, and their recent activity; the home page gets a "Friends are watching" row.

## Custom domain (optional, later)

Cloudflare Pages → Custom domains → add `tvshowmaniacs.app` (or whatever you buy). Then add the domain to `ALLOWED_ORIGINS` in `worker/wrangler.toml` (redeploy the worker), to the Supabase redirect URLs, and to the Google OAuth origins.

## Local development

```bash
cd public && python3 -m http.server 8788     # then open http://localhost:8788
```

`localhost:8788` is already in the worker's allowed origins and can be added to Supabase's redirect URLs.

## Costs and limits

Cloudflare Pages/Workers free: 100k requests/day. Supabase free: 500 MB database, 50k monthly active users (project pauses after a week without traffic — opening the app wakes it). TMDB: free for non-commercial use with attribution (already in the footer). OMDb free: 1,000 lookups/day in total.

## Data & privacy

See `public/privacy.html`. Users can export everything as JSON and delete their account (and all rows, by cascade) from Settings.
