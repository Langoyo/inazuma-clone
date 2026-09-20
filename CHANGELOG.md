# Inazuma Clone — Changelog & Feature Notes

Every feature, data source, bug fix and design decision that went into
this project, roughly in the order it happened. For what the project is
and how to run it, see [`README.md`](./README.md).

## Real teams, horizontal field on PC, passes, numeric PT, formations

### Real teams — finally
You sent me `Inazuma_Eleven_Manager_2026.xlsx`, with one sheet per real
team (Raimon, Royal, Umbrella, Occult, Wild...). It was messy, as warned,
so instead of relying on fixed columns (which move around from sheet to
sheet), I looked for **structural anchors**: every player in a squad has
a row with their name right before a block starting with "Hissatsu",
"Goalkeeping" or "Technical" — that reliably identifies each player's row
no matter which column it's in. Every name found is validated against our
existing roster (so coach names or a "favourite player" mentioned
elsewhere on the sheet don't slip in).

Result: **976 roster players (out of 4986) now have a real team**, across
**49 teams**, each with its **real kit colors** (hex, pulled straight
from the "Kits" section of each sheet — no image analysis needed). The
remaining ~4000 stay without a team (this manager spreadsheet only
covers those 49 specific teams, not the ~9500 characters across every
spin-off).

`public/teams.json` stores the colors for each of the 49 teams, and every
roster player now has `team` and `teamColor` (`null` if no team was
found for them).

### About photos — still don't have them
Neither this spreadsheet nor the previous one ships actual image files,
just text (not even names, in this case). So instead of photos, each
player is told apart by their **real kit color** (or a fixed color per
game if they have no team) plus their **initials**, both on the pick
cards and on the pitch. If you ever get hold of a real image pack (files,
not text paths), let me know and we'll wire it in — the spot for it is
already prepared (`avatarHtml()` in `GameScene.js`).

### Horizontal field on wide screens
When the match loads, if the window is wider than it is tall (like a
computer), the pitch renders horizontally (goals on the left and right);
if it's taller than wide (like a phone in portrait), it renders
vertically as before. This is decided once at load time and doesn't
change if you rotate the screen mid-match.

### Passing: tap to pass, drag to move
- **Dragging** (hold and move your finger/mouse) still draws the path
  the player will follow, as before.
- **Tapping without dragging** (a quick tap, barely any movement) now
  **passes the ball** toward that point, if you have the ball — it sets
  off with real physics, so it may or may not actually reach a teammate
  depending on how it rolls.

### Technique points (PT): numbers, no cooldown, per player
- They were already per player (each of the 11 has their own), but now:
  **shown as a number** ("PT: 62/100") instead of a bar, and **no
  cooldown** — the only thing that matters is whether you still have
  enough points. Once they run out, you simply can't use that
  supertechnique until it regenerates a little (it still recovers slowly
  over time).

### Formations: 4 to choose from, changeable mid-match
Before kickoff you pick a formation (4-4-2, 4-3-3, 4-2-3-1 or 3-5-2) from
the same selection dropdown. During the match there's a **"Formation"**
button to change it on the fly (your players reposition gradually, not
instantly). What I **haven't** done yet is let you manually drag each
player around within the formation — for now it's the 4 fixed presets;
that would be the next step if you're interested.

### 5-player bench, and a randomize button
The bench now has a real cap of 5 (it used to allow more). And there's a
**"🎲 Randomize squad"** button that builds you a full XI + bench +
formation at random from the whole roster (not just the current filter),
in case you want to jump into a match quickly without picking one by one.

## Vertical pitch, 11 players per side, slower pace, and more RPG

### The missing-supertechniques bug — found and fixed
There were two real bugs behind "supertechniques don't show up":

1. **The client (the player who isn't hosting the match) never built
   their team on screen.** `startMatch()` — which creates the 11 bodies,
   their stats and their techniques — was only ever called on the host.
   The client was left with empty `teamA`/`teamB` forever, so any lookup
   of their stats came back with nothing. There's now an equivalent
   function (`buildClientTeams()`) the client runs as soon as it has both
   squads' data (its own and the rival's, which were already being
   exchanged — they just weren't being used for this).
2. **The "active player" kept recalculating during the duel itself.** If
   the player closest to the ball changed while you were choosing your
   action (it could shift due to momentum), the panel looked at the new
   player's stats instead of the one actually in the duel — and if that
   new player had no technique in that category, the button vanished.
   The panel now always uses the IDs that were locked in **at the exact
   moment** the confrontation started, and the "active player" stops
   recalculating while play is frozen for a duel/shot.

### You can now see who won the duel
When a confrontation (duel or shot) resolves, a banner shows on screen
for a couple of seconds ("So-and-so takes the ball", "GOAL! So-and-so
scores with a supertechnique", "Save! The keeper gets it") — it used to
resolve silently with no way to tell what had happened.

### More "pause and decide" than real-time
- Movement (moving players around the pitch) is still real-time, but
  **much slower** — giving you time to think before anything happens.
- As soon as there's a duel (two active players collide) or a shot,
  **play genuinely stops**: nobody moves, and you have up to **20
  seconds** to choose your action (it used to be 1.5s). The panel also
  shows the name of the player involved and their current SP.
- It's resolved by stats + probability, not reflexes — real time is only
  for the "position your players" part.

### Drawn paths are now visible, and you can move several players at once
- The path you draw with your finger/mouse **is drawn on screen** (a
  yellow line) while you trace it and while your player follows it.
- Since all of this is "marking intentions" rather than direct real-time
  control, **you can draw paths for several of your 11 players at
  once**: tap near one of your players to "grab" them and draw their
  path, release, tap near another one of your players and do the same —
  each one follows their own path independently.
- If you tap somewhere not close to any of your players, by default the
  one closest to the ball (the "active" one) moves.

### Match length
Two 3-minute halves (6 minutes total), with an automatic half-time change
(repositions everyone in formation) and a "Full time" screen once the
second half ends, which freezes the match. The scoreboard now also shows
the clock ("1st half — 2:45").

### Vertical pitch
The pitch is no longer landscape — it's vertical (480×760), with one goal
at the top and one at the bottom, like the DS games' screenshots.
`Scale.FIT` in `main.js` still scales this to any screen.

### 11 players per side — but only the one closest to the ball "fights"
You see your 11 players in formation (1-4-3-3) at all times. Whoever is
closest to the ball at any moment is the "active" one (marked with a
white outline) — they're the only one who can take the ball, enter a
duel or shoot; the other 10 hold formation (with a slight shift toward
the ball's side) but don't block or fight yet. Each of the 11 has their
own stats, techniques, SP and cooldowns — nothing is shared between them.
Each team's keeper (the starter marked with the "GK" position) is always
the one who defends shots on goal, whether or not they're the active
player at that moment.

### Squad selection: pick 11, and see what you're bringing
- You pick **11 starters** by tapping each player in the list (a
  "Starters (X/11)" counter). The first GK-position player you add
  becomes the keeper.
- A live **"your team"** panel above the list: the 11 you've picked and
  the bench, each removable with an `×`.
- "Confirm squad" only activates once all 11 slots are filled.
- **"Use this whole team"** fixed: fills your 11 starters (keeper first
  if there's one among the filtered results) plus up to 6 on the bench,
  in one go.
- On "games show up instead of teams": still the same data limitation
  already noted (no spreadsheet has real teams), not a bug — the
  dropdown groups by source game for lack of that column.

### Substitutions with 11 on the pitch
A two-step panel: first you pick who comes off your 11, then who comes
on from the bench. Reversible (whoever comes off goes to the bench). It
now also stays correctly in sync on the client side after a change (it
used to keep the old lineup if you made more than one substitution).

## Real roster: 4986 players, with real techniques (Hissatsu)

You sent me a second spreadsheet
(`Inazuma_Eleven_VR_Document_v3_06...`), much more complete, and with
this I **fully replace** the previous roster (the 9498-player one from
the first spreadsheet) — this one is better at what mattered most:
techniques.

### Why it's better
- It has a **`Hissatsu` sheet with 687 real techniques**: name, type
  (Shoot/Offense/Defense/Keep — mapped to our shot/dribble/defense/keeper
  categories) and, crucially, **an already-computed numeric power**
  (0-100) instead of having to invent one from the cost. No more
  guessing needed.
- The `Characters` sheet lists, for each player, the first 3 techniques
  they learned — I cross-reference these by name against the Hissatsu
  table, and out of **4986 players, 4946 (99%) end up with at least one
  supertechnique** assigned (before, with the other spreadsheet, most GO
  characters ended up with none).
- It covers 8 games, not just 6: besides IE1/IE2/IE3/GO1/GO2/GO3, it
  includes **Ares no Tenbin** (`Ares`, 192 players) and the mobile game
  this spreadsheet itself comes from, **Victory Road** (`VR`, 854
  players).

### How I mapped the stats
This game uses 7 stats per player (Kick, Control, Technique, Pressure,
Physical, Agility, Intelligence) instead of the classic 7 from the DS
games, so I combined them like this:
- `speed` ← Agility
- `shotPower` ← Kick
- `dribblePower` ← average of Control and Technique
- `defensePower` ← average of Pressure and Physical
- `keeperPower` ← average of Physical and Intelligence

All these spreadsheet stats sit around 80-121 (a different scale from
the original games), so I normalize them by dividing by 95 instead of by
60/100 as before.

### Breakdown by game
IE1: 1016 · IE2: 638 · IE3: 622 · GO1: 894 · GO2: 397 · GO3: 373 ·
Ares: 192 · VR: 854.

### Remaining limitation
Each player only brings their **first 3 learned techniques** in this
spreadsheet (not the full 4), so they'll almost never have all 4
categories filled at once — one will usually be missing. There are still
no real teams (same reason as before: the column doesn't exist in either
spreadsheet), so the grouping is still by game.

## The game is now in English

Every piece of text the player sees (HUD, scoreboard, squad-selection
panel, duel/shot panel) is in English. Code comments have also been
moved to English for consistency, in case it's ever shared or pushed to
a public English-language repo.

## Limitations of this skeleton (to improve)

- **Client latency**: the client doesn't simulate its own physics, so
  its player feels slightly delayed relative to the host. Client-side
  prediction (moving instantly on your own screen and reconciling later)
  would fix this, but isn't implemented yet.
- **No anti-cheat**: the host resolves everything (possession, duels,
  shots, transfers/subs), so in theory it could manipulate its own
  client. Fine for playing with friends or prototyping; if the game gets
  genuinely competitive, this same logic needs to move to a real server
  (e.g. with [Colyseus](https://colyseus.io/)).
- **No reconnection**: if the host closes the tab, the match ends.
- **Only the 2 active players actually "fight"**: as explained above, the
  other 20 players on the pitch hold formation but don't block or enter
  duels — it's tactical set dressing, not a full team AI.
- **If the opponent joins right after the AI has already started**: the
  match starts against the AI with its default team; a human who joins
  afterward doesn't get a chance to pick their own team until the next
  match. A rare case, but noted here.
- **No technique visual effects yet**: the duel/shot logic already works
  (SP, cooldown, probability, outcome), but there's no animation or
  flash specific to each technique.
- **~1% of players with no supertechnique at all**: when none of their 3
  known techniques appears in the Hissatsu table with a valid type, they
  end up with none — they'll always get the normal-action option in any
  confrontation.
- **Still no real teams for everyone**: the selector groups by game, not
  by real team (Raimon, Occult, etc.) because the spreadsheet didn't
  carry that column.
- **`roster.json` isn't validated at build time**: if you ever replace it
  by hand and the JSON ends up malformed, the squad-selection screen will
  fail with a visible on-screen error (it's caught and shown), but
  there's no automatic check before that.

## Suggested next steps

1. Get real teams to group the selector by team instead of by game (you
   mentioned this — as soon as you have them, we'll wire it in).
2. Let the other 10 players in formation also enter duels (not just the
   active one) — this would bring the match much closer to a real 11-a-
   side game, but it's a big change over what's there now.
3. Per-technique visual effects (a color flash, a particle on the shot, a
   save animation).
4. Client-side prediction for the client (see the limitation above).
5. More advanced AI: today it's a simple set of rules; difficulty could
   vary based on the opposing player's stats, or more tactical variety
   could be added (pressing, counter-attacks...).

## Level-99 stats: new spreadsheet, more shooting mechanics

You sent me a PDF (`Inazuma_Eleven_level_99_stats.pdf`, a fan compilation
with max-level stats for thousands of characters, in three different
column formats depending on the era) so the roster could reflect those
numbers instead of the ones it already had.

### How I processed it
The PDF has no real tables (it's text with columns aligned by spaces, and
sometimes not even that: two techniques in a row end up glued together
with no space if their columns happen to line up in width). To avoid
guessing blindly:

1. I extracted the ~2841 valid rows with a parser that detects the 3
   column variants (7, 8 or 9 stats depending on the page).
2. To split each player's 4 techniques (sometimes stuck together), I
   built a dictionary out of the **526 technique names that already
   existed** in the roster (with their category — shot/dribble/defense/
   keeper — already correct) and used dictionary-based segmentation (like
   splitting words in a language with no spaces) to cut the text at the
   real names it recognized. This covered 74% of techniques directly.
3. For techniques it didn't recognize, I trained a simple classifier on
   which words predict each category from those same 526 already-labeled
   names (e.g. "hand"/"catch"/"knuckle" → keeper, "slide"/"sumo"/
   "cyclone" → defense), falling back on the player's position if no word
   was conclusive.
4. I matched each PDF row against the roster **by name**. Of the 2841
   rows, 2169 found a player (some PDF names are characters invented by
   the fan compiler, those were left out) — in total **1959 roster
   players (out of 4986) updated** with their real stats, techniques, PT
   and physical condition from this document. The rest keep what they
   already had.

### What changed for each updated player
- **Combat stats**: `shotPower` ← Kick, `dribblePower` ← average of
  Body/Control (or Dribbling/Technique in the newer format),
  `defensePower` ← Guard/Block, `keeperPower` ← Guts/Catch, all
  normalized so the average still sits around 1.0 (same criterion as the
  earlier normalizations), though the range is now a bit wider (0.3–1.8)
  because level 99 brings more genuine variety between characters.
- **4 techniques per player**, not just 1 per category: if two of their
  4 moves fall into the same category, the more powerful one is the one
  usable in a match, and the other is kept in `techniquesExtra` (visible
  in the data, not yet in the player panel) — so the data is complete
  even though combat still uses 1 active supertechnique per category, as
  in the original games.
- **PT (`maxSP`) is now a real per-player stat**, pulled from the
  document's TP column (everyone used to have a fixed 100).
- **Physical condition (`maxStamina`)**, pulled from the FP column — new,
  feeds fatigue (see below).

### Fatigue
Every player now has a physical condition that drains at a fixed rate
throughout the match (regardless of half); only the size of the tank
changes based on their FP. Below 40% of their max, speed starts dropping
gradually down to 55% once it's fully empty. A substitution is the only
way for a player to come back with fresh legs. A new indicator shows next
to PT ("STA: x%", in red when low).

### Shots lose power with distance
A shot near the box comes out at full power; from there, power drops off
gradually down to 45% past ~900px (nearly the length of the pitch). A
penalty is never affected by this (it's always taken from the penalty
spot at whatever power that real distance implies, with no artificial
cap).

### Blocking long shots
If the shot is "from distance" (more than 320px) and there's a rival
defender standing near the straight line between the shooter and the
goal (not the keeper — they're still the last line), a **block**
confrontation triggers before it reaches the keeper: the defender can
spend PT on a defense supertechnique to try to stop it outright. If the
defender wins, the ball is loose at their feet and possession changes. If
the attacker wins, the shot continues on toward the keeper, but with a
further 20% power penalty (it was already weakened by distance, and now
it's grazed a defender too) — it chains automatically into the normal
shot-vs-keeper duel, with its own VS screen.

### Known limitation
The PDF is a fan compilation with variable data quality — characters with
"special"/evolved forms (with heavily stylized technique names, roman
numerals, stray kanji...) sometimes produce a slightly mangled technique
name in the "unrecognized" data (e.g. a broken name fragment). It's a
handful of cases out of nearly 4300 active moves assigned — it doesn't
affect game balance, at most the text shown for the technique's name.

## Picking the rival too, sprint while drawing, PT/stamina on the card, and block requires a supertechnique

- **Rival team selector**: the squad editor now has two tabs, "Your
  Team" and "Rival Team". The rival one comes pre-filled at random (same
  position-aware pick as the 🎲 button) and is only used if you end up
  playing solo against the AI — if a real opponent connects, they always
  pick their own team, and whatever you set here is ignored. You can
  tweak it as much or as little as you like: any gaps you leave get
  filled automatically on confirm.
- **Sprint while drawing a path**: following a drawn path is a
  determined run, so the player now moves 35% faster (and accelerates
  faster to reach that speed) while following the line, instead of
  moving at normal pace.
- **PT and stamina on the player card**: the sheet that opens when you
  double-tap a player (in the squad editor or the in-match team panel)
  now also shows their technique points and physical condition — as
  current/total if the player is already on the pitch in an ongoing
  match, or as their maximum before kickoff.
- **Blocking a shot now requires a supertechnique**: a "normal" block
  never stops the shot — only spending PT on a defense technique can. If
  the defender has no defense technique assigned, or no PT left to pay
  for it, the block screen doesn't even show up (there's nothing to
  decide) and the shot goes straight on toward the keeper, already
  weakened by distance. When they can actually attempt it, the "normal
  action" button disappears from the panel — only their supertechnique is
  offered — to make clear it's the only real option.

## Using any repeated technique, close-range blocking, and the option to do nothing

- **All of a category's techniques are usable, not just the first one**:
  if a player has, say, two shot techniques, a button now shows up for
  each one in the confrontation panel (with its own cost), instead of
  only the one that ended up as "the" technique for that category — the
  others already lived in the data (`techniquesExtra`, see the previous
  section) but couldn't be chosen. The player sheet now also lists all of
  them, not just the first per category.
- **A block can now be attempted from any distance**, even inside the
  box — it used to require the shot to be "from distance".
- **The blocking player can decide to do nothing**: the normal-action
  button no longer disappears from the panel — it's now called "Let it
  through" and still can't stop the shot on its own (only a
  supertechnique can), but it's now a real choice instead of a hidden
  option: useful for saving PT if the player would rather not risk the
  technique at that moment.

## Sprint tied to stamina, live repositioning, lines that don't kink, player/team ratings

- **The sprint while drawing a path is no longer so extreme**, and it now
  scales with stamina: at full physical condition it gives a +18% top
  speed (it used to be +35%, too much), and that extra fades away as the
  player tires until it's completely gone at zero stamina — it's not
  just the general speed cap dropping with fatigue, the sprint boost
  itself does too.
- **Live repositioning**: in the in-match team panel, tapping two pitch
  players (instead of one on the pitch and one on the bench) swaps their
  positions — without resetting their PT or physical condition, since
  unlike a substitution, neither of them is coming on fresh from the
  bench.
- **Fixed the V-shaped-line bug**: if you tapped to draw a line without
  landing exactly on the player (or the tap found nobody nearby and fell
  back to the active player, who could be far away), the first leg of the
  line used to start from the exact point you tapped instead of from
  where the player actually was — so it would first run toward that
  point and then double back toward where you'd actually drawn. The line
  now always starts from the player's real position.
- **Self-drawn "keep running" lines are no longer lines**: when a player
  runs out of your drawn line and keeps going on their own (while the
  team has the ball), that's no longer painted as a yellow line — just a
  faint dot at the destination, so it doesn't get confused with something
  you actually drew.
- **Kickoff stays inside your own half**: at the start of the match,
  after a goal, or at half-time, each team's eleven now always line up
  inside their own half — before, the bias that pulls players toward the
  ball during normal play could leave a forward slightly past the
  halfway line even at kickoff.
- **Player and team rating**: every player now has a rating (30-99)
  computed from their 5 combat stats, visible on their sheet and on the
  player-search cards. The squad editor also shows the average rating of
  the XI you currently have built, next to the "X/11 filled" counter.

## Distinguishing duplicate players, and separating formation from the player list

- **Yes, there were duplicate players**: 157 names (349 cards in total)
  appear more than once in the roster — the same character once per game
  they appeared in (e.g. Mark Evans in IE1 and in Ares), each with their
  own stats. They were already included as separate cards, but since
  they share the same real team ("Raimon", etc.) they looked identical on
  the cards. Now, only for repeated names, the game is added in
  parentheses ("Raimon (IE1)" / "Raimon (Ares)") to tell them apart at a
  glance; every other (non-repeated) player looks the same as before.
- **Separating formation from the player list**: the squad editor used
  to have everything stacked on one long screen. Now there are two extra
  tabs ("📋 Formation" / "🔍 Browse Players") to show only the
  pitch+bench or only the search+list, without having to scroll between
  them. Works the same on the "Your Team" and "Rival Team" tabs.

## Readable player names on the pitch

The text under each player had a 3px black outline over just 7px of
text — almost as thick as the letters themselves, so it read as a black
smudge with a thin white thread through it. It's now plain white with a
soft shadow (instead of a hard outline), which gives just enough contrast
against the grass without eating into the text. Size also went from 7px
to 9px so it reads better at a glance.

## Substitutions that sometimes didn't apply

While testing the previous change I found an intermittent bug:
requesting a player substitution (or a reposition) during a match would
sometimes do nothing, with no visible error. The request was stored in a
one-shot flag the main loop cleared every frame, but it was only
processed if, at that exact instant, there was no confrontation (duel)
happening anywhere on the pitch — something that can start purely by
proximity, unrelated to the substitution. If a duel kicked off in the
very frame the change was due to apply, the request was lost forever.
Substitutions and repositions are now always processed, whatever's
happening with confrontations, so they no longer get dropped.

## Overall speed down another 5%, harder AI, and a combined squad editor

- **Speed**: it still felt too high even after the sprint adjustment, so
  I lowered the general speed cap (affects everyone equally, sprinting or
  not) by another 5% — from 0.72 to 0.684 for the player with the ball/
  active target, and from 0.66 to 0.627 for automatic off-ball movement.
- **"Expert" AI level**: a fourth level added above "Hard", following the
  same philosophy as the others (sharper decisions, not more raw speed) —
  uses supertechniques more often, shoots from further out, pulls the
  trigger almost every time it has an angle, and looks for a pass a
  little more often.
- **Squad editor: pitch and player list at the same time**: the
  "📋 Formation" / "🔍 Browse Players" tabs are no longer mutually
  exclusive — they're now two independent sections that both show by
  default, and each button only collapses its own if you need more
  screen space. With both visible at once you can now tap a player in
  the list and then tap directly on a pitch spot (or the bench) to place
  them there, occupied or not — if the spot already had someone, that
  player drops to the bench (or is dropped from the squad if the bench is
  already full). A note next to the pitch shows who you're placing and
  lets you cancel the selection.

## Player list: sorting, and a full sheet on double-tap

- **Sort**: the squad-building player list now has a sort dropdown —
  Rating (default), Name, Position, or each combat stat (Speed, Shot,
  Dribble, Defense, Keeper) from highest to lowest.
- **List cards now work just like the pitch pins**: before, tapping an
  already-signed player showed their stats instantly (a single tap), and
  tapping an unsigned one placed them directly. Now any card in the
  list — whether already in the squad or not — is selected with a tap
  (just like a pitch or bench pin), a second tap on the same card shows
  the full sheet, and tapping a different card afterward
  swaps/places accordingly. This also lets you swap two starters directly
  from the list, without having to find them on the pitch.

## Possession after a goal, and a bit more room at kickoff

- **Possession after a goal**: scoring used to hand possession to
  "nobody", claimed by whoever touched the ball first at the restart —
  it's now explicitly assigned to the team that conceded, as the real
  kickoff rule states.
- **Halfway-line spacing**: at restarts (kickoff, restart after a goal,
  second half) players can no longer end up stuck on or right against
  the halfway line — a fixed margin is added on each side.

## More real teams, from your player↔team spreadsheet

You sent me `inazuma_eleven_relacion_jugador_equipo.xlsx`: 281 rows with
Saga/Game, Team, Spanish/European Name, Japanese Name and Position,
covering IE1, IE2, IE3 and the GO trilogy. I cross-referenced it by name
against the roster (filtered by each row's game) to extend `team`/
`teamColor` coverage beyond the 976 players that already came from the
earlier manager spreadsheet.

- **Only 140 of the 281 rows found an exact name match.** The other 141
  aren't a matching failure: often it's the same character with a
  different name translation between this sheet and the loaded roster
  ("Timmy Sanders" in your sheet / "Tim Saunders" in the roster; "Johan
  Taran" / "Johan Tassman"), and other times they're disguised-character
  aliases (Occult, Wild Institute) the roster doesn't have registered
  under that name. I tried a "fuzzy" match (by text similarity) to
  rescue these cases and dropped it: it matched names that have nothing
  to do with each other purely by surface resemblance (e.g. "Harry
  Potter" with "Barry Potts"), so I'd rather leave them untouched than
  introduce a wrong data point.
- **52 of those 140 matches already had a different team** saved from the
  earlier manager spreadsheet. I reviewed them one by one: almost all
  were the same real team under a different name format (your sheet
  carries the Japanese name in parentheses: "Royal" already saved / your
  sheet's "Royal Academy (Teikoku)"; "Farm" / "Farm (Senbayama)";
  "Orpheus" / "Orfeo (Italia)"…) — in those cases I kept the existing
  name and color to avoid duplicating the squad editor's team filter.
  When it really was a different team from the storyline (e.g. several
  Raimon players in IE2 mistakenly split across teams that don't fit
  that part of the story, when they were actually kidnapped and playing
  for the "Dark Emperors"), I used the one from your sheet. I verified
  every merge by checking which players each team already had in the
  roster before unifying anything — for example, I ruled out merging
  "Inazuma Japan" with the already-existing "Nihon" after confirming
  they're two completely different squads.
- **11 new teams** that didn't exist in the roster: Chrono Storm, Diamond
  Dust, Earth Eleven, Dark Emperors, Genesis, Inazuma Japan, Prominence,
  Protocol Omega, The Lagoon, Gemini Storm and Epsilon — most are Aliea
  Academy's (IE2) sub-teams and several special teams from the GO
  trilogy. Your sheet doesn't carry colors, so I picked one myself
  (unlike the manager spreadsheet's teams, which did come with real kit
  colors).
- **13 GO-trilogy players appear under more than one team** in your sheet
  (e.g. Arion Sherwind plays for both "Raimon GO" and, later in the
  story, the special team "Chrono Storm"). Since each roster card only
  supports one team, the original card keeps the first one your sheet
  mentions (their base/recognizable team) and I create a **new card** for
  each additional team — same stats and techniques, a different `id`,
  the other team — so now they're selectable under both (or all three)
  teams at once, instead of losing the rest. This produced 8 new cards.
- Every team name stored is in English (or its romanized Japanese name,
  which is how the teams from the manager spreadsheet were already
  stored) — when I use a Spanish name from your sheet here or in chat
  (e.g. "Génesis", "Instituto Zeus") it's only to make clear which row of
  your spreadsheet I mean; the stored data always uses the English name
  ("Genesis", "Zeus").

Result: the roster goes from 4986 to **4994 players** (the 8 new cards
above) and **1056 of them now have a real team**, across **58 teams** in
total (up from 976 of 4986, 49 teams).

## Team filter by era, and the real limit of "Use whole team"

While testing the squad editor with these new teams, you noticed "Zeus"
only offers 5 players to fill 11 — that's not a bug, it's the real limit
of how many players from that specific team are in the database (4 from
IE1 + 1 from IE3): neither your sheet nor the manager spreadsheet brings
the rest of each school's background roster, so "Use whole team" still
can't complete an XI for almost any team — this was already flagged
above, but it's worth repeating here since you just ran into it with a
concrete example.

What I did change: **most real teams (45 of 58) appear across several
games at once** — Raimon, for instance, has players in IE1, IE2, IE3,
GO1, GO2, GO3 and Ares, with completely different squads in each. Before,
picking "Raimon" in the filter mixed all 75 players from every era into
one bag. Now, a team that only appears in one game still shows the same
way (a single option), but one that repeats across several is grouped in
the dropdown under its name, with an "All eras" option (the old
behaviour) plus one per specific era ("IE1 (23)", "GO1 (19)"...) — so you
can ask for just IE1's Raimon instead of the seven-era mix.

## Elements (with an edge in confrontations), and position at a glance

### What came out of the "Ultimate Database" PDF
You sent me `Copy_of_Inazuma_Eleven_Ultimate_Database_Shared_2.pdf` (66
pages, exported from a spreadsheet) to see if it could help fill in
players. It has six distinct sections: the IE1/IE2/IE3 databases (name,
nickname, position, gender, size, **element**, level-1 and level-99
stats, techniques, HEX ID), one for the GO era with Keshin, another with
Japanese names + romanization, and a Spanish one for GO Galaxy with a
"Fichatron" column (where each player signs).

Extracting it had a trick to it: the IE1-IE3 sections draw **every letter
as its own "word"**, so column-based extraction destroys them ("Mark
Evans" comes out as "MEvaarkn s"). For those I pulled from the flat,
reading-order text, where the format is rigid enough to anchor on the
`POS Gender Size Element` sequence to recover each row. The GO sections
extract fine by columns.

What it does **not** add: techniques were already complete (only 4 out
of 4994 players had none), so there was no gap to fill there.

What it **does** add:
- **Element for 3584 of 4994 players** (72%). IE1/IE2/IE3 end up nearly
  complete (1015/1016, 637/639, 621/622) and GO1 almost entirely
  (798/900). The ~1400 still without an element are mostly the ones
  tagged "VR". As a sanity check that the name-matching is correct, the
  **position** the PDF carries matches the roster's in 3661 of 3680
  compared cases (99.5%).
- **A team for 92 more players** (1064 → 1156). The Galaxy section's
  "Fichatron" column carries the team in parentheses (稲妻町 with no
  parentheses is a place, not a team, so only the ones in parentheses are
  used). They're in Japanese, so I only merged the ones I could back up:
  either the roster already tags some of its players with that English
  name, or your earlier spreadsheet already spelled out that same
  Japanese name ("Royal Academy (Teikoku)" for 帝国, "Kirkwood (Kidokawa
  Seishuu)" for 木戸川清修). About ~88 more team names remain in that
  column that the roster doesn't have yet and would need naming in
  English — still pending a decision.
- As a side effect, this partly fixes the issue you saw with Zeus: for
  example **Protocol Omega goes from 4 to 31 players**, and teams able to
  field a full XI (with a keeper) go from 42 to 44.

### Elements with a combat edge
The four elements work in a cycle, as in the games: **Fire → Wood → Air
→ Earth → Fire**, each with an edge over the next (Air is what later
games call Wind/Water, and Earth what they call Electric). When both
players in a confrontation have a known element and one has the edge,
their power is multiplied by **1.15** — a nudge, not a win button: it
turns a 50/50 even confrontation into a 53% win rate, so a good technique
or better stats still decide most of them.

It shows up in two places: the choice panel now shows "🔥 Fire vs 🌿 Wood
▲ advantage" (so you can decide whether spending PT is worth it), and on
the duel-reveal VS cards, with the edge marked in green — so an unusual
result reads as "they had the element" rather than luck.

### Position at a glance
Position already showed on the list cards, but buried in small text, and
it didn't show at all on the pitch pins. There's now a **color badge**
(GK yellow, DF blue, MF green, FW orange) in the corner of every pitch
and bench pin — both in the squad editor and in the in-match team panel —
plus at the start of every card and sheet. On pitch pins, if the player
is standing in a slot that calls for a different position, the badge is
marked red: so a keeper played at center-back is visible at a glance
instead of having to open sheets one by one. Cards and sheets also show
the element now.

### Rating, on the icon too
Every pitch and bench pin now carries the **player's rating** in the
corner opposite the position badge, banded by strength (gold ≥85, silver
≥70, bronze below) so a lineup's weak spots stand out without reading
every number.

## The match pauses when you open "Team", and the panel no longer closes itself

Two fair complaints about the in-match team panel: the match kept
running while you decided, and as soon as you made **one** change the
panel would slam shut, so making two changes meant opening it twice.

- **Pause**: opening "Team" freezes the simulation — Matter stops
  stepping, the clock stops, and `_hostUpdate` skips play. What still
  gets applied are changes made from the panel itself, since those are
  one-shot requests the loop clears every frame regardless (otherwise a
  change made while paused would be lost). On resume, **every absolute
  deadline gets shifted forward** by however long it was paused (the
  confrontation timer, stuns, the result banner), so nothing silently
  expires while you're looking at the bench: verified that a duel
  showing 19.2s still shows 19.4s after a 4s pause, instead of resolving
  itself.
- **Solo only.** With a real opponent connected, it can't pause — that
  would freeze their match too. In that case the panel still opens and
  says so ("▶ Match still running — your opponent is connected"), while
  solo it says "⏸ Match paused".
- **The panel stays open** after a change or a reposition, and
  **refreshes itself** once the substitution actually lands (which
  happens a frame or two later, or over the network if you're the
  client) — it compares a cheap lineup signature and only repaints if it
  changed, not every frame. It closes with its own "Close panel" button,
  which is also where the match resumes.

## Saved squads, duplicate cards removed, and the rest of the Japanese teams

### Saving your squad
Picking an XI out of ~5000 players was work that got thrown away every
time you closed the tab. The editor now has **💾 Save squad / 📂 Load
saved**: it saves your XI, bench and formation to `localStorage` (that
browser only), storing **only ids** — on load they're resolved against
the roster, so if a player is no longer in the data that slot is skipped
and you're notified instead of it breaking. The load button shows how
many you saved ("📂 Load saved (11/11)") and is disabled if nothing's
saved.

### 46 duplicate cards removed
The roster carried repeated characters with **the same game, team, stats
and techniques** ("Arion Sherwind" twice in GO1, "Vladimir Blade" three
times), which showed up as identical cards in the search. Only one of
each survives: 4994 → **4948 cards**. The deliberate clones (the same
player on two different teams) are told apart by the `team` field, so
they survive.

### The rest of the PDF's team column
The ~88 Japanese team names left untouched turned out to be two
different things. **Many were abbreviations of teams we already had** —
(オルフェウス) Orpheus, (Lギガント) Little Gigantes, (Bウェイブス)/(大海原)
Big Waves, (FF帝国) Teikoku → Royal, (白恋) Hakuren → Alpine — and those
reuse the existing name and color instead of filling the filter with
near-duplicates. The rest are genuinely new teams: the katakana ones are
transliterated back (ドラゴンリンク → Dragon Link, デストラクチャーズ →
Destructors) and the kanji school names are romanized (白鹿組 →
Hakushika, 聖堂山 → Seidouzan), which is faithful even if it's not always
the dub's exact wording. Where I had no way to know, I kept the sheet's
own abbreviation (S Wolf, M Tiger) rather than inventing a name.

Result: **1544 players with a team** (up from 1156), **101 teams**, and
the ones able to field a full XI with a keeper go from 44 to **64**. If
any of the names I translated isn't what the dub actually uses, changing
it is a single line in the mapping table.

## The AI difficulty ladder, raised a whole step

You told me "easy" could already be the hard setting, and that the hard
ones needed to be harder still — for example by inflating the
opponent's stats. Both things:

- **The whole ladder moves up**: the old *Hard* (supertechnique 70% of
  the time, shoots from 420) is now **Easy**, and everything above it is
  new ground. *Expert* now uses a supertechnique 97% of the time and
  shoots from 620.
- **Stat inflation** from Normal up, since sharpening decisions alone
  runs out of road once the AI is already taking every chance it gets:
  **Normal +8%, Hard +18%, Expert +30%** to the AI team's combat stats,
  with **half of that bonus applied to movement** (so it's tougher
  one-on-one, not just faster than you).

The multiplier is applied **live, never touching the stored data**: it
only affects side B, and only while nobody is connected to play it, so
switching level or having a human opponent join leaves the roster's
numbers untouched — cards keep showing the real ones.

Verified with two intentionally equal players, both choosing the normal
action: the human's duel win rate drops **55.1% → 53.2% → 51.0% →
48.6%** from Easy to Expert, exactly what the formula predicts (4000
duels per level).

## Proper kickoffs, and a pass into the net is no longer a goal

### The side not kicking off starts further back
Both lines used to stay glued to the halfway line (28px on each side),
so whoever kicked off got closed down before they could play the first
pass. Now the side **without** the ball starts **150px** back — well
clear of the center circle, which has a 60px radius — while the kicking
side stays close to it. The kickoff is properly set up: possession for
whoever's kicking off, an outfield player (never the keeper) standing
over the ball at the center spot, and everyone else lined up in
formation in their own half.

### Each half is kicked off by a different team
The match and the second half used to start with the ball loose at the
center, and whoever got there first won it. There's now a coin toss at
kickoff (`kickoffRole`), and **the other team kicks off the second
half**, as in a real match. Announced with a banner: *"Kick-off"* and
*"Second half"*.

### A pass that goes into the net is no longer a goal
Real goals are always decided by the shot confrontation, which resolves
abstractly and **never physically sends the ball in**. So anything that
reached the goal sensors was a stray pass or a loose ball — and it still
counted as a goal. The most annoying case was a chipped pass, which only
collides with the goal while airborne. The keeper now simply collects it
(goal kick, *"Keeper collects it"* banner) and play continues.

## Random with club players only

New **"🎲 Random (club players)"** button next to the usual random one,
which draws the XI only from the **1544 players with a real team**
instead of the roster's full 4948. These are the ones the original
spreadsheet actually covers, and it shows: the top 10% averages **79
instead of 71**, they carry more techniques (**1.15 extra per player vs.
0.44**), and each one's best technique hits harder (**89.7 vs. 85.8**).
The button acts on whichever tab is currently open, so you can also use
it to build the AI a decent rival. The regular random button is
unchanged.

## New style: retro pixel art (nes.css)

The interface (scoreboard, buttons, panels, chips) had that generic
"made with AI" look — translucent black boxes, rounded corners, default
typography. It now uses **nes.css** (the real library, installed via
npm, not an imitation) with two retro fonts layered on top:

- **Press Start 2P** only on headlines — it's an 8-bit typeface that
  becomes unreadable below ~11px, so reserving it for large text is what
  makes it work.
- **Pixelify Sans** for everything else — buttons, player names, chips —
  a font with pixel-art character that's still designed to stay readable
  at normal UI sizes.
- **Jersey 10** only on the scoreboard (match and full-time screen) — a
  sports-scoreboard numeral typeface, which suits a "0 - 0" better than
  either of the other two.

(I originally used VT323 instead of Pixelify Sans/Jersey 10 — a retro
terminal font, not a genuine pixel-art one. The
[daisyUI trends page on the pixel-art style](https://trends.daisyui.com/trend/pixel-art/)
points to exactly those three typefaces as the right fit for this style,
so it was changed.)

Every button/panel shares the same pixel-corner-cut technique (a tiny
repeating `border-image`, the same one nes.css uses) and a colored inset
shadow acting as a bevel, so the whole page reads as one system — from
the static buttons in the HTML to the ones `GameScene.js` generates at
runtime (player pins, position/rating chips, search-list cards) — without
touching a single line of game logic: the change is entirely CSS.

One real nes.css quirk that's worth flagging: the library ships its own
global rule, `body,pre,code,kbd,samp{font-family:"Press Start 2P"}` — it
assumes you'll load that font for the whole page. Since it loads after
`index.html`'s own `<style>` (Vite injects it at runtime), it won the
specificity tie and was eating our base font and text color. Fixed by
pinning the base font/color/background with `!important` — a deliberate
choice, not a patch, to plant the project's baseline above a third-party
library's global reset.

## Real nes.css buttons, legible cost text, pagination, and less text

Four adjustments from direct feedback looking at the interface on
mobile:

- **Buttons now genuinely use the library's `nes-btn`/`is-primary`/
  `is-success`/`is-warning`/`is-error` classes**, instead of the
  hand-rolled copy that was there before. That copy was missing
  `border-image-outset` (nes.css had it, mine didn't), and on some
  renders that let a solid black edge show through under the pixel
  corner — the "black line inside the button" that looked wrong. Using
  the library's real classes, instead of reinventing them, removes the
  problem at the root. Native buttons with the `disabled` attribute
  (the form ones, not nes.css's own `is-disabled`) get their own
  compatibility rule so they look equally grayed out.

- **The technique cost in PT** used to show in yellow — the same yellow
  as the accent color — on buttons that are now white by default (only
  turning blue once selected), so it was invisible. It's now dark grey
  on white, and only turns gold once the button is selected (blue
  background), where it does contrast.

- **Pagination in the player list.** It used to just cut off at the
  first 120 results with no way to reach anything past that. It's now
  30 per page with Prev/Next buttons; searching, filtering or changing
  the sort order takes you back to page 1 (otherwise a search that
  narrowed the results could leave you stranded on an empty page with no
  clue why).

- **The AI difficulty dropdown** now just says "Easy / Normal / Hard /
  Expert" — the detail of how much each stat goes up still lives in the
  paragraph below it, no need to repeat it in every option.

## Blue marker on pass, and the "line doesn't draw" investigation

**Tapping to pass now leaves a marker.** A blue ring that fades out over
400ms right where you tapped — before, the ball just set off with no
visual confirmation of where the tap had registered.

**On "the player's line doesn't draw, only the final dot shows up":** I
investigated this thoroughly (real drags simulated with Playwright,
checking the point array, the player's physical position and the
`confrontation` state frame by frame) and the draw/follow-a-line system
itself works fine. What I did find, very consistently in testing: **any
duel anywhere on the pitch freezes all 22 players' movement until it
resolves** (on purpose — it's always worked this way, nothing new). With
players constantly moving, especially right after a kickoff, a duel
between two other players triggers very often — and if you're dragging
right when that happens, your line gets drawn but your player doesn't
move until the duel ends, which can read exactly like "it did nothing".
If this keeps happening to you without a "Duel!" banner showing on
screen, it's probably something else — let me know with that detail and
I'll keep looking.

## The "line doesn't draw" bug — actually found

With more detail from you ("it happens after finishing a line,
especially going forward, and going backward it doesn't fail"), I found
the real cause: a race condition in `_computeTargets`.

A short, fast drag that starts right where the player already is
(typical when continuing in the same direction right after finishing the
previous line, since they're still moving that way) can add a point that
falls within `WAYPOINT_RADIUS` of their current position. That point
would get consumed in the very same frame it was drawn — and since the
player still had the ball, the game instantly read it as "the line's
done, keep running on your own", which is exactly the single-dot,
no-line marker. In other words: your new line was being silently
replaced by the "keep running" dot while you were still drawing it.
Going backward rarely triggered it because it implies a longer drag,
which doesn't fit entirely inside that radius.

Fixed: while the player being dragged is still the same one
(`this.drawing && this.selectedPlayerId===e.id`), a line that reaches
zero points no longer auto-upgrades to "keep running" — it just waits
for the next point the ongoing drag adds. Genuine "keep running" (when
you release and the player runs on their own to the end of a line while
still holding the ball) still works exactly as before; I verified this
by forcing the exact race step by step, and separately confirming that
normal case doesn't break.

## Six more formations

From the original 4 (4-4-2, 4-3-3, 4-2-3-1, 3-5-2) to **10**: adding
**4-5-1**, **5-3-2**, **3-4-3**, **4-1-4-1** (holding midfielder + a
banked line of four), **5-4-1** and **4-3-1-2** (a diamond with a
support striker). The Team panel's "Formation" button and the editor's
dropdown pick these up on their own — both read the formation list
instead of having it hardcoded — so nothing else needed to change for
them to show up there.

Each one is 11 coordinates (keeper + defender/midfielder/forward lines)
within the same range the original 4 already used, plus a parallel array
assigning each slot a role (GK/DF/MF/FW) for the rest of the game — the
matching between a "formation slot" and a "real player" doesn't
distinguish a defensive midfielder from an attacking one, so the pivot
in 4-1-4-1 and the support striker in 4-3-1-2 are still plain MF; what
changes from one formation to another is the shape on the pitch, not
that role.

## A real pause at half-time, and a gentler Normal

**The switch to the second half is no longer instant.** When the first
half hits 0:00, both teams line up for the second-half kickoff (whoever
didn't start the first one now kicks off), a **"Half time"** banner
shows, and the match **genuinely freezes** for 3 seconds (physics
stopped, clock held) before kicking off on its own — the half used to
switch instantly, with the kickoff already under way. The banner clears
exactly when play resumes, not a while after: `_setPaused` extends every
active deadline (the duel timer, stuns...) by exactly the length of the
pause, so nothing silently expires while the game is frozen — and
without accounting for that here, it would have made the half-time
banner linger for an extra 3 seconds on top, with the match already
running again.

**Normal difficulty, relaxed.** Only that level was touched (Easy/Hard/
Expert stay the same):

| | before | now |
|---|---|---|
| uses a supertechnique | 80% | 75% |
| shoots from | 470 | 445 |
| shot chance | 80% | 75% |
| pass chance | 2.7% | 2.4% |
| stat inflation | +8% | +4% |

Still a clear step above Easy (which has no inflation at all) and well
below Hard (+18%) — just a gentler step up from Easy now.

## Shorter goals

The net box drawn behind each goal line was 150px deep, which read as
very tall relative to the rest of the pitch. Cut to 90px (about 40%
shorter) — purely visual: the tap-to-shoot hitbox and the goal sensors
are both sized independently of it, so shooting and scoring are
unaffected.

## An actual test suite

All the manual verification done throughout this project — clicking
through the game with Playwright to confirm each fix and feature — is
now a permanent suite instead of throwaway scripts. Run it with `npm
test`.

- `playwright.config.js` boots the real dev server and runs everything
  in a plain desktop-shaped Chromium window. Deliberately **not** one of
  Playwright's mobile device presets (`devices['Pixel 7']` etc.) — those
  set `isMobile`/`hasTouch`, which changes how Chromium dispatches
  `page.mouse.*` calls into touch-style events instead of plain mouse
  ones, breaking every drag-simulation test.
- `src/main.js` exposes `window.__scene` (the live `GameScene`), but only
  behind `import.meta.env.DEV` — Vite inlines that to `false` and
  dead-code-eliminates the whole block for `vite build`, so none of it
  ships to players.
- `tests/kickoff.spec.js` — kickoff shape (defending side starts back,
  the taker is never the keeper), the second half's kickoff swapping
  sides, the half-time pause actually freezing physics and clearing its
  own banner on resume, and the goal-sensor logic (a stray ball into the
  net is the keeper collecting it, not a goal; a real shot confrontation
  still scores).
- `tests/drag-and-pass.spec.js` — a real mouse drag producing a
  multi-point path that survives while still held; a direct regression
  test for the auto-continue race condition described above (reproduces
  the exact mid-drag race by manipulating scene state directly, since
  it's a one-tick timing window no real drag can reliably hit); and the
  tap-to-pass marker appearing and fading out on its own.
- `tests/squad-editor.spec.js` — the club-only randomizer only drawing
  players with a real team, the plain randomizer working over the whole
  roster, player-list pagination (including the reset to page 1 on a new
  search), all ten formations placing exactly 11 pins, and each
  Formation/Browse Players collapse toggle only affecting its own
  section.
- `tests/difficulty.spec.js` — AI stat inflation only ever applying to
  side B and only while nobody's connected to play it, the difficulty
  ladder driving `aiLevel` correctly, and the dropdown showing just the
  plain level names.

A couple of these needed real care to make non-flaky under a loaded
headless browser: reading two related bits of live state (a timer
deadline and "now", or a banner's title and the possession it hands
over) has to happen inside a *single* `page.evaluate`/`waitForFunction`
call — round-tripping between two separate calls leaves a real-time gap
where the match keeps simulating underneath you, which is long enough
for the AI to have already reacted (thrown a pass, moved possession
on) before your second call reads it.

## Fixed: two real players saw completely different matches

Root cause: which side you play (host/'A' vs client/'B') was decided
**once**, synchronously, the instant the scene was created — by comparing
your id against the opponent's. But at that exact moment the WebRTC
handshake hasn't happened yet, so neither browser knows the other exists.
Both independently conclude "I'm alone in the room" and both provisionally
become host. That default is right for solo play (no opponent ever
shows up), but when two people actually open the same room link, both
sides silently keep the stale 'A' verdict for the rest of the session —
so both simulate their own physics as the host, both think they're
controlling the same team, and the two screens diverge into two separate
games from the first kickoff.

Fixed by re-running that comparison once a peer is actually known
(`net.onPeerConnect`, fired right after the real handshake completes),
via a new `_syncRoleFromNet()` that's a no-op once the match has already
kicked off — role still has to stay fixed for a match's whole duration,
it just can no longer be settled on a guess made before the two players
were even talking to each other. Covered by
`tests/networking.spec.js` (a real cross-browser WebRTC handshake isn't
practical to drive from this sandbox, so it exercises the exact fixed
codepath directly: role flips once a peer is detected, and freezes once
`matchStarted` is true).

## Fixed: empty bench spots weren't clickable

Occupied bench pins had a click listener wired up; the empty placeholder
pins never did, so tapping an empty bench slot before it had ever held a
player did nothing — you had to fill a slot some other way first. All
five bench spots now share a `{type:'bench', id:null}` selection (they're
interchangeable, so there's no per-slot id to distinguish them by) and
get the same click handler as occupied ones. Covered by a new
`tests/squad-editor.spec.js` regression test.

## Filled in ~3,400 missing team affiliations, added 161 new teams

`roster.json` had 3,404 players (out of 4,948) with no `team` set at
all — mostly characters who never made it into the
`Inazuma_Eleven_Manager_2026.xlsx` sheets above. The
[`AlejandroSuarezCampos/InazumaElevenAPI`](https://github.com/AlejandroSuarezCampos/InazumaElevenAPI)
project's own source, `zukan.inazuma.jp` (the franchise's official
character database), lists a team for essentially every character —
but that domain is blocked by this sandbox's network egress policy, for
both `curl` and `WebFetch` alike. So the scrape had to happen outside
this environment: I wrote a small scraper (reading the site's own table
header row to find the "Team" column by name, rather than hardcoding an
index the way the API repo's own scraper does — which is why that repo's
JSON has no team field despite the site having the data) and handed it
back as a Colab notebook to run.

Two data-quality issues turned up in what came back:
- The site's team cell holds one badge per team a character has
  played for across the series, and stripping the cell's text with no
  separator ran them together (`"RaimonInazuma National"`,
  `"ProminenceChaos"`, even three- and four-team runs for
  long-running characters). Split back apart with a
  camelCase/digit-boundary regex
  (`(?<=[a-z0-9])(?=[A-Z])`) rather than re-scraping, since the
  concatenation was a fixed, mechanical join and reversible as such.
- Only intentionally scraped `{id, name, team}` — not the site's
  "Description" column, which is the site's own written character
  blurbs (creative text); bulk-copying thousands of those would be a
  different matter entirely from copying team names, which are just
  facts.

The cleaned team names were matched against this project's existing
49-team `teams.json` (exact and fuzzy name matching); 161 were
genuinely new and got added, each with a deterministically-generated
placeholder color (MD5 hash of the team name → HSL hue → hex) rather
than a guessed "real" kit color, since no official color source was
available for them. Result: 4,948/4,948 players now have a team.
Verified against the full Playwright suite (42/42 passing, no
regressions).

## Added 179 players the roster was missing entirely

Comparing our roster's names against `InazumaElevenAPI`'s character
list (see above) turned up 179 real, playable characters — not staff,
coordinators or managers — that never made it into this project at
all (`Zak Wallside`, `Gregory Smith`, `Stewart Vanguard`, and 176
others). Added them using the same stat-conversion formula this
project already uses everywhere else (documented further up this
file): `speed ← Agility`, `shotPower ← Kick`, `dribblePower ←
avg(Control, Technique)`, `defensePower ← avg(Pressure, Physical)`,
`keeperPower ← avg(Physical, Intelligence)`, each scaled by the same
~0.0105 factor — verified against the 4,948 players already in the
roster (matching every one of them to the API by name gives a median
ratio of 0.0105 for all five stats independently, so this isn't a
guessed constant).

Team assignment reused the team-affiliation data already scraped for
the previous entry: 162 of the 179 matched by character id directly,
the other 17 (accented names, a couple of romanization mismatches) by
normalized-name lookup. One genuinely new team turned up in the
process (`Star-Spangled Unicorns`) and got the same
deterministically-generated placeholder color as the 161 added
earlier.

What these 179 don't have, because the API simply doesn't carry it:
real Hissatsu techniques, or a per-player PT/physical-condition
figure. Rather than fabricate technique names or invent numbers,
`techniques` is left all-`null` (same as a handful of other entries
already in the roster) and `maxSP`/`maxStamina` default to 100/150 —
this project's existing fallback for players outside the core
game-by-game data (`game: "VR"`, used already by ~850 other entries).
Verified against the full Playwright suite (40/42 passing — the 2
failures are pre-existing timing-sensitive flakes in
`drag-and-pass.spec.js`/`kickoff.spec.js`, unrelated to roster data,
and pass cleanly in isolation).

## Recomputed every player's combat stats straight from the official source

This project's combat stats were originally derived from
`Inazuma_Eleven_Manager_2026.xlsx`, a fan-made spreadsheet compilation
that needed a fair amount of heuristic reconstruction to use (see
"Real teams — finally" and "Real roster: 4986 players" above:
structural-anchor row detection, a trained classifier for glued-together
technique names, and so on). `InazumaElevenAPI`'s numbers, by contrast,
come straight from `zukan.inazuma.jp` — the games' own official
character database — with no reconstruction step in between. Since
both sources ultimately trace back to the same in-game stats, and the
API's path to them is shorter and cleaner, recomputed every player's 5
combat stats directly from the API's raw 7-stat numbers instead of
keeping the Excel-derived ones.

First re-verified the conversion formula itself, more rigorously than
the original check: restricting to the 5,020 roster players whose name
matches exactly one stats entry in the API (no ambiguity possible),
the actual ratio between our stored stat and the matching raw stat has
a **median of precisely 0.0105 independently for all 5 stats**, with
the spread (std. dev. ~0.0012-0.0016) fully explained by this
project's own 2-3 decimal rounding — not by the two sources
disagreeing. So the formula documented above (`speed ← Agility`,
`shotPower ← Kick`, `dribblePower ← avg(Control,Technique)`,
`defensePower ← avg(Pressure,Physical)`, `keeperPower ←
avg(Physical,Intelligence)`, × 0.0105) was already exactly right —
this is a re-derivation from a cleaner source, not a formula change.

The one real wrinkle: 199 character names have more than one roster
entry (one per game/era they appeared in — Mark Evans in `IE1` and
`Ares`, for instance), and the API can likewise list several stat
blocks under the same name. For 147 of those names every API entry
under that name has identical stats, so which one gets used doesn't
matter. For the other 52 (`Mark Evans`, `Axel Blaze`, `David Samford`,
...) the stat blocks genuinely differ between entries, so each roster
entry needed pairing with the *right* one:
- First tried matching by team: cross-referencing each API entry's
  scraped team list (from the earlier team-affiliation merge) against
  the specific game-version's already-assigned `team` — 66 entries
  resolved this way.
- The rest (41 entries) had no team overlap to go on, so were paired
  by rank instead: sorting that name's roster entries by their
  existing stat average and the API's stat blocks by their raw stat
  average, and matching lowest-to-lowest, highest-to-highest — keeping
  each era's relative characterization (weaker/stronger version) even
  without a definitive source for which numeric block belongs to which
  game.

Net effect: precision improved (3 decimal places throughout, versus a
mix of 2 and 3 before) and a good number of previously-identical
across-game duplicates (like `David Samford`'s stats being byte-for-byte
the same in `IE1`/`IE2`/`Ares`) are now properly differentiated using
each era's real numbers. Nothing else on any player record changed —
techniques, team, PT, stamina all untouched. Verified against the full
Playwright suite (41/42 passing, the one failure being the same
pre-existing `drag-and-pass.spec.js` flake noted above, unrelated to
roster data and passing cleanly on its own).

## Stat displays now show real numbers, not the internal multiplier

The 5 combat stats are stored pre-scaled by that same ~0.0105 factor
so they plug directly into the physics/AI code (a speed multiplier,
a shot-power factor) without any conversion at match time — they're
meant to average around 1.0. But the player-info panel and the
squad-browsing pick cards were printing that raw stored value straight
to the screen (`⚡ Shot 0.94`, `SPD 1.17`), which reads as an arbitrary
decimal rather than a stat. Added `_displayStat()` — undoes the same
scale factor (`v / 0.0105`) purely for these two display spots — so
they now show numbers in the games' own stat range instead (`⚡ Shot
90`, `SPD 111`). Nothing gameplay-facing changed: the stored data and
the physics code that reads it are untouched, this only affects what
gets printed on screen.
