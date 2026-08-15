/**
 * Reads BBW button presses from the Telegram Bot API.
 *
 * This never touches Make, so it is unaffected by Make's rate limit and costs
 * no operations.
 *
 * ############################################################################
 * # SAFETY: this module must never call setWebhook or deleteWebhook.         #
 * #                                                                          #
 * # BBW is driven by a Telegram webhook (telegram:WatchUpdates, hook 3524270). #
 * # Deleting or replacing that webhook would silently break the entire live   #
 * # pipeline - every button in Telegram would stop working. We therefore only #
 * # ever issue read-only calls: getMe, getWebhookInfo, getUpdates.            #
 * ############################################################################
 *
 * THE CONFLICT, AND HOW WE HANDLE IT
 * Telegram allows either a webhook or getUpdates long-polling for a bot, never
 * both. Because BBW's webhook is registered, getUpdates is expected to fail
 * with HTTP 409 Conflict. We detect that at startup and degrade honestly rather
 * than fighting it:
 *
 *   mode 'polling'  - no webhook registered, getUpdates works. Full detection.
 *   mode 'blocked'  - a webhook is registered and getUpdates 409s. We stop
 *                     polling and fall back to Make-only detection: BBW shows
 *                     as running, without a specific route.
 *   mode 'shim'     - TELEGRAM_SHIM_FILE is set; we tail a local JSON-lines
 *                     file that something else appends callback data to. This
 *                     is the escape hatch when 'blocked' applies and you still
 *                     want per-route animation. See README.
 *   mode 'off'      - no token configured.
 */
import { existsSync, statSync, createReadStream } from 'node:fs';
import { config } from './config.js';
import { log } from './log.js';

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

export class TelegramPoller {
  constructor(state) {
    this.state = state;
    this.offset = 0;
    this.timer = null;
    this.stopped = false;
    this.mode = 'off';
    this.shimFile = process.env.TELEGRAM_SHIM_FILE || '';
    this.shimOffset = 0;
  }

  async start() {
    if (!config.telegram.token) {
      this.state.setSource('telegram', {
        enabled: false,
        ok: false,
        mode: 'off',
        detail: 'TELEGRAM_BOT_TOKEN not set - BBW routes cannot be identified',
      });
      log.warn('Telegram: no bot token configured. BBW will show as "running" without a route.');
      return;
    }

    this.state.setSource('telegram', { enabled: true, ok: false, mode: 'starting', detail: 'connecting' });

    const me = await this.#call('getMe').catch((err) => ({ ok: false, error: err.message }));
    if (!me?.ok) {
      this.state.setSource('telegram', {
        enabled: true,
        ok: false,
        mode: 'error',
        detail: `Telegram rejected the token: ${me?.error || me?.description || 'unknown error'}`,
      });
      log.error('Telegram: getMe failed - check TELEGRAM_BOT_TOKEN.');
      return;
    }

    const username = me.result?.username || config.telegram.username || null;
    log.info(`Telegram: authenticated as @${username}`);

    // Is a webhook registered? (read-only - we never change it)
    const hook = await this.#call('getWebhookInfo').catch(() => null);
    const hookUrl = hook?.result?.url || '';

    if (this.shimFile) {
      this.mode = 'shim';
      this.state.setSource('telegram', {
        enabled: true,
        ok: true,
        mode: 'shim',
        username,
        detail: `reading callbacks from ${this.shimFile}`,
      });
      log.info(`Telegram: shim mode, tailing ${this.shimFile}`);
      this.#scheduleShim();
      return;
    }

    if (hookUrl) {
      log.warn(`Telegram: a webhook is registered (${new URL(hookUrl).host}) - this is BBW's, leaving it alone.`);
      // Probe getUpdates exactly once to see whether it really conflicts.
      const probe = await this.#call('getUpdates', { limit: 1, timeout: 0 }).catch((err) => ({
        ok: false,
        error: err.message,
        status: err.status,
      }));

      if (!probe?.ok) {
        this.mode = 'blocked';
        this.state.setSource('telegram', {
          enabled: true,
          ok: false,
          mode: 'blocked',
          username,
          detail:
            'A webhook is active for this bot, so getUpdates is refused (409). ' +
            'Falling back to Make-only detection. See README for the shim option.',
        });
        log.warn('Telegram: getUpdates conflicts with the live webhook. Per-route detection is unavailable.');
        return;
      }
      log.warn('Telegram: a webhook is set but getUpdates was accepted - polling anyway.');
    }

    this.mode = 'polling';
    this.state.setSource('telegram', {
      enabled: true,
      ok: true,
      mode: 'polling',
      username,
      detail: 'watching for button presses',
    });
    this.#schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  #schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.#pollOnce(), config.telegram.pollMs);
  }

  async #pollOnce() {
    if (this.stopped) return;
    try {
      const res = await this.#call('getUpdates', {
        offset: this.offset || undefined,
        timeout: 0,
        allowed_updates: ['callback_query'],
      });

      if (res?.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          this.#handleUpdate(update);
        }
        this.state.setSource('telegram', { ok: true, detail: 'watching for button presses' });
      }
    } catch (err) {
      if (err.status === 409) {
        this.mode = 'blocked';
        this.state.setSource('telegram', {
          ok: false,
          mode: 'blocked',
          detail: 'getUpdates now conflicts with an active webhook - per-route detection stopped.',
        });
        log.warn('Telegram: 409 conflict mid-run. Stopping polling to stay out of BBW\'s way.');
        return; // do not reschedule
      }
      this.state.setSource('telegram', { ok: false, detail: `Telegram error: ${err.message}` });
    }
    this.#schedule();
  }

  #handleUpdate(update) {
    const cq = update.callback_query;
    if (!cq) return;

    // Ignore presses from other chats so a second user of the same bot cannot
    // drive this town.
    const chatId = String(cq.message?.chat?.id ?? '');
    if (config.telegram.chatId && chatId && chatId !== String(config.telegram.chatId)) return;

    const entry = this.state.noteCallback({
      updateId: update.update_id,
      data: cq.data,
      // Arrival time, not cq.message.date: that field is the bot's prompt
      // message, which is often minutes older than the tap itself.
      at: Date.now(),
    });
    if (entry) log.info(`Telegram: "${cq.data}" -> ${entry.building}`);
  }

  // ---- shim mode ---------------------------------------------------------

  #scheduleShim() {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.#readShim(), config.telegram.pollMs);
  }

  /**
   * Reads newly appended lines from a local JSON-lines file. Each line should
   * be an object with at least a `data` field holding the callback value, e.g.
   *   {"data":"generate_images","at":1786757259723}
   */
  async #readShim() {
    try {
      if (existsSync(this.shimFile)) {
        const size = statSync(this.shimFile).size;
        if (size < this.shimOffset) this.shimOffset = 0; // file was truncated
        if (size > this.shimOffset) {
          const chunk = await readRange(this.shimFile, this.shimOffset, size - 1);
          this.shimOffset = size;
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              const data = parsed.data || parsed.callback_query?.data;
              if (!data) continue;
              const entry = this.state.noteCallback({
                updateId: parsed.update_id ?? `shim:${this.shimOffset}:${data}`,
                data,
                at: Date.now(),
              });
              if (entry) log.info(`Shim: "${data}" -> ${entry.building}`);
            } catch {
              /* ignore malformed lines */
            }
          }
        }
      }
      this.state.setSource('telegram', { ok: true, detail: `tailing ${this.shimFile}` });
    } catch (err) {
      this.state.setSource('telegram', { ok: false, detail: `shim read failed: ${err.message}` });
    }
    this.#scheduleShim();
  }

  async #call(method, params) {
    const url = new URL(API(config.telegram.token, method));
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      let description = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.description) description = body.description;
      } catch {
        /* keep the status-only message */
      }
      const err = new Error(description);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

function readRange(path, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    createReadStream(path, { start, end, encoding: 'utf8' })
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(chunks.join('')))
      .on('error', reject);
  });
}
