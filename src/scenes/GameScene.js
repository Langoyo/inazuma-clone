import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate } from '../data/players.js';
import { loadRoster, getPlayerById, getGames } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';

const GOAL_HALF_WIDTH = 55;
const GOAL_CLICK_MARGIN = 60;
const WAYPOINT_RADIUS = 14;
const MIN_PATH_POINT_DIST = 14;
const PLAYER_SELECT_RADIUS = 26;
const DRAG_THRESHOLD = 14; // less than this on release = a tap (pass), more = a drag (move)
const CONFRONTATION_WINDOW_MS = 20000;
const RESULT_BANNER_MS = 2200;
const POSSESSION_OFFSET = 20;
const PASS_SPEED = 3.2;
const TEAM_SIZE = 11;
const BENCH_MAX = 5;
const HALF_DURATION_S = 3 * 60;
const STATE_HZ = 20;

const STEER_FORCE = 0.00045;
const FORMATION_STEER_FORCE = 0.00028;
const BASE_MAX_SPEED = 1.15;

// Every formation is 11 slots: index 0 is always the keeper. x = spread
// across the goal line (0..1), y = progress from your own goal line (0)
// towards the halfway line (1) — orientation-independent; see
// formationPosition() for how this maps onto an actual horizontal or
// vertical field.
const FORMATIONS = {
  '4-4-2': [
    { x: 0.50, y: 0.07 },
    { x: 0.15, y: 0.24 }, { x: 0.38, y: 0.20 }, { x: 0.62, y: 0.20 }, { x: 0.85, y: 0.24 },
    { x: 0.15, y: 0.44 }, { x: 0.38, y: 0.42 }, { x: 0.62, y: 0.42 }, { x: 0.85, y: 0.44 },
    { x: 0.35, y: 0.64 }, { x: 0.65, y: 0.64 }
  ],
  '4-3-3': [
    { x: 0.50, y: 0.07 },
    { x: 0.16, y: 0.24 }, { x: 0.38, y: 0.20 }, { x: 0.62, y: 0.20 }, { x: 0.84, y: 0.24 },
    { x: 0.25, y: 0.44 }, { x: 0.50, y: 0.40 }, { x: 0.75, y: 0.44 },
    { x: 0.22, y: 0.62 }, { x: 0.50, y: 0.66 }, { x: 0.78, y: 0.62 }
  ],
  '4-2-3-1': [
    { x: 0.50, y: 0.07 },
    { x: 0.15, y: 0.22 }, { x: 0.38, y: 0.18 }, { x: 0.62, y: 0.18 }, { x: 0.85, y: 0.22 },
    { x: 0.35, y: 0.36 }, { x: 0.65, y: 0.36 },
    { x: 0.20, y: 0.52 }, { x: 0.50, y: 0.50 }, { x: 0.80, y: 0.52 },
    { x: 0.50, y: 0.68 }
  ],
  '3-5-2': [
    { x: 0.50, y: 0.07 },
    { x: 0.25, y: 0.20 }, { x: 0.50, y: 0.18 }, { x: 0.75, y: 0.20 },
    { x: 0.12, y: 0.40 }, { x: 0.32, y: 0.36 }, { x: 0.50, y: 0.34 }, { x: 0.68, y: 0.36 }, { x: 0.88, y: 0.40 },
    { x: 0.38, y: 0.62 }, { x: 0.62, y: 0.62 }
  ]
};
const DEFAULT_FORMATION = '4-4-2';

// Deterministic fallback colors (by game tag) for players whose real team
// kit color we don't have.
const GAME_FALLBACK_COLOR = {
  IE1: 0x3399ff, IE2: 0xff9933, IE3: 0x66cc66, GO1: 0xcc66ff, GO2: 0xff6699, GO3: 0x66cccc, Ares: 0xcccc33, VR: 0x999999
};

function hexToInt(hex) {
  if (!hex) return null;
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? null : n;
}

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    // --- Orientation: horizontal field on a wide/landscape screen, vertical on a narrow one ---
    this.horizontal = window.innerWidth > window.innerHeight;
    this.FIELD_W = this.horizontal ? 760 : 480;
    this.FIELD_H = this.horizontal ? 480 : 760;

    const roomCode = getOrCreateRoomCode();
    document.getElementById('room-code').textContent = roomCode;
    this.net = connectToRoom(roomCode);
    this.role = this.net.isHost() ? 'A' : 'B';

    this.drawField();

    this.pathGraphics = this.add.graphics();

    this.matter.world.setBounds(0, 0, this.FIELD_W, this.FIELD_H);
    this.ball = this.matter.add.circle(this.FIELD_W / 2, this.FIELD_H / 2, 7, { restitution: 0.7, frictionAir: 0.02, label: 'ball' });
    this.ballGfx = this.add.circle(this.ball.position.x, this.ball.position.y, 7, 0xffffff);

    this.drawGoals();

    this.possessionRing = this.add.circle(0, 0, 15).setStrokeStyle(3, 0xffd966).setFillStyle(0x000000, 0).setVisible(false);

    this.teamA = [];
    this.teamB = [];
    this.statsMapA = new Map();
    this.statsMapB = new Map();
    this.activeIdA = null;
    this.activeIdB = null;
    this.score = { a: 0, b: 0 };
    this.clientTeamsBuilt = false;
    this.formation = { A: DEFAULT_FORMATION, B: DEFAULT_FORMATION };
    this.pendingFormationChange = null;

    this.matchClock = { half: 1, secondsRemaining: HALF_DURATION_S, ended: false };

    this.possessorRole = null;
    this.currentPossession = null;
    this.duelLockUntil = 0;
    this.confrontation = null;
    this.confrontationResult = null;

    this.matchStarted = false;
    this.mySquad = { starterIds: [], benchIds: new Set(), formation: DEFAULT_FORMATION };
    this.mySquadConfirmed = false;
    this.mySquadPayload = null;
    this.remoteSquadPayload = null;

    this.myPaths = new Map();
    this.drawing = false;
    this.selectedPlayerId = null;
    this.pendingSelectedPlayerId = null;
    this.gestureStart = null;
    this.gestureMoved = false;
    this.pendingShootRequest = false;
    this.pendingPassTarget = null;
    this.pendingConfrontationChoice = null;
    this.pendingSubRequest = null;
    this.subOutSelection = null;

    this.input.on('pointerdown', (p) => this.handlePointerDown(p));
    this.input.on('pointermove', (p) => { if (p.isDown) this.extendPath(p); });
    this.input.on('pointerup', (p) => this.handlePointerUp(p));
    this.input.on('pointerupoutside', (p) => this.handlePointerUp(p));

    document.getElementById('conf-normal').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pendingConfrontationChoice = 'normal'; });
    document.getElementById('conf-technique').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pendingConfrontationChoice = 'technique'; });

    document.getElementById('sub-button').addEventListener('click', () => this.openSubPanel());
    document.getElementById('sub-cancel-btn').addEventListener('click', () => { document.getElementById('sub-panel').style.display = 'none'; });
    document.getElementById('formation-button').addEventListener('click', () => this.openFormationPanel());
    document.getElementById('formation-cancel-btn').addEventListener('click', () => { document.getElementById('formation-panel').style.display = 'none'; });

    this.rosterAll = [];
    document.getElementById('roster-list').innerHTML = '<p style="opacity:0.85;">Loading roster (this can take a moment, it\'s a ~2 MB file)...</p>';
    loadRoster().then((data) => {
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
        `<p style="color:#ff8080; font-size:14px; font-weight:bold;">Couldn't load the roster.</p><p style="color:#ffcccc; font-size:12px;">${err.message}</p>`;
    });
    document.getElementById('confirm-squad-btn').addEventListener('click', () => this.confirmSquad());

    this.remoteState = null;
    this.remoteInput = { targets: [], shootRequest: false, passTarget: null, confrontationChoice: null, subRequest: null, formationChange: null };
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
  // Field drawing (orientation-aware)
  // ---------------------------------------------------------------------

  drawField() {
    const { FIELD_W: w, FIELD_H: h } = this;
    this.add.rectangle(w / 2, h / 2, w, h, 0x1e7a3c).setStrokeStyle(4, 0xffffff);
    if (this.horizontal) {
      this.add.rectangle(w / 2, h / 2, 1, h, 0xffffff).setAlpha(0.4);
    } else {
      this.add.rectangle(w / 2, h / 2, w, 1, 0xffffff).setAlpha(0.4);
    }
  }

  drawGoals() {
    const { FIELD_W: w, FIELD_H: h } = this;
    if (this.horizontal) {
      this.add.rectangle(10, h / 2, 6, GOAL_HALF_WIDTH * 2, 0xffffff);
      this.add.rectangle(w - 10, h / 2, 6, GOAL_HALF_WIDTH * 2, 0xffffff);
      // "min" goal (x=0) is scored by/attacked by role B, defended by role A
      this.goalMin = this.matter.add.rectangle(0, h / 2, 12, GOAL_HALF_WIDTH * 2, { isSensor: true, isStatic: true, label: 'goalMin' });
      this.goalMax = this.matter.add.rectangle(w, h / 2, 12, GOAL_HALF_WIDTH * 2, { isSensor: true, isStatic: true, label: 'goalMax' });
    } else {
      this.add.rectangle(w / 2, 10, GOAL_HALF_WIDTH * 2, 6, 0xffffff);
      this.add.rectangle(w / 2, h - 10, GOAL_HALF_WIDTH * 2, 6, 0xffffff);
      this.goalMin = this.matter.add.rectangle(w / 2, 0, GOAL_HALF_WIDTH * 2, 12, { isSensor: true, isStatic: true, label: 'goalMin' });
      this.goalMax = this.matter.add.rectangle(w / 2, h, GOAL_HALF_WIDTH * 2, 12, { isSensor: true, isStatic: true, label: 'goalMax' });
    }
  }

  primaryAxis() { return this.horizontal ? 'x' : 'y'; }
  secondaryAxis() { return this.horizontal ? 'y' : 'x'; }
  primarySize() { return this.horizontal ? this.FIELD_W : this.FIELD_H; }
  secondarySize() { return this.horizontal ? this.FIELD_H : this.FIELD_W; }

  // ---------------------------------------------------------------------
  // Team select
  // ---------------------------------------------------------------------

  playerColor(rosterPlayer, fallbackHex) {
    const hex = rosterPlayer && rosterPlayer.teamColor ? hexToInt(rosterPlayer.teamColor) : null;
    if (hex !== null) return hex;
    if (rosterPlayer && GAME_FALLBACK_COLOR[rosterPlayer.game] !== undefined) return GAME_FALLBACK_COLOR[rosterPlayer.game];
    return fallbackHex;
  }

  avatarHtml(p) {
    const hex = p.teamColor || '#888888';
    const initials = (p.nickname || p.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="avatar" style="background:${hex};">${initials}</span>`;
  }

  renderRosterUI() {
    const list = document.getElementById('roster-list');
    const searchInput = document.getElementById('roster-search');
    const gameSelect = document.getElementById('roster-game-filter');
    const wholeTeamBtn = document.getElementById('select-whole-team-btn');
    const randomizeBtn = document.getElementById('randomize-squad-btn');
    const formationSelect = document.getElementById('formation-select');
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
        const benchFull = this.mySquad.benchIds.size >= BENCH_MAX && !isBench;
        const card = document.createElement('div');
        card.className = `roster-card${isStarter ? ' is-starter' : ''}${isBench ? ' is-bench' : ''}`;
        card.dataset.id = p.id;
        const starterFull = this.mySquad.starterIds.length >= TEAM_SIZE && !isStarter;
        card.innerHTML = `
          <div class="name-row">${this.avatarHtml(p)}<div class="name">${p.nickname || p.name}</div></div>
          <div class="pos">${p.position} · ${p.team || p.game}</div>
          <div class="pos">SPD ${p.stats.speed} SHT ${p.stats.shotPower} DRB ${p.stats.dribblePower}</div>
          <div class="row"><button class="starter-btn" ${starterFull ? 'disabled' : ''}>${isStarter ? '✓ In starting 11' : 'Add to starting 11'}</button></div>
          <label><input type="checkbox" class="bench-check" ${isStarter ? 'disabled' : ''} ${benchFull ? 'disabled' : ''} ${isBench ? 'checked' : ''} /> Bench (${this.mySquad.benchIds.size}/${BENCH_MAX})</label>
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
          if (e.target.checked) {
            if (this.mySquad.benchIds.size < BENCH_MAX) this.mySquad.benchIds.add(p.id);
            else e.target.checked = false;
          } else {
            this.mySquad.benchIds.delete(p.id);
          }
          this.refreshSquadUI();
          draw();
        });
      });
    };

    searchInput.addEventListener('input', draw);
    gameSelect.addEventListener('change', draw);
    formationSelect.addEventListener('change', () => { this.mySquad.formation = formationSelect.value; });

    wholeTeamBtn.addEventListener('click', () => {
      const matches = currentMatches();
      if (!matches.length) return;
      const gk = matches.find((p) => p.position === 'GK');
      const ordered = gk ? [gk, ...matches.filter((p) => p.id !== gk.id)] : matches;
      this.mySquad.starterIds = ordered.slice(0, TEAM_SIZE).map((p) => p.id);
      this.mySquad.benchIds = new Set(ordered.slice(TEAM_SIZE, TEAM_SIZE + BENCH_MAX).map((p) => p.id));
      this.refreshSquadUI();
      draw();
    });

    randomizeBtn.addEventListener('click', () => {
      const pool = [...this.rosterAll];
      Phaser.Utils.Array.Shuffle(pool);
      const gk = pool.find((p) => p.position === 'GK');
      const rest = pool.filter((p) => !gk || p.id !== gk.id);
      const starters = gk ? [gk, ...rest.slice(0, TEAM_SIZE - 1)] : rest.slice(0, TEAM_SIZE);
      const bench = rest.slice(starters.length - (gk ? 1 : 0), starters.length - (gk ? 1 : 0) + BENCH_MAX);
      this.mySquad.starterIds = starters.map((p) => p.id);
      this.mySquad.benchIds = new Set(bench.map((p) => p.id));
      const formations = Object.keys(FORMATIONS);
      this.mySquad.formation = Phaser.Utils.Array.GetRandom(formations);
      formationSelect.value = this.mySquad.formation;
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
      chip.innerHTML = `${this.avatarHtml(p)}${p.nickname || p.name} (${p.position})<button>×</button>`;
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
      chip.innerHTML = `${this.avatarHtml(p)}${p.nickname || p.name}<button>×</button>`;
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
    const payload = { starterIds: [...this.mySquad.starterIds], benchIds: [...this.mySquad.benchIds], formation: this.mySquad.formation };
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
      benchIds: ordered.slice(TEAM_SIZE, TEAM_SIZE + 3).map((p) => p.id),
      formation: DEFAULT_FORMATION
    };
  }

  // ---------------------------------------------------------------------
  // Match setup
  // ---------------------------------------------------------------------

  buildTeam(role, starterIds, withPhysics) {
    const team = [];
    const map = role === 'A' ? this.statsMapA : this.statsMapB;
    starterIds.forEach((id, slot) => {
      const rosterPlayer = getPlayerById(id);
      if (!rosterPlayer) return;
      const pos = this.formationPosition(role, slot, { x: this.FIELD_W / 2, y: this.FIELD_H / 2 });
      const body = withPhysics ? this.matter.add.circle(pos.x, pos.y, 9, { frictionAir: 0.14, label: `${role}${slot}` }) : null;
      const color = this.playerColor(rosterPlayer, role === 'A' ? 0x3399ff : 0xff4444);
      const gfx = this.add.circle(pos.x, pos.y, 9, color);
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
    this.formation.A = payloadA.formation || DEFAULT_FORMATION;
    this.formation.B = payloadB.formation || DEFAULT_FORMATION;
    this.teamA = this.buildTeam('A', payloadA.starterIds, true);
    this.teamB = this.buildTeam('B', payloadB.starterIds, true);
    this.benchA = (payloadA.benchIds || []).filter((id) => getPlayerById(id));
    this.benchB = (payloadB.benchIds || []).filter((id) => getPlayerById(id));
    this.gkIdA = this.findGoalkeeperId(payloadA.starterIds);
    this.gkIdB = this.findGoalkeeperId(payloadB.starterIds);
    this.activeIdA = this.teamA[0] ? this.teamA[0].id : null;
    this.activeIdB = this.teamB[0] ? this.teamB[0].id : null;
    this.matchStarted = true;
    document.getElementById('team-select-ui').style.display = 'none';
    document.getElementById('formation-button').style.display = 'block';
  }

  buildClientTeams() {
    if (this.clientTeamsBuilt || !this.mySquadPayload || !this.remoteSquadPayload) return;
    this.formation.A = this.remoteSquadPayload.formation || DEFAULT_FORMATION;
    this.formation.B = this.mySquadPayload.formation || DEFAULT_FORMATION;
    this.teamA = this.buildTeam('A', this.remoteSquadPayload.starterIds, false);
    this.teamB = this.buildTeam('B', this.mySquadPayload.starterIds, false);
    this.benchA = this.remoteSquadPayload.benchIds || [];
    this.benchB = this.mySquadPayload.benchIds || [];
    this.gkIdA = this.findGoalkeeperId(this.remoteSquadPayload.starterIds);
    this.gkIdB = this.findGoalkeeperId(this.mySquadPayload.starterIds);
    this.clientTeamsBuilt = true;
    document.getElementById('formation-button').style.display = 'block';
  }

  /** slot -> world position. Uses this.formation[role] and is
   * orientation-aware: "primary" is the attacking axis (x if horizontal,
   * y if vertical), "secondary" spreads players across the goal line. */
  formationPosition(role, slot, ballPos) {
    const preset = FORMATIONS[this.formation[role]] || FORMATIONS[DEFAULT_FORMATION];
    const f = preset[slot] || preset[preset.length - 1];
    const primarySize = this.primarySize();
    const secondarySize = this.secondarySize();
    const margin = 24;
    const halfPrimary = primarySize / 2 - margin;

    let primary = f.y * halfPrimary + margin;
    if (role === 'B') primary = primarySize - primary;
    let secondary = f.x * secondarySize;
    const ballSecondary = ballPos[this.secondaryAxis()];
    secondary += Phaser.Math.Clamp((ballSecondary - secondarySize / 2) * 0.12, -35, 35);

    return this.horizontal ? { x: primary, y: secondary } : { x: secondary, y: primary };
  }

  // ---------------------------------------------------------------------
  // Formation change (mid-match)
  // ---------------------------------------------------------------------

  openFormationPanel() {
    const wrap = document.getElementById('formation-options');
    wrap.innerHTML = '';
    Object.keys(FORMATIONS).forEach((name) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        this.pendingFormationChange = name;
        document.getElementById('formation-panel').style.display = 'none';
      });
      wrap.appendChild(btn);
    });
    document.getElementById('formation-panel').style.display = 'flex';
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
    const myStarterIds = this.role === 'A' ? this.teamA.map((e) => e.id) : this.teamB.map((e) => e.id);
    const myBenchIds = this.role === 'A' ? (this.benchA || []) : (this.benchB || []);

    if (!this.subOutSelection) {
      title.textContent = 'Who comes off?';
      myStarterIds.forEach((id) => {
        const p = getPlayerById(id);
        if (!p) return;
        const card = document.createElement('div');
        card.className = 'roster-card';
        card.innerHTML = `<div class="name-row">${this.avatarHtml(p)}<div class="name">${p.nickname || p.name}</div></div><div class="pos">${p.position}</div><button class="bring-on-btn">Sub off</button>`;
        card.querySelector('.bring-on-btn').addEventListener('click', () => { this.subOutSelection = id; this.renderSubPanelStep(); });
        list.appendChild(card);
      });
    } else {
      title.textContent = 'Who comes on?';
      const bench = myBenchIds.map(getPlayerById).filter(Boolean);
      if (!bench.length) { list.innerHTML = '<p>No bench players available.</p>'; return; }
      bench.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'roster-card';
        card.innerHTML = `<div class="name-row">${this.avatarHtml(p)}<div class="name">${p.nickname || p.name}</div></div><div class="pos">${p.position}</div><button class="bring-on-btn">Bring on</button>`;
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
    bench.splice(benchIdx, 1, subReq.outId);
    if (role === 'A' && this.activeIdA === subReq.outId) this.activeIdA = incoming.id;
    if (role === 'B' && this.activeIdB === subReq.outId) this.activeIdB = incoming.id;
    if (role === 'A' && this.gkIdA === subReq.outId) this.gkIdA = incoming.id;
    if (role === 'B' && this.gkIdB === subReq.outId) this.gkIdB = incoming.id;
  }

  // ---------------------------------------------------------------------
  // Input: tap a player and drag to move them (path drawing, several at
  // once); a quick tap elsewhere (no drag) passes the ball there instead.
  // ---------------------------------------------------------------------

  handlePointerDown(pointer) {
    if (!this.matchStarted || this.matchClock.ended) return;
    const myAttackTowardMax = this.role === 'A';
    if (this.iHavePossession() && this.inGoalRegion(pointer.x, pointer.y, myAttackTowardMax) && !this.confrontation) {
      this.pendingShootRequest = true;
      return;
    }
    if (this.confrontation) return;

    this.gestureStart = { x: pointer.x, y: pointer.y };
    this.gestureMoved = false;

    const myTeam = this.role === 'A' ? this.teamA : this.teamB;
    let nearest = null;
    let nearestDist = PLAYER_SELECT_RADIUS;
    myTeam.forEach((entry) => {
      const d = Phaser.Math.Distance.Between(entry.gfx.x, entry.gfx.y, pointer.x, pointer.y);
      if (d < nearestDist) { nearestDist = d; nearest = entry; }
    });
    const activeId = this.role === 'A' ? this.activeIdA : this.activeIdB;
    this.pendingSelectedPlayerId = nearest ? nearest.id : activeId;
    this.drawing = true;
  }

  extendPath(pointer) {
    if (!this.drawing) return;
    if (!this.gestureMoved) {
      if (!this.gestureStart || Phaser.Math.Distance.Between(this.gestureStart.x, this.gestureStart.y, pointer.x, pointer.y) < DRAG_THRESHOLD) return;
      this.gestureMoved = true;
      this.selectedPlayerId = this.pendingSelectedPlayerId;
      this.myPaths.set(this.selectedPlayerId, [{ x: this.gestureStart.x, y: this.gestureStart.y }, { x: pointer.x, y: pointer.y }]);
      return;
    }
    const path = this.myPaths.get(this.selectedPlayerId);
    if (!path) return;
    const last = path[path.length - 1];
    if (!last || Phaser.Math.Distance.Between(last.x, last.y, pointer.x, pointer.y) > MIN_PATH_POINT_DIST) {
      path.push({ x: pointer.x, y: pointer.y });
    }
  }

  handlePointerUp() {
    if (this.drawing && !this.gestureMoved && this.gestureStart && this.matchStarted && !this.confrontation) {
      // it was a tap, not a drag: pass the ball there if I have it
      if (this.iHavePossession()) this.pendingPassTarget = { x: this.gestureStart.x, y: this.gestureStart.y };
    }
    this.drawing = false;
    this.gestureStart = null;
  }

  inGoalRegion(x, y, attackingTowardMax) {
    const primaryVal = this.horizontal ? x : y;
    const secondaryVal = this.horizontal ? y : x;
    const primaryMax = this.primarySize();
    const withinSecondary = Math.abs(secondaryVal - this.secondarySize() / 2) < GOAL_HALF_WIDTH + 30;
    const withinPrimary = attackingTowardMax ? primaryVal > primaryMax - GOAL_CLICK_MARGIN : primaryVal < GOAL_CLICK_MARGIN;
    return withinSecondary && withinPrimary;
  }

  iHavePossession() {
    return this.currentPossession === this.role;
  }

  computeMyTargets() {
    const myTeam = this.role === 'A' ? this.teamA : this.teamB;
    const targets = [];
    for (const entry of myTeam) {
      const path = this.myPaths.get(entry.id);
      if (!path || !path.length) continue;
      const posRef = entry.body ? entry.body.position : entry.gfx;
      while (path.length && Phaser.Math.Distance.Between(posRef.x, posRef.y, path[0].x, path[0].y) < WAYPOINT_RADIUS) {
        path.shift();
      }
      if (path.length) targets.push({ id: entry.id, x: path[0].x, y: path[0].y });
      else this.myPaths.delete(entry.id);
    }
    return targets;
  }

  drawMyPaths() {
    this.pathGraphics.clear();
    if (!this.matchStarted) return;
    const myTeam = this.role === 'A' ? this.teamA : this.teamB;
    this.pathGraphics.lineStyle(2, 0xffe066, 0.85);
    myTeam.forEach((entry) => {
      const path = this.myPaths.get(entry.id);
      if (!path || !path.length) return;
      const posRef = entry.body ? entry.body.position : entry.gfx;
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(posRef.x, posRef.y);
      path.forEach((pt) => this.pathGraphics.lineTo(pt.x, pt.y));
      this.pathGraphics.strokePath();
      const last = path[path.length - 1];
      this.pathGraphics.fillStyle(0xffe066, 1);
      this.pathGraphics.fillCircle(last.x, last.y, 4);
    });
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
    if (speed > maxSpeed) this.matter.body.setVelocity(body, { x: (v.x / speed) * maxSpeed, y: (v.y / speed) * maxSpeed });
  }

  glueBallToPossessor() {
    if (!this.possessorRole) return;
    const entry = this.activeEntry(this.possessorRole);
    if (!entry || !entry.body) return;
    const body = entry.body;
    const vel = body.velocity;
    const speed = Math.hypot(vel.x, vel.y);
    let dirX = 0, dirY = 0;
    if (speed > 0.05) { dirX = vel.x / speed; dirY = vel.y / speed; }
    else {
      const primary = this.primaryAxis();
      const sign = this.possessorRole === 'A' ? 1 : -1;
      if (primary === 'x') dirX = sign; else dirY = sign;
    }
    this.matter.body.setPosition(this.ball, { x: body.position.x + dirX * POSSESSION_OFFSET, y: body.position.y + dirY * POSSESSION_OFFSET });
    this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
  }

  doPass(role, target) {
    const entry = this.activeEntry(role);
    if (!entry || !entry.body) return;
    const dx = target.x - entry.body.position.x;
    const dy = target.y - entry.body.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.possessorRole = null;
    this.matter.body.setVelocity(this.ball, { x: (dx / dist) * PASS_SPEED, y: (dy / dist) * PASS_SPEED });
  }

  knockback(loserEntry, winnerEntry) {
    if (!loserEntry.body || !winnerEntry.body) return;
    const dx = loserEntry.body.position.x - winnerEntry.body.position.x;
    const dy = loserEntry.body.position.y - winnerEntry.body.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.matter.body.setVelocity(loserEntry.body, { x: (dx / dist) * 3, y: (dy / dist) * 3 });
  }

  activeEntry(role) {
    const team = role === 'A' ? this.teamA : this.teamB;
    const activeId = role === 'A' ? this.activeIdA : this.activeIdB;
    return team.find((t) => t.id === activeId) || null;
  }

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
      if (currentDist - bestDist > 18) { if (role === 'A') this.activeIdA = best.id; else this.activeIdB = best.id; }
    }
  }

  // ---------------------------------------------------------------------
  // Collisions
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
      if (labels.includes('ball') && labels.includes('goalMin')) this.onGoal('b');
      if (labels.includes('ball') && labels.includes('goalMax')) this.onGoal('a');
    }
  }

  // ---------------------------------------------------------------------
  // Confrontations
  // ---------------------------------------------------------------------

  startConfrontation(type, attackerRole, defenderRole, now) {
    const attackerId = attackerRole === 'A' ? this.activeIdA : this.activeIdB;
    const defenderId = type === 'shot' ? (defenderRole === 'A' ? this.gkIdA : this.gkIdB) : (defenderRole === 'A' ? this.activeIdA : this.activeIdB);
    this.confrontation = { type, attackerRole, defenderRole, attackerId, defenderId, deadline: now + CONFRONTATION_WINDOW_MS, attackerChoice: null, defenderChoice: null };
  }

  aiConfrontationChoice(stats, category) {
    if (canActivate(stats, category) && Math.random() < 0.55) return 'technique';
    return 'normal';
  }

  tryActivateTechnique(stats, category) {
    if (!canActivate(stats, category)) return false;
    stats.sp -= stats.techniques[category].cost;
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
    const attackerUsedTech = c.attackerChoice === 'technique' && this.tryActivateTechnique(attackerStats, attackTechId);
    const defenderUsedTech = c.defenderChoice === 'technique' && this.tryActivateTechnique(defenderStats, defendTechId);
    const attackPower = (attackerUsedTech ? attackerStats.techniques[attackTechId].power : NORMAL_ACTION_POWER) * attackerStats[STAT_FIELD_FOR_TECH[attackTechId]];
    const defendPower = (defenderUsedTech ? defenderStats.techniques[defendTechId].power : NORMAL_ACTION_POWER) * defenderStats[STAT_FIELD_FOR_TECH[defendTechId]];
    const attackerWins = Math.random() < attackPower / (attackPower + defendPower);

    let resultText;
    if (c.type === 'duel') {
      const attackerEntry = this.activeEntry(c.attackerRole);
      const defenderEntry = this.activeEntry(c.defenderRole);
      if (attackerWins) { this.knockback(defenderEntry, attackerEntry); resultText = `${attackerStats.name} gets past ${defenderStats.name}!`; }
      else { this.possessorRole = c.defenderRole; this.knockback(attackerEntry, defenderEntry); resultText = `${defenderStats.name} wins the ball off ${attackerStats.name}!`; }
      this.duelLockUntil = now + 1000;
    } else if (attackerWins) {
      this.onGoal(c.attackerRole === 'A' ? 'a' : 'b');
      resultText = `GOAL! ${attackerStats.name} scores${attackerUsedTech ? ' with a supertechnique' : ''}!`;
    } else {
      this.possessorRole = c.defenderRole;
      resultText = `Saved! ${defenderStats.name} keeps it out.`;
    }

    this.confrontationResult = { text: resultText, until: now + RESULT_BANNER_MS };
    this.confrontation = null;
  }

  onGoal(scorer) {
    this.score[scorer] += 1;
    document.querySelector('#scoreboard .score').textContent = `${this.score.a} - ${this.score.b}`;
    this.possessorRole = null;
    this.matter.body.setPosition(this.ball, { x: this.FIELD_W / 2, y: this.FIELD_H / 2 });
    this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
    this.resetFormationPositions();
  }

  resetFormationPositions() {
    const ballPos = { x: this.FIELD_W / 2, y: this.FIELD_H / 2 };
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
    this.myPaths.clear();
  }

  regenSP(map, deltaMs) {
    for (const stats of map.values()) stats.sp = Math.min(stats.maxSP, stats.sp + stats.spRegenPerSec * (deltaMs / 1000));
  }

  // ---------------------------------------------------------------------
  // Match clock
  // ---------------------------------------------------------------------

  tickMatchClock(delta) {
    if (this.matchClock.ended) return;
    this.matchClock.secondsRemaining -= delta / 1000;
    if (this.matchClock.secondsRemaining <= 0) {
      if (this.matchClock.half === 1) {
        this.matchClock.half = 2;
        this.matchClock.secondsRemaining = HALF_DURATION_S;
        this.possessorRole = null;
        this.confrontation = null;
        this.matter.body.setPosition(this.ball, { x: this.FIELD_W / 2, y: this.FIELD_H / 2 });
        this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
        this.resetFormationPositions();
      } else {
        this.matchClock.ended = true;
        this.matchClock.secondsRemaining = 0;
      }
    }
  }

  static formatClock(secs) {
    const s = Math.max(0, Math.ceil(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  renderClock(clock) {
    if (!clock) return;
    document.getElementById('match-clock').textContent = clock.ended ? 'Full time' : `${clock.half === 1 ? '1st' : '2nd'} half — ${GameScene.formatClock(clock.secondsRemaining)}`;
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  update(time, delta) {
    const amHost = this.role === 'A';
    if (!amHost && this.matchStarted && !this.clientTeamsBuilt) this.buildClientTeams();

    const targets = this.matchStarted ? this.computeMyTargets() : [];
    const myInput = {
      targets,
      shootRequest: this.pendingShootRequest,
      passTarget: this.pendingPassTarget,
      confrontationChoice: this.pendingConfrontationChoice,
      subRequest: this.pendingSubRequest,
      formationChange: this.pendingFormationChange
    };
    this.pendingShootRequest = false;
    this.pendingPassTarget = null;
    this.pendingConfrontationChoice = null;
    this.pendingSubRequest = null;
    this.pendingFormationChange = null;
    this.net.sendInput(myInput);

    if (amHost) {
      if (this.matchStarted) this.updateAsHost(time, delta, myInput);
      else if (time - this.lastStateSent > 1000 / STATE_HZ) { this.lastStateSent = time; this.net.sendState({ matchStarted: false }); }
    } else {
      this.updateAsClient(time);
    }

    if (this.matchStarted) {
      this.updateConfrontationUI(this.confrontation, time);
      this.drawMyPaths();
    }
  }

  updateAsHost(now, delta, myInput) {
    const aiActive = !this.net.hasPeer();
    document.getElementById('ai-badge').style.display = aiActive ? 'block' : 'none';

    let inputB = this.remoteInput;
    if (aiActive) {
      const activeB = this.activeEntry('B');
      const ai = decideAIMove({
        selfPos: activeB ? activeB.body.position : { x: this.FIELD_W / 2, y: this.FIELD_H },
        ballPos: this.ball.position,
        axis: this.primaryAxis(),
        ownGoalValue: this.primarySize(), rivalGoalValue: 0,
        fieldPrimarySize: this.primarySize()
      });
      inputB = { targets: activeB ? [{ id: activeB.id, x: ai.target.x, y: ai.target.y }] : [], shootRequest: false, passTarget: null, confrontationChoice: null, subRequest: null, formationChange: null };
    }

    this.regenSP(this.statsMapA, delta);
    this.regenSP(this.statsMapB, delta);
    this.currentPossession = this.possessorRole;

    if (myInput.formationChange) this.formation.A = myInput.formationChange;
    if (!aiActive && inputB.formationChange) this.formation.B = inputB.formationChange;

    if (!this.matchClock.ended) this.tickMatchClock(delta);

    if (this.confrontation) {
      this.progressConfrontation(now, myInput, inputB, aiActive);
    } else if (this.matchClock.ended) {
      // full time — no more orders processed
    } else {
      this.updateActivePlayer('A');
      this.updateActivePlayer('B');

      this.moveTeam('A', myInput.targets);
      this.moveTeam('B', inputB.targets);

      if (myInput.passTarget && this.possessorRole === 'A') this.doPass('A', myInput.passTarget);
      else if (!aiActive && inputB.passTarget && this.possessorRole === 'B') this.doPass('B', inputB.passTarget);

      if (myInput.shootRequest && this.possessorRole === 'A') this.startConfrontation('shot', 'A', 'B', now);
      else if (!aiActive && inputB.shootRequest && this.possessorRole === 'B') this.startConfrontation('shot', 'B', 'A', now);
      else if (aiActive && this.possessorRole === 'B') {
        const activeB = this.activeEntry('B');
        const primary = this.primaryAxis();
        const closeToGoal = activeB && activeB.body.position[primary] < 160;
        if (closeToGoal && Math.random() < 0.02) this.startConfrontation('shot', 'B', 'A', now);
      }

      if (this.confrontation && this.confrontation.defenderRole === 'B' && aiActive) {
        const defStats = this.statsFor('B', this.confrontation.defenderId);
        this.confrontation.defenderChoice = this.aiConfrontationChoice(defStats, 'keeper');
      }

      if (myInput.subRequest) this.trySub('A', myInput.subRequest);
      if (!aiActive && inputB.subRequest) this.trySub('B', inputB.subRequest);
    }

    this.glueBallToPossessor();
    this.syncGfxFromPhysics();
    this.renderClock(this.matchClock);
    this.renderResultBanner(this.confrontationResult, now);

    const myActiveStats = this.statsFor('A', this.activeIdA);
    if (myActiveStats) this.paintHUD(myActiveStats.sp, myActiveStats.maxSP);
    document.getElementById('sub-button').style.display = (this.benchA && this.benchA.length) ? 'block' : 'none';

    if (now - this.lastStateSent > 1000 / STATE_HZ) {
      this.lastStateSent = now;
      const activeAStats = this.statsFor('A', this.activeIdA);
      const activeBStats = this.statsFor('B', this.activeIdB);
      this.net.sendState({
        matchStarted: true,
        ball: { x: this.ball.position.x, y: this.ball.position.y },
        teamA: this.teamA.map((e) => ({ x: e.body.position.x, y: e.body.position.y })),
        teamB: this.teamB.map((e) => ({ x: e.body.position.x, y: e.body.position.y })),
        activeIdA: this.activeIdA, activeIdB: this.activeIdB,
        score: this.score,
        sp: { a: activeAStats ? activeAStats.sp : 0, b: activeBStats ? activeBStats.sp : 0 },
        maxSp: { a: activeAStats ? activeAStats.maxSP : 100, b: activeBStats ? activeBStats.maxSP : 100 },
        possession: this.possessorRole,
        confrontation: this.confrontation
          ? { type: this.confrontation.type, attackerRole: this.confrontation.attackerRole, defenderRole: this.confrontation.defenderRole, attackerId: this.confrontation.attackerId, defenderId: this.confrontation.defenderId, deadline: this.confrontation.deadline }
          : null,
        confrontationResult: (this.confrontationResult && now < this.confrontationResult.until) ? this.confrontationResult : null,
        benchIds: { a: this.benchA, b: this.benchB },
        starterIds: { a: this.teamA.map((e) => e.id), b: this.teamB.map((e) => e.id) },
        clock: { half: this.matchClock.half, secondsRemaining: this.matchClock.secondsRemaining, ended: this.matchClock.ended }
      });
    }
  }

  moveTeam(role, targets) {
    const team = role === 'A' ? this.teamA : this.teamB;
    const byId = new Map(targets.map((t) => [t.id, t]));
    team.forEach((entry) => {
      const stats = this.statsFor(role, entry.id);
      const speed = stats ? stats.speed : 1;
      const t = byId.get(entry.id);
      if (t) this.steerTowards(entry.body, t, speed, STEER_FORCE);
      else this.steerTowards(entry.body, this.formationPosition(role, entry.slot, this.ball.position), 1, FORMATION_STEER_FORCE);
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
      if (c.attackerRole === 'B' && c.attackerChoice === null) { const s = this.statsFor('B', c.attackerId); c.attackerChoice = s ? this.aiConfrontationChoice(s, techForRole('B')) : 'normal'; }
      if (c.defenderRole === 'B' && c.defenderChoice === null) { const s = this.statsFor('B', c.defenderId); c.defenderChoice = s ? this.aiConfrontationChoice(s, techForRole('B')) : 'normal'; }
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
    if (!this.remoteState || !this.remoteState.matchStarted || !this.clientTeamsBuilt) return;
    const lerp = 0.3;
    this.syncTeamIdentities(this.remoteState);

    this.ballGfx.x = Phaser.Math.Linear(this.ballGfx.x, this.remoteState.ball.x, lerp);
    this.ballGfx.y = Phaser.Math.Linear(this.ballGfx.y, this.remoteState.ball.y, lerp);
    this.teamA.forEach((entry, i) => { const p = this.remoteState.teamA[i]; if (!p) return; entry.gfx.x = Phaser.Math.Linear(entry.gfx.x, p.x, lerp); entry.gfx.y = Phaser.Math.Linear(entry.gfx.y, p.y, lerp); });
    this.teamB.forEach((entry, i) => { const p = this.remoteState.teamB[i]; if (!p) return; entry.gfx.x = Phaser.Math.Linear(entry.gfx.x, p.x, lerp); entry.gfx.y = Phaser.Math.Linear(entry.gfx.y, p.y, lerp); });

    this.activeIdA = this.remoteState.activeIdA;
    this.activeIdB = this.remoteState.activeIdB;
    this.highlightActivePlayers();

    document.querySelector('#scoreboard .score').textContent = `${this.remoteState.score.a} - ${this.remoteState.score.b}`;
    this.renderClock(this.remoteState.clock);
    this.currentPossession = this.remoteState.possession;
    this.confrontation = this.remoteState.confrontation;
    this.renderResultBanner(this.remoteState.confrontationResult, time);

    this.paintHUD(this.remoteState.sp.b, (this.remoteState.maxSp && this.remoteState.maxSp.b) || 100);
    this.updatePossessionRing();
    const benchB = (this.remoteState.benchIds && this.remoteState.benchIds.b) || [];
    document.getElementById('sub-button').style.display = benchB.length ? 'block' : 'none';
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------

  syncTeamIdentities(remoteState) {
    if (!remoteState.starterIds) return;
    ['A', 'B'].forEach((role) => {
      const team = role === 'A' ? this.teamA : this.teamB;
      const ids = role === 'A' ? remoteState.starterIds.a : remoteState.starterIds.b;
      const map = role === 'A' ? this.statsMapA : this.statsMapB;
      team.forEach((entry, i) => {
        const newId = ids[i];
        if (newId && newId !== entry.id) {
          entry.id = newId;
          if (!map.has(newId)) {
            const rosterPlayer = getPlayerById(newId);
            if (rosterPlayer) { const stats = createPlayerStats(); applyRosterPlayerToStats(stats, rosterPlayer); map.set(newId, stats); }
          }
        }
      });
    });
    if (remoteState.benchIds) { this.benchA = remoteState.benchIds.a || this.benchA; this.benchB = remoteState.benchIds.b || this.benchB; }
  }

  paintHUD(sp, maxSp) {
    document.getElementById('sp-value').textContent = `${Math.round(sp)}/${Math.round(maxSp || 100)}`;
  }

  renderResultBanner(result, now) {
    const el = document.getElementById('confrontation-result');
    if (result && now < result.until) { el.textContent = result.text; el.style.display = 'block'; }
    else el.style.display = 'none';
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

    const relevantId = amAttacker ? confrontation.attackerId : confrontation.defenderId;
    const relevantRole = amAttacker ? confrontation.attackerRole : confrontation.defenderRole;
    const stats = this.statsFor(relevantRole, relevantId);
    document.getElementById('confrontation-player-info').textContent = stats ? `${stats.name} — PT ${Math.round(stats.sp)}/${Math.round(stats.maxSP)}` : '';

    const techBtn = document.getElementById('conf-technique');
    const tech = stats ? stats.techniques[techId] : null;
    if (tech) {
      techBtn.style.display = 'block';
      techBtn.innerHTML = `${tech.name}<span class="cost">${tech.cost} PT</span>`;
      techBtn.disabled = !stats || !canActivate(stats, techId);
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
