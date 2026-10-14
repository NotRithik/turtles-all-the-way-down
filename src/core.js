// Shared tiny contract. Keep this file small; don't change existing exports.
export const BEATS = { R: 'S', S: 'P', P: 'R' };           // key beats value
export const TYPE_COLOR = { R: 0x8a8f98, P: 0xf4f1e8, S: 0xe53935 };
export const TEAM_COLOR = [0x2f7bff, 0xff9a1f];            // 0 = player (blue), 1 = enemy (orange)
export const TYPES = ['R', 'P', 'S'];
export const TYPE_NAME = { R: 'Rock', P: 'Paper', S: 'Scissors' };

// Seeded RNG (mulberry32). Returns () => float in [0,1).
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RPS duel between two strengths. Winner of the matchup gets x2. Returns 'a' | 'b'.
export function resolveRps(typeA, strA, typeB, strB, rng = Math.random) {
  let a = strA, b = strB;
  if (BEATS[typeA] === typeB) a *= 2;
  else if (BEATS[typeB] === typeA) b *= 2;
  return rng() < a / (a + b) ? 'a' : 'b';
}
