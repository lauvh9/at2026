#!/usr/bin/env node
/**
 * strava-sync.js
 * --------------
 * Runs daily (via GitHub Actions) to:
 *   1. Refresh the Strava OAuth token
 *   2. Fetch the latest activity
 *   3. Parse "End mile: NNN" from the description
 *   4. Write data/trail-status.json  (read by index.html)
 *   5. Write a new blog post HTML file if the activity is new
 *
 * Required environment variables (set as GitHub Actions secrets):
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   STRAVA_REFRESH_TOKEN   ← from first-time OAuth setup (see STRAVA-SETUP.md)
 */

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

const STATUS_FILE   = path.join(__dirname, 'data', 'trail-status.json');
const POSTS_DIR     = path.join(__dirname, 'posts');
const SEEN_FILE     = path.join(__dirname, 'data', 'seen-activities.json');

// Regex to find "end mile: 342" (case-insensitive, flexible spacing/punctuation)
const MILE_REGEX = /end\s*mile[:\s\-]+(\d+(\.\d+)?)/i;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
  }
  return res.json();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

// ─── STRAVA TOKEN REFRESH ─────────────────────────────────────────────────
async function refreshAccessToken() {
  console.log('Refreshing Strava access token…');
  const data = await fetchJSON('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  console.log(`Access token obtained (expires ${new Date(data.expires_at * 1000).toISOString()})`);
  return data.access_token;
}

// ─── FETCH ACTIVITIES ─────────────────────────────────────────────────────
async function fetchRecentActivities(token, perPage = 10) {
  console.log('Fetching recent Strava activities…');
  return fetchJSON(
    `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ─── FETCH ACTIVITY PHOTOS ────────────────────────────────────────────────
async function fetchPhotos(token, activityId) {
  try {
    const photos = await fetchJSON(
      `https://www.strava.com/api/v3/activities/${activityId}/photos?photo_sources=true&size=1800`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    // Return array of the best-quality URL for each photo
    return photos
      .filter(p => p.urls)
      .map(p => p.urls['1800'] || p.urls[Object.keys(p.urls).pop()])
      .filter(Boolean);
  } catch (e) {
    console.warn(`Could not fetch photos for activity ${activityId}:`, e.message);
    return [];
  }
}

// ─── FETCH FULL ACTIVITY (for full description) ───────────────────────────
async function fetchActivity(token, activityId) {
  return fetchJSON(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ─── PARSE MILE MARKER FROM DESCRIPTION ──────────────────────────────────
function parseMile(description) {
  if (!description) return null;
  const match = description.match(MILE_REGEX);
  return match ? parseFloat(match[1]) : null;
}

// ─── FORMAT ELEVATION ─────────────────────────────────────────────────────
function metersToFeet(m) { return Math.round(m * 3.28084).toLocaleString(); }
function metersToMiles(m) { return (m / 1609.34).toFixed(1); }

// ─── SLUGIFY ──────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ─── FORMAT DATE ──────────────────────────────────────────────────────────
function formatDate(isoString) {
  const d = new Date(isoString);
  return {
    iso:   d.toISOString().split('T')[0],
    human: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    day:   d.getDate(),
    month: d.toLocaleDateString('en-US', { month: 'short' }),
    year:  d.getFullYear(),
  };
}

// ─── GENERATE BLOG POST HTML ──────────────────────────────────────────────
function generatePostHTML(activity, photos, endMile, dateInfo) {
  const title        = activity.name || 'Trail Day';
  const description  = (activity.description || '').trim();
  const distanceMi   = metersToMiles(activity.distance);
  const elevFt       = metersToFeet(activity.total_elevation_gain);
  const movingTime   = activity.moving_time;
  const hours        = Math.floor(movingTime / 3600);
  const mins         = Math.floor((movingTime % 3600) / 60);
  const timeStr      = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  // Strip the "end mile: NNN" line from the caption before displaying
  const cleanDesc = description.replace(MILE_REGEX, '').trim();

  // Split description into paragraphs for HTML
  const paragraphs = cleanDesc
    .split(/\n\n+/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .map(p => `        <p>${p}</p>`)
    .join('\n');

  // Photo HTML
  const photoHTML = photos.length > 0
    ? photos.map(url => `
        <div class="post-photo">
          <img src="${url}" alt="Trail photo" loading="lazy" style="width:100%;display:block;border-radius:2px;"/>
        </div>`).join('\n')
    : `
        <div class="photo-placeholder">[ No photos attached to this activity ]</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Laura on Trail</title>
  <link rel="stylesheet" href="../style.css" />
  <style>
    .post-hero { background: var(--bark); padding: 3.5rem 2rem 3rem; position: relative; overflow: hidden; }
    .post-hero .hero-bg-lines { opacity: 0.05; }
    .post-nav-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .back-link { font-family: var(--mono); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sand); text-decoration: none; border-bottom: 1px solid rgba(201,169,110,0.3); padding-bottom: 1px; }
    .back-link:hover { color: var(--fog); }
    .post-date-stamp { font-family: var(--mono); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--trail); }
    .post-hero h1 { color: var(--white); line-height: 1.15; }
    .post-stats-row { display: flex; gap: 1.5rem; margin-top: 1.5rem; flex-wrap: wrap; }
    .post-stat { display: flex; flex-direction: column; }
    .post-stat-val { font-family: var(--serif); font-size: 1.4rem; font-weight: 700; color: var(--sand); line-height: 1; }
    .post-stat-lbl { font-family: var(--mono); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--trail); margin-top: 3px; }
    .post-prose { font-size: 1.05rem; line-height: 1.8; color: var(--ink); }
    .post-prose p { margin-bottom: 1.3rem; }
    .post-prose p:first-of-type::first-letter { font-family: var(--serif); font-size: 3.5rem; font-weight: 900; float: left; line-height: 0.85; margin-right: 8px; margin-top: 4px; color: var(--pine); }
    .post-photo { margin: 1.5rem 0; }
    .photo-placeholder { background: var(--fog); height: 180px; display: flex; align-items: center; justify-content: center; font-family: var(--mono); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--trail); border: 1px dashed var(--sand); margin: 1.5rem 0; }
  </style>
</head>
<body>

<nav>
  <a href="../index.html" class="nav-logo"><span class="blaze"></span>Laura on Trail</a>
  <ul class="nav-links">
    <li><a href="../index.html">Home</a></li>
    <li><a href="../gallery.html">Gallery</a></li>
    <li><a href="../blog.html" class="active">Trail Log</a></li>
    <li><a href="../gear.html">Gear</a></li>
    <li><a href="../resources.html">Resources</a></li>
  </ul>
</nav>

<header class="post-hero">
  <div class="hero-bg-lines"></div>
  <div class="container-narrow" style="position:relative;z-index:1">
    <div class="post-nav-row">
      <a href="../blog.html" class="back-link">← All entries</a>
      <span class="post-date-stamp">${dateInfo.human}</span>
    </div>
    <h1>${title}</h1>
    <div class="post-stats-row">
      <div class="post-stat">
        <span class="post-stat-val">${distanceMi}</span>
        <span class="post-stat-lbl">Miles today</span>
      </div>
      <div class="post-stat">
        <span class="post-stat-val">${endMile || '—'}</span>
        <span class="post-stat-lbl">Trail mile</span>
      </div>
      <div class="post-stat">
        <span class="post-stat-val">${elevFt}</span>
        <span class="post-stat-lbl">Elevation gain (ft)</span>
      </div>
      <div class="post-stat">
        <span class="post-stat-val">${timeStr}</span>
        <span class="post-stat-lbl">Moving time</span>
      </div>
    </div>
  </div>
</header>

<div class="topo-divider" style="background:var(--bark)">
  <svg viewBox="0 0 1200 40" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,40 L0,20 Q50,5 100,18 Q150,32 200,15 Q250,2 300,20 Q350,35 400,12 Q450,0 500,22 Q550,38 600,16 Q650,4 700,24 Q750,36 800,14 Q850,2 900,20 Q950,34 1000,12 Q1050,0 1100,18 Q1150,30 1200,10 L1200,40 Z" fill="#f4ede0"/>
  </svg>
</div>

<main>
  <section>
    <div class="container-narrow">
      <article class="post-prose">
${paragraphs || '        <p><em>No caption on this activity.</em></p>'}
      </article>

      <div style="margin-top:2rem">
${photoHTML}
      </div>

      <div style="margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--fog);font-family:var(--mono);font-size:0.6rem;color:var(--trail);text-transform:uppercase;letter-spacing:0.1em">
        Auto-generated from Strava · ${dateInfo.human}
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="foot-logo">Laura on Trail</div>
  <p>Springer Mountain, GA → Katahdin, ME · NOBO 2026</p>
</footer>

</body>
</html>`;
}

// ─── UPDATE BLOG INDEX ────────────────────────────────────────────────────
function generateBlogCard(activity, filename, dateInfo, endMile) {
  const title       = activity.name || 'Trail Day';
  const description = (activity.description || '').replace(MILE_REGEX, '').trim();
  const excerpt     = description.slice(0, 160).replace(/\n/g, ' ') + (description.length > 160 ? '…' : '');
  const distanceMi  = metersToMiles(activity.distance);

  return `
        <!-- AUTO: ${dateInfo.iso} -->
        <a href="posts/${filename}" class="post-full-card fade-up">
          <div class="post-date-col">
            <span class="day">${dateInfo.day}</span>
            <span class="month">${dateInfo.month}</span>
            <span class="year">${dateInfo.year}</span>
          </div>
          <div class="post-body">
            <h3>${title}</h3>
            <p class="excerpt">${excerpt || 'Trail miles logged.'}</p>
            <div class="post-tags">
              <span class="post-tag miles">${distanceMi} mi</span>
              ${endMile ? `<span class="post-tag">Mile ${endMile}</span>` : ''}
            </div>
          </div>
        </a>`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Missing required environment variables. See STRAVA-SETUP.md.');
    process.exit(1);
  }

  ensureDir(path.join(__dirname, 'data'));
  ensureDir(POSTS_DIR);

  const token      = await refreshAccessToken();
  const activities = await fetchRecentActivities(token, 10);

  if (!activities.length) {
    console.log('No activities found.');
    return;
  }

  // Load seen activity IDs so we don't re-generate posts
  const seen = loadJSON(SEEN_FILE, { ids: [] });

  // Find the most recent activity that has an end mile marker
  let latestMile   = null;
  let latestStatus = loadJSON(STATUS_FILE, {});

  const newPosts = [];

  for (const activity of activities) {
    const fullActivity = await fetchActivity(token, activity.id);
    const endMile      = parseMile(fullActivity.description);
    const dateInfo     = formatDate(fullActivity.start_date_local);

    // Track the highest end mile seen (most progress)
    if (endMile !== null && (latestMile === null || endMile > latestMile)) {
      latestMile = endMile;
    }

    // Generate a blog post if we haven't seen this activity before
    if (!seen.ids.includes(activity.id)) {
      console.log(`New activity: "${fullActivity.name}" (${dateInfo.iso})`);
      const photos   = await fetchPhotos(token, activity.id);
      const filename = `${dateInfo.iso}-${slugify(fullActivity.name)}.html`;
      const html     = generatePostHTML(fullActivity, photos, endMile, dateInfo);

      fs.writeFileSync(path.join(POSTS_DIR, filename), html, 'utf8');
      console.log(`  → Wrote posts/${filename} (${photos.length} photos)`);

      newPosts.push({ activity: fullActivity, filename, dateInfo, endMile });
      seen.ids.push(activity.id);
    }
  }

  // Write updated seen list
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2), 'utf8');

  // Write trail status JSON (read by index.html)
  if (latestMile !== null) {
    const updated = {
      ...latestStatus,
      miles_hiked:  latestMile,
      last_updated: new Date().toISOString(),
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`Updated trail-status.json → miles_hiked: ${latestMile}`);
  } else {
    console.log('No end mile found in recent activities; trail-status.json unchanged.');
  }

  // Prepend new blog cards to blog.html
  if (newPosts.length > 0) {
    let blogHTML = fs.readFileSync(path.join(__dirname, 'blog.html'), 'utf8');
    const insertMarker = '<!-- AUTO-POSTS-START -->';

    if (!blogHTML.includes(insertMarker)) {
      console.warn('blog.html is missing the <!-- AUTO-POSTS-START --> marker. Skipping blog update.');
    } else {
      const newCards = newPosts
        .reverse() // chronological order, newest first
        .map(p => generateBlogCard(p.activity, p.filename, p.dateInfo, p.endMile))
        .join('\n');
      blogHTML = blogHTML.replace(insertMarker, insertMarker + '\n' + newCards);
      fs.writeFileSync(path.join(__dirname, 'blog.html'), blogHTML, 'utf8');
      console.log(`Added ${newPosts.length} new post card(s) to blog.html`);
    }
  }

  console.log('Sync complete.');
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
