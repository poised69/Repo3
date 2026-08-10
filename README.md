# Poised Automation — landing page

A single-page, scroll-driven landing site for **Poised Automation**, a solo AI automation
studio based in Jeju, South Korea.

Plain HTML, CSS and JavaScript. No build step, no framework, no dependencies — the folder
you see is exactly what gets served. Open `index.html` and it works.

**Measured Lighthouse scores** (Chrome, throttled mobile / desktop):

| | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| Mobile | 95 | 100 | 100 | 100 |
| Desktop | 100 | 100 | 100 | 100 |

---

## 1. Getting a clean, free link

You don't need to buy a domain. Three free options, best first.

### Option A — Netlify (recommended): `poisedautomation.netlify.app`

Short, HTTPS, looks professional on a business card, free forever, **and it handles the
contact form for you** (100 submissions/month on the free tier, emailed to you).

1. Push this repo to GitHub (it already is).
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing
   project** → pick this repository.
3. Build command: leave **empty**. Publish directory: `.` (a `netlify.toml` in the repo
   already says this, so it should auto-fill).
4. Deploy. You'll get a random name like `curious-fox-a1b2c3.netlify.app`.
5. **Site configuration → Site details → Change site name** → type `poisedautomation`.
   Your link becomes `https://poisedautomation.netlify.app`.
6. **Forms** in the Netlify sidebar will show a form called `contact` after the first
   deploy. Open **Form notifications** and add your email so submissions land in your inbox.

Every `git push` to `main` redeploys automatically.

### Option B — Cloudflare Pages: `poised-automation.pages.dev`

Same idea, also free and very fast. Connect the repo at
[dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Pages →
Connect to Git. Framework preset: **None**. Build command: empty. Output directory: `/`.
The `_headers` file in this repo is Cloudflare's format, so caching works out of the box.
Note: Cloudflare Pages does *not* host forms — the form falls back to opening the
visitor's mail client, which still works fine.

### Option C — GitHub Pages: `poised69.github.io`

Free and already wired up (`.github/workflows/pages.yml` deploys on every push to `main`).
One catch: a *project* site gives you `poised69.github.io/repo3`, which is the long ugly
link you wanted to avoid. To get the clean root URL, **rename this repository to
`poised69.github.io`** (Settings → General → Repository name). Then enable Pages under
Settings → Pages → Source: **GitHub Actions**.

### Later, if you want your own domain

`poisedautomation.com` costs roughly $10–15/year (Cloudflare Registrar sells at cost).
All three hosts above attach a custom domain for free with automatic HTTPS, and you'd
change one setting plus the URLs in §3 below. Nothing else changes. A `.netlify.app`
address ranks and works perfectly well until then.

---

## 2. Being found in search

The page ships with a proper `<title>`, meta description, Open Graph/Twitter cards, a
`sitemap.xml`, a `robots.txt`, and JSON-LD `ProfessionalService` structured data (name,
service area, location, services offered). That's the technical side done. The rest is
manual, and free:

1. **Google Search Console** — [search.google.com/search-console](https://search.google.com/search-console).
   Add your URL as a property, verify (Netlify/Cloudflare make this a one-step HTML-file
   or DNS check), then submit `https://<your-site>/sitemap.xml`. This is what actually
   gets you indexed quickly.
2. **Bing Webmaster Tools** — [bing.com/webmasters](https://www.bing.com/webmasters).
   It can import everything straight from Search Console. Bing also feeds several AI
   search tools, so it's worth the five minutes.
3. **Google Business Profile** — free, and the single strongest lever for "AI automation
   Jeju"-style searches. Register as a *service-area business* so you don't have to
   publish a street address.
4. **Link to it from anywhere you already exist** — LinkedIn, Upwork, GitHub profile,
   Naver, email signature. Search engines find new sites through links faster than
   through anything else.

Realistically: "poised automation" is a distinctive phrase, so you should rank #1 for your
own name within a week or two of submitting the sitemap. Competitive terms like "AI
automation agency" take content and time, not settings.

---

## 3. Changing the site URL

Four places hardcode the public address. When you know your final URL, search and replace
`https://poisedautomation.netlify.app` across:

- `index.html` — `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`, and the
  `url`/`image`/`logo` fields in the JSON-LD block
- `sitemap.xml` — the `<loc>` element
- `robots.txt` — the `Sitemap:` line

```bash
grep -rl "poisedautomation.netlify.app" . | xargs sed -i 's#https://poisedautomation.netlify.app#https://YOUR-URL#g'
```

---

## 4. The contact form

`assets/js/main.js` tries three things, in order, and stops at the first that works:

1. **`FORM_ENDPOINT`** (top of the file, empty by default) — set it to a Formspree URL, a
   Make.com webhook, or any endpoint that accepts a JSON `POST` of `{name, email, task}`.
   A Make.com webhook is the obvious choice here: the enquiry lands straight in a scenario
   that can qualify it, log it to Airtable, and ping you on Telegram.
2. **Netlify Forms** — automatic when hosted on Netlify. Nothing to configure in code.
3. **`mailto:`** — opens the visitor's mail client with the message pre-filled. Always
   works, on any host, with no backend at all.

A hidden honeypot field (`bot-field`) silently drops the most common spam bots.

---

## 5. Editing the content

Everything is in `index.html`, in reading order, with each section clearly commented:

| Section | Anchor | What lives there |
|---|---|---|
| Navigation | — | Logo, links, CTA |
| Hero | `#hero` | Headline, sub-headline, animated pipeline |
| The problem | `#problem` | Short, empathetic framing |
| What we do | `#what` | Detect → Think → Act, plus the tool chips |
| How it works | `#process` | Discover → Design → Build → Refine |
| Why it matters | `#why` | Four outcome cards, dark band |
| About | `#about` | Who's behind it, at-a-glance panel |
| Contact | `#contact` | Form + mailto |
| Footer | — | Mark, email, location |

Colours, spacing and type live as CSS custom properties at the top of
`assets/css/styles.css` — change `--sky`, `--accent`, etc. in one place and the whole page
follows.

### Regenerating the social share image

`assets/img/og.jpg` (1200×630) is a rendered HTML page. To change it, edit the markup and
re-render with headless Chrome, or replace the file with any 1200×630 image of your own.

---

## 6. What's animated, and how it behaves

- **Logo** — the "PA" monogram draws itself in with an SVG `stroke-dashoffset` animation
  on load; a coral dot orbits it slowly, and speeds up on hover.
- **Hero background** — a canvas of slow-drifting light and soft colour clouds, capped at
  ~30fps, that starts only after the page has finished loading, pauses when the hero
  scrolls out of view or the tab is hidden, and thins out on small screens.
- **Pipeline diagrams** — packets travel real SVG paths using CSS `offset-path`, in the
  hero and again in the What-we-do section.
- **Scroll reveals** — sections fade and rise 18px as they enter the viewport, with
  children staggered ~90ms apart.
- **Cursor parallax** — the background shifts a few pixels toward the pointer. Pointer
  devices only.

Every one of these respects `prefers-reduced-motion`. With it enabled, the canvas is
removed entirely, transitions collapse, and the pipeline packets park at fixed points
along their paths so the diagrams still read as diagrams.

---

## 7. Local preview

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works. Opening `index.html` directly from disk works too, though the
`site.webmanifest` won't load over `file://`.

---

## Files

```
index.html                  the whole page
404.html                    not-found page
assets/css/styles.css       design tokens, layout, animation, @font-face
assets/js/main.js           nav, reveals, canvas, form
assets/fonts/               Space Grotesk + Inter, latin subsets (OFL 1.1)
assets/img/                 favicon, app icons, og.jpg
netlify.toml / _headers     hosting config for Netlify / Cloudflare Pages
.github/workflows/pages.yml GitHub Pages deploy
robots.txt, sitemap.xml, site.webmanifest
```

Fonts are self-hosted under the SIL Open Font License 1.1 (see `assets/fonts/OFL.txt`),
so the page makes no third-party requests at all.
