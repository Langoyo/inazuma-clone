import { joinRoom } from 'trystero';

// APP_ID identifies your app inside Trystero's public signaling network.
// Change it to something unique when you publish the real game.
const APP_ID = 'inazuma-clone-proto-v1';

// Trystero's Nostr strategy signals over a handful of public relays picked
// from its own ~25-entry default list — but that pick isn't random per
// session, it's a shuffle *seeded by APP_ID* (see trystero's own
// getRelays/utils.js), so it's the same handful for every single player of
// this game, every time. If any of those happen to be down, expired, or
// blocking unrecognized apps, EVERY match here fails the same way and
// looks like an app bug ("both players confirm and nothing happens") —
// which is exactly what a real two-player session hit: the browser
// console showed one relay's DNS not resolving, another's TLS cert
// expired, and a third explicitly rejecting the connection ("not on
// white-list"). None of that is fixable from application code; the fix is
// to stop relying on Trystero's derived subset and hand it a relay list of
// our own instead — pinned here, easy to update if one of these ever goes
// down too, and reused by any peer running the same client code.
const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://nostr21.com',
];

/**
 * Connects to a P2P "room" using a code shared between the two players
 * (e.g. the URL's ?room=ABCD).
 *
 * Returns:
 *  - selfId: this client's unique id
 *  - isHost(): true if this client should simulate physics (host-authoritative)
 *  - hasPeer(): true if a human opponent is currently connected
 *  - onPeerJoin/onPeerLeave: connection events
 *  - sendInput / onInput: the client sends its movement/shoot/choice intent
 *  - sendState / onState: the host broadcasts the resulting match state
 *  - sendSquad / onSquad: each player sends their chosen starter + bench
 */
export function connectToRoom(roomCode) {
  const room = joinRoom({ appId: APP_ID, relayUrls: RELAY_URLS }, roomCode);

  const [sendInput, onInput] = room.makeAction('input');
  const [sendState, onState] = room.makeAction('state');
  const [sendSquad, onSquad] = room.makeAction('squad');

  const selfId = room.selfId;
  let peerId = null; // the opponent's id, filled in once they connect

  // Host = whichever peer's id sorts first alphabetically between the two.
  // This is deterministic: both browsers reach the same conclusion without
  // needing to negotiate it explicitly. Note this is only "provisional"
  // while peerId is still null — see onPeerConnect below for why callers
  // can't just read it once at page load and assume it's final.
  function isHost() {
    if (!peerId) return true; // alone in the room = provisional host
    return selfId < peerId;
  }

  let externalJoinHandler = null;
  room.onPeerJoin((id) => {
    peerId = id;
    console.log('[net] opponent connected:', id, 'am I host?', isHost());
    // The WebRTC handshake takes real time, so isHost() called right at
    // page load (before either browser knows the other exists) always
    // sees "alone in the room" and both sides provisionally become host —
    // that's fine as a solo-vs-AI default, but wrong the instant a real
    // peer shows up. Let the caller re-derive its role now that peerId is
    // actually known, instead of running the whole match on a stale guess.
    if (externalJoinHandler) externalJoinHandler(id);
  });

  room.onPeerLeave((id) => {
    console.log('[net] opponent disconnected:', id);
    peerId = null;
  });

  /** true if there's no human opponent connected right now (used to trigger the AI) */
  function hasPeer() {
    return peerId !== null;
  }

  /** Fires once, right after a peer's id is known (see isHost's note above). */
  function onPeerConnect(fn) {
    externalJoinHandler = fn;
  }

  return { room, selfId, isHost, hasPeer, onPeerConnect, sendInput, onInput, sendState, onState, sendSquad, onSquad };
}

/** Generates or reads a short room code from the URL (?room=XXXX). */
export function getOrCreateRoomCode() {
  const params = new URLSearchParams(window.location.search);
  let code = params.get('room');
  if (!code) {
    code = Math.random().toString(36).slice(2, 7).toUpperCase();
    params.set('room', code);
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  }
  return code;
}
