// A player's "in-match" state: base stats + SP + technique cooldowns.
// Lives with real authority only on the host; everyone else only sees it
// through the state the host broadcasts.
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

    // one equipped technique per category — fixed for now; the roster
    // spreadsheet will later say exactly which technique each player
    // carries in each slot
    equipped: ['shot', 'dribble', 'defense', 'keeper'],

    // techId -> timestamp (ms) until which it's on cooldown
    cooldowns: {}
  };
}

/** Overwrites a live stats object with a roster player's numbers (used on
 * team selection and on substitutions). SP/cooldowns are reset, as if the
 * player is coming onto the field fresh. */
export function applyRosterPlayerToStats(stats, rosterPlayer) {
  stats.name = rosterPlayer.name;
  stats.speed = rosterPlayer.stats.speed;
  stats.shotPower = rosterPlayer.stats.shotPower;
  stats.dribblePower = rosterPlayer.stats.dribblePower;
  stats.defensePower = rosterPlayer.stats.defensePower;
  stats.keeperPower = rosterPlayer.stats.keeperPower;
  stats.sp = stats.maxSP;
  stats.cooldowns = {};
  return stats;
}

/** Can this player pick supertechnique `tech` right now? */
export function canActivate(stats, tech, now) {
  const cdUntil = stats.cooldowns[tech.id] || 0;
  return stats.sp >= tech.cost && now >= cdUntil;
}
