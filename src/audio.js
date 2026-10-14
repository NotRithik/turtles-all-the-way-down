// WebAudio oscillator beeps. play(name) never throws; unknown names are a no-op.
let ctx = null, master = null;
const last = new Map();

function ensure() {
  if (ctx) return ctx;
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

function unlock() {
  try {
    const c = ensure();
    if (c && c.state !== 'running') c.resume?.()?.catch?.(() => {});
  } catch {}
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

// One enveloped oscillator: frequency f (optionally sweeping to `to`), gain attack/exp-decay.
function tone(o) {
  const t = ctx.currentTime + (o.delay || 0);
  const dur = o.dur || 0.1, at = Math.min(o.at ?? 0.005, dur * 0.5);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type || 'square';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.detune) osc.detune.value = o.detune;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol ?? 0.5, t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
  osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
}

const arp = (notes, step, o) => notes.map((f, i) => ({ ...o, f, delay: i * step }));

const SOUNDS = {
  select: [{ type: 'square', f: 880, to: 1320, dur: 0.06, vol: 0.3 }],
  move: [{ type: 'triangle', f: 520, to: 720, dur: 0.09, vol: 0.5 }],
  clash: [{ type: 'square', f: 260, to: 110, dur: 0.1, vol: 0.45 }, { type: 'sawtooth', f: 340, to: 140, dur: 0.08, vol: 0.3, detune: 30 }],
  die: [{ type: 'sawtooth', f: 520, to: 55, dur: 0.4, vol: 0.4 }],
  dive: [{ type: 'sine', f: 1100, to: 140, dur: 0.45, vol: 0.6 }, { type: 'triangle', f: 1400, to: 200, dur: 0.4, vol: 0.25, delay: 0.05 }],
  surface: [{ type: 'sine', f: 160, to: 1100, dur: 0.4, vol: 0.6 }, { type: 'triangle', f: 220, to: 1500, dur: 0.35, vol: 0.25, delay: 0.06 }],
  booted: [...arp([392, 311, 233], 0.09, { type: 'square', dur: 0.12, vol: 0.3 }), { type: 'sawtooth', f: 180, to: 60, dur: 0.3, vol: 0.35, delay: 0.27 }],
  win: arp([523, 659, 784, 1047, 1319], 0.09, { type: 'square', dur: 0.16, vol: 0.3 }),
  lose: arp([392, 349, 311, 262, 196], 0.16, { type: 'triangle', dur: 0.3, vol: 0.6 }),
  mine: [{ type: 'triangle', f: 1500, to: 1100, dur: 0.05, vol: 0.4 }, { type: 'square', f: 2200, dur: 0.03, vol: 0.1, delay: 0.01 }],
  deposit: arp([988, 1319], 0.06, { type: 'square', dur: 0.12, vol: 0.25 }),
  build: [{ type: 'square', f: 180, to: 90, dur: 0.07, vol: 0.4 }, { type: 'triangle', f: 640, dur: 0.04, vol: 0.3, delay: 0.02 }],
  error: [{ type: 'sawtooth', f: 150, dur: 0.12, vol: 0.35 }, { type: 'sawtooth', f: 110, dur: 0.18, vol: 0.35, delay: 0.13 }],
  rocketLaunch: [
    { type: 'sawtooth', f: 70, to: 520, dur: 1.0, vol: 0.35, at: 0.06 },
    { type: 'square', f: 90, to: 760, dur: 0.9, vol: 0.15, detune: 25, at: 0.06 },
    { type: 'triangle', f: 1200, to: 2400, dur: 0.6, vol: 0.12, delay: 0.3 },
  ],
  explosion: [
    { type: 'square', f: 900, to: 80, dur: 0.15, vol: 0.25 },
    { type: 'sawtooth', f: 180, to: 28, dur: 0.8, vol: 0.6 },
    { type: 'sawtooth', f: 125, to: 22, dur: 0.9, vol: 0.55, detune: 40 },
    { type: 'square', f: 95, to: 30, dur: 0.6, vol: 0.35 },
  ],
  telegraph: arp([880, 660, 880, 660], 0.13, { type: 'square', dur: 0.11, vol: 0.3 }),
  throwWin: arp([523, 784], 0.08, { type: 'triangle', dur: 0.14, vol: 0.6 }),
  throwLose: arp([392, 262], 0.1, { type: 'triangle', dur: 0.18, vol: 0.6 }),
  throwTie: arp([440, 440], 0.1, { type: 'square', dur: 0.07, vol: 0.25 }),
  spawn: [{ type: 'sine', f: 300, to: 700, dur: 0.14, vol: 0.5 }, { type: 'sine', f: 600, to: 1200, dur: 0.14, vol: 0.4, delay: 0.09 }],
};

export function play(name) {
  try {
    if (!Object.prototype.hasOwnProperty.call(SOUNDS, name)) return;
    const now = performance.now();
    if (now - (last.get(name) ?? -1e9) < 40) return;
    last.set(name, now);
    const c = ensure();
    if (!c) return;
    // While suspended (no user gesture yet) skip, so sounds don't pile up and burst on resume.
    if (c.state !== 'running') { c.resume?.()?.catch?.(() => {}); return; }
    for (const o of SOUNDS[name]) tone(o);
  } catch {}
}
