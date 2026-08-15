/**
 * In-memory view of what the pipeline is doing right now.
 *
 * Nothing here is persisted. On restart the town starts idle and repopulates
 * from the next poll, which is exactly the behaviour we want.
 *
 * Two independent signals feed this:
 *   - Make  : which scenario executions are in flight (authoritative timing)
 *   - Telegram: which BBW route was requested (authoritative routing)
 *
 * Neither alone is enough for BBW: Make knows *that* BBW is running but not
 * which of its 12 routes; Telegram knows *which* button was tapped but not when
 * the resulting run finishes. Correlating the two gives both.
 */
import {
  BUILDINGS,
  LINEAR_SCENARIOS,
  BBW_SCENARIO_ID,
  CALLBACK_TO_BUILDING,
  TWO_PHASE_CALLBACK,
  PRINT_PHASE_MS,
  PHASE_SEQUENCE,
  CALLBACK_ASSUMED_MS,
  DEFAULT_ASSUMED_MS,
} from './buildings.js';

const SCENARIO_BUILDING = new Map(LINEAR_SCENARIOS.map((s) => [s.scenarioId, s.building]));
const SCENARIO_NAME = new Map(LINEAR_SCENARIOS.map((s) => [s.scenarioId, s.name]));

/** How long after a button press we still expect Make to report the run. */
const CORRELATION_WINDOW_MS = 45_000;

export class TownState {
  constructor() {
    /** scenarioId -> { executionId, startedAt } for runs currently in flight. */
    this.runs = new Map();
    /** Recent BBW button presses, keyed by Telegram update id. */
    this.callbacks = new Map();
    this.sources = {
      make: { enabled: false, ok: false, detail: 'not configured', lastPollAt: null, rateLimited: false },
      telegram: { enabled: false, ok: false, mode: 'off', detail: 'not configured', username: null },
    };
    this.notes = [];
    /** Set only by demo mode, so the UI can label synthetic activity. */
    this.demo = false;
  }

  setSource(name, patch) {
    Object.assign(this.sources[name], patch);
  }

  /**
   * Called by the Make poller with the currently in-flight execution for a
   * scenario, or null when nothing is running.
   */
  setScenarioRunning(scenarioId, execution) {
    const previous = this.runs.get(scenarioId);

    if (!execution) {
      if (previous) {
        this.runs.delete(scenarioId);
        if (scenarioId === BBW_SCENARIO_ID) this.#endCallbacksForExecution(previous.executionId);
      }
      return;
    }

    if (previous && previous.executionId === execution.executionId) return;

    // A different execution id means the previous run ended and a new one began.
    if (previous && scenarioId === BBW_SCENARIO_ID) {
      this.#endCallbacksForExecution(previous.executionId);
    }

    this.runs.set(scenarioId, execution);
    if (scenarioId === BBW_SCENARIO_ID) this.#bindExecutionToCallback(execution);
  }

  /** Record a BBW inline-keyboard button press seen on Telegram. */
  noteCallback({ updateId, data, at }) {
    if (!data) return null;
    const key = String(updateId ?? `local:${at}`);
    if (this.callbacks.has(key)) return null;

    const building = CALLBACK_TO_BUILDING[data];
    if (!building) {
      // Unknown callback value - most likely route 2's inert placeholder stub,
      // or a button added to BBW after this mapping was verified. Never guess a
      // building for it; record it so the UI can surface the mismatch.
      this.notes.push({ at, text: `Unmapped Telegram callback "${data}" - no building lit.` });
      this.notes = this.notes.slice(-10);
      return null;
    }

    const assumed = CALLBACK_ASSUMED_MS[data] ?? DEFAULT_ASSUMED_MS;
    const entry = {
      key,
      data,
      at,
      building,
      twoPhase: data === TWO_PHASE_CALLBACK,
      executionId: null,
      endedAt: null,
      // Superseded the moment a real EXECUTION_END arrives for the bound run.
      assumedEndAt: at + assumed,
    };
    this.callbacks.set(key, entry);

    // If BBW is already running when the press lands, bind straight away.
    const run = this.runs.get(BBW_SCENARIO_ID);
    if (run && !this.#executionIsBound(run.executionId)) entry.executionId = run.executionId;

    return entry;
  }

  #executionIsBound(executionId) {
    for (const cb of this.callbacks.values()) {
      if (cb.executionId === executionId && !cb.endedAt) return true;
    }
    return false;
  }

  /** Attach a newly observed BBW execution to the most recent unbound press. */
  #bindExecutionToCallback(execution) {
    let best = null;
    for (const cb of this.callbacks.values()) {
      if (cb.endedAt || cb.executionId) continue;
      if (Math.abs(execution.startedAt - cb.at) > CORRELATION_WINDOW_MS) continue;
      if (!best || cb.at > best.at) best = cb;
    }
    if (best) best.executionId = execution.executionId;
  }

  #endCallbacksForExecution(executionId) {
    if (!executionId) return;
    const now = Date.now();
    for (const cb of this.callbacks.values()) {
      if (cb.executionId === executionId && !cb.endedAt) cb.endedAt = now;
    }
  }

  /** Drop finished/expired presses so the map cannot grow without bound. */
  prune(now = Date.now()) {
    for (const [key, cb] of this.callbacks) {
      const expired = !cb.executionId && now > cb.assumedEndAt;
      const finished = cb.endedAt && now - cb.endedAt > 10_000;
      if (expired || finished) this.callbacks.delete(key);
    }
  }

  /**
   * Which buildings are working right now, and why.
   * Returns a Map of buildingId -> { since, source, detail }.
   */
  activeBuildings(now = Date.now()) {
    const active = new Map();
    const put = (buildingId, entry) => {
      const existing = active.get(buildingId);
      if (!existing || entry.since < existing.since) active.set(buildingId, entry);
    };

    // 1. The three 1:1 scenarios - real in-flight executions from Make.
    for (const [scenarioId, run] of this.runs) {
      const buildingId = SCENARIO_BUILDING.get(scenarioId);
      if (!buildingId) continue;
      put(buildingId, {
        since: run.startedAt,
        source: 'make',
        detail: SCENARIO_NAME.get(scenarioId) || `scenario ${scenarioId}`,
      });
    }

    // 2. BBW routes - Telegram says which, Make says how long.
    for (const cb of this.callbacks.values()) {
      if (cb.endedAt) continue;
      if (!cb.executionId && now > cb.assumedEndAt) continue;

      if (cb.twoPhase) {
        // Two phases of one continuous run. See buildings.js for how the
        // ~115s cutover is derived from the blueprint's real sleeps.
        const elapsed = now - cb.at;
        const phaseIndex = elapsed < PRINT_PHASE_MS ? 0 : 1;
        put(PHASE_SEQUENCE[phaseIndex], {
          since: phaseIndex === 0 ? cb.at : cb.at + PRINT_PHASE_MS,
          source: cb.executionId ? 'make+telegram' : 'telegram',
          detail: phaseIndex === 0 ? 'Creating the Printify product' : 'Waiting on Etsy sync, then configuring the listing',
        });
      } else {
        put(cb.building, {
          since: cb.at,
          source: cb.executionId ? 'make+telegram' : 'telegram',
          detail: `Telegram: ${cb.data}`,
        });
      }
    }

    return active;
  }

  /**
   * True when BBW is executing but we cannot say which route - i.e. Telegram
   * detection is unavailable, or the press happened before the app started.
   */
  bbwRunningUnattributed() {
    const run = this.runs.get(BBW_SCENARIO_ID);
    if (!run) return null;
    for (const cb of this.callbacks.values()) {
      if (!cb.endedAt && cb.executionId === run.executionId) return null;
    }
    return { since: run.startedAt };
  }

  snapshot(now = Date.now()) {
    this.prune(now);
    const active = this.activeBuildings(now);
    const unattributed = this.bbwRunningUnattributed();

    return {
      now,
      demo: this.demo,
      idle: active.size === 0 && !unattributed,
      buildings: BUILDINGS.map((b) => {
        const hit = active.get(b.id);
        return {
          id: b.id,
          name: b.name,
          blurb: b.blurb,
          active: Boolean(hit),
          since: hit ? hit.since : null,
          source: hit ? hit.source : null,
          detail: hit ? hit.detail : null,
        };
      }),
      bbwUnattributed: unattributed,
      sources: this.sources,
      notes: this.notes.slice(-5),
    };
  }
}
