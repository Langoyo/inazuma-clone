import { TECH_COOLDOWN_MS } from './techniques.js';

// A player's in-match state: base stats + technique points (PT), which
// regenerate on their own over time, plus a short per-player cooldown after
// using a supertechnique (any category) so they can't be chained instantly
// even when PT is available.
export function createPlayerStats(name = 'Player') {
  return {
    name,
    speed: 1,
    shotPower: 1,
    dribblePower: 1,
    defensePower: 1,
    keeperPower: 1,

    maxSP: 100,
    sp: 100,
    spRegenPerSec: 4, // slow trickle between plays, tracked per player

    cooldownUntil: 0, // timestamp (ms) before which no supertechnique can be used

    techniques: { shot: null, dribble: null, defense: null, keeper: null }
  };
}

export function applyRosterPlayerToStats(stats, rosterPlayer) {
  stats.name = rosterPlayer.nickname || rosterPlayer.name;
  stats.speed = rosterPlayer.stats.speed;
  stats.shotPower = rosterPlayer.stats.shotPower;
  stats.dribblePower = rosterPlayer.stats.dribblePower;
  stats.defensePower = rosterPlayer.stats.defensePower;
  stats.keeperPower = rosterPlayer.stats.keeperPower;
  stats.techniques = rosterPlayer.techniques;
  stats.sp = stats.maxSP;
  stats.cooldownUntil = 0;
  return stats;
}

/** Can this player afford their supertechnique for `category` right now?
 * Gated on both having enough PT AND being past their cooldown from the
 * last supertechnique they used (any category). */
export function canActivate(stats, category, now = 0) {
  const tech = stats.techniques[category];
  if (!tech) return false;
  if (now < (stats.cooldownUntil || 0)) return false;
  return stats.sp >= tech.cost;
}

/** Spend the PT and start the cooldown. Caller must have already checked
 * canActivate(). */
export function activateTechnique(stats, category, now) {
  stats.sp -= stats.techniques[category].cost;
  stats.cooldownUntil = now + TECH_COOLDOWN_MS;
}
