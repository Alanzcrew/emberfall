// EMBERFALL v2 audio — WebAudio synth SFX + quiet ambient music. Browser only.
// The AudioContext is created lazily in ensure() (first user gesture); every
// method is a safe no-op before that, and everything is guarded with try/catch.
// v2 adds dash (whoosh), nova (deep boom), boss (dread sting), streak
// (rising chime), and a low bass pulse under the ambient pad.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let musicTimer = null;
  let pluckStep = 0;

  // Pentatonic ladder for the sparse ambient pluck (A minor pentatonic).
  const PENTA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];

  function ensure() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      const AC = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      startMusic();
    } catch (err) {
      ctx = null;
    }
  }

  function startMusic() {
    try {
      if (!ctx || !master) return;
      // Quiet detuned triangle pad through a lowpass filter.
      const padGain = ctx.createGain();
      padGain.gain.value = 0.045;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 720;
      filter.Q.value = 0.4;
      padGain.connect(filter);
      filter.connect(master);
      // Slow LFO breathing on the filter so the pad never sits still.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      const freqs = [110, 164.81, 220];
      for (let i = 0; i < freqs.length; i += 1) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freqs[i];
        osc.detune.value = i === 1 ? 6 : -5;
        osc.connect(padGain);
        osc.start();
      }
      // v2: low bass pulse under the pad, one soft thump per bar.
      const bassGain = ctx.createGain();
      bassGain.gain.value = 0.05;
      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowpass';
      bassFilter.frequency.value = 220;
      bassGain.connect(bassFilter);
      bassFilter.connect(master);
      const bass = ctx.createOscillator();
      bass.type = 'sine';
      bass.frequency.value = 55;
      bass.connect(bassGain);
      bass.start();
      // Sparse pentatonic pluck, roughly every 0.45s.
      musicTimer = setInterval(() => {
        try {
          if (!ctx || ctx.state !== 'running' || muted) return;
          const note = PENTA[pluckStep % PENTA.length];
          pluckStep += 1;
          // Skip most beats so the pluck stays sparse.
          if (pluckStep % 3 !== 0) return;
          pluck(note, 0.5);
        } catch (err) { /* music must never break the game */ }
      }, 450);
    } catch (err) { /* music is best-effort */ }
  }

  function pluck(freq, dur) {
    try {
      if (!ctx || !master) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (err) { /* no-op */ }
  }

  // Short oscillator blip with an optional pitch slide.
  function tone(type, freq, freqEnd, dur, vol, delay) {
    try {
      if (!ctx || !master) return;
      const t0 = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd != null && freqEnd !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (err) { /* no-op */ }
  }

  // Brief filtered-noise burst (hit ticks, hurt texture, dash whoosh).
  function noise(dur, vol, delay, filterFreq) {
    try {
      if (!ctx || !master) return;
      const t0 = ctx.currentTime + (delay || 0);
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = filterFreq || 2400;
      filter.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t0);
    } catch (err) { /* no-op */ }
  }

  function shoot() {
    // Short square blip, pitch varies slightly so rapid fire stays lively.
    const base = 620 + Math.random() * 90;
    tone('square', base, base * 0.62, 0.07, 0.08);
  }

  function hit() {
    noise(0.05, 0.12, 0, 3200);
    tone('square', 210, 140, 0.05, 0.06);
  }

  function kill() {
    // Downward chirp.
    tone('sawtooth', 520, 110, 0.18, 0.1);
    noise(0.09, 0.08, 0, 1400);
  }

  function pickup(combo) {
    // Sine ping rising with the combo (one semitone per combo step, capped).
    const c = Math.max(0, Math.min(combo || 0, 12));
    const freq = 523.25 * Math.pow(2, c / 12);
    tone('sine', freq, freq * 1.5, 0.14, 0.12);
    // High combos sparkle: a quiet fifth above the ping.
    if (c >= 4) tone('sine', freq * 1.5, freq * 2.25, 0.12, 0.06, 0.03);
  }

  function levelup() {
    // Four-note rising arpeggio.
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i += 1) {
      tone('triangle', notes[i], null, 0.16, 0.12, i * 0.09);
    }
  }

  function hurt() {
    // Low saw buzz + dull thud.
    tone('sawtooth', 130, 70, 0.25, 0.16);
    noise(0.16, 0.12, 0, 500);
  }

  function waveClear() {
    tone('sine', 783.99, null, 0.18, 0.12);
    tone('sine', 1046.5, null, 0.3, 0.12, 0.13);
  }

  function gameOver() {
    // Slow descending notes.
    const notes = [392, 329.63, 261.63, 196];
    for (let i = 0; i < notes.length; i += 1) {
      tone('triangle', notes[i], null, 0.34, 0.13, i * 0.22);
    }
  }

  function click() {
    tone('sine', 880, 660, 0.04, 0.07);
  }

  // ---- v2 sounds ----
  function dash() {
    // Airy whoosh: swept noise + a quick rising sine.
    noise(0.16, 0.14, 0, 1800);
    tone('sine', 300, 720, 0.14, 0.07);
  }

  function nova() {
    // Deep boom: low sine drop + warm noise bloom.
    tone('sine', 180, 45, 0.4, 0.2);
    noise(0.3, 0.1, 0, 900);
    tone('triangle', 523.25, 784, 0.2, 0.06, 0.02);
  }

  function boss() {
    // Dread sting: dissonant low pair, then a slow toll.
    tone('sawtooth', 98, 92, 0.7, 0.14);
    tone('sawtooth', 103.83, 98, 0.7, 0.12);
    tone('triangle', 196, 185, 0.5, 0.1, 0.25);
  }

  function streak() {
    // Rising three-note chime for kill streaks.
    const notes = [659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i += 1) {
      tone('sine', notes[i], null, 0.16, 0.12, i * 0.06);
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      if (master && ctx) {
        master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
      }
    } catch (err) { /* no-op */ }
  }

  function isMuted() {
    return muted;
  }

  return {
    ensure,
    shoot,
    hit,
    kill,
    pickup,
    levelup,
    hurt,
    waveClear,
    gameOver,
    click,
    dash,
    nova,
    boss,
    streak,
    setMuted,
    isMuted,
  };
}
