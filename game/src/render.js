// EMBERFALL v3 — the canvas renderer. Reads world state, draws every
// screen. Visual-only: it keeps its own particles and floating texts, fed
// from the world's transient `fx` descriptors each frame, and never mutates
// the simulation.
//
// Juice follows the trauma model: hits add trauma, shake is trauma^2 on
// summed sines, and everything snaps back to rest — the camera offset is
// visual only and never moves a body.

import { FIELD, PALETTE, FONT, SHRINE, STORM } from './config.js';
import { UPGRADE_DEFS, defById } from './upgrades.js';
import { RELIC_DEFS, relicById } from './relics.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_LEVELUP = 'levelup';
export const SCREEN_RELIC = 'relic';
export const SCREEN_PAUSE = 'pause';
export const SCREEN_OVER = 'over';

const TAU = Math.PI * 2;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const particles = [];
  const floaters = [];
  let shakeT = 0;

  function feedFx(fx) {
    for (const f of fx) {
      if (f.kind === 'kill') {
        burst(f.x, f.y, f.big ? 16 : 9, f.elite ? '#ffd166' : '#ff9a3c', f.big ? 260 : 170);
        if (f.elite) floaters.push({ x: f.x, y: f.y - 20, text: 'ELITE DOWN', color: '#ffd166', t: 1.2, size: 15 });
      } else if (f.kind === 'hit') {
        burst(f.x, f.y, 4, '#ffb347', 120);
      } else if (f.kind === 'crit') {
        burst(f.x, f.y, 8, '#ffe066', 220);
        floaters.push({ x: f.x, y: f.y - 14, text: 'CRIT', color: '#ffe066', t: 0.8, size: 16 });
      } else if (f.kind === 'nova') {
        rings.push({ x: f.x, y: f.y, r: 10, max: f.r, t: 0.45, total: 0.45, color: '#ff9a3c' });
        burst(f.x, f.y, 18, '#ff7a3c', 300);
      } else if (f.kind === 'dash') {
        burst(f.x, f.y, 6, '#7de3ff', 140);
      } else if (f.kind === 'heal') {
        burst(f.x, f.y, 8, '#5df2c8', 110);
        floaters.push({ x: f.x, y: f.y - 22, text: '+HP', color: '#5df2c8', t: 1, size: 14 });
      } else if (f.kind === 'hurt') {
        burst(f.x, f.y, 7, '#ff5d5d', 150);
      } else if (f.kind === 'shield') {
        rings.push({ x: f.x, y: f.y, r: 18, max: 46, t: 0.35, total: 0.35, color: '#7de3ff' });
      } else if (f.kind === 'shrine') {
        rings.push({ x: f.x, y: f.y, r: 20, max: 120, t: 0.6, total: 0.6, color: '#5df2c8' });
        burst(f.x, f.y, 20, '#5df2c8', 220);
      } else if (f.kind === 'storm') {
        floaters.push({ x: f.x, y: f.y - 40, text: 'EMBER STORM', color: '#ff7a3c', t: 1.6, size: 20 });
      } else if (f.kind === 'evolve') {
        rings.push({ x: f.x, y: f.y, r: 14, max: 150, t: 0.7, total: 0.7, color: '#ffd166' });
        burst(f.x, f.y, 26, '#ffd166', 320);
      } else if (f.kind === 'stun') {
        floaters.push({ x: f.x, y: f.y - 24, text: 'STUNNED', color: '#ffe066', t: 1, size: 14 });
      } else if (f.kind === 'bosskill') {
        burst(f.x, f.y, 40, '#ff3d6e', 420);
        rings.push({ x: f.x, y: f.y, r: 20, max: 260, t: 0.8, total: 0.8, color: '#ff3d6e' });
      } else if (f.kind === 'elite') {
        floaters.push({ x: f.x, y: f.y - 26, text: 'ELITE', color: '#ffd166', t: 1, size: 13 });
      } else if (f.kind === 'spawn') {
        rings.push({ x: f.x, y: f.y, r: 6, max: 26, t: 0.4, total: 0.4, color: '#7b5cff' });
      } else if (f.kind === 'chain') {
        chains.push({ x: f.x, y: f.y, x2: f.x2, y2: f.y2, t: 0.18, total: 0.18 });
      }
    }
  }

  const rings = [];
  const chains = [];

  function burst(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.3 + Math.random() * 0.7);
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        t: 0.45 + Math.random() * 0.3, total: 0.75, color,
        r: 1.5 + Math.random() * 2.5,
      });
    }
  }

  function stepFx(dt) {
    for (const pt of [...particles]) {
      pt.t -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      if (pt.t <= 0) particles.splice(particles.indexOf(pt), 1);
    }
    for (const r of [...rings]) {
      r.t -= dt;
      if (r.t <= 0) rings.splice(rings.indexOf(r), 1);
    }
    for (const c of [...chains]) {
      c.t -= dt;
      if (c.t <= 0) chains.splice(chains.indexOf(c), 1);
    }
    for (const f of [...floaters]) {
      f.t -= dt;
      f.y -= 34 * dt;
      if (f.t <= 0) floaters.splice(floaters.indexOf(f), 1);
    }
  }

  function draw(state, screen, view) {
    const dt = view.dt || 1 / 60;
    shakeT += dt;
    feedFx(state.fx);
    stepFx(dt);
    ctx.save();
    ctx.clearRect(0, 0, FIELD.width, FIELD.height);
    // Trauma shake: summed sines, camera offset only.
    const trauma = view.trauma || 0;
    if (trauma > 0.001 && screen === SCREEN_PLAY) {
      const sh = trauma * trauma;
      const ox = 11 * sh * Math.sin(shakeT * 47.3);
      const oy = 8 * sh * Math.sin(shakeT * 61.7);
      ctx.translate(ox, oy);
    }
    drawBackdrop(state, view);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, view);
    } else {
      drawField(state, view);
      drawHud(state, view);
      if (screen === SCREEN_LEVELUP) drawLevelUp(state, view);
      else if (screen === SCREEN_RELIC) drawRelics(state, view);
      else if (screen === SCREEN_PAUSE) drawPause(view);
      else if (screen === SCREEN_OVER) drawOver(state, view);
    }
    // No banner over the choice screens: it would collide with the title.
    if (screen !== SCREEN_LEVELUP && screen !== SCREEN_RELIC) drawBanner(state);
    ctx.restore();
  }

  function drawBackdrop(state, view) {
    const g = ctx.createLinearGradient(0, 0, 0, FIELD.height);
    g.addColorStop(0, '#0d0b1e');
    g.addColorStop(0.6, '#141130');
    g.addColorStop(1, '#0a0918');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, FIELD.width + 40, FIELD.height + 40);
    // Ember rain during the storm, drifting motes otherwise.
    ctx.fillStyle = state.stormActive ? 'rgba(255,122,60,0.5)' : 'rgba(255,154,60,0.16)';
    const n = state.stormActive ? 90 : 36;
    for (let i = 0; i < n; i++) {
      const x = ((i * 197.3 + view.time * (state.stormActive ? 260 : 12)) % (FIELD.width + 40)) - 20;
      const y = ((i * 89.7 + view.time * (state.stormActive ? 420 : 26)) % (FIELD.height + 40)) - 20;
      ctx.fillRect(x, y, 2, state.stormActive ? 7 : 2);
    }
    // Arena dot grid.
    ctx.fillStyle = 'rgba(139,134,163,0.10)';
    for (let x = 40; x < FIELD.width; x += 80) {
      for (let y = 40; y < FIELD.height; y += 80) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  function drawField(state, view) {
    const p = state.player;
    // Pillars.
    for (const pil of state.pillars) {
      ctx.fillStyle = PALETTE.pillar;
      ctx.beginPath();
      ctx.arc(pil.x, pil.y, pil.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,154,60,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,154,60,0.25)';
      ctx.beginPath();
      ctx.arc(pil.x, pil.y, pil.r * 0.45, 0, TAU);
      ctx.fill();
    }
    // Burn fields.
    for (const f of state.burnFields) {
      ctx.fillStyle = `rgba(255,110,40,${0.16 + 0.1 * Math.sin(view.time * 9)})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    }
    // Shrine.
    if (state.shrine && !state.shrine.claimed) {
      const sh = state.shrine;
      const pulse = 0.5 + 0.3 * Math.sin(view.time * 3);
      ctx.strokeStyle = `rgba(93,242,200,${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, sh.r, 0, TAU);
      ctx.stroke();
      if (sh.progress > 0) {
        ctx.strokeStyle = '#5df2c8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, sh.r - 7, -Math.PI / 2, -Math.PI / 2 + TAU * (sh.progress / 2.5));
        ctx.stroke();
      }
      ctx.fillStyle = '#5df2c8';
      ctx.font = '600 13px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('SHRINE', sh.x, sh.y - sh.r - 8);
    }
    // Spawn telegraphs.
    for (const ps of state.pendingSpawns) {
      const frac = 1 - ps.t / 0.5;
      ctx.strokeStyle = `rgba(123,92,255,${0.4 + 0.5 * frac})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, 8 + 18 * frac, 0, TAU);
      ctx.stroke();
    }
    // Gems + hearts.
    for (const gem of state.gems) {
      ctx.save();
      ctx.translate(gem.x, gem.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }
    for (const h of state.hearts) {
      drawHeart(h.x, h.y, 9, '#ff5d5d');
    }
    // Enemies.
    for (const e of state.enemies) drawEnemy(e, view);
    // Orbiters.
    if (p.stats.orbital > 0) {
      const os = orbitalStatsOf(p);
      for (const o of state.orbiters) {
        const ox = p.x + Math.cos(o.angle) * os.radius;
        const oy = p.y + Math.sin(o.angle) * os.radius;
        const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, 12);
        g.addColorStop(0, '#ffe066');
        g.addColorStop(1, 'rgba(255,122,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, 12, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.arc(ox, oy, 5, 0, TAU);
        ctx.fill();
      }
    }
    // Bullets.
    for (const b of state.bullets) {
      ctx.fillStyle = b.crit ? '#ffe066' : '#ff9a3c';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.crit ? 6 : 5, 0, TAU);
      ctx.fill();
    }
    // Enemy orbs.
    for (const o of state.orbs) {
      ctx.fillStyle = '#b18cff';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.radius, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(177,140,255,0.3)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.radius + 4, 0, TAU);
      ctx.fill();
    }
    // Player.
    drawPlayer(state, view);
    // Particles, rings, chains, floaters.
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.t / pt.total);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const r of rings) {
      const frac = 1 - r.t / r.total;
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - frac;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r + (r.max - r.r) * frac, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const c of chains) {
      ctx.strokeStyle = `rgba(125,227,255,${c.t / c.total})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
    }
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = f.color;
      ctx.font = `700 ${f.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    // Low-HP vignette pulse.
    if (p.hp < p.maxHp * 0.3 && !state.over) {
      const a = 0.22 + 0.12 * Math.sin(view.time * 6);
      const vg = ctx.createRadialGradient(640, 360, 240, 640, 360, 620);
      vg.addColorStop(0, 'rgba(255,40,60,0)');
      vg.addColorStop(1, `rgba(255,40,60,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  function orbitalStatsOf(p) {
    // Mirror upgrades.orbitalStats without importing the helper twice.
    const stacks = p.stats.orbital;
    const evolved = p.stats.orbitalEvolved;
    return {
      count: stacks * (evolved ? 2 : 1),
      radius: 74,
      speed: 3.4 * (evolved ? 1.4 : 1),
    };
  }

  function drawHeart(x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.3, y, x - s * 0.6, y - s, x, y - s * 0.25);
    ctx.bezierCurveTo(x + s * 0.6, y - s, x + s * 1.3, y, x, y + s * 0.9);
    ctx.fill();
  }

  function drawEnemy(e, view) {
    const flash = e.flash > 0;
    const alpha = e.type === 'stalker' && !e.visible ? 0.22 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);
    const wob = Math.sin(e.t * 6 + e.id) * 0.08;
    ctx.rotate(wob);
    if (e.elite) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, e.radius + 6 + Math.sin(view.time * 4) * 2, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = flash ? '#ffffff' : enemyColor(e.type);
    switch (e.type) {
      case 'wisp': {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(-3, -3, 3, 0, TAU);
        ctx.fill();
        break;
      }
      case 'crawler': {
        // Spiky blob.
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          const r = i % 2 === 0 ? e.radius + 5 : e.radius - 3;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'spitter': {
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-e.radius * 0.75, -e.radius * 0.75, e.radius * 1.5, e.radius * 1.5);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = '#0d0b1e';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'stalker': {
        // Crescent: circle minus an offset circle.
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(5, -2, e.radius * 0.85, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'dasher': {
        if (e.mode === 'windup') {
          // Telegraph: red line along the locked lunge direction.
          ctx.strokeStyle = 'rgba(255,61,110,0.8)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(e.lockX * 90, e.lockY * 90);
          ctx.stroke();
          ctx.scale(1.25, 0.7);
        }
        ctx.beginPath();
        ctx.moveTo(e.radius + 6, 0);
        ctx.lineTo(-e.radius, e.radius * 0.8);
        ctx.lineTo(-e.radius, -e.radius * 0.8);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'mender': {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0d0b1e';
        ctx.fillRect(-2, -e.radius + 4, 4, e.radius * 2 - 8);
        ctx.fillRect(-e.radius + 4, -2, e.radius * 2 - 8, 4);
        break;
      }
      case 'splitter': {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(13,11,30,0.55)';
        ctx.beginPath();
        ctx.arc(-e.radius * 0.35, 0, e.radius * 0.32, 0, TAU);
        ctx.arc(e.radius * 0.35, 0, e.radius * 0.32, 0, TAU);
        ctx.fill();
        break;
      }
      case 'charger': {
        if (e.mode === 'aim') {
          // The lane telegraph: a red band from the charger outward.
          ctx.strokeStyle = 'rgba(255,61,110,0.55)';
          ctx.lineWidth = e.radius * 1.4;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          const n = norm2(e.lockX - e.x, e.lockY - e.y);
          ctx.lineTo(n.x * 300, n.y * 300);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-e.radius, -e.radius * 0.7);
        ctx.lineTo(e.radius * 0.6, -e.radius * 0.7);
        ctx.lineTo(e.radius, 0);
        ctx.lineTo(e.radius * 0.6, e.radius * 0.7);
        ctx.lineTo(-e.radius, e.radius * 0.7);
        ctx.closePath();
        ctx.fill();
        // Horns.
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.moveTo(-e.radius * 0.4, -e.radius * 0.7);
        ctx.lineTo(-e.radius * 0.1, -e.radius * 1.3);
        ctx.lineTo(e.radius * 0.2, -e.radius * 0.7);
        ctx.closePath();
        ctx.fill();
        if (e.stunT > 0) {
          ctx.fillStyle = '#ffe066';
          ctx.font = `700 14px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText('✦', 0, -e.radius - 8);
        }
        break;
      }
      case 'brute': {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          const x = Math.cos(a) * e.radius;
          const y = Math.sin(a) * e.radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'gloomlord': {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
        // Crown spikes.
        ctx.fillStyle = '#ffd166';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 14 - 5, -e.radius + 6);
          ctx.lineTo(i * 14, -e.radius - 12);
          ctx.lineTo(i * 14 + 5, -e.radius + 6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = '#0d0b1e';
        ctx.beginPath();
        ctx.arc(-14, -6, 5, 0, TAU);
        ctx.arc(14, -6, 5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'matriarch': {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(196,77,255,0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius * 0.7, 0, TAU);
        ctx.stroke();
        // Ring of eyes.
        ctx.fillStyle = '#ffe066';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + e.t * 0.5;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * e.radius * 0.55, Math.sin(a) * e.radius * 0.55, 3, 0, TAU);
          ctx.fill();
        }
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    // HP bar for tough enemies.
    if (e.maxHp >= 7 && e.hp < e.maxHp) {
      const w = e.radius * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 10, w, 4);
      ctx.fillStyle = e.elite ? '#ffd166' : '#ff5d5d';
      ctx.fillRect(e.x - w / 2, e.y - e.radius - 10, w * (e.hp / e.maxHp), 4);
    }
    // Mender heal beam.
    if (e.type === 'mender' && e.healTarget && e.healTarget.hp > 0) {
      ctx.strokeStyle = 'rgba(93,242,200,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.healTarget.x, e.healTarget.y);
      ctx.stroke();
    }
    // Stalker shimmer while hidden: a faint ring so the fade is fair.
    if (e.type === 'stalker' && !e.visible) {
      ctx.strokeStyle = 'rgba(184,169,255,0.5)';
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 5, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function norm2(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  function enemyColor(type) {
    switch (type) {
      case 'wisp': return '#b8a9ff';
      case 'crawler': return '#8f7bff';
      case 'spitter': return '#6ee7a0';
      case 'stalker': return '#d8c9ff';
      case 'dasher': return '#ff8a5c';
      case 'mender': return '#5df2c8';
      case 'splitter': return '#c44dff';
      case 'charger': return '#ff5d5d';
      case 'brute': return '#7b5cff';
      case 'gloomlord': return '#ff3d6e';
      case 'matriarch': return '#c44dff';
      default: return '#b8a9ff';
    }
  }

  function drawPlayer(state, view) {
    const p = state.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    // Lantern glow.
    const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, 90);
    glow.addColorStop(0, 'rgba(255,179,71,0.5)');
    glow.addColorStop(1, 'rgba(255,179,71,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 90, 0, TAU);
    ctx.fill();
    // Dash afterimage ring.
    if (p.dashT > 0) {
      ctx.strokeStyle = 'rgba(125,227,255,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 10, 0, TAU);
      ctx.stroke();
    }
    // Fury aura.
    if (p.furyT > 0) {
      ctx.strokeStyle = 'rgba(255,122,60,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 6 + Math.sin(view.time * 8) * 2, 0, TAU);
      ctx.stroke();
    }
    // Cloak body.
    ctx.fillStyle = p.invuln > 0 && Math.floor(view.time * 16) % 2 === 0
      ? 'rgba(255,179,71,0.6)' : '#2a2350';
    ctx.beginPath();
    ctx.moveTo(0, -p.radius - 4);
    ctx.lineTo(p.radius * 0.9, p.radius * 0.8);
    ctx.lineTo(-p.radius * 0.9, p.radius * 0.8);
    ctx.closePath();
    ctx.fill();
    // Hood + face.
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(0, -4, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0d0b1e';
    ctx.beginPath();
    ctx.arc(-3, -5, 1.8, 0, TAU);
    ctx.arc(3, -5, 1.8, 0, TAU);
    ctx.fill();
    // Lantern in the aim hand.
    const la = Math.atan2(p.aimY, p.aimX);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(Math.cos(la) * 20, Math.sin(la) * 20, 5, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Shield ring.
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(125,227,255,0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 8, 0, TAU);
      ctx.stroke();
    }
  }

  function drawHud(state, view) {
    const p = state.player;
    // HP bar.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(16, 16, 240, 18);
    ctx.fillStyle = PALETTE.hp;
    ctx.fillRect(16, 16, 240 * Math.max(0, p.hp / p.maxHp), 18);
    if (p.shield > 0) {
      ctx.fillStyle = '#7de3ff';
      ctx.fillRect(16, 16, 240 * Math.min(1, p.shield / p.maxHp), 4);
    }
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, 22, 30);
    // XP bar.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(16, 40, 240, 8);
    ctx.fillStyle = PALETTE.xp;
    ctx.fillRect(16, 40, 240 * Math.min(1, p.xp / p.xpNext), 8);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(`LV ${p.level}`, 262, 48);
    // Score + wave.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(`${state.score.toLocaleString('en-US')}`, 640, 34);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(`WAVE ${state.wave}  ·  KILLS ${state.kills}`, 640, 54);
    // Combo.
    if (state.combo >= 2) {
      ctx.fillStyle = state.combo >= 10 ? '#ff7a3c' : PALETTE.gold;
      ctx.font = `800 ${20 + Math.min(10, state.combo)}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`COMBO x${state.combo}`, 1264, 36);
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(`x${state.combo} score`, 1264, 54);
    }
    // Dash pips.
    ctx.textAlign = 'left';
    for (let i = 0; i < p.stats.dashCharges; i++) {
      ctx.fillStyle = i < p.dashCharges ? '#7de3ff' : 'rgba(125,227,255,0.25)';
      ctx.beginPath();
      ctx.arc(28 + i * 22, 66, 7, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText('DASH', 28 + p.stats.dashCharges * 22 + 6, 70);
    // Storm timer.
    if (state.stormActive) {
      ctx.fillStyle = '#ff7a3c';
      ctx.font = `700 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`EMBER STORM — ${Math.ceil(state.stormLeft)}s  ·  2x XP`, 640, 76);
    }
    // Boss bar — shifted down while the storm banner occupies the line above.
    if (state.boss) {
      const b = state.boss;
      const w = 420;
      const top = state.stormActive ? 108 : 84;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(640 - w / 2, top, w, 12);
      ctx.fillStyle = state.bossKind === 'matriarch' ? PALETTE.matriarch : PALETTE.boss;
      ctx.fillRect(640 - w / 2, top, w * Math.max(0, b.hp / b.maxHp), 12);
      ctx.fillStyle = PALETTE.text;
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        state.bossKind === 'matriarch' ? 'GLOOM MATRIARCH' : 'GLOOMLORD',
        640, top - 6,
      );
    }
    // Owned upgrades strip.
    const owned = Object.entries(p.stacks).filter(([, n]) => n > 0);
    let ox = 16;
    const oy = FIELD.height - 34;
    ctx.font = `700 11px ${FONT}`;
    for (const [id, n] of owned) {
      const def = defById(id);
      if (!def) continue;
      const label = `${def.name} ${'●'.repeat(n)}`;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(16,12,36,0.75)';
      ctx.fillRect(ox, oy, w, 22);
      ctx.fillStyle = PALETTE.gold;
      ctx.textAlign = 'left';
      ctx.fillText(label, ox + 7, oy + 15);
      ox += w + 6;
      if (ox > 900) break;
    }
    // Fury timer.
    if (p.furyT > 0) {
      ctx.fillStyle = '#ff7a3c';
      ctx.font = `700 13px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`FURY ${Math.ceil(p.furyT)}s`, 1264, FIELD.height - 16);
    }
  }

  function drawBanner(state) {
    if (!state.banner) return;
    const a = Math.min(1, state.banner.t / 0.6);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(state.banner.text, 640, 150);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(state.banner.sub || '', 640, 176);
    ctx.globalAlpha = 1;
  }

  function drawTitle(state, view) {
    // Big ember glow behind the title.
    const g = ctx.createRadialGradient(640, 300, 10, 640, 300, 320);
    g.addColorStop(0, 'rgba(255,154,60,0.28)');
    g.addColorStop(1, 'rgba(255,154,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `800 84px ${FONT}`;
    ctx.fillText('EMBERFALL', 640, 250);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText('Hold the light. Survive the dark.', 640, 288);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText('A 2D arena-survival roguelite — no libraries, no network, just you and the dark.', 640, 318);
    if (view.best > 0) {
      ctx.fillStyle = PALETTE.gold;
      ctx.font = `700 17px ${FONT}`;
      ctx.fillText(`BEST SCORE  ${view.best.toLocaleString('en-US')}`, 640, 356);
    }
    if (view.profile && view.profile.runs > 0) {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = `400 14px ${FONT}`;
      ctx.fillText(
        `${view.profile.runs} runs  ·  ${view.profile.kills.toLocaleString('en-US')} glooms banished  ·  best wave ${view.profile.bestWave}`,
        640, 382,
      );
    }
    const pulse = 0.6 + 0.4 * Math.sin(view.time * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.ember;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText('CLICK OR PRESS ENTER TO BEGIN', 640, 450);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText('WASD move  ·  Mouse aim  ·  Click / Space fire  ·  Shift / Right-click dash (2 charges)', 640, 500);
    ctx.fillText('1 / 2 / 3 choose upgrades  ·  P pause  ·  M mute  ·  R restart', 640, 524);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText('New in v3: stalkers, menders, chargers, elites, a second boss, shrines,', 640, 574);
    ctx.fillText('relics, weapon evolutions, Ember Storms, and pillars that reshape the arena.', 640, 594);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `400 12px ${FONT}`;
    ctx.fillText('Daily ember seed: ' + (view.dailySeed || '—') + '  ·  v3', 640, 640);
  }

  function drawLevelUp(state, view) {
    dim();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText('LEVEL UP!', 640, 130);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(`Level ${state.player.level} — choose an ember`, 640, 160);
    drawCards(state.choices.map((c) => {
      const def = defById(c.id);
      if (!def) return { title: 'Ember Draught', desc: 'Heal 30 HP right now.', pips: '' };
      return {
        title: def.name,
        desc: def.desc,
        pips: '●'.repeat(c.stacks) + '○'.repeat(Math.max(0, 3 - c.stacks)),
        evolve: def.evolve && c.stacks === 2 ? 'EVOLVES at 3 stacks!' : '',
      };
    }), view);
  }

  function drawRelics(state, view) {
    dim();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText('CHOOSE A RELIC', 640, 130);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText('A permanent blessing for this run', 640, 160);
    drawCards(state.relicChoices.map((c) => {
      const def = relicById(c.id);
      if (!def) return { title: '?', desc: '', pips: '' };
      return { title: def.name, desc: def.desc, pips: 'RELIC', gold: true };
    }), view);
  }

  function drawCards(cards, view) {
    const w = 300;
    const h = 210;
    const gap = 26;
    const total = cards.length * w + (cards.length - 1) * gap;
    let x = 640 - total / 2;
    const y = 210;
    cards.forEach((card, i) => {
      ctx.fillStyle = card.gold ? 'rgba(60,44,8,0.92)' : 'rgba(22,16,48,0.92)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = card.gold ? '#ffd166' : '#7b5cff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = PALETTE.gold;
      ctx.font = `700 19px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(card.title, x + w / 2, y + 44);
      ctx.fillStyle = PALETTE.text;
      ctx.font = `400 14px ${FONT}`;
      wrapText(card.desc, x + w / 2, y + 76, w - 32, 20);
      ctx.fillStyle = PALETTE.muted;
      ctx.font = `600 13px ${FONT}`;
      ctx.fillText(card.pips || '', x + w / 2, y + h - 52);
      if (card.evolve) {
        ctx.fillStyle = '#ff7a3c';
        ctx.fillText(card.evolve, x + w / 2, y + h - 28);
      }
      ctx.fillStyle = PALETTE.muted;
      ctx.font = `700 13px ${FONT}`;
      ctx.fillText(`[${i + 1}]`, x + w / 2, y + h - 10);
      x += w + gap;
    });
  }

  function wrapText(text, cx, y, maxW, lh) {
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, yy);
        line = word;
        yy += lh;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, yy);
  }

  function dim() {
    ctx.fillStyle = 'rgba(8,6,20,0.72)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function drawPause(view) {
    dim();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText('PAUSED', 640, 330);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `400 16px ${FONT}`;
    ctx.fillText('P / Esc to resume  ·  R to restart  ·  M to ' + (view.muted ? 'unmute' : 'mute'), 640, 366);
  }

  function drawOver(state, view) {
    dim();
    const rs = state.runStats;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5d5d';
    ctx.font = `800 44px ${FONT}`;
    ctx.fillText('THE LIGHT FADES', 640, 130);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(`SCORE  ${state.score.toLocaleString('en-US')}`, 640, 180);
    const best = Math.max(view.best || 0, state.score);
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(
      state.score >= (view.best || 0) && state.score > 0 ? '★ NEW BEST ★' : `BEST  ${best.toLocaleString('en-US')}`,
      640, 206,
    );
    const rows = [
      ['Wave reached', state.wave],
      ['Glooms banished', state.kills],
      ['Time survived', fmtTime(rs.time)],
      ['Best combo', `x${rs.bestCombo}`],
      ['Bosses slain', rs.bossesSlain],
      ['Elites slain', rs.elitesSlain],
      ['Shrines claimed', rs.shrinesUsed],
      ['Weapons evolved', rs.evolutions],
      ['Dashes', rs.dashes],
      ['Nova kills', rs.novaKills],
      ['Crits', rs.crits],
      ['Accuracy', rs.shotsFired ? `${Math.min(100, Math.round((100 * rs.shotsHit) / rs.shotsFired))}%` : '—'],
    ];
    ctx.font = `400 15px ${FONT}`;
    let y = 250;
    for (let i = 0; i < rows.length; i += 2) {
      const left = rows[i];
      const right = rows[i + 1];
      ctx.textAlign = 'right';
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(left[0], 560, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(String(left[1]), 576, y);
      if (right) {
        ctx.textAlign = 'right';
        ctx.fillStyle = PALETTE.muted;
        ctx.fillText(right[0], 880, y);
        ctx.textAlign = 'left';
        ctx.fillStyle = PALETTE.text;
        ctx.fillText(String(right[1]), 896, y);
      }
      y += 28;
    }
    const pulse = 0.6 + 0.4 * Math.sin(view.time * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.ember;
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('PRESS R OR CLICK TO TRY AGAIN', 640, y + 30);
    ctx.globalAlpha = 1;
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return { draw };
}
