/**
 * POD Town renderer.
 *
 * A hand-rolled Canvas 2D pixel-art town. Everything is drawn procedurally at a
 * fixed 480x288 logical resolution and scaled up with `image-rendering:
 * pixelated`, so there are no sprite assets to ship and the art stays crisp at
 * any window size.
 *
 * The town is a pure view of server state: a character stands at a building if
 * and only if that part of the real pipeline is executing.
 */

const W = 480;
const H = 288;

const canvas = document.getElementById('town');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const C = {
  sky: '#0d160d',
  grassDark: '#1b2a1b',
  grassMid: '#22331f',
  grassLite: '#2b3f24',
  treeDark: '#132009',
  treeMid: '#1e3312',
  treeLite: '#2c4a1b',
  path: '#c3ac80',
  pathEdge: '#a68f68',
  pathDot: '#b39f76',
  wall: '#8d908a',
  wallShade: '#6b6e69',
  wallDark: '#4d514d',
  roof: '#333a3c',
  roofDark: '#232a2c',
  sign: '#d9ccb2',
  signInk: '#241f18',
  winOff: '#28323d',
  winOn: '#ffd070',
  winGlow: 'rgba(255, 208, 112, 0.20)',
  brick: '#7a5346',
  brickDark: '#5d3e34',
  water: '#2a4a5c',
  shadow: 'rgba(0, 0, 0, 0.34)',
};

// ---------------------------------------------------------------------------
// Layout - ten buildings, positioned to echo the reference artwork.
// `door` is where a worker stands; `w`/`h` are the front face of the building.
// ---------------------------------------------------------------------------

const BUILDINGS = [
  { id: 'market_research', label: 'MARKET RESEARCH', x: 22, y: 96, w: 62, h: 34, style: 'shop', door: [53, 138] },
  { id: 'ideation_lab', label: 'IDEATION LAB', x: 100, y: 88, w: 62, h: 34, style: 'glass', door: [131, 130] },
  { id: 'scoring_office', label: 'SCORING OFFICE', x: 180, y: 62, w: 50, h: 46, style: 'tower', door: [205, 116] },
  { id: 'design_studio', label: 'DESIGN STUDIO', x: 246, y: 78, w: 62, h: 36, style: 'studio', door: [277, 122] },
  { id: 'ops_tower', label: 'OPS CONTROL TOWER', x: 386, y: 40, w: 66, h: 34, style: 'ops', door: [419, 84] },
  { id: 'image_foundry', label: 'IMAGE FOUNDRY', x: 24, y: 172, w: 66, h: 34, style: 'neon', door: [57, 214] },
  { id: 'review_house', label: 'REVIEW HOUSE', x: 132, y: 166, w: 58, h: 34, style: 'house', door: [161, 208] },
  { id: 'print_fulfillment', label: 'PRINT & FULFILLMENT', x: 372, y: 128, w: 76, h: 38, style: 'warehouse', door: [410, 174] },
  { id: 'etsy_storefront', label: 'ETSY STOREFRONT', x: 236, y: 176, w: 66, h: 36, style: 'store', door: [269, 220] },
  { id: 'listing_check', label: 'LISTING CHECK', x: 320, y: 196, w: 46, h: 32, style: 'booth', door: [343, 236] },
];

/**
 * Path network. Junctions are the sandy crossroads; every building door hangs
 * off the nearest junction. Workers only ever walk along these edges, which is
 * what keeps them on the paths instead of cutting through the trees.
 */
const JUNCTIONS = {
  j_west: [56, 152],
  j_mid_w: [130, 146],
  j_mid: [206, 140],
  j_mid_e: [278, 140],
  j_east: [352, 128],
  j_ops: [414, 100],
  j_south_w: [86, 218],
  j_south: [200, 224],
  j_south_e: [282, 232],
  j_booth: [344, 220],
  j_print: [408, 186],
};

const EDGES = [
  ['j_west', 'j_mid_w'],
  ['j_mid_w', 'j_mid'],
  ['j_mid', 'j_mid_e'],
  ['j_mid_e', 'j_east'],
  ['j_east', 'j_ops'],
  ['j_east', 'j_print'],
  ['j_west', 'j_south_w'],
  ['j_south_w', 'j_south'],
  ['j_south', 'j_south_e'],
  ['j_south_e', 'j_booth'],
  ['j_booth', 'j_print'],
  ['j_mid', 'j_south'],
  ['j_mid_e', 'j_south_e'],
  ['j_mid_w', 'j_south_w'],
];

/** Which junction each building's door attaches to. */
const DOOR_JUNCTION = {
  market_research: 'j_west',
  ideation_lab: 'j_mid_w',
  scoring_office: 'j_mid',
  design_studio: 'j_mid_e',
  ops_tower: 'j_ops',
  image_foundry: 'j_south_w',
  review_house: 'j_south_w',
  print_fulfillment: 'j_print',
  etsy_storefront: 'j_south_e',
  listing_check: 'j_booth',
};

// Build the navigation graph: junctions plus one node per building door.
const NODES = new Map();
for (const [name, pos] of Object.entries(JUNCTIONS)) NODES.set(name, { pos, links: [] });
for (const b of BUILDINGS) NODES.set(`door_${b.id}`, { pos: b.door, links: [] });

function link(a, b) {
  NODES.get(a).links.push(b);
  NODES.get(b).links.push(a);
}
for (const [a, b] of EDGES) link(a, b);
for (const b of BUILDINGS) link(`door_${b.id}`, DOOR_JUNCTION[b.id]);

/** Breadth-first shortest path across the walkway graph. */
function findPath(fromKey, toKey) {
  if (fromKey === toKey) return [toKey];
  const seen = new Set([fromKey]);
  const queue = [[fromKey]];
  while (queue.length) {
    const trail = queue.shift();
    const last = trail[trail.length - 1];
    for (const next of NODES.get(last).links) {
      if (seen.has(next)) continue;
      seen.add(next);
      const extended = [...trail, next];
      if (next === toKey) return extended;
      queue.push(extended);
    }
  }
  return [toKey];
}

// ---------------------------------------------------------------------------
// Deterministic scenery
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when a point sits on top of a building or too close to a walkway. */
function isBlocked(x, y) {
  for (const b of BUILDINGS) {
    // The upper margin also keeps scenery clear of the hanging sign board.
    if (x > b.x - 11 && x < b.x + b.w + 11 && y > b.y - 32 && y < b.y + b.h + 14) return true;
  }
  for (const [a, c] of EDGES) {
    if (distanceToSegment(x, y, JUNCTIONS[a], JUNCTIONS[c]) < 16) return true;
  }
  for (const b of BUILDINGS) {
    if (distanceToSegment(x, y, b.door, JUNCTIONS[DOOR_JUNCTION[b.id]]) < 14) return true;
  }
  return false;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const TREES = (() => {
  const random = mulberry32(20260815);
  const out = [];
  let attempts = 0;
  while (out.length < 150 && attempts < 6000) {
    attempts += 1;
    const x = random() * W;
    const y = 24 + random() * (H - 30);
    if (isBlocked(x, y)) continue;
    if (out.some((t) => Math.hypot(t.x - x, t.y - y) < 9)) continue;
    out.push({ x, y, r: 4 + random() * 3.5, tint: random() });
  }
  return out.sort((a, b) => a.y - b.y);
})();

const GRASS_TUFTS = (() => {
  const random = mulberry32(99221);
  const out = [];
  for (let i = 0; i < 260; i += 1) {
    const x = random() * W;
    const y = 20 + random() * (H - 24);
    if (isBlocked(x, y)) continue;
    out.push({ x, y, shade: random() });
  }
  return out;
})();

// Small unlit cabins in the top-left, purely scenery (as in the reference art).
const CABINS = [
  { x: 44, y: 26, w: 30, h: 16 },
  { x: 96, y: 34, w: 26, h: 14 },
  { x: 12, y: 56, w: 26, h: 14 },
  { x: 238, y: 26, w: 28, h: 15 },
  { x: 300, y: 40, w: 26, h: 14 },
];

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

const SHIRTS = ['#5b7fa8', '#a8655b', '#6f5ba8', '#4f8a6a', '#a8925b', '#8a5b7f'];

class Worker {
  constructor(index) {
    this.index = index;
    this.shirt = SHIRTS[index % SHIRTS.length];
    const start = pickRandom(Object.keys(JUNCTIONS));
    this.at = NODES.get(start).pos.slice();
    this.nodeKey = start;
    this.route = [];
    this.target = null; // building id it is assigned to, or null when idle
    this.mode = 'idle';
    this.facing = 1;
    this.phase = Math.random() * 10;
    this.restUntil = 0;
  }

  assign(buildingId) {
    if (this.target === buildingId) return;
    this.target = buildingId;
    this.#routeTo(buildingId ? `door_${buildingId}` : pickRandom(Object.keys(JUNCTIONS)));
  }

  #routeTo(destKey) {
    this.route = findPath(this.nodeKey, destKey).slice(1);
    this.mode = this.route.length ? 'walking' : this.target ? 'working' : 'idle';
  }

  update(dt, now) {
    this.phase += dt;

    if (this.route.length) {
      const destKey = this.route[0];
      const [dx, dy] = NODES.get(destKey).pos;
      const vx = dx - this.at[0];
      const vy = dy - this.at[1];
      const dist = Math.hypot(vx, vy);
      const speed = 26; // logical px/second

      if (dist < 1.2) {
        this.at = [dx, dy];
        this.nodeKey = destKey;
        this.route.shift();
        if (!this.route.length) {
          this.mode = this.target ? 'working' : 'idle';
          this.restUntil = now + 2000 + Math.random() * 4000;
        }
      } else {
        const step = Math.min(dist, speed * dt);
        this.at[0] += (vx / dist) * step;
        this.at[1] += (vy / dist) * step;
        if (Math.abs(vx) > 0.4) this.facing = vx > 0 ? 1 : -1;
        this.mode = 'walking';
      }
      return;
    }

    // Nothing to do: wander between junctions, pausing between hops.
    if (!this.target && now > this.restUntil) {
      const options = Object.keys(JUNCTIONS).filter((k) => k !== this.nodeKey);
      this.#routeTo(pickRandom(options));
    }
  }

  get working() {
    return this.mode === 'working' && Boolean(this.target);
  }
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const workers = [new Worker(0)];

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

let snapshot = { buildings: [], idle: true, sources: {}, notes: [] };
let activeIds = [];

function applySnapshot(next) {
  snapshot = next;
  activeIds = next.buildings.filter((b) => b.active).map((b) => b.id);

  // One worker per active building, minimum one so the town is never empty.
  const needed = Math.max(1, activeIds.length);
  while (workers.length < needed) workers.push(new Worker(workers.length));
  while (workers.length > needed && workers.length > 1) workers.pop();

  // Keep workers already at the right building; assign the rest.
  const unassigned = [...activeIds];
  const free = [];
  for (const worker of workers) {
    if (worker.target && unassigned.includes(worker.target)) {
      unassigned.splice(unassigned.indexOf(worker.target), 1);
    } else {
      free.push(worker);
    }
  }
  for (const worker of free) worker.assign(unassigned.shift() || null);

  renderPanel(next);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function px(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawBackground() {
  px(0, 0, W, H, C.grassDark);

  // Soft banding so the ground is not a flat colour.
  for (let y = 0; y < H; y += 4) {
    const shade = y % 8 === 0 ? C.grassMid : C.grassDark;
    px(0, y, W, 4, shade);
  }

  for (const tuft of GRASS_TUFTS) {
    px(tuft.x, tuft.y, 1, 1, tuft.shade > 0.6 ? C.grassLite : C.grassMid);
  }

  // Stream in the bottom-right corner, echoing the reference art.
  ctx.fillStyle = C.water;
  ctx.beginPath();
  ctx.moveTo(W, 250);
  ctx.lineTo(W - 46, H);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawPaths() {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const strokeAll = (width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      ctx.moveTo(JUNCTIONS[a][0], JUNCTIONS[a][1]);
      ctx.lineTo(JUNCTIONS[b][0], JUNCTIONS[b][1]);
    }
    for (const b of BUILDINGS) {
      const j = JUNCTIONS[DOOR_JUNCTION[b.id]];
      ctx.moveTo(j[0], j[1]);
      ctx.lineTo(b.door[0], b.door[1]);
    }
    ctx.stroke();
  };

  strokeAll(11, C.pathEdge);
  strokeAll(8, C.path);
}

function drawTree(t) {
  const shade = t.tint > 0.66 ? C.treeLite : t.tint > 0.33 ? C.treeMid : C.treeDark;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(t.x, t.y + t.r * 0.7, t.r * 0.9, t.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = C.treeDark;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(t.x - t.r * 0.22, t.y - t.r * 0.28, t.r * 0.72, 0, Math.PI * 2);
  ctx.fill();
}

function drawCabin(c) {
  px(c.x, c.y + c.h - 4, c.w, 4, C.wallDark);
  px(c.x, c.y + 4, c.w, c.h - 4, '#4a4f4a');
  px(c.x - 2, c.y, c.w + 4, 5, C.roofDark);
  px(c.x + 5, c.y + 8, 4, 4, C.winOff);
  px(c.x + c.w - 10, c.y + 8, 4, 4, C.winOff);
}

/** Windows glow when the building is working; a couple stay lit at random. */
function drawWindows(b, count, active, t) {
  const gap = b.w / (count + 1);
  for (let i = 0; i < count; i += 1) {
    const wx = b.x + gap * (i + 1) - 4;
    const wy = b.y + 12;
    const flicker = Math.sin(t * 2 + i * 1.7 + b.x) > 0.55;
    const lit = active ? true : flicker && i % 2 === 0;
    px(wx, wy, 8, 7, lit ? C.winOn : C.winOff);
    if (lit) {
      ctx.fillStyle = C.winGlow;
      ctx.fillRect(wx - 3, wy - 3, 14, 13);
    }
  }
}

function drawSign(b, active) {
  const label = b.label;
  ctx.font = '6px ui-monospace, monospace';
  const textWidth = ctx.measureText(label).width;
  const boxWidth = Math.min(b.w + 8, textWidth + 8);
  const sx = b.x + b.w / 2 - boxWidth / 2;
  const sy = b.y - 11;

  px(sx, sy, boxWidth, 9, active ? C.winOn : C.sign);
  px(sx, sy + 9, boxWidth, 1, C.roofDark);

  ctx.fillStyle = C.signInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x + b.w / 2, sy + 5);
}

function drawBuilding(b, active, t) {
  const { x, y, w, h } = b;

  // Ground shadow
  ctx.fillStyle = C.shadow;
  ctx.fillRect(x - 2, y + h - 2, w + 4, 5);

  // Body
  const bodyColor = b.style === 'warehouse' ? C.brick : C.wall;
  const bodyShade = b.style === 'warehouse' ? C.brickDark : C.wallShade;
  px(x, y, w, h, bodyColor);
  px(x, y + h - 6, w, 6, bodyShade);
  px(x, y, 2, h, bodyShade);

  // Roof
  px(x - 3, y - 5, w + 6, 6, C.roof);
  px(x - 3, y - 5, w + 6, 2, C.roofDark);

  // Per-style flourishes
  if (b.style === 'tower' || b.style === 'ops') {
    px(x + w / 2 - 1, y - 16, 2, 11, C.roofDark);
    ctx.fillStyle = active ? C.winOn : C.wallShade;
    ctx.beginPath();
    ctx.arc(x + w / 2, y - 17, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (b.style === 'neon') {
    // Image Foundry: magenta panel glow, the one building that spends money.
    for (let i = 0; i < 4; i += 1) {
      const on = active ? Math.sin(t * 6 + i) > -0.3 : Math.sin(t * 1.4 + i) > 0.7;
      px(x + 6 + i * 15, y + 5, 11, 5, on ? '#e879d6' : '#5a3b57');
    }
  }
  if (b.style === 'warehouse') {
    px(x + 8, y + 12, w - 16, h - 18, C.roofDark);
    px(x + 10, y + 14, w - 20, h - 22, '#3d3a35');
  }
  if (b.style === 'store') {
    // Awning stripes
    for (let i = 0; i < Math.floor(w / 6); i += 1) {
      px(x + i * 6, y + 8, 6, 4, i % 2 ? '#c9584c' : '#e8dccb');
    }
  }
  if (b.style === 'glass' || b.style === 'studio') {
    px(x + 3, y + 4, w - 6, 6, active ? 'rgba(255,208,112,0.5)' : 'rgba(120,150,170,0.25)');
  }

  const windowCount = b.style === 'booth' ? 1 : w > 60 ? 3 : 2;
  if (b.style !== 'warehouse') drawWindows(b, windowCount, active, t);

  // Door
  px(x + w / 2 - 4, y + h - 11, 8, 11, C.roofDark);

  drawSign(b, active);

  if (active) {
    // Warm pool of light spilling onto the path.
    const g = ctx.createRadialGradient(x + w / 2, y + h + 4, 2, x + w / 2, y + h + 4, 34);
    g.addColorStop(0, 'rgba(255, 208, 112, 0.22)');
    g.addColorStop(1, 'rgba(255, 208, 112, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + w / 2 - 36, y + h - 30, 72, 68);

    // Chimney smoke / activity puffs
    for (let i = 0; i < 3; i += 1) {
      const life = (t * 0.6 + i * 0.33) % 1;
      const puffY = y - 8 - life * 20;
      const alpha = 0.3 * (1 - life);
      ctx.fillStyle = `rgba(226, 226, 214, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x + w - 10 + Math.sin(life * 5 + i) * 3, puffY, 1.6 + life * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWorker(worker, t) {
  const [x, y] = worker.at;
  const walking = worker.mode === 'walking';
  const bob = worker.working ? Math.round(Math.sin(t * 7 + worker.phase) * 1) : 0;
  const legSwing = walking ? Math.round(Math.sin(worker.phase * 9)) : 0;
  const top = Math.round(y) - 11 + bob;
  const left = Math.round(x) - 3;

  // Shadow
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 4, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  px(left + 1, top + 8, 2, 3 + legSwing, '#33405a');
  px(left + 4, top + 8, 2, 3 - legSwing, '#33405a');

  // Body and arms
  px(left, top + 4, 7, 5, worker.shirt);
  const armSwing = walking ? legSwing : worker.working ? Math.round(Math.sin(t * 8 + worker.phase)) : 0;
  px(left - 1, top + 4 + armSwing, 1, 4, worker.shirt);
  px(left + 7, top + 4 - armSwing, 1, 4, worker.shirt);

  // Head
  px(left + 1, top, 5, 5, '#d9a066');
  px(left + 1, top - 1, 5, 2, '#3b2f2a');
  // Eye, facing-aware
  px(worker.facing > 0 ? left + 4 : left + 2, top + 2, 1, 1, '#241f18');

  // Working sparks
  if (worker.working) {
    for (let i = 0; i < 3; i += 1) {
      const life = (t * 1.6 + i * 0.4) % 1;
      ctx.fillStyle = `rgba(255, 224, 150, ${0.85 * (1 - life)})`;
      ctx.fillRect(Math.round(x + Math.sin(t * 4 + i * 2) * 6), Math.round(y - 14 - life * 9), 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  const t = nowMs / 1000;

  for (const worker of workers) worker.update(dt, nowMs);

  drawBackground();
  drawPaths();

  for (const cabin of CABINS) drawCabin(cabin);

  // Depth sort everything that stands on the ground so nearer things overlap
  // farther ones correctly.
  const drawables = [
    ...TREES.map((tree) => ({ y: tree.y, draw: () => drawTree(tree) })),
    ...BUILDINGS.map((b) => ({
      y: b.y + b.h,
      draw: () => drawBuilding(b, activeIds.includes(b.id), t),
    })),
    ...workers.map((worker) => ({ y: worker.at[1], draw: () => drawWorker(worker, t) })),
  ].sort((a, b) => a.y - b.y);

  for (const item of drawables) item.draw();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

const listEl = document.getElementById('buildingList');
const statusEl = document.getElementById('townStatus');
const notesEl = document.getElementById('notes');
const noteListEl = document.getElementById('noteList');

function since(ts) {
  if (!ts) return '';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function renderPanel(next) {
  const active = next.buildings.filter((b) => b.active);

  const prefix = next.demo ? 'DEMO DATA — ' : '';

  if (active.length) {
    statusEl.textContent = `${prefix}${active.length} building${active.length > 1 ? 's' : ''} working`;
    statusEl.dataset.busy = 'true';
  } else if (next.bbwUnattributed) {
    statusEl.textContent = 'BBW is running (route unknown)';
    statusEl.dataset.busy = 'true';
  } else {
    statusEl.textContent = 'Idle - nothing is running';
    statusEl.dataset.busy = 'false';
  }

  listEl.innerHTML = '';
  for (const b of next.buildings) {
    const li = document.createElement('li');
    li.dataset.active = String(b.active);

    const name = document.createElement('span');
    name.className = 'b-name';
    name.textContent = b.name;
    li.append(name);

    if (b.active) {
      const time = document.createElement('span');
      time.className = 'b-time';
      time.textContent = since(b.since);
      li.append(time);

      const detail = document.createElement('span');
      detail.className = 'b-detail';
      detail.textContent = b.detail || b.blurb;
      li.append(detail);
    }
    listEl.append(li);
  }

  renderFeed('feedMake', next.sources.make, 'Make');
  renderFeed('feedTelegram', next.sources.telegram, 'Telegram');

  const notes = next.notes || [];
  notesEl.hidden = notes.length === 0;
  noteListEl.innerHTML = '';
  for (const note of notes) {
    const li = document.createElement('li');
    li.textContent = note.text;
    noteListEl.append(li);
  }
}

function renderFeed(elementId, source, label) {
  const el = document.getElementById(elementId);
  if (!el || !source) return;
  const status = !source.enabled ? 'off' : source.ok ? 'ok' : source.mode === 'blocked' ? 'warn' : 'error';
  el.dataset.status = status;
  el.querySelector('strong').textContent = source.username ? `${label} @${source.username}` : label;
  el.querySelector('.feed__detail').textContent = source.detail || '';
}

// Refresh the elapsed timers even when the server sends nothing new.
setInterval(() => {
  if (snapshot.buildings?.length) renderPanel(snapshot);
}, 1000);

// ---------------------------------------------------------------------------
// Live connection
// ---------------------------------------------------------------------------

function connect() {
  const stream = new EventSource('/api/stream');

  stream.onmessage = (event) => {
    try {
      applySnapshot(JSON.parse(event.data));
    } catch {
      /* ignore a malformed frame and wait for the next one */
    }
  };

  stream.onerror = () => {
    statusEl.textContent = 'Lost the server - reconnecting…';
    statusEl.dataset.busy = 'false';
    stream.close();
    setTimeout(connect, 2000);
  };
}

connect();
