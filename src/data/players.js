// A player's in-match state: base stats + technique points (PT) — no
// cooldowns, and no regeneration either. A supertechnique can be used as
// many times as a player can afford from their starting PT; once they're
// out for a category, only the normal action is left for the rest of
// the match (subbing them off is the only way to get a fresh PT pool).
//
// PT and physical condition are now per-player stats too, sourced from the
// roster (each character's own level-99 TP and FP), instead of a flat 100 —
// see applyRosterPlayerToStats. A player with more PT can afford more
// supertechniques over a match; a player with more physical condition
// (stamina) stays fresh for longer before fatigue starts dragging on their
// speed (see FATIGUE_* in GameScene, which drains `stamina` over match time).
export function createPlayerStats(name = 'Player') {
  return {
    name,
    element: null, // Fire / Wood / Air / Earth — see ELEMENT_BEATS in GameScene
    speed: 1,
    shotPower: 1,
    dribblePower: 1,
    defensePower: 1,
    keeperPower: 1,

    maxSP: 100,
    sp: 100,

    maxStamina: 150,
    stamina: 150,
    onPitchSince: 0, // match-clock timestamp this player last took the field — resets their fatigue

    techniques: { shot: null, dribble: null, defense: null, keeper: null },
    techniquesExtra: [] // any further techniques of a category that already has one active (see techniquesFor)
  };
}

export function applyRosterPlayerToStats(stats, rosterPlayer) {
  stats.name = rosterPlayer.nickname || rosterPlayer.name;
  stats.element = rosterPlayer.element || null;
  stats.speed = rosterPlayer.stats.speed;
  stats.shotPower = rosterPlayer.stats.shotPower;
  stats.dribblePower = rosterPlayer.stats.dribblePower;
  stats.defensePower = rosterPlayer.stats.defensePower;
  stats.keeperPower = rosterPlayer.stats.keeperPower;
  stats.techniques = rosterPlayer.techniques;
  stats.techniquesExtra = rosterPlayer.techniquesExtra || [];
  stats.maxSP = rosterPlayer.maxSP || 100;
  stats.sp = stats.maxSP;
  stats.maxStamina = rosterPlayer.maxStamina || 150;
  stats.stamina = stats.maxStamina;
  stats.onPitchSince = 0;
  return stats;
}

/** Every technique this player has for `category` — the one active in the
 * `techniques` slot plus any others of the same category that were sitting
 * unused in `techniquesExtra` (a player with, say, two shot techniques can
 * now pick either one in a confrontation instead of only ever the first). */
export function techniquesFor(stats, category) {
  const list = [];
  if (stats.techniques[category]) list.push(stats.techniques[category]);
  if (stats.techniquesExtra) {
    for (const t of stats.techniquesExtra) if (t.category === category) list.push(t);
  }
  return list;
}

/** Can this player afford at least one of their `category` supertechniques
 * right now? No cooldown — the only gate is whether PT covers its cost. */
export function canActivate(stats, category) {
  return techniquesFor(stats, category).some((t) => stats.sp >= t.cost);
}
