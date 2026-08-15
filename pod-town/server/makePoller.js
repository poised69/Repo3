/**
 * Reads execution state from Make.
 *
 * COST: zero Make operations. The executions endpoint reads execution history;
 * it is not the metered "run a scenario" path. It is subject to Make's API rate
 * limit (60 req/min on this account's Core plan), which the limiter below stays
 * well under. This module only ever issues GETs - it must never create, modify,
 * activate or run anything.
 *
 * HOW LIVE DETECTION WORKS (verified empirically on 2026-08-15):
 *   A run in flight appears in GET /scenarios/{id}/executions as an entry with
 *   `eventType: "EXECUTION_START"`, carrying no `duration` and no `status`.
 *   When the run finishes that entry is replaced by an `EXECUTION_END` entry
 *   that does have `status` and `duration`.
 *
 *   `timestamp` is the execution's START time, not its end - confirmed by
 *   triggering a run at a known wall-clock time and comparing. So a run's end
 *   is `timestamp + duration`.
 *
 *   Caveat found during testing: a run that consumes zero operations (e.g. a
 *   sleep-only scenario) is never written as EXECUTION_END at all - its
 *   EXECUTION_START simply disappears. Treating "no EXECUTION_START present"
 *   as "not running" handles that correctly, which is what we do.
 */
import { config } from './config.js';
import { LINEAR_SCENARIOS, BBW_SCENARIO_ID } from './buildings.js';
import { log } from './log.js';

/** Sliding-window limiter so we can never breach Make's documented 60/min. */
class RateLimiter {
  constructor(perMinute, margin) {
    this.limit = Math.max(1, perMinute - margin);
    this.hits = [];
  }

  tryTake() {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < 60_000);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }

  get used() {
    const now = Date.now();
    return this.hits.filter((t) => now - t < 60_000).length;
  }
}

export class MakePoller {
  constructor(state) {
    this.state = state;
    this.limiter = new RateLimiter(config.make.rateLimitPerMinute, config.make.rateLimitSafetyMargin);
    this.timers = [];
    this.stopped = false;
    this.backoffUntil = 0;
  }

  start() {
    if (!config.make.token) {
      this.state.setSource('make', {
        enabled: false,
        ok: false,
        detail: 'MAKE_API_TOKEN not set - scenario detection is off',
      });
      log.warn('Make: no API token configured. The three scheduled scenarios will not animate.');
      return;
    }

    this.state.setSource('make', { enabled: true, ok: false, detail: 'connecting' });

    const targets = [
      { scenarioId: BBW_SCENARIO_ID, intervalMs: config.make.pollBbwMs, label: 'BBW' },
      ...LINEAR_SCENARIOS.map((s) => ({
        scenarioId: s.scenarioId,
        intervalMs: config.make.pollScenarioMs,
        label: s.name,
      })),
    ];

    // Stagger the first poll of each scenario so requests spread out evenly
    // rather than arriving in a burst every interval.
    targets.forEach((target, index) => {
      const stagger = Math.round((index * 1500) % target.intervalMs);
      const kick = setTimeout(() => {
        this.#pollOnce(target);
        const timer = setInterval(() => this.#pollOnce(target), target.intervalMs);
        this.timers.push(timer);
      }, stagger);
      this.timers.push(kick);
    });
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }

  async #pollOnce(target) {
    if (this.stopped) return;
    if (Date.now() < this.backoffUntil) return;
    if (!this.limiter.tryTake()) {
      this.state.setSource('make', { rateLimited: true });
      return;
    }

    try {
      const entries = await this.#fetchExecutions(target.scenarioId);
      const running = findRunning(entries);
      this.state.setScenarioRunning(target.scenarioId, running);
      this.state.setSource('make', {
        enabled: true,
        ok: true,
        rateLimited: false,
        lastPollAt: Date.now(),
        detail: `${this.limiter.used}/${config.make.rateLimitPerMinute} API requests in the last minute`,
      });
    } catch (err) {
      this.#handleError(err, target);
    }
  }

  async #fetchExecutions(scenarioId) {
    const url = `${config.make.base}/scenarios/${scenarioId}/executions?pg%5Blimit%5D=5&pg%5BsortDir%5D=desc`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Token ${config.make.token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // Keep a snippet of the body: it is how we tell a genuine Make rejection
      // (JSON) from a corporate proxy or VPN refusing the request (HTML/text).
      const snippet = await res
        .text()
        .then((t) => t.slice(0, 200))
        .catch(() => '');
      const err = new Error(`Make API ${res.status}`);
      err.status = res.status;
      err.snippet = snippet;
      err.looksLikeMake = snippet.trimStart().startsWith('{');
      throw err;
    }

    const body = await res.json();
    // The v2 API wraps the list; tolerate a bare array in case that changes.
    return Array.isArray(body) ? body : body.executions || [];
  }

  #handleError(err, target) {
    let detail;
    if (err.status === 401) {
      detail = 'Make rejected the token (401). Check MAKE_API_TOKEN and that it has scenarios:read.';
      // No point hammering a bad token.
      this.backoffUntil = Date.now() + 60_000;
    } else if (err.status === 403) {
      // A 403 is ambiguous: it can come from Make (token lacks scope) or from a
      // proxy/VPN refusing the CONNECT. The body tells them apart - Make
      // answers JSON, a proxy answers HTML or plain text.
      detail = err.looksLikeMake
        ? 'Make refused the token (403). It is probably missing scenarios:read.'
        : 'Blocked before reaching Make (403 from a proxy, VPN, or firewall) - the token may be fine.';
      this.backoffUntil = Date.now() + 60_000;
    } else if (err.status === 429) {
      detail = 'Make rate limit hit (429) - backing off for 60s.';
      this.backoffUntil = Date.now() + 60_000;
    } else if (err.name === 'AbortError') {
      detail = 'Make API timed out - will retry.';
    } else {
      detail = `Make API error: ${err.message}`;
    }
    this.state.setSource('make', { enabled: true, ok: false, detail });
    log.warn(`Make poll failed for ${target.label}: ${detail}`);
  }
}

/**
 * Pick the in-flight execution out of an executions listing, if any.
 *
 * The listing mixes real execution events (`eventType` present) with scenario
 * audit events (`type: "modify" | "start" | "schedule"`, no `eventType`). Only
 * the former matter here.
 */
export function findRunning(entries) {
  if (!Array.isArray(entries)) return null;

  for (const entry of entries) {
    if (entry?.eventType !== 'EXECUTION_START') continue;
    const startedAt = Date.parse(entry.timestamp);
    if (!Number.isFinite(startedAt)) continue;
    return { executionId: entry.id, startedAt };
  }
  return null;
}
