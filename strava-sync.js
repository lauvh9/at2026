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
const SYNC_START_DATE = new Date('2026-04-20'); // No activities before this date
const HIKE_START_DATE = new Date('2026-04-28'); // Actual hike start — for total distance

const STATUS_FILE      = path.join(__dirname, 'data', 'trail-status.json');
const ACTIVITIES_FILE  = path.join(__dirname, 'data', 'strava-activities.json');
const GALLERY_FILE     = path.join(__dirname, 'data', 'gallery.json');

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

// ─── FETCH ALTITUDE STREAM ────────────────────────────────────────────────
// Returns elevation values in metres only — no lat/lng, no location data.
async function fetchAltitudeStream(token, activityId) {
  try {
    const data = await fetchJSON(
      `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=altitude&key_by_type=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const raw = (data.altitude && data.altitude.data) ? data.altitude.data : [];
    // Downsample to max 300 points — enough for a precise profile, small enough to store
    if (raw.length <= 300) return raw;
    const step = (raw.length - 1) / 299;
    return Array.from({ length: 300 }, (_, i) => raw[Math.round(i * step)]);
  } catch (e) {
    console.warn(`Could not fetch altitude stream for ${activityId}:`, e.message);
    return [];
  }
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

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('Missing required environment variables. See STRAVA-SETUP.md.');
    process.exit(1);
  }

  ensureDir(path.join(__dirname, 'data'));

  const token      = await refreshAccessToken();
  const activities = await fetchRecentActivities(token, 10);

  if (!activities.length) {
    console.log('No activities found.');
    return;
  }

  // Find the most recent activity that has an end mile marker
  let latestMile   = null;
  let latestStatus = loadJSON(STATUS_FILE, {});

  // Collect full activity data for all activities in range
  const fullActivities = [];
  for (const activity of activities) {
    if (new Date(activity.start_date) < SYNC_START_DATE) continue;
    const fullActivity = await fetchActivity(token, activity.id);
    const endMile      = parseMile(fullActivity.description);

    // Track the highest end mile seen (most progress)
    if (endMile !== null && (latestMile === null || endMile > latestMile)) {
      latestMile = endMile;
    }

    fullActivities.push({ activity, fullActivity });
    console.log(`Activity: "${fullActivity.name}" (${formatDate(fullActivity.start_date_local).iso})`);
  }

  // Total distance walked since hike start (all activities from Apr 28 onward)
  const totalDistanceMeters = fullActivities
    .filter(({ fullActivity: f }) => new Date(f.start_date) >= HIKE_START_DATE)
    .reduce((sum, { fullActivity: f }) => sum + (f.distance || 0), 0);
  const totalDistanceMiles = parseFloat((totalDistanceMeters / 1609.34).toFixed(1));

  // Current hiking day — derived from the most recent hiking activity's date
  const latestHikingActivity = fullActivities.find(({ fullActivity: f }) =>
    new Date(f.start_date) >= HIKE_START_DATE && parseMile(f.description) !== null
  );
  let currentDay = latestStatus.current_day || null;
  if (latestHikingActivity) {
    const actDate = new Date(latestHikingActivity.fullActivity.start_date_local || latestHikingActivity.fullActivity.start_date);
    currentDay = Math.floor((actDate - HIKE_START_DATE) / (1000 * 60 * 60 * 24)) + 1;
  }

  // Write trail status JSON (read by index.html)
  if (latestMile !== null || totalDistanceMiles > 0) {
    const updated = {
      ...latestStatus,
      ...(latestMile !== null ? { miles_hiked: latestMile } : {}),
      total_distance_miles: totalDistanceMiles,
      ...(currentDay !== null ? { current_day: currentDay } : {}),
      last_updated: new Date().toISOString(),
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    console.log(`Updated trail-status.json → miles_hiked: ${latestMile}, total_distance_miles: ${totalDistanceMiles}, current_day: ${currentDay}`);
  } else {
    console.log('No mile data found; trail-status.json unchanged.');
  }

  // Write strava-activities.json for the Strava Log page
  const stravaActivitiesData = [];
  for (const { activity, fullActivity: full } of fullActivities) {
    const [photos, altitude_stream] = await Promise.all([
      fetchPhotos(token, activity.id).catch(() => []),
      fetchAltitudeStream(token, activity.id),
    ]);
    const end_mile = parseMile(full.description);
    stravaActivitiesData.push({
      id:                   full.id,
      name:                 full.name,
      description:          full.description || '',
      start_date:           full.start_date,
      start_date_local:     full.start_date_local,
      distance:             full.distance,
      moving_time:          full.moving_time,
      elapsed_time:         full.elapsed_time,
      total_elevation_gain: full.total_elevation_gain,
      end_mile,
      altitude_stream,
      photos,
    });
  }

  fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(stravaActivitiesData, null, 2), 'utf8');
  console.log(`Wrote strava-activities.json (${stravaActivitiesData.length} activities)`);

  // Update gallery.json with any new Strava photos (deduplicate by URL)
  const gallery     = loadJSON(GALLERY_FILE, []);
  const existingUrls = new Set(gallery.map(e => e.src));
  let addedPhotos   = 0;
  for (const entry of stravaActivitiesData) {
    const date = formatDate(entry.start_date_local);
    for (const photoUrl of (entry.photos || [])) {
      if (!existingUrls.has(photoUrl)) {
        gallery.unshift({
          src:          photoUrl,
          type:         'photo',
          caption:      entry.name,
          date:         date.human,
          source:       'strava',
          activityId:   entry.id,
          activityName: entry.name,
        });
        existingUrls.add(photoUrl);
        addedPhotos++;
      }
    }
  }
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(gallery, null, 2), 'utf8');
  console.log(`Updated gallery.json (+${addedPhotos} Strava photos, ${gallery.length} total)`);

  console.log('Sync complete.');
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
