// EMBERFALL renderer — canvas 2D, all screens + HUD.
// Top-level is DOM-free (only createRenderer touches the canvas) so Node can
// import this module for its screen constants.
import { FIELD, PALETTE, FONT } from './config.js';

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
  const r = e.r || 12;
  const type = e.type || 'wisp';
  const hp = e.hp == null ? 1 : e.hp;
  const maxHp = e.maxHp == null ? hp : e.maxHp;

  // Spawn telegraph: expanding dashed ring while the gloom materialises.
  // Worlds may signal it with a telegraph fraction or with active === false.
  const telegraph = e.telegraph != null ? e.telegraph : (e.active === false ? 0.6 : 0);
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
  // Shadow blob body.
  const body = ctx.createRadialGradient(e.x - r * 0.3, e.y - r * 0.35, r * 0.1, e.x, e.y, r * 1.15);
  body.addColorStop(0, '#4b3a8f');
  body.addColorStop(0.6, '#241a4d');
  body.addColorStop(1, '#0d091f');
  ctx.fillStyle = body;
  ctx.shadowColor = PALETTE.shadow;
  ctx.shadowBlur = 14;

  if (type === 'wisp') {
    // Small wavy blob: radius wobbles around the rim.
    ctx.beginPath();
    const steps = 14;
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      const wob = 1 + 0.16 * Math.sin(a * 3 + t * 6 + (e.seed || 0));
      const px = e.x + Math.cos(a) * r * wob;
      const py = e.y + Math.sin(a) * r * wob;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // Wavy tail.
    ctx.strokeStyle = 'rgba(184, 169, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - r * 0.5, e.y + r * 0.8);
    ctx.quadraticCurveTo(e.x, e.y + r * 1.5 + Math.sin(t * 6) * 3, e.x + r * 0.5, e.y + r * 0.8);
    ctx.stroke();
  } else if (type === 'crawler') {
    // Spiked blob: triangular spikes around the rim.
    ctx.beginPath();
    const spikes = 8;
    for (let i = 0; i < spikes * 2; i += 1) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + t * 0.4;
      const rr = i % 2 === 0 ? r * 1.35 : r * 0.85;
      const px = e.x + Math.cos(a) * rr;
      const py = e.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  } else if (type === 'spitter') {
    // Round blob with a glowing open mouth.
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#120826';
    ctx.beginPath();
    ctx.arc(e.x, e.y + r * 0.15, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PALETTE.shadow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y + r * 0.15, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    glowDot(ctx, e.x, e.y + r * 0.15, 3, '#c9a6ff', 0.8);
  } else {
    // Brute: large horned elite.
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Horns.
    ctx.fillStyle = '#d9c8ff';
    ctx.beginPath();
    ctx.moveTo(e.x - r * 0.75, e.y - r * 0.55);
    ctx.lineTo(e.x - r * 1.25, e.y - r * 1.35);
    ctx.lineTo(e.x - r * 0.25, e.y - r * 0.9);
    ctx.closePath();
    ctx.moveTo(e.x + r * 0.75, e.y - r * 0.55);
    ctx.lineTo(e.x + r * 1.25, e.y - r * 1.35);
    ctx.lineTo(e.x + r * 0.25, e.y - r * 0.9);
    ctx.closePath();
    ctx.fill();
    // Angry brow ridge.
    ctx.strokeStyle = '#120826';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(e.x - r * 0.55, e.y - r * 0.25);
    ctx.lineTo(e.x - r * 0.1, e.y - r * 0.05);
    ctx.moveTo(e.x + r * 0.55, e.y - r * 0.25);
    ctx.lineTo(e.x + r * 0.1, e.y - r * 0.05);
    ctx.stroke();
  }
  ctx.restore();

  // Glowing eyes (all types), colour shifts per type.
  const eyeColor = type === 'wisp' ? PALETTE.wisp : type === 'brute' ? '#ff6b6b' : '#e6dcff';
  const eyeY = e.y - r * 0.15;
  const eyeDX = r * 0.38;
  const eyeR = type === 'brute' ? 4 : 2.6;
  glowDot(ctx, e.x - eyeDX, eyeY, eyeR, eyeColor, 0.95);
  glowDot(ctx, e.x + eyeDX, eyeY, eyeR, eyeColor, 0.95);

  // Hit flash.
  if (e.flash > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(e.flash * 2, 0, 0.8);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // HP bar when damaged; brutes also get a name tag so the elite reads clearly.
  if (type === 'brute') {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 13px ' + FONT;
    ctx.fillStyle = '#ff9a9a';
    ctx.shadowColor = '#ff5d5d';
    ctx.shadowBlur = 8;
    ctx.fillText('GLOOMBRUTE', e.x, e.y - r - 22);
    ctx.restore();
  }
  if (maxHp > 1 && hp < maxHp) {
    const bw = r * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(e.x - bw / 2, e.y - r - 12, bw, 5);
    ctx.fillStyle = PALETTE.hp;
    ctx.fillRect(e.x - bw / 2, e.y - r - 12, bw * clamp(hp / maxHp, 0, 1), 5);
  }
}

function drawBullets(ctx, state) {
  for (const b of state.bullets || []) {
    if (b.x == null) continue;
    const vx = b.vx || 0;
    const vy = b.vy || 0;
    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const tail = 16;
    ctx.save();
    ctx.strokeStyle = PALETTE.ember;
    ctx.shadowColor = PALETTE.ember;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x - nx * tail, b.y - ny * tail);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemyOrbs(ctx, state) {
  const t = state.time || 0;
  for (const o of state.enemyBullets || []) {
    if (o.x == null) continue;
    const r = o.r || 7;
    const pulse = 1 + 0.15 * Math.sin(t * 8 + o.x);
    glowDot(ctx, o.x, o.y, r * pulse, PALETTE.shadow, 0.9);
    ctx.fillStyle = '#e9e2ff';
    ctx.beginPath();
    ctx.arc(o.x, o.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGemsAndHearts(ctx, state) {
  const t = state.time || 0;
  for (const g of state.gems || []) {
    if (g.x == null) continue;
    if (g.kind === 'heart') {
      drawHeart(ctx, g.x, g.y, 10, t);
      continue;
    }
    const s = 7 + Math.sin(t * 5 + g.x * 0.1) * 1.2;
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = PALETTE.gold;
    ctx.shadowColor = PALETTE.gold;
    ctx.shadowBlur = 10;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
    ctx.fillStyle = '#fff7d6';
    ctx.beginPath();
    ctx.arc(g.x, g.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const h of state.hearts || []) {
    if (h.x == null) continue;
    drawHeart(ctx, h.x, h.y, 11, t);
  }
}

function drawHeart(ctx, x, y, s, t) {
  const pulse = 1 + 0.08 * Math.sin(t * 6 + x);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = '#ff5d7a';
  ctx.shadowColor = '#ff5d7a';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.7);
  ctx.bezierCurveTo(-s * 1.2, -s * 0.1, -s * 0.6, -s * 0.9, 0, -s * 0.25);
  ctx.bezierCurveTo(s * 0.6, -s * 0.9, s * 1.2, -s * 0.1, 0, s * 0.7);
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx, state) {
  for (const p of state.particles || []) {
    if (p.x == null) continue;
    const maxLife = p.maxLife || 1;
    const frac = clamp((p.life == null ? 1 : p.life) / maxLife, 0, 1);
    if (p.kind === 'ring') {
      ctx.save();
      ctx.globalAlpha = frac * 0.8;
      ctx.strokeStyle = p.color || PALETTE.ember;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (p.size || 10) * (1.6 - frac * 0.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (p.kind === 'ember') {
      glowDot(ctx, p.x, p.y, (p.size || 3) * (0.5 + frac * 0.5), p.color || PALETTE.ember, frac);
    } else {
      // spark: short bright streak along its velocity.
      const vx = p.vx || 0;
      const vy = p.vy || 0;
      const len = Math.hypot(vx, vy) || 1;
      ctx.save();
      ctx.globalAlpha = frac;
      ctx.strokeStyle = p.color || '#ffd9a0';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (vx / len) * 10, p.y - (vy / len) * 10);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawTexts(ctx, state) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of state.texts || []) {
    if (t.text == null) continue;
    const a = clamp(t.life == null ? 1 : t.life, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = '700 ' + (t.size || 16) + 'px ' + FONT;
    ctx.fillStyle = t.color || PALETTE.text;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(String(t.text), t.x, t.y);
  }
  ctx.restore();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let hurtFlash = 0;
  let lastHp = null;

  function drawHud(state, best) {
    const p = state.player || {};
    const hp = p.hp == null ? 100 : p.hp;
    const maxHp = p.maxHp == null ? 100 : p.maxHp;
    const level = p.level == null ? 1 : p.level;
    const xp = p.xp == null ? 0 : p.xp;
    const xpNext = p.xpNext == null ? 1 : p.xpNext;
    const queue = Array.isArray(state.spawnQueue) ? state.spawnQueue.length : (state.spawnQueue || 0);
    const left = queue + (state.enemies || []).length;

    ctx.save();
    ctx.textBaseline = 'middle';

    // HP bar, top-left.
    ctx.fillStyle = PALETTE.panel;
    roundRectPath(ctx, 20, 18, 260, 52, 10);
    ctx.fill();
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText('HP', 32, 34);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRectPath(ctx, 32, 44, 220, 12, 6);
    ctx.fill();
    const hpFrac = clamp(hp / Math.max(1, maxHp), 0, 1);
    const hg = ctx.createLinearGradient(32, 0, 252, 0);
    hg.addColorStop(0, '#ff8a5d');
    hg.addColorStop(1, PALETTE.hp);
    ctx.fillStyle = hg;
    if (hpFrac > 0) {
      roundRectPath(ctx, 32, 44, 220 * hpFrac, 12, 6);
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.text;
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(Math.ceil(hp) + ' / ' + maxHp, 252, 34);
    // Low-HP warning: pulsing red rim around the HP panel.
    if (hpFrac < 0.3) {
      const pulse = 0.4 + 0.4 * Math.sin((state.time || 0) * 6);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = PALETTE.hp;
      ctx.lineWidth = 2;
      roundRectPath(ctx, 20, 18, 260, 52, 10);
      ctx.stroke();
      ctx.restore();
    }

    // Wave + enemies left, top-centre.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 26px ' + FONT;
    ctx.fillText('WAVE ' + (state.wave || 1), W / 2, 36);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '600 14px ' + FONT;
    ctx.fillText(left + ' gloom' + (left === 1 ? '' : 's') + ' left', W / 2, 60);

    // Score + combo + best, top-right.
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = '800 24px ' + FONT;
    ctx.fillText((state.score || 0).toLocaleString('en-US'), W - 24, 34);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '600 13px ' + FONT;
    ctx.fillText('BEST ' + (best || 0).toLocaleString('en-US'), W - 24, 58);
    if (state.combo > 1) {
      ctx.fillStyle = PALETTE.ember;
      ctx.font = '800 20px ' + FONT;
      ctx.fillText('COMBO x' + state.combo, W - 24, 82);
      // Combo timer: thin bar draining under the combo label.
      const ct = clamp((state.comboTimer == null ? 0 : state.comboTimer) / 2.5, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(W - 124, 92, 100, 5);
      ctx.fillStyle = PALETTE.ember;
      ctx.fillRect(W - 124, 92, 100 * ct, 5);
    }

    // XP bar, bottom full width.
    const barX = 24;
    const barW = W - 48;
    const barY = H - 30;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRectPath(ctx, barX, barY, barW, 14, 7);
    ctx.fill();
    const xpFrac = clamp(xp / Math.max(1, xpNext), 0, 1);
    if (xpFrac > 0) {
      const xg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      xg.addColorStop(0, PALETTE.ember);
      xg.addColorStop(1, PALETTE.xp);
      ctx.fillStyle = xg;
      roundRectPath(ctx, barX, barY, barW * xpFrac, 14, 7);
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 14px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText('LEVEL ' + level, barX, barY - 14);
    ctx.textAlign = 'right';
    ctx.fillText(Math.floor(xp) + ' / ' + xpNext + ' XP', barX + barW, barY - 14);
    ctx.restore();
  }

  function drawWaveBanner(state) {
    if (state.waveState === 'breather') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PALETTE.text;
      ctx.font = '800 64px ' + FONT;
      ctx.shadowColor = PALETTE.ember;
      ctx.shadowBlur = 30;
      ctx.fillText('WAVE ' + (state.wave || 1), W / 2, H / 2 - 30);
      ctx.shadowBlur = 0;
      ctx.fillStyle = PALETTE.muted;
      ctx.font = '600 20px ' + FONT;
      ctx.fillText('Hold the light...', W / 2, H / 2 + 24);
      ctx.restore();
    } else if (state.waveState === 'cleared') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PALETTE.gold;
      ctx.font = '800 52px ' + FONT;
      ctx.shadowColor = PALETTE.gold;
      ctx.shadowBlur = 24;
      ctx.fillText('WAVE CLEARED', W / 2, H / 2 - 30);
      ctx.shadowBlur = 0;
      ctx.fillStyle = PALETTE.text;
      ctx.font = '700 22px ' + FONT;
      ctx.fillText('BONUS +' + 50 * (state.wave || 1), W / 2, H / 2 + 22);
      ctx.restore();
    }
  }

  function drawTitleEmbers(state) {
    const t = state.time || 0;
    ctx.save();
    for (let i = 0; i < 48; i += 1) {
      const x = (i * 197.3 + 40) % W;
      const speed = 14 + (i % 5) * 7;
      const y = H + 20 - ((t * speed + i * 53) % (H + 60));
      const sway = Math.sin(t * 0.9 + i) * 12;
      const a = 0.25 + 0.55 * Math.abs(Math.sin(t * 1.3 + i * 2.1));
      glowDot(ctx, x + sway, y, 2 + (i % 3), i % 4 === 0 ? PALETTE.gold : PALETTE.ember, a);
    }
    ctx.restore();
  }

  function drawTitle(state, best) {
    drawTitleEmbers(state);
    const t = state.time || 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = PALETTE.gold;
    ctx.font = '800 96px ' + FONT;
    ctx.shadowColor = PALETTE.ember;
    ctx.shadowBlur = 42;
    ctx.fillText('EMBERFALL', W / 2, 218);
    ctx.shadowBlur = 0;

    ctx.fillStyle = PALETTE.text;
    ctx.font = 'italic 600 26px ' + FONT;
    ctx.fillText('Hold the light. Survive the dark.', W / 2, 292);

    ctx.fillStyle = PALETTE.ember;
    ctx.font = '700 16px ' + FONT;
    ctx.fillText('✦  ✦  ✦', W / 2, 330);

    ctx.fillStyle = PALETTE.muted;
    ctx.font = '500 18px ' + FONT;
    ctx.fillText('WASD / Arrows — move        Mouse — aim        Hold Click / Space — fire', W / 2, 372);
    ctx.fillText('Collect ember shards to level up. Every 5th wave, a Gloombrute hunts you.', W / 2, 404);
    ctx.fillText('P — pause        M — mute        R — restart', W / 2, 436);

    if (best > 0) {
      ctx.fillStyle = PALETTE.gold;
      ctx.font = '700 20px ' + FONT;
      ctx.fillText('BEST SCORE  ' + best.toLocaleString('en-US'), W / 2, 486);
    }

    const pulse = 0.55 + 0.45 * Math.sin(t * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '800 24px ' + FONT;
    ctx.fillText('CLICK OR PRESS SPACE TO BEGIN', W / 2, 556);
    ctx.restore();
  }

  function drawLevelUp(state) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 6, 20, 0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.gold;
    ctx.font = '800 52px ' + FONT;
    ctx.shadowColor = PALETTE.ember;
    ctx.shadowBlur = 26;
    ctx.fillText('LEVEL UP', W / 2, 150);
    ctx.shadowBlur = 0;
    ctx.fillStyle = PALETTE.text;
    ctx.font = '600 24px ' + FONT;
    ctx.fillText('CHOOSE AN EMBER', W / 2, 208);

    const rects = cardRects();
    const choices = state.choices || [];
    for (let i = 0; i < 3; i += 1) {
      const r = rects[i];
      const c = choices[i] || {};
      const name = c.name || 'Ember';
      const desc = c.desc || c.description || '';
      const level = clamp(c.level == null ? (c.stacks == null ? 0 : c.stacks) : c.level, 0, 5);

      ctx.fillStyle = PALETTE.panel;
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 14);
      ctx.fill();
      ctx.strokeStyle = PALETTE.gold;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Ember glyph.
      glowDot(ctx, r.x + r.w / 2, r.y + 52, 16, PALETTE.ember, 0.9);
      ctx.fillStyle = '#fff3c4';
      ctx.font = '800 22px ' + FONT;
      ctx.fillText('' + (i + 1), r.x + r.w / 2, r.y + 52);

      ctx.fillStyle = PALETTE.text;
      ctx.font = '800 22px ' + FONT;
      ctx.fillText(name, r.x + r.w / 2, r.y + 104);

      ctx.fillStyle = PALETTE.muted;
      ctx.font = '500 15px ' + FONT;
      const lines = wrapText(ctx, desc, r.w - 36);
      lines.slice(0, 3).forEach((line, li) => {
        ctx.fillText(line, r.x + r.w / 2, r.y + 138 + li * 20);
      });

      // Level pips: 5 dots, filled = current stacks.
      for (let p = 0; p < 5; p += 1) {
        const px = r.x + r.w / 2 + (p - 2) * 22;
        const py = r.y + r.h - 34;
        ctx.fillStyle = p < level ? PALETTE.gold : 'rgba(139, 134, 163, 0.4)';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = PALETTE.muted;
      ctx.font = '600 12px ' + FONT;
      ctx.fillText('press ' + (i + 1) + ' or click', r.x + r.w / 2, r.y + r.h - 14);
    }
    ctx.restore();
  }

  function drawPaused() {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 6, 20, 0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 64px ' + FONT;
    ctx.fillText('PAUSED', W / 2, H / 2 - 30);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '600 20px ' + FONT;
    ctx.fillText('P / Esc — resume        R — restart        M — mute', W / 2, H / 2 + 30);
    ctx.restore();
  }

  function drawOver(state, best) {
    const score = state.score || 0;
    const isBest = score > 0 && score >= (best || 0);
    ctx.save();
    ctx.fillStyle = 'rgba(8, 6, 20, 0.78)';
    ctx.fillRect(0, 0, W, H);

    const pw = 560;
    const ph = 400;
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    ctx.fillStyle = PALETTE.panel;
    roundRectPath(ctx, px, py, pw, ph, 18);
    ctx.fill();
    ctx.strokeStyle = PALETTE.ember;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.hp;
    ctx.font = '800 46px ' + FONT;
    ctx.fillText('THE LIGHT FADES', W / 2, py + 62);

    if (isBest) {
      ctx.fillStyle = PALETTE.gold;
      ctx.font = '800 24px ' + FONT;
      ctx.shadowColor = PALETTE.gold;
      ctx.shadowBlur = 18;
      ctx.fillText('★ NEW BEST! ★', W / 2, py + 108);
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = PALETTE.text;
    ctx.font = '700 22px ' + FONT;
    ctx.fillText('SCORE   ' + score.toLocaleString('en-US'), W / 2, py + (isBest ? 158 : 138));
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '600 19px ' + FONT;
    const rowY = py + (isBest ? 196 : 176);
    ctx.fillText('Wave ' + (state.wave || 1) + '    ·    ' + (state.kills || 0) + ' glooms banished', W / 2, rowY);
    ctx.fillText('Best  ' + Math.max(best || 0, score).toLocaleString('en-US'), W / 2, rowY + 34);

    const pulse = 0.55 + 0.45 * Math.sin((state.time || 0) * 3);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '800 22px ' + FONT;
    ctx.fillText('PRESS R OR CLICK TO TRY AGAIN', W / 2, py + ph - 52);
    ctx.restore();
  }

  function draw(state, screen, best) {
    if (!state) return;
    const p = state.player || {};
    const hp = p.hp == null ? 100 : p.hp;
    if (lastHp != null && hp < lastHp) hurtFlash = 1;
    lastHp = hp;
    hurtFlash = Math.max(0, hurtFlash - 0.03);

    ctx.save();
    const shake = state.shake || 0;
    if (shake > 0.2) {
      ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    }

    drawArena(ctx, state);

    // Playfield entities render behind every overlay except the bare title
    // backdrop; the attract world still drifts behind the title text.
    drawGemsAndHearts(ctx, state);
    const t = state.time || 0;
    for (const e of state.enemies || []) drawEnemy(ctx, e, t);
    drawEnemyOrbs(ctx, state);
    drawBullets(ctx, state);
    if (screen !== SCREEN_TITLE) drawPlayer(ctx, state);
    drawParticles(ctx, state);
    drawTexts(ctx, state);

    if (screen === SCREEN_PLAY || screen === SCREEN_LEVELUP || screen === SCREEN_PAUSED) {
      drawHud(state, best);
    }
    if (screen === SCREEN_PLAY) drawWaveBanner(state);
    ctx.restore();

    // Damage vignette: red edges flashing just after a hit.
    if (hurtFlash > 0.02) {
      ctx.save();
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
      vg.addColorStop(0, 'rgba(255, 40, 40, 0)');
      vg.addColorStop(1, 'rgba(255, 40, 40, ' + (hurtFlash * 0.55).toFixed(3) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (screen === SCREEN_TITLE) drawTitle(state, best);
    else if (screen === SCREEN_LEVELUP) drawLevelUp(state);
    else if (screen === SCREEN_PAUSED) drawPaused();
    else if (screen === SCREEN_OVER) drawOver(state, best);
  }

  return { draw, cardRects };
}
