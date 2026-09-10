# Poised Automation landing page

A single page, scroll driven site for **Poised Automation**, a solo AI automation studio
based in Jeju, South Korea.

Plain HTML, CSS and JavaScript. No build step, no framework, no dependencies. The folder
you see is exactly what gets served. Open `index.html` and it works.

**Measured Lighthouse scores** (Chrome, throttled mobile and desktop):

| | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| Mobile | 99 | 100 | 100 | 100 |
| Desktop | 100 | 100 | 100 | 100 |

---

## 1. Getting a clean, free link

You do not need to buy a domain. Three free options, best first.

### Option A. Netlify (recommended): `poisedautomation.netlify.app`

Short, HTTPS, looks fine on a business card, free forever, and it handles the contact form
for you (100 submissions a month on the free tier, emailed to you).

1. Push this repo to GitHub. It already is.
2. Go to [app.netlify.com](https://app.netlify.com), then **Add new site**, then
   **Import an existing project**, then pick this repository.
3. Build command: leave it **empty**. Publish directory: `.` (the `netlify.toml` in this
   repo already says this, so it should fill itself in).
4. Deploy. You get a random name like `curious-fox-a1b2c3.netlify.app`.
5. Go to **Site configuration**, then **Site details**, then **Change site name**, and type
   `poisedautomation`. Your link becomes `https://poisedautomation.netlify.app`.
6. **Forms** in the Netlify sidebar will show a form called `contact` after the first
   deploy. Open **Form notifications** and add your email so submissions reach your inbox.

Every `git push` to `main` redeploys the site automatically.

### Option B. Cloudflare Pages: `poised-automation.pages.dev`

Same idea, also free and very fast. Connect the repo at
[dash.cloudflare.com](https://dash.cloudflare.com), then Workers and Pages, then Create,
then Pages, then Connect to Git. Framework preset: **None**. Build command: empty. Output
directory: `/`. The `_headers` file in this repo is Cloudflare's format, so caching works
straight away. One thing to know: Cloudflare Pages does not host forms, so the contact form
falls back to opening the visitor's mail client. That still works fine.

### Option C. GitHub Pages: `poised69.github.io`

Free and already wired up. The workflow in `.github/workflows/pages.yml` deploys on every
push to `main`. One catch: a project site gives you `poised69.github.io/repo3`, which is
the long ugly link you wanted to avoid. To get the clean root URL, **rename this repository
to `poised69.github.io`** under Settings, then General, then Repository name. Then enable
Pages under Settings, then Pages, and set Source to **GitHub Actions**.

### Later, if you want your own domain

`poisedautomation.com` costs about 10 to 15 dollars a year. Cloudflare Registrar sells at
cost. All three hosts above attach a custom domain for free with automatic HTTPS, so you
would change one setting plus the URLs in section 3 below. Nothing else changes. A
`.netlify.app` address ranks and works perfectly well until then.

---

## 2. Being found in search

The page already ships with a proper title, meta description, Open Graph and Twitter cards,
a `sitemap.xml`, a `robots.txt`, and JSON-LD structured data that tells search engines the
business name, service area, location and services. That is the technical side done. The
rest is manual, and free.

1. **Google Search Console**, at
   [search.google.com/search-console](https://search.google.com/search-console). Add your
   URL as a property, verify it (Netlify and Cloudflare make this a one step HTML file or
   DNS check), then submit `https://your-site/sitemap.xml`. This is what actually gets you
   indexed quickly.
2. **Bing Webmaster Tools**, at [bing.com/webmasters](https://www.bing.com/webmasters). It
   can import everything straight from Search Console. Bing also feeds several AI search
   tools, so it is worth the five minutes.
3. **Google Business Profile**. Free, and the strongest single lever for searches like
   "AI automation Jeju". Register as a service area business so you do not have to publish
   a street address.
4. **Link to it from anywhere you already exist.** LinkedIn, Upwork, your GitHub profile,
   Naver, your email signature. Search engines find new sites through links faster than
   through anything else.

Realistically, "poised automation" is a distinctive phrase, so you should rank first for
your own name within a week or two of submitting the sitemap. Competitive terms like
"AI automation agency" take content and time, not settings.

---

## 3. Changing the site URL

Four places hardcode the public address. Once you know your final URL, search and replace
`https://poisedautomation.netlify.app` across:

- `index.html`, in the canonical link, `og:url`, `og:image`, `twitter:image`, and the
  `url`, `image` and `logo` fields inside the JSON-LD block
- `sitemap.xml`, in the `<loc>` element
- `robots.txt`, in the `Sitemap:` line

```bash
grep -rl "poisedautomation.netlify.app" . | xargs sed -i 's#https://poisedautomation.netlify.app#https://YOUR-URL#g'
```

---

## 4. The contact form

`assets/js/main.js` tries three things in order and stops at the first one that works.

1. **`FORM_ENDPOINT`**, at the top of the file. This is the live path: a Make webhook that
   writes the enquiry to Airtable and emails it on. Details below.
2. **Netlify Forms**, automatic when the site is hosted on Netlify. Kept as a backstop in
   case the webhook is ever unreachable. Note that form detection has to be switched on in
   the Netlify project or this tier does nothing.
3. **A send-destination chooser.** If neither of the above accepts the submission, the
   visitor is offered Gmail, Outlook on the web, their own mail app, or copy to clipboard,
   all pre-filled. This deliberately replaced a bare `mailto:` redirect, which on Windows
   threw people into Outlook whether they used it or not.

A hidden honeypot field called `bot-field` silently drops the most common spam bots.

### The live intake pipeline

```
                                       ┌──▶  Airtable row (Enquiries)
contact form ──POST──▶  Make webhook ──┤
                        (scenario        └──▶  Gmail to info.poisedautomation@gmail.com
                         7285409)
```

| Piece | Where |
|---|---|
| Make scenario | "Poised - Website Enquiry Intake", id `7285409`, team `2185811`, eu1 |
| Make webhook | hook id `3678311` |
| Airtable base | "Poised Automation — Website Enquiries", `appvJfOM2Csxn8MXD` |
| Airtable table | `Enquiries`, `tbl5FdGw85HxAMZqU` |
| Gmail connection | "Info Poised.", id `10556000`, module `google-email:sendAnEmail` v4 |

The scenario answers the browser first, in module 2, before it writes anything. A Webhook
Response module returns `200` and `{"ok":true}` with `Access-Control-Allow-Origin: *`.
Without that header the browser would block the page from reading the reply and the form
would fall through to tier 3 even on a successful save. Answering first also means a slow
Airtable or Gmail call can never make the page think the send failed. The POST is sent
form-urlencoded rather than JSON on purpose: that content type is CORS safelisted, so the
browser skips the preflight `OPTIONS` request entirely.

A router then splits the traffic. A request that carries an email address is saved to
Airtable and emailed on, with the visitor's address set as Reply-To so replying answers
them directly. A request that carries nothing is parked as a single row that records the
HTTP method and headers it arrived with, so junk hits are visible rather than silent, and
they never reach the inbox.

The notification is sent by Make through the info.poisedautomation@gmail.com Gmail
connection. It used to be sent by an Airtable automation, and that never worked once:
Airtable's built-in `sendEmail` can only write to people who collaborate on the base, so
every run failed with `NON_COLLABORATOR_RECIPIENTS` and no notification ever went out. Do
not move the email back into Airtable unless that address is added as a collaborator first.
The retired automation, `wfl5uAlWArOmdanJu`, still exists with a harmless read in place of
its email step. Switch it off in the Airtable UI and it can then be deleted.

Because the mail is sent from info.poisedautomation@gmail.com to the same address, Gmail
files one copy under both Inbox and Sent. That is one email shown in two places, not two
emails. Point the `to` field at another address if you would rather see it only once.

The webhook URL ships in public JavaScript, which is unavoidable for a browser-submitted
form. The scenario only ever appends a row, so the worst a stranger can do is create junk
records and spend Make operations.

---

## 5. Editing the content

Everything is in `index.html`, in reading order, with each section clearly commented.

| Section | Anchor | What lives there |
|---|---|---|
| Navigation | | Logo, links, CTA |
| Hero | `#hero` | Headline, sub headline, animated pipeline |
| The problem | `#problem` | Short framing of the pain |
| What we do | `#what` | Detect, Think, Act, plus the tool chips |
| How it works | `#process` | Discover, Design, Build, Refine |
| Why it matters | `#why` | Four outcome cards on a dark band |
| About | `#about` | Who is behind it, at a glance panel |
| Contact | `#contact` | Form and mailto |
| Footer | | Mark, email, location |

Colours, spacing and type live as CSS custom properties at the top of
`assets/css/styles.css`. Change `--sky`, `--accent` and the rest in one place and the whole
page follows.

### Regenerating the social share image

`assets/img/og.jpg` is 1200 by 630 and was produced by rendering an HTML page with headless
Chrome. To change it, edit that markup and re-render, or just replace the file with any
1200 by 630 image of your own.

---

## 6. What is animated, and how it behaves

- **Logo.** A small flowing curve that draws itself in on load with an SVG
  `stroke-dashoffset` animation, with a coral dot resting at the end of the line. Hover the
  logo and the dot glides along the curve.
- **Hero background.** A canvas of slow drifting light and soft colour clouds, capped at
  about 30fps. It starts only after the page has finished loading, pauses when the hero
  scrolls out of view or the tab is hidden, and thins out on small screens.
- **Pipeline diagrams.** Packets travel real SVG paths using CSS `offset-path`, once in the
  hero and again in the What we do section.
- **Scroll reveals.** Sections fade and rise 18px as they enter the viewport, with child
  elements staggered about 90ms apart.
- **Cursor parallax.** The background shifts a few pixels toward the pointer. Pointer
  devices only.

Every one of these respects `prefers-reduced-motion`. With that setting on, the canvas is
removed, transitions collapse, and the pipeline packets park at fixed points along their
paths so the diagrams still read as diagrams.

---

## 7. Local preview

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works. Opening `index.html` straight from disk works too, though the
`site.webmanifest` will not load over `file://`.

---

## Files

```
index.html                  the whole page
404.html                    not found page
assets/css/styles.css       design tokens, layout, animation, @font-face
assets/js/main.js           nav, reveals, canvas, form
assets/fonts/               Space Grotesk and Inter, latin subsets (OFL 1.1)
assets/img/                 favicon, app icons, og.jpg
netlify.toml / _headers     hosting config for Netlify and Cloudflare Pages
.github/workflows/pages.yml GitHub Pages deploy
robots.txt, sitemap.xml, site.webmanifest
```

Fonts are self hosted under the SIL Open Font License 1.1, see `assets/fonts/OFL.txt`, so
the page makes no third party requests at all.
