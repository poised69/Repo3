/**
 * POD Town - local server.
 *
 * Serves the town to a browser tab and pushes live state over Server-Sent
 * Events. Binds to loopback only; nothing is exposed to the network and no
 * inbound webhook is ever registered.
 *
 * Zero npm dependencies on purpose: node's stdlib http server plus SSE covers
 * everything here, so there is no install step and no supply chain to trust.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { config, hasMake, hasTelegram } from './config.js';
import { TownState } from './state.js';
import { MakePoller } from './makePoller.js';
import { TelegramPoller } from './telegramPoller.js';
import { startDemo } from './demo.js';
import { log } from './log.js';

const DEMO = process.env.POD_TOWN_DEMO === '1';

const PUBLIC_DIR = join(config.projectRoot, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const state = new TownState();
const makePoller = new MakePoller(state);
const telegramPoller = new TelegramPoller(state);

/** Connected SSE clients. */
const clients = new Set();
let lastPayload = '';

function broadcast() {
  const snapshot = state.snapshot();
  const payload = JSON.stringify(snapshot);
  // Only push when something actually changed, so an idle town is silent.
  if (payload === lastPayload) return;
  lastPayload = payload;

  const frame = `data: ${payload}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

async function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? '/index.html' : urlPath;
  // Contain path traversal: resolve, then confirm we stayed inside PUBLIC_DIR.
  const target = normalize(join(PUBLIC_DIR, relative));
  if (!target.startsWith(PUBLIC_DIR) || !existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const body = await readFile(target);
  res.writeHead(200, {
    'Content-Type': MIME[extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(state.snapshot()));
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(state.snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  try {
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    log.error(`Request failed: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

// Recompute twice a second. This is what advances the timed Print & Fulfillment
// -> Etsy Storefront phase change and expires stale button presses; the pollers
// themselves run on their own, much slower, schedules.
const ticker = setInterval(broadcast, 500);

// SSE keepalive so proxies/browsers do not drop an idle connection.
const keepalive = setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 15_000);

server.listen(config.server.port, config.server.host, () => {
  log.info('');
  log.info(`  POD Town is up:  http://${config.server.host}:${config.server.port}`);
  log.info('');
  log.info(`  Make detection:      ${hasMake() ? 'on' : 'OFF (no MAKE_API_TOKEN)'}`);
  log.info(`  Telegram detection:  ${hasTelegram() ? 'starting...' : 'OFF (no TELEGRAM_BOT_TOKEN)'}`);
  log.info('');
  log.info('  This app only ever reads. It consumes zero Make operations.');
  log.info('');

  if (DEMO) {
    // Synthetic activity only - the real pollers stay off so nothing can be
    // mistaken for live state.
    startDemo(state);
    return;
  }

  makePoller.start();
  telegramPoller.start().catch((err) => log.error(`Telegram startup failed: ${err.message}`));
});

function shutdown() {
  log.info('Shutting down.');
  clearInterval(ticker);
  clearInterval(keepalive);
  makePoller.stop();
  telegramPoller.stop();
  for (const res of clients) {
    try {
      res.end();
    } catch {
      /* already gone */
    }
  }
  server.close(() => process.exit(0));
  // Do not hang forever if a socket refuses to close.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
