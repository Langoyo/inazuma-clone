import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate } from '../data/players.js';
import { loadRoster, getPlayerById, getGames } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';

const FIELD_W = 800;
const FIELD_H = 500;
const STATE_HZ = 20;
const GOAL_HALF_HEIGHT = 70;
const GOAL_CLICK_MARGIN = 40;   // how close to the goal you must tap to "shoot"
const WAYPOINT_RADIUS = 16;     // distance at which a drawn path point counts as "reached"
const MIN_PATH_POINT_DIST = 16; // minimum spacing between points while drawing a path
const CONFRONTATION_WINDOW_MS = 1500;
const POSSESSION_OFFSET = 26;   // how far ahead of the carrier the ball "floats"

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    // --- P2P networking ---
    const roomCode = getOrCreateRoomCode();
    document.getElementById('room-code').textContent = roomCode;
    this.net = connectToRoom(roomCode);

    // Fixed role for the whole match: host = A, client = B.
    this.role = this.net.isHost() ? 'A' : 'B';

    // --- Field ---
    this.add.rectangle(FIELD_W / 2, FIELD_H / 2, FIELD_W, FIELD_H, 0x1e7a3c)
      .setStrokeStyle(4, 0xffffff);
    this.add.rectangle(10, FIELD_H / 2, 6, GOAL_HALF_HEIGHT * 2, 0xffffff);
    this.add.rectangle(FIELD_W - 10, FIELD_H / 2, 6, GOAL_HALF_HEIGHT * 2, 0xffffff);

    // --- Physics ---
    this.matter.world.setBounds(0, 0, FIELD_W, FIELD_H);

    this.ball = this.matter.add.circle(FIELD_W / 2, FIELD_H / 2, 10, {
      restitution: 0.7, frictionAir: 0.012, label: 'ball'
    });
    this.playerA = this.matter.add.circle(200, FIELD_H / 2, 20, { frictionAir: 0.08, label: 'playerA' });
    this.playerB = this.matter.add.circle(600, FIELD_H / 2, 20, { frictionAir: 0.08, label: 'playerB' });

    this.goalLeft = this.matter.add.rectangle(0, FIELD_H / 2, 12, GOAL_HALF_HEIGHT * 2, { isSensor: true, isStatic: true, label: 'goalLeft' });
    this.goalRight = this.matter.add.rectangle(FIELD_W, FIELD_H / 2, 12, GOAL_HALF_HEIGHT * 2, { isSensor: true, isStatic: true, label: 'goalRight' });

    // --- Visuals ---
    this.ballGfx = this.add.circle(this.ball.position.x, this.ball.position.y, 10, 0xffffff);
    this.playerAGfx = this.add.circle(this.playerA.position.x, this.playerA.position.y, 20, 0x3399ff);
    this.playerBGfx = this.add.circle(this.playerB.position.x, this.playerB.position.y, 20, 0xff4444);
    this.possessionRing = this.add.circle(0, 0, 27).setStrokeStyle(3, 0xffd966).setFillStyle(0x000000, 0).setVisible(false);

    // --- Roster / in-match stats (only the host has real authority) ---
    this.statsA = createPlayerStats('Player A');
    this.statsB = createPlayerStats('Player B');
    this.score = { a: 0, b: 0 };
    this.benchA = [];
    this.benchB = [];
    this.activeIdA = null;
    this.activeIdB = null;

    // --- Ball possession & confrontations ---
    this.possessorRole = null;   // null = loose ball, 'A'/'B' = who's carrying it
    this.currentPossession = null;
    this.duelLockUntil = 0;
    this.confrontation = null;   // duel or shot in progress (host has authority)

    // --- Match doesn't begin until both squads are chosen ---
    this.matchStarted = false;
    this.mySquad = { starterId: null, benchIds: new Set() };
    this.mySquadConfirmed = false;
    this.mySquadPayload = null;
    this.remoteSquadPayload = null;

    // --- Path drawing with the pointer ---
    this.path = [];
    this.drawing = false;
    this.pendingShootRequest = false;
    this.pendingConfrontationChoice = null;
    this.pendingSubRequest = null;

    this.input.on('pointerdown', (p) => this.handlePointerDown(p));
    this.input.on('pointermove', (p) => { if (p.isDown) this.extendPath(p); });
    this.input.on('pointerup', () => { this.drawing = false; });
    this.input.on('pointerupoutside', () => { this.drawing = false; });

    // --- Confrontation panel buttons ---
    document.getElementById('conf-normal').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.pendingConfrontationChoice = 'normal';
    });
    document.getElementById('conf-technique').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.pendingConfrontationChoice = 'technique';
    });

    // --- Substitution panel ---
    document.getElementById('sub-button').addEventListener('click', () => {
      this.renderSubPanel();
      document.getElementById('sub-panel').style.display = 'flex';
    });
    document.getElementById('sub-cancel-btn').addEventListener('click', () => {
      document.getElementById('sub-panel').style.display = 'none';
    });

    // --- Team select overlay ---
    this.rosterAll = [];
    document.getElementById('roster-list').innerHTML = '<p style="opacity:0.85;">Loading roster (this can take a moment, it\'s a ~2 MB file)...</p>';
    loadRoster().then((data) => {
      console.log('[roster] loaded', data.length, 'players');
      this.rosterAll = data;
      const gameSelect = document.getElementById('roster-game-filter');
      getGames().forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        gameSelect.appendChild(opt);
      });
      this.renderRosterUI();
    }).catch((err) => {
      console.error('[roster] failed to load:', err);
      document.getElementById('roster-list').innerHTML =
        `<p style="color:#ff8080; font-size:14px; font-weight:bold;">Couldn't load the roster.</p>
         <p style="color:#ffcccc; font-size:12px;">${err.message}</p>
         <p style="color:#ffcccc; font-size:12px;">Check: is <code>public/roster.json</code> present in your project, and are you loading this page through a server (http://localhost:... or your deployed URL) rather than opening the HTML file directly?</p>`;
    });
    document.getElementById('confirm-squad-btn').addEventListener('click', () => this.confirmSquad());

    // --- Networking callbacks ---
    this.remoteState = null;
    this.remoteInput = { x: this.playerB.position.x, y: this.playerB.position.y };

    this.net.onInput((data) => { this.remoteInput = data; });
    this.net.onState((data) => this.handleIncomingState(data));
    this.net.onSquad((data) => {
      this.remoteSquadPayload = data;
      if (this.role === 'A' && this.mySquadConfirmed && !this.matchStarted) {
        this.startMatch(this.mySquadPayload, data);
      }
    });

    // --- Collisions (host resolves them with authority) ---
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

      wholeTeamBtn.disabled = !gameSelect.value; // needs a specific game selected

      list.innerHTML = '';
      matches.slice(0, MAX_RENDERED).forEach((p) => {
        const card = document.createElement('div');
        card.className = 'roster-card';
        card.dataset.id = p.id;
        card.innerHTML = `
          <div class="name">${p.nickname || p.name}</div>
          <div class="pos">${p.position} · ${p.game}</div>
          <div class="pos">SPD ${p.stats.speed} SHT ${p.stats.shotPower} DRB ${p.stats.dribblePower}</div>
          <div class="row"><button class="starter-btn">Set as starter</button></div>
          <label><input type="checkbox" class="bench-check" /> Bench</label>
        `;
        list.appendChild(card);

        card.querySelector('.starter-btn').addEventListener('click', () => {
          this.mySquad.starterId = p.id;
          this.mySquad.benchIds.delete(p.id);
          card.querySelector('.bench-check').checked = false;
          this.refreshRosterUI();
        });
        card.querySelector('.bench-check').addEventListener('change', (e) => {
          if (p.id === this.mySquad.starterId) { e.target.checked = false; return; }
          if (e.target.checked) this.mySquad.benchIds.add(p.id);
          else this.mySquad.benchIds.delete(p.id);
        });
      });
      this.refreshRosterUI();
    };

    searchInput.addEventListener('input', draw);
    gameSelect.addEventListener('change', draw);
    wholeTeamBtn.addEventListener('click', () => {
      const matches = currentMatches();
      if (!matches.length) return;
      // Prefer a goalkeeper as the starter when one is in the filtered list.
      const starter = matches.find((p) => p.position === 'GK') || matches[0];
      this.mySquad.starterId = starter.id;
      this.mySquad.benchIds = new Set(
        matches.filter((p) => p.id !== starter.id).slice(0, 10).map((p) => p.id)
      );
      draw();
    });

    draw();
  }

  refreshRosterUI() {
    document.querySelectorAll('.roster-card').forEach((card) => {
      card.classList.toggle('is-starter', card.dataset.id === this.mySquad.starterId);
    });
    document.getElementById('confirm-squad-btn').disabled = !this.mySquad.starterId;
  }

  confirmSquad() {
    const payload = { starterId: this.mySquad.starterId, benchIds: [...this.mySquad.benchIds] };
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
    const pool = this.rosterAll.length ? this.rosterAll : [];
    return {
      starterId: pool[0] ? pool[0].id : null,
      benchIds: pool.slice(1, 3).map((p) => p.id)
    };
  }

  startMatch(payloadA, payloadB) {
    const starterA = getPlayerById(payloadA.starterId) || this.rosterAll[0];
    const starterB = getPlayerById(payloadB.starterId) || this.rosterAll[0];
    applyRosterPlayerToStats(this.statsA, starterA);
    applyRosterPlayerToStats(this.statsB, starterB);
    this.activeIdA = starterA.id;
    this.activeIdB = starterB.id;
    this.benchA = (payloadA.benchIds || []).map(getPlayerById).filter(Boolean);
    this.benchB = (payloadB.benchIds || []).map(getPlayerById).filter(Boolean);
    this.matchStarted = true;
    document.getElementById('team-select-ui').style.display = 'none';
  }

  // ---------------------------------------------------------------------
  // Substitutions
  // ---------------------------------------------------------------------

  renderSubPanel() {
    const bench = this.role === 'A'
      ? this.benchA
      : ((this.remoteState && this.remoteState.benchIds && this.remoteState.benchIds.b) || []).map(getPlayerById).filter(Boolean);

    const list = document.getElementById('sub-list');
    list.innerHTML = '';
    if (bench.length === 0) {
      list.innerHTML = '<p>No bench players available.</p>';
      return;
    }
    bench.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'roster-card';
      card.innerHTML = `<div class="name">${p.nickname || p.name}</div><div class="pos">${p.position} · ${p.team}</div><button class="bring-on-btn">Bring on</button>`;
      card.querySelector('.bring-on-btn').addEventListener('click', () => {
        this.pendingSubRequest = p.id;
        document.getElementById('sub-panel').style.display = 'none';
      });
      list.appendChild(card);
    });
  }

  trySub(role, benchPlayerId) {
    const bench = role === 'A' ? this.benchA : this.benchB;
    const incoming = getPlayerById(benchPlayerId);
    if (!incoming || !bench.find((p) => p.id === benchPlayerId)) return;

    const stats = role === 'A' ? this.statsA : this.statsB;
    const outgoingId = role === 'A' ? this.activeIdA : this.activeIdB;
    const outgoing = getPlayerById(outgoingId);

    applyRosterPlayerToStats(stats, incoming);
    if (role === 'A') this.activeIdA = incoming.id; else this.activeIdB = incoming.id;

    const newBench = bench.filter((p) => p.id !== incoming.id);
    if (outgoing) newBench.push(outgoing);
    if (role === 'A') this.benchA = newBench; else this.benchB = newBench;
  }

  // ---------------------------------------------------------------------
  // Input: path drawing and shooting
  // ---------------------------------------------------------------------

  handlePointerDown(pointer) {
    if (!this.matchStarted) return;
    const attackSide = this.role === 'A' ? 'right' : 'left';
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
    const withinY = Math.abs(y - FIELD_H / 2) < GOAL_HALF_HEIGHT + 30;
    const withinX = side === 'left' ? x < GOAL_CLICK_MARGIN : x > FIELD_W - GOAL_CLICK_MARGIN;
    return withinY && withinX;
  }

  iHavePossession() {
    return this.currentPossession === this.role;
  }

  /** Advances the local player's movement target along the drawn path. */
  updateMyPathTarget() {
    const myGfx = this.role === 'A' ? this.playerAGfx : this.playerBGfx;
    while (this.path.length && Phaser.Math.Distance.Between(myGfx.x, myGfx.y, this.path[0].x, this.path[0].y) < WAYPOINT_RADIUS) {
      this.path.shift();
    }
    if (this.path.length) {
      return { x: this.path[0].x, y: this.path[0].y };
    }
    return { x: myGfx.x, y: myGfx.y }; // no path left: stay put
  }

  // ---------------------------------------------------------------------
  // Movement physics
  // ---------------------------------------------------------------------

  steerTowards(body, target, baseSpeed = 1) {
    const dx = target.x - body.position.x;
    const dy = target.y - body.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;
    const force = 0.0025 * baseSpeed;
    this.matter.body.applyForce(body, body.position, { x: (dx / dist) * force, y: (dy / dist) * force });
  }

  // The ball "floats" attached to whoever is carrying it.
  glueBallToPossessor() {
    if (!this.possessorRole) return;
    const body = this.possessorRole === 'A' ? this.playerA : this.playerB;
    const vel = body.velocity;
    const speed = Math.hypot(vel.x, vel.y);
    const dirX = speed > 0.05 ? vel.x / speed : 1;
    const dirY = speed > 0.05 ? vel.y / speed : 0;
    this.matter.body.setPosition(this.ball, {
      x: body.position.x + dirX * POSSESSION_OFFSET,
      y: body.position.y + dirY * POSSESSION_OFFSET
    });
    this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
  }

  knockback(loserRole, winnerRole) {
    const loserBody = loserRole === 'A' ? this.playerA : this.playerB;
    const winnerBody = winnerRole === 'A' ? this.playerA : this.playerB;
    const dx = loserBody.position.x - winnerBody.position.x;
    const dy = loserBody.position.y - winnerBody.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.matter.body.setVelocity(loserBody, { x: (dx / dist) * 6, y: (dy / dist) * 6 });
  }

  // ---------------------------------------------------------------------
  // Collisions (host-authoritative)
  // ---------------------------------------------------------------------

  handleCollisions(event) {
    if (this.role !== 'A' || !this.matchStarted) return;
    const now = this.time.now;

    for (const pair of event.pairs) {
      const labels = [pair.bodyA.label, pair.bodyB.label];

      if (labels.includes('ball') && (labels.includes('playerA') || labels.includes('playerB'))
          && !this.possessorRole && !this.confrontation) {
        this.possessorRole = labels.includes('playerA') ? 'A' : 'B';
      }

      if (labels.includes('playerA') && labels.includes('playerB')
          && this.possessorRole && !this.confrontation && now >= this.duelLockUntil) {
        const defender = this.possessorRole === 'A' ? 'B' : 'A';
        this.startConfrontation('duel', this.possessorRole, defender, now);
      }

      if (labels.includes('ball') && labels.includes('goalLeft')) this.onGoal('b');
      if (labels.includes('ball') && labels.includes('goalRight')) this.onGoal('a');
    }
  }

  // ---------------------------------------------------------------------
  // Confrontations: duel (dribble vs tackle) and shot (shot vs save)
  // ---------------------------------------------------------------------

  startConfrontation(type, attackerRole, defenderRole, now) {
    this.confrontation = {
      type, attackerRole, defenderRole,
      deadline: now + CONFRONTATION_WINDOW_MS,
      attackerChoice: null,
      defenderChoice: null
    };
  }

  aiConfrontationChoice(stats, category, now) {
    if (canActivate(stats, category, now) && Math.random() < 0.55) return 'technique';
    return 'normal';
  }

  /** Tries to spend SP and set the cooldown for a player's technique in
   * `category`. Returns whether it succeeded (fails if they have no
   * technique equipped there, or can't afford/it's on cooldown). */
  tryActivateTechnique(stats, category, now) {
    if (!canActivate(stats, category, now)) return false;
    const tech = stats.techniques[category];
    stats.sp -= tech.cost;
    stats.cooldowns[category] = now + tech.cooldown;
    return true;
  }

  resolveConfrontation(now) {
    const c = this.confrontation;
    const attackerStats = c.attackerRole === 'A' ? this.statsA : this.statsB;
    const defenderStats = c.defenderRole === 'A' ? this.statsA : this.statsB;
    const attackTechId = c.type === 'duel' ? 'dribble' : 'shot';
    const defendTechId = c.type === 'duel' ? 'defense' : 'keeper';

    const attackerUsedTech = c.attackerChoice === 'technique' && this.tryActivateTechnique(attackerStats, attackTechId, now);
    const defenderUsedTech = c.defenderChoice === 'technique' && this.tryActivateTechnique(defenderStats, defendTechId, now);

    const attackPower = (attackerUsedTech ? attackerStats.techniques[attackTechId].power : NORMAL_ACTION_POWER) * attackerStats[STAT_FIELD_FOR_TECH[attackTechId]];
    const defendPower = (defenderUsedTech ? defenderStats.techniques[defendTechId].power : NORMAL_ACTION_POWER) * defenderStats[STAT_FIELD_FOR_TECH[defendTechId]];
    const pAttackerWins = attackPower / (attackPower + defendPower);
    const attackerWins = Math.random() < pAttackerWins;

    if (c.type === 'duel') {
      if (attackerWins) {
        this.knockback(c.defenderRole, c.attackerRole);
      } else {
        this.possessorRole = c.defenderRole;
        this.knockback(c.attackerRole, c.defenderRole);
      }
      this.duelLockUntil = now + 1000;
    } else {
      if (attackerWins) {
        this.onGoal(c.attackerRole === 'A' ? 'a' : 'b');
      } else {
        this.possessorRole = c.defenderRole; // the keeper catches/clears it
      }
    }

    this.confrontation = null;
  }

  onGoal(scorer) {
    this.score[scorer] += 1;
    document.getElementById('scoreboard').textContent = `${this.score.a} - ${this.score.b}`;
    this.possessorRole = null;
    this.matter.body.setPosition(this.ball, { x: FIELD_W / 2, y: FIELD_H / 2 });
    this.matter.body.setVelocity(this.ball, { x: 0, y: 0 });
    this.matter.body.setPosition(this.playerA, { x: 200, y: FIELD_H / 2 });
    this.matter.body.setPosition(this.playerB, { x: 600, y: FIELD_H / 2 });
    this.matter.body.setVelocity(this.playerA, { x: 0, y: 0 });
    this.matter.body.setVelocity(this.playerB, { x: 0, y: 0 });
  }

  regenSP(stats, deltaMs) {
    stats.sp = Math.min(stats.maxSP, stats.sp + stats.spRegenPerSec * (deltaMs / 1000));
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  update(time, delta) {
    const amHost = this.role === 'A';
    const myTarget = this.matchStarted ? this.updateMyPathTarget() : { x: 0, y: 0 };

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
      const ai = decideAIMove({
        selfPos: this.playerB.position,
        ballPos: this.ball.position,
        ownGoalX: FIELD_W, rivalGoalX: 0
      });
      inputB = { x: ai.target.x, y: ai.target.y, shootRequest: false, confrontationChoice: null, subRequest: null };
    }

    this.regenSP(this.statsA, delta);
    this.regenSP(this.statsB, delta);
    this.currentPossession = this.possessorRole;

    if (this.confrontation) {
      this.progressConfrontation(now, myInput, inputB, aiActive);
    } else {
      this.steerTowards(this.playerA, myInput, this.statsA.speed);
      this.steerTowards(this.playerB, inputB, this.statsB.speed);

      if (myInput.shootRequest && this.possessorRole === 'A') {
        this.startConfrontation('shot', 'A', 'B', now);
      } else if (!aiActive && inputB.shootRequest && this.possessorRole === 'B') {
        this.startConfrontation('shot', 'B', 'A', now);
      } else if (aiActive && this.possessorRole === 'B' && this.playerB.position.x < 140 && Math.random() < 0.02) {
        this.startConfrontation('shot', 'B', 'A', now);
      }

      if (this.confrontation && this.confrontation.defenderRole === 'B' && aiActive) {
        this.confrontation.defenderChoice = this.aiConfrontationChoice(this.statsB, 'keeper', now);
      }

      if (myInput.subRequest) this.trySub('A', myInput.subRequest);
      if (!aiActive && inputB.subRequest) this.trySub('B', inputB.subRequest);
    }

    this.glueBallToPossessor();
    this.syncGfxFromPhysics();
    this.paintHUD(this.statsA.sp, this.statsA.cooldowns, now);
    document.getElementById('sub-button').style.display = this.benchA.length > 0 ? 'block' : 'none';

    if (now - this.lastStateSent > 1000 / STATE_HZ) {
      this.lastStateSent = now;
      this.net.sendState({
        matchStarted: true,
        ball: { x: this.ball.position.x, y: this.ball.position.y },
        playerA: { x: this.playerA.position.x, y: this.playerA.position.y },
        playerB: { x: this.playerB.position.x, y: this.playerB.position.y },
        score: this.score,
        sp: { a: this.statsA.sp, b: this.statsB.sp },
        cooldowns: { a: this.statsA.cooldowns, b: this.statsB.cooldowns },
        possession: this.possessorRole,
        confrontation: this.confrontation
          ? { type: this.confrontation.type, attackerRole: this.confrontation.attackerRole, defenderRole: this.confrontation.defenderRole, deadline: this.confrontation.deadline }
          : null,
        benchIds: { a: this.benchA.map((p) => p.id), b: this.benchB.map((p) => p.id) }
      });
    }
  }

  /** Collects both players' confrontation choices and resolves once ready. */
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
      if (c.attackerRole === 'B' && c.attackerChoice === null) c.attackerChoice = this.aiConfrontationChoice(this.statsB, techForRole('B'), now);
      if (c.defenderRole === 'B' && c.defenderChoice === null) c.defenderChoice = this.aiConfrontationChoice(this.statsB, techForRole('B'), now);
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

    const lerp = 0.25;
    this.ballGfx.x = Phaser.Math.Linear(this.ballGfx.x, this.remoteState.ball.x, lerp);
    this.ballGfx.y = Phaser.Math.Linear(this.ballGfx.y, this.remoteState.ball.y, lerp);
    this.playerAGfx.x = Phaser.Math.Linear(this.playerAGfx.x, this.remoteState.playerA.x, lerp);
    this.playerAGfx.y = Phaser.Math.Linear(this.playerAGfx.y, this.remoteState.playerA.y, lerp);
    this.playerBGfx.x = Phaser.Math.Linear(this.playerBGfx.x, this.remoteState.playerB.x, lerp);
    this.playerBGfx.y = Phaser.Math.Linear(this.playerBGfx.y, this.remoteState.playerB.y, lerp);

    document.getElementById('scoreboard').textContent = `${this.remoteState.score.a} - ${this.remoteState.score.b}`;
    this.currentPossession = this.remoteState.possession;
    this.confrontation = this.remoteState.confrontation; // display only, no authority here

    // The client is always "B": paint its own SP bar / bench / cooldowns.
    this.paintHUD(this.remoteState.sp.b, this.remoteState.cooldowns.b, time);
    this.updatePossessionRing();
    const benchB = (this.remoteState.benchIds && this.remoteState.benchIds.b) || [];
    document.getElementById('sub-button').style.display = benchB.length > 0 ? 'block' : 'none';
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
    const techId = confrontation.type === 'duel'
      ? (amAttacker ? 'dribble' : 'defense')
      : (amAttacker ? 'shot' : 'keeper');

    document.getElementById('confrontation-title').textContent = confrontation.type === 'duel'
      ? (amAttacker ? 'Duel! You\u2019re being tackled' : 'Duel! Go for the tackle')
      : (amAttacker ? 'Shoot for goal!' : 'Save the shot!');

    document.getElementById('conf-normal').textContent = confrontation.type === 'duel'
      ? (amAttacker ? 'Normal dribble' : 'Normal tackle')
      : (amAttacker ? 'Normal shot' : 'Normal save');

    const stats = this.role === 'A' ? this.statsA : this.statsB;
    const tech = stats.techniques[techId];
    const techBtn = document.getElementById('conf-technique');
    if (tech) {
      techBtn.style.display = 'block';
      techBtn.innerHTML = `${tech.name}<span class="cost">${tech.cost} SP</span>`;
      techBtn.disabled = !canActivate(stats, techId, now);
    } else {
      techBtn.style.display = 'none'; // this player has no technique in this slot
    }

    const remaining = Math.max(0, confrontation.deadline - now);
    document.getElementById('confrontation-timer-fill').style.width = `${(remaining / CONFRONTATION_WINDOW_MS) * 100}%`;
  }

  syncGfxFromPhysics() {
    this.ballGfx.setPosition(this.ball.position.x, this.ball.position.y);
    this.playerAGfx.setPosition(this.playerA.position.x, this.playerA.position.y);
    this.playerBGfx.setPosition(this.playerB.position.x, this.playerB.position.y);
    this.updatePossessionRing();
  }

  updatePossessionRing() {
    if (this.currentPossession) {
      const gfx = this.currentPossession === 'A' ? this.playerAGfx : this.playerBGfx;
      this.possessionRing.setPosition(gfx.x, gfx.y).setVisible(true);
    } else {
      this.possessionRing.setVisible(false);
    }
  }
}
