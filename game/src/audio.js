// EMBERFALL v3 — WebAudio synth: no audio files, everything is generated.
// A low ambient pad + a slow bass pulse runs under play; every game event
// gets a short synthesized voice. All of it is guarded: with no user
// gesture yet (or no AudioContext at all, e.g. headless) every call is a
// silent no-op, so the sim and the screenshots never depend on sound.

let ctx = null;
let master = null;
let padNodes = null;
let muted = false;

function ensure() {
  if (ctx) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return true;
  } catch (e) {
    return false;
  }
}

function tone(freq, dur, type, vol, slideTo) {
  if (!ensure() || muted) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, vol, filterFreq, slideTo) {
  if (!ensure() || muted) return;
  const t0 = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterFreq, t0);
  if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
}

function startPad() {
  if (!ensure() || muted || padNodes) return;
  const gain = ctx.createGain();
  gain.gain.value = 0.05;
  gain.connect(master);
  const oscs = [];
  for (const f of [110, 164.8, 220]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 8;
    o.connect(gain);
    o.start();
    oscs.push(o);
  }
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start();
  padNodes = { gain, oscs, lfo };
}

function stopPad() {
  if (!padNodes) return;
  try {
    for (const o of padNodes.oscs) o.stop();
    padNodes.lfo.stop();
  } catch (e) { /* already stopped */ }
  padNodes = null;
}

export const audio = {
  /** Call from the first user gesture; unlocks the context + the pad. */
  unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
    startPad();
  },
  setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.5;
    if (muted) stopPad();
    else startPad();
  },
  isMuted() { return muted; },

  shoot() { tone(880, 0.07, 'triangle', 0.05, 520); },
  hit() { tone(300, 0.05, 'square', 0.04, 180); },
  kill() { tone(520, 0.12, 'triangle', 0.07, 180); noise(0.08, 0.04, 2400, 500); },
  crit() { tone(1240, 0.1, 'square', 0.06, 620); tone(1860, 0.08, 'sine', 0.05, 930); },
  hurt() { tone(160, 0.2, 'sawtooth', 0.12, 70); noise(0.12, 0.06, 900, 200); },
  dash() { noise(0.18, 0.1, 600, 3200); },
  nova() { tone(90, 0.4, 'sine', 0.16, 40); noise(0.3, 0.1, 1400, 180); },
  levelup() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => tone(f, 0.16, 'triangle', 0.08), i * 70);
    });
  },
  waveclear() { tone(392, 0.14, 'triangle', 0.08); setTimeout(() => tone(587, 0.2, 'triangle', 0.08), 110); },
  boss() { tone(65, 0.7, 'sawtooth', 0.14, 55); tone(98, 0.7, 'sawtooth', 0.1, 82); },
  bosskill() {
    [392, 523, 659, 784].forEach((f, i) => {
      setTimeout(() => tone(f, 0.22, 'triangle', 0.09), i * 90);
    });
    noise(0.5, 0.08, 900, 120);
  },
  streak() { tone(1046, 0.1, 'sine', 0.07); setTimeout(() => tone(1318, 0.14, 'sine', 0.07), 80); },
  evolve() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => {
      setTimeout(() => tone(f, 0.2, 'triangle', 0.08), i * 80);
    });
  },
  shrine() { tone(660, 0.3, 'sine', 0.08, 990); tone(880, 0.4, 'sine', 0.06, 1320); },
  storm() { noise(0.8, 0.1, 300, 90); tone(55, 0.8, 'sine', 0.14, 40); },
  relic() { tone(784, 0.25, 'sine', 0.08); setTimeout(() => tone(1174, 0.35, 'sine', 0.07), 140); },
  revive() { tone(220, 0.5, 'sine', 0.12, 880); noise(0.4, 0.06, 1800, 400); },
  heal() { tone(740, 0.12, 'sine', 0.06, 990); },
  click() { tone(660, 0.05, 'triangle', 0.05); },
  stun() { tone(1200, 0.09, 'square', 0.05, 300); },
};
