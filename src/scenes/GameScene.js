import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate } from '../data/players.js';
import { loadRoster, getPlayerById, getGames } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';

// --- Field: vertical, like the original games ---
const FIELD_W = 480;
const FIELD_H = 760;
const STATE_HZ = 20;
const GOAL_HALF_WIDTH = 55;
const GOAL_CLICK_MARGIN = 60;   // how close to the goal (in Y) you must tap to "shoot"
const WAYPOINT_RADIUS = 14;
const MIN_PATH_POINT_DIST = 14;
const CONFRONTATION_WINDOW_MS = 1500;
const POSSESSION_OFFSET = 20;
const TEAM_SIZE = 11;

// Slower, more deliberate pace than a first pass at "arcade" felt.
const STEER_FORCE = 0.0011;      // was 0.0025
const FORMATION_STEER_FORCE = 0.0007; // teammates holding shape move a bit lazier
const BASE_MAX_SPEED = 2.6;      // soft speed cap via velocity clamping

// Formation (1-4-3-3), normalized within a team's OWN half, y=0 at their
// own goal line, y=1 at the halfway line. Index 0 is always the keeper slot.
const FORMATION = [
  { x: 0.50, y: 0.07 }, // GK
  { x: 0.16, y: 0.24 }, { x: 0.38, y: 0.20 }, { x: 0.62, y: 0.20 }, { x: 0.84, y: 0.24 }, // DF x4
  { x: 0.25, y: 0.44 }, { x: 0.50, y: 0.40 }, { x: 0.75, y: 0.44 }, // MF x3
  { x: 0.22, y: 0.62 }, { x: 0.50, y: 0.66 }, { x: 0.78, y: 0.62 } // FW x3
];

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    // --- P2P networking ---
    const roomCode = getOrCreateRoomCode();
    document.getElementById('room-code').textContent = roomCode;
    this.net = connectToRoom(roomCode);
    this.role = this.net.isHost() ? 'A' : 'B'; // host = A, client = B, for the whole match

    // --- Field (vertical) ---
    this.add.rectangle(FIELD_W / 2, FIELD_H / 2, FIELD_W, FIELD_H, 0x1e7a3c).setStrokeStyle(4, 0xffffff);
    this.add.line(0, 0, 0, FIELD_H / 2, FIELD_W, FIELD_H / 2, 0xffffff, 0.5).setOrigin(0, 0); // halfway line
    this.add.rectangle(FIELD_W / 2, 10, GOAL_HALF_WIDTH * 2, 6, 0xffffff);
    this.add.rectangle(FIELD_W / 2, FIELD_H - 10, GOAL_HALF_WIDTH * 2, 6, 0xffffff);

    // --- Physics ---
    this.matter.world.setBounds(0, 0, FIELD_W, FIELD_H);
    this.ball = this.matter.add.circle(FIELD_W / 2, FIELD_H / 2, 7, { restitution: 0.7, frictionAir: 0.02, label: 'ball' });
    this.ballGfx = this.add.circle(this.ball.position.x, this.ball.position.y, 7, 0xffffff);

    this.goalTop = this.matter.add.rectangle(FIELD_W / 2, 0, GOAL_HALF_WIDTH * 2, 12, { isSensor: true, isStatic: true, label: 'goalTop' });
    this.goalBottom = this.matter.add.rectangle(FIELD_W / 2, FIELD_H, GOAL_HALF_WIDTH * 2, 12, { isSensor: true, isStatic: true, label: 'goalBottom' });

    this.possessionRing = this.add.circle(0, 0, 15).setStrokeStyle(3, 0xffd966).setFillStyle(0x000000, 0).setVisible(false);

    // --- Teams: filled in once both squads are chosen (startMatch) ---
    this.teamA = []; // [{ id, body, gfx, slot }] x11, role A defends the top goal
    this.teamB = []; // role B defends the bottom goal
    this.statsMapA = new Map(); // rosterId -> in-match stats (SP, cooldowns...)
    this.statsMapB = new Map();
    this.activeIdA = null; // rosterId of whichever of A's 11 is closest to the ball
    this.activeIdB = null;
    this.score = { a: 0, b: 0 };

    this.possessorRole = null;
    this.currentPossession = null;
    this.duelLockUntil = 0;
    this.confrontation = null; // { type, attackerRole, defenderRole, attackerId, defenderId, deadline, attackerChoice, defenderChoice }

    // --- Match doesn't begin until both squads are chosen ---
    this.matchStarted = false;
    this.mySquad = { starterIds: [], benchIds: new Set() };
    this.mySquadConfirmed = false;
    this.mySquadPayload = null;
    this.remoteSquadPayload = null;

    // --- Path drawing with the pointer ---
    this.path = [];
    this.drawing = false;
    this.pendingShootRequest = false;
    this.pendingConfrontationChoice = null;
    this.pendingSubRequest = null; // { outId, inId }
    this.subOutSelection = null;

    this.input.on('pointerdown', (p) => this.handlePointerDown(p));
    this.input.on('pointermove', (p) => { if (p.isDown) this.extendPath(p); });
    this.input.on('pointerup', () => { this.drawing = false; });
    this.input.on('pointerupoutside', () => { this.drawing = false; });

    document.getElementById('conf-normal').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pendingConfrontationChoice = 'normal'; });
    document.getElementById('conf-technique').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pendingConfrontationChoice = 'technique'; });

    document.getElementById('sub-button').addEventListener('click', () => this.openSubPanel());
    document.getElementById('sub-cancel-btn').addEventListener('click', () => { document.getElementById('sub-panel').style.display = 'none'; });

    // --- Team select overlay ---
    this.rosterAll = [];
    document.getElementById('roster-list').innerHTML = '<p style="opacity:0.85;">Loading roster (this can take a moment, it\'s a ~2 MB file)...</p>';
    loadRoster().then((data) => {
      console.log('[roster] loaded', data.length, 'players');
      this.rosterAll = data;
      const gameSelect = document.getElementById('roster-game-filter');
      getGames().forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g; opt.textContent = g;
        gameSelect.appendChild(opt);
      });
      this.renderRosterUI();
    }).catch((err) => {
      console.error('[roster] failed to load:', err);
      document.getElementById('roster-list').innerHTML =
        `<p style="color:#ff8080; font-size:14px; font-weight:bold;">Couldn't load the roster.</p>
         <p style="color:#ffcccc; font-size:12px;">${err.message}</p>
         <p style="color:#ffcccc; font-size:12px;">Check: is <code>public/roster.json</code> present, and are you loading this through a server (not opening the file directly)?</p>`;
    });
    document.getElementById('confirm-squad-btn').addEventListener('click', () => this.confirmSquad());

    // --- Networking callbacks ---
    this.remoteState = null;
    this.remoteInput = { x: FIELD_W / 2, y: FIELD_H / 2 };
    this.net.onInput((data) => { this.remoteInput = data; });
    this.net.onState((data) => this.handleIncomingState(data));
    this.net.onSquad((data) => {
      this.remoteSquadPayload = data;
      if (this.role === 'A' && this.mySquadConfirmed && !this.matchStarted) {
        this.startMatch(this.mySquadPayload, data);
      }
    });

    this.matter.world.on('collisionstart', (event) => this.handleCollisions(event));
    this.lastStateSent = 0;
  }

  // ---------------------------------------------------------------------
  // Team select
  // ---------------------------------------------------------------------

  renderRosterUI() {
    const list = document.getElementById('roster-list');
    const searchInput = document.getElementById('roster-search');
    const gameSelect = document.getElementById('roster-game-filter');
    const wholeTeamBtn = document.getElementById('select-whole-team-btn');
    const countEl = document.getElementById('roster-count');
    const MAX_RENDERED = 150;

    const currentMatches = () => {
      const q = (searchInput.value || '').toLowerCase();
      const game = gameSelect.value;
      return this.rosterAll.filter((p) =>
        (!game || p.game === game) &&
        (!q || p.name.toLowerCase().includes(q) || (p.nickname || '').toLowerCase().includes(q))
      );
    };

    const draw = () => {
      const matches = currentMatches();
      countEl.textContent = matches.length > MAX_RENDERED
        ? `Showing ${MAX_RENDERED} of ${matches.length} matches — search or pick a game to narrow it down`
        : `${matches.length} player${matches.length === 1 ? '' : 's'}`;

      wholeTeamBtn.disabled = !gameSelect.value;
      wholeTeamBtn.title = gameSelect.value ? '' : 'Pick a specific game above first';

      list.innerHTML = '';
      matches.slice(0, MAX_RENDERED).forEach((p) => {
        const isStarter = this.mySquad.starterIds.includes(p.id);
        const isBench = this.mySquad.benchIds.has(p.id);
        const card = document.createElement('div');
        card.className = `roster-card${isStarter ? ' is-starter' : ''}${isBench ? ' is-bench' : ''}`;
        card.dataset.id = p.id;
        const starterFull = this.mySquad.starterIds.length >= TEAM_SIZE && !isStarter;
        card.innerHTML = `
          <div class="name">${p.nickname || p.name}</div>
          <div class="pos">${p.position} · ${p.game}</div>
          <div class="pos">SPD ${p.stats.speed} SHT ${p.stats.shotPower} DRB ${p.stats.dribblePower}</div>
          <div class="row"><button class="starter-btn" ${starterFull ? 'disabled' : ''}>${isStarter ? '✓ In starting 11' : 'Add to starting 11'}</button></div>
          <label><input type="checkbox" class="bench-check" ${isStarter ? 'disabled' : ''} ${isBench ? 'checked' : ''} /> Bench</label>
        `;
        list.appendChild(card);

        card.querySelector('.starter-btn').addEventListener('click', () => {
          if (isStarter) {
            this.mySquad.starterIds = this.mySquad.starterIds.filter((id) => id !== p.id);
          } else if (this.mySquad.starterIds.length < TEAM_SIZE) {
            this.mySquad.starterIds.push(p.id);
            this.mySquad.benchIds.delete(p.id);
          }
          this.refreshSquadUI();
          draw();
        });
        card.querySelector('.bench-check').addEventListener('change', (e) => {
          if (isStarter) { e.target.checked = false; return; }
          if (e.target.checked) this.mySquad.benchIds.add(p.id);
          else this.mySquad.benchIds.delete(p.id);
          this.refreshSquadUI();
        });
      });
    };

    searchInput.addEventListener('input', draw);
    gameSelect.addEventListener('change', draw);
    wholeTeamBtn.addEventListener('click', () => {
      const matches = currentMatches();
      if (!matches.length) return;
      const gk = matches.find((p) => p.position === 'GK');
      const ordered = gk ? [gk, ...matches.filter((p) => p.id !== gk.id)] : matches;
      this.mySquad.starterIds = ordered.slice(0, TEAM_SIZE).map((p) => p.id);
      this.mySquad.benchIds = new Set(ordered.slice(TEAM_SIZE, TEAM_SIZE + 6).map((p) => p.id));
      this.refreshSquadUI();
      draw();
    });

    this.rosterDraw = draw;
    draw();
    this.refreshSquadUI();
  }

  refreshSquadUI() {
    document.getElementById('starter-count').textContent = this.mySquad.starterIds.length;
    const startersEl = document.getElementById('squad-starters');
    startersEl.innerHTML = '';
    this.mySquad.starterIds.forEach((id) => {
      const p = this.rosterAll.find((x) => x.id === id);
      if (!p) return;
      const chip = document.createElement('span');
      chip.className = 'squad-chip';
      chip.innerHTML = `${p.nickname || p.name} (${p.position})<button>×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        this.mySquad.starterIds = this.mySquad.starterIds.filter((sid) => sid !== id);
        this.refreshSquadUI();
        if (this.rosterDraw) this.rosterDraw();
      });
      startersEl.appendChild(chip);
    });

    const benchEl = document.getElementById('squad-bench');
    benchEl.innerHTML = '';
    [...this.mySquad.benchIds].forEach((id) => {
      const p = this.rosterAll.find((x) => x.id === id);
      if (!p) return;
      const chip = document.createElement('span');
      chip.className = 'squad-chip bench-chip';
      chip.innerHTML = `${p.nickname || p.name}<button>×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        this.mySquad.benchIds.delete(id);
        this.refreshSquadUI();
        if (this.rosterDraw) this.rosterDraw();
      });
      benchEl.appendChild(chip);
    });

    document.getElementById('confirm-squad-btn').disabled = this.mySquad.starterIds.length !== TEAM_SIZE;
  }

  confirmSquad() {
    const payload = { starterIds: [...this.mySquad.starterIds], benchIds: [...this.mySquad.benchIds] };
    this.mySquadPayload = payload;
    this.mySquadConfirmed = true;
    this.net.sendSquad(payload);
    document.getElementById('confirm-squad-btn').disabled = true;

    if (this.role === 'A') {
      if (!this.net.hasPeer()) {
        this.startMatch(payload, this.defaultAISquad());
      } else if (this.remoteSquadPayload) {
        this.startMatch(payload, this.remoteSquadPayload);
      } else {
        document.getElementById('squad-status').textContent = 'Waiting for your opponent to pick their squad...';
      }
    } else {
      document.getElementById('squad-status').textContent = 'Waiting for the match to start...';
    }
  }

  defaultAISquad() {
    const pool = this.rosterAll;
    const gk = pool.find((p) => p.position === 'GK');
    const ordered = gk ? [gk, ...pool.filter((p) => p.id !== gk.id)] : pool;
    return {
      starterIds: ordered.slice(0, TEAM_SIZE).map((p) => p.id),
      benchIds: ordered.slice(TEAM_SIZE, TEAM_SIZE + 3).map((p) => p.id)
    };
  }

  // ---------------------------------------------------------------------
  // Match setup
  // ---------------------------------------------------------------------

  buildTeam(role, starterIds) {
    const team = [];
    const map = role === 'A' ? this.statsMapA : this.statsMapB;
    starterIds.forEach((id, slot) => {
      const rosterPlayer = getPlayerById(id);
      if (!rosterPlayer) return;
      const pos = this.formationPosition(role, slot, { x: FIELD_W / 2, y: FIELD_H / 2 });
      const body = this.matter.add.circle(pos.x, pos.y, 9, { frictionAir: 0.1, label: `${role}${slot}` });
      const gfx = this.add.circle(pos.x, pos.y, 9, role === 'A' ? 0x3399ff : 0xff4444);
      team.push({ id, body, gfx, slot });
      const stats = createPlayerStats();
      applyRosterPlayerToStats(stats, rosterPlayer);
      map.set(id, stats);
    });
    return team;
  }

  findGoalkeeperId(starterIds) {
    const found = starterIds.find((id) => {
      const p = getPlayerById(id);
      return p && p.position === 'GK';
    });
    return found || starterIds[0];
  }

  startMatch(payloadA, payloadB) {
    this.teamA = this.buildTeam('A', payloadA.starterIds);
    this.teamB = this.buildTeam('B', payloadB.starterIds);
    this.benchA = (payloadA.benchIds || []).filter((id) => getPlayerById(id));
    this.benchB = (payloadB.benchIds || []).filter((id) => getPlayerById(id));
    this.gkIdA = this.findGoalkeeperId(payloadA.starterIds);
    this.gkIdB = this.findGoalkeeperId(payloadB.starterIds);
    this.activeIdA = this.teamA[0] ? this.teamA[0].id : null;
    this.activeIdB = this.teamB[0] ? this.teamB[0].id : null;
    this.matchStarted = true;
    document.getElementById('team-select-ui').style.display = 'none';
  }

  // Formation slot -> world position. role 'A' defends the top goal (y=0);
  // role 'B' defends the bottom goal (y=FIELD_H) — mirrored vertically.
  formationPosition(role, slot, ballPos) {
    const f = FORMATION[slot] || FORMATION[FORMATION.length - 1];
    const halfH = FIELD_H / 2 - 24;
    let x = f.x * FIELD_W;
    let y = f.y * halfH + 20;
    if (role === 'B') y = FIELD_H - y;
    x += Phaser.Math.Clamp((ballPos.x - FIELD_W / 2) * 0.12, -35, 35);
    return { x, y };
  }

  // ---------------------------------------------------------------------
  // Substitutions
  // ---------------------------------------------------------------------

  openSubPanel() {
    this.subOutSelection = null;
    this.renderSubPanelStep();
    document.getElementById('sub-panel').style.display = 'flex';
  }

  renderSubPanelStep() {
    const title = document.getElementById('sub-panel-title');
    const list = document.getElementById('sub-list');
    list.innerHTML = '';

    const myStarterIds = this.role === 'A'
      ? this.teamA.map((e) => e.id)
      : ((this.remoteState && this.remoteState.starterIds && this.remoteState.starterIds.b) || this.mySquadPayload.starterIds);
    const myBenchIds = this.role === 'A'
      ? this.benchA || []
      : ((this.remoteState && this.remoteState.benchIds && this.remoteState.benchIds.b) || this.mySquadPayload.benchIds || []);

    if (!this.subOutSelection) {
      title.textContent = 'Who comes off?';
      myStarterIds.forEach((id) => {
        const p = getPlayerById(id);
        if (!p) return;
        const card = document.createElement('div');
        card.className = 'roster-card';
        card.innerHTML = `<div class="name">${p.nickname || p.name}</div><div class="pos">${p.position}</div><button class="bring-on-btn">Sub off</button>`;
        card.querySelector('.bring-on-btn').addEventListener('click', () => {
          this.subOutSelection = id;
          this.renderSubPanelStep();
        });
        list.appendChild(card);
      });
    } else {
      title.textContent = 'Who comes on?';
      const bench = myBenchIds.map(getPlayerById).filter(Boolean);
      if (!bench.length) {
        list.innerHTML = '<p>No bench players available.</p>';
        return;
      }
      bench.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'roster-card';
        card.innerHTML = `<div class="name">${p.nickname || p.name}</div><div class="pos">${p.position}</div><button class="bring-on-btn">Bring on</button>`;
        card.querySelector('.bring-on-btn').addEventListener('click', () => {
          this.pendingSubRequest = { outId: this.subOutSelection, inId: p.id };
          document.getElementById('sub-panel').style.display = 'none';
        });
        list.appendChild(card);
      });
    }
  }

  trySub(role, subReq) {
    if (!subReq || !subReq.outId || !subReq.inId) return;
    const team = role === 'A' ? this.teamA : this.teamB;
    const bench = role === 'A' ? this.benchA : this.benchB;
    const map = role === 'A' ? this.statsMapA : this.statsMapB;

    const benchIdx = bench.indexOf(subReq.inId);
    const slotEntry = team.find((t) => t.id === subReq.outId);
    if (benchIdx === -1 || !slotEntry) return;

    const incoming = getPlayerById(subReq.inId);
    if (!incoming) return;

    slotEntry.id = incoming.id;
    const stats = createPlayerStats();
    applyRosterPlayerToStats(stats, incoming);
    map.set(incoming.id, stats);

    bench.splice(benchIdx, 1, subReq.outId); // outgoing player goes to the bench (reversible)

    if (role === 'A' && this.activeIdA === subReq.outId) this.activeIdA = incoming.id;
    if (role === 'B' && this.activeIdB === subReq.outId) this.activeIdB = incoming.id;
    if (role === 'A' && this.gkIdA === subReq.outId) this.gkIdA = incoming.id;
    if (role === 'B' && this.gkIdB === subReq.outId) this.gkIdB = incoming.id;
  }

  // ---------------------------------------------------------------------
  // Input: path drawing and shooting
  // ---------------------------------------------------------------------

  handlePointerDown(pointer) {
    if (!this.matchStarted) return;
    const attackSide = this.role === 'A' ? 'bottom' : 'top';
    if (this.iHavePossession() && this.inGoalRegion(pointer.x, pointer.y, attackSide) && !this.confrontation) {
      this.pendingShootRequest = true;
      return;
    }
    this.drawing = true;
    this.path = [{ x: pointer.x, y: pointer.y }];
  }

  extendPath(pointer) {
    if (!this.drawing) return;
    const last = this.path[this.path.length - 1];
    if (!last || Phaser.Math.Distance.Between(last.x, last.y, pointer.x, pointer.y) > MIN_PATH_POINT_DIST) {
      this.path.push({ x: pointer.x, y: pointer.y });
    }
  }

  inGoalRegion(x, y, side) {
    const withinX = Math.abs(x - FIELD_W / 2) < GOAL_HALF_WIDTH + 30;
    const withinY = side === 'top' ? y < GOAL_CLICK_MARGIN : y > FIELD_H - GOAL_CLICK_MARGIN;
    return withinX && withinY;
  }

  iHavePossession() {
    return this.currentPossession === this.role;
  }

  /** My active player's gfx (the one I'm currently steering). */
  myActiveGfx() {
    const team = this.role === 'A' ? this.teamA : this.teamB;
    const activeId = this.role === 'A' ? this.activeIdA : this.activeIdB;
    const entry = team.find((t) => t.id === activeId);
    return entry ? entry.gfx : null;
  }

  updateMyPathTarget() {
    const gfx = this.myActiveGfx();
    if (!gfx) return { x: FIELD_W / 2, y: FIELD_H / 2 };
    while (this.path.length && Phaser.Math.Distance.Between(gfx.x, gfx.y, this.path[0].x, this.path[0].y) < WAYPOINT_RADIUS) {
      this.path.shift();
    }
    if (this.path.length) return { x: this.path[0].x, y: this.path[0].y };
    return { x: gfx.x, y: gfx.y };
  }

  // ---------------------------------------------------------------------
  // Movement physics
  // ---------------------------------------------------------------------

  steerTowards(body, target, baseSpeed = 1, forceScale = STEER_FORCE) {
    const dx = target.x - body.position.x;
    const dy = target.y - body.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;
    const force = forceScale * baseSpeed;
    this.matter.body.applyForce(body, body.position, { x: (dx / dist) * force, y: (dy / dist) * force });

    const v = body.velocity;
    const speed = Math.hypot(v.x, v.y);
    const maxSpeed = BASE_MAX_SPEED * baseSpeed;
    if (speed > maxSpeed) {
      this.matter.body.setVelocity(body, { x: (v.x / speed) * maxSpeed, y: (v.y / speed) * maxSpeed });
    }
  }

  glueBallToPossessor() {
    if (!this.possessorRole) return;
    const entry = this.activeEntry(this.possessorRole);
    if (!entry) return;
    const body = entry.body;
    const vel = body.velocity;
    const speed = Math.hypot(vel.x, vel.y);
    const dirX = speed > 0.05 ? vel.x / speed : 0;
    const dirY = speed > 0.05 ? vel.y / speed : (this.possessorRole === 'A' ? 1 : -1);
    this.matter.body.setPosition(this.ball, { x: body.position.x + dirX * POSSESSION_OFFSET, y: body.position.y + dirY * POSSESSION_OFFSET });
    this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
  }

  knockback(loserEntry, winnerEntry) {
    const dx = loserEntry.body.position.x - winnerEntry.body.position.x;
    const dy = loserEntry.body.position.y - winnerEntry.body.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.matter.body.setVelocity(loserEntry.body, { x: (dx / dist) * 4, y: (dy / dist) * 4 });
  }

  activeEntry(role) {
    const team = role === 'A' ? this.teamA : this.teamB;
    const activeId = role === 'A' ? this.activeIdA : this.activeIdB;
    return team.find((t) => t.id === activeId) || null;
  }

  /** Recomputes which of a team's 11 is closest to the ball, with a little
   * hysteresis so the active player doesn't flicker between two who are
   * nearly equidistant. */
  updateActivePlayer(role) {
    const team = role === 'A' ? this.teamA : this.teamB;
    if (!team.length) return;
    const ballPos = this.ball.position;
    let best = team[0], bestDist = Phaser.Math.Distance.Between(team[0].body.position.x, team[0].body.position.y, ballPos.x, ballPos.y);
    for (const entry of team) {
      const d = Phaser.Math.Distance.Between(entry.body.position.x, entry.body.position.y, ballPos.x, ballPos.y);
      if (d < bestDist) { bestDist = d; best = entry; }
    }
    const currentId = role === 'A' ? this.activeIdA : this.activeIdB;
    if (best.id !== currentId) {
      const current = team.find((t) => t.id === currentId);
      const currentDist = current ? Phaser.Math.Distance.Between(current.body.position.x, current.body.position.y, ballPos.x, ballPos.y) : Infinity;
      if (currentDist - bestDist > 18) { // only switch if meaningfully closer
        if (role === 'A') this.activeIdA = best.id; else this.activeIdB = best.id;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Collisions (host-authoritative) — only the ACTIVE player of each side
  // meaningfully interacts with the ball/opponent; the other 10 are
  // formation scenery for now (see README for why).
  // ---------------------------------------------------------------------

  handleCollisions(event) {
    if (this.role !== 'A' || !this.matchStarted) return;
    const now = this.time.now;
    const activeA = this.activeEntry('A');
    const activeB = this.activeEntry('B');
    if (!activeA || !activeB) return;

    for (const pair of event.pairs) {
      const labels = [pair.bodyA.label, pair.bodyB.label];
      const bodies = [pair.bodyA, pair.bodyB];

      const touchesBall = labels.includes('ball');
      const activeABody = bodies.includes(activeA.body);
      const activeBBody = bodies.includes(activeB.body);

      if (touchesBall && (activeABody || activeBBody) && !this.possessorRole && !this.confrontation) {
        this.possessorRole = activeABody ? 'A' : 'B';
      }

      if (activeABody && activeBBody && this.possessorRole && !this.confrontation && now >= this.duelLockUntil) {
        const attackerRole = this.possessorRole;
        const defenderRole = attackerRole === 'A' ? 'B' : 'A';
        this.startConfrontation('duel', attackerRole, defenderRole, now);
      }

      if (labels.includes('ball') && labels.includes('goalTop')) this.onGoal('b');
      if (labels.includes('ball') && labels.includes('goalBottom')) this.onGoal('a');
    }
  }

  // ---------------------------------------------------------------------
  // Confrontations: duel (dribble vs tackle) and shot (shot vs save)
  // ---------------------------------------------------------------------

  startConfrontation(type, attackerRole, defenderRole, now) {
    const attackerId = attackerRole === 'A' ? this.activeIdA : this.activeIdB;
    // A shot is defended by the goalkeeper, not whoever happens to be "active".
    const defenderId = type === 'shot'
      ? (defenderRole === 'A' ? this.gkIdA : this.gkIdB)
      : (defenderRole === 'A' ? this.activeIdA : this.activeIdB);
    this.confrontation = {
      type, attackerRole, defenderRole, attackerId, defenderId,
      deadline: now + CONFRONTATION_WINDOW_MS, attackerChoice: null, defenderChoice: null
    };
  }

  aiConfrontationChoice(stats, category, now) {
    if (canActivate(stats, category, now) && Math.random() < 0.55) return 'technique';
    return 'normal';
  }

  tryActivateTechnique(stats, category, now) {
    if (!canActivate(stats, category, now)) return false;
    const tech = stats.techniques[category];
    stats.sp -= tech.cost;
    stats.cooldowns[category] = now + tech.cooldown;
    return true;
  }

  statsFor(role, id) {
    const map = role === 'A' ? this.statsMapA : this.statsMapB;
    return map.get(id);
  }

  resolveConfrontation(now) {
    const c = this.confrontation;
    const attackerStats = this.statsFor(c.attackerRole, c.attackerId);
    const defenderStats = this.statsFor(c.defenderRole, c.defenderId);
    if (!attackerStats || !defenderStats) { this.confrontation = null; return; }

    const attackTechId = c.type === 'duel' ? 'dribble' : 'shot';
    const defendTechId = c.type === 'duel' ? 'defense' : 'keeper';

    const attackerUsedTech = c.attackerChoice === 'technique' && this.tryActivateTechnique(attackerStats, attackTechId, now);
    const defenderUsedTech = c.defenderChoice === 'technique' && this.tryActivateTechnique(defenderStats, defendTechId, now);

    const attackPower = (attackerUsedTech ? attackerStats.techniques[attackTechId].power : NORMAL_ACTION_POWER) * attackerStats[STAT_FIELD_FOR_TECH[attackTechId]];
    const defendPower = (defenderUsedTech ? defenderStats.techniques[defendTechId].power : NORMAL_ACTION_POWER) * defenderStats[STAT_FIELD_FOR_TECH[defendTechId]];
    const attackerWins = Math.random() < attackPower / (attackPower + defendPower);

    if (c.type === 'duel') {
      const attackerEntry = this.activeEntry(c.attackerRole);
      const defenderEntry = this.activeEntry(c.defenderRole);
      if (attackerWins) {
        this.knockback(defenderEntry, attackerEntry);
      } else {
        this.possessorRole = c.defenderRole;
        this.knockback(attackerEntry, defenderEntry);
      }
      this.duelLockUntil = now + 1000;
    } else if (attackerWins) {
      this.onGoal(c.attackerRole === 'A' ? 'a' : 'b');
    } else {
      this.possessorRole = c.defenderRole; // the keeper catches/clears it
    }

    this.confrontation = null;
  }

  onGoal(scorer) {
    this.score[scorer] += 1;
    document.getElementById('scoreboard').textContent = `${this.score.a} - ${this.score.b}`;
    this.possessorRole = null;
    this.matter.body.setPosition(this.ball, { x: FIELD_W / 2, y: FIELD_H / 2 });
    this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
    this.resetFormationPositions();
  }

  resetFormationPositions() {
    const ballPos = { x: FIELD_W / 2, y: FIELD_H / 2 };
    this.teamA.forEach((entry) => {
      const pos = this.formationPosition('A', entry.slot, ballPos);
      this.matter.body.setPosition(entry.body, pos);
      this.matter.body.setVelocity(entry.body, { x: 0, y: 0 });
    });
    this.teamB.forEach((entry) => {
      const pos = this.formationPosition('B', entry.slot, ballPos);
      this.matter.body.setPosition(entry.body, pos);
      this.matter.body.setVelocity(entry.body, { x: 0, y: 0 });
    });
  }

  regenSP(map, deltaMs) {
    for (const stats of map.values()) {
      stats.sp = Math.min(stats.maxSP, stats.sp + stats.spRegenPerSec * (deltaMs / 1000));
    }
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  update(time, delta) {
    const amHost = this.role === 'A';
    const myTarget = this.matchStarted ? this.updateMyPathTarget() : { x: FIELD_W / 2, y: FIELD_H / 2 };

    const myInput = {
      x: myTarget.x, y: myTarget.y,
      shootRequest: this.pendingShootRequest,
      confrontationChoice: this.pendingConfrontationChoice,
      subRequest: this.pendingSubRequest
    };
    this.pendingShootRequest = false;
    this.pendingConfrontationChoice = null;
    this.pendingSubRequest = null;
    this.net.sendInput(myInput);

    if (amHost) {
      if (this.matchStarted) {
        this.updateAsHost(time, delta, myInput);
      } else if (time - this.lastStateSent > 1000 / STATE_HZ) {
        this.lastStateSent = time;
        this.net.sendState({ matchStarted: false });
      }
    } else {
      this.updateAsClient(time);
    }

    if (this.matchStarted) this.updateConfrontationUI(this.confrontation, time);
  }

  updateAsHost(now, delta, myInput) {
    const aiActive = !this.net.hasPeer();
    document.getElementById('ai-badge').style.display = aiActive ? 'block' : 'none';

    let inputB = this.remoteInput;
    if (aiActive) {
      const activeB = this.activeEntry('B');
      const ai = decideAIMove({
        selfPos: activeB ? activeB.body.position : { x: FIELD_W / 2, y: FIELD_H },
        ballPos: this.ball.position,
        ownGoalY: FIELD_H, rivalGoalY: 0
      });
      inputB = { x: ai.target.x, y: ai.target.y, shootRequest: false, confrontationChoice: null, subRequest: null };
    }

    this.regenSP(this.statsMapA, delta);
    this.regenSP(this.statsMapB, delta);
    this.currentPossession = this.possessorRole;

    this.updateActivePlayer('A');
    this.updateActivePlayer('B');

    if (this.confrontation) {
      this.progressConfrontation(now, myInput, inputB, aiActive);
    } else {
      this.moveTeam('A', myInput);
      this.moveTeam('B', inputB);

      if (myInput.shootRequest && this.possessorRole === 'A') {
        this.startConfrontation('shot', 'A', 'B', now);
      } else if (!aiActive && inputB.shootRequest && this.possessorRole === 'B') {
        this.startConfrontation('shot', 'B', 'A', now);
      } else if (aiActive && this.possessorRole === 'B') {
        const activeB = this.activeEntry('B');
        if (activeB && activeB.body.position.y > FIELD_H - 160 && Math.random() < 0.02) {
          this.startConfrontation('shot', 'B', 'A', now);
        }
      }

      if (this.confrontation && this.confrontation.defenderRole === 'B' && aiActive) {
        const defStats = this.statsFor('B', this.confrontation.defenderId);
        this.confrontation.defenderChoice = this.aiConfrontationChoice(defStats, 'keeper', now);
      }

      if (myInput.subRequest) this.trySub('A', myInput.subRequest);
      if (!aiActive && inputB.subRequest) this.trySub('B', inputB.subRequest);
    }

    this.glueBallToPossessor();
    this.syncGfxFromPhysics();
    const myActiveStats = this.statsFor('A', this.activeIdA);
    if (myActiveStats) this.paintHUD(myActiveStats.sp, myActiveStats.cooldowns, now);
    document.getElementById('sub-button').style.display = (this.benchA && this.benchA.length) ? 'block' : 'none';

    if (now - this.lastStateSent > 1000 / STATE_HZ) {
      this.lastStateSent = now;
      const activeAStats = this.statsFor('A', this.activeIdA);
      this.net.sendState({
        matchStarted: true,
        ball: { x: this.ball.position.x, y: this.ball.position.y },
        teamA: this.teamA.map((e) => ({ x: e.body.position.x, y: e.body.position.y })),
        teamB: this.teamB.map((e) => ({ x: e.body.position.x, y: e.body.position.y })),
        activeIdA: this.activeIdA, activeIdB: this.activeIdB,
        score: this.score,
        sp: { a: activeAStats ? activeAStats.sp : 0, b: (this.statsFor('B', this.activeIdB) || {}).sp || 0 },
        cooldowns: { a: activeAStats ? activeAStats.cooldowns : {}, b: (this.statsFor('B', this.activeIdB) || {}).cooldowns || {} },
        possession: this.possessorRole,
        confrontation: this.confrontation
          ? { type: this.confrontation.type, attackerRole: this.confrontation.attackerRole, defenderRole: this.confrontation.defenderRole, deadline: this.confrontation.deadline }
          : null,
        benchIds: { a: this.benchA, b: this.benchB },
        starterIds: { a: this.teamA.map((e) => e.id), b: this.teamB.map((e) => e.id) }
      });
    }
  }

  /** Steers the active player toward `input`, and everyone else toward
   * their formation slot (loosely following the ball). */
  moveTeam(role, input) {
    const team = role === 'A' ? this.teamA : this.teamB;
    const activeId = role === 'A' ? this.activeIdA : this.activeIdB;
    const stats = this.statsFor(role, activeId);
    const baseSpeed = stats ? stats.speed : 1;
    team.forEach((entry) => {
      if (entry.id === activeId) {
        this.steerTowards(entry.body, input, baseSpeed, STEER_FORCE);
      } else {
        const pos = this.formationPosition(role, entry.slot, this.ball.position);
        this.steerTowards(entry.body, pos, 1, FORMATION_STEER_FORCE);
      }
    });
  }

  progressConfrontation(now, myInput, inputB, aiActive) {
    const c = this.confrontation;
    if (myInput.confrontationChoice) {
      if (c.attackerRole === 'A' && c.attackerChoice === null) c.attackerChoice = myInput.confrontationChoice;
      if (c.defenderRole === 'A' && c.defenderChoice === null) c.defenderChoice = myInput.confrontationChoice;
    }
    if (!aiActive && inputB.confrontationChoice) {
      if (c.attackerRole === 'B' && c.attackerChoice === null) c.attackerChoice = inputB.confrontationChoice;
      if (c.defenderRole === 'B' && c.defenderChoice === null) c.defenderChoice = inputB.confrontationChoice;
    }
    if (aiActive) {
      const techForRole = (role) => {
        if (c.type === 'duel') return role === c.attackerRole ? 'dribble' : 'defense';
        return role === c.attackerRole ? 'shot' : 'keeper';
      };
      if (c.attackerRole === 'B' && c.attackerChoice === null) {
        const s = this.statsFor('B', c.attackerId);
        c.attackerChoice = s ? this.aiConfrontationChoice(s, techForRole('B'), now) : 'normal';
      }
      if (c.defenderRole === 'B' && c.defenderChoice === null) {
        const s = this.statsFor('B', c.defenderId);
        c.defenderChoice = s ? this.aiConfrontationChoice(s, techForRole('B'), now) : 'normal';
      }
    }

    const bothChosen = c.attackerChoice !== null && c.defenderChoice !== null;
    if (bothChosen || now >= c.deadline) {
      if (c.attackerChoice === null) c.attackerChoice = 'normal';
      if (c.defenderChoice === null) c.defenderChoice = 'normal';
      this.resolveConfrontation(now);
    }
  }

  handleIncomingState(data) {
    this.remoteState = data;
    if (data.matchStarted && !this.matchStarted) {
      this.matchStarted = true;
      document.getElementById('team-select-ui').style.display = 'none';
    }
  }

  updateAsClient(time) {
    if (!this.remoteState || !this.remoteState.matchStarted) return;
    const lerp = 0.3;

    this.ballGfx.x = Phaser.Math.Linear(this.ballGfx.x, this.remoteState.ball.x, lerp);
    this.ballGfx.y = Phaser.Math.Linear(this.ballGfx.y, this.remoteState.ball.y, lerp);

    this.teamA.forEach((entry, i) => {
      const p = this.remoteState.teamA[i];
      if (!p) return;
      entry.gfx.x = Phaser.Math.Linear(entry.gfx.x, p.x, lerp);
      entry.gfx.y = Phaser.Math.Linear(entry.gfx.y, p.y, lerp);
    });
    this.teamB.forEach((entry, i) => {
      const p = this.remoteState.teamB[i];
      if (!p) return;
      entry.gfx.x = Phaser.Math.Linear(entry.gfx.x, p.x, lerp);
      entry.gfx.y = Phaser.Math.Linear(entry.gfx.y, p.y, lerp);
    });

    this.activeIdA = this.remoteState.activeIdA;
    this.activeIdB = this.remoteState.activeIdB;
    this.highlightActivePlayers();

    document.getElementById('scoreboard').textContent = `${this.remoteState.score.a} - ${this.remoteState.score.b}`;
    this.currentPossession = this.remoteState.possession;
    this.confrontation = this.remoteState.confrontation;

    this.paintHUD(this.remoteState.sp.b, this.remoteState.cooldowns.b, time);
    this.updatePossessionRing();
    const benchB = (this.remoteState.benchIds && this.remoteState.benchIds.b) || [];
    document.getElementById('sub-button').style.display = benchB.length ? 'block' : 'none';
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------

  paintHUD(sp, cooldowns, now) {
    const pct = Math.max(0, Math.min(100, (sp / 100) * 100));
    document.getElementById('sp-bar-fill').style.width = `${pct}%`;
  }

  updateConfrontationUI(confrontation, now) {
    const panel = document.getElementById('confrontation-ui');
    if (!confrontation) { panel.style.display = 'none'; return; }

    const amAttacker = confrontation.attackerRole === this.role;
    const amDefender = confrontation.defenderRole === this.role;
    if (!amAttacker && !amDefender) { panel.style.display = 'none'; return; }

    panel.style.display = 'flex';
    const techId = confrontation.type === 'duel' ? (amAttacker ? 'dribble' : 'defense') : (amAttacker ? 'shot' : 'keeper');

    document.getElementById('confrontation-title').textContent = confrontation.type === 'duel'
      ? (amAttacker ? 'Duel! You\u2019re being tackled' : 'Duel! Go for the tackle')
      : (amAttacker ? 'Shoot for goal!' : 'Save the shot!');
    document.getElementById('conf-normal').textContent = confrontation.type === 'duel'
      ? (amAttacker ? 'Normal dribble' : 'Normal tackle')
      : (amAttacker ? 'Normal shot' : 'Normal save');

    const activeId = this.role === 'A' ? this.activeIdA : this.activeIdB;
    const relevantId = amAttacker
      ? (this.role === 'A' ? this.activeIdA : this.activeIdB)
      : (techId === 'keeper' ? (this.role === 'A' ? this.gkIdA : this.gkIdB) : activeId);
    const stats = this.statsFor(this.role, relevantId);
    const techBtn = document.getElementById('conf-technique');
    const tech = stats ? stats.techniques[techId] : null;
    if (tech) {
      techBtn.style.display = 'block';
      techBtn.innerHTML = `${tech.name}<span class="cost">${tech.cost} SP</span>`;
      techBtn.disabled = !canActivate(stats, techId, now);
    } else {
      techBtn.style.display = 'none';
    }

    const remaining = Math.max(0, confrontation.deadline - now);
    document.getElementById('confrontation-timer-fill').style.width = `${(remaining / CONFRONTATION_WINDOW_MS) * 100}%`;
  }

  syncGfxFromPhysics() {
    this.ballGfx.setPosition(this.ball.position.x, this.ball.position.y);
    this.teamA.forEach((e) => e.gfx.setPosition(e.body.position.x, e.body.position.y));
    this.teamB.forEach((e) => e.gfx.setPosition(e.body.position.x, e.body.position.y));
    this.highlightActivePlayers();
    this.updatePossessionRing();
  }

  /** Gives both teams' currently-active player a thin white outline so
   * it's clear at a glance who you're steering right now. */
  highlightActivePlayers() {
    this.teamA.forEach((e) => e.gfx.setStrokeStyle(e.id === this.activeIdA ? 2 : 0, 0xffffff));
    this.teamB.forEach((e) => e.gfx.setStrokeStyle(e.id === this.activeIdB ? 2 : 0, 0xffffff));
  }

  updatePossessionRing() {
    if (this.currentPossession) {
      const entry = this.activeEntry(this.currentPossession);
      if (entry) { this.possessionRing.setPosition(entry.gfx.x, entry.gfx.y).setVisible(true); return; }
    }
    this.possessionRing.setVisible(false);
  }
}
