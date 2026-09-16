/**
 * TVShowManiacs API proxy — Cloudflare Worker
 *
 * Hides the TMDB / OMDb keys from the browser, caches responses at the edge,
 * and only answers requests coming from the app's own origins.
 *
 * Routes:
 *   GET /tmdb/<anything>   → https://api.themoviedb.org/3/<anything>   (adds the TMDB bearer token)
 *   GET /omdb?i=tt1234567  → https://www.omdbapi.com/?i=…&apikey=…      (optional; 404 if no OMDB_KEY set)
 *   GET /health            → { ok: true }
 *
 * Secrets (set with `wrangler secret put NAME` or in the dashboard):
 *   TMDB_TOKEN  – the "API Read Access Token" (starts with eyJ…) from themoviedb.org/settings/api
 *   OMDB_KEY    – optional
 * Vars (wrangler.toml):
 *   ALLOWED_ORIGINS – comma-separated list of origins allowed to call this worker
 */

const TMDB = 'https://api.themoviedb.org/3';
const OMDB = 'https://www.omdbapi.com/';

// How long to keep each kind of TMDB answer at the edge (seconds)
function ttlFor(path) {
  if (path.startsWith('/search/')) return 60 * 10;          // searches: 10 min
  if (/^\/(trending|tv\/top_rated|movie\/(popular|upcoming|top_rated))/.test(path)) return 60 * 60 * 6; // pools: 6 h
  if (/\/watch\/providers$/.test(path)) return 60 * 60 * 12;
  if (/^\/tv\/\d+\/season\/\d+\/episode\/\d+/.test(path)) return 60 * 60 * 24;
  if (/^\/tv\/\d+\/season\/\d+/.test(path)) return 60 * 60 * 3;  // season lists change while airing
  if (/^\/tv\/\d+/.test(path)) return 60 * 60 * 3;
  if (/^\/(movie|person)\/\d+/.test(path)) return 60 * 60 * 24;
  return 60 * 30;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(extra || {}) } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, cors);

    // Browsers always send Origin for cross-site fetches; refuse anything not from the app.
    // (Requests with no Origin at all — curl, health checks — are allowed for /health only.)
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (cors['Access-Control-Allow-Origin'] === 'null') return json({ error: 'origin not allowed' }, 403, cors);

    let upstream, ttl;
    if (url.pathname.startsWith('/tmdb/')) {
      if (!env.TMDB_TOKEN) return json({ error: 'TMDB_TOKEN not configured' }, 500, cors);
      const path = url.pathname.slice('/tmdb'.length);
      const u = new URL(TMDB + path);
      url.searchParams.forEach((v, k) => { if (k !== 'api_key') u.searchParams.set(k, v); });
      upstream = new Request(u, { headers: { accept: 'application/json', Authorization: 'Bearer ' + env.TMDB_TOKEN } });
      ttl = ttlFor(path);
    } else if (url.pathname === '/omdb') {
      if (!env.OMDB_KEY) return json({ error: 'OMDb not enabled' }, 404, cors);
      const id = url.searchParams.get('i') || '';
      if (!/^tt\d{5,10}$/.test(id)) return json({ error: 'bad id' }, 400, cors);
      upstream = new Request(`${OMDB}?i=${id}&apikey=${encodeURIComponent(env.OMDB_KEY)}`);
      ttl = 60 * 60 * 24 * 3;
    } else {
      return json({ error: 'not found' }, 404, cors);
    }

    // Edge cache keyed by the public URL (never by the secret-bearing upstream URL)
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(upstream, { cf: { cacheTtl: ttl, cacheEverything: true } });
      const body = await up.text();
      res = new Response(body, { status: up.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttl}` } });
      if (up.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
