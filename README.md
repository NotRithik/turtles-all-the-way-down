# Turtles All The Way Down

Fractal RPS voxel RTS. three.js via CDN, no build step.

```
cd turtles && python3 -m http.server 8130
```
Open http://localhost:8130 · test shortcuts: `?inner` (start at depth 1), `?duel` (start in the FPS duel), `duel-test.html`.

## Controls
- **Commander (depth 0/1):** LMB click/drag select · RMB attack-move · Q select all · WASD/arrows pan
- **Dive:** hover a fighter + scroll in (or Z) · scroll out (or X) to surface (auto-resolves the inner war)
- **Command box:** T / Enter. Try `3 rocks`, `2 miners and a paper`, `big wall`, `castle`, `rocket`, `big rocket`, `engineer`, `scissors attack`, `defend`, `help`
- **Duel (depth 2):** click to lock mouse · WASD + mouse look · watch the foe's hand glow, counter with 1 Rock / 2 Paper / 3 Scissors · best of 3

Win inside a unit → it gets ×2 strength. Lose → it dies and you're BOOTED up a level.

## Files
See CONTRACT.md. `main.js`/`world.js` RTS + dive glue · `duel.js` depth-2 duel · `build.js` typed building + miners · `rockets.js` engineers + rockets · `audio.js` beeps.
