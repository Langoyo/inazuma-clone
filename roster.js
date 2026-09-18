// Placeholder squad data. These are NOT real Inazuma Eleven characters —
// just made-up names/stats so the team-select and substitution systems
// have something to work with. Swap this file's contents for the real
// roster once you share the spreadsheet (same shape: id, name, position,
// stats, equipped techniques).
export const ROSTER = [
  { id: 'p1', name: 'Ray Fallon', position: 'FW', stats: { speed: 1.2, shotPower: 1.4, dribblePower: 1.1, defensePower: 0.7, keeperPower: 0.6 } },
  { id: 'p2', name: 'Kai Mizumo', position: 'FW', stats: { speed: 1.3, shotPower: 1.1, dribblePower: 1.3, defensePower: 0.8, keeperPower: 0.6 } },
  { id: 'p3', name: 'Theo Vance', position: 'MF', stats: { speed: 1.1, shotPower: 1.0, dribblePower: 1.2, defensePower: 1.0, keeperPower: 0.7 } },
  { id: 'p4', name: 'Nico Alder', position: 'MF', stats: { speed: 1.0, shotPower: 0.9, dribblePower: 1.1, defensePower: 1.1, keeperPower: 0.7 } },
  { id: 'p5', name: 'Bruno Castell', position: 'DF', stats: { speed: 0.9, shotPower: 0.7, dribblePower: 0.8, defensePower: 1.4, keeperPower: 0.8 } },
  { id: 'p6', name: 'Leon Draker', position: 'DF', stats: { speed: 0.8, shotPower: 0.6, dribblePower: 0.7, defensePower: 1.3, keeperPower: 0.9 } },
  { id: 'p7', name: 'Sam Okafor', position: 'GK', stats: { speed: 0.7, shotPower: 0.5, dribblePower: 0.6, defensePower: 0.9, keeperPower: 1.5 } },
  { id: 'p8', name: 'Iris Nakano', position: 'FW', stats: { speed: 1.15, shotPower: 1.25, dribblePower: 1.0, defensePower: 0.7, keeperPower: 0.6 } },
  { id: 'p9', name: 'Marco Elian', position: 'MF', stats: { speed: 1.0, shotPower: 1.0, dribblePower: 1.0, defensePower: 1.0, keeperPower: 0.7 } },
  { id: 'p10', name: 'Owen Frost', position: 'DF', stats: { speed: 0.85, shotPower: 0.65, dribblePower: 0.75, defensePower: 1.35, keeperPower: 0.8 } },
  { id: 'p11', name: 'Diego Salt', position: 'FW', stats: { speed: 1.25, shotPower: 1.3, dribblePower: 1.15, defensePower: 0.65, keeperPower: 0.55 } },
  { id: 'p12', name: 'Yuna Park', position: 'MF', stats: { speed: 1.05, shotPower: 0.95, dribblePower: 1.15, defensePower: 0.95, keeperPower: 0.7 } }
];

export function getPlayerById(id) {
  return ROSTER.find((p) => p.id === id) || null;
}
