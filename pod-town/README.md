# POD Town

A little pixel-art town that shows what the POD automation pipeline is doing
right now. Ten buildings, one per stage. When part of the real pipeline runs, a
character walks over and works at the matching building. When nothing is
running, the town idles.

It runs on `localhost`, reads only, and consumes **zero Make operations**.

---

## 1. Read this first: rotate the Make token

Scenario **6868468** ("POD - Operational Health & Weekly Digest") has a live
Make API bearer token **hardcoded in plaintext** in HTTP modules **6, 7 and 8** —
typed straight into the `Authorization` header instead of going through a Make
connection. Confirmed again on 2026-08-15 while building this.

Anyone who can read that scenario's blueprint can read the token.

Before pointing this app at Make:

1. Make → **Profile → API** → revoke the exposed token and create a new one.
2. Update modules 6, 7 and 8 in scenario 6868468 to use the new value.
3. Create a **separate read-only token** for this app (it only needs
   `scenarios:read`) and put that one in `.env`.

This app never needs write access. If Make's token UI offers scope selection,
give it read scopes only.

---

## 2. Setup

Requires Node 18+ (`node -v`). There are **no npm dependencies** — nothing to
install.

```bash
cd pod-town
cp .env.example .env      # then fill it in
npm run doctor            # preflight: checks both detection paths
npm start                 # http://127.0.0.1:4173
```

`.env` is gitignored. Never commit it, and never paste the bot token into a
chat, issue, or commit message.

Want to see it working without waiting for a real run:

```bash
POD_TOWN_DEMO=1 npm start   # synthetic activity, clearly labelled "DEMO DATA"
```

---

## 3. How detection works

Two independent read-only feeds. Neither one is enough on its own for BBW:
Make knows *that* BBW is running but not which of its 12 routes; Telegram knows
*which* button was tapped but not when the run ends. Together they give both.

### Make — which executions are in flight

`GET /api/v2/scenarios/{id}/executions` reads execution history. This is not the
metered "run a scenario" path, so it costs no operations. It is subject to the
API rate limit, which on this Core plan is **60 requests/minute**.

**A live "RUNNING" signal does exist.** This was the biggest open question going
in, and it was settled empirically on 2026-08-15 rather than assumed:

- A run in flight appears as an entry with **`eventType: "EXECUTION_START"`**,
  carrying no `duration` and no `status`.
- When it finishes, that entry is replaced by an `EXECUTION_END` entry that does
  have `status` and `duration`.
- So: *an `EXECUTION_START` present means it is running now.*

Two further findings from the same testing, both of which the code relies on:

- **`timestamp` is the START time, not the end.** Verified by triggering a run
  at a known wall-clock time and comparing: the run was queued at
  `01:26:40.744Z` and recorded `timestamp: 01:26:41.267Z` with `duration:
  1149ms`. If `timestamp` were the end, the start would predate the trigger.
  A run's end is therefore `timestamp + duration`.
- **A run consuming zero operations never gets an `EXECUTION_END` at all** — its
  `EXECUTION_START` simply disappears. Treating "no `EXECUTION_START`" as "not
  running" handles this correctly, which is what the poller does.

An earlier history-only pull showed nothing but `EXECUTION_END` events, which is
what raised the doubt. That was just because nothing happened to be running at
the time.

### Telegram — which BBW route fired

Every BBW route is gated on a distinct inline-keyboard `callback_query.data`
value, so the button press identifies the building.

**Expect `getUpdates` to be blocked.** Telegram allows a webhook *or*
`getUpdates` per bot, never both, and BBW is driven by a webhook
(`telegram:WatchUpdates`, hook 3524270). `getUpdates` will most likely return
**409 Conflict**. `npm run doctor` tests this against the real bot and tells you
which case you are in.

The app detects this at startup and degrades honestly. It has four modes:

| Mode | When | Behaviour |
|---|---|---|
| `polling` | no webhook registered | full per-route detection |
| `blocked` | webhook registered, `getUpdates` 409s | Make-only: BBW shows as running, route unknown |
| `shim` | `TELEGRAM_SHIM_FILE` is set | reads callbacks from a local file |
| `off` | no token | the three scheduled scenarios still animate |

> **The app never calls `setWebhook` or `deleteWebhook`.** Deleting BBW's
> webhook would make `getUpdates` work — and would silently break every button
> in the live pipeline. Don't do it, and note that the code is written so it
> cannot happen by accident.

**Shim mode** is the escape hatch if you want per-route animation while the
webhook stays live. Point `TELEGRAM_SHIM_FILE` at a JSON-lines file that
something else appends each callback to, one object per line:

```json
{"data":"generate_images"}
```

This does require a forwarding step in front of BBW's webhook, which is a change
to live infrastructure — so it is opt-in and off by default.

---

## 4. Building → pipeline mapping

Every value below was read from the live blueprints via the Make API on
2026-08-15, not inferred from route names or ordering.

### The three 1:1 scenarios

| Building | Scenario | ID | Schedule |
|---|---|---|---|
| Market Research | POD - Niche Data Refresh (weekly) | `6945454` | Mon 08:00 Asia/Seoul |
| Listing Check Booth | POD - Etsy Live Listing Verifier | `6889547` | on-demand |
| Ops Control Tower | POD - Operational Health & Weekly Digest | `6868468` | Sun 19:00 Asia/Seoul |

### BBW (`6783491`) — router module 6, 12 routes

| `callback_query.data` | Entry module | Building |
|---|---|---|
| `generate_batch` | 7 | Ideation Lab |
| `score_niches` | 100 | Scoring Office |
| *(no filter — inert stub)* | 8 | **none** |
| `generate_brief` | 500 | Design Studio |
| `generate_images` | 560 | Image Foundry |
| `review_proceed` | 610 | Print & Fulfillment → Etsy Storefront |
| `review_change` | 640 | Review House |
| `review_polish` | 620 | Review House |
| `review_reevaluate` | 630 | Review House |
| `polish_bigger_text` | 701 | Review House |
| `polish_color` | 704 | Review House |
| `polish_simplify` | 707 | Review House |

Route 2 is an emptied `placeholder:Placeholder` stub with no filter. It is
deliberately mapped to nothing; an unrecognised callback lights no building and
is surfaced as a note in the UI instead.

### The Print & Fulfillment → Etsy Storefront split

`review_proceed` is **one continuous execution** (~4–5 min) covering both
buildings. Make exposes execution-level state only — there is no per-module live
detail — so the cutover between the two is a **heuristic**. It is not a guess,
though: it is derived from the actual sleeps in the blueprint.

```
610/611/605/815  confirm + load config        ~1-2s
850              LLM writes the Etsy copy     ~10-20s
810              Printify createAProduct      ~2-5s
811              util:FunctionSleep           90s    <- "Wait for Mockups"
812/813          get mockups, publish         ~2-5s
---------------------------------------------------- ~115s, Printify side done
828              util:FunctionSleep           60s    <- "Wait for Etsy sync"
829..863         read Etsy listing id (up to two more 60s retries)
832..848         compliance fields, listing state, logging
```

So Print & Fulfillment holds for the first ~115s (`PRINT_PHASE_MS` in
`server/buildings.js`), then Etsy Storefront takes over. The **end** is not
guessed — it comes from Make's real `EXECUTION_END`, so the animation stops when
the run actually stops.

---

## 5. Cost and rate limits

- **Make operations consumed: zero.** Only the executions endpoint is read, and
  only ever with GET.
- **Make API requests:** BBW every 4s, the other three every 8s ≈ **38 req/min**
  against a 60/min limit. A sliding-window limiter enforces the ceiling, requests
  are staggered rather than bursted, and a 429 backs off for 60s.
- **Telegram:** does not touch Make at all.

To confirm the zero-operations claim yourself: note the operations figure in
Make (`organizations_get`, org `8429990`), leave the app running for an hour,
and check it again.

---

## 6. Verifying the mapping end to end

The practical check that all ten buildings are wired correctly: tap each BBW
button once and trigger or wait for each of the three scenarios. Each should
light its building within about 5–10 seconds.

Note that `generate_images` costs real money ($0.04–$0.20 per tap, Ideogram), so
that is the one to test deliberately rather than casually.

Run `node --test` for the logic tests — they run against real captured API
payloads, including a genuine in-flight `EXECUTION_START`.

---

## 7. Layout

```
pod-town/
├── server/
│   ├── index.js          HTTP server + SSE, binds to 127.0.0.1 only
│   ├── config.js         .env loading, secret redaction
│   ├── buildings.js      the verified mapping - the source of truth
│   ├── state.js          in-memory activity state, Make/Telegram correlation
│   ├── makePoller.js     execution polling + rate limiter
│   ├── telegramPoller.js getUpdates / shim, with webhook-safety guards
│   ├── demo.js           synthetic activity for previewing
│   └── doctor.js         preflight checks
├── public/               canvas renderer (no assets, drawn procedurally)
└── test/                 node --test
```

State is in-memory only. Restarting resets the town to idle; it repopulates on
the next poll.

## 8. Troubleshooting

**Everything is idle and nothing ever lights up.** Run `npm run doctor`. Most
likely the Make token is missing or rejected.

**Buildings never light for BBW buttons.** Expected if Telegram is in `blocked`
mode — see §3. The panel shows the mode.

**"Token rejected (401/403)".** The token is wrong, revoked, or lacks
`scenarios:read`. The poller backs off for 60s rather than hammering.

**A button lights nothing and a note appears.** A callback value exists in BBW
that is not in the mapping — most likely a button added after 2026-08-15.
Add it to `CALLBACK_TO_BUILDING` in `server/buildings.js`.
