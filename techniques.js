// Supertechnique catalog. Each one is only offered as an option at the
// moment of a confrontation (dribble-vs-tackle duel, or shot-vs-save),
// just like in Inazuma Eleven — not a "free" button you can press anytime.
//
// power     -> how strong the technique is when resolving a confrontation
//              (higher cost = more power — this will get fine-tuned once
//              you share the players/techniques spreadsheet).
// cost      -> skill points (SP) spent when you pick it
// cooldown  -> ms to wait before you can pick it again
export const TECHNIQUES = {
  shot: {
    id: 'shot',
    name: 'Ultimate Shot',
    category: 'shot',
    icon: '⚡',
    cost: 20,
    cooldown: 4000,
    power: 70
  },
  dribble: {
    id: 'dribble',
    name: 'Phantom Dribble',
    category: 'dribble',
    icon: '💨',
    cost: 15,
    cooldown: 3000,
    power: 60
  },
  defense: {
    id: 'defense',
    name: 'Steel Wall',
    category: 'defense',
    icon: '🛡️',
    cost: 15,
    cooldown: 3000,
    power: 60
  },
  keeper: {
    id: 'keeper',
    name: 'Divine Hand',
    category: 'keeper',
    icon: '🧤',
    cost: 15,
    cooldown: 4000,
    power: 65
  }
};

// Power of a "normal" action (no SP spent), compared against a
// supertechnique's power in the probability formula.
export const NORMAL_ACTION_POWER = 40;

// Which player stat multiplies power for each category.
export const STAT_FIELD_FOR_TECH = {
  shot: 'shotPower',
  dribble: 'dribblePower',
  defense: 'defensePower',
  keeper: 'keeperPower'
};
