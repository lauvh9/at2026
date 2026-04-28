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

    // Trigger the GitHub Actions workflow
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/save-comment.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          Accept:         'application/vnd.github+json',
          'User-Agent':   'at2026-comments-worker',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { slug, name, message, timestamp },
        }),
      }
    );

    if (!ghRes.ok) {
      const err = await ghRes.json().catch(() => ({}));
      return corsResponse(
        JSON.stringify({ error: err.message || `GitHub error ${ghRes.status}` }),
        502,
        env,
        origin
      );
    }

    return corsResponse(JSON.stringify({ ok: true }), 200, env, origin);
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
