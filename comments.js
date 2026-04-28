/**
 * comments.js — Lightweight guest comment system for Laura on Trail
 *
 * Supports multiple comment sections on the same page.
 * Usage:
 *   Single post page:  <div id="comments-section"></div>
 *   Multiple on page:  <div class="comments-widget" data-slug="activity-12345"></div>
 *
 * Comments are submitted via a Cloudflare Worker proxy (worker.js).
 * The GitHub token lives in the Worker as a secret — never in this file.
 */

(function () {
  // ── CONFIG ────────────────────────────────────────────────────────────────
  const GITHUB_OWNER = 'lauvh9';
  const GITHUB_REPO  = 'at2026';
  const WORKER_URL   = 'https://at2026-comments.noah-f08.workers.dev';
  // ─────────────────────────────────────────────────────────────────────────

  function getSlugFromPath() {
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

  // Initialise a single comment widget inside `container` using `slug`.
  async function initWidget(container, slug) {
    const comments = await loadComments(slug);

    container.innerHTML = `
      <div class="cw-list" style="margin-bottom:1.5rem">${renderComments(comments)}</div>
      <div style="background:var(--fog);padding:1.25rem 1.5rem;border:1px solid var(--tan)">
        <div style="font-family:var(--sans);font-size:0.6rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--pine);margin-bottom:1rem">Leave a comment</div>
        <div style="margin-bottom:0.75rem">
          <input class="cw-name" type="text" placeholder="Your name" maxlength="80"
            style="width:100%;padding:0.55rem 0.75rem;font-family:var(--body);font-size:0.9rem;color:var(--ink);background:var(--white);border:1.5px solid var(--tan);outline:none;box-sizing:border-box;transition:border-color 0.15s"
            onfocus="this.style.borderColor='var(--pine)'" onblur="this.style.borderColor='var(--tan)'">
        </div>
        <div style="margin-bottom:0.75rem">
          <textarea class="cw-message" placeholder="Write your comment..." maxlength="2000" rows="4"
            style="width:100%;padding:0.55rem 0.75rem;font-family:var(--body);font-size:0.9rem;color:var(--ink);background:var(--white);border:1.5px solid var(--tan);outline:none;resize:vertical;line-height:1.65;box-sizing:border-box;transition:border-color 0.15s"
            onfocus="this.style.borderColor='var(--pine)'" onblur="this.style.borderColor='var(--tan)'"></textarea>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <button class="cw-submit"
            style="font-family:var(--sans);font-size:0.6rem;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;padding:0.6rem 1.4rem;background:var(--pine);color:var(--white);border:none;cursor:pointer">
            Post comment
          </button>
          <span class="cw-status" style="font-family:var(--sans);font-size:0.78rem"></span>
        </div>
      </div>`;

    const nameEl    = container.querySelector('.cw-name');
    const messageEl = container.querySelector('.cw-message');
    const submitBtn = container.querySelector('.cw-submit');
    const statusEl  = container.querySelector('.cw-status');
    const listEl    = container.querySelector('.cw-list');

    submitBtn.addEventListener('click', async function () {
      const name    = nameEl.value.trim();
      const message = messageEl.value.trim();

      if (!name) {
        statusEl.textContent = 'Please enter your name.';
        statusEl.style.color = '#8b1a1a';
        nameEl.focus();
        return;
      }
      if (!message) {
        statusEl.textContent = 'Please write a comment.';
        statusEl.style.color = '#8b1a1a';
        messageEl.focus();
        return;
      }

      submitBtn.disabled       = true;
      submitBtn.textContent    = 'Posting...';
      statusEl.textContent     = '';

      const comment       = { name, message, timestamp: new Date().toISOString() };
      const previousCount = (await loadComments(slug)).length;

      try {
        await submitComment(slug, comment);
        nameEl.value    = '';
        messageEl.value = '';
        statusEl.textContent = "Comment submitted! It'll appear here in ~30 seconds.";
        statusEl.style.color = '#1e5630';
        submitBtn.textContent = 'Post comment';
        submitBtn.disabled    = false;

        pollForNewComment(slug, previousCount, updated => {
          listEl.innerHTML     = renderComments(updated);
          statusEl.textContent = 'Comment posted!';
        });
      } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        statusEl.style.color = '#8b1a1a';
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Post comment';
      }
    });
  }

  function init() {
    // Multi-instance: any element with class="comments-widget" and data-slug
    const widgets = document.querySelectorAll('.comments-widget[data-slug]');
    widgets.forEach(el => initWidget(el, el.dataset.slug));

    // Single-instance legacy: id="comments-section" (blog post pages)
    const legacy = document.getElementById('comments-section');
    if (legacy) initWidget(legacy, getSlugFromPath());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
