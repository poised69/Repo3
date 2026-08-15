/**
 * Tests for the detection logic.
 *
 * The Make fixtures below are real responses captured from the live API on
 * 2026-08-15 (trimmed for length, shapes untouched), including a genuine
 * in-flight EXECUTION_START recorded while a scenario was actually running.
 *
 * Run with:  node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { findRunning } from '../server/makePoller.js';
import { TownState } from '../server/state.js';
import { BBW_SCENARIO_ID, CALLBACK_TO_BUILDING, PRINT_PHASE_MS } from '../server/buildings.js';

// --- fixtures --------------------------------------------------------------

/** Captured while a run really was in flight. */
const IN_FLIGHT = [
  {
    imtId: '1786757259723_8f511377352644b98951ecfa57e977fe',
    eventType: 'EXECUTION_START',
    id: '8f511377352644b98951ecfa57e977fe',
    teamId: 2185811,
    type: 'auto',
    timestamp: '2026-08-15T01:27:39.723Z',
    instant: false,
  },
  // Scenario audit events are interleaved and must be ignored.
  { imtId: '1786757256736_64584767', id: '64584767', type: 'start', timestamp: '2026-08-15T01:27:36.736Z' },
  { imtId: '1786757253615_64584765', id: '64584765', type: 'modify', timestamp: '2026-08-15T01:27:33.615Z' },
];

/** Captured when nothing was running: completed runs plus audit noise. */
const IDLE = [
  { imtId: '1786749018058_64581180', id: '64581180', type: 'modify', timestamp: '2026-08-14T23:10:18.058Z' },
  {
    imtId: '1786748730001_da4123c5aef94f4085c111e6f17600c7',
    eventType: 'EXECUTION_END',
    id: 'da4123c5aef94f4085c111e6f17600c7',
    scenarioId: 6945454,
    duration: 36129,
    operations: 99,
    timestamp: '2026-08-14T23:05:30.001Z',
    status: 1,
  },
  { imtId: '1786699847803_64508383', id: '64508383', type: 'schedule', timestamp: '2026-08-14T09:30:47.803Z' },
];

// --- findRunning -----------------------------------------------------------

test('findRunning detects a live EXECUTION_START', () => {
  const running = findRunning(IN_FLIGHT);
  assert.ok(running, 'expected an in-flight execution');
  assert.equal(running.executionId, '8f511377352644b98951ecfa57e977fe');
  assert.equal(running.startedAt, Date.parse('2026-08-15T01:27:39.723Z'));
});

test('findRunning returns null when only completed runs are present', () => {
  assert.equal(findRunning(IDLE), null);
});

test('findRunning ignores audit events and bad input', () => {
  assert.equal(findRunning([{ type: 'modify', id: '1' }]), null);
  assert.equal(findRunning([]), null);
  assert.equal(findRunning(null), null);
});

// --- linear scenarios ------------------------------------------------------

test('a running scenario lights exactly its own building', () => {
  const state = new TownState();
  state.setScenarioRunning(6945454, { executionId: 'abc', startedAt: 1000 });

  const active = state.activeBuildings(2000);
  assert.deepEqual([...active.keys()], ['market_research']);
  assert.equal(active.get('market_research').source, 'make');
});

test('a scenario that stops clears its building', () => {
  const state = new TownState();
  state.setScenarioRunning(6868468, { executionId: 'abc', startedAt: 1000 });
  assert.equal(state.activeBuildings(2000).size, 1);

  state.setScenarioRunning(6868468, null);
  assert.equal(state.activeBuildings(3000).size, 0);
  assert.equal(state.snapshot(3000).idle, true);
});

// --- BBW routes ------------------------------------------------------------

test('every verified callback maps to a building', () => {
  const state = new TownState();
  for (const [callback, expected] of Object.entries(CALLBACK_TO_BUILDING)) {
    const entry = state.noteCallback({ updateId: `u-${callback}`, data: callback, at: 1000 });
    assert.ok(entry, `callback ${callback} should be recognised`);
    assert.equal(entry.building, expected);
  }
});

test('all six review callbacks drive the one Review House', () => {
  const reviews = ['review_change', 'review_polish', 'review_reevaluate', 'polish_bigger_text', 'polish_color', 'polish_simplify'];
  for (const callback of reviews) {
    assert.equal(CALLBACK_TO_BUILDING[callback], 'review_house');
  }
});

test('the inert placeholder route lights nothing', () => {
  const state = new TownState();
  // Route 2 (entry module 8) has no filter and is an empty stub.
  const entry = state.noteCallback({ updateId: 'u1', data: 'placeholder', at: 1000 });
  assert.equal(entry, null);
  assert.equal(state.activeBuildings(2000).size, 0);
  assert.equal(state.snapshot(2000).notes.length, 1);
});

test('review_proceed runs Print & Fulfillment, then Etsy Storefront', () => {
  const state = new TownState();
  const t0 = 1_000_000;
  state.noteCallback({ updateId: 'u1', data: 'review_proceed', at: t0 });

  const early = state.activeBuildings(t0 + 5_000);
  assert.deepEqual([...early.keys()], ['print_fulfillment']);

  const late = state.activeBuildings(t0 + PRINT_PHASE_MS + 5_000);
  assert.deepEqual([...late.keys()], ['etsy_storefront']);
});

test('a real EXECUTION_END ends the route rather than the assumed timer', () => {
  const state = new TownState();
  const t0 = 1_000_000;
  state.noteCallback({ updateId: 'u1', data: 'generate_images', at: t0 });
  state.setScenarioRunning(BBW_SCENARIO_ID, { executionId: 'exec-1', startedAt: t0 + 500 });

  assert.deepEqual([...state.activeBuildings(t0 + 10_000).keys()], ['image_foundry']);
  assert.equal(state.activeBuildings(t0 + 10_000).get('image_foundry').source, 'make+telegram');

  // Execution disappears from Make => the run finished.
  state.setScenarioRunning(BBW_SCENARIO_ID, null);
  assert.equal(state.activeBuildings(t0 + 11_000).size, 0);
});

test('without Make correlation a route still expires on its assumed timer', () => {
  const state = new TownState();
  const t0 = 1_000_000;
  state.noteCallback({ updateId: 'u1', data: 'generate_batch', at: t0 });

  assert.equal(state.activeBuildings(t0 + 1_000).size, 1);
  assert.equal(state.activeBuildings(t0 + 10 * 60_000).size, 0);
});

test('BBW running with no known route is reported as unattributed', () => {
  const state = new TownState();
  state.setScenarioRunning(BBW_SCENARIO_ID, { executionId: 'exec-9', startedAt: 1000 });

  const snap = state.snapshot(2000);
  assert.ok(snap.bbwUnattributed, 'expected an unattributed BBW run');
  assert.equal(snap.buildings.filter((b) => b.active).length, 0);
});

test('concurrent scenario and BBW activity light both buildings', () => {
  const state = new TownState();
  const t0 = 1_000_000;
  state.setScenarioRunning(6868468, { executionId: 'ops-1', startedAt: t0 });
  state.noteCallback({ updateId: 'u1', data: 'score_niches', at: t0 });

  const active = state.activeBuildings(t0 + 2_000);
  assert.deepEqual([...active.keys()].sort(), ['ops_tower', 'scoring_office']);
});

test('duplicate Telegram updates are recorded only once', () => {
  const state = new TownState();
  assert.ok(state.noteCallback({ updateId: 'u1', data: 'score_niches', at: 1000 }));
  assert.equal(state.noteCallback({ updateId: 'u1', data: 'score_niches', at: 1000 }), null);
});

test('snapshot exposes all ten buildings', () => {
  const snap = new TownState().snapshot(1000);
  assert.equal(snap.buildings.length, 10);
  assert.equal(snap.idle, true);
});
