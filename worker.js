/**
 * worker.js — Cloudflare Worker proxy for Laura on Trail comments
 *
 * This worker receives comment submissions from the browser and triggers
 * the save-comment GitHub Actions workflow using a token stored as a secret.
 * The token never appears in the public repo.
 *
 * ── DEPLOYMENT (one-time setup) ──────────────────────────────────────────
 *
 * 1. Sign up at cloudflare.com (free)
 *
 * 2. Install Wrangler CLI:
 *      npm install -g wrangler
 *      wrangler login
 *
 * 3. Create the worker:
 *      wrangler deploy worker.js --name at2026-comments --compatibility-date 2024-01-01
 *
 * 4. Add your GitHub token as a secret (Actions:Write, repo at2026 only):
 *      wrangler secret put GITHUB_TOKEN
 *      (paste your PAT when prompted)
 *
 * 5. Copy the deployed URL (e.g. https://at2026-comments.yourname.workers.dev)
 *    and paste it into comments.js as WORKER_URL.
 *
 * That's it. The worker handles all comment submissions going forward.
 * ─────────────────────────────────────────────────────────────────────────
 */

const GITHUB_OWNER = 'lauvh9';
const GITHUB_REPO  = 'at2026';
const ALLOWED_ORIGINS = [
  'https://lauratheexplorer.co',
  'https://at2026-ann.pages.dev',
];

// Rate limiting — in-memory per Worker isolate (resets on cold start)
// For stronger guarantees, replace with Cloudflare KV or Rate Limiting API.
const rateLimitMap = new Map(); // ip -> [timestamps]
const RATE_LIMIT   = 5;
const RATE_WINDOW  = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(ip) {
  const now  = Date.now();
  const hits = (rateLimitMap.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  rateLimitMap.set(ip, hits);
  return true;
}

export default {
  async fetch(request, env) {
    const origin   = request.headers.get('Origin') || '';
    const pathname = new URL(request.url).pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env, origin);
    }

    if (request.method !== 'POST') {
      return corsResponse(JSON.stringify({ error: 'Not found' }), 404, env, origin);
    }

    // ── /verify-password ────────────────────────────────────────────────────
    // Checks the post password against the POST_PASSWORD Worker secret.
    // Run: wrangler secret put POST_PASSWORD
    if (pathname === '/verify-password') {
      let body;
      try { body = await request.json(); } catch {
        return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400, env, origin);
      }
      if (env.POST_PASSWORD && body.password === env.POST_PASSWORD) {
        return corsResponse(JSON.stringify({ ok: true }), 200, env, origin);
      }
      return corsResponse(JSON.stringify({ ok: false }), 401, env, origin);
    }

    // ── /subscribe ───────────────────────────────────────────────────────────
    // Saves an email address to Cloudflare KV (SUBSCRIBERS namespace).
    // Key = normalised email, so duplicates are inherently prevented.
    // Setup: wrangler kv:namespace create SUBSCRIBERS  → add ID to wrangler.toml
    if (pathname === '/subscribe') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!checkRateLimit(ip)) {
        return corsResponse(JSON.stringify({ error: 'Too many requests. Please wait a few minutes.' }), 429, env, origin);
      }

      let body;
      try { body = await request.json(); } catch {
        return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400, env, origin);
      }

      const raw = typeof body.email === 'string' ? body.email.trim() : '';
      if (!raw) {
        return corsResponse(JSON.stringify({ error: 'Email is required.' }), 400, env, origin);
      }
      const email = raw.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return corsResponse(JSON.stringify({ error: 'Please enter a valid email address.' }), 400, env, origin);
      }

      if (!env.SUBSCRIBERS) {
        return corsResponse(JSON.stringify({ error: 'Subscription service not configured.' }), 503, env, origin);
      }

      const existing = await env.SUBSCRIBERS.get(email);
      if (existing) {
        return corsResponse(JSON.stringify({ duplicate: true }), 200, env, origin);
      }

      await env.SUBSCRIBERS.put(email, JSON.stringify({
        email,
        source:        body.source || 'unknown',
        subscribed_at: new Date().toISOString(),
      }));

      return corsResponse(JSON.stringify({ ok: true }), 200, env, origin);
    }

    if (pathname !== '/comment') {
      return corsResponse(JSON.stringify({ error: 'Not found' }), 404, env, origin);
    }

    // Rate limiting
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip)) {
      return corsResponse(JSON.stringify({ error: 'Too many comments. Please wait a few minutes.' }), 429, env, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: 'Invalid JSON' }), 400, env, origin);
    }

    const { slug, name, message, timestamp } = body;

    if (!slug || !name || !message || !timestamp) {
      return corsResponse(JSON.stringify({ error: 'Missing required fields' }), 400, env, origin);
    }

    // Guard against path traversal
    if (!/^[\w\-]+$/.test(slug)) {
      return corsResponse(JSON.stringify({ error: 'Invalid slug' }), 400, env, origin);
    }

    if (name.length > 80 || message.length > 2000) {
      return corsResponse(JSON.stringify({ error: 'Input too long' }), 400, env, origin);
    }

    // Write comment directly to GitHub Contents API
    const path   = `data/comments/${slug}.json`;
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
    const ghHeaders = {
      Authorization:  `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept:         'application/vnd.github+json',
      'User-Agent':   'at2026-comments-worker',
    };

    // Fetch existing comments + SHA
    let sha      = null;
    let existing = [];
    const getRes = await fetch(apiUrl, { headers: ghHeaders });
    if (getRes.ok) {
      const data  = await getRes.json();
      sha         = data.sha;
      const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      existing    = JSON.parse(new TextDecoder().decode(bytes));
    } else if (getRes.status !== 404) {
      return corsResponse(JSON.stringify({ error: `GitHub read error ${getRes.status}` }), 502, env, origin);
    }

    existing.push({ name, message, timestamp });
    const encoded = new TextEncoder().encode(JSON.stringify(existing, null, 2));
    let binary = '';
    encoded.forEach(b => binary += String.fromCharCode(b));
    const content = btoa(binary);

    const putRes = await fetch(apiUrl, {
      method:  'PUT',
      headers: ghHeaders,
      body: JSON.stringify({
        message: `Add comment on ${slug}`,
        content,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      return corsResponse(JSON.stringify({ error: err.message || `GitHub write error ${putRes.status}` }), 502, env, origin);
    }

    // Return the full updated comments list so the client can render immediately
    return corsResponse(JSON.stringify({ ok: true, comments: existing }), 200, env, origin);
  },
};

function corsResponse(body, status, env, requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  return new Response(body, { status, headers });
}
