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

## Everything else

Every feature added, data source processed, bug fixed, and design
decision made along the way — plus the current known limitations and
suggested next steps — lives in [`CHANGELOG.md`](./CHANGELOG.md).
