// One-shot migration: give each roster player an `image` field pointing at
// their pixel-art portrait, matched from the same zukan.inazuma.jp dump
// migrate-roster-stats.mjs already pulled the seven native stats from (see
// that script for the fuller backstory).
//
// The portraits arrived named `player_images/{dump id}_{slug}_pixel.png` —
// so this only needs to find, for each of our players, which dump id they
// are, then look up that id's actual filename (not reconstruct it: matching
// the real file on disk sidesteps any slug-format mismatch entirely).
//
// Matching is simpler and exact now, unlike the stats migration's tolerance-
// based fingerprint: since public/roster.json already stores the dump's own
// seven native stats verbatim (that migration copied them across unchanged),
// a player now matches a dump entry by name + EXACT equality on all seven,
// no epsilon needed.
//
// Run once, commit the resulting public/roster.json. Not part of the build.
//
//   node scripts/map-player-images.mjs <path-to-dump.json> [--write]
//
// Without --write it reports what it would do and changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER = path.join(ROOT, 'public/roster.json');
const IMAGES_DIR = path.join(ROOT, 'public/player_images');

const NATIVE = ['kick', 'control', 'technique', 'pressure', 'physical', 'agility', 'intelligence'];

const dumpPath = process.argv[2];
const write = process.argv.includes('--write');
if (!dumpPath) {
  console.error('usage: node scripts/map-player-images.mjs <dump.json> [--write]');
  process.exit(1);
}

const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

// filename -> id, straight off disk, so what we write is always a file that
// genuinely exists — never a guessed-at slug.
const filesById = new Map();
for (const f of fs.readdirSync(IMAGES_DIR)) {
  const m = f.match(/^(\d+)_/);
  if (m) filesById.set(m[1], f);
}

const byName = new Map();
for (const c of dump) {
  if (!c.stats || !NATIVE.every((k) => typeof c.stats[k] === 'number')) continue;
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}
const sameStats = (a, b) => NATIVE.every((k) => a[k] === b[k]);

const failures = [];
const resolved = [];
for (const p of roster) {
  const cands = (byName.get(p.name) || []).filter((c) => sameStats(p.stats, c.stats));
  const distinctIds = [...new Set(cands.map((c) => c.id))];
  if (distinctIds.length === 0) {
    failures.push(`${p.id} ${p.name} (${p.game}): sin candidato`);
    continue;
  }
  // Several dump ids can carry exactly the same stats for one character —
  // recurring cast (Mark Evans, Axel Blaze...) who appear once per game
  // they were in, all maxed out identically. Not a real ambiguity: pick the
  // lowest id, their first/primary entry in the dump's own ordering.
  const id = String(Math.min(...distinctIds));
  const file = filesById.get(id);
  if (!file) {
    failures.push(`${p.id} ${p.name}: id ${id} resuelto pero sin fichero de imagen`);
    continue;
  }
  resolved.push([p, file]);
}

if (failures.length) {
  console.error(`ABORTADO: ${failures.length} jugadores sin imagen resoluble.`);
  failures.slice(0, 20).forEach((f) => console.error('  ' + f));
  process.exit(1);
}

for (const [p, file] of resolved) p.image = `/player_images/${file}`;

console.log(`resueltos: ${resolved.length}/${roster.length}`);

if (!write) {
  console.log('\n(ensayo — nada escrito; pasa --write para aplicarlo)');
  process.exit(0);
}
fs.writeFileSync(ROSTER, JSON.stringify(roster));
console.log(`\nescrito ${ROSTER}`);
