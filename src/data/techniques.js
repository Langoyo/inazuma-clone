// The 4 confrontation categories. Which named technique a player has in
// each one now comes from that player's own roster entry (src/data/roster.js)
// instead of a shared global catalog — every character can carry a
// different move, just like in the real games.
export const CATEGORIES = ['shot', 'dribble', 'defense', 'keeper'];

// Power of a "normal" action (no SP spent), compared against a
// supertechnique's power in the probability formula.
export const NORMAL_ACTION_POWER = 40;

// Per-player cooldown (ms) after using any supertechnique, before another
// one (of any category) can be used again — on top of the PT cost.
export const TECH_COOLDOWN_MS = 6000;

// Which player stat multiplies power for each category.
export const STAT_FIELD_FOR_TECH = {
  shot: 'shotPower',
  dribble: 'dribblePower',
  defense: 'defensePower',
  keeper: 'keeperPower'
};
