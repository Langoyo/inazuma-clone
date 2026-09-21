# Inazuma Clone — Prototype

A real-time PvP football game skeleton, styled after Inazuma Eleven,
playable from the browser (mobile and desktop), controlled with the
pointer (mouse or finger), with **peer-to-peer** connectivity between the
two players (no server of its own) using
[Trystero](https://github.com/dmotz/trystero) over WebRTC.

## Try it

```bash
npm install
npm run dev
```

This opens the game at `http://localhost:5173`. To try it with two people:

1. Open that URL, copy the `?room=XXXXX` that appears in the address bar
   and share it with the other player.
2. The other player opens the exact same URL (with the same `room=`).
3. As soon as the two browsers connect over WebRTC, one of them
   automatically becomes the "host" (the one who simulates the match
   physics) and the other the "client" (who only sends their movement
   intent). The code decides this on its own — nobody has to choose.

You can also try it solo by opening the URL in two tabs, or on your
computer plus your phone (using the local IP, thanks to `host: true` in
`vite.config.js`).

## Running the tests

```bash
npm test
```

This runs the Playwright suite in `tests/` against a real browser (it
starts the dev server for you). It covers kickoffs and goal sensors,
drawing/dragging paths and tap-to-pass, the squad editor (formations,
randomizers, pagination), and the AI difficulty ladder.

## How it's organized

- `src/main.js` — boots Phaser and configures the physics engine
  (Matter.js).
- `src/scenes/GameScene.js` — the pitch, the players, the ball, pointer
  control, and the logic for who simulates what (host vs. client).
- `src/network/network.js` — the P2P connection: shared room, host
  election, and the two message channels (`input` and `state`).

## How the network architecture works (summary)

- **Host**: runs the real physics (Matter.js), applies both players'
  inputs, and broadcasts the resulting state (ball and player positions)
  to the opponent about 20 times per second.
- **Client**: doesn't simulate its own physics — it only sends its input
  (which direction it wants to move) and draws whatever the host tells
  it, smoothing movement through interpolation so it doesn't look jumpy.
- Who becomes host is decided by comparing the two peers' IDs (the lower
  one wins) — it's deterministic, so both browsers always reach the same
  conclusion without explicitly negotiating anything.

## Built with

Runtime dependencies:

- **[Phaser 3](https://phaser.io/)** (MIT) — the game framework: canvas
  rendering, the scene/update loop, pointer input and the text objects the
  on-pitch names are drawn with. It bundles
  **[Matter.js](https://brm.io/matter-js/)** (MIT) as its physics engine,
  which is what actually simulates the ball and the players.
- **[Trystero](https://github.com/dmotz/trystero)** (MIT) — the WebRTC
  peer-to-peer layer: room joining, peer discovery and the data channels
  the `input`/`state` messages travel over, so two players connect
  directly without this project running a game server of its own.
- **[nes.css](https://nostalgic-css.github.io/NES.css/)** (MIT) — the
  retro pixel UI kit the HUD, menus and squad editor are built out of.

Build and test tooling:

- **[Vite](https://vite.dev/)** (MIT) — dev server and production bundler.
- **[Playwright](https://playwright.dev/)** (Apache-2.0) — drives a real
  browser for the end-to-end suite in `tests/`.

Exact pinned versions live in `package.json` and `package-lock.json`.

## Data and assets

- **Fonts** — [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P),
  [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) and
  [Jersey 10](https://fonts.google.com/specimen/Jersey+10), loaded from
  Google Fonts under the
  [SIL Open Font License 1.1](https://openfontlicense.org/).
- **Player and team data** (`roster.json`, `teams.json`) — derived from
  the [`AlejandroSuarezCampos/InazumaElevenAPI`](https://github.com/AlejandroSuarezCampos/InazumaElevenAPI)
  project and its own upstream source, `zukan.inazuma.jp` (the
  franchise's official character database). What was taken, what was
  deliberately left alone, and how it was cleaned and recomputed is
  documented in [`CHANGELOG.md`](./CHANGELOG.md). That data is not
  covered by this project's license — see below.

## Everything else

Every feature added, data source processed, bug fixed, and design
decision made along the way — plus the current known limitations and
suggested next steps — lives in [`CHANGELOG.md`](./CHANGELOG.md).

## License

The code in this repository is released under the
[MIT License](./LICENSE) — copyright (c) 2026 Langoyo. Fork it, modify
it, build something else out of it; just keep the copyright notice.

That covers this project's **own source code**. It deliberately does not
extend to:

- The third-party libraries listed above, each of which keeps its own
  license.
- The fonts, which are under the SIL Open Font License.
- **Inazuma Eleven itself.** This is an unofficial, non-commercial fan
  prototype, not affiliated with, authorized by or endorsed by Level-5.
  Character names, team names and the statistics derived from them
  remain the property of their respective owners. None of that is this
  project's to license, and the MIT grant above doesn't attempt to. If
  you fork this or deploy it somewhere, that side of it is yours to
  think about.
