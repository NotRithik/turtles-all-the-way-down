// Rockets agent: AI engineers race wobbly homemade rockets at the enemy core. See CONTRACT.md.
import * as THREE from 'three';

const COST = { rocket: 15, big: 30, engineer: 10 };
const DAMAGE = { rocket: 5, big: 10, enemy: 4 };
const PART_TIME = 0.4;          // seconds per cube
const ENEMY_EVERY = 50;         // seconds between enemy rockets
const MISS_CHANCE = 0.2;
const UP = new THREE.Vector3(0, 1, 0);

const HOMEMADE = [0xd8dde3, 0xf4f1e8, 0xe53935, 0x2f7bff, 0xffd23f, 0x5cb85c, 0xb5835a, 0x8a8f98, 0xff7f50, 0x9c6ade];
const ENEMY_PAL = [0xff9a1f, 0xffb347, 0x8a8f98, 0x6b4a33, 0xd8dde3, 0xe53935];
const FIRE = [0xffd23f, 0xff9a1f, 0xff5722, 0xe53935, 0x555555];
const SMOKE = [0x8c8c8c, 0xa6a6a6, 0xbdbdbd, 0xd0d0d0, 0x777777];

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(0.5, 1, 8);
const BALL = new THREE.SphereGeometry(1, 14, 10);
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0xffa31a });
const mats = new Map();
const solid = (c) => { let m = mats.get(c); if (!m) mats.set(c, m = new THREE.MeshLambertMaterial({ color: c })); return m; };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const backOut = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; };

// A homemade rocket: wonky stack of mismatched cubes, 4 box fins, cone nose. Parts are added one by one.
function makeRocket(big, pal) {
  const root = new THREE.Group(), inner = new THREE.Group();
  root.add(inner);
  const parts = [];
  const n = big ? 9 + ((Math.random() * 4) | 0) : 6 + ((Math.random() * 4) | 0);   // 6-9 / 9-12 cubes
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = rand(0.4, 0.58);
    const m = new THREE.Mesh(BOX, solid(pick(pal)));
    m.position.set(rand(-0.09, 0.09), y + s / 2, rand(-0.09, 0.09));
    m.rotation.set(rand(-0.08, 0.08), rand(-0.6, 0.6), rand(-0.08, 0.08));
    m.userData.full = new THREE.Vector3(s, s, s);
    parts.push(m);
    y += s * 0.82;
  }
  const finColor = pick(pal);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + rand(-0.25, 0.25);
    const m = new THREE.Mesh(BOX, solid(finColor));
    m.position.set(Math.cos(a) * 0.36, 0.25 + rand(-0.06, 0.06), Math.sin(a) * 0.36);
    m.rotation.set(0, Math.PI / 2 - a, rand(-0.15, 0.15));
    m.userData.full = new THREE.Vector3(0.07, 0.55, 0.38);
    parts.push(m);
  }
  const top = y + 0.08;
  const nose = new THREE.Mesh(CONE, solid(pick([0xe53935, 0xffd23f, 0xf4f1e8, 0x2f7bff])));
  nose.position.set(rand(-0.05, 0.05), top + 0.35, 0);
  nose.rotation.z = rand(-0.14, 0.14);
  nose.userData.full = new THREE.Vector3(0.62, 0.7, 0.62);
  parts.push(nose);
  const h = top + 0.7;
  inner.position.y = -h / 2;      // root sits at the rocket's middle so it tumbles nicely
  const flame = new THREE.Mesh(CONE, FLAME_MAT);
  flame.rotation.x = Math.PI;
  flame.position.y = -0.3;
  flame.scale.set(0.38, 0.6, 0.38);
  flame.visible = false;
  inner.add(flame);
  const scale = big ? 1.5 : 1;
  root.scale.setScalar(scale);
  return { root, inner, parts, flame, h, scale, pal };
}

export function installRockets(world, game) {
  const scene = world.scene;
  const jobs = [];      // states: queued → walk → build → countdown → lift → arc → (boom)
  const fx = [];        // { m, kind, t, life, ... }
  const pads = [];      // { pos, side, mesh, busy }
  let enemyTimer = ENEMY_EVERY + rand(-5, 5);
  const tmp = new THREE.Vector3(), prev = new THREE.Vector3(), dir = new THREE.Vector3();
  const q = new THREE.Quaternion(), rq = new THREE.Quaternion();

  const play = (n) => { try { game?.audio?.play?.(n); } catch {} };
  const log = (m) => { try { game?.hud?.log?.(m); } catch {} };
  const viewing = () => !game?.active || game.active === world;
  const shake = (a) => { if (viewing()) { try { game?.shake?.(a); } catch {} } };
  const groundY = () => world.groundY ?? 0;
  const S = () => world.size || 30;
  const core = (team) => world.corePos?.(team)?.clone?.() ?? new THREE.Vector3(0, 0, (team ? -1 : 1) * S() * 0.8);
  const towardEnemy = () => Math.sign(core(1).z - core(0).z) || -1;
  const clampMap = (v) => clamp(v, -S() + 1.5, S() - 1.5);

  const isAlive = (u) => u && u.alive !== false && (!world.units || world.units.includes(u));
  const engineers = () => (world.units || []).filter((u) => u && u.type === 'engineer' && u.team === 0 && u.alive !== false);
  const busy = (u) => jobs.some((j) => j.engineer === u);

  // ------------------------------------------------------------ fx
  function addFx(e) { e.t = 0; fx.push(e); return e; }

  function puff(pos, size = 0.35, life = 1.1) {
    if (fx.length > 700) return;
    const m = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: pick(SMOKE), transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.set(pos.x + rand(-0.1, 0.1), pos.y, pos.z + rand(-0.1, 0.1));
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    m.scale.setScalar(size * 0.5);
    scene.add(m);
    addFx({ m, kind: 'puff', life, size, own: true, vel: new THREE.Vector3(rand(-0.35, 0.35), rand(0.3, 0.9), rand(-0.35, 0.35)) });
  }

  function debris(pos, n, speed, colors, size = 0.25) {
    for (let i = 0; i < n && fx.length < 700; i++) {
      const s = size * rand(0.6, 1.4);
      const m = new THREE.Mesh(BOX, solid(pick(colors)));
      m.position.copy(pos);
      m.scale.setScalar(s);
      scene.add(m);
      const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 1.4), rand(-1, 1)).multiplyScalar(speed * rand(0.5, 1));
      addFx({ m, kind: 'debris', life: rand(0.9, 1.7), size: s, vel: v, spin: rand(-12, 12) });
    }
  }

  function flash(pos, radius, color, life) {
    const m = new THREE.Mesh(BALL, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }));
    m.position.copy(pos);
    m.scale.setScalar(0.1);
    scene.add(m);
    addFx({ m, kind: 'flash', life, size: radius, own: true });
  }

  function boom(pos, k, pal) {
    flash(pos, 2.6 * k, 0xfff1a8, 0.35);
    flash(pos, 3.6 * k, 0xff7a1f, 0.6);
    debris(pos, Math.round(14 * k), 7 * Math.sqrt(k), pal.concat(FIRE), 0.28 * Math.sqrt(k));
    for (let i = 0; i < 6 * k; i++) puff(tmp.set(pos.x + rand(-1, 1) * k, pos.y + rand(0, 1), pos.z + rand(-1, 1) * k), 0.9 * k, 1.6);
  }

  function updateFx(dt) {
    const gy = groundY();
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) {
        if (e.kind === 'pop') e.m.scale.copy(e.full);
        else { e.m.parent?.remove(e.m); if (e.own) e.m.material.dispose(); }
        fx[i] = fx[fx.length - 1]; fx.pop();
        continue;
      }
      if (e.kind === 'puff') {
        e.m.position.addScaledVector(e.vel, dt);
        e.m.scale.setScalar(e.size * (0.5 + k * 1.4));
        e.m.material.opacity = 0.7 * (1 - k);
      } else if (e.kind === 'flash') {
        e.m.scale.setScalar(e.size * (0.15 + 0.85 * (1 - (1 - k) ** 3)));
        e.m.material.opacity = 1 - k;
      } else if (e.kind === 'debris') {
        e.vel.y -= 20 * dt;
        e.m.position.addScaledVector(e.vel, dt);
        if (e.m.position.y < gy + e.size / 2) {
          e.m.position.y = gy + e.size / 2;
          if (e.vel.y < 0) e.vel.y *= -0.35;
          e.vel.x *= 0.7; e.vel.z *= 0.7;
        }
        e.m.rotation.x += e.spin * dt; e.m.rotation.z += e.spin * 0.7 * dt;
        e.m.scale.setScalar(e.size * (k > 0.7 ? (1 - k) / 0.3 : 1));
      } else if (e.kind === 'pop') {
        e.m.scale.copy(e.full).multiplyScalar(Math.max(0.01, backOut(k)));
      }
    }
  }

  // ------------------------------------------------------------ pads + engineers
  function getPad() {
    let p = pads.find((p) => !p.busy);
    if (!p && pads.length < 8) {
      const k = pads.length, side = k % 2 ? -1 : 1, c = core(0);
      const pos = new THREE.Vector3(clampMap(c.x + side * (5 + 2.6 * (k >> 1))), groundY(), c.z);
      const mesh = new THREE.Group();
      const slab = new THREE.Mesh(BOX, solid(0x4a4f57));
      slab.scale.set(1.8, 0.16, 1.8); slab.position.y = 0.08;
      const stripe = new THREE.Mesh(BOX, solid(0xffd23f));
      stripe.scale.set(1.8, 0.03, 0.2); stripe.position.y = 0.17;
      mesh.add(slab, stripe);
      mesh.position.copy(pos);
      scene.add(mesh);
      p = { pos, side, mesh, busy: false };
      pads.push(p);
    }
    if (p) p.busy = true;
    return p || null;
  }

  function assignJobs() {
    for (const j of jobs) {
      if ((j.state === 'walk' || j.state === 'build') && !isAlive(j.engineer)) { j.engineer = null; j.state = 'queued'; }
      if (j.state !== 'queued' || j.team !== 0) continue;
      const u = engineers().find((u) => !busy(u));
      if (!u) continue;
      if (!j.pad) { j.pad = getPad(); if (!j.pad) continue; }
      j.engineer = u;
      j.state = 'walk';
      j.stuck = 0;
      j.lastPos = u.pos.clone();
      j.stand = new THREE.Vector3(j.pad.pos.x - j.pad.side * 1.5, u.pos.y, j.pad.pos.z + 0.5);
      u.moveTarget = j.stand.clone();
    }
  }

  function newJob(team, big) {
    return { team, big, ...makeRocket(big, team ? ENEMY_PAL : HOMEMADE), state: 'queued', engineer: null, pad: null,
      built: 0, timer: 0, t: 0, smokeT: 0, drift: 0, ph1: rand(0, 6), ph2: rand(0, 6) };
  }

  function placeOnPad(j) {
    j.root.position.set(j.pad.pos.x, groundY() + 0.17 + (j.h * j.scale) / 2, j.pad.pos.z);
    if (!j.root.parent) scene.add(j.root);
  }

  function addPart(j) {
    const m = j.parts[j.built++];
    j.inner.add(m);
    m.scale.setScalar(0.01);
    addFx({ m, kind: 'pop', life: 0.2, full: m.userData.full });
    m.getWorldPosition(tmp);
    debris(tmp, 3, 3, [0xffd23f, 0xfff1a8], 0.08);
    if (viewing()) play('build');
  }

  function startCountdown(j, dur) {
    j.state = 'countdown';
    j.timer = dur;
    j.engineer = null;
    j.flame.visible = true;
    j.base = j.root.position.clone();
  }

  function exhaust(j, dt, rate, size) {
    j.flame.scale.set(0.38, 0.4 + Math.random() * 0.7, 0.38);
    j.smokeT -= dt;
    if (j.smokeT > 0) return;
    j.smokeT += rate;
    j.root.updateMatrixWorld();
    tmp.set(0, -0.35, 0);
    j.inner.localToWorld(tmp);
    puff(tmp, size * j.scale, 1.2);
  }

  function beginArc(j) {
    const tgtTeam = j.team ? 0 : 1;
    const c = core(tgtTeam);
    j.miss = Math.random() < MISS_CHANCE;
    if (j.miss) {
      const a = rand(0, Math.PI * 2), r = rand(7, 12) * (j.big ? 1.2 : 1);
      j.target = new THREE.Vector3(clampMap(c.x + Math.cos(a) * r), groundY(), clampMap(c.z + Math.sin(a) * r));
    } else {
      j.target = new THREE.Vector3(c.x + rand(-0.6, 0.6), c.y, c.z + rand(-0.6, 0.6));
    }
    j.p0 = j.root.position.clone();
    const dx = j.target.x - j.p0.x, dz = j.target.z - j.p0.z, dist = Math.hypot(dx, dz) || 1;
    j.T = clamp(dist / 13, 2.2, 6) * (j.big ? 1.15 : 1);
    j.H = Math.max(6, dist * 0.32);
    j.s = 0;
    j.side = new THREE.Vector3(-dz / dist, 0, dx / dist);
    j.state = 'arc';
  }

  function explode(j) {
    const i = jobs.indexOf(j);
    if (i >= 0) jobs.splice(i, 1);
    j.root.parent?.remove(j.root);
    const pos = j.root.position.clone();
    pos.y = Math.max(pos.y, groundY() + 0.2);
    const k = j.big ? 1.8 : 1;
    boom(pos, k, j.pal);
    if (viewing()) play('explosion');
    const tgtTeam = j.team ? 0 : 1;
    if (!j.miss && world.state === 'playing') {
      const dmg = j.team ? DAMAGE.enemy : (j.big ? DAMAGE.big : DAMAGE.rocket);
      try { world.damageCore?.(tgtTeam, dmg); } catch {}
      log(j.team ? `💥 Enemy rocket slammed your core! (−${dmg})` : `💥 Direct hit on the enemy core! (−${dmg})`);
      shake(j.big ? 1 : 0.6);
    } else {
      log(j.team ? 'Enemy rocket wobbled off and missed!' : 'Rocket wobbled off course and missed. Homemade, huh.');
      shake(0.2);
    }
  }

  function updateJob(j, dt) {
    j.t += dt;
    if (j.state === 'walk' || j.state === 'build') {
      const u = j.engineer;
      const d = Math.hypot(u.pos.x - j.stand.x, u.pos.z - j.stand.z);
      if (j.state === 'walk') {
        if (d < 1.0) { j.state = 'build'; j.timer = 0; placeOnPad(j); return; }
        if (!u.moveTarget) u.moveTarget = j.stand.clone();
        // Fallback in case nothing is moving the engineer: shuffle it there ourselves.
        j.stuck = u.pos.distanceToSquared(j.lastPos) < 1e-8 ? j.stuck + dt : 0;
        if (j.stuck > 1.5) {
          tmp.set(j.stand.x - u.pos.x, 0, j.stand.z - u.pos.z).setLength(Math.min(d, (u.speed || 3) * dt));
          u.pos.add(tmp);
        }
        j.lastPos.copy(u.pos);
        return;
      }
      if (d > 2.5) { j.state = 'walk'; return; }     // wandered off: go back
      j.timer += dt;
      while (j.timer >= PART_TIME && j.built < j.parts.length) { j.timer -= PART_TIME; addPart(j); }
      if (j.built >= j.parts.length && j.timer >= 0.3) {
        log(`🚀 Engineer #${u.id ?? '?'}'s ${j.big ? 'BIG ' : ''}rocket is ready — launching!`);
        startCountdown(j, 1.0);
      }
    } else if (j.state === 'countdown') {
      j.timer -= dt;
      const shakeK = 0.03 + 0.08 * Math.max(0, 1 - j.timer);
      j.root.position.set(j.base.x + rand(-1, 1) * shakeK, j.base.y, j.base.z + rand(-1, 1) * shakeK);
      exhaust(j, dt, 0.07, 0.45);
      if (j.timer <= 0) {
        j.root.position.copy(j.base);
        if (j.pad) { j.pad.busy = false; j.pad = null; }
        j.state = 'lift'; j.t = 0; j.vy = 0;
        if (j.team === 0 || viewing()) play('rocketLaunch');
        if (j.team === 0) log(j.big ? '🚀 BIG rocket away!' : '🚀 Rocket away!');
      }
    } else if (j.state === 'lift') {
      j.vy += 10 * dt;
      j.root.position.y += j.vy * dt;
      const amp = j.big ? 0.12 : 0.06;
      j.root.rotation.set(Math.sin(j.t * 9 + j.ph1) * amp, j.t * 3, Math.cos(j.t * 7 + j.ph2) * amp);
      exhaust(j, dt, 0.04, 0.4);
      if (j.t > 0.9) beginArc(j);
    } else if (j.state === 'arc') {
      j.s = Math.min(1, j.s + dt / j.T);
      const s = j.s, env = Math.sin(Math.PI * s), amp = j.big ? 1.7 : 0.9;
      j.drift = clamp(j.drift + rand(-1, 1) * dt * 5 * amp, -1.5 * amp, 1.5 * amp);
      const w = (Math.sin(j.t * 6 + j.ph1) * 0.7 + Math.sin(j.t * 15 + j.ph2) * 0.3) * amp + j.drift;
      prev.copy(j.root.position);
      j.root.position.lerpVectors(j.p0, j.target, s);
      j.root.position.y += j.H * 4 * s * (1 - s) + Math.sin(j.t * 11 + j.ph2) * 0.35 * amp * env;
      j.root.position.addScaledVector(j.side, w * env);
      dir.subVectors(j.root.position, prev);
      if (dir.lengthSq() > 1e-8) {
        q.setFromUnitVectors(UP, dir.normalize());
        rq.setFromAxisAngle(UP, j.t * 5);
        j.root.quaternion.copy(q).multiply(rq);
      }
      exhaust(j, dt, 0.035, 0.35);
      if (s >= 1) explode(j);
    }
  }

  function enemyLaunch() {
    const c = core(1);
    const j = newJob(1, false);
    for (const m of j.parts) { m.scale.copy(m.userData.full); j.inner.add(m); }
    j.built = j.parts.length;
    j.root.position.set(clampMap(c.x + (Math.random() < 0.5 ? -1 : 1) * rand(4.5, 6.5)), groundY() + (j.h * j.scale) / 2, c.z);
    scene.add(j.root);
    jobs.push(j);
    startCountdown(j, 2.5);
    log('⚠ Incoming rocket!');
    play('telegraph');
    if (viewing()) { try { game?.hud?.flash?.('⚠ INCOMING ROCKET', '#ff9a1f'); } catch {} }
  }

  function step(dt) {
    updateFx(dt);
    if (world.state !== 'playing') return;
    enemyTimer -= dt;
    if (enemyTimer <= 0) { enemyTimer = ENEMY_EVERY + rand(-6, 6); enemyLaunch(); }
    assignJobs();
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i]) updateJob(jobs[i], dt);
  }

  return {
    update(dt) {
      try {
        dt = clamp(+dt || 0, 0, 1);
        const n = Math.min(20, Math.ceil(dt / 0.05));
        for (let i = 0; i < n; i++) step(dt / n);
      } catch (err) { console.warn('[rockets]', err); }
    },

    handleCommand(text) {
      const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      let kind = null;
      if (/\b(big|mega|huge|giant|large|massive)\b.*\b(rockets?|missiles?)\b|\bnukes?\b/.test(t)) kind = 'big';
      else if (/\b(rockets?|missiles?|launch\w*)\b/.test(t)) kind = 'rocket';
      else if (/\bengineers?\b/.test(t)) kind = 'engineer';
      else return null;
      if (world.state !== 'playing') return 'The battle is over — no more launches.';
      const count = clamp(parseInt(t.match(/\d+/)?.[0] ?? '1', 10) || 1, 1, 5);
      const cost = COST[kind] * count, have = Math.floor(world.blocks ?? 0);
      if (kind !== 'engineer' && engineers().length === 0) {
        play('error');
        return 'No engineers to build it! Type "engineer" (10 blocks) to hire one.';
      }
      if (have < cost) { play('error'); return `Need ${cost} blocks (have ${have})`; }

      if (kind === 'engineer') {
        if (!world.spawnUnit) { play('error'); return 'Cannot hire engineers right now.'; }
        world.blocks = (world.blocks ?? 0) - cost;
        const c = core(0), dz = towardEnemy();
        const ids = [];
        for (let i = 0; i < count; i++) {
          const u = world.spawnUnit({ type: 'engineer', team: 0, x: clampMap(c.x + rand(-3, 3)), z: clampMap(c.z + dz * rand(2.5, 4)) });
          if (u) ids.push('#' + (u.id ?? '?'));
        }
        play('spawn');
        assignJobs();
        return `Engineer${count > 1 ? 's' : ''} ${ids.join(', ')} hired! Type "rocket" (15) or "big rocket" (30).`;
      }

      world.blocks = (world.blocks ?? 0) - cost;
      const mine = [];
      for (let i = 0; i < count; i++) { const j = newJob(0, kind === 'big'); jobs.push(j); mine.push(j); }
      assignJobs();
      play('select');
      const who = mine.filter((j) => j.engineer).map((j) => '#' + (j.engineer.id ?? '?'));
      const queued = mine.length - who.length;
      const what = kind === 'big' ? 'BIG rocket' : 'rocket';
      if (!who.length) return `${count > 1 ? count + ' ' + what + 's' : 'Rocket'} queued — all engineers busy. Hire more with "engineer".`;
      return `Engineer${who.length > 1 ? 's' : ''} ${who.join(', ')} building ${who.length > 1 ? who.length + ' ' + what + 's' : 'a ' + what}!` +
        (queued ? ` (${queued} queued)` : '');
    },
  };
}
