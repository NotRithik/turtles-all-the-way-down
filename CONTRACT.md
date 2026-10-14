# Turtles — tiny contract between files

Vanilla JS ES modules, three@0.160.0 via import map (`import * as THREE from 'three'`). No build step. Serve with `python3 -m http.server 8130` from `turtles/` → http://localhost:8130.
Primitives + flat colors only. Audio = WebAudio oscillators only.

## File ownership (only edit your own files)
| File | Owner |
|---|---|
| `index.html`, `src/core.js` | lead (ask before changing) |
| `src/main.js`, `src/world.js` (+ any `src/rts-*.js`) | RTS agent |
| `src/duel.js` | duel agent |
| `src/build.js` | build agent |
| `src/rockets.js`, `src/audio.js` | rockets agent |

## `game` (created in main.js by RTS agent)
- `game.audio.play(name)` — names: select, move, clash, die, dive, surface, booted, win, lose, mine, deposit, build, error, rocketLaunch, explosion, telegraph, throwWin, throwLose, throwTie, spawn. Never throws.
- `game.hud.log(msg)` — line in the message log. `game.hud.flash(text, color?)` — big center text.
- `game.shake(amount)` — camera shake.
- `game.isTyping()` — true while the command box has focus (ignore WASD etc. then).
- `game.active` — the world currently being viewed.

## Commander world (`world.js`, depth 0 and 1)
- `world.depth`, `world.scene`, `world.camera`, `world.rng()` (seeded), `world.state` = 'playing' | 'won' | 'lost'
- `world.size` — map half-extent; map spans x,z ∈ [-size, size]. Player core at +z (bottom of screen), enemy core at −z.
- `world.units` — array of units. Unit: `{ id, type: 'R'|'P'|'S'|'miner'|'engineer', team: 0|1, pos: THREE.Vector3, moveTarget: THREE.Vector3|null, speed, strength, alive }`.
  RTS code moves ANY unit toward `moveTarget` (and sets it to null on arrival) and renders all types (miner = small yellow cube, engineer = small orange cube). Combat ignores miners/engineers.
- `world.spawnUnit({ type, team, x, z })` → unit. `world.removeUnit(unit)`.
- `world.corePos(team)` → Vector3. `world.damageCore(team, amount)` — knocks `amount` voxel blocks off that core (debris); core falls at 0 → world won/lost.
- `world.blocks` — player's block resource (number, depth 0 only).
- `world.mouseGround` — Vector3 of the last mouse position on the ground plane.
- At depth 0 world.js calls `installBuild(world, game)` and `installRockets(world, game)`; each returns `{ update(dt), handleCommand(text) }`.
  `handleCommand` returns a reply string if it handled the text, else null. The command box (RTS agent's HUD) tries build first, then rockets.
- Plugins add their own meshes to `world.scene` and may spawn units.

## Duel world (`duel.js`, depth 2)
`new DuelWorld(game, { host, seed })` → `{ depth: 2, isDuel: true, scene, camera, state, activate(), deactivate(), update(dt), winChance(), dispose() }`.
`activate()` adds its input listeners + DOM overlay; `deactivate()` removes them. Sets `state` to 'won'/'lost'; the game handles exit.

## Rules
- RPS everywhere: `resolveRps()` in core.js. No HP. Unit types: Rock = grey sphere, Paper = white flat slab, Scissors = red twin cones.
- Win inside a unit → that unit gets strength ×2 in the parent. Lose → unit dies, player is BOOTED up a level. Scroll-out = auto-resolve at `winChance()`.
