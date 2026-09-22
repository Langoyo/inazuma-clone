// The 4 confrontation categories. Which named technique a player has in
// each one now comes from that player's own roster entry (src/data/roster.js)
// instead of a shared global catalog — every character can carry a
// different move, just like in the real games.
export const CATEGORIES = ['shot', 'dribble', 'defense', 'keeper'];

// Power of a "normal" action (no SP spent), compared against a
// supertechnique's power in the probability formula (win chance is one side's
// power over the sum of both). Roster techniques run 61–110 power, averaging
// 82, so at 24 a supertechnique beats a normal action roughly 72–82% of the
// time between players of equal ability — spending PT should feel decisive,
// which at the old 40 (a 67% edge for the average move) it didn't. Normal vs
// normal and technique vs technique are untouched: both sides scale together,
// so those stay down to the players' stats.
export const NORMAL_ACTION_POWER = 24;

// Which of the seven native stats multiplies power for each category. These
// used to be four stats of our own that each averaged two natives together;
// going straight to the native one is both truer to the games and sharper,
// since averaging two stats narrows the spread between players.
export const STAT_FIELD_FOR_TECH = {
  shot: 'kick',
  dribble: 'control',
  defense: 'pressure',
  keeper: 'intelligence'
};
