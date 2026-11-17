// EMBERFALL v3 — boot + fixed-step loop + screen state machine.
//
// The loop runs the world at a fixed 1/60s step (accumulator, spiral-of-death
// capped), renders every animation frame, and owns the juice that lives
// outside the sim: trauma-based shake and hit-stop. Screens: title, play,
// levelup, relic, pause, over. `?shot=<name>&seed=<n>` stages a screenshot
// scene instead of starting the title screen.
//
// Exposes window.__emberfall = { world, screen } for debugging and for the
// screenshot harness to confirm the scene staged.

import { FIELD, STEP, BEST_KEY, PROFILE_KEY } from './config.js';
import { createRandom } from './rng.js';
import { createWorld, EVENTS } from './world.js';
import { createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_LEVELUP, SCREEN_RELIC, SCREEN_PAUSE, SCREEN_OVER } from './render.js';
import { createInput } from './input.js';
import { stageShot } from './shots.js';
import { audio } from './audio.js';

const canvas = document.getElementById('game');
canvas.width = FIELD.width;
canvas.height = FIELD.height;

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seedParam = Number(params.get('seed') || '1');
const seed = Number.isFinite(seedParam) ? seedParam : 1;

const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const input = createInput(canvas);
input.onFirstInteract(() => audio.unlock());

let screen = SCREEN_TITLE;
let trauma = 0;
let hitStopT = 0; // real seconds left of slow motion
let timeScale = 1;
let last = performance.now();
let acc = 0;
let viewTime = 0;
let muted = false;
let best = 0;
let profile = { runs: 0, kills: 0, bestWave: 0 };
try {
  best = Number(localStorage.getItem(BEST_KEY) || '0') || 0;
  profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || profile;
} catch (e) { /* private mode: play without persistence */ }

const today = new Date();
const dailySeed = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

function saveProfile() {
  try {
    localStorage.setItem(BEST_KEY, String(best));
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) { /* ignore */ }
}

function startRun() {
  world.reset();
  screen = SCREEN_PLAY;
  trauma = 0;
  profile.runs++;
  audio.unlock();
  audio.click();
}

function endRunIfOver() {
  if (!world.state.over) return;
  if (world.state.score > best) best = world.state.score;
  profile.kills += world.state.kills;
  profile.bestWave = Math.max(profile.bestWave, world.state.wave);
  saveProfile();
  screen = SCREEN_OVER;
}

// Map one step's events to sound + juice.
function handleEvents(events) {
  if (events & EVENTS.HURT) { audio.hurt(); addTrauma(0.45); }
  if (events & EVENTS.KILL) { audio.kill(); addTrauma(0.08); }
  if (events & EVENTS.CRIT) { audio.crit(); addTrauma(0.14); }
  if (events & EVENTS.DASH) { audio.dash(); }
  if (events & EVENTS.NOVA) { audio.nova(); addTrauma(0.3); }
  if (events & EVENTS.LEVELUP) { audio.levelup(); }
  if (events & EVENTS.WAVECLEAR) { audio.waveclear(); }
  if (events & EVENTS.BOSS) { audio.boss(); addTrauma(0.5); }
  if (events & EVENTS.BOSSKILL) { audio.bosskill(); addTrauma(1); hitStop(0.14); }
  if (events & EVENTS.STREAK) { audio.streak(); }
  if (events & EVENTS.EVOLVE) { audio.evolve(); addTrauma(0.5); hitStop(0.1); }
  if (events & EVENTS.SHRINE) { audio.shrine(); }
  if (events & EVENTS.STORM) { audio.storm(); }
  if (events & EVENTS.RELIC) { audio.relic(); }
  if (events & EVENTS.REVIVE) { audio.revive(); addTrauma(0.8); hitStop(0.16); }
  if (events & EVENTS.STUN) { audio.stun(); }
  if (events & EVENTS.ELITEKILL) { audio.streak(); }
}

function addTrauma(amount) {
  trauma = Math.min(1, trauma + amount);
}

function hitStop(seconds) {
  hitStopT = Math.max(hitStopT, seconds);
}

function buildInput() {
  const mv = input.moveVector();
  const p = world.state.player;
  // Aim: mouse position in logical coords, relative to the keeper.
  const ax = input.mouseX - p.x;
  const ay = input.mouseY - p.y;
  const al = Math.hypot(ax, ay) || 1;
  return {
    mx: mv.x, my: mv.y,
    ax: ax / al, ay: ay / al,
    firing: input.firing(),
    dash: input.takeDash(),
  };
}

function chooseFromClick(click, cards) {
  // Cards are drawn by render.js: 300 wide, 210 tall, starting at y=210,
  // centred with a 26px gap. Mirror that layout here for hit-testing.
  const w = 300;
  const h = 210;
  const gap = 26;
  const total = cards.length * w + (cards.length - 1) * gap;
  let x = 640 - total / 2;
  const y = 210;
  for (let i = 0; i < cards.length; i++) {
    if (click.x >= x && click.x <= x + w && click.y >= y && click.y <= y + h) return i;
    x += w + gap;
  }
  return -1;
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  viewTime += dt;
  // Hit-stop runs on real time so it always ends.
  if (hitStopT > 0) {
    hitStopT -= dt;
    timeScale = 0.25;
  } else {
    timeScale = 1;
  }
  trauma = Math.max(0, trauma - 1.2 * dt);

  const key = input.takeKey();
  const click = input.takeClick();

  if (screen === SCREEN_TITLE) {
    if (key === 'enter' || click) startRun();
  } else if (screen === SCREEN_PLAY) {
    if (key === 'p' || key === 'escape') {
      screen = SCREEN_PAUSE;
      audio.click();
    } else if (key === 'm') {
      muted = !muted;
      audio.setMuted(muted);
    } else if (key === 'r') {
      startRun();
    } else {
      acc += dt * timeScale;
      let guard = 0;
      while (acc >= STEP && guard++ < 5) {
        acc -= STEP;
        const events = world.step(STEP, buildInput());
        handleEvents(events);
        if (world.state.levelUpPending) {
          screen = SCREEN_LEVELUP;
          audio.levelup();
          break;
        }
        if (world.state.relicPending) {
          screen = SCREEN_RELIC;
          audio.relic();
          break;
        }
        if (world.state.over) {
          endRunIfOver();
          break;
        }
      }
      if (acc > STEP * 5) acc = 0; // drop backlog, never spiral
    }
  } else if (screen === SCREEN_LEVELUP) {
    let pick = -1;
    if (key === '1' || key === '2' || key === '3') pick = Number(key) - 1;
    if (click) pick = chooseFromClick(click, world.state.choices);
    if (pick >= 0 && pick < world.state.choices.length) {
      world.chooseUpgrade(pick);
      audio.click();
      screen = world.state.relicPending ? SCREEN_RELIC : SCREEN_PLAY;
    }
  } else if (screen === SCREEN_RELIC) {
    let pick = -1;
    if (key === '1' || key === '2' || key === '3') pick = Number(key) - 1;
    if (click) pick = chooseFromClick(click, world.state.relicChoices);
    if (pick >= 0 && pick < world.state.relicChoices.length) {
      world.chooseRelic(pick);
      audio.click();
      screen = SCREEN_PLAY;
    }
  } else if (screen === SCREEN_PAUSE) {
    if (key === 'p' || key === 'escape') screen = SCREEN_PLAY;
    else if (key === 'r') startRun();
    else if (key === 'm') {
      muted = !muted;
      audio.setMuted(muted);
    }
  } else if (screen === SCREEN_OVER) {
    if (key === 'r' || click) startRun();
  }

  renderer.draw(world.state, screen, {
    dt, time: viewTime, trauma, muted, best, profile, dailySeed,
  });
}

if (shotName) {
  // Screenshot mode: stage the scene, render it, and sit still.
  screen = stageShot(shotName, world);
  // Paint several frames so fades/particles settle before the capture.
  for (let i = 0; i < 20; i++) {
    renderer.draw(world.state, screen, {
      dt: STEP, time: i * STEP, trauma: 0, muted: true, best, profile, dailySeed,
    });
  }
  window.__emberfall = { world, screen };
  window.__emberfallReady = true;
} else {
  window.__emberfall = { world, screen: () => screen };
  requestAnimationFrame(frame);
}
