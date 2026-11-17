// EMBERFALL v3 — keyboard + mouse input. Tracks held keys and the mouse
// position; main.js turns that into the per-step input object (move vector,
// aim vector, firing, dash edge). Dash is edge-triggered: a press sets a
// queued flag that main.js consumes once per step, so holding Shift never
// machine-guns dashes.
//
// Pure browser input: no game logic here.

export function createInput(canvas) {
  const keys = new Set();
  const state = {
    mouseX: 640,
    mouseY: 360,
    mouseDown: false,
    dashQueued: false,
    // One-shot UI actions, consumed by main.js.
    pressedKey: null,
    clicked: false,
    clickX: 0,
    clickY: 0,
  };

  function key(e) {
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }

  window.addEventListener('keydown', (e) => {
    const k = key(e);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
    }
    if (!keys.has(k)) {
      state.pressedKey = k;
      if (k === 'shift') state.dashQueued = true;
    }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(key(e));
  });
  window.addEventListener('blur', () => {
    keys.clear();
    state.mouseDown = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    state.mouseX = (e.clientX - r.left) * (canvas.width / r.width);
    state.mouseY = (e.clientY - r.top) * (canvas.height / r.height);
  });
  canvas.addEventListener('mousedown', (e) => {
    audioUnlockHint();
    if (e.button === 2) {
      state.dashQueued = true;
      return;
    }
    if (e.button === 0) {
      state.mouseDown = true;
      state.clicked = true;
      state.clickX = state.mouseX;
      state.clickY = state.mouseY;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouseDown = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // First interaction unlocks audio (set by main.js).
  let audioUnlockHint = () => {};
  state.onFirstInteract = (fn) => { audioUnlockHint = fn; };

  /** Move vector from WASD / arrows, normalised. */
  state.moveVector = () => {
    let x = 0;
    let y = 0;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
    const l = Math.hypot(x, y);
    if (l > 0) { x /= l; y /= l; }
    return { x, y };
  };

  state.firing = () => state.mouseDown || keys.has(' ');

  /** Consume one queued dash press, if any. */
  state.takeDash = () => {
    const d = state.dashQueued;
    state.dashQueued = false;
    return d;
  };

  /** Consume one pressed key, if any. */
  state.takeKey = () => {
    const k = state.pressedKey;
    state.pressedKey = null;
    return k;
  };

  /** Consume one click, if any. */
  state.takeClick = () => {
    if (!state.clicked) return null;
    state.clicked = false;
    return { x: state.clickX, y: state.clickY };
  };

  return state;
}
