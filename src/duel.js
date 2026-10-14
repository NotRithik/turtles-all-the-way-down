// Depth 2: first-person Rock/Paper/Scissors duel. See CONTRACT.md.
// Opponent circles you, raises its hand and morphs it into its throw (glowing) for a short window.
// You must be LOOKING at it to read the tell, then press 1/2/3 with the counter. Best of 3.
import * as THREE from 'three';
import { BEATS, TYPE_COLOR, TEAM_COLOR, TYPES, TYPE_NAME, makeRng } from './core.js';

const ARENA_R = 10;        // player clamp radius
const OPP_R = 11.5;        // opponent clamp radius
const PILLAR_R = 13.5;
const EYE = 1.6;
const MOVE_SPEED = 5;
const LOOK_SENS = 0.0022;
const TURN_SPEED = 2.6;    // arrow-key turn, rad/s
const WINDUP = 0.3;        // arm raise before the shape appears
const TELL = 0.6;          // shape visible + glowing
const GRACE = 0.12;        // a little input latency mercy
const RESULT_TIME = 1.3;
const OVER_TIME = 2.0;
const WINS_NEEDED = 2;
const KEY_TYPE = { Digit1: 'R', Digit2: 'P', Digit3: 'S', Numpad1: 'R', Numpad2: 'P', Numpad3: 'S' };
const CSS_COLOR = { win: '#5dff9d', lose: '#ff4d6d', tie: '#ffd23f' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function mat(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.55, metalness: 0.1, flatShading: true });
}

// A hand that morphs between a fist and the three RPS shapes. Shapes are "upright" in local +y.
function makeHand(size, fistColor) {
  const group = new THREE.Group();
  const s = size;
  const parts = {
    fist: new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat(fistColor)),
    R: new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.62, 1), mat(TYPE_COLOR.R)),
    P: new THREE.Mesh(new THREE.BoxGeometry(s * 1.1, s * 1.4, s * 0.12), mat(TYPE_COLOR.P)),
    S: new THREE.Group(),
  };
  const coneGeo = new THREE.ConeGeometry(s * 0.2, s * 1.4, 8);
  const coneMat = mat(TYPE_COLOR.S);
  for (const sx of [-1, 1]) {
    const c = new THREE.Mesh(coneGeo, coneMat);
    c.position.set(sx * s * 0.22, s * 0.35, 0);
    c.rotation.z = -sx * 0.32;
    parts.S.add(c);
  }
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(s * 0.6, s * 0.5, s * 0.5), coneMat);
  knuckle.position.y = -s * 0.35;
  parts.S.add(knuckle);
  const mats = new Set();
  for (const p of Object.values(parts)) {
    group.add(p);
    p.traverse((o) => o.material && mats.add(o.material));
  }
  return {
    group,
    shape: 'fist',
    set(key) {
      this.shape = key;
      for (const [k, p] of Object.entries(parts)) p.visible = k === key;
    },
    glow(color, k) {
      for (const m of mats) { m.emissive.setHex(color); m.emissiveIntensity = k; }
    },
  };
}

export class DuelWorld {
  constructor(game, { host, seed } = {}) {
    this.game = game; this.host = host; this.depth = 2; this.isDuel = true; this.state = 'playing';
    this.rng = makeRng(seed ?? (Math.random() * 1e9));
    const myTeam = host?.team === 1 ? 1 : 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0016);
    this.scene.fog = new THREE.Fog(0x0a0016, 10, 40);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera); // so the first-person fist renders

    this.player = new THREE.Vector3(0, 0, 6);
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.pWins = 0; this.oWins = 0; this.round = 1;
    this.phase = 'intro'; this.timer = 1.0;
    this.oppThrow = null; this.playerThrow = null;
    this.started = false; this.locked = false; this.lockFailed = false;
    this.t = 0; this.shakeT = 0; this.punchT = 0; this.hitT = 0; this.walk = 0;
    this._tmp = new THREE.Vector3();

    this._buildArena();
    this._buildOpponent(TEAM_COLOR[1 - myTeam]);
    this._buildFist(TEAM_COLOR[myTeam]);
    this._bindHandlers();
    this._syncCamera();
  }

  // ---------- scene ----------
  _buildArena() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x9a7dff, 0x14002a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(4, 10, 6);
    s.add(sun);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(PILLAR_R + 2, 48), new THREE.MeshStandardMaterial({ color: 0x0b0718, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const grid = new THREE.GridHelper(2 * (PILLAR_R + 2), 30, 0xff2bd6, 0x3b1d7a);
    grid.position.y = 0.01;
    grid.material.transparent = true; grid.material.opacity = 0.55;
    s.add(grid);
    const ring = new THREE.Mesh(new THREE.RingGeometry(ARENA_R + 0.35, ARENA_R + 0.55, 64), new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    s.add(ring);

    this.pillars = [];
    const pillarGeo = new THREE.CylinderGeometry(0.28, 0.28, 7, 8);
    const capGeo = new THREE.OctahedronGeometry(0.55, 0);
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const color = i % 2 ? 0xff2bd6 : 0x00f0ff;
      const m = new THREE.MeshBasicMaterial({ color });
      const p = new THREE.Mesh(pillarGeo, m);
      p.position.set(Math.cos(a) * PILLAR_R, 3.5, Math.sin(a) * PILLAR_R);
      const cap = new THREE.Mesh(capGeo, m);
      cap.position.set(p.position.x, 7.6, p.position.z);
      s.add(p, cap);
      this.pillars.push(cap);
    }
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(20, 0.15, 6, 64), new THREE.MeshBasicMaterial({ color: 0x7a3cff }));
    this.halo.position.y = 16; this.halo.rotation.x = Math.PI / 2;
    s.add(this.halo);
  }

  _buildOpponent(teamColor) {
    const g = new THREE.Group();
    this.bodyMat = mat(0x2a1f44);
    const accent = mat(teamColor, teamColor);
    accent.emissiveIntensity = 0.35;
    const box = (w, h, d, m, x, y, z) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      return b;
    };
    this.body = new THREE.Group();
    g.add(this.body);
    this.body.add(box(1.1, 1.1, 0.65, this.bodyMat, 0, 1.3, 0));          // torso
    this.body.add(box(1.15, 0.25, 0.7, accent, 0, 1.0, 0));               // belt
    this.body.add(box(0.7, 0.3, 0.1, accent, 0, 1.55, 0.33));             // chest plate
    this.head = box(0.62, 0.6, 0.6, this.bodyMat, 0, 2.15, 0);
    this.body.add(this.head);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    this.body.add(box(0.14, 0.1, 0.05, this.eyeMat, -0.14, 2.2, 0.31));
    this.body.add(box(0.14, 0.1, 0.05, this.eyeMat, 0.14, 2.2, 0.31));
    this.legs = [-0.25, 0.25].map((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.8, 0);
      leg.add(box(0.36, 0.8, 0.4, this.bodyMat, 0, -0.4, 0));
      leg.add(box(0.38, 0.18, 0.5, accent, 0, -0.72, 0.05));
      g.add(leg);
      return leg;
    });
    const arm = (x) => {
      const a = new THREE.Group();
      a.position.set(x, 1.75, 0);
      a.add(box(0.3, 0.9, 0.3, this.bodyMat, 0, -0.45, 0));
      this.body.add(a);
      return a;
    };
    this.armL = arm(-0.72);
    this.armR = arm(0.72);
    this.armAng = 0.15;
    this.oppHand = makeHand(0.55, teamColor);
    this.oppHand.set('fist');
    this.body.add(this.oppHand.group);
    this.tellHalo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.body.add(this.tellHalo);
    this.opp = g;
    this.scene.add(g);
    // AI motion state: orbit around the player
    this.ai = { angle: -Math.PI / 2, angVel: 0.7, radius: 5, targetRadius: 5, dirTimer: 1.2 };
    g.position.set(0, 0, 1);
  }

  _buildFist(teamColor) {
    this.fist = makeHand(0.17, teamColor);
    this.fist.set('fist');
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), mat(teamColor, teamColor));
    sleeve.material.emissiveIntensity = 0.2;
    sleeve.position.set(0.05, -0.12, 0.3);
    this.fistRig = new THREE.Group();
    this.fistRig.add(this.fist.group, sleeve);
    this.fistRig.rotation.set(0.15, -0.2, 0);
    this.camera.add(this.fistRig);
  }

  // ---------- input ----------
  _bindHandlers() {
    this._onKeyDown = (e) => {
      if (this.game?.isTyping?.()) return;
      const t = KEY_TYPE[e.code];
      if (t) { e.preventDefault(); this._throw(t); return; }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      // Edge zone: outer 12% of the screen turns continuously (-1 left … +1 right).
      const zone = innerWidth * 0.12, x = e.clientX;
      this.edge = x < zone ? -Math.min(1, (zone - x) / zone + 0.35) : x > innerWidth - zone ? Math.min(1, (x - (innerWidth - zone)) / zone + 0.35) : 0;
      if (!this.locked && !(this.lockFailed && this.started)) return;
      this.yaw -= (e.movementX || 0) * LOOK_SENS;
      this.pitch = clamp(this.pitch - (e.movementY || 0) * LOOK_SENS, -1.2, 1.2);
    };
    this._onMouseDown = (e) => {
      if (this.game?.isTyping?.()) return;
      if (e.target?.closest?.('input,textarea,button,.interactive')) return;
      this.started = true;
      if (!this.locked) this._requestLock();
    };
    this._onLockChange = () => {
      this.locked = !!document.pointerLockElement;
      if (this.locked) this.started = true;
    };
    this._onLockError = () => { this.lockFailed = true; };
    // Cursor left the window: keep turning toward the side it exited (stops when it comes back).
    this._onMouseOut = (e) => {
      if (e.relatedTarget) return;
      this.edge = e.clientX <= innerWidth / 2 ? -1 : 1;
    };
    this._onResize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    };
  }

  _requestLock() {
    const el = document.body;
    if (!el?.requestPointerLock) { this.lockFailed = true; return; }
    try {
      const p = el.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }

  get paused() { return !this.started || (!this.locked && !this.lockFailed); }

  activate() {
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    addEventListener('mousemove', this._onMouseMove);
    addEventListener('mousedown', this._onMouseDown);
    addEventListener('resize', this._onResize);
    document.addEventListener('mouseout', this._onMouseOut);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    this._onResize();
    this._buildHud();
  }

  deactivate() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('blur', this._onBlur);
    removeEventListener('mousemove', this._onMouseMove);
    removeEventListener('mousedown', this._onMouseDown);
    removeEventListener('resize', this._onResize);
    document.removeEventListener('mouseout', this._onMouseOut);
    this.edge = 0;
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.locked = false;
    this.keys.clear();
    this.ui?.root.remove();
    this.ui = null;
  }

  // ---------- HUD ----------
  _buildHud() {
    this.ui?.root.remove();
    const root = document.createElement('div');
    root.className = 'duel-hud';
    root.innerHTML = `
<style>
.duel-hud{position:absolute;inset:0;pointer-events:none;font-family:ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 0 8px #000}
.duel-hud .top{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:22px;align-items:center;font-size:15px;letter-spacing:2px}
.duel-hud .pips i{display:inline-block;width:14px;height:14px;margin:0 3px;border:2px solid currentColor;border-radius:50%;vertical-align:middle}
.duel-hud .pips i.on{background:currentColor;box-shadow:0 0 10px currentColor}
.duel-hud .you{color:#4f9bff}.duel-hud .foe{color:#ffa640}
.duel-hud .cross{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px}
.duel-hud .cross:before,.duel-hud .cross:after{content:'';position:absolute;background:#fff;box-shadow:0 0 4px #0ff}
.duel-hud .cross:before{left:8px;top:0;width:2px;height:18px}.duel-hud .cross:after{top:8px;left:0;height:2px;width:18px}
.duel-hud .big{position:absolute;left:0;right:0;top:26%;text-align:center;font-size:72px;font-weight:900;letter-spacing:4px;opacity:0}
.duel-hud .sub{position:absolute;left:0;right:0;top:calc(26% + 92px);text-align:center;font-size:18px;letter-spacing:2px;opacity:.9}
.duel-hud .keys{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);font-size:17px;letter-spacing:2px;white-space:nowrap}
.duel-hud .keys span{padding:4px 8px;border-radius:6px;transition:background .15s}
.duel-hud .keys span.on{background:rgba(255,255,255,.25)}
.duel-hud .keys b{color:#0ff}
.duel-hud .arrow{position:absolute;top:50%;font-size:42px;color:#ffa640;transform:translateY(-50%);display:none;animation:dlblink .5s infinite alternate}
.duel-hud .vig{position:absolute;inset:0;box-shadow:inset 0 0 160px 40px #ff0033;opacity:0}
.duel-hud .overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,0,22,.55);text-align:center}
.duel-hud .overlay h1{font-size:54px;margin:0 0 14px;letter-spacing:6px;color:#0ff;text-shadow:0 0 20px #0ff}
.duel-hud .overlay p{margin:4px;font-size:16px;opacity:.85}
@keyframes dlpop{0%{transform:scale(1.8);opacity:0}12%{transform:scale(1);opacity:1}75%{opacity:1}100%{opacity:0}}
@keyframes dlfade{0%{opacity:.8}100%{opacity:0}}
@keyframes dlblink{from{opacity:.4}to{opacity:1}}
</style>
<div class="top"><span class="you pips">YOU <i></i><i></i></span><span class="round">ROUND 1</span><span class="foe pips"><i></i><i></i> FOE</span></div>
<div class="cross"></div>
<div class="big"></div><div class="sub"></div>
<div class="keys"><span data-t="R"><b>1</b> ROCK</span> · <span data-t="P"><b>2</b> PAPER</span> · <span data-t="S"><b>3</b> SCISSORS</span></div>
<div class="arrow"></div>
<div class="vig"></div>
<div class="overlay"><h1>CLICK TO FIGHT</h1><p>Watch your foe's raised hand &mdash; it shows its throw for a split second.</p><p>Counter it: <b>1</b> ROCK &middot; <b>2</b> PAPER &middot; <b>3</b> SCISSORS &nbsp;|&nbsp; WASD move &middot; mouse look &middot; Q/E or screen edge to turn</p><p>Best of 3.</p></div>`;
    (document.getElementById('hud') || document.body).appendChild(root);
    const q = (sel) => root.querySelector(sel);
    this.ui = {
      root, big: q('.big'), sub: q('.sub'), round: q('.round'), arrow: q('.arrow'), vig: q('.vig'), overlay: q('.overlay'),
      you: root.querySelectorAll('.you i'), foe: root.querySelectorAll('.foe i'), keys: root.querySelectorAll('.keys span'),
      overlayShown: true,
    };
    this._renderPips();
  }

  _renderPips() {
    if (!this.ui) return;
    this.ui.you.forEach((el, i) => el.classList.toggle('on', i < this.pWins));
    this.ui.foe.forEach((el, i) => el.classList.toggle('on', i < this.oWins));
    this.ui.round.textContent = `ROUND ${Math.min(this.round, 3)}`;
  }

  _big(text, color, sub = '', dur = 1.2) {
    if (!this.ui) return;
    const { big } = this.ui;
    big.textContent = text; big.style.color = color; big.style.textShadow = `0 0 24px ${color}`;
    big.style.animation = 'none'; void big.offsetWidth; big.style.animation = `dlpop ${dur}s ease-out forwards`;
    this.ui.sub.textContent = sub;
  }

  _flashVig() {
    if (!this.ui) return;
    const v = this.ui.vig;
    v.style.animation = 'none'; void v.offsetWidth; v.style.animation = 'dlfade .6s ease-out forwards';
  }

  _markKey(t) {
    this.ui?.keys.forEach((el) => el.classList.toggle('on', el.dataset.t === t));
  }

  // ---------- game flow ----------
  _startRound() {
    this.phase = 'wait';
    this.timer = 0.9 + this.rng() * 1.8;
    this.oppThrow = TYPES[Math.floor(this.rng() * 3)];
    this.playerThrow = null;
    this.oppHand.set('fist');
    this.fist.set('fist');
    this.fist.glow(0x000000, 0);
    this._markKey(null);
    this._renderPips();
    if (this.ui) this.ui.sub.textContent = '';
  }

  _throw(t) {
    if (this.state !== 'playing' || this.paused) return;
    if (this.phase === 'tell' && !this.playerThrow) {
      this.playerThrow = t;
      this.fist.set(t);
      this.fist.glow(TYPE_COLOR[t], 0.45);
      this.punchT = 0.25;
      this._markKey(t);
      this._resolve(t);
    } else if (this.phase === 'wait' || this.phase === 'windup') {
      if (this.ui) this.ui.sub.textContent = 'wait for the tell…';
    }
  }

  _resolve(p) {
    const o = this.oppThrow;
    const N = TYPE_NAME;
    let kind, text, sub;
    if (!p) { kind = 'lose'; text = 'TOO SLOW'; sub = `It threw ${N[o]}`; }
    else if (p === o) { kind = 'tie'; text = 'TIE — AGAIN'; sub = `Both threw ${N[o]}`; }
    else if (BEATS[p] === o) { kind = 'win'; text = 'WIN!'; sub = `${N[p]} beats ${N[o]}`; }
    else { kind = 'lose'; text = 'LOSE'; sub = `${N[o]} beats ${N[p]}`; }

    if (kind === 'win') { this.pWins++; this.hitT = 0.5; }
    if (kind === 'lose') { this.oWins++; this.shakeT = 0.35; this._flashVig(); }
    if (kind !== 'tie') this.round++;
    this._renderPips();

    const audio = this.game?.audio;
    if (this.pWins >= WINS_NEEDED || this.oWins >= WINS_NEEDED) {
      const won = this.pWins >= WINS_NEEDED;
      this.phase = 'over'; this.timer = OVER_TIME;
      this._big(won ? 'VICTORY' : 'DEFEATED', CSS_COLOR[won ? 'win' : 'lose'], sub, OVER_TIME + 0.3);
      audio?.play?.(won ? 'win' : 'lose');
    } else {
      this.phase = 'result'; this.timer = RESULT_TIME;
      this._big(text, CSS_COLOR[kind], sub, RESULT_TIME);
      audio?.play?.(kind === 'win' ? 'throwWin' : kind === 'tie' ? 'throwTie' : 'throwLose');
    }
  }

  _stepFlow(dt) {
    this.timer -= dt;
    switch (this.phase) {
      case 'intro':
        if (this.timer <= 0) { this._big('FIGHT!', '#0ff', '', 0.9); this._startRound(); }
        break;
      case 'wait':
        if (this.timer <= 0) { this.phase = 'windup'; this.timer = WINDUP; }
        break;
      case 'windup':
        if (this.timer <= 0) {
          this.phase = 'tell'; this.timer = TELL + GRACE;
          this.oppHand.set(this.oppThrow);
          this.game?.audio?.play?.('telegraph');
        }
        break;
      case 'tell':
        if (this.timer <= 0) this._resolve(null);
        break;
      case 'result':
        if (this.timer <= 0) this._startRound();
        break;
      case 'over':
        if (this.timer <= 0 && this.state === 'playing') {
          this.state = this.pWins >= WINS_NEEDED ? 'won' : 'lost';
          this.game?.hud?.log?.(this.state === 'won' ? 'Duel won! Unit strengthened.' : 'Duel lost…');
        }
        break;
    }
  }

  // ---------- per-frame ----------
  update(dt) {
    dt = Math.min(dt || 0, 0.1);
    this.t += dt;
    for (let i = 0; i < this.pillars.length; i++) {
      const c = this.pillars[i];
      c.rotation.y += dt * 1.5;
      c.position.y = 7.6 + Math.sin(this.t * 2 + i) * 0.2;
    }
    this.halo.rotation.z += dt * 0.1;

    const paused = this.paused;
    if (this.ui && this.ui.overlayShown !== paused) {
      this.ui.overlay.style.display = paused ? 'flex' : 'none';
      this.ui.overlayShown = paused;
    }
    if (!paused && this.state === 'playing') {
      this._movePlayer(dt);
      this._stepFlow(dt);
    }
    this._animateOpponent(paused ? 0 : dt);
    this._animateFist(dt);
    this._syncCamera();
    this._updateArrow();
  }

  _movePlayer(dt) {
    if (this.game?.isTyping?.()) { this.keys.clear(); return; }
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyQ')) this.yaw += TURN_SPEED * dt;
    if (k.has('ArrowRight') || k.has('KeyE')) this.yaw -= TURN_SPEED * dt;
    // No pointer lock (e.g. embedded browsers): keep turning while the cursor sits in an edge zone or has left the window.
    if (!this.locked && this.started && this.edge) this.yaw -= this.edge * TURN_SPEED * dt;
    let f = 0, s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD')) s += 1;
    if (k.has('KeyA')) s -= 1;
    const moving = f || s;
    if (moving) {
      const len = Math.hypot(f, s);
      f /= len; s /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      this.player.x += (-sin * f + cos * s) * MOVE_SPEED * dt;
      this.player.z += (-cos * f - sin * s) * MOVE_SPEED * dt;
      const r = Math.hypot(this.player.x, this.player.z);
      if (r > ARENA_R) { this.player.x *= ARENA_R / r; this.player.z *= ARENA_R / r; }
      this.walk += dt * 9;
    }
  }

  _animateOpponent(dt) {
    const ai = this.ai, g = this.opp, rng = this.rng;
    if (dt > 0) {
      ai.dirTimer -= dt;
      if (ai.dirTimer <= 0) {
        ai.dirTimer = 0.7 + rng() * 1.6;
        ai.angVel = (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.8);
        ai.targetRadius = 4 + rng() * 2;
      }
      const boost = this.phase === 'tell' || this.phase === 'windup' ? 1.5 : 1;
      ai.angle += ai.angVel * boost * dt;
      ai.radius += (ai.targetRadius - ai.radius) * Math.min(1, dt * 2);
      const tx = this.player.x + Math.cos(ai.angle) * ai.radius;
      const tz = this.player.z + Math.sin(ai.angle) * ai.radius;
      const tr = Math.hypot(tx, tz), sc = tr > OPP_R ? OPP_R / tr : 1;
      const prevX = g.position.x, prevZ = g.position.z;
      const kk = Math.min(1, dt * 5);
      g.position.x += (tx * sc - g.position.x) * kk;
      g.position.z += (tz * sc - g.position.z) * kk;
      const speed = Math.hypot(g.position.x - prevX, g.position.z - prevZ) / dt;
      ai.stride = (ai.stride || 0) + speed * dt * 2.2;
      const swing = Math.sin(ai.stride) * Math.min(0.7, speed * 0.15);
      this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.8;
    }
    g.lookAt(this.player.x, 0, this.player.z);
    this.body.position.y = Math.abs(Math.sin((ai.stride || 0))) * 0.08;

    // raise right arm during windup/tell/result, then morph the hand
    const raised = ['windup', 'tell', 'result', 'over'].includes(this.phase) && this.oppThrow;
    const target = raised ? 2.75 : 0.15 + Math.sin(this.t * 3) * 0.08;
    this.armAng += (target - this.armAng) * Math.min(1, dt * (raised ? 14 : 6));
    this.armR.rotation.z = this.armAng;
    const L = 1.0;
    this.oppHand.group.position.set(0.72 + Math.sin(this.armAng) * L, 1.75 - Math.cos(this.armAng) * L, 0);

    // tell glow: hand + eyes + halo in the throw's color, only while the shape is showing
    const showing = this.oppHand.shape !== 'fist';
    const tellOn = this.phase === 'tell';
    const col = showing ? TYPE_COLOR[this.oppHand.shape] : 0x000000;
    const pulse = 0.7 + 0.3 * Math.sin(this.t * 30);
    this.oppHand.glow(col, showing ? (tellOn ? 0.9 * pulse : 0.4) : 0);
    this.eyeMat.color.setHex(tellOn ? col : 0x00f0ff);
    this.tellHalo.position.copy(this.oppHand.group.position);
    this.tellHalo.material.color.setHex(col);
    this.tellHalo.material.opacity = tellOn ? 0.35 * pulse : 0;
    this.tellHalo.visible = tellOn;

    // got hit: flash + tilt back
    this.hitT = Math.max(0, this.hitT - dt);
    this.bodyMat.emissive.setHex(0xffffff);
    this.bodyMat.emissiveIntensity = this.hitT * 1.6;
    if (this.hitT > 0) g.rotateX(-Math.sin((this.hitT / 0.5) * Math.PI) * 0.5);
  }

  _animateFist(dt) {
    this.punchT = Math.max(0, this.punchT - dt);
    const punch = Math.sin((this.punchT / 0.25) * Math.PI) * 0.22;
    const bob = Math.sin(this.walk) * 0.015;
    this.fistRig.position.set(0.45 + bob, -0.4 + Math.abs(bob), -0.85 - punch);
  }

  _syncCamera() {
    this.shakeT = Math.max(0, this.shakeT - 1 / 60);
    const sh = this.shakeT * 0.25;
    this.camera.position.set(
      this.player.x + (Math.random() - 0.5) * sh,
      EYE + Math.abs(Math.sin(this.walk)) * 0.04 + (Math.random() - 0.5) * sh,
      this.player.z + (Math.random() - 0.5) * sh,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  _updateArrow() {
    if (!this.ui) return;
    this.camera.updateMatrixWorld();
    const v = this._tmp.set(this.opp.position.x, 1.8, this.opp.position.z).project(this.camera);
    const onScreen = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
    const a = this.ui.arrow;
    if (onScreen || this.paused || this.state !== 'playing') { a.style.display = 'none'; return; }
    const dx = (this.opp.position.x - this.player.x) * Math.cos(this.yaw) - (this.opp.position.z - this.player.z) * Math.sin(this.yaw);
    a.style.display = 'block';
    a.textContent = dx > 0 ? '▶' : '◀';
    a.style.left = dx > 0 ? '' : '18px';
    a.style.right = dx > 0 ? '18px' : '';
  }

  winChance() {
    if (this.state === 'won') return 0.95;
    if (this.state === 'lost') return 0.05;
    return clamp(0.5 + 0.2 * (this.pWins - this.oWins), 0.1, 0.9);
  }

  dispose() {
    this.deactivate();
    const seen = new Set();
    this.scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (!seen.has(m)) { seen.add(m); m.dispose(); }
    });
    this.scene.clear();
  }
}
