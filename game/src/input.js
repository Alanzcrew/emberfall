// Keyboard + mouse input for Emberfall v2. Held keys steer; one-shot presses
// (confirm, pause, mute, restart, dash) are queued as bit flags and taken once.
// v2 adds the dash: Shift (either side) or right mouse button. Dashing is a
// one-shot action so a held Shift cannot chain-dash through the cooldown.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_RESTART = 8;
export const ACTION_DASH = 16;

const FIELD_WIDTH = 1280;
const FIELD_HEIGHT = 720;
// Dash on Shift (either side) or right mouse button; Space stays fire-only
// so a firing keeper never dashes by accident.

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);
const RESTART = new Set(['KeyR']);
const DASH_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const DIGITS = { Digit1: 1, Digit2: 2, Digit3: 3 };
// Keys whose default browser behaviour (scrolling, etc.) must be suppressed.
const PREVENT = new Set([
  'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
]);

/**
 * Keyboard + mouse input. The canvas is a 1280x720 backing store scaled by
 * CSS, so client coordinates are mapped to logical coordinates by rect scale.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{
 *   move: () => {x:number, y:number},
 *   aim: () => {x:number, y:number},
 *   firing: () => boolean,
 *   dashing: () => boolean,
 *   takeActions: () => number,
 *   takeClick: () => {x:number, y:number} | null,
 *   takeDigit: () => 0|1|2|3
 * }}
 */
export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let mouse = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 };
  let mouseDown = false;
  let click = null;
  let digit = 0;

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || FIELD_WIDTH;
    const h = rect.height || FIELD_HEIGHT;
    return {
      x: ((clientX - rect.left) / w) * FIELD_WIDTH,
      y: ((clientY - rect.top) / h) * FIELD_HEIGHT,
    };
  }

  window.addEventListener('keydown', (event) => {
    if (PREVENT.has(event.code)) event.preventDefault();
    held.add(event.code);
    if (event.repeat) return;
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    else if (RESTART.has(event.code)) actions |= ACTION_RESTART;
    else if (DASH_KEYS.has(event.code)) actions |= ACTION_DASH;
    else if (DIGITS[event.code]) digit = DIGITS[event.code];
  });

  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });

  // A key released while the window is unfocused never sends keyup:
  // let go of everything on blur so the player never gets stuck moving.
  window.addEventListener('blur', () => {
    held.clear();
    mouseDown = false;
  });

  canvas.addEventListener('pointermove', (event) => {
    mouse = toLogical(event.clientX, event.clientY);
  });

  canvas.addEventListener('pointerdown', (event) => {
    mouse = toLogical(event.clientX, event.clientY);
    if (event.button === 2) {
      // Right click = dash, not fire.
      actions |= ACTION_DASH;
      return;
    }
    mouseDown = true;
    click = { x: mouse.x, y: mouse.y };
    // Focus the canvas so keyboard input keeps working after a click.
    if (typeof canvas.focus === 'function') canvas.focus();
  });

  window.addEventListener('pointerup', () => {
    mouseDown = false;
  });

  canvas.addEventListener('pointerleave', () => {
    mouseDown = false;
  });

  // Keep the context menu from popping up on right-click during play.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Movement vector, each component -1..1, normalized on diagonals. */
    move() {
      let x = 0;
      let y = 0;
      for (const code of held) {
        if (LEFT.has(code)) x -= 1;
        else if (RIGHT.has(code)) x += 1;
        else if (UP.has(code)) y -= 1;
        else if (DOWN.has(code)) y += 1;
      }
      if (x !== 0 && y !== 0) {
        const inv = 1 / Math.hypot(x, y);
        x *= inv;
        y *= inv;
      }
      return { x, y };
    },

    /** Current mouse position in logical (1280x720) coordinates. */
    aim() {
      return { x: mouse.x, y: mouse.y };
    },

    /** True while the left mouse button is held or Space is held down. */
    firing() {
      return mouseDown || held.has('Space');
    },

    /** True while a dash key is held (held-dash also works, via actions). */
    dashing() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },

    /** The one-shot ACTION_* presses since the last call (consumed). */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },

    /** The most recent pointerdown position since the last call, else null. */
    takeClick() {
      const taken = click;
      click = null;
      return taken;
    },

    /** 1, 2 or 3 if that digit was pressed since the last call, else 0. */
    takeDigit() {
      const taken = digit;
      digit = 0;
      return taken;
    },
  };
}
