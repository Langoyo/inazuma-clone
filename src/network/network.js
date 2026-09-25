import { joinRoom } from 'trystero/firebase';

// Trystero supports several public signaling backends for the initial
// "how do two anonymous browsers find each other" handshake, before a
// direct WebRTC connection takes over — the actual match (positions,
// input, 20 times a second) stays direct peer-to-peer either way, this
// only affects that brief up-front handshake. Two public options were
// tried and both failed for real players:
//  - Nostr relays (social-network protocol repurposed as a message bus):
//    pinning our own relay list fixed one real outage, but a second real
//    two-player test hit a wall of *different* relay failures (502s,
//    timeouts, and a relay explicitly rejecting the connection as "not in
//    our web of trust" — a policy block, not downtime).
//  - BitTorrent trackers (purpose-built for anonymous WebRTC peers, no
//    identity layer): still failed to connect for a real player.
// Both are infrastructure we don't control, at the mercy of operators
// increasingly locking down against exactly this traffic pattern
// (anonymous, ephemeral, automated). This uses a Firebase Realtime
// Database project we actually own instead — signaling is just a handful
// of tiny writes per connection (not per frame), well within its free
// tier, and its own console/Data tab is somewhere we can actually see
// what's happening if this ever needs debugging again.
const FIREBASE_DB_URL = 'https://inazuma-showdown-default-rtdb.europe-west1.firebasedatabase.app/';

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
  const room = joinRoom({ appId: FIREBASE_DB_URL }, roomCode);

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
