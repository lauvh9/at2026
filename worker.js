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
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env, origin);
    }

    if (request.method !== 'POST' || new URL(request.url).pathname !== '/comment') {
      return corsResponse(JSON.stringify({ error: 'Not found' }), 404, env, origin);
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
      const data = await getRes.json();
      sha      = data.sha;
      existing = JSON.parse(atob(data.content.replace(/\n/g, '')));
    } else if (getRes.status !== 404) {
      return corsResponse(JSON.stringify({ error: `GitHub read error ${getRes.status}` }), 502, env, origin);
    }

    existing.push({ name, message, timestamp });
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(existing, null, 2))));

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
