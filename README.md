# EMBERFALL — Hold the light. Survive the dark.

[![best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01)
[![rank](https://make.fun/badge/best-game-01/Alanzcrew/emberfall/rank.svg)](https://make.fun/bounty/best-game-01)
[![reward](https://make.fun/badge/best-game-01/Alanzcrew/emberfall/reward.svg)](https://make.fun/bounty/best-game-01)

A 2D arena-survival roguelite, built with plain canvas 2D — no libraries, no network.
You are the last lantern-keeper in a dark ember field. Shadow creatures ("glooms")
swarm in waves. Hold the light, survive the dark, and see how many waves you last.

Play it on [make.fun](https://make.fun).

## How to play

- **Move:** WASD or arrow keys
- **Aim:** mouse
- **Fire:** hold left mouse button or hold Space
- **Pause:** P or Esc
- **Mute:** M
- **Restart:** R
- **Choose an upgrade:** press 1, 2 or 3, or click a card

Kills drop ember shards (XP). Fill the XP bar to level up and pick 1 of 3 upgrades.
Every 5th wave a Gloombrute elite spawns — kill it for a big score bonus and a
healing heart. Chain kills to build your combo multiplier (up to x8) before the
timer runs out. When your HP hits zero, the run ends — your best score is saved
locally, so beat it next time.

## Features

- Endless waves with escalating enemy counts, HP and speed
- Four enemy types: wisps, crawlers, spitters (ranged shadow orbs) and elite
  Gloombrutes
- 8 stackable upgrades: fire rate, damage, multi-shot, piercing, move speed,
  magnet, vitality, bullet range
- XP shards, combo scoring, wave-clear bonuses, elite heart drops
- Synthesized WebAudio sound effects and ambient music — no audio files
- Title, play, level-up, pause and game-over screens; seeded runs for
  reproducible screenshots

## Run locally

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. (Use
`node serve.ts --port 9000` to pick a different port.) No build step and no
install: the game is plain static files under `game/`.

## Take screenshots

The game supports staged screenshot scenes via URL queries (see `shots.json`):

| File | URL query |
| --- | --- |
| 1-start.jpg | `?shot=start&seed=1` |
| 2-play.jpg | `?shot=play&seed=1` |
| 3-levelup.jpg | `?shot=levelup&seed=2` |
| 4-end.jpg | `?shot=end&seed=3` |

Open one of those URLs in a desktop browser at 1280x720, wait for the scene to
stage, and capture the frame. In normal play you can also press P to pause and
capture any moment.

## Hand in

```sh
node main.ts
```

`main.ts` validates `screenshots/` (at least 3 images, each at most 256 KiB) and
`game/index.html`, then copies `game/` and `screenshots/` to
`MAKEFUN_OUTPUT_DIR` (default `/output`) and writes `dossier.json`. It fails
fast with a clear error before writing anything if the screenshots are missing
or too large.

## License

MIT — see [LICENSE](LICENSE).

