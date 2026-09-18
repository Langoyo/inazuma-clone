// A player's "in-match" state: base stats + SP + per-category technique
// cooldowns. Lives with real authority only on the host; everyone else
// only sees it through the state the host broadcasts.
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
    spRegenPerSec: 6,

    // { shot: {name, cost, power, cooldown}|null, dribble: ..., defense: ..., keeper: ... }
    // — copied in from the chosen roster player. A null category means
    // this player has no supertechnique there; only "normal" is offered.
    techniques: { shot: null, dribble: null, defense: null, keeper: null },

    // category -> timestamp (ms) until which it's on cooldown
    cooldowns: {}
  };
}

/** Overwrites a live stats object with a roster player's numbers (used on
 * team selection and on substitutions). SP/cooldowns are reset, as if the
 * player is coming onto the field fresh. */
export function applyRosterPlayerToStats(stats, rosterPlayer) {
  stats.name = rosterPlayer.nickname || rosterPlayer.name;
  stats.speed = rosterPlayer.stats.speed;
  stats.shotPower = rosterPlayer.stats.shotPower;
  stats.dribblePower = rosterPlayer.stats.dribblePower;
  stats.defensePower = rosterPlayer.stats.defensePower;
  stats.keeperPower = rosterPlayer.stats.keeperPower;
  stats.techniques = rosterPlayer.techniques;
  stats.sp = stats.maxSP;
  stats.cooldowns = {};
  return stats;
}

/** Can this player pick their supertechnique for `category` right now?
 * Returns false if they have no technique equipped in that category. */
export function canActivate(stats, category, now) {
  const tech = stats.techniques[category];
  if (!tech) return false;
  const cdUntil = stats.cooldowns[category] || 0;
  return stats.sp >= tech.cost && now >= cdUntil;
}
