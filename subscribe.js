/**
 * subscribe.js — Email capture widget for Laura on Trail
 *
 * Usage: <div class="subscribe-widget" data-source="homepage"></div>
 * The widget self-initialises on DOMContentLoaded.
 * data-source is passed to the worker for analytics (optional).
 */

(function () {
  const WORKER_URL = 'https://at2026-comments.noah-f08.workers.dev';

  // ── INPUT STYLES ── (shared with comments.js aesthetic)
  const INPUT_BASE = [
    'width:100%',
    'padding:0.6rem 0.75rem',
    'font-family:var(--body)',
    'font-size:0.9rem',
    'color:var(--ink)',
    'background:var(--white)',
    'border:1.5px solid var(--tan)',
    'outline:none',
    'box-sizing:border-box',
    'transition:border-color 0.15s',
  ].join(';');

  const BTN_BASE = [
    'padding:0.6rem 1.4rem',
    'background:var(--pine)',
    'color:var(--white)',
    'font-family:var(--sans)',
    'font-size:0.6rem',
    'font-weight:600',
    'text-transform:uppercase',
    'letter-spacing:0.12em',
    'border:none',
    'cursor:pointer',
    'white-space:nowrap',
    'flex-shrink:0',
    'transition:background 0.15s',
  ].join(';');

  function renderWidget(container) {
    const source = container.dataset.source || 'unknown';

    container.innerHTML = `
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <input
          type="email"
          class="sw-email"
          placeholder="your@email.com"
          maxlength="254"
          autocomplete="email"
          style="${INPUT_BASE};flex:1;min-width:180px"
          onfocus="this.style.borderColor='var(--pine)'"
          onblur="this.style.borderColor='var(--tan)'"
        />
        <button
          type="button"
          class="sw-submit"
          style="${BTN_BASE}"
          onmouseover="if(!this.disabled)this.style.background='var(--ink)'"
          onmouseout="if(!this.disabled&&!this.dataset.done)this.style.background='var(--pine)'"
        >Subscribe</button>
      </div>
      <span
        class="sw-status"
        role="status"
        aria-live="polite"
        style="display:block;margin-top:0.5rem;font-family:var(--sans);font-size:0.75rem;font-style:italic;min-height:1.1em"
      ></span>`;

    const input  = container.querySelector('.sw-email');
    const btn    = container.querySelector('.sw-submit');
    const status = container.querySelector('.sw-status');

    function setStatus(msg, isError) {
      status.textContent  = msg;
      status.style.color  = isError ? '#8b1a1a' : '#1e5630';
      status.style.fontStyle = 'italic';
    }

    async function submit() {
      const email = input.value.trim();

      if (!email) {
        setStatus('Please enter your email address.', true);
        input.focus();
        return;
      }

      btn.disabled    = true;
      btn.textContent = '…';
      status.textContent = '';

      try {
        const res  = await fetch(`${WORKER_URL}/subscribe`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email, source }),
        });
        const data = await res.json().catch(() => ({}));

        if (data.duplicate) {
          setStatus("You're already on the list — Laura will keep you posted!", false);
          input.value   = '';
          btn.disabled  = false;
          btn.textContent = 'Subscribe';
        } else if (data.ok) {
          setStatus("You're on the list! Trail updates coming your way.", false);
          input.value    = '';
          input.disabled = true;
          btn.dataset.done = '1';
          btn.textContent  = 'Subscribed ✓';
          btn.style.background = '#2c5530';
          // btn stays disabled — one-shot
        } else {
          setStatus(data.error || 'Something went wrong — please try again.', true);
          btn.disabled    = false;
          btn.textContent = 'Subscribe';
        }
      } catch {
        setStatus('Could not connect — please try again.', true);
        btn.disabled    = false;
        btn.textContent = 'Subscribe';
      }
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  function initSubscribe(root) {
    (root || document).querySelectorAll('.subscribe-widget:not([data-sw-init])').forEach(el => {
      el.dataset.swInit = '1';
      renderWidget(el);
    });
  }

  window.initSubscribe = initSubscribe;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initSubscribe());
  } else {
    initSubscribe();
  }
})();
