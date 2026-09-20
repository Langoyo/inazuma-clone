import { joinRoom } from 'trystero';

// APP_ID identifies your app inside Trystero's public signaling network.
// Change it to something unique when you publish the real game.
const APP_ID = 'inazuma-clone-proto-v1';

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
