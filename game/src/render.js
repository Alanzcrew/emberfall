// EMBERFALL v2 renderer — canvas 2D, all screens + HUD.
// Top-level is DOM-free (only createRenderer touches the canvas) so Node can
// import this module for its screen constants.
// v2 adds: boss HP bar, dash-cooldown ring around the keeper, owned-upgrade
// strip, low-HP vignette pulse, fade transitions between screens, and art
// for the dasher, splitter and Gloomlord boss.
import { FIELD, PALETTE, FONT, PLAYER } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_LEVELUP = 'levelup';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const W = FIELD.width;
const H = FIELD.height;
const PLAYER_R = 16;

const CARD_W = 300;
const CARD_H = 230;
const CARD_GAP = 36;
const CARD_Y = 296;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function cardRects() {
  const total = CARD_W * 3 + CARD_GAP * 2;
  const x0 = (W - total) / 2;
  const rects = [];
  for (let i = 0; i < 3; i += 1) {
    rects.push({ x: x0 + i * (CARD_W + CARD_GAP), y: CARD_Y, w: CARD_W, h: CARD_H });
  }
  return rects;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function glowDot(ctx, x, y, r, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 2.2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawArena(ctx, state) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, PALETTE.backdrop);
  g.addColorStop(0.55, PALETTE.arena);
  g.addColorStop(1, '#0a0819');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Seeded ember dots (background motes, gently twinkling).
  const dots = state.emberDots || [];
  const t = state.time || 0;
  for (let i = 0; i < dots.length; i += 1) {
    const d = dots[i];
    const x = d.x == null ? (i * 173) % W : d.x;
    const y = d.y == null ? (i * 311) % H : d.y;
    const r = d.r || d.size || 2;
    const base = d.a == null ? (d.alpha == null ? 0.5 : d.alpha) : d.a;
    const tw = 0.55 + 0.45 * Math.sin(t * 1.7 + i * 1.3);
    ctx.globalAlpha = clamp(base * tw, 0.05, 1);
    ctx.fillStyle = i % 5 === 0 ? PALETTE.gold : PALETTE.ember;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Glowing border.
  ctx.save();
  ctx.strokeStyle = PALETTE.ember;
  ctx.globalAlpha = 0.55;
  ctx.shadowColor = PALETTE.ember;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.restore();
}

function drawLanternLight(ctx, p) {
  const radius = 240;
  const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, radius);
  g.addColorStop(0, 'rgba(255, 179, 71, 0.16)');
  g.addColorStop(0.6, 'rgba(255, 154, 60, 0.05)');
  g.addColorStop(1, 'rgba(255, 154, 60, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx, state) {
  const p = state.player;
  if (!p) return;
  const t = state.time || 0;
  const aimX = p.aimX == null ? 1 : p.aimX;
  const aimY = p.aimY == null ? 0 : p.aimY;
  const aimLen = Math.hypot(aimX, aimY) || 1;
  const ax = aimX / aimLen;
  const ay = aimY / aimLen;

  drawLanternLight(ctx, p);

  // v2: dash-cooldown ring under the keeper — fills as the dash recharges.
  if (p.dashCooldown > 0) {
    const frac = 1 - clamp(p.dashCooldown / PLAYER.dashCooldown, 0, 1);
    ctx.save();
    ctx.strokeStyle = PALETTE.dash;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 9, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (p.dashTime > 0) {
    // Mid-dash: bright cyan afterimage ring.
    ctx.save();
    ctx.strokeStyle = PALETTE.dash;
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = PALETTE.dash;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_R + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Flicker while invulnerable after a hit.
  let alpha = 1;
  if (p.invuln > 0) alpha = 0.45 + 0.35 * Math.sin(t * 30);
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0.2, 1);

  // Aim indicator: short ember beam + tip dot.
  ctx.strokeStyle = PALETTE.ember;
  ctx.globalAlpha = clamp(alpha, 0.2, 1) * 0.7;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(p.x + ax * (PLAYER_R + 4), p.y + ay * (PLAYER_R + 4));
  ctx.lineTo(p.x + ax * (PLAYER_R + 34), p.y + ay * (PLAYER_R + 34));
  ctx.stroke();
  ctx.setLineDash([]);
  glowDot(ctx, p.x + ax * (PLAYER_R + 40), p.y + ay * (PLAYER_R + 40), 3, PALETTE.ember, 0.9);
  ctx.globalAlpha = clamp(alpha, 0.2, 1);

  // Warm robe: layered circles, hood shading, lantern glow at the chest.
  const robe = ctx.createRadialGradient(p.x - 4, p.y - 5, 2, p.x, p.y, PLAYER_R + 4);
  robe.addColorStop(0, '#ffe0a3');
  robe.addColorStop(0.45, PALETTE.lantern);
  robe.addColorStop(1, '#8a4a12');
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5d2f08';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Hood / face shadow, looking toward the aim.
  ctx.fillStyle = '#3d1e05';
  ctx.beginPath();
  ctx.arc(p.x + ax * 4, p.y + ay * 4 - 2, PLAYER_R * 0.52, 0, Math.PI * 2);
  ctx.fill();
  // Eyes: two warm sparks.
  const ex = -ay;
  const ey = ax;
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(p.x + ax * 7 + ex * 4, p.y + ay * 7 + ey * 4 - 2, 1.8, 0, Math.PI * 2);
  ctx.arc(p.x + ax * 7 - ex * 4, p.y + ay * 7 - ey * 4 - 2, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // The lantern itself, swinging gently, held toward the aim.
  const swing = Math.sin(t * 2.2) * 2;
  const lx = p.x + ax * (PLAYER_R + 12);
  const ly = p.y + ay * (PLAYER_R + 12) + swing;
  glowDot(ctx, lx, ly, 7, PALETTE.lantern, 0.95);
  ctx.fillStyle = '#fff7d6';
  ctx.beginPath();
  ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, e, t) {
  if (!e || e.x == null) return;
  const r = e.r || e.radius || 12;
  const type = e.type || 'wisp';
  const hp = e.hp == null ? 1 : e.hp;
  const maxHp = e.maxHp == null ? hp : e.maxHp;

  // Spawn telegraph: expanding dashed ring while the gloom materialises.
  const telegraph = e.telegraph != null ? e.telegraph : 0;
  if (telegraph > 0) {
    ctx.save();
    ctx.strokeStyle = PALETTE.shadow;
    ctx.globalAlpha = clamp(telegraph, 0.15, 0.9);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 14 * (1 - telegraph), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  // Shadow blob body. Dasher crouches (smaller, brighter) while winding up.
  let bodyR = r;
  let bodyColor = PALETTE.shadow;
  if (type === 'dasher' && e.mode === 'windup') {
    bodyR = r * 0.8;
    bodyColor = '#ff5d8f';
  } else if (type === 'dasher') {
    bodyColor = '#9d7bff';
  } else if (type === 'splitter') {
    bodyColor = '#6a4fd0';
  } else if (type === 'brute') {
    bodyColor = '#5a3fd4';
  } else if (type === 'gloomlord') {
    bodyColor = '#3d1150';
  }
  const pulse = 1 + 0.05 * Math.sin(t * 4 + (e.phase || 0));
  const blob = ctx.createRadialGradient(
    e.x - bodyR * 0.25, e.y - bodyR * 0.3, 2, e.x, e.y, bodyR * pulse + 4,
  );
  blob.addColorStop(0, '#c9b8ff');
  blob.addColorStop(0.35, bodyColor);
  blob.addColorStop(1, '#160b2e');
  ctx.fillStyle = blob;
  ctx.beginPath();
  ctx.arc(e.x, e.y, bodyR * pulse, 0, Math.PI * 2);
  ctx.fill();
  // Hit flash: white overlay that fades with e.flash.
  if (e.flash > 0) {
    ctx.globalAlpha = clamp(e.flash / 0.12, 0, 1) * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(e.x, e.y, bodyR * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Eyes: two pale sparks that track the player (via phase wobble).
  const eyeDX = Math.cos(t * 0.8 + (e.phase || 0)) * 1.5;
  const eyeDY = Math.sin(t * 0.8 + (e.phase || 0)) * 1.5;
  const eyeColor = type === 'gloomlord' ? '#ff3d6e' : type === 'dasher' ? '#ffd166' : '#e8e0ff';
  ctx.fillStyle = eyeColor;
  const eyeOff = Math.max(3, r * 0.32);
  const eyeR = type === 'gloomlord' ? 5 : type === 'brute' ? 3.4 : 2.4;
  ctx.beginPath();
  ctx.arc(e.x - eyeOff + eyeDX, e.y - eyeOff * 0.4 + eyeDY, eyeR, 0, Math.PI * 2);
  ctx.arc(e.x + eyeOff + eyeDX, e.y - eyeOff * 0.4 + eyeDY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Splitter: inner core ring so it reads as "full of something".
  if (type === 'splitter') {
    ctx.strokeStyle = '#b8a9ff';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Dasher: lunge-direction spikes while winding up or lunging.
  if (type === 'dasher' && (e.mode === 'windup' || e.mode === 'lunge')) {
    const la = Math.atan2(e.lungeY || 0, e.lungeX || 1);
    ctx.strokeStyle = '#ffd166';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(la) * r, e.y + Math.sin(la) * r);
    ctx.lineTo(e.x + Math.cos(la) * (r + 16), e.y + Math.sin(la) * (r + 16));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Gloomlord: crown of horns + burning rim.
  if (type === 'gloomlord') {
    ctx.strokeStyle = '#ff3d6e';
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = '#ff3d6e';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff3d6e';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * (r - 4), e.y + Math.sin(a) * (r - 4));
      ctx.lineTo(e.x + Math.cos(a) * (r + 16), e.y + Math.sin(a) * (r + 16));
      ctx.lineTo(e.x + Math.cos(a + 0.22) * (r - 2), e.y + Math.sin(a + 0.22) * (r - 2));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // HP bar for tough enemies (brute, splitter, boss) when damaged.
  if ((type === 'brute' || type === 'splitter' || type === 'gloomlord') && hp < maxHp) {
    const bw = r * 2;
    const bx = e.x - bw / 2;
    const by = e.y - r - 12;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = type === 'gloomlord' ? PALETTE.boss : PALETTE.hp;
    ctx.fillRect(bx, by, bw * clamp(hp / maxHp, 0, 1), 5);
    ctx.restore();
  }
}

function drawBullets(ctx, state) {
  for (const b of state.bullets || []) {
    glowDot(ctx, b.x, b.y, 5, PALETTE.ember, 0.95);
    ctx.save();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const o of state.enemyBullets || []) {
    glowDot(ctx, o.x, o.y, 6, PALETTE.shadow, 0.9);
    ctx.save();
    ctx.fillStyle = '#d9ccff';
    ctx.beginPath();
    ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // v2 orbiting embers.
  for (const o of state.orbiters || []) {
    glowDot(ctx, o.x, o.y, 7, PALETTE.lantern, 0.95);
    ctx.save();
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath();
    ctx.arc(o.x, o.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawGems(ctx, state) {
  const t = state.time || 0;
  for (const g of state.gems || []) {
    if (g.kind === 'heart') {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(Math.sin(t * 2 + g.x) * 0.12);
      ctx.fillStyle = '#7dff8a';
      ctx.shadowColor = '#7dff8a';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.bezierCurveTo(-8, -3, -5, -9, 0, -4);
      ctx.bezierCurveTo(5, -9, 8, -3, 0, 5);
      ctx.fill();
      ctx.restore();
    } else {
      const bob = Math.sin(t * 3 + g.x * 0.05) * 1.5;
      glowDot(ctx, g.x, g.y + bob, 4.5, PALETTE.gold, 0.95);
      ctx.save();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(g.x, g.y + bob, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawParticles(ctx, state) {
  for (const pt of state.particles || []) {
    const frac = clamp(pt.life / pt.maxLife, 0, 1);
    if (pt.kind === 'ring') {
      ctx.save();
      ctx.globalAlpha = frac * 0.9;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = frac;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(0.5, pt.size * frac), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // Floating combat text.
  for (const tx of state.texts || []) {
    const frac = clamp(tx.life / 0.9, 0, 1);
    ctx.save();
    ctx.globalAlpha = frac;
    ctx.fillStyle = tx.color;
    ctx.font = `bold ${tx.size || 16}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tx.text, tx.x, tx.y);
    ctx.restore();
  }
}

function drawHud(ctx, state, best, screen) {
  const p = state.player;
  if (!p) return;
  const t = state.time || 0;

  // Top-left: HP bar + numbers, dash status.
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillStyle = PALETTE.text;
  ctx.fillText(`HP  ${Math.ceil(p.hp)} / ${p.maxHp}`, 24, 28);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRectPath(ctx, 24, 42, 220, 14, 7);
  ctx.fill();
  ctx.fillStyle = PALETTE.hp;
  roundRectPath(ctx, 24, 42, 220 * clamp(p.hp / p.maxHp, 0, 1), 14, 7);
  ctx.fill();
  // Dash pip: cyan when ready (with a soft pulse), grey while recharging.
  const dashReady = p.dashCooldown <= 0;
  ctx.fillStyle = dashReady ? PALETTE.dash : 'rgba(125,227,255,0.35)';
  ctx.beginPath();
  ctx.arc(258, 49, dashReady ? 7 + Math.sin(t * 4) * 1.2 : 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.text;
  ctx.font = `12px ${FONT}`;
  ctx.fillText('SHIFT dash', 270, 49);
  ctx.restore();

  // Top-center: wave + enemies left. Boss bar replaces it on boss waves.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state.boss && state.boss.hp > 0) {
    const b = state.boss;
    ctx.font = `bold 17px ${FONT}`;
    ctx.fillStyle = PALETTE.boss;
    ctx.fillText('GLOOMLORD', W / 2, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRectPath(ctx, W / 2 - 190, 40, 380, 13, 6);
    ctx.fill();
    ctx.fillStyle = PALETTE.boss;
    roundRectPath(ctx, W / 2 - 190, 40, 380 * clamp(b.hp / b.maxHp, 0, 1), 13, 6);
    ctx.fill();
  } else {
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = PALETTE.text;
    const left = (state.enemies || []).length + (state.spawnQueue || []).length;
    ctx.fillText(`WAVE ${state.wave}`, W / 2, 28);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(`${left} gloom${left === 1 ? '' : 's'} left`, W / 2, 52);
  }
  ctx.restore();

  // Top-right: score, combo, best.
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText(`${state.score}`, W - 24, 28);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = state.combo > 1 ? PALETTE.crit : PALETTE.muted;
  ctx.fillText(
    state.combo > 1 ? `COMBO x${state.combo}` : 'no combo',
    W - 24, 52,
  );
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `13px ${FONT}`;
  ctx.fillText(`BEST ${Math.max(best || 0, state.score)}`, W - 24, 72);
  ctx.restore();

  // v2: owned-upgrade strip along the bottom, above the XP bar.
  const owned = state.owned || {};
  const names = Object.keys(owned);
  if (names.length > 0) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `12px ${FONT}`;
    let x = 24;
    const y = H - 34;
    for (const id of names) {
      const label = `${id} ${owned[id]}`;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(16,12,36,0.7)';
      roundRectPath(ctx, x, y - 10, w, 20, 10);
      ctx.fill();
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText(label, x + 7, y);
      x += w + 6;
      if (x > W - 200) break;
    }
    ctx.restore();
  }

  // Bottom: XP bar, full width, with level.
  const frac = clamp(p.xp / (p.xpNext || 1), 0, 1);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H - 18, W, 18);
  ctx.fillStyle = PALETTE.xp;
  ctx.fillRect(0, H - 18, W * frac, 18);
  ctx.fillStyle = PALETTE.text;
  ctx.font = `bold 12px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`LEVEL ${p.level}   ${p.xp} / ${p.xpNext} XP`, W / 2, H - 9);
  ctx.restore();

  // Wave banner: breather / cleared text, big and centred. Only on the
  // PLAY screen — on LEVELUP it would bleed through the upgrade cards.
  if (screen === SCREEN_PLAY
    && (state.waveState === 'breather' || state.waveState === 'cleared')) {
    const isSwarm = state.wave % 4 === 0 && state.wave % 10 !== 0;
    const isBoss = state.wave % 10 === 0;
    const label = state.waveState === 'breather'
      ? (isBoss ? `WAVE ${state.wave} — THE GLOOMLORD` : isSwarm ? `WAVE ${state.wave} — SWARM!` : `WAVE ${state.wave}`)
      : `WAVE ${state.wave} CLEAR`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 44px ${FONT}`;
    ctx.shadowColor = isBoss ? PALETTE.boss : PALETTE.ember;
    ctx.shadowBlur = 24;
    ctx.fillStyle = isBoss ? PALETTE.boss : PALETTE.gold;
    ctx.fillText(label, W / 2, H / 2 - 60);
    ctx.restore();
  }

  // v2: low-HP vignette pulse — red edges close in as HP drops.
  const hpFrac = clamp(p.hp / p.maxHp, 0, 1);
  if (hpFrac < 0.35 && !state.over) {
    const pulse = 0.22 + 0.1 * Math.sin(t * 5);
    const alpha = pulse * (1 - hpFrac / 0.35);
    const vg = ctx.createRadialGradient(
      W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.75,
    );
    vg.addColorStop(0, 'rgba(255, 40, 60, 0)');
    vg.addColorStop(1, `rgba(255, 40, 60, ${clamp(alpha, 0, 0.5)})`);
    ctx.save();
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Damage vignette flash when recently hurt.
  if (p.invuln > 0.55 && !state.over) {
    ctx.save();
    ctx.globalAlpha = clamp((p.invuln - 0.55) / 0.25, 0, 1) * 0.25;
    ctx.fillStyle = '#ff2d3c';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function drawTitle(ctx, state, best) {
  const t = state.time || 0;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Big title with ember glow.
  ctx.font = `bold 92px ${FONT}`;
  ctx.shadowColor = PALETTE.ember;
  ctx.shadowBlur = 34;
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText('EMBERFALL', W / 2, 190);
  ctx.shadowBlur = 0;
  ctx.font = `italic 26px ${FONT}`;
  ctx.fillStyle = PALETTE.text;
  ctx.fillText('Hold the light. Survive the dark.', W / 2, 258);
  // v2 tagline: what is new.
  ctx.font = `15px ${FONT}`;
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText('v2 — dash through the dark, face the Gloomlord, forge 12 upgrades', W / 2, 296);
  // Controls.
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText('WASD / Arrows — move     Mouse — aim     Hold Click / Space — fire', W / 2, 350);
  ctx.fillText('SHIFT / Right Click — dash (brief invulnerability)', W / 2, 380);
  ctx.fillText('Collect ember shards to level up. Every 5th wave, a Gloombrute hunts you.', W / 2, 410);
  ctx.fillText('Every 10th wave, the GLOOMLORD. Every 4th wave, a swarm.', W / 2, 440);
  ctx.fillText('P — pause     M — mute     R — restart', W / 2, 478);
  if (best > 0) {
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(`BEST SCORE  ${best}`, W / 2, 528);
  }
  // Blinking start prompt.
  const blink = 0.55 + 0.45 * Math.sin(t * 3.2);
  ctx.globalAlpha = blink;
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillStyle = PALETTE.ember;
  ctx.fillText('CLICK OR PRESS SPACE TO BEGIN', W / 2, 600);
  ctx.restore();
}

function drawLevelUp(ctx, state) {
  const rects = cardRects();
  ctx.save();
  ctx.fillStyle = 'rgba(6, 4, 18, 0.66)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 40px ${FONT}`;
  ctx.fillStyle = PALETTE.gold;
  ctx.shadowColor = PALETTE.gold;
  ctx.shadowBlur = 18;
  ctx.fillText('LEVEL UP!', W / 2, 210);
  ctx.shadowBlur = 0;
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = PALETTE.text;
  ctx.fillText('Choose one ember to kindle — press 1, 2 or 3, or click a card.', W / 2, 252);
  const choices = state.choices || [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const choice = choices[i];
    if (!choice) continue;
    ctx.fillStyle = PALETTE.panel;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.fill();
    ctx.strokeStyle = PALETTE.ember;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillText(`[ ${i + 1} ]`, r.x + r.w / 2, r.y + 28);
    ctx.fillStyle = PALETTE.text;
    ctx.font = `bold 21px ${FONT}`;
    const nameLines = wrapText(ctx, choice.name, r.w - 32);
    let ny = r.y + 62;
    for (const line of nameLines) {
      ctx.fillText(line, r.x + r.w / 2, ny);
      ny += 26;
    }
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `15px ${FONT}`;
    const descLines = wrapText(ctx, choice.desc, r.w - 32);
    let dy = ny + 14;
    for (const line of descLines) {
      ctx.fillText(line, r.x + r.w / 2, dy);
      dy += 21;
    }
    // Stack pips: filled = owned, empty = remaining.
    const owned = (state.owned || {})[choice.id] || 0;
    const max = choice.max || 5;
    const pipW = 16;
    const totalPip = pipW * max + 6 * (max - 1);
    let px = r.x + (r.w - totalPip) / 2;
    const py = r.y + r.h - 30;
    for (let s = 0; s < max; s++) {
      ctx.fillStyle = s < owned ? PALETTE.gold : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(px + pipW / 2, py, 6, 0, Math.PI * 2);
      ctx.fill();
      px += pipW + 6;
    }
  }
  ctx.restore();
}

function drawPaused(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(6, 4, 18, 0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 52px ${FONT}`;
  ctx.fillStyle = PALETTE.text;
  ctx.fillText('PAUSED', W / 2, H / 2 - 30);
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText('P or Escape — resume     R — restart', W / 2, H / 2 + 24);
  ctx.restore();
}

function drawOver(ctx, state, best) {
  const rs = state.runStats || {};
  const isBest = state.score > 0 && state.score >= best;
  ctx.save();
  ctx.fillStyle = 'rgba(6, 4, 18, 0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 54px ${FONT}`;
  ctx.fillStyle = PALETTE.hp;
  ctx.fillText('THE LIGHT FADES', W / 2, 150);
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText(`SCORE  ${state.score}`, W / 2, 216);
  if (isBest) {
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = '#7dff8a';
    ctx.fillText('★ NEW BEST! ★', W / 2, 254);
  }
  // v2 run stats: two columns of verified numbers.
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = PALETTE.text;
  const leftX = W / 2 - 190;
  const rightX = W / 2 + 190;
  ctx.textAlign = 'left';
  ctx.fillText(`Wave reached: ${state.wave}`, leftX, 310);
  ctx.fillText(`Glooms slain: ${state.kills}`, leftX, 340);
  ctx.fillText(`Best combo: x${rs.bestCombo || 1}`, leftX, 370);
  ctx.fillText(`Bosses slain: ${rs.bossKills || 0}`, leftX, 400);
  ctx.fillText(`Time survived: ${Math.floor(state.time)}s`, rightX - 170, 310);
  const acc = rs.shots > 0 ? Math.round((100 * rs.hits) / rs.shots) : 0;
  ctx.fillText(`Accuracy: ${acc}%`, rightX - 170, 340);
  ctx.fillText(`Dashes: ${rs.dashes || 0}`, rightX - 170, 370);
  ctx.fillText(`Nova kills: ${rs.novaKills || 0}   Crits: ${rs.crits || 0}`, rightX - 170, 400);
  ctx.textAlign = 'center';
  ctx.font = `15px ${FONT}`;
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText(`Best score: ${best}`, W / 2, 452);
  const blink = 0.55 + 0.45 * Math.sin((state.time || 0) * 3.2);
  ctx.globalAlpha = blink;
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillStyle = PALETTE.ember;
  ctx.fillText('PRESS R OR SPACE TO KINDLE AGAIN', W / 2, 510);
  ctx.restore();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // v2 fade transitions: each screen change fades in from black over 0.25s.
  let lastScreen = null;
  let fadeT = 1;

  function draw(state, screen, best) {
    if (!ctx) return;
    if (screen !== lastScreen) {
      lastScreen = screen;
      fadeT = 0;
    }
    if (fadeT < 1) fadeT = Math.min(1, fadeT + 1 / 15);

    ctx.save();
    const shake = state.shake || 0;
    if (shake > 0.2) {
      const sx = (Math.random() * 2 - 1) * shake * 0.6;
      const sy = (Math.random() * 2 - 1) * shake * 0.6;
      ctx.translate(sx, sy);
    }

    drawArena(ctx, state);
    // Title screen keeps the attract-mode wisps drifting behind the text.
    if (screen !== SCREEN_TITLE) {
      drawGems(ctx, state);
      drawBullets(ctx, state);
      for (const e of state.enemies || []) drawEnemy(ctx, e, state.time || 0);
      drawPlayer(ctx, state);
      drawParticles(ctx, state);
    } else {
      for (const e of state.enemies || []) drawEnemy(ctx, e, state.time || 0);
      drawParticles(ctx, state);
    }

    if (screen === SCREEN_TITLE) drawTitle(ctx, state, best);
    else if (screen === SCREEN_PLAY || screen === SCREEN_PAUSED) drawHud(ctx, state, best, screen);
    if (screen === SCREEN_LEVELUP) {
      drawHud(ctx, state, best, screen);
      drawLevelUp(ctx, state);
    } else if (screen === SCREEN_PAUSED) {
      drawPaused(ctx);
    } else if (screen === SCREEN_OVER) {
      drawOver(ctx, state, best);
    }
    ctx.restore();

    // Fade-in overlay after a screen change.
    if (fadeT < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - fadeT) * 0.85;
      ctx.fillStyle = '#05030f';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  return { draw, cardRects };
}
