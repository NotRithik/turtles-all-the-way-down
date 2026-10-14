// Build agent: ore deposits, AI miners, typed build/spawn commands. See CONTRACT.md.
import * as THREE from 'three';
import { TEAM_COLOR, TYPE_NAME } from './core.js';

// ---------------------------------------------------------------- costs / templates
export const UNIT_COST = { R: 5, P: 5, S: 5, miner: 8 };
const UNIT_LABEL = { ...TYPE_NAME, miner: 'Miner' };
const ORE_COLORS = [0x4fc3f7, 0xffc83d, 0x5be37d];   // crystal blue, gold, green
const BLUE = TEAM_COLOR[0];

function centered(cells) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z] of cells) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const ox = Math.floor((minX + maxX) / 2), oz = Math.floor((minZ + maxZ) / 2);
  return cells.map(([x, y, z, c]) => [x - ox, y, z - oz, c]);
}

const TEMPLATES = {
  wall(size) {
    const L = { small: 4, normal: 7, big: 11, tall: 7 }[size], H = { small: 2, normal: 2, big: 3, tall: 4 }[size];
    const c = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) c.push([x, y, 0, y % 2 ? 0x8d99ae : 0x7b879c]);
    if (size !== 'small') for (let x = 0; x < L; x += 2) c.push([x, H, 0, BLUE]);
    return c;
  },
  tower(size) {
    const w = size === 'big' ? 3 : 2, h = { small: 3, normal: 5, tall: 8, big: 5 }[size];
    const c = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let z = 0; z < w; z++) {
      if (w === 3 && x === 1 && z === 1) continue;
      c.push([x, y, z, y === h - 1 ? BLUE : (y % 2 ? 0x8a93a6 : 0x737d91)]);
    }
    if (w === 3) for (const [x, z] of [[0, 0], [0, 2], [2, 0], [2, 2]]) c.push([x, h, z, BLUE]);
    return c;
  },
  pyramid(size) {
    const n = { small: 3, normal: 5, big: 7, tall: 5 }[size];
    const c = [];
    let k = 0;
    for (; n - 2 * k > 0; k++) for (let x = k; x < n - k; x++) for (let z = k; z < n - k; z++)
      c.push([x, k, z, n - 2 * k === 1 ? 0xffd54f : (k % 2 ? 0xe8c987 : 0xd9b36c)]);
    if (size === 'tall') { const m = (n - 1) / 2; for (let y = k; y < k + 3; y++) c.push([m, y, m, 0xffd54f]); }
    return c;
  },
  castle(size) {
    const n = { small: 5, normal: 7, big: 9, tall: 7 }[size];
    const wallH = { small: 2, normal: 2, big: 3, tall: 3 }[size];
    const towerH = wallH + { small: 1, normal: 2, big: 2, tall: 3 }[size];
    const mid = (n - 1) / 2, gateH = wallH - 1;
    const isCorner = (x, z) => (x === 0 || x === n - 1) && (z === 0 || z === n - 1);
    const c = [];
    for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
      if (x > 0 && x < n - 1 && z > 0 && z < n - 1) continue;          // perimeter only
      for (let y = 0; y < wallH; y++) {
        if (z === n - 1 && Math.abs(x - mid) <= (n >= 9 ? 1 : 0) && y < gateH) continue; // gate
        c.push([x, y, z, y % 2 ? 0x9aa5b8 : 0x88939f]);
      }
      if (isCorner(x, z)) for (let y = wallH; y < towerH; y++) c.push([x, y, z, y === towerH - 1 ? BLUE : 0x9aa5b8]);
      else if ((x + z) % 2 === 0) c.push([x, wallH, z, BLUE]);       // merlons
    }
    return c;
  },
};
const STRUCT_LABEL = { wall: 'Wall', tower: 'Tower', pyramid: 'Pyramid', castle: 'Castle' };
const SIZE_LABEL = { small: 'Small ', normal: '', big: 'Big ', tall: 'Tall ' };
export function structCells(name, size) { return centered(TEMPLATES[name](size)); }

// ---------------------------------------------------------------- parser (pure)
const NUM_WORDS = { a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, few: 3, four: 4, several: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, some: 3 };
const PASS_RE = /\b(rockets?|engineers?|launch\w*|missiles?|nukes?|silos?|bombs?|fire|strike)\b/;
const ATTACK_RE = /\b(attack\w*|charge|rush|advance|push|raid|assault|go|kill|destroy|invade)\b/;
const DEFEND_RE = /\b(defend\w*|retreat|home|fall ?back|back|guard|protect|regroup)\b/;
const HELP_RE = /^\s*\?\s*$|\b(help|commands|how)\b/;
const UNIT_RES = [
  ['R', /\b(rocks?|stones?|boulders?|pebbles?)\b/],
  ['P', /\b(papers?|sheets?|scrolls?)\b/],
  ['S', /\b(scissors?|blades?|snips?)\b/],
  ['miner', /\b(miners?|workers?|diggers?|peons?|drones?)\b/],
];
const STRUCT_RES = [
  ['castle', /\b(castles?|forts?|fortress\w*|keeps?|bases?|citadel)\b/],
  ['pyramid', /\b(pyramids?|ziggurats?)\b/],
  ['tower', /\b(towers?|turrets?|spires?)\b/],
  ['wall', /\b(walls?|fences?|barriers?|barricades?)\b/],
];
function parseCount(s) {
  const d = s.match(/\b(\d+)\b/);
  if (d) return parseInt(d[1], 10);
  for (const w of s.split(/\s+/)) if (NUM_WORDS[w] && w !== 'a' && w !== 'an') return NUM_WORDS[w];
  return 1;
}
function parseTypes(s) { return UNIT_RES.filter(([t, re]) => t !== 'miner' && re.test(s)).map(([t]) => t); }

function parseSegment(s) {
  if (!s) return null;
  if (HELP_RE.test(s)) return { kind: 'help' };
  if (/\b(cancel|nevermind|never mind|stop building)\b/.test(s)) return { kind: 'cancel' };
  for (const [name, re] of STRUCT_RES) if (re.test(s)) {
    const size = /\b(tall|high|towering|skyscraper)\b/.test(s) ? 'tall'
      : /\b(big|large|huge|giant|massive|mega|great|enormous)\b/.test(s) ? 'big'
      : /\b(small|tiny|little|mini|short|smol)\b/.test(s) ? 'small' : 'normal';
    return { kind: 'struct', name, size, count: Math.max(1, Math.min(5, parseCount(s))) };
  }
  for (const [type, re] of UNIT_RES) if (re.test(s))
    return { kind: 'unit', type, count: Math.max(1, Math.min(20, parseCount(s))) };
  return { kind: 'unknown' };
}

// Returns null (not ours, e.g. rockets) or an array of parsed segments.
export function parseCommand(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9?\s,;&+]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || PASS_RE.test(s)) return null;
  if (ATTACK_RE.test(s)) return [{ kind: 'attack', types: parseTypes(s) }];
  if (DEFEND_RE.test(s)) return [{ kind: 'defend', types: parseTypes(s) }];
  return s.split(/\s*(?:,|;|&|\+|\band\b|\bthen\b|\bplus\b)\s*/).map(parseSegment).filter(Boolean);
}

// ---------------------------------------------------------------- install
export function installBuild(world, game) {
  const scene = world.scene;
  const rng = () => (typeof world.rng === 'function' ? world.rng() : Math.random());
  const S = world.size || 30;
  const audio = (n) => { try { game?.audio?.play?.(n); } catch (e) { /* never throw */ } };
  const log = (m) => { try { game?.hud?.log?.(m); } catch (e) { /* */ } };
  const blocks = () => world.blocks || 0;
  const playing = () => !world.state || world.state === 'playing';
  const core0 = () => world.corePos?.(0) ?? new THREE.Vector3(0, 0, S * 0.8);
  const core1 = () => world.corePos?.(1) ?? new THREE.Vector3(0, 0, -S * 0.8);
  const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const UP = new THREE.Vector3(0, 1, 0);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const mats = new Map();
  const mat = (color, glow = 0.12) => {
    const k = color + ':' + glow;
    if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: glow }));
    return mats.get(k);
  };

  // ---------------- ore
  const ore = [];                     // { mesh, x, y, z, color, reserved }
  const occupied = new Set();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const isTop = (o) => !occupied.has(key(o.x, o.y + 1, o.z));

  function addOre(x, y, z, color) {
    const m = new THREE.Mesh(box, mat(color, 0.35));
    m.scale.setScalar(0.86);
    m.position.set(x, y + 0.45, z);
    m.rotation.y = (rng() - 0.5) * 0.5;
    scene.add(m);
    occupied.add(key(x, y, z));
    ore.push({ mesh: m, x, y, z, color, reserved: null, base: m.position.y });
  }

  function spawnCluster(cx, cz) {
    cx = Math.round(cx); cz = Math.round(cz);
    const color = ORE_COLORS[Math.floor(rng() * ORE_COLORS.length)];
    const n = 5 + Math.floor(rng() * 8);
    const mine = [];
    const tryAdd = (x, y, z) => {
      if (occupied.has(key(x, y, z)) || Math.abs(x) > S - 1 || Math.abs(z) > S - 1) return false;
      addOre(x, y, z, color); mine.push([x, y, z]); return true;
    };
    if (!tryAdd(cx, 0, cz)) return;
    for (let guard = 0; mine.length < n && guard < 60; guard++) {
      const [bx, , bz] = mine[Math.floor(rng() * mine.length)];
      if (mine.length > 2 && rng() < 0.3) {          // stack up (max 3 high)
        let y = 0; while (occupied.has(key(bx, y, bz))) y++;
        if (y < 3) tryAdd(bx, y, bz);
      } else {
        const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rng() * 4)];
        tryAdd(bx + dx, 0, bz + dz);
      }
    }
  }

  function randomPlayerSpot() {
    const c = core0();
    for (let i = 0; i < 40; i++) {
      const x = (rng() * 2 - 1) * S * 0.85, z = S * (0.12 + rng() * 0.75);
      if (Math.abs(x) < S * 0.18) continue;                      // keep the center lane clear
      if (Math.hypot(x - c.x, z - c.z) < Math.max(6, S * 0.22)) continue;
      return [x, z];
    }
    return null;
  }
  for (let i = 0; i < 8; i++) { const p = randomPlayerSpot(); if (p) spawnCluster(p[0], p[1]); }
  for (const side of [-1, 1]) spawnCluster(side * S * (0.4 + rng() * 0.35), (rng() - 0.5) * S * 0.2);

  function removeOre(o) {
    const i = ore.indexOf(o);
    if (i >= 0) ore.splice(i, 1);
    occupied.delete(key(o.x, o.y, o.z));
    scene.remove(o.mesh);
    debris(o.mesh.position, o.color, 7);
  }

  // ---------------- debris / fx
  const fx = [];   // { mesh, vel, life, max }
  function debris(pos, color, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(box, mat(color, 0.3));
      m.scale.setScalar(0.18 + rng() * 0.12);
      m.position.copy(pos);
      scene.add(m);
      fx.push({ mesh: m, vel: new THREE.Vector3((rng() - 0.5) * 5, 3 + rng() * 4, (rng() - 0.5) * 5), life: 0.7, max: 0.7, s: m.scale.x });
    }
  }

  // ---------------- miners
  const miners = new Map();   // unit -> state
  let firstUpdate = true;

  function makePick() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(box, mat(0x8d5a2b)); handle.scale.set(0.07, 0.6, 0.07); handle.position.y = 0.3;
    const head = new THREE.Mesh(box, mat(0xcfd8dc)); head.scale.set(0.45, 0.09, 0.09); head.position.y = 0.6;
    g.add(handle, head); g.rotation.order = 'YXZ';
    return g;
  }
  function release(st) {
    if (st.ore) st.ore.reserved = null;
    if (st.carry) scene.remove(st.carry);
    if (st.pick) scene.remove(st.pick);
    st.ore = st.carry = st.pick = null;
  }
  function goTo(u, x, z) { u.moveTarget = new THREE.Vector3(x, u.pos.y, z); }

  function seek(u, st) {
    let best = null, bd = Infinity;
    for (const o of ore) {
      if (o.reserved || !isTop(o)) continue;
      const d = Math.hypot(o.x - u.pos.x, o.z - u.pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    st.t = 0;
    if (!best) {                                    // nothing to mine: loiter near core
      st.state = 'idle';
      const c = core0();
      if (distXZ(u.pos, c) > 6 && !u.moveTarget) goTo(u, c.x + (rng() - 0.5) * 4, c.z - 4);
      return;
    }
    best.reserved = u; st.ore = best; st.state = 'toOre';
    approachOre(u, st);
  }
  function approachOre(u, st) {
    const o = st.ore, dx = u.pos.x - o.x, dz = u.pos.z - o.z, d = Math.hypot(dx, dz) || 1;
    goTo(u, o.x + (dx / d) * 1.1, o.z + (dz / d) * 1.1);
  }
  function depositPoint(u) {
    const c = core0(), dx = u.pos.x - c.x, dz = u.pos.z - c.z, d = Math.hypot(dx, dz) || 1;
    return [c.x + (dx / d) * 3, c.z + (dz / d) * 3];
  }

  function updateMiner(u, st, dt) {
    st.t += dt;
    if (st.state === 'idle') { if (st.t > 1) seek(u, st); return; }
    if (st.state === 'toOre') {
      if (!st.ore || !ore.includes(st.ore)) { release(st); return seek(u, st); }
      const d = distXZ(u.pos, st.ore);
      if (d < 1.8 || (!u.moveTarget && d < 2.4)) {
        u.moveTarget = null; st.state = 'mining'; st.t = 0;
        st.pick = makePick(); scene.add(st.pick);
      } else if (!u.moveTarget || st.t > 20) { st.t = st.t > 20 ? 0 : st.t; approachOre(u, st); }
      return;
    }
    if (st.state === 'mining') {
      const o = st.ore;
      if (!o || !ore.includes(o)) { release(st); return seek(u, st); }
      const p = st.pick;
      if (p) {
        p.position.set(u.pos.x, (u.pos.y || 0) + 0.2, u.pos.z);
        p.rotation.y = Math.atan2(o.x - u.pos.x, o.z - u.pos.z);
        p.rotation.x = 0.2 + Math.sin(st.t * 16) * 0.9;
      }
      o.mesh.position.x = o.x + Math.sin(st.t * 40) * 0.04;
      if (st.t >= 1.2) {
        audio('mine');
        const color = o.color;
        removeOre(o); st.ore = null;
        if (p) { scene.remove(p); st.pick = null; }
        const c = new THREE.Mesh(box, mat(color, 0.4)); c.scale.setScalar(0.38);
        scene.add(c); st.carry = c;
        st.state = 'toCore'; st.t = 0;
        const [x, z] = depositPoint(u); goTo(u, x, z);
      }
      return;
    }
    if (st.state === 'toCore') {
      const c = core0(), d = distXZ(u.pos, c);
      if (st.carry) st.carry.position.set(u.pos.x, (u.pos.y || 0) + 1.0 + Math.sin(st.t * 8) * 0.06, u.pos.z);
      if (d < 3.6 || (!u.moveTarget && d < 5) || (st.t > 20 && d < 8)) {
        world.blocks = blocks() + 2;
        audio('deposit');
        if (st.carry) { debris(st.carry.position, 0xffffff, 3); scene.remove(st.carry); st.carry = null; }
        st.state = 'idle'; st.t = 0.8;            // seek next frame-ish
        u.moveTarget = null;
      } else if (!u.moveTarget || st.t > 20) {
        if (st.t > 20) st.t = 0;
        const [x, z] = depositPoint(u); goTo(u, x, z);
      }
    }
  }

  function updateMiners(dt) {
    const units = world.units || [];
    const live = new Set();
    for (const u of units) {
      if (u.type !== 'miner' || u.team !== 0 || u.alive === false || !u.pos) continue;
      live.add(u);
      let st = miners.get(u);
      if (!st) { st = { state: 'idle', t: 1, ore: null, carry: null, pick: null }; miners.set(u, st); }
      updateMiner(u, st, dt);
    }
    for (const [u, st] of miners) if (!live.has(u)) { release(st); miners.delete(u); }
  }

  // ---------------- units / orders
  function enemyDir() {
    const a = core0(), b = core1();
    const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    return d.lengthSq() > 0 ? d.normalize() : new THREE.Vector3(0, 0, -1);
  }
  function spawnUnits(type, count) {
    const c = core0(), d = enemyDir(), px = -d.z, pz = d.x;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const j = (rng() - 0.5) * 6, f = type === 'miner' ? 2.5 : 4;
      const u = world.spawnUnit?.({ type, team: 0, x: c.x + d.x * f + px * j, z: c.z + d.z * f + pz * j });
      if (!u) continue;
      n++;
      if (type !== 'miner' && u.pos) {
        const r = 9 + rng() * 4, jj = (rng() - 0.5) * 10;
        u.moveTarget = new THREE.Vector3(c.x + d.x * r + px * jj, u.pos.y, c.z + d.z * r + pz * jj);
      }
    }
    return n;
  }
  function fighters(types) {
    return (world.units || []).filter((u) => u.team === 0 && u.alive !== false && u.pos &&
      ['R', 'P', 'S'].includes(u.type) && (!types.length || types.includes(u.type)));
  }
  function order(kind, types) {
    const fs = fighters(types);
    const what = types.length ? types.map((t) => TYPE_NAME[t]).join('/') : 'fighters';
    if (!fs.length) { audio('error'); return `No ${what} to command. Try "3 rocks" first.`; }
    const d = enemyDir(), px = -d.z, pz = d.x;
    const tgt = kind === 'attack' ? core1() : core0();
    const back = kind === 'attack' ? 0 : 6;
    fs.forEach((u, i) => {
      const j = (i - (fs.length - 1) / 2) * 1.4 + (rng() - 0.5);
      u.moveTarget = new THREE.Vector3(tgt.x + d.x * back + px * j, u.pos.y, tgt.z + d.z * back + pz * j);
    });
    audio('move');
    return kind === 'attack' ? `Charge! ${fs.length} ${what} marching on the enemy core.` : `${fs.length} ${what} falling back to defend.`;
  }

  // ---------------- structure placement
  let placing = null;     // { name, size, cells, cost, count, label, group }
  let rot = 0;
  let swallowUntil = 0;
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.35, depthWrite: false });
  const drops = [];       // { mesh, y, vy, delay, ty }
  let lastBuildSfx = 0, clock = 0;

  function startPlacing(name, size, count) {
    cancelPlacing(true);
    const cells = structCells(name, size);
    const group = new THREE.Group();
    for (const [x, y, z] of cells) {
      const m = new THREE.Mesh(box, ghostMat); m.position.set(x, y + 0.5, z); m.scale.setScalar(0.98); group.add(m);
    }
    group.visible = false;
    scene.add(group);
    placing = { name, size, cells, cost: cells.length, count, label: SIZE_LABEL[size] + STRUCT_LABEL[name], group };
  }
  function cancelPlacing(silent) {
    if (!placing) return;
    scene.remove(placing.group);
    if (!silent) log(`Cancelled ${placing.label}.`);
    placing = null;
  }
  function anchor() {
    const m = world.mouseGround;
    return m ? [Math.round(m.x), Math.round(m.z)] : null;
  }
  function validSpot(ax, az) {
    if (Math.abs(ax) > S - 1 || Math.abs(az) > S - 1) return false;
    const c0 = core0(), c1 = core1();
    return Math.hypot(ax - c0.x, az - c0.z) > 4 && Math.hypot(ax - c1.x, az - c1.z) > 4;
  }
  function place() {
    const a = anchor();
    if (!placing || !a) return;
    const [ax, az] = a;
    if (!validSpot(ax, az)) { audio('error'); log("Can't build there (too close to a core or off the map)."); return; }
    if (blocks() < placing.cost) { audio('error'); log(`Need ${placing.cost} blocks (have ${blocks()})`); return; }
    world.blocks = blocks() - placing.cost;
    const v = new THREE.Vector3();
    const cells = placing.cells.map(([x, y, z, color]) => {
      v.set(x, 0, z).applyAxisAngle(UP, rot * Math.PI / 2);
      return [ax + Math.round(v.x), y, az + Math.round(v.z), color];
    }).sort((p, q) => p[1] - q[1] || (p[0] + p[2]) - (q[0] + q[2]));
    const step = Math.min(0.045, 2.5 / cells.length);
    cells.forEach(([x, y, z, color], i) => {
      const m = new THREE.Mesh(box, mat(color));
      m.scale.setScalar(0.97);
      const ty = y + 0.5;
      m.position.set(x, ty + 14, z);
      m.visible = false;
      scene.add(m);
      drops.push({ mesh: m, ty, vy: 0, delay: i * step, last: i === cells.length - 1 });
    });
    log(`${placing.label} rising! (-${placing.cost} blocks)`);
    placing.count--;
    if (placing.count <= 0) cancelPlacing(true);
  }

  const onCanvas = (e) => e.target && e.target.tagName === 'CANVAS';
  const swallow = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); };
  function onPointerDown(e) {
    if (game?.active !== world || !onCanvas(e)) return;
    if (placing) {
      swallow(e);
      swallowUntil = performance.now() + 500;
      if (e.button === 2) cancelPlacing(false);
      else if (e.button === 0) place();
    } else if (performance.now() < swallowUntil) swallow(e);
  }
  function onTrailing(e) {
    if (game?.active !== world || !onCanvas(e)) return;
    if (placing || performance.now() < swallowUntil) swallow(e);
  }
  function onKey(e) {
    if (!placing || game?.active !== world) return;
    if (e.key === 'Escape') { swallow(e); cancelPlacing(false); }
    else if ((e.key === 'r' || e.key === 'R') && !game?.isTyping?.()) { swallow(e); rot = (rot + 1) % 4; }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('mousedown', onTrailing, true);
    for (const t of ['pointerup', 'mouseup', 'click', 'contextmenu']) window.addEventListener(t, onTrailing, true);
    window.addEventListener('keydown', onKey, true);
  }

  // ---------------- commands
  function helpText() {
    const c = (n, s = 'normal') => structCells(n, s).length;
    return `Units: "3 rocks", "2 paper", "scissors" (5 each), "miner" (8). ` +
      `Build (1 block/cube): wall ${c('wall')}, tower ${c('tower')}, pyramid ${c('pyramid')}, castle ${c('castle')} ` +
      `+ small/big/tall. Orders: "attack", "rocks attack", "defend". Placing: click, R rotate, Esc cancel.`;
  }
  const SHRUGS = [
    "¯\\_(ツ)_/¯ The turtles didn't understand.",
    'The miners looked at each other and shrugged.',
    "That's not in the blueprint book.",
    'A turtle blinked slowly at you.',
  ];

  function runSegment(cmd) {
    switch (cmd.kind) {
      case 'help': return helpText();
      case 'cancel': if (placing) { cancelPlacing(true); return 'Building cancelled.'; } return null;
      case 'attack': case 'defend': return order(cmd.kind, cmd.types);
      case 'unit': {
        const cost = UNIT_COST[cmd.type] * cmd.count;
        if (blocks() < cost) { audio('error'); return `Need ${cost} blocks (have ${blocks()})`; }
        world.blocks = blocks() - cost;
        const n = spawnUnits(cmd.type, cmd.count);
        if (n < cmd.count) world.blocks += UNIT_COST[cmd.type] * (cmd.count - n);   // refund failures
        audio('spawn');
        return `+${n} ${UNIT_LABEL[cmd.type]}${n > 1 && cmd.type !== 'S' ? 's' : ''} (-${UNIT_COST[cmd.type] * n} blocks)`;
      }
      case 'struct': {
        const cost = structCells(cmd.name, cmd.size).length;
        const label = SIZE_LABEL[cmd.size] + STRUCT_LABEL[cmd.name];
        if (blocks() < cost) { audio('error'); return `Need ${cost} blocks (have ${blocks()}) for a ${label}`; }
        startPlacing(cmd.name, cmd.size, cmd.count);
        audio('select');
        return `${label}${cmd.count > 1 ? ' x' + cmd.count : ''} (${cost} blocks${cmd.count > 1 ? ' each' : ''}): click to place, R rotate, Esc cancel.`;
      }
    }
    return null;
  }

  function handleCommand(text) {
    const cmds = parseCommand(text);
    if (!cmds) return null;
    if (!playing()) return 'The battle is over here.';
    const replies = cmds.map(runSegment).filter(Boolean);
    if (replies.length) return replies.join(' | ');
    audio('error');
    return `${SHRUGS[Math.floor(Math.random() * SHRUGS.length)]} Try "3 rocks", "big wall", "castle", "attack" or "help".`;
  }

  // ---------------- update
  let trickle = 0, regrow = 0;
  function update(dt) {
    dt = Math.min(dt || 0, 0.1);
    clock += dt;

    if (playing()) {
      if (firstUpdate) {
        firstUpdate = false;
        if (!(world.units || []).some((u) => u.type === 'miner' && u.team === 0)) spawnUnits('miner', 2);
      }
      trickle += dt;
      while (trickle >= 3) { trickle -= 3; world.blocks = blocks() + 1; }
      regrow += dt;
      if (regrow >= 20) { regrow = 0; if (ore.length < 25) { const p = randomPlayerSpot(); if (p) spawnCluster(p[0], p[1]); } }
      updateMiners(dt);
    } else if (placing) cancelPlacing(true);

    // ore shimmer
    for (const o of ore) o.mesh.rotation.y += dt * 0.3;

    // ghost
    if (placing) {
      const a = anchor(), g = placing.group;
      g.visible = !!a;
      if (a) {
        g.position.set(a[0], 0, a[1]);
        g.rotation.y = rot * Math.PI / 2;
        const ok = validSpot(a[0], a[1]) && blocks() >= placing.cost;
        ghostMat.color.setHex(ok ? 0x66ff99 : 0xff5555);
        ghostMat.opacity = 0.3 + Math.sin(clock * 6) * 0.08;
      }
    }

    // falling blocks
    for (let i = drops.length - 1; i >= 0; i--) {
      const b = drops[i];
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.mesh.visible = true;
      b.vy -= 45 * dt;
      b.mesh.position.y += b.vy * dt;
      if (b.mesh.position.y <= b.ty) {
        b.mesh.position.y = b.ty;
        if (clock - lastBuildSfx > 0.06 || b.last) { audio('build'); lastBuildSfx = clock; }
        if (b.last) game?.shake?.(0.15);
        drops.splice(i, 1);
      }
    }

    // debris
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt;
      f.vel.y -= 18 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.setScalar(Math.max(0.001, f.s * (f.life / f.max)));
      if (f.life <= 0) { scene.remove(f.mesh); fx.splice(i, 1); }
    }
  }

  return { update, handleCommand };
}
