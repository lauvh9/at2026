# Strava Integration Setup

This guide walks you through connecting your Strava account so the site
auto-updates every night from your activities.

---

## Step 1 — Create a Strava API Application

1. Go to https://www.strava.com/settings/api
2. Fill in:
   - **Application Name:** Laura on Trail (or anything)
   - **Category:** Other
   - **Website:** your site's URL (or `http://localhost` for now)
   - **Authorization Callback Domain:** `localhost`
3. Click **Create** and note your **Client ID** and **Client Secret**

---

## Step 2 — Get Your Refresh Token (one-time browser flow)

Strava uses OAuth, so you need to authorize once to get a long-lived refresh token.

### 2a. Open this URL in your browser
Replace `YOUR_CLIENT_ID` with your actual Client ID:

```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&scope=activity:read_all&approval_prompt=force
```

### 2b. Authorize the app
Click **Authorize** on the Strava page.

### 2c. Grab the code from the redirect URL
Your browser will try to open something like:
```
http://localhost/?state=&code=XXXXXXXXXXXXXXXX&scope=read,activity:read_all
```
Copy the value of `code=` from the URL. (The page will fail to load — that's fine.)

### 2d. Exchange the code for a refresh token
Run this in your terminal (replace the three placeholders):

```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=YOUR_CODE_FROM_STEP_2C \
  -d grant_type=authorization_code
```

The response JSON will contain a `refresh_token` field. Copy it — you'll only
need to do this once. The refresh token doesn't expire.

---

## Step 3 — Add Secrets to GitHub

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add all three:

| Secret name            | Value                          |
|------------------------|--------------------------------|
| `STRAVA_CLIENT_ID`     | The number from Step 1         |
| `STRAVA_CLIENT_SECRET` | The string from Step 1         |
| `STRAVA_REFRESH_TOKEN` | The token from Step 2d         |

---

## Step 4 — Add the marker to blog.html

Open `blog.html` and add this HTML comment **at the top of your posts list**,
just inside the `#posts-list` div:

```html
<div id="posts-list">

  <!-- AUTO-POSTS-START -->

  <!-- your existing sample post below -->
  <a href="post.html" class="post-full-card fade-up"> ...
```

The sync script looks for this marker and inserts new post cards above it.

---

## Step 5 — Create the data folder

Create an empty file at `data/trail-status.json` with this content:

```json
{
  "miles_hiked": 0,
  "last_updated": null
}
```

And an empty `data/seen-activities.json`:

```json
{ "ids": [] }
```

Commit and push both files.

---

## Step 6 — Test it manually

In GitHub, go to **Actions** → **Strava Trail Sync** → **Run workflow**.
Watch the logs. If it works, you'll see new files committed automatically.

---

## How to use it on trail

When you finish a day's hike and log on Strava, just include somewhere in
your activity description:

```
End mile: 342
```

The sync will run overnight and update your site automatically.
The rest of your caption becomes the blog post body. Photos attached to the
Strava activity will appear in the post.

**Tips:**
- Write your caption like you'd write a journal entry — it becomes the post
- You can use double line breaks for paragraphs
- The "End mile: 342" line is stripped from the post automatically
- If you log multiple activities in one day, the highest mile number wins

---

## File structure after setup

```
your-repo/
├── .github/
│   └── workflows/
│       └── strava-sync.yml   ← runs nightly
├── data/
│   ├── trail-status.json     ← miles_hiked lives here
│   └── seen-activities.json  ← tracks which posts were already made
├── posts/
│   └── 2026-05-01-day-3-smoky-mountain-views.html  ← auto-generated
├── strava-sync.js            ← the sync script
├── index.html                ← reads from data/trail-status.json
└── blog.html                 ← gets new cards prepended automatically
```
