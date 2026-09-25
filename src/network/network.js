import { joinRoom } from 'trystero/torrent';

// APP_ID identifies your app inside Trystero's public signaling network.
// Change it to something unique when you publish the real game.
const APP_ID = 'inazuma-clone-proto-v1';

// Trystero supports several public signaling backends for the initial
// "how do two anonymous browsers find each other" handshake, before a
// direct WebRTC connection takes over. This used to be Nostr (relays from
// the social-network protocol, repurposed as a message bus) — pinning our
// own relay list there fixed one real outage, but a second real two-player
// test immediately hit a wall of *different* relay failures (502s,
// timeouts, and tellingly, one relay explicitly rejecting the connection
// as "not in our web of trust"). That last one is the real signal: Nostr
// relay operators increasingly lock things down against exactly the
// traffic pattern Trystero produces — anonymous, ephemeral-keypair,
// high-frequency messages that look like bot/spam traffic to anything
// enforcing an identity policy. A different hand-picked relay list was
// never going to fix that, just relocate it.
//
// BitTorrent trackers (this strategy) are purpose-built for the opposite
// of that: anonymously connecting browser peers over WebRTC with no
// identity or trust layer to run afoul of — it's the same signaling job
// WebTorrent and its ecosystem already run in production on. Using
// Trystero's own default tracker list here rather than pinning one of our
// own, same reasoning as before: they're the ones the library's own
// maintainer curates and tests against.

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
  const room = joinRoom({ appId: APP_ID }, roomCode);

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
