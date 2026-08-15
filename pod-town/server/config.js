/**
 * Configuration. Everything sensitive comes from `.env`, which is gitignored.
 * Nothing secret is ever written to disk, logged, or sent to the browser.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

/** Minimal .env parser - avoids taking a dependency just to read six values. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes if present.
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvFile(join(projectRoot, '.env'));
// Real environment variables win over the file, so one-off overrides work.
const env = { ...fileEnv, ...process.env };

function num(key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(key, fallback = '') {
  const raw = env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

export const config = {
  projectRoot,

  make: {
    token: str('MAKE_API_TOKEN'),
    base: str('MAKE_API_BASE', 'https://eu1.make.com/api/v2').replace(/\/+$/, ''),
    pollBbwMs: num('MAKE_POLL_BBW_MS', 4000),
    pollScenarioMs: num('MAKE_POLL_SCENARIO_MS', 8000),
    /**
     * Make's documented API rate limit for this account's Core plan is 60
     * requests/minute. We self-limit below that and never burst past it.
     */
    rateLimitPerMinute: 60,
    rateLimitSafetyMargin: 8,
  },

  telegram: {
    token: str('TELEGRAM_BOT_TOKEN'),
    username: str('TELEGRAM_BOT_USERNAME'),
    chatId: str('TELEGRAM_CHAT_ID', '8268657606'),
    pollMs: num('TELEGRAM_POLL_MS', 2000),
  },

  server: {
    port: num('PORT', 4173),
    // Bind to loopback so the town is reachable only from this machine.
    host: str('HOST', '127.0.0.1'),
  },
};

export const hasMake = () => Boolean(config.make.token);
export const hasTelegram = () => Boolean(config.telegram.token);

/** Redact anything token-shaped before it can reach a log line. */
export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const secret of [config.make.token, config.telegram.token]) {
    if (secret && secret.length >= 8) out = out.split(secret).join('<redacted>');
  }
  // Belt and braces: mask bot-token and UUID shapes even if they are not ours.
  out = out.replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '<redacted>');
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<redacted-uuid>');
  return out;
}
