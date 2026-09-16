const TMDB = 'https://api.themoviedb.org/3';
const OMDB = 'https://www.omdbapi.com/';
function ttlFor(path) {
  if (path.startsWith('/search/')) return 600;
  if (/^\/(trending|tv\/top_rated|movie\/(popular|upcoming|top_rated))/.test(path)) return 21600;
  if (/\/watch\/providers$/.test(path)) return 43200;
  if (/^\/tv\/\d+\/season\/\d+\/episode\/\d+/.test(path)) return 86400;
  if (/^\/tv\/\d+/.test(path)) return 10800;
  if (/^\/(movie|person)\/\d+/.test(path)) return 86400;
  return 1800;
}
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return { 'Access-Control-Allow-Origin': ok ? origin : 'null', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
function json(body, status, extra) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...(extra || {}) } });
}
function tmdbAuth(tok, u, headers) { if (tok.startsWith('eyJ')) headers.Authorization = 'Bearer ' + tok; else u.searchParams.set('api_key', tok); }
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (url.pathname === '/check') {
      const tok = (env.TMDB_TOKEN || '').trim();
      if (!tok) return json({ ok: false, problem: 'TMDB_TOKEN secret is not set - run: npx wrangler secret put TMDB_TOKEN' }, 200, cors);
      const mode = tok.startsWith('eyJ') ? 'v4 read access token' : /^[0-9a-f]{32}$/.test(tok) ? 'v3 api key' : 'unrecognised format (' + tok.length + ' chars)';
      const u = new URL(TMDB + '/configuration'); const h = { accept: 'application/json' }; tmdbAuth(tok, u, h);
      const r = await fetch(u, { headers: h }); let body = {}; try { body = await r.json(); } catch (e) {}
      return json({ ok: r.ok, credential: mode, tmdb_status: r.status, tmdb_message: body.status_message || (r.ok ? 'TMDB accepted the key' : ''), allowed_origins: env.ALLOWED_ORIGINS || '' }, 200, cors);
    }
    if (cors['Access-Control-Allow-Origin'] === 'null') return json({ error: 'origin not allowed' }, 403, cors);
    let upstream, ttl;
    if (url.pathname.startsWith('/tmdb/')) {
      if (!env.TMDB_TOKEN) return json({ error: 'TMDB_TOKEN not configured' }, 500, cors);
      const path = url.pathname.slice(5);
      const u = new URL(TMDB + path);
      url.searchParams.forEach((v, k) => { if (k !== 'api_key') u.searchParams.set(k, v); });
      const headers = { accept: 'application/json' }; tmdbAuth(env.TMDB_TOKEN.trim(), u, headers);
      upstream = new Request(u, { headers }); ttl = ttlFor(path);
    } else if (url.pathname === '/omdb') {
      if (!env.OMDB_KEY) return json({ error: 'OMDb not enabled' }, 404, cors);
      const id = url.searchParams.get('i') || '';
      if (!/^tt\d{5,10}$/.test(id)) return json({ error: 'bad id' }, 400, cors);
      upstream = new Request(OMDB + '?i=' + id + '&apikey=' + encodeURIComponent(env.OMDB_KEY)); ttl = 259200;
    } else return json({ error: 'not found' }, 404, cors);
    const cache = caches.default; const cacheKey = new Request(url.toString(), { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(upstream, { cf: { cacheTtl: ttl, cacheEverything: true } });
      const body = await up.text();
      res = new Response(body, { status: up.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl } });
      if (up.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
