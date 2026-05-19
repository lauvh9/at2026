(function () {
  'use strict';

  const GITHUB_OWNER = 'lauvh9';
  const GITHUB_REPO  = 'at2026';
  const WORKER_URL   = 'https://at2026-comments.lauvh9.workers.dev';
  const AUTH_KEY     = 'post_authed';
  const PASS_KEY     = 'post_password';

  // Only run on blog post pages and only when authenticated
  if (!document.querySelector('article.post-prose')) return;
  if (localStorage.getItem(AUTH_KEY) !== '1') return;

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #edit-fab {
      position: fixed;
      bottom: 1.75rem;
      right: 1.75rem;
      z-index: 900;
      background: var(--ink);
      color: var(--cream);
      border: none;
      width: 2.75rem;
      height: 2.75rem;
      font-size: 1.1rem;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(26,18,8,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    #edit-fab:hover { background: var(--pine); }

    #edit-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(26,18,8,0.6);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      overflow-y: auto;
    }
    #edit-overlay.open { display: flex; }

    #edit-modal {
      background: var(--cream);
      border: 2px solid var(--ink);
      width: 100%;
      max-width: 680px;
      max-height: 90vh;
      overflow-y: auto;
      padding: 2rem;
      position: relative;
    }
    #edit-modal h2 {
      font-family: var(--display);
      font-size: 1.4rem;
      font-weight: 900;
      text-transform: uppercase;
      border-bottom: 2px solid var(--ink);
      padding-bottom: 0.3rem;
      margin-bottom: 1.25rem;
    }
    #edit-modal .field { margin-bottom: 1rem; }
    #edit-modal .field label {
      display: block;
      font-family: var(--sans);
      font-size: 0.6rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--pine);
      margin-bottom: 0.3rem;
    }
    #edit-modal .field input,
    #edit-modal .field textarea {
      width: 100%;
      padding: 0.6rem 0.75rem;
      font-family: var(--body);
      font-size: 0.9rem;
      color: var(--ink);
      background: var(--white);
      border: 1.5px solid var(--tan);
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }
    #edit-modal .field input:focus,
    #edit-modal .field textarea:focus { border-color: var(--pine); }
    #edit-modal .field textarea {
      min-height: 300px;
      resize: vertical;
      line-height: 1.7;
    }
    #edit-modal .modal-actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
    #edit-modal .modal-status {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      font-family: var(--sans);
      font-size: 0.75rem;
      display: none;
    }
    #edit-modal .modal-status.success { background: #d4edda; color: #1e5630; border-left: 3px solid var(--pine); display: block; }
    #edit-modal .modal-status.error   { background: #fde8e8; color: #8b1a1a; border-left: 3px solid #8b1a1a; display: block; }
    #edit-modal-close {
      position: absolute;
      top: 1rem; right: 1rem;
      background: none; border: none;
      font-size: 1.2rem; cursor: pointer;
      color: var(--trail); font-family: var(--mono);
    }
    #edit-modal-close:hover { color: var(--ink); }
    #edit-logout-btn {
      font-family: var(--sans);
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--trail);
      background: none;
      border: none;
      cursor: pointer;
      text-decoration: underline;
      padding: 0;
      margin-top: 1rem;
      display: block;
    }
    #edit-logout-btn:hover { color: var(--ink); }
  `;
  document.head.appendChild(style);

  // ── FAB ───────────────────────────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.id    = 'edit-fab';
  fab.title = 'Edit this post';
  fab.innerHTML = '&#9998;';
  document.body.appendChild(fab);

  // ── Modal markup ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'edit-overlay';
  overlay.innerHTML = `
    <div id="edit-modal">
      <button id="edit-modal-close">&#10005;</button>
      <h2>Edit Post</h2>
      <div class="field">
        <label>Title</label>
        <input type="text" id="edit-title">
      </div>
      <div class="field">
        <label>Tags (comma separated)</label>
        <input type="text" id="edit-tags">
      </div>
      <div class="field">
        <label>Excerpt <span style="font-weight:400;text-transform:none;letter-spacing:0">(shown in blog listing)</span></label>
        <input type="text" id="edit-excerpt">
      </div>
      <div class="field">
        <label>Post body</label>
        <textarea id="edit-body"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="edit-save-btn">Save changes &#8594;</button>
        <button class="btn btn-outline" id="edit-cancel-btn">Cancel</button>
      </div>
      <div class="modal-status" id="edit-status"></div>
      <button id="edit-logout-btn">Log out</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── Open / close ──────────────────────────────────────────────────────────
  fab.addEventListener('click', openEditor);
  document.getElementById('edit-modal-close').addEventListener('click', closeEditor);
  document.getElementById('edit-cancel-btn').addEventListener('click', closeEditor);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeEditor();
  });

  function openEditor() {
    const { title, tags, excerpt, body } = readFromDOM();
    document.getElementById('edit-title').value   = title;
    document.getElementById('edit-tags').value    = tags;
    document.getElementById('edit-excerpt').value = excerpt;
    document.getElementById('edit-body').value    = body;

    setStatus('', '');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeEditor() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── Log out ───────────────────────────────────────────────────────────────
  document.getElementById('edit-logout-btn').addEventListener('click', function () {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(PASS_KEY);
    closeEditor();
    fab.remove();
    overlay.remove();
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  document.getElementById('edit-save-btn').addEventListener('click', doSave);

  // ── Worker helpers ────────────────────────────────────────────────────────
  async function workerRead(path) {
    const password = localStorage.getItem(PASS_KEY);
    if (!password) throw new Error('Not authenticated — please log in on the blog page.');
    const res = await fetch(`${WORKER_URL}/github-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, path }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) localStorage.removeItem(PASS_KEY);
      throw new Error(err.error || `Read error ${res.status}`);
    }
    return res.json();
  }

  async function workerWrite(path, content, sha, message) {
    const password = localStorage.getItem(PASS_KEY);
    if (!password) throw new Error('Not authenticated — please log in on the blog page.');
    const res = await fetch(`${WORKER_URL}/github-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, path, content, sha: sha || undefined, message }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) localStorage.removeItem(PASS_KEY);
      throw new Error(err.error || `Write error ${res.status}`);
    }
    return res.json();
  }

  async function doSave() {
    const title   = document.getElementById('edit-title').value.trim();
    const tags    = document.getElementById('edit-tags').value.trim();
    const excerpt = document.getElementById('edit-excerpt').value.trim();
    const body    = document.getElementById('edit-body').value.trim();

    if (!title || !body) {
      setStatus('error', 'Title and body are required.');
      return;
    }
    if (!localStorage.getItem(PASS_KEY)) {
      setStatus('error', 'Not authenticated — please log in on the blog page first.');
      return;
    }

    const btn = document.getElementById('edit-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    setStatus('', '');

    try {
      const filePath = window.location.pathname.replace(/^\//, '');

      // 1. Fetch current file SHA via Worker
      const fileData = await workerRead(filePath);
      if (!fileData) throw new Error(`Could not read file from GitHub`);
      const { sha } = fileData;

      // 2. Rebuild and commit the post HTML
      const photos = readPhotosFromDOM();
      const html   = buildPostHTML({ title, tags, excerpt, body, filePath, photos });
      await workerWrite(filePath, toBase64(html), sha, `Edit: ${title}`);

      // 3. Update the card in blog.html
      btn.textContent = 'Updating listing…';
      await updateBlogCard({ title, tags, excerpt, filePath });

      setStatus('success', '✓ Saved! Changes will be live in ~1 min.');
      btn.textContent = 'Saved ✓';
      setTimeout(() => {
        btn.disabled    = false;
        btn.textContent = 'Save changes →';
      }, 3000);
    } catch (err) {
      setStatus('error', `Error: ${err.message}`);
      btn.disabled    = false;
      btn.textContent = 'Save changes →';
    }
  }

  // ── DOM readers ───────────────────────────────────────────────────────────
  function readFromDOM() {
    const title   = document.querySelector('h1')?.textContent?.trim() || '';
    const tags    = Array.from(document.querySelectorAll('.post-tag'))
      .map(t => t.textContent.trim()).join(', ');
    const excerpt = document.querySelector('meta[name="description"]')?.content || '';
    const body    = Array.from(document.querySelectorAll('article.post-prose p'))
      .map(p => p.innerText.trim()).join('\n\n');
    return { title, tags, excerpt, body };
  }

  function readPhotosFromDOM() {
    const article  = document.querySelector('article.post-prose');
    const photoDiv = article?.nextElementSibling;
    if (!photoDiv || !photoDiv.querySelector('figure')) return [];
    return Array.from(photoDiv.querySelectorAll('figure')).map(fig => {
      const img     = fig.querySelector('img');
      const caption = fig.querySelector('figcaption')?.textContent?.trim()
        || img?.getAttribute('alt') || '';
      const src = img?.getAttribute('src')?.replace(/^\.\.\//, '') || '';
      return { filename: src, caption };
    }).filter(p => p.filename);
  }

  // ── Blog card update ──────────────────────────────────────────────────────
  async function updateBlogCard({ title, tags, excerpt, filePath }) {
    const filename  = filePath.split('/').pop();
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) return;
    const date = dateMatch[1];

    const data = await workerRead('blog.html');
    if (!data) return;
    const blogHtml = fromBase64(data.content);
    const marker   = `<!-- BLOG-POST: ${date} -->`;
    if (!blogHtml.includes(marker)) return;

    const cardRegex = new RegExp(`[ \\t]*<!-- BLOG-POST: ${date} -->[\\s\\S]*?<\\/a>`);
    const newCard   = generateBlogCard({ title, date, excerpt, tags, filename }).replace(/^\n/, '');
    const updated   = blogHtml.replace(cardRegex, newCard);
    if (updated === blogHtml) return;

    await workerWrite('blog.html', toBase64(updated), data.sha, `Update blog card: ${title}`);
  }

  // ── HTML builders (mirrors generatePostHTML / generateBlogCard in blog.html) ─
  function buildPostHTML({ title, tags, excerpt, body, filePath, photos }) {
    const filename  = filePath.split('/').pop();
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    const date      = dateMatch ? dateMatch[1] : '';
    const d         = date ? new Date(date + 'T12:00:00') : new Date();
    const human     = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const paragraphs = body
      .split(/\n\n+/)
      .map(p => `        <p>${p.replace(/\n/g, ' ').trim()}</p>`)
      .filter(p => p !== '        <p></p>')
      .join('\n');

    const tagList = tags
      ? tags.split(',').map(t => `<span class="post-tag">${t.trim()}</span>`).join('')
      : '';

    const photoSection = photos.length ? [
      '      <div style="margin-top:2.5rem">',
      photos.map(({ filename: pf, caption }) =>
        `        <figure style="margin:0 0 1.5rem">\n          <img src="../${pf}" alt="${caption}" style="width:100%;border-radius:3px;display:block">\n` +
        (caption ? `          <figcaption style="font-family:var(--sans);font-size:0.75rem;color:var(--trail);margin-top:0.5rem;font-style:italic">${caption}</figcaption>\n` : '') +
        `        </figure>`
      ).join('\n'),
      '      </div>',
    ] : [];

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `  <title>${title} — Laura on Trail</title>`,
      `  <meta property="og:title" content="${title} — Laura on Trail">`,
      '  <meta property="og:image" content="https://lauratheexplorer.co/preview.jpg">',
      ...(excerpt ? [`  <meta name="description" content="${excerpt}">`] : []),
      '  <link rel="icon" type="image/x-icon" href="../favicon.ico">',
      '  <link rel="stylesheet" href="../style.css" />',
      '  <style>',
      '    .post-hero { background: var(--cream); border-bottom: 2px solid var(--ink); padding: 3rem 2rem 2.5rem; text-align:center; }',
      '    .back-link { font-family: var(--sans); font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--pine); text-decoration: none; border-bottom: 1px solid var(--pine); padding-bottom: 1px; }',
      '    .back-link:hover { color: var(--ink); }',
      '    .post-date-stamp { font-family: var(--sans); font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--trail); }',
      '    .post-nav-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }',
      '    .post-hero h1 { color: var(--ink); font-size: clamp(1.8rem, 4vw, 3rem); border-bottom: none; padding-bottom: 0; }',
      '    .post-prose { font-size: 1.05rem; line-height: 1.85; color: var(--ink); }',
      '    .post-prose p { margin-bottom: 1.3rem; }',
      '    .post-prose p:first-of-type::first-letter { font-family: var(--display); font-size: 3.5rem; font-weight: 900; float: left; line-height: 0.85; margin-right: 8px; margin-top: 4px; color: var(--pine); }',
      '    .post-tag { font-family: var(--sans); font-size: 0.52rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 7px; background: var(--fog); color: var(--trail); border: 1px solid var(--tan); display: inline-block; margin-right: 4px; }',
      '  </style>',
      '</head>',
      '<body>',
      '<nav>',
      '  <a href="../index.html" class="nav-logo"><span class="blaze"></span>Laura on Trail</a>',
      '  <ul class="nav-links">',
      '    <li><a href="../index.html">Home</a></li>',
      '    <li><a href="../strava-log.html">Strava</a></li>',
      '    <li><a href="../blog.html" class="active">Log</a></li>',
      '    <li><a href="../gallery.html">Gallery</a></li>',
      '    <li><a href="../gear.html">Gear</a></li>',
      '    <li><a href="../resources.html">Resources</a></li>',
      '  </ul>',
      '  <button class="nav-hamburger" id="nav-hamburger" aria-label="Menu" onclick="toggleNav()">',
      '    <span></span><span></span><span></span>',
      '  </button>',
      '  <ul class="nav-mobile-menu" id="nav-mobile-menu">',
      '    <li><a href="../index.html">Home</a></li>',
      '    <li><a href="../strava-log.html">Strava</a></li>',
      '    <li><a href="../blog.html" class="active">Log</a></li>',
      '    <li><a href="../gallery.html">Gallery</a></li>',
      '    <li><a href="../gear.html">Gear</a></li>',
      '    <li><a href="../resources.html">Resources</a></li>',
      '  </ul>',
      '</nav>',
      '<header class="post-hero">',
      '  <div class="container-narrow">',
      '    <div class="post-nav-row">',
      '      <a href="../blog.html" class="back-link">← All posts</a>',
      `      <span class="post-date-stamp">${human}</span>`,
      '    </div>',
      `    <h1>${title}</h1>`,
      tagList ? `    <div style="margin-top:0.75rem">${tagList}</div>` : '',
      '  </div>',
      '</header>',
      '<main>',
      '  <section>',
      '    <div class="container-narrow">',
      '      <article class="post-prose">',
      paragraphs,
      '      </article>',
      ...photoSection,
      '      <div style="margin-top:3rem;padding-top:2rem;border-top:2px solid var(--ink)">',
      '        <span style="font-family:var(--sans);font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.15em;color:var(--pine);display:block;margin-bottom:0.5rem">Comments</span>',
      '        <h2 style="margin-bottom:1.5rem">Join the conversation</h2>',
      '        <div id="comments-section"></div>',
      '      </div>',
      '    </div>',
      '  </section>',
      '</main>',
      '<scr' + 'ipt src="../comments.js"></scr' + 'ipt>',
      '<scr' + 'ipt src="../edit.js"></scr' + 'ipt>',
      '<scr' + 'ipt>',
      'function toggleNav() {',
      '  var btn  = document.getElementById("nav-hamburger");',
      '  var menu = document.getElementById("nav-mobile-menu");',
      '  btn.classList.toggle("open");',
      '  menu.classList.toggle("open");',
      '}',
      'document.addEventListener("click", function(e) {',
      '  var btn  = document.getElementById("nav-hamburger");',
      '  var menu = document.getElementById("nav-mobile-menu");',
      '  if (menu && menu.classList.contains("open") && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {',
      '    btn.classList.remove("open");',
      '    menu.classList.remove("open");',
      '  }',
      '});',
      '</scr' + 'ipt>',
      '<footer>',
      '  <div class="foot-logo">Laura on Trail</div>',
      '  <p>Springer Mountain, GA → Katahdin, ME · NOBO 2026</p>',
      '</footer>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  function generateBlogCard({ title, date, excerpt, tags, filename }) {
    const d     = new Date(date + 'T12:00:00');
    const day   = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const year  = d.getFullYear();
    const tagHTML = tags
      ? tags.split(',').map(t => `<span class="post-tag">${t.trim()}</span>`).join('')
      : '';
    return `
        <!-- BLOG-POST: ${date} -->
        <a href="blog-posts/${filename}" class="post-full-card fade-up">
          <div class="post-date-col">
            <span class="day">${day}</span>
            <span class="month">${month}</span>
            <span class="year">${year}</span>
          </div>
          <div class="post-body">
            <h3>${title}</h3>
            <p class="excerpt">${excerpt || ''}</p>
            ${tagHTML ? `<div class="post-tags">${tagHTML}</div>` : ''}
          </div>
        </a>`;
  }

  // ── Encoding helpers ──────────────────────────────────────────────────────
  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  function fromBase64(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function setStatus(type, msg) {
    const el = document.getElementById('edit-status');
    el.textContent = msg;
    el.className   = 'modal-status' + (type ? ' ' + type : '');
  }

})();
