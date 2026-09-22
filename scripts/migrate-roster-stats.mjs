// One-shot migration: replace the roster's five derived stats with the seven
// the games themselves use (Kick / Control / Technique / Pressure / Physical /
// Agility / Intelligence), taken from the zukan.inazuma.jp character dump.
//
// The five we had were computed FROM those seven and the originals thrown
// away, which cost us both fidelity (our numbers matched nothing a player
// could look up) and information (two of the five average in `physical`, so
// the mapping isn't invertible — the seven can't be recovered from what we
// stored, only re-fetched).
//
// Run once, commit the resulting public/roster.json. Not part of the build.
//
//   node scripts/migrate-roster-stats.mjs <path-to-dump.json> [--write]
//
// Without --write it reports what it would do and changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER = path.join(ROOT, 'public/roster.json');

// The scale the five derived stats were stored at: a raw game stat (82-121)
// times this lands near 1.0, which is what the physics/AI code multiplies by.
// Kept as the single normalization constant — the roster now stores the raw
// game numbers and the conversion happens once, at load (see players.js).
const R = 0.0105;

// How the five were built from the seven. Only used here, to re-identify which
// source character each of our players came from (see matching below).
const derive = (s) => ({
  speed: s.agility * R,
  shotPower: s.kick * R,
  dribblePower: ((s.control + s.technique) / 2) * R,
  defensePower: ((s.pressure + s.physical) / 2) * R,
  keeperPower: ((s.intelligence + s.physical) / 2) * R,
});

// The dump's own element names vs. the four this game uses.
const AFFINITY = { Fire: 'Fire', Forest: 'Wood', Wind: 'Air', Mountain: 'Earth' };

const NATIVE = ['kick', 'control', 'technique', 'pressure', 'physical', 'agility', 'intelligence'];

const dumpPath = process.argv[2];
const write = process.argv.includes('--write');
if (!dumpPath) {
  console.error('usage: node scripts/migrate-roster-stats.mjs <dump.json> [--write]');
  process.exit(1);
}

const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

// Index the dump by name. Deliberately NOT by id: our `vr-N` ids drift out of
// alignment with the dump's numeric ids from about vr-262 onward (only 223 of
// 4841 id-matched pairs even share a name), so matching on id would silently
// hand most players another character's stats.
const byName = new Map();
for (const c of dump) {
  if (!c.stats || !NATIVE.every((k) => typeof c.stats[k] === 'number')) continue;
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}

// 185 names appear more than once in the dump (one entry per game a character
// was in), so the name alone isn't enough. Our own stored five ARE the
// fingerprint: recomputing them from a candidate's seven and checking they
// match tells us exactly which entry this player was built from.
const near = (a, b) => Math.abs(a - b) < 0.0006;
const isSource = (ours, cand) => {
  const d = derive(cand.stats);
  return near(ours.speed, d.speed) && near(ours.shotPower, d.shotPower)
    && near(ours.dribblePower, d.dribblePower) && near(ours.defensePower, d.defensePower)
    && near(ours.keeperPower, d.keeperPower);
};

const failures = [];
const resolved = [];
for (const p of roster) {
  const cands = (byName.get(p.name) || []).filter((c) => isSource(p.stats, c));
  // Several entries of the same character can carry identical stats — that's
  // not ambiguity, they all say the same thing. Only genuinely differing
  // candidates are a problem.
  const distinct = new Map(cands.map((c) => [NATIVE.map((k) => c.stats[k]).join(','), c]));
  if (distinct.size !== 1) {
    failures.push(`${p.id} ${p.name} (${p.game}): ${distinct.size} candidatos`);
    continue;
  }
  resolved.push([p, [...distinct.values()][0]]);
}

if (failures.length) {
  console.error(`ABORTADO: ${failures.length} jugadores sin origen único.`);
  failures.slice(0, 20).forEach((f) => console.error('  ' + f));
  process.exit(1);
}

let elementAdded = 0;
let elementChanged = 0;
for (const [p, c] of resolved) {
  p.stats = Object.fromEntries(NATIVE.map((k) => [k, c.stats[k]]));
  const el = AFFINITY[c.affinity];
  if (el) {
    if (!p.element) elementAdded++;
    else if (p.element !== el) elementChanged++;
    p.element = el;
  }
}

console.log(`resueltos      : ${resolved.length}/${roster.length}`);
console.log(`elemento nuevo : ${elementAdded}  | corregido: ${elementChanged}`);
const withEl = roster.filter((p) => p.element).length;
console.log(`cobertura elemento: ${withEl}/${roster.length} (${((100 * withEl) / roster.length).toFixed(1)}%)`);

if (!write) {
  console.log('\n(ensayo — nada escrito; pasa --write para aplicarlo)');
  process.exit(0);
}
fs.writeFileSync(ROSTER, JSON.stringify(roster));
console.log(`\nescrito ${ROSTER}`);
