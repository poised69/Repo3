/**
 * Demo mode: `POD_TOWN_DEMO=1 npm start`
 *
 * Drives the town with synthetic activity so you can see what every building
 * looks like working without waiting for real runs (or spending money on the
 * Image Foundry). The UI labels this clearly as demo data - it is never mixed
 * with, and never overrides, real detection.
 */
import { BUILDINGS, LINEAR_SCENARIOS, BBW_SCENARIO_ID, CALLBACK_TO_BUILDING, TWO_PHASE_CALLBACK } from './buildings.js';
import { log } from './log.js';

const SCENARIO_FOR_BUILDING = new Map(LINEAR_SCENARIOS.map((s) => [s.building, s.scenarioId]));
const CALLBACK_FOR_BUILDING = new Map();
for (const [callback, building] of Object.entries(CALLBACK_TO_BUILDING)) {
  if (!CALLBACK_FOR_BUILDING.has(building)) CALLBACK_FOR_BUILDING.set(building, callback);
}

export function startDemo(state) {
  state.demo = true;
  state.setSource('make', { enabled: true, ok: true, detail: 'DEMO DATA - not live' });
  state.setSource('telegram', { enabled: true, ok: true, mode: 'demo', detail: 'DEMO DATA - not live' });
  log.warn('DEMO MODE: the town is showing synthetic activity, not the real pipeline.');

  // Walk through the buildings in pipeline order, one at a time.
  const order = BUILDINGS.map((b) => b.id).filter((id) => id !== 'etsy_storefront');
  let index = 0;
  let counter = 0;

  const clear = () => {
    for (const scenarioId of SCENARIO_FOR_BUILDING.values()) state.setScenarioRunning(scenarioId, null);
    state.setScenarioRunning(BBW_SCENARIO_ID, null);
    for (const cb of state.callbacks.values()) cb.endedAt = Date.now();
  };

  const step = () => {
    clear();
    const buildingId = order[index % order.length];
    index += 1;
    counter += 1;

    const scenarioId = SCENARIO_FOR_BUILDING.get(buildingId);
    if (scenarioId) {
      state.setScenarioRunning(scenarioId, { executionId: `demo-${counter}`, startedAt: Date.now() });
      return;
    }

    const callback = CALLBACK_FOR_BUILDING.get(buildingId);
    if (callback) {
      state.noteCallback({ updateId: `demo-${counter}`, data: callback, at: Date.now() });
      // review_proceed also demonstrates the Etsy Storefront phase; give it the
      // matching execution so the two-phase transition is visible.
      if (callback === TWO_PHASE_CALLBACK) {
        state.setScenarioRunning(BBW_SCENARIO_ID, { executionId: `demo-${counter}`, startedAt: Date.now() });
      }
    }
  };

  step();
  const timer = setInterval(step, 9000);
  timer.unref?.();
  return () => clearInterval(timer);
}
