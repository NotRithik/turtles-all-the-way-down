// Commander world (depth 0 = The Field, depth 1 = a mindscape inside a unit). Owned by RTS agent.
import * as THREE from 'three';
import { BEATS, TYPE_COLOR, TEAM_COLOR, TYPES, TYPE_NAME, makeRng, resolveRps } from './core.js';
import { installBuild } from './build.js';
import { installRockets } from './rockets.js';

let NEXT_ID = 1;
export const isFighter = (u) => u && (u.type === 'R' || u.type === 'P' || u.type === 'S');
export const unitName = (u) => `${TYPE_NAME[u.type] || u.type} #${u.id}`;

const ENGAGE = 6;
const SPEED = { R: 3.8, P: 4.2, S: 4.6, miner: 5, engineer: 4.5 };

// ---------- shared geometry / materials ----------
const G = {
  rock: new THREE.SphereGeometry(0.5, 14, 10),
  paper: new THREE.BoxGeometry(0.85, 0.12, 1.05),
  cone: new THREE.ConeGeometry(0.2, 0.95, 8),
  cube: new THREE.BoxGeometry(1, 1, 1),
  disc: new THREE.CylinderGeometry(0.62, 0.62, 0.06, 20),
  ring: new THREE.RingGeometry(0.78, 0.92, 28),
  torus: new THREE.TorusGeometry(0.72, 0.07, 6, 28),
};
const SHARED_GEO = new Set(Object.values(G));
const lam = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
const M = {
  R: lam(TYPE_COLOR.R), P: lam(TYPE_COLOR.P), S: lam(TYPE_COLOR.S),
  miner: lam(0xffd400), engineer: lam(0xff7a00),
  team: TEAM_COLOR.map((c) => lam(c)),
  sel: new THREE.MeshBasicMaterial({ color: 0x7dff7d, side: THREE.DoubleSide }),
  hover: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
  gold: lam(0xffc400, { emissive: 0x664400 }),
  trunk: lam(0x6b4423), leaf: lam(0x2f6b2a), leaf2: lam(0x3d8a34),
  crystal: lam(0x9b5cff, { emissive: 0x3a1070 }),
};
const CORE_M = TEAM_COLOR.map((c) => [0.75, 0.9, 1.0].map((k) => lam(new THREE.Color(c).multiplyScalar(k))));
const GEM_M = TEAM_COLOR.map((c) => lam(c, { emissive: c, emissiveIntensity: 0.6 }));

const scaleOf = (u) => (isFighter(u) ? 1 : 0.6) * (1 + 0.3 * Math.log2(Math.max(1, u.strength || 1)));
const radiusOf = (u) => 0.5 * scaleOf(u);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

let boxEl = null;
function selBox() {
  if (!boxEl) {
    boxEl = document.createElement('div');
    boxEl.style.cssText = 'position:fixed;border:1px solid #7dff7d;background:rgba(125,255,125,.12);display:none;pointer-events:none;z-index:5';
    (document.getElementById('hud') || document.body).appendChild(boxEl);
  }
  return boxEl;
}

export class World {
  constructor(game, { depth = 0, seed = 1, host = null } = {}) {
    this.game = game; this.depth = depth; this.host = host; this.isDuel = false;
    this.rng = makeRng(seed);
    this.state = 'playing';
    this.size = depth === 0 ? 40 : 20;
    this.units = []; this.debris = []; this.pings = []; this.decor = []; this.plugins = [];
    this.blocks = depth === 0 ? 30 : 0;
    this.mouseGround = new THREE.Vector3();
    this.hovered = null; this.active = false; this.time = 0;
    this._installed = depth !== 0; this._drag = null; this._lastHitLog = -99;
    this._ray = new THREE.Raycaster(); this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400);
    this.camOffset = depth === 0 ? new THREE.Vector3(0, 30, 21) : new THREE.Vector3(0, 32, 22);
    this.camTarget = new THREE.Vector3(0, 0, depth === 0 ? this.size - 14 : 2);

    this._buildEnv();
    this._buildCores();
    if (depth === 0) this._setupField(); else this._setupMind();

    this.hoverRing = new THREE.Mesh(G.ring, M.hover);
    this.hoverRing.rotation.x = -Math.PI / 2; this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
    this._updateCamera();
  }

  // ---------- setup ----------
  _buildEnv() {
    const s = this.size, d0 = this.depth === 0;
    const bg = new THREE.Color(d0 ? 0x9fd3f0 : 0x0c0614);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 70, 150);
    this.scene.add(new THREE.HemisphereLight(d0 ? 0xe8f6ff : 0xc49cff, d0 ? 0x3a5a2a : 0x2a1440, d0 ? 1.1 : 1.7));
    const sun = new THREE.DirectionalLight(d0 ? 0xfff4dd : 0xd8b8ff, d0 ? 1.6 : 1.7);
    sun.position.set(-18, 40, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -s - 4, right: s + 4, top: s + 4, bottom: -s - 4, near: 1, far: 120 });
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(s * 2, s * 2), lam(d0 ? 0x5c9e3e : 0x2a1544));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(s * 8, s * 8), lam(d0 ? 0x3f7a2c : 0x100618));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05;
    this.scene.add(outer);

    if (d0) {
      for (let i = 0; i < 34; i++) {
        const x = (Math.random() < 0.5 ? -1 : 1) * (11 + Math.random() * (s - 13));
        const z = (Math.random() * 2 - 1) * (s - 2);
        const h = 0.8 + Math.random() * 0.8;
        const trunk = new THREE.Mesh(G.cube, M.trunk);
        trunk.scale.set(0.45, h, 0.45); trunk.position.set(x, h / 2, z);
        const leaf = new THREE.Mesh(G.cube, Math.random() < 0.5 ? M.leaf : M.leaf2);
        const ls = 1.3 + Math.random() * 0.8;
        leaf.scale.setScalar(ls); leaf.position.set(x, h + ls / 2 - 0.1, z);
        trunk.castShadow = leaf.castShadow = true;
        this.scene.add(trunk, leaf);
      }
    } else {
      const grid = new THREE.GridHelper(s * 2, s, 0x8a4dff, 0x3d1f66);
      grid.position.y = 0.02;
      this.scene.add(grid);
      const oct = new THREE.OctahedronGeometry(1);
      for (let i = 0; i < 16; i++) {
        const c = new THREE.Mesh(oct, M.crystal);
        const a = (i / 16) * Math.PI * 2;
        c.position.set(Math.cos(a) * (s + 3), 3 + Math.random() * 3, Math.sin(a) * (s + 3));
        c.scale.set(0.8, 1.6, 0.8).multiplyScalar(0.8 + Math.random());
        c.userData.spin = 0.3 + Math.random();
        this.decor.push(c); this.scene.add(c);
      }
    }
  }

  _buildCores() {
    const layers = this.depth === 0 ? [5, 3, 1, 1] : [3, 2, 1];
    this.cores = [0, 1].map((team) => {
      const pos = new THREE.Vector3(0, 0, (team === 0 ? 1 : -1) * (this.size - 5));
      const group = new THREE.Group(); group.position.copy(pos);
      const blocks = [];
      layers.forEach((n, y) => {
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const top = y === layers.length - 1;
          const b = new THREE.Mesh(G.cube, top ? GEM_M[team] : CORE_M[team][(i + j + y) % 3]);
          b.scale.setScalar(0.96);
          b.position.set(i - (n - 1) / 2, y + 0.5, j - (n - 1) / 2);
          b.castShadow = true;
          group.add(b); blocks.push(b);
        }
      });
      this.scene.add(group);
      return { team, pos, group, blocks, max: blocks.length, radius: layers[0] / 2 + 0.6 };
    });
  }

  _setupField() {
    const c = this.cores[0].pos;
    TYPES.forEach((t, ti) => {
      for (let i = 0; i < 4; i++) {
        this.spawnUnit({ type: t, team: 0, x: c.x + (ti - 1) * 4.5 + (i % 2) * 1.5 - 0.75, z: c.z - 6 - Math.floor(i / 2) * 1.5 });
      }
    });
    this.spawnUnit({ type: 'miner', team: 0, x: c.x - 4.5, z: c.z + 1 });
    this.spawnUnit({ type: 'miner', team: 0, x: c.x + 4.5, z: c.z + 1 });
    this.spawnUnit({ type: 'engineer', team: 0, x: c.x + 6.5, z: c.z - 1 });
    const e = this.cores[1].pos;
    for (let i = 0; i < 6; i++) {
      this.spawnUnit({ type: TYPES[i % 3], team: 1, x: e.x + (i - 2.5) * 2, z: e.z + 6 + (this.rng() - 0.5) * 2 });
    }
    this.wave = 0; this.waveTimer = 25;
  }

  _setupMind() {
    const ht = this.host && TYPES.includes(this.host.type) ? this.host.type : TYPES[Math.floor(this.rng() * 3)];
    const counter = TYPES.find((t) => BEATS[t] === ht);
    const lvl = Math.log2(Math.max(1, this.host?.strength || 1));
    const rt = () => TYPES[Math.floor(this.rng() * 3)];
    const b = this.cores[0].pos, r = this.cores[1].pos;
    for (let i = 0; i < 6; i++) {
      this.spawnUnit({ type: i < 3 ? ht : rt(), team: 0, x: (i - 2.5) * 1.8, z: b.z - 5 - (i % 2) * 1.4 });
    }
    const nRed = 7 + Math.round(2 * lvl);
    for (let i = 0; i < nRed; i++) {
      this.spawnUnit({ type: i < 3 ? counter : rt(), team: 1, x: (i - (nRed - 1) / 2) * 1.7, z: r.z + 5 + (i % 2) * 1.4 });
    }
    this._redGo = false;
  }

  // ---------- contract API ----------
  corePos(team) { return this.cores[team].pos.clone(); }

  spawnUnit({ type, team = 0, x = 0, z = 0, strength = 1 }) {
    const u = {
      id: NEXT_ID++, type, team, pos: new THREE.Vector3(x, 0, z), moveTarget: null,
      speed: SPEED[type] ?? 4, strength, alive: true, selected: false, target: null, frozen: false,
    };
    this._makeMesh(u);
    this.scene.add(u.mesh);
    this.units.push(u);
    return u;
  }

  removeUnit(u) {
    if (!u || !u.alive) return;
    u.alive = false; u.selected = false;
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    if (u.mesh) this.scene.remove(u.mesh);
    if (this.hovered === u) this.hovered = null;
    this._puff(u.pos, M[u.type] || M.R, 9, scaleOf(u));
  }

  damageCore(team, amount) {
    const core = this.cores[team];
    if (!core || !core.blocks.length) return;
    let n = Math.max(1, Math.round(amount));
    while (n-- > 0 && core.blocks.length) {
      const b = core.blocks.pop();
      const wp = new THREE.Vector3(); b.getWorldPosition(wp);
      core.group.remove(b);
      b.position.copy(wp); this.scene.add(b);
      this.debris.push({
        mesh: b, half: 0.48, base: 0.96, life: 2.5 + Math.random() * 1.5,
        vel: new THREE.Vector3((Math.random() - 0.5) * 9, 5 + Math.random() * 7, (Math.random() - 0.5) * 9),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      });
    }
    if (this.active) { this.game.shake(0.35); this.game.audio.play('explosion'); }
    if (team === 0 && this.time - this._lastHitLog > 3) {
      this._lastHitLog = this.time;
      this.game.hud.log(this.depth === 0 ? `Your core is under attack! (${core.blocks.length}/${core.max})` : `Inner core hit! (${core.blocks.length}/${core.max})`);
    }
    if (!core.blocks.length && this.state === 'playing') {
      this.state = team === 0 ? 'lost' : 'won';
      this._puff(core.pos.clone().setY(1), CORE_M[team][2], 24, 2.5);
      if (this.active) this.game.shake(1.2);
    }
  }

  coreIntegrity(team) { const c = this.cores[team]; return c.blocks.length / c.max; }
  fighters(team) { return this.units.filter((u) => u.alive && u.team === team && isFighter(u)); }

  winChance() {
    if (this.state === 'won') return 1;
    if (this.state === 'lost') return 0;
    let a = 0, b = 0;
    for (const u of this.units) if (isFighter(u)) { if (u.team === 0) a += u.strength; else b += u.strength; }
    return a + b > 0 ? a / (a + b) : 0.5;
  }

  // ---------- activation / input ----------
  activate() {
    this.active = true;
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    const el = this.game.renderer.domElement;
    el.addEventListener('mousedown', this._onDown);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);
    el.addEventListener('contextmenu', this._onCtx);
  }

  deactivate() {
    this.active = false; this._drag = null; this.hovered = null; this.hoverRing.visible = false;
    selBox().style.display = 'none';
    const el = this.game.renderer.domElement;
    el.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    el.removeEventListener('contextmenu', this._onCtx);
  }

  dispose() {
    this.deactivate();
    this.scene.traverse((o) => { if (o.geometry && !SHARED_GEO.has(o.geometry)) o.geometry.dispose(); });
    this.scene.clear();
  }

  _onCtx = (e) => e.preventDefault();
  _onDown = (e) => {
    if (e.button === 0) this._drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, shift: e.shiftKey, box: false };
    else if (e.button === 2) this._commandMove();
  };
  _onMove = (e) => {
    const d = this._drag;
    if (!d) return;
    d.x1 = e.clientX; d.y1 = e.clientY;
    if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6) d.box = true;
    if (d.box) {
      const el = selBox();
      Object.assign(el.style, {
        display: 'block', left: Math.min(d.x0, d.x1) + 'px', top: Math.min(d.y0, d.y1) + 'px',
        width: Math.abs(d.x1 - d.x0) + 'px', height: Math.abs(d.y1 - d.y0) + 'px',
      });
    }
  };
  _onUp = (e) => {
    const d = this._drag;
    if (e.button !== 0 || !d) return;
    this._drag = null;
    selBox().style.display = 'none';
    if (!d.shift) for (const u of this.units) u.selected = false;
    let n = 0;
    if (d.box) {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      const v = new THREE.Vector3();
      for (const u of this.units) {
        if (u.team !== 0 || !isFighter(u) || u.frozen) continue;
        v.copy(u.pos).setY(0.5).project(this.camera);
        const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) { u.selected = true; n++; }
      }
    } else {
      const h = this._pick();
      if (h) { h.selected = !(d.shift && h.selected); n = 1; }
    }
    if (n) this.game.audio.play('select');
  };

  selectAll() {
    for (const u of this.units) u.selected = u.team === 0 && isFighter(u) && !u.frozen;
    this.game.audio.play('select');
  }

  _commandMove() {
    const sel = this.units.filter((u) => u.selected && u.alive && !u.frozen);
    if (!sel.length) return;
    const p = this.mouseGround.clone();
    const cols = Math.ceil(Math.sqrt(sel.length)), rows = Math.ceil(sel.length / cols);
    const lim = this.size - 1;
    sel.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      u.moveTarget = new THREE.Vector3(
        THREE.MathUtils.clamp(p.x + (c - (cols - 1) / 2) * 1.5, -lim, lim), 0,
        THREE.MathUtils.clamp(p.z + (r - (rows - 1) / 2) * 1.5, -lim, lim));
      u.target = null;
    });
    const ping = new THREE.Mesh(G.ring, M.sel);
    ping.rotation.x = -Math.PI / 2; ping.position.set(p.x, 0.08, p.z);
    this.scene.add(ping); this.pings.push({ mesh: ping, life: 0.45 });
    this.game.audio.play('move');
  }

  _pick() {
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (u.team !== 0 || !isFighter(u) || u.frozen) continue;
      const d = d2(u.pos, this.mouseGround);
      if (d < radiusOf(u) + 0.7 && d < bd) { bd = d; best = u; }
    }
    return best;
  }

  // ---------- simulation ----------
  update(dt) {
    this.time += dt;
    if (!this._installed) {
      this._installed = true;
      for (const fn of [installBuild, installRockets]) {
        try { const p = fn(this, this.game); if (p) this.plugins.push(p); } catch (e) { console.error('plugin install failed', e); }
      }
    }
    if (this.active) {
      if (!this.game.isTyping()) this._pan(dt);
      this._updateCamera();
      this._ray.setFromCamera(this.game.mouse.ndc, this.camera);
      this._ray.ray.intersectPlane(this._plane, this.mouseGround);
      this.hovered = this._drag?.box ? null : this._pick();
    }
    if (this.state === 'playing') {
      if (this.depth === 0) this._enemyWaves(dt);
      else if (!this._redGo && this.time > 3) {
        this._redGo = true;
        const t = this.corePos(0);
        for (const u of this.units) if (u.team === 1) u.moveTarget = t.clone().add(new THREE.Vector3((this.rng() - 0.5) * 3, 0, 0));
      }
    }
    this._simUnits(dt);
    this._separate();
    for (const p of this.plugins) {
      try { p.update(dt); } catch (e) { if (!p._err) { p._err = 1; console.error('plugin update failed', e); } }
    }
    if (this.depth === 1 && this.state === 'playing') {
      if (!this.fighters(1).length) this.state = 'won';
      else if (!this.fighters(0).length) this.state = 'lost';
    }
    this._animate(dt);
    this._updateCamera();
  }

  _pan(dt) {
    const k = this.game.keys;
    let dx = 0, dz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) dz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
    const sp = 24 * dt;
    this.camTarget.x = THREE.MathUtils.clamp(this.camTarget.x + dx * sp, -this.size, this.size);
    this.camTarget.z = THREE.MathUtils.clamp(this.camTarget.z + dz * sp, -this.size, this.size);
  }

  _updateCamera() {
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget);
  }

  _enemyWaves(dt) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.wave++;
    const n = 3 + Math.floor(this.wave * 1.6);
    const c = this.cores[1].pos, goal = this.corePos(0);
    for (let i = 0; i < n; i++) {
      const u = this.spawnUnit({ type: TYPES[Math.floor(this.rng() * 3)], team: 1, x: c.x + (this.rng() - 0.5) * 12, z: c.z + 4 + this.rng() * 3 });
      if (this.rng() < (this.wave - 3) * 0.08) u.strength = 2;
      u.moveTarget = goal.clone().add(new THREE.Vector3((this.rng() - 0.5) * 3, 0, 0));
    }
    this.waveTimer = Math.max(12, 20 - this.wave);
    this.game.hud.log(`Wave ${this.wave}: ${n} enemies march on your core!`);
    if (this.active) this.game.audio.play('telegraph');
  }

  _simUnits(dt) {
    const playing = this.state === 'playing';
    for (const u of this.units.slice()) {
      if (!u.alive || u.frozen) continue;
      let goal = null;
      if (isFighter(u) && playing) {
        let t = u.target;
        if (t && (!t.alive || t.frozen || d2(t.pos, u.pos) > ENGAGE * 1.5)) t = u.target = null;
        if (!t) {
          let bd = ENGAGE;
          for (const o of this.units) {
            if (o.team === u.team || !isFighter(o) || o.frozen || !o.alive) continue;
            const d = d2(o.pos, u.pos);
            if (d < bd) { bd = d; t = o; }
          }
          u.target = t;
        }
        if (t) {
          if (d2(t.pos, u.pos) < radiusOf(u) + radiusOf(t) + 0.15) { this._clash(u, t); if (!u.alive) continue; }
          else goal = t.pos;
        }
        const ec = this.cores[1 - u.team];
        if (ec.blocks.length && d2(u.pos, ec.pos) < ec.radius + radiusOf(u)) {
          this.damageCore(1 - u.team, 3 * u.strength);
          this.removeUnit(u);
          continue;
        }
      }
      if (!goal && u.moveTarget) {
        if (d2(u.pos, u.moveTarget) < 0.35) u.moveTarget = null;
        else goal = u.moveTarget;
      }
      if (goal) {
        const dx = goal.x - u.pos.x, dz = goal.z - u.pos.z, L = Math.hypot(dx, dz) || 1;
        const step = Math.min(L, u.speed * dt);
        u.pos.x += dx / L * step; u.pos.z += dz / L * step;
        u._face = Math.atan2(dx, dz);
        u._moving = true;
      } else u._moving = false;
    }
  }

  _clash(a, b) {
    const res = resolveRps(a.type, a.strength, b.type, b.strength, this.rng);
    const [w, l] = res === 'a' ? [a, b] : [b, a];
    w.target = null;
    if (l.team === 0 && l.strength > 1) this.game.hud.log(`Your champion ${unitName(l)} (×${l.strength}) fell.`);
    this.removeUnit(l);
    if (this.active) {
      this.game.audio.play('clash'); this.game.audio.play('die');
      this.game.shake(0.08);
    }
  }

  _separate() {
    const us = this.units, lim = this.size - 0.5;
    for (let i = 0; i < us.length; i++) {
      const a = us[i], ra = radiusOf(a);
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = (ra + radiusOf(b)) * 0.9;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const nx = d > 1e-4 ? dx / d : Math.random() - 0.5, nz = d > 1e-4 ? dz / d : Math.random() - 0.5;
        const push = (min - d) * 0.5;
        const fa = a.frozen ? 0 : b.frozen ? 2 : 1, fb = b.frozen ? 0 : a.frozen ? 2 : 1;
        a.pos.x -= nx * push * fa; a.pos.z -= nz * push * fa;
        b.pos.x += nx * push * fb; b.pos.z += nz * push * fb;
      }
      a.pos.x = THREE.MathUtils.clamp(a.pos.x, -lim, lim);
      a.pos.z = THREE.MathUtils.clamp(a.pos.z, -lim, lim);
    }
  }

  // ---------- visuals ----------
  _makeMesh(u) {
    const g = new THREE.Group(), body = new THREE.Group();
    g.add(body);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };
    if (u.type === 'R') add(G.rock, M.R, 0, 0.55, 0);
    else if (u.type === 'P') add(G.paper, M.P, 0, 0.45, 0).rotation.x = 0.15;
    else if (u.type === 'S') {
      add(G.cone, M.S, -0.13, 0.55, 0).rotation.z = 0.35;
      add(G.cone, M.S, 0.13, 0.55, 0).rotation.z = -0.35;
    } else {
      add(G.cube, M[u.type] || M.miner, 0, 0.45, 0).scale.setScalar(0.75);
    }
    const disc = new THREE.Mesh(G.disc, M.team[u.team] || M.team[0]);
    disc.position.y = 0.03; disc.receiveShadow = true; g.add(disc);
    const sel = new THREE.Mesh(G.ring, M.sel);
    sel.rotation.x = -Math.PI / 2; sel.position.y = 0.07; sel.visible = false; g.add(sel);
    const gold = new THREE.Mesh(G.torus, M.gold);
    gold.rotation.x = Math.PI / 2; gold.position.y = 0.12; gold.visible = false; g.add(gold);
    g.position.copy(u.pos);
    u.mesh = g; u._body = body; u._sel = sel; u._gold = gold; u._vs = -1; u._face = Math.PI;
    u._phase = Math.random() * 6;
  }

  _animate(dt) {
    const t = this.time;
    for (const u of this.units) {
      if (!u.mesh) continue;
      if (u._vs !== u.strength) {
        u._vs = u.strength;
        u.mesh.scale.setScalar(scaleOf(u));
        u._gold.visible = u.strength > 1;
      }
      u.mesh.position.set(u.pos.x, 0, u.pos.z);
      u._sel.visible = !!u.selected;
      const bob = u.frozen ? 0 : (u._moving ? Math.abs(Math.sin(t * 10 + u._phase)) * 0.15 : Math.sin(t * 2 + u._phase) * 0.04);
      u._body.position.y = bob;
      let dr = (u._face ?? 0) - u._body.rotation.y;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      u._body.rotation.y += dr * Math.min(1, dt * 10);
      if (u.frozen) u._body.rotation.y += dt * 3; // host is "away": spin slowly
    }
    const h = this.hovered;
    this.hoverRing.visible = !!h;
    if (h) { this.hoverRing.position.set(h.pos.x, 0.09, h.pos.z); this.hoverRing.scale.setScalar(scaleOf(h) * (1.15 + Math.sin(t * 8) * 0.06)); }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i], m = d.mesh;
      d.life -= dt;
      d.vel.y -= 22 * dt;
      m.position.addScaledVector(d.vel, dt);
      m.rotation.x += d.spin.x * dt; m.rotation.y += d.spin.y * dt; m.rotation.z += d.spin.z * dt;
      if (m.position.y < d.half) {
        m.position.y = d.half; d.vel.y *= -0.35; d.vel.x *= 0.7; d.vel.z *= 0.7; d.spin.multiplyScalar(0.6);
      }
      if (d.life < 0.6) m.scale.setScalar(d.base * Math.max(0.01, d.life / 0.6));
      if (d.life <= 0) { this.scene.remove(m); this.debris.splice(i, 1); }
    }
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.life -= dt;
      p.mesh.scale.setScalar(Math.max(0.01, p.life / 0.45) * 1.4);
      if (p.life <= 0) { this.scene.remove(p.mesh); this.pings.splice(i, 1); }
    }
    for (const c of this.decor) { c.rotation.y += c.userData.spin * dt; c.position.y += Math.sin(t + c.userData.spin * 5) * dt * 0.3; }
  }

  _puff(pos, mat, n, scale = 1) {
    if (this.debris.length > 400) return;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(G.cube, mat);
      const s = (0.18 + Math.random() * 0.14) * scale;
      m.scale.setScalar(s);
      m.position.set(pos.x, 0.5 * scale, pos.z);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      this.debris.push({
        mesh: m, half: s / 2, base: s, life: 0.7 + Math.random() * 0.6,
        vel: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 5, Math.sin(a) * sp),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
      });
    }
  }
}
