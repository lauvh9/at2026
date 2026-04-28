/**
 * comments.js — Lightweight guest comment system for Laura on Trail
 *
 * Comments are submitted via a Cloudflare Worker proxy (worker.js).
 * The GitHub token lives in the Worker as a secret — never in this file.
 *
 * Setup: see worker.js for deployment instructions.
 * Once deployed, paste your Worker URL below as WORKER_URL.
 */

(function () {
  // ── CONFIG ────────────────────────────────────────────────────────────────
  const GITHUB_OWNER = 'lauvh9';
  const GITHUB_REPO  = 'at2026';
  const WORKER_URL   = '';   // ← paste your Cloudflare Worker URL (no trailing slash)
  // ─────────────────────────────────────────────────────────────────────────

  function getSlug() {
    return window.location.pathname
      .replace(/^\/|\/$/g, '')
      .replace(/\.html$/, '')
      .replace(/\//g, '_') || 'index';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadComments(slug) {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/data/comments/${slug}.json?t=${Date.now()}`
      );
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  }

  // Posts to the Cloudflare Worker, which holds the GitHub token server-side.
  async function submitComment(slug, comment) {
    if (!WORKER_URL) throw new Error('Comments not configured yet.');
    const res = await fetch(`${WORKER_URL}/comment`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ...comment }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  }

  function renderComments(comments) {
    if (!comments.length) {
      return '<p style="color:var(--trail);font-style:italic;font-size:0.9rem">No comments yet — be the first!</p>';
    }
    return comments.map(c => {
      const date = new Date(c.timestamp).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      return `
        <div style="padding:1rem 0;border-bottom:1px solid var(--fog)">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.4rem">
            <span style="font-family:var(--sans);font-size:0.8rem;font-weight:600;color:var(--pine)">${escapeHtml(c.name)}</span>
            <span style="font-family:var(--mono);font-size:0.55rem;color:var(--trail)">${date}</span>
          </div>
          <p style="font-size:0.92rem;line-height:1.65;color:var(--ink);margin:0">${escapeHtml(c.message).replace(/\n/g, '<br>')}</p>
        </div>`;
    }).join('');
  }

  // Poll until the new comment appears (workflow takes ~20-40s).
  function pollForNewComment(slug, previousCount, onUpdate) {
    const MAX_ATTEMPTS = 15;
    let   attempts     = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const updated = await loadComments(slug);
        if (updated.length > previousCount) {
          clearInterval(timer);
          onUpdate(updated);
        }
      } catch { /* keep polling */ }
      if (attempts >= MAX_ATTEMPTS) clearInterval(timer);
    }, 5000);
  }

  async function init() {
    const container = document.getElementById('comments-section');
    if (!container) return;

    const slug     = getSlug();
    const comments = await loadComments(slug);

    container.innerHTML = `
      <div id="comments-list" style="margin-bottom:1.5rem">${renderComments(comments)}</div>

      <div style="background:var(--fog);padding:1.25rem 1.5rem;border:1px solid var(--tan)">
        <div style="font-family:var(--sans);font-size:0.6rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--pine);margin-bottom:1rem">Leave a comment</div>

        <div style="margin-bottom:0.75rem">
          <input id="comment-name" type="text" placeholder="Your name" maxlength="80"
            style="width:100%;padding:0.55rem 0.75rem;font-family:var(--body);font-size:0.9rem;color:var(--ink);background:var(--white);border:1.5px solid var(--tan);outline:none;box-sizing:border-box;transition:border-color 0.15s"
            onfocus="this.style.borderColor='var(--pine)'" onblur="this.style.borderColor='var(--tan)'">
        </div>

        <div style="margin-bottom:0.75rem">
          <textarea id="comment-message" placeholder="Write your comment..." maxlength="2000" rows="4"
            style="width:100%;padding:0.55rem 0.75rem;font-family:var(--body);font-size:0.9rem;color:var(--ink);background:var(--white);border:1.5px solid var(--tan);outline:none;resize:vertical;line-height:1.65;box-sizing:border-box;transition:border-color 0.15s"
            onfocus="this.style.borderColor='var(--pine)'" onblur="this.style.borderColor='var(--tan)'"></textarea>
        </div>

        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <button id="comment-submit"
            style="font-family:var(--sans);font-size:0.6rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;padding:0.6rem 1.4rem;background:var(--pine);color:var(--white);border:none;cursor:pointer">
            Post comment
          </button>
          <span id="comment-status" style="font-family:var(--sans);font-size:0.78rem"></span>
        </div>
      </div>`;

    document.getElementById('comment-submit').addEventListener('click', async function () {
      const name    = document.getElementById('comment-name').value.trim();
      const message = document.getElementById('comment-message').value.trim();
      const status  = document.getElementById('comment-status');
      const btn     = this;

      if (!name) {
        status.textContent = 'Please enter your name.';
        status.style.color = '#8b1a1a';
        document.getElementById('comment-name').focus();
        return;
      }
      if (!message) {
        status.textContent = 'Please write a comment.';
        status.style.color = '#8b1a1a';
        document.getElementById('comment-message').focus();
        return;
      }

      btn.disabled       = true;
      btn.textContent    = 'Posting...';
      status.textContent = '';

      const comment       = { name, message, timestamp: new Date().toISOString() };
      const previousCount = (await loadComments(slug)).length;

      try {
        await submitComment(slug, comment);

        document.getElementById('comment-name').value    = '';
        document.getElementById('comment-message').value = '';
        status.textContent = "Comment submitted! It'll appear here in ~30 seconds.";
        status.style.color = '#1e5630';
        btn.textContent    = 'Post comment';
        btn.disabled       = false;

        pollForNewComment(slug, previousCount, updated => {
          document.getElementById('comments-list').innerHTML = renderComments(updated);
          status.textContent = 'Comment posted!';
        });
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
        status.style.color = '#8b1a1a';
        btn.disabled       = false;
        btn.textContent    = 'Post comment';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
