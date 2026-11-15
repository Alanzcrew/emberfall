// Emberfall boot: ?shot / ?seed handling, fixed-step loop, screen state machine.
import { STEP, BEST_KEY } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_SHOOT,
  EVENT_HIT,
  EVENT_KILL,
  EVENT_PICKUP,
  EVENT_LEVELUP,
  EVENT_WAVE_CLEAR,
  EVENT_HURT,
  EVENT_OVER,
  EVENT_WAVE_START,
} from './world.js';
import {
  ACTION_CONFIRM,
  ACTION_PAUSE,
  ACTION_MUTE,
  ACTION_RESTART,
  createInput,
} from './input.js';
import {
  createRenderer,
  SCREEN_TITLE,
  SCREEN_PLAY,
  SCREEN_LEVELUP,
  SCREEN_PAUSED,
  SCREEN_OVER,
} from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const FIELD_WIDTH = 1280;
const FIELD_HEIGHT = 720;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = params.get('seed');
const seedValue = seedParam !== null && seedParam !== '' && Number.isFinite(Number(seedParam))
  ? Number(seedParam) >>> 0
  : null;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');

function announce(text) {
  if (statusEl) statusEl.textContent = text;
}

function loadBest() {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch (_err) {
    return 0;
  }
}

function saveBest(score) {
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch (_err) {
    // Storage unavailable (private mode, blocked cookies, ...): best score
    // simply does not persist. The game keeps running.
  }
}

/** Build the per-frame world input from the live input device. */
function liveInput(input, world) {
  const mv = input.move();
  const aim = input.aim();
  const p = world.state.player;
  const dx = aim.x - p.x;
  const dy = aim.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { mx: mv.x, my: mv.y, ax: dx / len, ay: dy / len, firing: input.firing() };
}

const IDLE_INPUT = { mx: 0, my: 0, ax: 1, ay: 0, firing: false };

/** Play the sounds that match a step() event bitmask. */
function playEvents(audio, events, combo) {
  if (events & EVENT_SHOOT) audio.shoot();
  if (events & EVENT_HIT) audio.hit();
  if (events & EVENT_KILL) audio.kill();
  if (events & EVENT_PICKUP) audio.pickup(combo);
  if (events & EVENT_LEVELUP) audio.levelup();
  if (events & EVENT_WAVE_CLEAR) audio.waveClear();
  if (events & EVENT_HURT) audio.hurt();
  if (events & EVENT_OVER) audio.gameOver();
  if (events & EVENT_WAVE_START) audio.click();
}

/**
 * Screenshot mode: stage the named scene, paint it twice via
 * requestAnimationFrame so the canvas is fully settled, then signal the
 * harness with window.__shotReady.
 */
function runShot(name) {
  const seed = seedValue === null ? 1 : seedValue;
  const world = createWorld(createRandom(seed));
  const renderer = createRenderer(canvas);
  const staged = stageShot(name, world);
  const screen = staged && staged.screen ? staged.screen : SCREEN_TITLE;
  const best = staged && typeof staged.best === 'number' ? staged.best : 0;

  announce('Emberfall screenshot: ' + name + '.');
  renderer.draw(world.state, screen, best);
  window.requestAnimationFrame(() => {
    renderer.draw(world.state, screen, best);
    window.__shotReady = true;
  });
}

/** Normal interactive game: fixed-step loop + screen state machine. */
function runGame() {
  const seed = seedValue === null
    ? (Math.random() * 0x7fffffff) | 0
    : seedValue;
  const world = createWorld(createRandom(seed));
  const input = createInput(canvas);
  const renderer = createRenderer(canvas);
  const audio = createAudio();

  let best = loadBest();
  let screen = SCREEN_TITLE;
  let audioReady = false;

  function ensureAudio() {
    if (!audioReady) {
      audio.ensure();
      audioReady = true;
    }
  }

  // First user gesture unlocks WebAudio (autoplay policy).
  window.addEventListener('pointerdown', ensureAudio, { once: false });
  window.addEventListener('keydown', ensureAudio, { once: false });

  function setScreen(next, announcement) {
    if (next === screen) return;
    screen = next;
    if (announcement) announce(announcement);
  }

  function startRun() {
    world.reset();
    setScreen(
      SCREEN_PLAY,
      'Emberfall started. Wave 1. Move with WASD, aim with the mouse, hold click or Space to fire.',
    );
  }

  function restartRun() {
    world.reset();
    setScreen(
      SCREEN_PLAY,
      'Emberfall restarted. Wave 1. Move with WASD, aim with the mouse, hold click or Space to fire.',
    );
  }

  function pickUpgrade(index) {
    if (!world.state.levelUpPending) return;
    if (index < 0 || index >= world.state.choices.length) return;
    world.chooseUpgrade(index);
    audio.click();
    setScreen(SCREEN_PLAY, 'Upgrade chosen. Wave ' + world.state.wave + '.');
  }

  function handleActions(actions, click) {
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
    }

    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM || click) {
        ensureAudio();
        audio.click();
        startRun();
      }
      return;
    }

    if (screen === SCREEN_OVER) {
      if (actions & ACTION_RESTART || actions & ACTION_CONFIRM || click) {
        ensureAudio();
        audio.click();
        restartRun();
      }
      return;
    }

    if (screen === SCREEN_PAUSED) {
      if (actions & ACTION_PAUSE || actions & ACTION_CONFIRM) {
        setScreen(SCREEN_PLAY, 'Resumed. Wave ' + world.state.wave + '.');
      } else if (actions & ACTION_RESTART) {
        restartRun();
      }
      return;
    }

    if (screen === SCREEN_LEVELUP) {
      // Clicks land on cards; digits pick by number. Pause is ignored here
      // so a stray P cannot hide the choice.
      if (click) {
        const rects = renderer.cardRects();
        for (let i = 0; i < rects.length; i += 1) {
          const r = rects[i];
          if (click.x >= r.x && click.x <= r.x + r.w
            && click.y >= r.y && click.y <= r.y + r.h) {
            pickUpgrade(i);
            return;
          }
        }
      }
      return;
    }

    // SCREEN_PLAY
    if (actions & ACTION_PAUSE) {
      setScreen(SCREEN_PAUSED, 'Paused. Press P or Escape to resume, R to restart.');
    }
  }

  // Leaving the tab mid-run pauses instead of letting the world run on
  // (and the player die) while nobody is watching.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      setScreen(SCREEN_PAUSED, 'Paused. Press P or Escape to resume, R to restart.');
    }
  });

  announce(
    'Emberfall title screen. Press Space or click to begin. Best score ' + best + '.',
  );

  let last = performance.now();
  let accumulator = 0;

  function frame(now) {
    window.requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    accumulator += dt;

    // Drain one-shot input once per frame, before stepping.
    const actions = input.takeActions();
    const click = input.takeClick();
    const digit = input.takeDigit();
    if (actions || click || digit) ensureAudio();

    if (screen === SCREEN_LEVELUP && digit >= 1 && digit <= 3) {
      pickUpgrade(digit - 1);
    }

    handleActions(actions, click);

    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      accumulator -= STEP;
      steps += 1;

      if (screen === SCREEN_TITLE) {
        world.step(STEP, IDLE_INPUT, true);
      } else if (screen === SCREEN_PLAY) {
        const events = world.step(STEP, liveInput(input, world), false);
        playEvents(audio, events, world.state.combo);
        if (events & EVENT_LEVELUP) {
          setScreen(
            SCREEN_LEVELUP,
            'Level up! Choose one of three upgrades: press 1, 2 or 3, or click a card.',
          );
        } else if (events & EVENT_OVER) {
          if (world.state.score > best) {
            best = world.state.score;
            saveBest(best);
          }
          setScreen(
            SCREEN_OVER,
            'Game over. Score ' + world.state.score
              + ', wave ' + world.state.wave
              + ', ' + world.state.kills + ' kills. Best ' + best
              + '. Press R or Space to play again.',
          );
        }
      }
      // PAUSED / LEVELUP / OVER: the world is frozen; only the renderer runs.
    }
    if (steps === 5) accumulator = 0;

    renderer.draw(world.state, screen, best);
  }

  window.requestAnimationFrame(frame);
}

if (shotName) {
  runShot(shotName);
} else {
  runGame();
}
