/**
 * Preflight check: `npm run doctor`
 *
 * Verifies configuration and both detection paths without starting the town.
 * Every call it makes is read-only and costs zero Make operations.
 *
 * This is also the tool that answers the two questions that could not be
 * settled without your credentials:
 *   - does the Make token work, and can it see execution state?
 *   - does Telegram getUpdates conflict with BBW's live webhook?
 */
import { config, hasMake, hasTelegram } from './config.js';
import { LINEAR_SCENARIOS, BBW_SCENARIO_ID } from './buildings.js';
import { findRunning } from './makePoller.js';

const tick = (ok) => (ok ? '  ok  ' : ' FAIL ');
const line = (ok, text) => console.log(`[${tick(ok)}] ${text}`);

/** Set when a failure looks like network egress rather than a bad credential. */
let blockedByNetwork = false;

async function checkMake() {
  console.log('\n— Make ————————————————————————————————');

  if (!hasMake()) {
    line(false, 'MAKE_API_TOKEN is not set. Scenario detection will be off.');
    return;
  }

  const scenarios = [
    { scenarioId: BBW_SCENARIO_ID, name: 'BBW' },
    ...LINEAR_SCENARIOS.map((s) => ({ scenarioId: s.scenarioId, name: s.name })),
  ];

  for (const scenario of scenarios) {
    const url = `${config.make.base}/scenarios/${scenario.scenarioId}/executions?pg%5Blimit%5D=5&pg%5BsortDir%5D=desc`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Token ${config.make.token}`, Accept: 'application/json' },
      });

      if (!res.ok) {
        const snippet = await res.text().then((t) => t.slice(0, 160)).catch(() => '');
        const fromMake = snippet.trimStart().startsWith('{');

        if (res.status === 401) {
          line(false, `${scenario.name}: token rejected (401). Check MAKE_API_TOKEN.`);
        } else if (res.status === 403 && fromMake) {
          line(false, `${scenario.name}: Make refused the token (403) - it likely lacks scenarios:read.`);
        } else if (res.status === 403) {
          line(false, `${scenario.name}: blocked before reaching Make (403 from a proxy/VPN/firewall).`);
          blockedByNetwork = true;
        } else {
          line(false, `${scenario.name}: HTTP ${res.status}`);
        }
        continue;
      }

      const body = await res.json();
      const entries = Array.isArray(body) ? body : body.executions || [];
      const running = findRunning(entries);
      const finished = entries.filter((e) => e.eventType === 'EXECUTION_END');

      const state = running ? `RUNNING now (started ${new Date(running.startedAt).toISOString()})` : 'idle';
      line(true, `${scenario.name}: readable, ${state}, ${finished.length} recent completed run(s).`);
    } catch (err) {
      line(false, `${scenario.name}: ${err.message}`);
    }
  }

  console.log(
    '\n  Note: an in-flight run shows up as an EXECUTION_START entry with no\n' +
      '  status/duration. If you want to see that live, trigger a scenario and\n' +
      '  re-run this command while it is still going.',
  );
}

async function checkTelegram() {
  console.log('\n— Telegram ————————————————————————————');

  if (!hasTelegram()) {
    line(false, 'TELEGRAM_BOT_TOKEN is not set. BBW routes cannot be identified.');
    console.log('  The town still works: BBW will show as running without a route.');
    return;
  }

  const call = async (method, params = {}) => {
    const url = new URL(`https://api.telegram.org/bot${config.telegram.token}/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url);
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const me = await call('getMe');
  if (!me.body?.ok) {
    // A non-JSON body means something intercepted the request before Telegram.
    if (me.body === null) {
      line(false, `getMe: blocked before reaching Telegram (HTTP ${me.status} from a proxy/VPN/firewall).`);
      blockedByNetwork = true;
    } else {
      line(false, `getMe failed: ${me.body?.description || me.status}`);
    }
    return;
  }
  line(true, `Authenticated as @${me.body.result.username}`);

  const hook = await call('getWebhookInfo');
  const hookUrl = hook.body?.result?.url || '';
  if (hookUrl) {
    let host = hookUrl;
    try {
      host = new URL(hookUrl).host;
    } catch {
      /* show the raw value if it will not parse */
    }
    line(true, `A webhook is registered (${host}). That is BBW's - it will NOT be touched.`);
  } else {
    line(true, 'No webhook registered on this bot.');
  }

  // The empirical question: does getUpdates conflict with that webhook?
  const probe = await call('getUpdates', { limit: 1, timeout: 0 });
  if (probe.status === 409) {
    line(false, 'getUpdates returns 409 Conflict - polling is blocked by the webhook.');
    console.log(
      '\n  This is the expected result while BBW is live, and it is not a bug.\n' +
        '  Options:\n' +
        '    1. Run without Telegram. The three scheduled scenarios animate\n' +
        '       normally and BBW shows as "running" without a specific route.\n' +
        '    2. Use shim mode: have something append each callback to a local\n' +
        '       JSON-lines file and set TELEGRAM_SHIM_FILE to its path.\n' +
        '  Do NOT delete the webhook to make polling work - that would break the\n' +
        '  live pipeline.',
    );
  } else if (probe.body?.ok) {
    line(true, 'getUpdates works - full per-route detection is available.');
    if (hookUrl) {
      console.log('  Unusual: a webhook is set yet getUpdates was accepted. Worth watching.');
    }
  } else {
    line(false, `getUpdates: ${probe.body?.description || probe.status}`);
  }
}

console.log('POD Town preflight');
console.log('==================');
console.log(`Make API base : ${config.make.base}`);
console.log(`Make token    : ${hasMake() ? 'set' : 'MISSING'}`);
console.log(`Telegram token: ${hasTelegram() ? 'set' : 'missing (optional)'}`);
console.log(`Server        : http://${config.server.host}:${config.server.port}`);

await checkMake();
await checkTelegram();

if (blockedByNetwork) {
  console.log(
    '\n! Some requests never reached Make/Telegram - they were refused by a\n' +
      '  proxy, VPN, or firewall on this machine. Your tokens may be perfectly\n' +
      '  fine. Retry on a network that allows outbound HTTPS to eu1.make.com\n' +
      '  and api.telegram.org.',
  );
}

console.log('\nDone. No Make operations were consumed.\n');
