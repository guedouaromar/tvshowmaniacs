// TVShowManiacs — deployment configuration (public values only; no secrets here)
window.TVSM_CONFIG = {
  // Supabase → Project Settings → API → Project URL
  SUPABASE_URL: 'https://ypgsteruwtsutpsdtvbw.supabase.co',
  // Supabase → Project Settings → API Keys → "publishable" (or legacy "anon public") key. Safe to ship in the browser.
  SUPABASE_ANON: 'sb_publishable_9sA_7dTWAG7r28gam-DnxQ_x_7m5KrZ',
  // Your Cloudflare Worker URL (from `npx wrangler deploy`), e.g. https://tvshowmaniacs-api.<your-subdomain>.workers.dev
  API: '__WORKER_URL__',
};
