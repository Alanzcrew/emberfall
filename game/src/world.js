// EMBERFALL v3 — the pure simulation. No DOM, no canvas, no audio: given a
// seeded RNG and a stream of inputs it advances the run one fixed step at a
// time and returns an event bitmask. The renderer and the headless sim both
// drive it, so the game you see and the game the tests play are the same game.
//
// Design notes (why it is shaped this way):
// - One RNG stream per system (layout / spawns / combat) via child streams,
//   so tuning one system never reshuffles another.
// - Enemies are small FSMs: a `mode` plus a `modeT` timer, with transitions
//   written inside the mode, never in scattered `if type == ...` checks in
//   the caller. Perception is cheap-to-expensive: distance first, then the
//   mode logic; no enemy ever raycasts.
// - Hysteresis on every threshold that could flicker (chase/give-up bands,
//   stalker fade cycle, charger aim/charge) so no enemy toggles per frame.
// - All visual-only data leaves through `state.fx` (transient descriptors
//   the renderer turns into particles) and the event bitmask; the sim never
//   draws anything.

import {
  FIELD, STEP, PLAYER, ENEMY, ELITE, WAVE, PILLARS, SHRINE, STORM, XP,
  COMBO, GEM, HEART, NOVA, ORBITAL, CRIT, CHAIN, MULTISHOT,
} from './config.js';
import {
  baseStats, applyUpgrade, defById, novaStats, orbitalStats, chainJumps,
  lifestealPerKill, MAX_STACKS,
} from './upgrades.js';
import {
  baseRelics, applyRelic, scoreMult, relicThorns, RELIC_LEVELS,
} from './relics.js';

// Event bitmask returned by step(). Main.js maps these to sounds + juice.
export const EVENTS = {
  HIT: 1,
  KILL: 2,
  LEVELUP: 4,
  WAVECLEAR: 8,
  HURT: 16,
  DASH: 32,
  NOVA: 64,
  BOSS: 128,
  STREAK: 256,
  EVOLVE: 512,
  SHRINE: 1024,
  STORM: 2048,
  RELIC: 4096,
  ELITEKILL: 8192,
  REVIVE: 16384,
  BOSSKILL: 32768,
  CRIT: 65536,
  STUN: 131072,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export function xpNextFor(level) {
  return Math.round(XP.base + (level - 1) * XP.perLevel + (level - 1) * (level - 1) * XP.quad);
}

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------
export function createWorld(rng) {
  const world = {
    rng,
    state: null,
    step,
    chooseUpgrade,
    chooseRelic,
    reset,
  };
  world.state = freshState(rng);
  return world;

  // -- state ---------------------------------------------------------------
  function freshState(rng) {
    return {
      time: 0,
      score: 0,
      kills: 0,
      wave: 1,
      waveState: 'breather', // breather -> active -> cleared -> breather ...
      breatherT: WAVE.breather,
      clearT: 0,
      spawnQueue: [],
      spawnT: 0,
      pendingSpawns: [], // { type, x, y, t }
      enemies: [],
      bullets: [],
      orbs: [], // enemy projectiles
      gems: [],
      hearts: [],
      pillars: [],
      shrine: null, // { x, y, r, progress, claimed, boon }
      orbiters: [], // { angle } — positions derived each step
      burnFields: [], // { x, y, r, t, dps }
      boss: null,
      bossKind: null,
      player: freshPlayer(),
      combo: 1,
      comboT: 0,
      comboNovaDone: false,
      streakAnnouncedFor: 0,
      bossKillsReported: 0,
      stormActive: false,
      stormT: STORM.firstAt,
      stormLeft: 0,
      levelUpPending: false,
      choices: [],
      relicQueued: false,
      relicPending: false,
      relicChoices: [],
      over: false,
      fx: [], // transient visual descriptors, consumed by the renderer
      banner: null, // { text, sub, t } — current announcement
      runStats: {
        dashes: 0, novaKills: 0, crits: 0, bestCombo: 0, bossesSlain: 0,
        elitesSlain: 0, shrinesUsed: 0, evolutions: 0, revives: 0,
        time: 0, shotsFired: 0, shotsHit: 0, thornsKills: 0,
      },
      nextId: 1,
    };
  }

  function freshPlayer() {
    const stats = baseStats();
    return {
      x: FIELD.width / 2, y: FIELD.height / 2,
      vx: 0, vy: 0, radius: PLAYER.radius,
      hp: PLAYER.hp, maxHp: PLAYER.maxHp,
      level: 1, xp: 0, xpNext: xpNextFor(1),
      stats, relics: baseRelics(), stacks: {},
      fireT: 0, aimX: 1, aimY: 0,
      dashCharges: PLAYER.dashCharges, dashRechargeT: 0,
      dashT: 0, dashDirX: 1, dashDirY: 0,
      invuln: 0, novaT: 2, regenAcc: 0,
      furyT: 0, shield: 0,
    };
  }

  function reset() {
    world.state = freshState(world.rng);
  }

  // -- spawning ------------------------------------------------------------
  function weightedType(rng, wave) {
    const table = [
      ['wisp', 10], ['crawler', 6],
    ];
    if (wave >= 2) table.push(['spitter', 4]);
    if (wave >= 3) table.push(['stalker', 4]);
    if (wave >= 4) table.push(['dasher', 4]);
    if (wave >= 5) table.push(['mender', 2]);
    if (wave >= 6) table.push(['splitter', 3]);
    if (wave >= 7) table.push(['charger', 3]);
    let total = 0;
    for (const [, w] of table) total += w;
    let roll = rng.next() * total;
    for (const [t, w] of table) {
      roll -= w;
      if (roll <= 0) return t;
    }
    return 'wisp';
  }

  function buildQueue(wave) {
    const s = world.state;
    const queue = [];
    const isMatriarch = wave % WAVE.matriarchEvery === 0;
    const isBoss = !isMatriarch && wave % WAVE.bossEvery === 0;
    const isSwarm = wave % WAVE.swarmEvery === 0 && !isMatriarch && !isBoss;
    let budget = WAVE.budgetBase + wave * WAVE.budgetPerWave;
    if (isSwarm) budget = Math.round(budget * WAVE.swarmBudgetMult);
    if (isMatriarch || isBoss) budget = Math.round(budget * 0.5);
    if (isMatriarch) queue.push('matriarch');
    else if (isBoss) queue.push('gloomlord');
    else if (wave % WAVE.bruteEvery === 0) queue.push('brute');
    // Teach beat: every new enemy type debuts in its unlock wave, so the
    // player meets it once, on purpose, before it joins the general mix.
    const debut = { 3: 'stalker', 5: 'mender', 6: 'splitter', 7: 'charger' }[wave];
    if (debut && !isMatriarch && !isBoss && !isSwarm) {
      queue.push(debut);
      budget -= ENEMY[debut].cost;
    }
    while (budget > 0) {
      if (isSwarm) {
        const t = world.rng.chance(0.7) ? 'wisp' : 'dasher';
        queue.push(t);
        budget -= ENEMY[t].cost;
      } else {
        let t = weightedType(world.rng, wave);
        // At most two menders per wave — more than that stalls a wave
        // into a healing knot no matter how the keeper plays.
        if (t === 'mender' && queue.filter((x) => x === 'mender').length >= 2) t = 'wisp';
        queue.push(t);
        budget -= ENEMY[t].cost;
      }
    }
    s.spawnQueue = queue;
  }

  function buildPillars() {
    const s = world.state;
    const rng = world.rng.child(0x9e37 + s.wave);
    const count = rng.int(PILLARS.countMin, PILLARS.countMax);
    const pillars = [];
    let guard = 0;
    while (pillars.length < count && guard++ < 60) {
      const x = rng.range(80, FIELD.width - 80);
      const y = rng.range(80, FIELD.height - 80);
      if (dist(x, y, FIELD.width / 2, FIELD.height / 2) < PILLARS.minCenterDistance) continue;
      if (pillars.some((p) => dist(x, y, p.x, p.y) < PILLARS.minGap)) continue;
      pillars.push({ x, y, r: rng.range(PILLARS.radiusMin, PILLARS.radiusMax) });
    }
    s.pillars = pillars;
  }

  function buildShrine() {
    const s = world.state;
    if (s.wave < SHRINE.fromWave) { s.shrine = null; return; }
    const rng = world.rng.child(0x51ab + s.wave);
    let x = 0; let y = 0; let guard = 0;
    do {
      x = rng.range(90, FIELD.width - 90);
      y = rng.range(90, FIELD.height - 90);
      guard++;
    } while (
      guard < 40
      && (dist(x, y, FIELD.width / 2, FIELD.height / 2) < SHRINE.minCenterDistance
        || s.pillars.some((p) => dist(x, y, p.x, p.y) < p.r + 90))
    );
    s.shrine = { x, y, r: SHRINE.radius, progress: 0, claimed: false, boon: null };
  }

  function spawnPosition() {
    const s = world.state;
    const p = s.player;
    for (let i = 0; i < 8; i++) {
      const a = world.rng.range(0, Math.PI * 2);
      const d = world.rng.range(WAVE.minSpawnDistance, WAVE.minSpawnDistance + 160);
      const x = clamp(p.x + Math.cos(a) * d, 30, FIELD.width - 30);
      const y = clamp(p.y + Math.sin(a) * d, 30, FIELD.height - 30);
      if (dist(x, y, p.x, p.y) >= WAVE.minSpawnDistance - 60) return { x, y };
    }
    return { x: 60, y: 60 };
  }

  function spawnEnemy(type, x, y) {
    const s = world.state;
    const def = ENEMY[type];
    if (!def) return null;
    const waveScale = 1 + WAVE.hpScale * (s.wave - 1);
    const speedScale = Math.min(
      1 + WAVE.speedScale * (s.wave - 1), WAVE.speedScaleCap,
    );
    let elite = false;
    if (
      s.wave >= ELITE.fromWave && type !== 'gloomlord' && type !== 'matriarch'
      && type !== 'brute' && world.rng.chance(ELITE.chance)
    ) elite = true;
    const e = {
      id: s.nextId++,
      type, x, y, vx: 0, vy: 0,
      radius: def.radius * (elite ? ELITE.radiusMult : 1),
      hp: Math.round(def.hp * waveScale * (elite ? ELITE.hpMult : 1)),
      maxHp: 0,
      speed: def.speed * speedScale * (elite ? ELITE.speedMult : 1),
      dmg: def.dmg,
      xp: def.xp * (elite ? ELITE.xpMult : 1),
      score: def.score * (elite ? ELITE.scoreMult : 1),
      elite,
      mode: 'chase', modeT: 0,
      t: world.rng.range(0, 1),
      flash: 0, stunT: 0, orbHitT: 0,
      orbT: world.rng.range(1, 2.2),
      burstT: 2, summonT: 4, spiralA: world.rng.range(0, Math.PI * 2),
      fadeT: 0, visible: true,
      lockX: 0, lockY: 0,
      healTarget: null,
    };
    e.maxHp = e.hp;
    s.enemies.push(e);
    if (type === 'gloomlord' || type === 'matriarch') {
      s.boss = e;
      s.bossKind = type;
    }
    return e;
  }

  // -- combat --------------------------------------------------------------
  function damageEnemy(e, dmg, opts = {}) {
    const s = world.state;
    if (e.hp <= 0) return false;
    let mult = 1;
    if (e.type === 'stalker' && !e.visible) mult *= ENEMY.stalker.hiddenDamageMult;
    if (e.stunT > 0) mult *= ENEMY.charger.stunDamageMult;
    e.hp -= dmg * mult;
    e.flash = 0.12;
    // A mender's mend breaks for a second whenever it takes damage.
    if (e.type === 'mender') e.healBreakT = 1;
    if (opts.crit) s.runStats.crits++;
    if (e.hp <= 0) {
      killEnemy(e, opts.source || 'bolt');
      return true;
    }
    return false;
  }

  function killEnemy(e, source) {
    const s = world.state;
    const idx = s.enemies.indexOf(e);
    if (idx < 0) return;
    s.enemies.splice(idx, 1);
    s.kills++;
    // Score uses the current combo, then the combo climbs (cap 15 in v3).
    // The chain is the multiplier: a kill at x12 pays twelve times base.
    s.score += Math.round(e.score * s.combo * scoreMult(s.player));
    s.combo = Math.min(s.combo + 1, COMBO.cap);
    s.comboT = COMBO.timer;
    if (s.combo > s.runStats.bestCombo) s.runStats.bestCombo = s.combo;
    s.fx.push({ kind: 'kill', x: e.x, y: e.y, elite: e.elite, big: e.radius >= 30 });
    if (source === 'nova') s.runStats.novaKills++;
    if (source === 'thorns') s.runStats.thornsKills++;
    if (e.elite) {
      s.runStats.elitesSlain++;
      s.fx.push({ kind: 'elite', x: e.x, y: e.y });
    }
    // Drops.
    const gemCount = e.elite ? ELITE.gemDrops : 1;
    for (let i = 0; i < gemCount; i++) {
      s.gems.push({
        x: clamp(e.x + world.rng.range(-14, 14), 10, FIELD.width - 10),
        y: clamp(e.y + world.rng.range(-14, 14), 10, FIELD.height - 10),
        value: e.xp, vx: 0, vy: 0,
      });
    }
    const heartChance = e.elite ? ELITE.heartChance
      : (e.type === 'brute' ? 1 : HEART.dropChance);
    if ((e.type === 'crawler' || e.type === 'spitter' || e.type === 'mender'
        || e.elite || e.type === 'brute') && world.rng.chance(heartChance)) {
      s.hearts.push({ x: e.x, y: e.y, vx: 0, vy: 0 });
    }
    if (e.type === 'splitter') {
      for (let i = 0; i < ENEMY.splitter.children; i++) {
        const a = world.rng.range(0, Math.PI * 2);
        s.pendingSpawns.push({
          type: 'wisp',
          x: clamp(e.x + Math.cos(a) * 26, 20, FIELD.width - 20),
          y: clamp(e.y + Math.sin(a) * 26, 20, FIELD.height - 20),
          t: 0.15,
        });
      }
    }
    if (e.type === 'gloomlord' || e.type === 'matriarch') {
      s.boss = null;
      s.bossKind = null;
      s.runStats.bossesSlain++;
      s.fx.push({ kind: 'bosskill', x: e.x, y: e.y });
      for (let i = 0; i < 5; i++) {
        s.gems.push({
          x: clamp(e.x + world.rng.range(-30, 30), 10, FIELD.width - 10),
          y: clamp(e.y + world.rng.range(-30, 30), 10, FIELD.height - 10),
          value: 10, vx: 0, vy: 0,
        });
      }
      s.hearts.push({ x: e.x - 24, y: e.y, vx: 0, vy: 0 });
      s.hearts.push({ x: e.x + 24, y: e.y, vx: 0, vy: 0 });
    }
    // Combo milestone: at 10 the chain detonates a free Emberfall nova.
    if (s.combo >= COMBO.novaAt && !s.comboNovaDone) {
      s.comboNovaDone = true;
      novaBurst(160, 2, 'combo');
      setBanner('EMBERFALL!', `combo x${s.combo} — the field ignites`);
    }
  }

  function novaBurst(radius, damage, source) {
    const s = world.state;
    const p = s.player;
    s.fx.push({ kind: 'nova', x: p.x, y: p.y, r: radius });
    for (const e of [...s.enemies]) {
      if (dist(e.x, e.y, p.x, p.y) <= radius + e.radius) {
        damageEnemy(e, damage, { source });
      }
    }
  }

  function hurtPlayer(dmg, fromX, fromY) {
    const s = world.state;
    const p = s.player;
    if (p.invuln > 0 || p.dashT > 0 || s.over) return false;
    let remaining = dmg;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, remaining);
      p.shield -= absorbed;
      remaining -= absorbed;
      s.fx.push({ kind: 'shield', x: p.x, y: p.y });
    }
    if (remaining > 0) {
      p.hp -= remaining;
      s.fx.push({ kind: 'hurt', x: p.x, y: p.y });
    }
    p.invuln = PLAYER.invulnerable;
    const a = norm(p.x - fromX, p.y - fromY);
    p.x = clamp(p.x + a.x * 10, p.radius, FIELD.width - p.radius);
    p.y = clamp(p.y + a.y * 10, p.radius, FIELD.height - p.radius);
    if (p.hp <= 0) {
      if (p.relics.secondwind && !p.relics.secondwindUsed) {
        p.relics.secondwindUsed = true;
        p.hp = Math.round(p.maxHp * 0.5);
        p.invuln = 2;
        s.runStats.revives++;
        novaBurst(220, 4, 'revive');
        setBanner('SECOND WIND', 'the lantern refuses to go out');
        return 'revived';
      }
      p.hp = 0;
      s.over = true;
      s.runStats.time = s.time;
      return 'died';
    }
    return 'hurt';
  }

  function gainXp(n) {
    const s = world.state;
    const p = s.player;
    const mult = (1 + COMBO.xpPerStep * (s.combo - 1)) * (s.stormActive ? STORM.xpMult : 1);
    p.xp += Math.round(n * mult);
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = xpNextFor(p.level);
      if (RELIC_LEVELS.includes(p.level)) s.relicQueued = true;
      if (!s.levelUpPending) {
        s.levelUpPending = true;
        s.choices = rollChoices();
      }
    }
  }

  function rollChoices() {
    const s = world.state;
    const p = s.player;
    const pool = [];
    for (const def of Object.values(upgradeDefs())) {
      const stacks = p.stacks[def.id] || 0;
      if (stacks < def.max) pool.push(def);
    }
    world.rng.shuffle(pool);
    const picked = pool.slice(0, 3);
    // First level-up always offers a damage option: a run should never
    // open with three utility picks and no way to kill faster.
    if (p.level === 2) {
      const dmgIds = ['damage', 'multishot', 'firerate', 'nova', 'chain', 'pierce', 'crit', 'orbital'];
      if (!picked.some((d) => dmgIds.includes(d.id))) {
        const dmgPool = pool.filter((d) => dmgIds.includes(d.id));
        if (dmgPool.length > 0) picked[2] = dmgPool[0];
      }
    }
    while (picked.length < 3) {
      picked.push({ id: 'heal', name: 'Ember Draught', desc: 'Heal 30 HP right now.', max: 99 });
    }
    return picked.map((d) => ({ id: d.id, stacks: p.stacks[d.id] || 0 }));
  }

  function upgradeDefs() {
    // Local import indirection keeps the module graph acyclic for the sim.
    return UPGRADE_DEFS_MAP;
  }

  function rollRelics() {
    const s = world.state;
    const p = s.player;
    const pool = RELIC_DEFS.filter((d) => !p.relics[d.id]);
    world.rng.shuffle(pool);
    return pool.slice(0, 3).map((d) => ({ id: d.id }));
  }

  function setBanner(text, sub) {
    world.state.banner = { text, sub, t: 2.2 };
  }

  // -- level-up / relic choices --------------------------------------------
  function chooseUpgrade(i) {
    const s = world.state;
    if (!s.levelUpPending) return false;
    const choice = s.choices[i];
    if (!choice) return false;
    const p = s.player;
    let evolved = null;
    if (choice.id === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + 30);
      s.fx.push({ kind: 'heal', x: p.x, y: p.y });
    } else {
      p.stacks[choice.id] = (p.stacks[choice.id] || 0) + 1;
      applyUpgrade(p.stats, choice.id);
      if (choice.id === 'maxhp') p.hp = Math.min(p.maxHp, p.hp + 25);
      const def = defById(choice.id);
      if (def && def.evolve && p.stacks[choice.id] >= MAX_STACKS) {
        evolved = def.evolve;
        if (choice.id === 'nova') p.stats.novaEvolved = true;
        if (choice.id === 'orbital') p.stats.orbitalEvolved = true;
        if (choice.id === 'multishot') p.stats.multishotEvolved = true;
        if (choice.id === 'chain') p.stats.chainEvolved = true;
        s.runStats.evolutions++;
        if (def.id === 'multishot') {
          p.stats.projectiles += MULTISHOT.evolveProjectilesBonus;
        }
        setBanner('EVOLVED — ' + evolutionName(evolved), evolutionDesc(evolved));
        s.fx.push({ kind: 'evolve', x: p.x, y: p.y });
      }
    }
    s.levelUpPending = false;
    s.choices = [];
    if (s.relicQueued) {
      s.relicQueued = false;
      const relics = rollRelics();
      if (relics.length > 0) {
        s.relicPending = true;
        s.relicChoices = relics;
        return true;
      }
    }
    if (p.xp >= p.xpNext) {
      // Chained level-up from a big XP gain.
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = xpNextFor(p.level);
      if (RELIC_LEVELS.includes(p.level)) s.relicQueued = true;
      s.levelUpPending = true;
      s.choices = rollChoices();
    }
    return evolved ? 'evolved' : true;
  }

  function chooseRelic(i) {
    const s = world.state;
    if (!s.relicPending) return false;
    const choice = s.relicChoices[i];
    if (!choice) return false;
    applyRelic(s.player, choice.id);
    s.relicPending = false;
    s.relicChoices = [];
    setBanner('RELIC — ' + choice.id.toUpperCase(), 'a permanent blessing for this run');
    const p = s.player;
    if (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = xpNextFor(p.level);
      if (RELIC_LEVELS.includes(p.level)) s.relicQueued = true;
      s.levelUpPending = true;
      s.choices = rollChoices();
    }
    return true;
  }

  // -- the step --------------------------------------------------------------
  function step(dt, input) {
    const s = world.state;
    let events = 0;
    s.fx.length = 0;
    if (s.over || s.levelUpPending || s.relicPending) return events;
    const p = s.player;
    s.time += dt;
    if (s.banner) {
      s.banner.t -= dt;
      if (s.banner.t <= 0) s.banner = null;
    }

    // Ember Storm cycle.
    if (s.stormActive) {
      s.stormLeft -= dt;
      if (s.stormLeft <= 0) {
        s.stormActive = false;
        s.stormT = STORM.every;
      }
    } else {
      s.stormT -= dt;
      if (s.stormT <= 0) {
        s.stormActive = true;
        s.stormLeft = STORM.duration;
        events |= EVENTS.STORM;
        setBanner('EMBER STORM', 'double XP — the dark presses harder');
        s.fx.push({ kind: 'storm', x: p.x, y: p.y });
      }
    }

    // Combo decay: the chain only falls when its timer expires — never
    // when the keeper is hurt.
    if (s.combo > 1) {
      s.comboT -= dt;
      if (s.comboT <= 0) { s.combo = 1; s.comboNovaDone = false; }
    }

    // Timers: regen, fury, invulnerability, dash recharge.
    if (p.stats.regen > 0 && p.hp > 0 && p.hp < p.maxHp) {
      p.regenAcc += p.stats.regen * dt;
      if (p.regenAcc >= 1) {
        const whole = Math.floor(p.regenAcc);
        p.regenAcc -= whole;
        p.hp = Math.min(p.maxHp, p.hp + whole);
      }
    }
    if (p.furyT > 0) p.furyT -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.dashCharges < p.stats.dashCharges) {
      p.dashRechargeT -= dt;
      if (p.dashRechargeT <= 0) {
        p.dashCharges++;
        p.dashRechargeT = p.stats.dashRecharge;
      }
    } else {
      p.dashRechargeT = p.stats.dashRecharge;
    }

    // Aim + dash request.
    const aimLen = Math.hypot(input.ax || 0, input.ay || 0);
    if (aimLen > 0.01) {
      p.aimX = input.ax / aimLen;
      p.aimY = input.ay / aimLen;
    }
    if (input.dash && p.dashCharges > 0 && p.dashT <= 0) {
      p.dashCharges--;
      p.dashRechargeT = p.stats.dashRecharge;
      p.dashT = PLAYER.dashTime;
      const mv = Math.hypot(input.mx || 0, input.my || 0);
      if (mv > 0.01) {
        p.dashDirX = input.mx / mv;
        p.dashDirY = input.my / mv;
      } else {
        p.dashDirX = p.aimX;
        p.dashDirY = p.aimY;
      }
      p.invuln = Math.max(p.invuln, PLAYER.dashInvuln);
      s.runStats.dashes++;
      events |= EVENTS.DASH;
      s.fx.push({ kind: 'dash', x: p.x, y: p.y });
    }

    // Movement (dash overrides walking).
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashDirX * PLAYER.dashSpeed * dt;
      p.y += p.dashDirY * PLAYER.dashSpeed * dt;
    } else {
      const mv = Math.hypot(input.mx || 0, input.my || 0);
      if (mv > 0.01) {
        const nx = input.mx / mv;
        const ny = input.my / mv;
        p.x += nx * p.stats.speed * dt;
        p.y += ny * p.stats.speed * dt;
      }
    }
    p.x = clamp(p.x, p.radius, FIELD.width - p.radius);
    p.y = clamp(p.y, p.radius, FIELD.height - p.radius);
    pushOutOfPillars(p);

    // Firing.
    p.fireT -= dt;
    if (input.firing && p.fireT <= 0) {
      p.fireT = 1 / p.stats.fireRate;
      fireBolts();
      events |= EVENTS.HIT; // a shot left the lantern (sound hook)
    }

    // Nova.
    if (p.stats.nova > 0) {
      p.novaT -= dt;
      if (p.novaT <= 0) {
        const ns = novaStats(p.stats.nova, p.stats.novaEvolved);
        p.novaT = ns.interval;
        novaBurst(ns.radius, ns.damage, 'nova');
        events |= EVENTS.NOVA;
        if (ns.burn) {
          s.burnFields.push({ x: p.x, y: p.y, r: ns.radius, t: NOVA.burnTime, dps: NOVA.burnDps });
        }
      }
    }

    // Orbiters.
    if (p.stats.orbital > 0) {
      const os = orbitalStats(p.stats.orbital, p.stats.orbitalEvolved);
      while (s.orbiters.length < os.count) s.orbiters.push({ angle: world.rng.range(0, Math.PI * 2) });
      while (s.orbiters.length > os.count) s.orbiters.pop();
      for (const o of s.orbiters) o.angle += os.speed * dt;
      for (const o of s.orbiters) {
        const ox = p.x + Math.cos(o.angle) * os.radius;
        const oy = p.y + Math.sin(o.angle) * os.radius;
        for (const e of [...s.enemies]) {
          if (e.orbHitT <= 0 && dist(ox, oy, e.x, e.y) < 14 + e.radius) {
            e.orbHitT = ORBITAL.hitCooldown;
            damageEnemy(e, os.damage, { source: 'orbital' });
            s.fx.push({ kind: 'hit', x: e.x, y: e.y });
          }
        }
      }
    }

    // Burn fields (Supernova ground fire).
    for (const f of [...s.burnFields]) {
      f.t -= dt;
      if (f.t <= 0) {
        s.burnFields.splice(s.burnFields.indexOf(f), 1);
        continue;
      }
      for (const e of [...s.enemies]) {
        if (dist(e.x, e.y, f.x, f.y) < f.r + e.radius) {
          e.hp -= f.dps * dt;
          if (e.hp <= 0) killEnemy(e, 'nova');
        }
      }
    }

    // Bullets.
    for (const b of [...s.bullets]) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.range -= Math.hypot(b.vx, b.vy) * dt;
      let dead = b.range <= 0
        || b.x < 0 || b.x > FIELD.width || b.y < 0 || b.y > FIELD.height;
      // Bolts fly OVER the low ember pillars — pillars block bodies, not
      // fire — so a pillar never taxes the keeper's damage output.
      if (!dead) {
        for (const e of [...s.enemies]) {
          if (e.hp <= 0 || b.hitIds.has(e.id)) continue;
          if (dist(b.x, b.y, e.x, e.y) < e.radius + b.radius) {
            b.hitIds.add(e.id);
            s.runStats.shotsHit++;
            const killed = damageEnemy(e, b.dmg, { crit: b.crit, source: 'bolt' });
            if (b.crit) events |= EVENTS.CRIT;
            s.fx.push({ kind: b.crit ? 'crit' : 'hit', x: e.x, y: e.y });
            // Chain lightning arcs to nearby foes.
            let jumps = b.chainLeft;
            let from = e;
            let lastDmg = b.dmg;
            const chained = new Set([e.id]);
            while (jumps > 0) {
              let next = null; let nextD = CHAIN.jumpRange;
              for (const cand of s.enemies) {
                if (cand.hp <= 0 || chained.has(cand.id)) continue;
                const d = dist(from.x, from.y, cand.x, cand.y);
                if (d < nextD) { nextD = d; next = cand; }
              }
              if (!next) break;
              chained.add(next.id);
              lastDmg *= CHAIN.damageFalloff;
              s.fx.push({ kind: 'chain', x: from.x, y: from.y, x2: next.x, y2: next.y });
              damageEnemy(next, lastDmg, { source: 'chain' });
              from = next;
              jumps--;
              if (p.stats.chainEvolved) {
                // Stormcall: the chain strikes twice.
                damageEnemy(next, lastDmg * 0.5, { source: 'chain' });
              }
            }
            if (b.pierce > 0) {
              b.pierce--;
            } else {
              dead = true;
            }
            break;
          }
        }
      }
      if (dead) s.bullets.splice(s.bullets.indexOf(b), 1);
    }

    // Enemy orbs.
    for (const o of [...s.orbs]) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.t -= dt;
      let dead = o.t <= 0 || o.x < 0 || o.x > FIELD.width || o.y < 0 || o.y > FIELD.height;
      // Shadow orbs fly over the pillars too.
      if (!dead && dist(o.x, o.y, p.x, p.y) < o.radius + p.radius) {
        dead = true;
        const res = hurtPlayer(o.dmg, o.x, o.y);
        if (res) events |= res === 'revived' ? EVENTS.REVIVE : EVENTS.HURT;
      }
      if (dead) s.orbs.splice(s.orbs.indexOf(o), 1);
    }

    // Enemies.
    for (const e of [...s.enemies]) {
      updateEnemy(e, dt);
    }
    separateEnemies();
    for (const e of s.enemies) {
      if (e.type !== 'gloomlord' && e.type !== 'matriarch') pushOutOfPillars(e);
      e.x = clamp(e.x, e.radius, FIELD.width - e.radius);
      e.y = clamp(e.y, e.radius, FIELD.height - e.radius);
    }

    // Contact damage with the player.
    for (const e of [...s.enemies]) {
      if (e.hp <= 0) continue;
      if (dist(e.x, e.y, p.x, p.y) < e.radius + p.radius) {
        const res = hurtPlayer(e.dmg, e.x, e.y);
        if (res) events |= res === 'revived' ? EVENTS.REVIVE : EVENTS.HURT;
        const reflect = p.stats.thorns + relicThorns(p);
        if (reflect > 0 && e.hp > 0) {
          damageEnemy(e, reflect, { source: 'thorns' });
        }
      }
    }

    // Gems + hearts: magnet pull, then pickup.
    for (const g of [...s.gems]) {
      const d = dist(g.x, g.y, p.x, p.y);
      if (d < p.stats.magnet) {
        const a = norm(p.x - g.x, p.y - g.y);
        const pull = 900 * (1 - d / (p.stats.magnet + 1)) + 260;
        g.x += a.x * pull * dt;
        g.y += a.y * pull * dt;
      }
      if (dist(g.x, g.y, p.x, p.y) < GEM.pickupRadius + 6) {
        s.gems.splice(s.gems.indexOf(g), 1);
        gainXp(g.value);
        if (s.levelUpPending) events |= EVENTS.LEVELUP;
      }
    }
    for (const h of [...s.hearts]) {
      const d = dist(h.x, h.y, p.x, p.y);
      if (d < p.stats.magnet) {
        const a = norm(p.x - h.x, p.y - h.y);
        h.x += a.x * 500 * dt;
        h.y += a.y * 500 * dt;
      }
      if (dist(h.x, h.y, p.x, p.y) < GEM.pickupRadius + 8) {
        s.hearts.splice(s.hearts.indexOf(h), 1);
        p.hp = Math.min(p.maxHp, p.hp + HEART.heal);
        s.fx.push({ kind: 'heal', x: p.x, y: p.y });
      }
    }

    // Shrine channel.
    if (s.shrine && !s.shrine.claimed) {
      const sh = s.shrine;
      if (dist(p.x, p.y, sh.x, sh.y) < sh.r) {
        sh.progress += dt;
        if (sh.progress >= SHRINE.channelTime) {
          sh.claimed = true;
          sh.boon = p.hp < p.maxHp * 0.6 ? 'heal'
            : world.rng.pick(['fury', 'shield', 'heal']);
          if (sh.boon === 'heal') p.hp = Math.min(p.maxHp, p.hp + SHRINE.heal);
          if (sh.boon === 'fury') p.furyT = SHRINE.furyTime;
          if (sh.boon === 'shield') p.shield = SHRINE.shield;
          s.runStats.shrinesUsed++;
          events |= EVENTS.SHRINE;
          setBanner('SHRINE CLAIMED', shrineBoonText(sh.boon));
          s.fx.push({ kind: 'shrine', x: sh.x, y: sh.y });
        }
      } else {
        sh.progress = Math.max(0, sh.progress - dt * 2);
      }
    }

    // Spawn queue.
    if (s.waveState === 'active' && s.spawnQueue.length > 0) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        const interval = Math.max(
          WAVE.spawnIntervalMin,
          WAVE.spawnIntervalStart - WAVE.spawnIntervalStep * (s.wave - 1),
        ) * (s.stormActive ? STORM.spawnIntervalMult : 1);
        s.spawnT = interval;
        const type = s.spawnQueue.shift();
        const pos = spawnPosition();
        s.pendingSpawns.push({ type, x: pos.x, y: pos.y, t: WAVE.telegraph });
        s.fx.push({ kind: 'spawn', x: pos.x, y: pos.y });
        if (type === 'gloomlord' || type === 'matriarch') {
          events |= EVENTS.BOSS;
          setBanner(
            type === 'gloomlord' ? 'THE GLOOMLORD' : 'THE GLOOM MATRIARCH',
            type === 'gloomlord' ? 'the dark sends its king' : 'she calls her brood',
          );
        }
      }
    }
    for (const ps of [...s.pendingSpawns]) {
      ps.t -= dt;
      if (ps.t <= 0) {
        s.pendingSpawns.splice(s.pendingSpawns.indexOf(ps), 1);
        spawnEnemy(ps.type, ps.x, ps.y);
      }
    }

    // Wave state machine.
    if (s.waveState === 'breather') {
      s.breatherT -= dt;
      if (s.breatherT <= 0) {
        buildQueue(s.wave);
        s.waveState = 'active';
        s.spawnT = 0.4;
      }
    } else if (s.waveState === 'active') {
      if (s.spawnQueue.length === 0 && s.pendingSpawns.length === 0 && s.enemies.length === 0) {
        const bonus = Math.round(WAVE.clearBonus * s.wave * scoreMult(p));
        s.score += bonus;
        events |= EVENTS.WAVECLEAR;
        setBanner(`WAVE ${s.wave} CLEARED`, `+${bonus} bonus`);
        s.waveState = 'cleared';
        s.clearT = WAVE.cleared;
      }
    } else if (s.waveState === 'cleared') {
      s.clearT -= dt;
      if (s.clearT <= 0) {
        s.wave++;
        buildPillars();
        buildShrine();
        s.waveState = 'breather';
        s.breatherT = WAVE.breather;
      }
    }

    // Streak announcements — fire once per milestone, not every step while
    // the combo sits on the number.
    if ((s.combo === 5 || s.combo === 10 || s.combo === 15)
      && s.streakAnnouncedFor !== s.combo) {
      s.streakAnnouncedFor = s.combo;
      events |= EVENTS.STREAK;
      const label = s.combo === 5 ? 'STREAK x5' : s.combo === 10 ? 'RAMPAGE' : 'UNSTOPPABLE';
      setBanner(label, `combo x${s.combo}`);
    }

    // Boss kill event: killEnemy counted it; surface the bit once per kill.
    if (s.runStats.bossesSlain > (s.bossKillsReported || 0)) {
      s.bossKillsReported = s.runStats.bossesSlain;
      events |= EVENTS.BOSSKILL;
    }
    if (s.over) events |= EVENTS.HURT;
    return events;

    // -- local helpers (closures over the step's state) ---------------------
    function fireBolts() {
      const count = p.stats.projectiles;
      const spread = 0.14; // radians between bolts
      const dmgMult = p.furyT > 0 ? SHRINE.furyDamageMult : 1;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * spread;
        const a = Math.atan2(p.aimY, p.aimX) + off;
        const crit = world.rng.next() < p.stats.critChance;
        s.bullets.push({
          x: p.x + Math.cos(a) * (p.radius + 6),
          y: p.y + Math.sin(a) * (p.radius + 6),
          vx: Math.cos(a) * p.stats.bulletSpeed,
          vy: Math.sin(a) * p.stats.bulletSpeed,
          dmg: p.stats.bulletDamage * dmgMult * (crit ? CRIT.multiplier : 1),
          pierce: p.stats.pierce,
          range: p.stats.bulletRange,
          radius: 5,
          hitIds: new Set(),
          chainLeft: chainJumps(p.stats.chain, p.stats.chainEvolved),
          crit,
        });
        s.runStats.shotsFired++;
      }
    }
  }

  // -- enemy FSM -------------------------------------------------------------
  function updateEnemy(e, dt) {
    const s = world.state;
    const p = s.player;
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.stunT > 0) { e.stunT -= dt; return; } // stunned: no move, no attack
    if (e.orbHitT > 0) e.orbHitT -= dt;
    const d = dist(e.x, e.y, p.x, p.y);
    const toPlayer = norm(p.x - e.x, p.y - e.y);

    switch (e.type) {
      case 'wisp':
      case 'crawler':
      case 'brute':
        e.x += toPlayer.x * e.speed * dt;
        e.y += toPlayer.y * e.speed * dt;
        break;

      case 'spitter': {
        e.orbT -= dt;
        const def = ENEMY.spitter;
        if (d > def.keepMax) {
          e.x += toPlayer.x * e.speed * dt;
          e.y += toPlayer.y * e.speed * dt;
        } else if (d < def.keepMin) {
          e.x -= toPlayer.x * e.speed * 0.8 * dt;
          e.y -= toPlayer.y * e.speed * 0.8 * dt;
        }
        if (e.orbT <= 0 && d < 560) {
          e.orbT = def.orbInterval;
          s.orbs.push({
            x: e.x, y: e.y,
            vx: toPlayer.x * def.orbSpeed, vy: toPlayer.y * def.orbSpeed,
            radius: 6, dmg: def.orbDamage, t: 4,
          });
        }
        break;
      }

      case 'stalker': {
        const def = ENEMY.stalker;
        e.fadeT += dt;
        const cycle = def.visibleTime + def.hiddenTime;
        const phase = e.fadeT % cycle;
        e.visible = phase < def.visibleTime;
        const speed = e.speed * (e.visible ? 1 : def.hiddenSpeedMult);
        if (e.mode === 'lunge') {
          e.modeT -= dt;
          e.x += e.lockX * def.lungeSpeed * dt;
          e.y += e.lockY * def.lungeSpeed * dt;
          if (e.modeT <= 0) { e.mode = 'chase'; e.fadeT = 0; }
        } else {
          e.x += toPlayer.x * speed * dt;
          e.y += toPlayer.y * speed * dt;
          // Decloak lunge: only when hidden and close — the shimmer gives
          // the player (and the autopilot) a fair warning.
          if (!e.visible && d < def.lungeRange) {
            e.mode = 'lunge';
            e.modeT = def.lungeTime;
            e.lockX = toPlayer.x;
            e.lockY = toPlayer.y;
            e.visible = true;
            e.fadeT = 0;
            s.fx.push({ kind: 'spawn', x: e.x, y: e.y });
          }
        }
        break;
      }

      case 'dasher': {
        const def = ENEMY.dasher;
        if (e.mode === 'chase') {
          e.x += toPlayer.x * e.speed * dt;
          e.y += toPlayer.y * e.speed * dt;
          e.modeT -= dt;
          if (d < 260 && e.modeT <= 0) {
            e.mode = 'windup';
            e.modeT = def.windup;
            e.lockX = toPlayer.x;
            e.lockY = toPlayer.y;
          }
        } else if (e.mode === 'windup') {
          e.modeT -= dt;
          // Telegraph: crouch in place, locked onto the snapshot direction.
          if (e.modeT <= 0) {
            e.mode = 'lunge';
            e.modeT = def.lungeTime;
          }
        } else if (e.mode === 'lunge') {
          e.modeT -= dt;
          e.x += e.lockX * def.lungeSpeed * dt;
          e.y += e.lockY * def.lungeSpeed * dt;
          if (e.modeT <= 0) {
            e.mode = 'recover';
            e.modeT = def.lungeCooldown;
          }
        } else { // recover
          e.modeT -= dt;
          e.x += toPlayer.x * e.speed * 0.4 * dt;
          e.y += toPlayer.y * e.speed * 0.4 * dt;
          if (e.modeT <= 0) e.mode = 'chase';
        }
        break;
      }

      case 'mender': {
        const def = ENEMY.mender;
        // A fresh wound breaks the mend for a second.
        if (e.healBreakT > 0) {
          e.healBreakT -= dt;
          e.healTarget = null;
          const def2 = ENEMY.mender;
          if (d > def2.keepMax) {
            e.x += toPlayer.x * e.speed * 0.7 * dt;
            e.y += toPlayer.y * e.speed * 0.7 * dt;
          } else if (d < def2.keepMin) {
            e.x -= toPlayer.x * e.speed * 0.6 * dt;
            e.y -= toPlayer.y * e.speed * 0.6 * dt;
          }
          break;
        }
        // Perception: the most-hurt ally in range, re-scanned twice a second.
        e.modeT -= dt;
        if (e.modeT <= 0) {
          e.modeT = 0.5;
          let worst = null; let worstFrac = 1;
          for (const ally of s.enemies) {
            if (ally === e || ally.hp <= 0) continue;
            // Bosses are beyond mending — their wounds are the run's own.
            if (ally.type === 'gloomlord' || ally.type === 'matriarch') continue;
            // Menders cannot mend each other: four of them cross-healing
            // would stalemate a low-damage run into an unkillable knot.
            if (ally.type === 'mender') continue;
            const frac = ally.hp / ally.maxHp;
            if (frac < worstFrac && dist(e.x, e.y, ally.x, ally.y) < def.healRange) {
              worstFrac = frac;
              worst = ally;
            }
          }
          e.healTarget = worst && worstFrac < 0.95 ? worst : null;
        }
        if (e.healTarget && e.healTarget.hp > 0) {
          const a = e.healTarget;
          const ad = dist(e.x, e.y, a.x, a.y);
          if (ad > 200) {
            const n = norm(a.x - e.x, a.y - e.y);
            e.x += n.x * e.speed * dt;
            e.y += n.y * e.speed * dt;
          }
          a.hp = Math.min(a.maxHp, a.hp + def.healPerSecond * dt);
          if (world.rng.chance(dt * 6)) {
            s.fx.push({ kind: 'heal', x: a.x, y: a.y });
          }
        } else {
          const def2 = ENEMY.mender;
          if (d > def2.keepMax) {
            e.x += toPlayer.x * e.speed * 0.7 * dt;
            e.y += toPlayer.y * e.speed * 0.7 * dt;
          } else if (d < def2.keepMin) {
            e.x -= toPlayer.x * e.speed * 0.6 * dt;
            e.y -= toPlayer.y * e.speed * 0.6 * dt;
          }
        }
        break;
      }

      case 'splitter':
        e.x += toPlayer.x * e.speed * dt;
        e.y += toPlayer.y * e.speed * dt;
        break;

      case 'charger': {
        const def = ENEMY.charger;
        if (e.mode === 'chase') {
          e.x += toPlayer.x * e.speed * dt;
          e.y += toPlayer.y * e.speed * dt;
          if (d < 340) {
            e.mode = 'aim';
            e.modeT = def.aimTime;
            e.lockX = toPlayer.x;
            e.lockY = toPlayer.y;
          }
        } else if (e.mode === 'aim') {
          e.modeT -= dt;
          // Re-lock slowly so a moving keeper can slip the lane.
          e.lockX = e.lockX * 0.7 + toPlayer.x * 0.3;
          e.lockY = e.lockY * 0.7 + toPlayer.y * 0.3;
          if (e.modeT <= 0) {
            e.mode = 'charge';
            e.modeT = def.chargeTime;
            const n = norm(e.lockX - e.x, e.lockY - e.y);
            e.lockX = n.x;
            e.lockY = n.y;
          }
        } else if (e.mode === 'charge') {
          e.modeT -= dt;
          const nx = e.x + e.lockX * def.chargeSpeed * dt;
          const ny = e.y + e.lockY * def.chargeSpeed * dt;
          const hitWall = nx < e.radius + 4 || nx > FIELD.width - e.radius - 4
            || ny < e.radius + 4 || ny > FIELD.height - e.radius - 4;
          const hitPillar = s.pillars.some(
            (pil) => dist(nx, ny, pil.x, pil.y) < pil.r + e.radius,
          );
          e.x = nx;
          e.y = ny;
          if (hitWall || hitPillar || e.modeT <= 0) {
            if (hitWall || hitPillar) {
              e.stunT = def.stunTime;
              s.fx.push({ kind: 'stun', x: e.x, y: e.y });
            }
            e.mode = 'recover';
            e.modeT = def.recoverTime;
          }
        } else { // recover
          e.modeT -= dt;
          if (e.modeT <= 0) e.mode = 'chase';
        }
        break;
      }

      case 'gloomlord': {
        const def = ENEMY.gloomlord;
        e.x += toPlayer.x * e.speed * dt;
        e.y += toPlayer.y * e.speed * dt;
        e.burstT -= dt;
        if (e.burstT <= 0) {
          e.burstT = def.burstInterval;
          for (let i = 0; i < def.burstCount; i++) {
            const a = (i / def.burstCount) * Math.PI * 2;
            s.orbs.push({
              x: e.x, y: e.y,
              vx: Math.cos(a) * def.orbSpeed, vy: Math.sin(a) * def.orbSpeed,
              radius: 6, dmg: def.orbDamage, t: 5,
            });
          }
          s.fx.push({ kind: 'nova', x: e.x, y: e.y, r: 60 });
        }
        e.summonT -= dt;
        if (e.summonT <= 0) {
          e.summonT = def.summonInterval;
          for (let i = 0; i < def.summonCount; i++) {
            const a = world.rng.range(0, Math.PI * 2);
            s.pendingSpawns.push({
              type: 'wisp',
              x: clamp(e.x + Math.cos(a) * 70, 20, FIELD.width - 20),
              y: clamp(e.y + Math.sin(a) * 70, 20, FIELD.height - 20),
              t: 0.4,
            });
          }
        }
        break;
      }

      case 'matriarch': {
        const def = ENEMY.matriarch;
        const enraged = e.hp < e.maxHp * def.enrageHpFrac;
        const speed = e.speed * (enraged ? def.enrageSpeedMult : 1);
        e.x += toPlayer.x * speed * dt;
        e.y += toPlayer.y * speed * dt;
        e.burstT -= dt;
        if (e.burstT <= 0) {
          e.burstT = def.burstInterval * (enraged ? def.enrageBurstMult : 1);
          e.spiralA += 0.55;
          for (let i = 0; i < def.burstCount; i++) {
            const a = e.spiralA + (i / def.burstCount) * Math.PI * 2;
            s.orbs.push({
              x: e.x, y: e.y,
              vx: Math.cos(a) * def.orbSpeed, vy: Math.sin(a) * def.orbSpeed,
              radius: 6, dmg: def.orbDamage, t: 5,
            });
          }
          s.fx.push({ kind: 'nova', x: e.x, y: e.y, r: 50 });
        }
        e.summonT -= dt;
        if (e.summonT <= 0) {
          e.summonT = def.summonInterval;
          const alive = s.enemies.filter((x) => x.type === 'splitter').length;
          if (alive < 4) {
            for (let i = 0; i < def.summonCount; i++) {
              const a = world.rng.range(0, Math.PI * 2);
              s.pendingSpawns.push({
                type: 'splitter',
                x: clamp(e.x + Math.cos(a) * 80, 20, FIELD.width - 20),
                y: clamp(e.y + Math.sin(a) * 80, 20, FIELD.height - 20),
                t: 0.4,
              });
            }
          }
        }
        break;
      }

      default:
        e.x += toPlayer.x * e.speed * dt;
        e.y += toPlayer.y * e.speed * dt;
    }
  }

  function separateEnemies() {
    const s = world.state;
    const list = s.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          const aBoss = a.type === 'gloomlord' || a.type === 'matriarch';
          const bBoss = b.type === 'gloomlord' || b.type === 'matriarch';
          if (!aBoss) { a.x -= nx * push; a.y -= ny * push; }
          if (!bBoss) { b.x += nx * push; b.y += ny * push; }
        }
      }
    }
  }

  function pushOutOfPillars(body) {
    const s = world.state;
    for (const pil of s.pillars) {
      const d = dist(body.x, body.y, pil.x, pil.y);
      const min = pil.r + body.radius;
      if (d < min && d > 0.01) {
        const nx = (body.x - pil.x) / d;
        const ny = (body.y - pil.y) / d;
        body.x = pil.x + nx * min;
        body.y = pil.y + ny * min;
      }
    }
  }
}

// The upgrade def map, built once so rollChoices stays allocation-light.
import { UPGRADE_DEFS } from './upgrades.js';
import { RELIC_DEFS } from './relics.js';
import { EVOLUTIONS } from './upgrades.js';

const UPGRADE_DEFS_MAP = {};
for (const d of UPGRADE_DEFS) UPGRADE_DEFS_MAP[d.id] = d;

function evolutionName(id) {
  return (EVOLUTIONS[id] && EVOLUTIONS[id].name) || id.toUpperCase();
}
function evolutionDesc(id) {
  return (EVOLUTIONS[id] && EVOLUTIONS[id].desc) || '';
}
function shrineBoonText(boon) {
  if (boon === 'heal') return 'the shrine mends your wounds (+40 HP)';
  if (boon === 'fury') return 'ember fury — +50% damage for 15s';
  return 'aegis — a shield that absorbs 30 damage';
}
