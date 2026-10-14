// Entry point: renderer, loop, HUD, `game` object, fractal dive glue. Owned by RTS agent.
import * as THREE from 'three';
import * as audio from './audio.js';
import { World, isFighter, unitName } from './world.js';
import { DuelWorld } from './duel.js';

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

// ---------- HUD ----------
const css = document.createElement('style');
css.textContent = `
#hud{font-size:13px;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.6);user-select:none}
#hud .p{position:absolute}
#h-tl{top:12px;left:14px}
#h-depth{font-size:22px;font-weight:bold;letter-spacing:2px}
#h-crumb{opacity:.85;margin-top:2px}
#h-tr{top:12px;right:14px;text-align:right;line-height:1.6}
.bar{display:inline-block;width:120px;height:9px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.4);vertical-align:middle;margin-left:6px}
.bar>i{display:block;height:100%}
#h-log{left:14px;bottom:52px;width:min(560px,70vw);line-height:1.45}
#h-log div{animation:hlog 9s forwards}
@keyframes hlog{0%,75%{opacity:1}100%{opacity:.3}}
#h-flash{left:0;right:0;top:34%;text-align:center;font-size:64px;font-weight:bold;letter-spacing:4px;opacity:0}
#h-flash.go{animation:hflash 1.8s ease-out forwards}
@keyframes hflash{0%{opacity:0;transform:scale(1.6)}12%{opacity:1;transform:scale(1)}70%{opacity:1}100%{opacity:0;transform:scale(.96)}}
#h-over{left:0;right:0;top:30%;text-align:center;display:none}
#h-over b{display:block;font-size:96px;letter-spacing:8px}
#h-cmd{left:14px;bottom:14px;width:min(560px,70vw);padding:7px 10px;font:inherit;color:#fff;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.3);border-radius:4px;outline:none}
#h-cmd:focus{border-color:#7dff7d;background:rgba(0,0,0,.75)}
#h-help{right:14px;bottom:14px;text-align:right;opacity:.7;font-size:11px;line-height:1.5}
#h-tip{display:none;padding:3px 7px;background:rgba(0,0,0,.65);border-radius:3px;font-size:12px;white-space:nowrap}
#h-fade{inset:0;background:#000;opacity:0}
`;
document.head.appendChild(css);
const hudEl = document.getElementById('hud');
hudEl.innerHTML = `
<div class="p" id="h-fade"></div>
<div class="p" id="h-tl"><div id="h-depth"></div><div id="h-crumb"></div></div>
<div class="p" id="h-tr"></div>
<div class="p" id="h-log"></div>
<div class="p" id="h-flash"></div>
<div class="p" id="h-over"></div>
<div class="p" id="h-tip"></div>
<div class="p" id="h-help">LMB click/drag: select · RMB: attack-move · Q: select all · WASD/arrows: pan<br>
Hover a fighter + scroll in (or Z): dive inside · scroll out (or X): surface<br>T / Enter: command box (try "help")</div>
<input class="p interactive" id="h-cmd" placeholder="T / Enter to type a command…" autocomplete="off" spellcheck="false">`;
const $ = (id) => document.getElementById(id);
const el = { tl: $('h-depth'), crumb: $('h-crumb'), tr: $('h-tr'), log: $('h-log'), flash: $('h-flash'), over: $('h-over'), tip: $('h-tip'), cmd: $('h-cmd'), fade: $('h-fade') };

const hud = {
  log(msg) {
    const d = document.createElement('div');
    d.textContent = String(msg);
    el.log.appendChild(d);
    while (el.log.children.length > 7) el.log.firstChild.remove();
  },
  flash(text, color = '#fff') {
    el.flash.textContent = text;
    el.flash.style.color = color;
    el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go');
  },
};

// ---------- game object ----------
let shakeAmt = 0;
const stack = [];
const game = {
  renderer, audio, hud, stack,
  keys: new Set(),
  mouse: { x: innerWidth / 2, y: innerHeight / 2, ndc: new THREE.Vector2() },
  get active() { return stack[stack.length - 1]; },
  get root() { return stack[0]; },
  shake(a = 0.3) { shakeAmt = Math.min(2, Math.max(shakeAmt, a) + a * 0.3); },
  isTyping() { return document.activeElement === el.cmd; },
  dive: (u) => dive(u), surface: () => scrollOut(),
};
window.game = game;
const play = (n) => { try { audio.play(n); } catch (e) { /* never break the game for audio */ } };

// ---------- fractal dive ----------
let transition = null, over = false;

function fitCamera(w) {
  if (w?.camera?.isPerspectiveCamera) { w.camera.aspect = innerWidth / innerHeight; w.camera.updateProjectionMatrix(); }
}

function startTransition(unit, mid) { transition = { t: 0, phase: 'out', unit, mid }; }

function dive(unit, fromKey = false) {
  const a = game.active;
  if (transition || over || !a || !(a instanceof World)) return false;
  unit = unit || a.hovered || (fromKey ? a.units.find((u) => u.selected && u.alive && isFighter(u) && u.team === 0) : null);
  if (!unit || !unit.alive || unit.team !== 0 || !isFighter(unit)) {
    if (fromKey) { hud.log('Hover one of your fighters (or select one) to dive inside it.'); play('error'); }
    return false;
  }
  unit.frozen = true; unit.selected = false; unit.target = null;
  play('dive');
  startTransition(unit, () => {
    let inner = unit.inner;
    if (!inner) {
      const seed = (unit.id * 2654435761 + 12345) >>> 0;
      try {
        inner = a.depth === 0 ? new World(game, { depth: 1, seed, host: unit }) : new DuelWorld(game, { host: unit, seed });
      } catch (e) {
        console.error('inner world failed', e);
        unit.frozen = false; hud.log('The mind is closed (inner world failed to load).');
        return;
      }
      unit.inner = inner;
    }
    a.deactivate();
    stack.push(inner);
    fitCamera(inner);
    inner.activate();
    hud.flash(`INSIDE ${unitName(unit).toUpperCase()}`, '#c9a2ff');
    if (inner.isDuel) hud.log(`Depth 2: a one-on-one duel inside ${unitName(unit)}. Win it to double its strength.`);
    else hud.log(`Depth ${inner.depth}: the war inside ${unitName(unit)}. Destroy the enemy core or army to double its strength. Lose and you get BOOTED.`);
  });
  return true;
}

function surface(win) {
  if (transition || stack.length < 2) return;
  const child = game.active, parent = stack[stack.length - 2], host = child.host;
  play('surface');
  startTransition(null, () => {
    try { child.deactivate(); } catch (e) { console.error(e); }
    try { child.dispose(); } catch (e) { console.error(e); }
    stack.pop();
    fitCamera(parent);
    parent.activate();
    if (!host) return;
    host.frozen = false; host.inner = null;
    if (parent.camTarget) parent.camTarget.set(host.pos.x, 0, host.pos.z + 4);
    if (!host.alive) { hud.log(`${unitName(host)} did not survive while you were away.`); return; }
    if (win) {
      const before = host.strength;
      host.strength = Math.min(8, host.strength * 2);
      hud.flash(host.strength > before ? 'WAR WON — ×2' : 'WAR WON — MAXED', '#ffd34d');
      hud.log(`${unitName(host)} returns victorious: strength ${before} → ${host.strength}.`);
      play('win');
    } else {
      parent.removeUnit(host);
      hud.flash('BOOTED', '#ff4040');
      hud.log(`You lost the war inside ${unitName(host)}. It is gone.`);
      game.shake(1.2);
      play('booted');
    }
  });
}

function scrollOut() {
  if (transition || stack.length < 2) {
    if (!transition && stack.length === 1 && !over) hud.log("You're at the top. (Or are you?)");
    return;
  }
  const a = game.active;
  if (a.state === 'won' || a.state === 'lost') return surface(a.state === 'won');
  let p = 0.5;
  try { p = a.winChance(); } catch (e) { console.error(e); }
  const win = Math.random() < p;
  hud.log(`Auto-resolved at ${Math.round(p * 100)}% → ${win ? 'WON' : 'LOST'}`);
  surface(win);
}

function gameOver(win) {
  over = true;
  el.over.style.display = 'block';
  el.over.innerHTML = `<b style="color:${win ? '#ffd34d' : '#ff4040'}">${win ? 'VICTORY' : 'DEFEAT'}</b>press R to restart`;
  play(win ? 'win' : 'lose');
}

// ---------- input ----------
const trackMouse = (e) => {
  game.mouse.x = e.clientX; game.mouse.y = e.clientY;
  game.mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
};
addEventListener('mousemove', trackMouse);
addEventListener('mousedown', trackMouse, true); // capture: picking on click sees the click position

let wheelAcc = 0, wheelLast = 0, wheelCool = 0, wheelLocked = false;
addEventListener('wheel', (e) => {
  if (e.target === el.cmd) return;
  e.preventDefault();
  const now = performance.now();
  const gap = now - wheelLast;
  wheelLast = now;
  if (wheelLocked) { if (gap < 250) return; wheelLocked = false; } // wait for trackpad momentum to end
  if (now < wheelCool) return;
  if (gap > 300) wheelAcc = 0;
  wheelAcc += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
  if (wheelAcc < -120) {
    wheelAcc = 0;
    if (dive(null)) { wheelLocked = true; wheelCool = now + 500; }
  } else if (wheelAcc > 120) {
    wheelAcc = 0;
    if (stack.length > 1 && !transition) { scrollOut(); wheelLocked = true; wheelCool = now + 500; }
  }
}, { passive: false });

addEventListener('keydown', (e) => {
  if (game.isTyping()) {
    if (e.key === 'Enter') { e.preventDefault(); submit(el.cmd.value); el.cmd.value = ''; el.cmd.blur(); }
    else if (e.key === 'Escape') el.cmd.blur();
    return;
  }
  game.keys.add(e.code);
  if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); game.keys.clear(); el.cmd.focus(); return; }
  if (over && e.code === 'KeyR') { location.reload(); return; }
  if (e.repeat) return;
  const a = game.active;
  if (e.code === 'KeyZ') dive(null, true);
  else if (e.code === 'KeyX') scrollOut();
  else if (e.code === 'KeyQ' && a instanceof World) a.selectAll();
  else if (e.code === 'Escape' && a instanceof World) for (const u of a.units) u.selected = false;
});
addEventListener('keyup', (e) => game.keys.delete(e.code));
addEventListener('blur', () => game.keys.clear());
el.cmd.addEventListener('focus', () => game.keys.clear());

function submit(text) {
  text = text.trim();
  if (!text) return;
  hud.log('> ' + text);
  const root = stack[0];
  let reply = null;
  for (const p of root?.plugins || []) {
    try { reply = p.handleCommand(text); } catch (e) { console.error(e); reply = null; }
    if (reply != null) break;
  }
  if (reply == null && /^(help|\?)$/i.test(text)) {
    reply = 'Controls: LMB select, RMB attack-move, Q all, WASD pan, hover+scroll/Z dive, scroll out/X surface.';
  }
  hud.log(reply ?? `Unknown command "${text}". Try "help".`);
  if (reply == null) play('error');
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  for (const w of stack) fitCamera(w);
});

// ---------- boot ----------
const params = new URLSearchParams(location.search);
if (params.has('duel')) {
  const host = { id: 0, type: 'R', team: 0, pos: new THREE.Vector3(), moveTarget: null, speed: 0, strength: 1, alive: true };
  const d = new DuelWorld(game, { host, seed: 1234 });
  stack.push(d);
  fitCamera(d);
  d.activate();
  hud.log('Test mode: duel inside a fake Rock.');
} else {
  const root = new World(game, { depth: 0, seed: (Math.random() * 2 ** 31) | 0 });
  stack.push(root);
  if (params.has('inner')) {
    const host = root.units.find((u) => u.team === 0 && u.type === 'R');
    host.frozen = true;
    const inner = new World(game, { depth: 1, seed: (host.id * 2654435761 + 12345) >>> 0, host });
    host.inner = inner;
    stack.push(inner);
    inner.activate();
    hud.log(`Test mode: inside ${unitName(host)}.`);
  } else {
    root.activate();
    hud.log('Every unit has a war inside its head.');
    hud.log('Hover one of your fighters and scroll in (or press Z) to dive inside.');
  }
}

// ---------- HUD refresh ----------
const pct = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const bar = (f, c) => `<span class="bar"><i style="width:${pct(f)}%;background:${c}"></i></span>`;
let hudT = 0;
function updateHud(dt) {
  const a = game.active;
  // hover tooltip every frame (follows mouse)
  const h = a instanceof World && !transition ? a.hovered : null;
  if (h) {
    el.tip.style.display = 'block';
    el.tip.style.left = game.mouse.x + 16 + 'px'; el.tip.style.top = game.mouse.y + 14 + 'px';
    el.tip.textContent = `${unitName(h)}${h.strength > 1 ? ' ×' + h.strength : ''} — scroll in / Z to dive`;
  } else el.tip.style.display = 'none';

  if ((hudT -= dt) > 0) return;
  hudT = 0.1;
  el.tl.textContent = `DEPTH ${a.depth ?? stack.length - 1}`;
  el.crumb.textContent = stack.map((w, i) => (i === 0 ? (w.isDuel ? 'The Duel' : 'The Field') : unitName(w.host))).join(' › ');
  const w = [...stack].reverse().find((x) => x instanceof World);
  const lines = [];
  const root = stack[0];
  if (root instanceof World) lines.push(`BLOCKS <b>${Math.floor(root.blocks)}</b>`);
  if (w) {
    const mine = w.fighters(0), theirs = w.fighters(1);
    lines.push(`ARMY <b style="color:#6aa8ff">${mine.length}</b> vs <b style="color:#ffb35c">${theirs.length}</b>`);
    lines.push(`YOUR CORE${bar(w.coreIntegrity(0), '#2f7bff')}`);
    lines.push(`ENEMY CORE${bar(w.coreIntegrity(1), '#ff9a1f')}`);
    if (w.depth === 0 && w.state === 'playing') lines.push(`NEXT WAVE ${Math.ceil(w.waveTimer)}s`);
  }
  if (stack.length > 1) {
    let p = 0.5;
    try { p = a.winChance(); } catch (e) { /* ignore */ }
    lines.push(`WIN CHANCE ${pct(p)}%`);
  }
  el.tr.innerHTML = lines.join('<br>');
}

// ---------- loop ----------
const errored = new Set();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const act = game.active;
  for (const w of stack) {
    try { w.update(w === act ? dt : dt * 0.25); } catch (e) { if (!errored.has(w)) { errored.add(w); console.error('world update failed', e); } }
  }

  // transitions (camera tween toward the dive target + fade)
  if (transition) {
    const tr = transition;
    tr.t += dt;
    const k = Math.min(1, tr.t / (tr.phase === 'out' ? 0.5 : 0.45));
    if (tr.phase === 'out') {
      el.fade.style.opacity = k * k;
      const cam = game.active.camera;
      if (tr.unit && cam && tr.unit.pos) {
        const to = tr.unit.pos.clone().add(new THREE.Vector3(0, 1.4, 1.8));
        cam.position.lerp(to, k * k * 0.95);
        cam.lookAt(tr.unit.pos);
      }
      if (k >= 1) { try { tr.mid(); } catch (e) { console.error(e); } tr.phase = 'in'; tr.t = 0; }
    } else {
      el.fade.style.opacity = 1 - k;
      if (k >= 1) transition = null;
    }
  }

  // world end states
  const root = stack[0];
  if (!over && root.state && root.state !== 'playing') gameOver(root.state === 'won');
  const a = game.active;
  if (!over && !transition && stack.length > 1 && a.state !== 'playing') {
    a._exitT = (a._exitT || 0) + dt;
    if (a._exitT > (a.state === 'won' ? 1.0 : 0.6)) surface(a.state === 'won');
  }

  updateHud(dt);

  const cam = game.active.camera;
  const saved = cam.position.clone();
  if (shakeAmt > 0.01) cam.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(shakeAmt));
  renderer.render(game.active.scene, cam);
  cam.position.copy(saved);
  shakeAmt = Math.max(0, shakeAmt - dt * 2.5);
}
requestAnimationFrame(frame);
