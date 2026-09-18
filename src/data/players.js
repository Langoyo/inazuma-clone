// A player's in-match state: base stats + technique points (PT) — no
// cooldowns. A supertechnique can be used as many times as you can
// afford; once you're out of PT for it, only the normal action is left.
// PT regenerates on its own over time, tracked per player.
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
    spRegenPerSec: 4,

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
  return stats;
}

/** Can this player afford their supertechnique for `category` right now?
 * No cooldown — the only gate is whether they have enough PT left. */
export function canActivate(stats, category) {
  const tech = stats.techniques[category];
  if (!tech) return false;
  return stats.sp >= tech.cost;
}
