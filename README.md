# EMBERFALL v2 — Hold the light. Survive the dark.

[![LIVE](https://img.shields.io/badge/LIVE-make.fun-ff9a3c)](https://make.fun/bounty/best-game-01)
[![GAME](https://img.shields.io/badge/GAME-emberfall-7b5cff)](https://make.fun/bounty/best-game-01)
[![VERSION](https://img.shields.io/badge/VERSION-v2-ffd166)](https://make.fun/bounty/best-game-01)

A 2D arena-survival roguelite in pure canvas 2D — no libraries, no network.
You are the last lantern-keeper in a dark ember field. Shadow creatures
("glooms") swarm in waves. Kill them, gather ember shards, level up, and
survive the Gloomlord.

## What's new in v2

- **Dash** (Shift / right-click): a burst of speed with brief invulnerability,
  on a 2.2s cooldown shown as a ring around the keeper.
- **Gloomlord boss** every 10th wave: radial orb bursts, wisp summons, and a
  dedicated boss HP bar.
- **Dasher** enemies (wave 4+): crouch, telegraph, then lunge at you.
- **Splitter** enemies (wave 6+): pop into two wisps when killed.
- **Swarm waves** every 4th wave: fast wisp + dasher floods.
- **4 new upgrades** (12 total): Ember Nova (radial burst), Orbiting Ember,
  Kindled Edge (crits), Ember Heart (regen). Combo cap raised to 12.
- **Kill streaks**: STREAK x5 / RAMPAGE / UNSTOPPABLE announcements.
- **Run stats** on the game-over screen: accuracy, dashes, nova kills, crits,
  best combo, bosses slain, time survived.
- **Polish**: fade transitions between screens, low-HP vignette pulse,
  owned-upgrade strip, boss bar, richer synth audio (dash whoosh, nova boom,
  boss sting, bass pulse under the ambient pad).

## Controls

- **WASD / Arrows** — move
- **Mouse** — aim
- **Hold Click / Space** — fire ember bolts
- **Shift / Right Click** — dash
- **1 / 2 / 3 or click** — choose a level-up upgrade
- **P / Esc** — pause, **M** — mute, **R** — restart

## v2 vs v1

| | v1 | v2 |
|---|---|---|
| Enemy types | 4 (wisp, crawler, spitter, brute) | 7 (+ dasher, splitter, Gloomlord boss) |
| Upgrades | 8 | 12 (+ nova, orbital, crit, regen) |
| Movement | walk only | walk + dash with i-frames |
| Combo cap | 8 | 12, with streak announcements |
| Waves | brute every 5th | + boss every 10th, swarm every 4th |
| Game-over screen | score / wave / kills / best | + accuracy, dashes, nova kills, crits, best combo, bosses slain, time |

## Run it

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open the page in a desktop browser. No build step, no dependencies.

## Screenshots

`?shot=start&seed=1`, `?shot=play&seed=1`, `?shot=levelup&seed=2`,
`?shot=end&seed=3` stage the four scenes (see `shots.json`).

## Layout

```
game/
  index.html
  src/
    config.js    tuning numbers, palette, enemy/boss definitions
    random.js    seeded mulberry32 RNG
    input.js     keyboard + mouse (incl. dash)
    world.js     pure game logic (no DOM) + step()
    upgrades.js  12 upgrade definitions
    render.js    canvas renderer, all screens + HUD
    audio.js     WebAudio synth SFX + ambient music
    shots.js     autopilot screenshot scenes
    main.js      boot, fixed-step loop, screen state machine
main.ts          entrypoint: validates screenshots, writes dossier.json
serve.ts         static dev server
```

## License

MIT — see `LICENSE`.
