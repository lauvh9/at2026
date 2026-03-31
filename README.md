# 2,198 Miles North — AT Thru-Hike Site

## Files

```
index.html        → Homepage with progress tracker + map
blog.html         → Trail log listing page
post.html         → Sample Day 1 post
gear.html         → Full gear list
resources.html    → Apps, tools, and trail wisdom
style.css         → Shared styles (all pages)
```

## How to update while on trail

### Add a blog post
1. Duplicate `post.html` → name it e.g. `day-02.html`
2. Edit: title, date, stats (miles, elevation, state), and the article body
3. Add a link to it in `blog.html` inside the `#posts-list` div

### Update your progress tracker
Open `index.html` and change this one line near the bottom:
```js
const MILES_HIKED = 0;   // ← update to current miles
```
The progress bar, remaining miles, and days counter all auto-calculate.

### Update your location
In `index.html`, find this block and update it:
```html
<div class="loc-name">Springer Mountain, GA</div>
<div class="loc-meta">Mile 0 · Start of the journey · Apr 28, 2026</div>
```
Also update the `Day X` badge next to it.

### Update state progress
In `index.html`, change completed states from `state-pip` to `state-pip done`,
and your current state to `state-pip current`:
```html
<span class="state-pip done">GA</span>   <!-- completed -->
<span class="state-pip current">NC</span> <!-- where you are -->
<span class="state-pip">TN</span>         <!-- ahead -->
```

---

## Deploy for free (5 minutes)

### Option A: GitHub Pages
1. Create a free GitHub account at github.com
2. New repository → name it `your-username.github.io` (or anything)
3. Upload all these files
4. Go to Settings → Pages → Source: main branch
5. Your site is live at `https://your-username.github.io`

### Option B: Netlify (easiest)
1. Go to netlify.com → sign up free
2. Drag and drop this entire folder onto their deploy page
3. Get a live URL instantly (can set custom domain later)

### Option C: Custom domain
After deploying to either platform, you can point a domain like
`georgia-to-maine.com` (~$12/yr on Namecheap or Google Domains) to your site.

---

## Updating from trail (phone-friendly options)

**GitHub mobile app** — edit files directly from your phone.
**Netlify CMS** — add a CMS layer so you can post from any browser.
**Working Copy (iOS)** — Git client for iPhone, drag files to update.

The simplest approach: write posts in the Notes app or Google Docs, 
then paste into a duplicate of `post.html` when you have WiFi in town.
