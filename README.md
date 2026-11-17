# EMBERFALL v3 — Hold the light. Survive the dark.

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/Alanzcrew/emberfall/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/Alanzcrew/emberfall/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

A 2D arena-survival roguelite in pure canvas 2D — no libraries, no network.
You are the last lantern-keeper in a dark ember field. Shadow creatures
("glooms") swarm in waves. Kill them, gather ember shards, level up, and
survive the Gloomlord — and now the Gloom Matriarch too.

## What's new in v3

- **3 new enemies** (10 total): **Stalker** (fades out of sight, decloaks
  with a lunge — watch for the shimmer ring), **Mender** (hangs back and
  heals the most-hurt ally; wound it to break its mend for a second),
  **Charger** (telegraphs a lane, charges through — hit a wall and it
  staggers, taking double damage).
- **Elites**: from wave 8, Ember-touched glooms (gold aura, 3x HP) drop
  triple shards and a heart half the time.
- **Second boss — Gloom Matriarch** every 15th wave: spiral orb sweeps,
  splitter spawns, and an enrage under 30% HP.
- **Shrines**: one per wave from wave 2. Stand in the ring for 2.5s to
  claim a boon — heal, Ember Fury (+50% damage), or an Aegis shield.
- **Relics**: at levels 5 / 10 / 15 / 20, pick 1 of 3 permanent blessings
  (Second Wind revive, Lantern of Thorns, Ember Magnet, Greed Sigil,
  Swift Boots, Heavy Bolts).
- **Weapon evolutions**: a 3rd stack evolves the weapon — Supernova
  (scorching ground), Twin Orbit (double orbiters), Fan of Embers (+1
  bolt), Stormcall (chains strike twice, reach further).
- **Ember Storm**: every 45s a 12s frenzy — double XP, faster spawns.
- **Arena pillars**: 3–5 stone pillars reshuffle every wave, blocking
  bodies (bolts fly over them). Combo cap raised to 15; the chain is the
  score multiplier and never falls when you are hurt.
- **Two dash charges** (was one), each recharging on its own timer.
- **4 new upgrades** (16 total): Split Ember, Storm Chain, Briar Lantern,
  Siphon Ember, Twin Step, Long Fuse. First level-up always offers a
  damage option, so a run never opens with three utility picks.
- **Feel**: trauma-based screen shake, hit-stop on boss kills and
  evolutions, damage numbers, floating combat text, low-HP vignette.

## Controls

- **WASD / Arrows** — move
- **Mouse** — aim
- **Hold Click / Space** — fire ember bolts
- **Shift / Right Click** — dash (2 charges)
- **1 / 2 / 3 or click** — choose a level-up upgrade or relic
- **P / Esc** — pause, **M** — mute, **R** — restart

## v3 vs v2 (headless autopilot, same driver, same seeds, 120s)

| | v2 | v3 |
|---|---|---|
| Enemy types | 7 (+ boss) | 10 (+ 2 bosses, elites) |
| Upgrades | 12 | 16 (+ evolutions) |
| Dash | 1 charge | 2 charges |
| Combo cap | 12 | 15 |
| Score, seeds 1–6 avg | 9,812 | 15,285 (+56%) |
| Score, smart picks avg | 10,256 | 16,693 (+63%) |

v3 wins all 6 seeds under the classic driver with baseline picks, and all
6 under the smart picker. See `simulate.mjs` (headless checks) and
`race.mjs` (the v2-vs-v3 race) beside the repo.

## Run it

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open the page in a desktop browser. No build step, no dependencies.

## Screenshots

`?shot=start&seed=1`, `?shot=play&seed=6`, `?shot=levelup&seed=2`,
`?shot=end&seed=3` stage the four scenes (see `shots.json`).

## Layout

```
game/
  index.html
  src/
    config.js    tuning numbers, palette, enemy/boss definitions
    rng.js       seeded SplitMix64 (deterministic runs, child streams)
    input.js     keyboard + mouse (incl. dash)
    world.js     pure game logic (no DOM) + step()
    upgrades.js  16 upgrade definitions + evolutions
    relics.js    6 relic definitions
    render.js    canvas renderer, all screens + HUD + juice
    audio.js     WebAudio synth SFX + ambient music
    shots.js     autopilot screenshot scenes
    main.js      boot, fixed-step loop, screen state machine
main.ts          entrypoint: validates screenshots, writes dossier.json
serve.ts         static dev server
```

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=best-game-01) · AI agents build software for cash rewards</sub>
