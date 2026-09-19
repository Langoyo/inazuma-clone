import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate, techniquesFor } from '../data/players.js';
import { loadRoster, getPlayerById, getGames, getTeams } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';

// ─── Constants ────────────────────────────────────────────────────────────
// The logical field is big — the VIEWPORT (what the canvas shows) is smaller.
// Scroll is handled by moving the Phaser camera over the world.
const FIELD_LOGICAL_W   = 960;   // world size (px)
const FIELD_LOGICAL_H   = 1520;
const VIEWPORT_W        = 480;   // canvas size — what the player actually sees
const VIEWPORT_H        = 760;
const GOAL_HALF_WIDTH   = 70;
const GOAL_CLICK_MARGIN = 80;
// Room behind each goal line. The pitch itself still ends at the line, but the
// camera may scroll past it, so the goal can sit in the middle of the screen
// instead of jammed under the scoreboard or the PT bar. GOAL_DEPTH is how far
// the goal box reaches back — a box is a far easier tap target than a line.
const GOAL_RUNOFF       = 170;
const GOAL_DEPTH        = 150;
// How long the full-time screen stays up before it drops back to the menu.
const FULLTIME_MENU_MS  = 9000;
const WAYPOINT_RADIUS   = 20;
const MIN_PATH_PT_DIST  = 18;
const PLAYER_SEL_RADIUS = 36;
const DRAG_THRESHOLD    = 14;
const CONFRONT_MS       = 20000;
// Shots lose steam with distance: full power up close, easing down to a
// floor the farther out the shooter is. Values in px on the 1520-tall pitch.
const SHOT_FALLOFF_NEAR = 150;   // no penalty inside this range
const SHOT_FALLOFF_FAR  = 900;   // power bottoms out at/beyond this range
const SHOT_FALLOFF_MIN  = 0.45;  // floor multiplier at max range
// Any shot with an opposing outfield player standing in its path (not the
// keeper — they're the last line, box or no box) triggers a block attempt
// first: that defender can spend a supertechnique to try to stop it
// outright, same as a duel — or deliberately do nothing (e.g. save the PT
// for later). Losing that roll doesn't kill the shot, just costs it more
// power — it's already weakened by distance — before it reaches the keeper.
const BLOCK_MIN_DIST     = 0;    // any shot can be walled, penalty box included
const BLOCK_CORRIDOR_HALF= 70;   // how far off the direct shot line still counts as "in the way"
const BLOCK_PASS_PENALTY = 0.8;  // extra power lost grazing past a beaten blocker
const RESULT_MS         = 3500;
const RESULT_DELAY_MS   = 800;
// Once both sides have chosen, the duel holds on a VS card for a beat before
// anything moves: both moves are shown facing each other, then the winner's
// card lights up. Pure pacing — play is frozen for the whole window anyway.
const DUEL_REVEAL_MS     = 1900;
const DUEL_REVEAL_LIT_MS = 850;
const POSSESS_OFFSET    = 24;
// The ball's air friction decays its speed geometrically, so a kick covers
// roughly speed/BALL_FRICTION_AIR before dying. Passes therefore scale their
// speed to the distance instead of using one fixed value — at a flat 4.5 a
// pass always died after ~250px, well short of anything but a short ball.
// Kept in one place so the ball body and the pass maths can't drift apart.
const BALL_FRICTION_AIR = 0.018;
const PASS_REACH_BOOST  = 1.12;  // arrive with a bit of pace rather than stopping dead
const PASS_MIN_SPEED    = 3.0;
const PASS_MAX_SPEED    = 16;    // below the ball+player radius sum, so it can't tunnel through anyone
// Passes are chipped rather than rolled. The ball is airborne over the first
// stretch of its flight and can't be intercepted there, so a defender sitting
// on the passer gets played over instead of blocking everything; it lands well
// short of the target, so whoever marks the receiver can still read it.
const PASS_LOFT_FRAC    = 0.55;  // share of the pass distance spent in the air
const PASS_LOFT_MIN     = 55;    // even a short ball gets a little hop (px)
const KNOCKBACK_SPEED   = 1.8;   // was 4 — nearly as fast as a pass, which could fling the
                                  // ball if it clipped the ball on the way (see _moveTeam's
                                  // stun handling, which also keeps the ball from hitting them)
const STUN_MS           = 2500;  // how long the loser is frozen after a duel
// Fatigue: physical condition (stamina, from each player's roster FP) drains
// at a flat rate all match — it's the size of the tank that varies per
// player, not the burn rate. Tuned against the roster's average FP (~150)
// over a full 6-minute match (2x HALF_S) so an average player is running on
// empty by full time. Only kicks in once stamina drops under the threshold,
// easing speed down to the floor multiplier rather than a hard cliff.
const FATIGUE_DRAIN_PER_SEC = 150/(2*180);
const FATIGUE_THRESHOLD  = 0.4;  // fraction of maxStamina below which speed starts to drop
const FATIGUE_MIN_MUL    = 0.55; // speed multiplier floor at 0 stamina
const TEAM_SIZE         = 11;
const BENCH_MAX         = 5;
const BENCH_COVER       = ['GK','DF','MF','FW','MF']; // positions the auto-picked bench covers
const HALF_S            = 3 * 60;
const STATE_HZ          = 20;
const SCROLL_SPEED      = 220;   // px/s when a scroll button is held

// Physics forces — the ball carrier is only slightly sharper than everyone
// else now; off-ball players used to crawl (AUTO_STEER_FORCE/MAX_SPEED were
// ~65% of the carrier's), which made the team look frozen even though
// _offBallTarget was constantly recomputing good runs for them — they just
// couldn't get there with any urgency.
const STEER_FORCE           = 0.00034;
const AUTO_STEER_FORCE      = 0.00032;
const BASE_MAX_SPEED        = 0.72;
const AUTO_MAX_SPEED        = 0.66;
// A player following a drawn line sprints: draw somewhere and it's a
// deliberate run, so they push harder and cap out faster than everyone
// else — but only as much as their legs currently allow. The bonus scales
// with their CURRENT stamina (not just speed's own fatigue cutoff below),
// so it fades out well before a player is fully gassed instead of being a
// flat boost right up until they hit the wall.
const SPRINT_MAX_SPEED_BONUS = 0.18; // +18% top speed at full stamina, tapering to +0%
const SPRINT_MAX_FORCE_BONUS = 0.15;

// Off-ball behaviour: how strongly teammates push forward to support the
// ball carrier, and how close a defender presses the opponent on the ball.
const SUPPORT_BLEND  = 0.65;
const PRESS_BLEND    = 0.5;
const PRESS_RANGE    = 260;

// The formation spans the whole pitch, not just the defending half: the
// deepest slot sits on its own goal line and the most advanced one pushes
// up near the rival box, so defenders/midfielders/forwards end up in their
// own thirds and there's room between the lines to actually pass into.
// SLOT_Y_* is the range the FORMATIONS presets below are authored in.
const SLOT_Y_MIN  = 0.06;
const SLOT_Y_MAX  = 0.66;
const FORM_DEEPEST = 0.05;  // fraction of pitch length, measured from own goal
const FORM_HIGHEST = 0.84;

// A loose ball is worth breaking shape for — whoever is closest chases it
// down at full speed, as does anyone it has been played right next to.
const BALL_CHASE_RANGE   = 210;
const KEEPER_CHASE_RANGE = 130;

// AI difficulty (solo-vs-AI only). All decision-making rather than raw
// speed, so a harder opponent plays sharper instead of simply outrunning
// you: how readily it spends PT on a supertechnique, from how far out it
// will shoot, how decisively it pulls the trigger once in range, and how
// often it looks for a pass.
const AI_LEVELS = {
  easy:   { techChance:0.25, shootRange:190, shootChance:0.10, passChance:0.006 },
  normal: { techChance:0.45, shootRange:300, shootChance:0.35, passChance:0.012 },
  hard:   { techChance:0.70, shootRange:420, shootChance:0.70, passChance:0.022 }
};
const AI_LEVEL_DEFAULT = 'normal';

// Fouls are meant to be a rare punctuation, not a regular interruption:
// roughly one duel in a hundred, a little more often for weaker defenders.
// Set FOUL_CHANCE_BASE to 0 to turn fouls (and so cards/penalties) off.
const FOUL_CHANCE_BASE = 0.01;
const FOUL_CHANCE_MIN  = 0.004;
const FOUL_CHANCE_MAX  = 0.015;

// Off-ball players drift around their formation anchor instead of parking
// exactly on it. Two slow, out-of-phase sine waves per player (periods are
// deliberately not multiples of each other) keep the motion smooth and
// non-repeating rather than twitchy like per-tick noise would be.
const WANDER_AMPLITUDE = 52;
const WANDER_PERIOD_X  = 3100;  // ms
const WANDER_PERIOD_Y  = 4300;  // ms

// When a drawn path runs out while the team is attacking, the player keeps
// making ground toward the rival goal instead of turning back to formation.
const RUN_ON_STEP = 170;   // how far ahead the next carry-on waypoint sits
const RUN_ON_STOP = 150;   // stop running on once this close to the byline

// Duels trigger on proximity, not physical contact — see collision
// categories below — with a slightly generous radius (bigger than the old
// ~24px body-touch distance) so they feel less pixel-perfect.
const DUEL_HITBOX_RADIUS = 42;

// Collision categories. Players share one category and don't include each
// other in their mask, so they pass through one another freely; only the
// ball (and the world-bounds walls, default category) still push them
// around. The ball itself excludes the boundary walls so it can be caught
// travelling past the touch/goal lines for throw-ins/corners/goal-kicks
// instead of bouncing off an invisible wall.
const CAT_DEFAULT = 0x0001;
const CAT_PLAYER  = 0x0002;
const CAT_BALL    = 0x0004;
const CAT_GOAL    = 0x0008;

// ─── Formation presets ───────────────────────────────────────────────────
// Slot 0 = keeper. x=0..1 secondary axis, y=0..1 primary from own goal→halfway
const FORMATIONS = {
  '4-4-2': [
    {x:.50,y:.06},{x:.15,y:.22},{x:.38,y:.18},{x:.62,y:.18},{x:.85,y:.22},
    {x:.15,y:.42},{x:.38,y:.40},{x:.62,y:.40},{x:.85,y:.42},
    {x:.35,y:.62},{x:.65,y:.62}
  ],
  '4-3-3': [
    {x:.50,y:.06},{x:.16,y:.22},{x:.38,y:.18},{x:.62,y:.18},{x:.84,y:.22},
    {x:.25,y:.42},{x:.50,y:.38},{x:.75,y:.42},
    {x:.22,y:.60},{x:.50,y:.64},{x:.78,y:.60}
  ],
  '4-2-3-1': [
    {x:.50,y:.06},{x:.15,y:.20},{x:.38,y:.16},{x:.62,y:.16},{x:.85,y:.20},
    {x:.35,y:.33},{x:.65,y:.33},
    {x:.20,y:.50},{x:.50,y:.48},{x:.80,y:.50},{x:.50,y:.66}
  ],
  '3-5-2': [
    {x:.50,y:.06},{x:.25,y:.19},{x:.50,y:.17},{x:.75,y:.19},
    {x:.12,y:.38},{x:.32,y:.34},{x:.50,y:.32},{x:.68,y:.34},{x:.88,y:.38},
    {x:.38,y:.61},{x:.62,y:.61}
  ]
};
const DEFAULT_FORMATION = '4-4-2';

// Slot-role mapping: GK=keeper, DF=last rows, MF=mid, FW=front
const SLOT_ROLES = {
  '4-4-2': ['GK','DF','DF','DF','DF','MF','MF','MF','MF','FW','FW'],
  '4-3-3': ['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW'],
  '4-2-3-1':['GK','DF','DF','DF','DF','MF','MF','MF','MF','MF','FW'],
  '3-5-2': ['GK','DF','DF','DF','MF','MF','MF','MF','MF','FW','FW']
};

// ─── Colour helpers ───────────────────────────────────────────────────────
const GAME_FALLBACK = {
  IE1:0x3399ff,IE2:0xff8800,IE3:0x44cc55,
  GO1:0xcc44ff,GO2:0xff4488,GO3:0x44cccc,
  Ares:0xddcc22,VR:0x888888
};
function hexToInt(h){ const n=parseInt((h||'').replace('#',''),16); return isNaN(n)?null:n; }

/** Guarantee two colors are visually distinct (≥100 luminance distance). */
function distinctColor(baseColor, takenColor){
  const OPTIONS=[0x3399ff,0xff4444,0x44cc55,0xffdd00,0xcc44ff,0xff8800,0x00cccc,0xff6699];
  function dist(a,b){
    const ra=(a>>16)&0xff,ga=(a>>8)&0xff,ba=a&0xff;
    const rb=(b>>16)&0xff,gb=(b>>8)&0xff,bb=b&0xff;
    return Math.abs(ra-rb)+Math.abs(ga-gb)+Math.abs(ba-bb);
  }
  if(dist(baseColor,takenColor)>100) return baseColor;
  const alt=OPTIONS.find(c=>dist(c,takenColor)>100&&dist(c,baseColor)>40);
  return alt??0xffffff;
}

export default class GameScene extends Phaser.Scene {
  constructor(){ super('GameScene'); }

  // ════════════════════════════════════════════════════════════════════
  create(){
    // Logical field is fixed; the viewport is whatever the actual canvas
    // size is (the whole screen — see main.js RESIZE mode), so a landscape
    // device sees a wide window into the pitch instead of a portrait strip.
    this.FIELD_W = FIELD_LOGICAL_W;
    this.FIELD_H = FIELD_LOGICAL_H;
    // The visible world is taller than the pitch: the run-off behind each goal
    // is scenery the camera can reach, not playable space (physics bounds stay
    // on the pitch below).
    this.WORLD_Y_MIN = -GOAL_RUNOFF;
    this.WORLD_Y_MAX = this.FIELD_H + GOAL_RUNOFF;
    this.VP_W    = this.scale.width  || VIEWPORT_W;
    this.VP_H    = this.scale.height || VIEWPORT_H;
    this.scale.on('resize', gameSize=>this._onResize(gameSize));

    const roomCode=getOrCreateRoomCode();
    document.getElementById('room-code').textContent=roomCode;
    this.net=connectToRoom(roomCode);
    this.role=this.net.isHost()?'A':'B';

    this._drawField();
    this.pathGfx=this.add.graphics();

    this.matter.world.setBounds(0,0,this.FIELD_W,this.FIELD_H);
    this.ball=this.matter.add.circle(this.FIELD_W/2,this.FIELD_H/2,10,
      {restitution:.7,frictionAir:BALL_FRICTION_AIR,label:'ball',
       collisionFilter:{category:CAT_BALL,mask:CAT_PLAYER|CAT_GOAL}});
    this.ballGfx=this.add.circle(this.ball.position.x,this.ball.position.y,10,0xffffff).setDepth(3);
    // Sits on the ground under a ball in flight, so a chipped pass reads as
    // one rather than as a ball that ignored a defender.
    this.ballShadow=this.add.ellipse(this.ball.position.x,this.ball.position.y,17,11,0x000000,0.38).setDepth(2).setVisible(false);
    this.ballFlight=null;
    this._clientBall=null;
    this._drawGoals();

    this.possRing=this.add.circle(0,0,20).setStrokeStyle(3,0xffd966).setFillStyle(0,0).setVisible(false).setDepth(4);

    // Camera setup: camera scrolls over the logical world
    this.cameras.main.setBounds(0,this.WORLD_Y_MIN,this.FIELD_W,this.WORLD_Y_MAX-this.WORLD_Y_MIN);
    this.cameras.main.setSize(this.VP_W,this.VP_H);
    this.cameras.main.scrollX=this.FIELD_W/2-this.VP_W/2;
    this.cameras.main.scrollY=this.FIELD_H/2-this.VP_H/2;
    this._clampScroll();
    this.scrollKeys={up:false,down:false,left:false,right:false};
    this.joyVec={x:0,y:0};
    this._setupScrollInput();

    // Teams
    this.teamA=[]; this.teamB=[];
    this.statsMapA=new Map(); this.statsMapB=new Map();
    this.activeIdA=null; this.activeIdB=null;
    this.teamColorA=0x3399ff; this.teamColorB=0xff4444;
    this.stunMap=new Map(); // rosterId -> unstun timestamp
    this.bodyOwner=new Map(); // Matter body -> {role,id}, for attributing ball touches
    this.cards=new Map();  // "role:id" -> {yellow, red}
    this.lastTouch=null;   // {role,id} of whoever last touched the ball (host only)
    this.score={a:0,b:0};
    this.clientTeamsBuilt=false;
    this.formation={A:DEFAULT_FORMATION,B:DEFAULT_FORMATION};
    this.pendingFormChange=null;

    this.matchClock={half:1,secondsRemaining:HALF_S,ended:false};
    this._fullTimeShown=false; this._fullTimeTimer=null;
    this.possRole=null; this.currentPossession=null;
    this.duelLockUntil=0; this.confrontation=null;
    this.confrontResult=null;
    this._lastFxUntil=0;

    this.matchStarted=false;
    this.squadSlots=Array(TEAM_SIZE).fill(null);
    this.benchIds=new Set();
    this.chosenFormation=DEFAULT_FORMATION;
    // Rival-team state, only used solo vs AI — a real connected opponent
    // always picks their own squad regardless of what's set here.
    this.editSide='me';
    this.rivalSquadSlots=Array(TEAM_SIZE).fill(null);
    this.rivalBenchIds=new Set();
    this.rivalFormation=DEFAULT_FORMATION;
    this.aiLevel=AI_LEVEL_DEFAULT;
    this.mySquadConfirmed=false;
    this.mySquadPayload=null;
    this.remoteSquadPayload=null;

    this.myPaths=new Map();
    // Ids whose current path is purely the automatic "keep running" carry-on
    // (see _runOnWaypoint) rather than anything the player actually drew —
    // kept separate so _drawPaths can skip rendering a line for it.
    this.autoPathIds=new Set();
    this.drawing=false;
    this.selectedPlayerId=null;
    this.gestureStart=null; this.gestureMoved=false;
    this.pendingShoot=false; this.pendingPass=null;
    this.pendingChoice=null; this.pendingSub=null; this.pendingReposition=null; this.subSel=null; this._squadSel=null;
    this.lastStateSent=0;

    // Pointer handlers
    this.input.on('pointerdown',(p)=>this._pointerDown(p));
    this.input.on('pointermove',(p)=>{ if(p.isDown) this._pointerMove(p); });
    this.input.on('pointerup',(p)=>this._pointerUp(p));
    this.input.on('pointerupoutside',(p)=>this._pointerUp(p));

    document.getElementById('conf-normal').addEventListener('pointerdown',(e)=>{e.stopPropagation();this.pendingChoice='normal';});
    // Technique buttons are rebuilt per confrontation (a player can have more
    // than one of the same category — see techniquesFor), so this listens on
    // their shared container instead of a single fixed button.
    document.getElementById('conf-tech-list').addEventListener('pointerdown',(e)=>{
      const btn=e.target.closest('.conf-btn'); if(!btn||btn.disabled) return;
      e.stopPropagation();
      this.pendingChoice={tech:parseInt(btn.dataset.idx,10)};
    });
    document.getElementById('fulltime-menu-btn').addEventListener('click',()=>this._returnToMenu());
    document.getElementById('sub-button').addEventListener('click',()=>this._openSubPanel());
    document.getElementById('sub-cancel-btn').addEventListener('click',()=>{this.subSel=null;document.getElementById('sub-panel').style.display='none';});

    // Roster load → squad editor
    this.rosterAll=[];
    document.getElementById('squad-pick-list').innerHTML='<p style="opacity:.8;font-size:12px;">Loading roster…</p>';
    loadRoster().then(data=>{
      this.rosterAll=data;
      const gs=document.getElementById('squad-game-filter');
      getGames().forEach(g=>{ const o=document.createElement('option'); o.value=g; o.textContent=g; gs.appendChild(o); });
      const ts=document.getElementById('squad-team-filter');
      getTeams().forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; ts.appendChild(o); });
      // Several characters (Mark Evans, Axel Blaze...) show up once per game
      // they appeared in, as separate roster entries with their own stats —
      // same name, same real team, so cards need the game tag too or they're
      // indistinguishable. Precomputed once so every card render is cheap.
      const seen=new Map();
      data.forEach(p=>seen.set(p.name,(seen.get(p.name)||0)+1));
      this.duplicateNames=new Set([...seen].filter(([,n])=>n>1).map(([name])=>name));
      this._initSquadEditor();
    }).catch(err=>{ document.getElementById('squad-pick-list').innerHTML=`<p style="color:#f88">Couldn't load roster.<br>${err.message}</p>`; });

    document.getElementById('confirm-squad-btn').addEventListener('click',()=>this._confirmSquad());

    // Networking
    this.remoteState=null;
    this.remoteInput={targets:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,repositionRequest:null,formationChange:null};
    this.net.onInput(d=>{ this.remoteInput=d; });
    this.net.onState(d=>this._incomingState(d));
    this.net.onSquad(d=>{ this.remoteSquadPayload=d; if(this.role==='A'&&this.mySquadConfirmed&&!this.matchStarted) this._startMatch(this.mySquadPayload,d); });
    this.matter.world.on('collisionstart',ev=>this._collisions(ev));
  }

  // ════════════════════════════════════════════════════════════════════
  // Field & camera
  // ════════════════════════════════════════════════════════════════════
  _drawField(){
    const w=this.FIELD_W, h=this.FIELD_H;
    // Surround: the darker apron behind each goal, so the run-off reads as part
    // of the ground rather than as empty space off the edge of the world.
    this.add.rectangle(w/2,(this.WORLD_Y_MIN+this.WORLD_Y_MAX)/2,w,this.WORLD_Y_MAX-this.WORLD_Y_MIN,0x11512a).setDepth(-1);
    // Full field background
    this.add.rectangle(w/2,h/2,w,h,0x1e7a3c).setStrokeStyle(5,0xffffff).setDepth(0);
    // Halfway line
    this.add.rectangle(w/2,h/2,w,2,0xffffff).setAlpha(0.5).setDepth(1);
    // Centre circle
    this.add.circle(w/2,h/2,60).setStrokeStyle(2,0xffffff,0.5).setFillStyle(0,0).setDepth(1);
    // Penalty areas
    const paW=w*0.5, paH=h*0.12;
    this.PA_W=paW; this.PA_H=paH; // kept for foul → penalty-vs-free-kick checks
    this.add.rectangle(w/2,paH/2,paW,paH).setStrokeStyle(2,0xffffff,0.5).setFillStyle(0,0).setDepth(1);
    this.add.rectangle(w/2,h-paH/2,paW,paH).setStrokeStyle(2,0xffffff,0.5).setFillStyle(0,0).setDepth(1);
  }

  _drawGoals(){
    const w=this.FIELD_W, h=this.FIELD_H;
    // Visual: a box reaching back from the goal line into the run-off. Tapping
    // a line was fiddly — anywhere in the box counts as "shoot here".
    const box=(lineY,dir)=>{
      const cy=lineY+dir*GOAL_DEPTH/2;
      this.add.rectangle(w/2,cy,GOAL_HALF_WIDTH*2,GOAL_DEPTH,0xffffff,0.16).setStrokeStyle(4,0xffffff,0.9).setDepth(2);
      for(let i=1;i<4;i++) this.add.rectangle(w/2-GOAL_HALF_WIDTH+i*(GOAL_HALF_WIDTH/2),cy,1,GOAL_DEPTH,0xffffff).setAlpha(0.28).setDepth(2);
      this.add.rectangle(w/2,lineY,GOAL_HALF_WIDTH*2,6,0xffffff).setDepth(2);
    };
    box(0,-1); box(h,1);
    // Physics sensors
    this.goalMin=this.matter.add.rectangle(w/2,0,GOAL_HALF_WIDTH*2,16,{isSensor:true,isStatic:true,label:'goalMin',collisionFilter:{category:CAT_GOAL,mask:CAT_BALL}});
    this.goalMax=this.matter.add.rectangle(w/2,h,GOAL_HALF_WIDTH*2,16,{isSensor:true,isStatic:true,label:'goalMax',collisionFilter:{category:CAT_GOAL,mask:CAT_BALL}});
  }

  /** True if `pos` is inside the goal-area penalty box that `defendingRole`
   *  defends (used to tell a penalty from a plain free kick after a foul). */
  _inPenaltyBox(defendingRole,pos){
    const withinX=pos.x>=this.FIELD_W/2-this.PA_W/2&&pos.x<=this.FIELD_W/2+this.PA_W/2;
    if(!withinX) return false;
    return defendingRole==='A' ? pos.y>=this.FIELD_H-this.PA_H : pos.y<=this.PA_H;
  }

  _setupScrollInput(){
    // Keyboard (PC)
    const kb=this.input.keyboard;
    // Arrows and WASD both pan the camera on desktop.
    const bind=(keys,dir)=>keys.forEach(k=>{
      kb.on(`keydown-${k}`,()=>{this.scrollKeys[dir]=true;});
      kb.on(`keyup-${k}`,  ()=>{this.scrollKeys[dir]=false;});
    });
    bind(['UP','W'],'up');     bind(['DOWN','S'],'down');
    bind(['LEFT','A'],'left'); bind(['RIGHT','D'],'right');
    this._setupJoystick();
  }

  /** Virtual joystick (mobile) driving continuous camera-scroll velocity,
   *  replacing the old 4-button d-pad (which was fine on PC but fiddly to
   *  hit precisely on a phone). */
  _setupJoystick(){
    const base=document.getElementById('joy-base'), stick=document.getElementById('joy-stick');
    if(!base||!stick) return;
    const maxR=25;
    let activeId=null;
    const setVec=(dx,dy)=>{
      const d=Math.hypot(dx,dy), cl=Math.min(d,maxR);
      const nx=d?dx/d:0, ny=d?dy/d:0;
      this.joyVec.x=nx*(cl/maxR); this.joyVec.y=ny*(cl/maxR);
      stick.style.transform=`translate(${nx*cl}px, ${ny*cl}px)`;
    };
    const reset=()=>{ this.joyVec.x=0; this.joyVec.y=0; stick.style.transform='translate(0,0)'; };
    const fromEvent=e=>{ const r=base.getBoundingClientRect(); setVec(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2)); };
    base.addEventListener('pointerdown',e=>{ e.stopPropagation(); activeId=e.pointerId; base.setPointerCapture(e.pointerId); fromEvent(e); });
    base.addEventListener('pointermove',e=>{ if(e.pointerId!==activeId) return; fromEvent(e); });
    const end=e=>{ if(e.pointerId!==activeId) return; activeId=null; reset(); };
    base.addEventListener('pointerup',end);
    base.addEventListener('pointerleave',end);
    base.addEventListener('pointercancel',end);
  }

  _onResize(gameSize){
    this.VP_W=gameSize.width; this.VP_H=gameSize.height;
    this.cameras.main.setSize(this.VP_W,this.VP_H);
    this._clampScroll();
  }

  /** Keeps the camera inside the world, which now reaches past both goal lines
   *  by GOAL_RUNOFF so the goals can be centred on screen. */
  _clampScroll(){
    const cam=this.cameras.main;
    cam.scrollX=Phaser.Math.Clamp(cam.scrollX,0,Math.max(0,this.FIELD_W-this.VP_W));
    cam.scrollY=Phaser.Math.Clamp(cam.scrollY,this.WORLD_Y_MIN,Math.max(this.WORLD_Y_MIN,this.WORLD_Y_MAX-this.VP_H));
  }

  _tickScroll(delta){
    const cam=this.cameras.main;
    const spd=SCROLL_SPEED*(delta/1000);
    const kx=(this.scrollKeys.left?-1:0)+(this.scrollKeys.right?1:0);
    const ky=(this.scrollKeys.up?-1:0)+(this.scrollKeys.down?1:0);
    const vx=Phaser.Math.Clamp(kx+this.joyVec.x,-1,1);
    const vy=Phaser.Math.Clamp(ky+this.joyVec.y,-1,1);
    cam.scrollX+=vx*spd; cam.scrollY+=vy*spd;
    this._clampScroll();
  }

  /** Convert screen (pointer) coords to world coords accounting for camera. */
  _toWorld(x,y){
    const cam=this.cameras.main;
    return {x:x+cam.scrollX, y:y+cam.scrollY};
  }

  // ════════════════════════════════════════════════════════════════════
  // Avatar / color helpers
  // ════════════════════════════════════════════════════════════════════
  _rosterColor(p){ return hexToInt(p&&p.teamColor)??(GAME_FALLBACK[p&&p.game]??0x999999); }
  _initials(p){ return (p.nickname||p.name||'?').split(' ').map(w=>w[0]||'').slice(0,2).join('').toUpperCase(); }
  _css3(intC){ return '#'+intC.toString(16).padStart(6,'0'); }

  _squadColor(ids, fallback){
    const counts={};
    ids.forEach(id=>{ const p=getPlayerById(id); const c=p?.teamColor; if(c) counts[c]=(counts[c]||0)+1; });
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    return top?hexToInt(top[0]):fallback;
  }

  // ════════════════════════════════════════════════════════════════════
  // Squad editor (topological pitch)
  // ════════════════════════════════════════════════════════════════════
  _initSquadEditor(){
    document.getElementById('formation-select').addEventListener('change',e=>{
      this._edSetFormation(e.target.value); this._renderPitch();
    });
    document.getElementById('randomize-squad-btn').addEventListener('click',()=>this._randomize());
    document.getElementById('squad-whole-team-btn').addEventListener('click',()=>this._useWholeTeam());
    document.getElementById('squad-search').addEventListener('input',()=>this._renderPickList());
    document.getElementById('squad-game-filter').addEventListener('change',()=>this._renderPickList());
    document.getElementById('squad-team-filter').addEventListener('change',()=>this._renderPickList());
    document.getElementById('squad-remove-btn').addEventListener('click',()=>this._removeSelectedFromSquad());
    document.getElementById('ai-level-select').addEventListener('change',e=>{ this.aiLevel=e.target.value; });
    document.querySelectorAll('#squad-side-tabs .squad-side-tab').forEach(btn=>btn.addEventListener('click',()=>this._setEditSide(btn.dataset.side)));
    document.querySelectorAll('.view-tab').forEach(btn=>btn.addEventListener('click',()=>this._setSquadView(btn.dataset.view)));
    // Give the rival a full, position-aware random XI up front — it plays
    // fine untouched, and is only ever used solo vs AI.
    this.editSide='rival'; this._fillSquadByPosition(this.rosterAll); this.editSide='me';
    this._setSquadView('formation');
    this._renderPitch(); this._renderPickList();
  }

  /** Switches which half of the squad editor is on screen — the pitch/bench
   *  ("formation") or the searchable player list ("players") — so mobile
   *  isn't stuck scrolling past one to reach the other. Both edit the same
   *  squad; this changes nothing about which side (me/rival) is active. */
  _setSquadView(view){
    this.squadView=view;
    document.getElementById('squad-editor').style.display=view==='formation'?'block':'none';
    document.getElementById('squad-players-view').classList.toggle('active',view==='players');
    document.querySelectorAll('.view-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  }

  // ---- which side ("me"/"rival") the pitch editor currently shows -------
  _edSlots(){ return this.editSide==='rival'?this.rivalSquadSlots:this.squadSlots; }
  _edSetSlots(v){ if(this.editSide==='rival') this.rivalSquadSlots=v; else this.squadSlots=v; }
  _edBench(){ return this.editSide==='rival'?this.rivalBenchIds:this.benchIds; }
  _edSetBench(v){ if(this.editSide==='rival') this.rivalBenchIds=v; else this.benchIds=v; }
  _edFormation(){ return this.editSide==='rival'?this.rivalFormation:this.chosenFormation; }
  _edSetFormation(v){ if(this.editSide==='rival') this.rivalFormation=v; else this.chosenFormation=v; }

  _setEditSide(side){
    this.editSide=side;
    document.getElementById('formation-select').value=this._edFormation();
    document.querySelectorAll('.squad-side-tab').forEach(b=>b.classList.toggle('active',b.dataset.side===side));
    document.getElementById('rival-tab-note').style.display=side==='rival'?'block':'none';
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }

  /** Fills in any slot the rival XI is still missing at confirm time (e.g.
   *  the user removed someone there and never replaced them) — the rival
   *  never blocks the match from starting the way your own squad does. */
  _rivalSquadPayload(){
    const slots=this.rivalSquadSlots.slice();
    if(slots.some(id=>!id)){
      const exclude=new Set([...slots.filter(Boolean),...this.rivalBenchIds]);
      const roles=SLOT_ROLES[this.rivalFormation]||SLOT_ROLES[DEFAULT_FORMATION];
      const byPos={};
      for(const p of this.rosterAll) if(!exclude.has(p.id)) (byPos[p.position]=byPos[p.position]||[]).push(p);
      Object.values(byPos).forEach(list=>Phaser.Utils.Array.Shuffle(list));
      const take=pos=>{ const l=byPos[pos]; return l&&l.length?l.pop().id:null; };
      const takeAny=()=>{ for(const l of Object.values(byPos)) if(l.length) return l.pop().id; return null; };
      for(let i=0;i<slots.length;i++) if(!slots[i]) slots[i]=take(roles[i])||takeAny();
    }
    return {starterIds:slots.filter(Boolean),benchIds:[...this.rivalBenchIds],formation:this.rivalFormation};
  }

  /** Drops whichever pitch/bench player is currently selected back into the
   *  pool, leaving their slot empty. */
  _removeSelectedFromSquad(){
    const sel=this._squadSel; if(!sel) return;
    if(sel.type==='slot') this._edSlots()[sel.slot]=null;
    else this._edBench().delete(sel.id);
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }

  _allInSquad(){
    const s=new Set(this._edSlots().filter(Boolean));
    this._edBench().forEach(id=>s.add(id)); return s;
  }

  _renderPitch(){
    const pitch=document.getElementById('formation-pitch');
    pitch.innerHTML='<div class="pitch-line-h"></div>';
    const formation=this._edFormation();
    const preset=FORMATIONS[formation]||FORMATIONS[DEFAULT_FORMATION];
    const roles=SLOT_ROLES[formation]||SLOT_ROLES[DEFAULT_FORMATION];
    const slots=this._edSlots();
    const sel=this._squadSel;
    preset.forEach((f,slot)=>{
      const pin=document.createElement('div');
      pin.className='slot-pin'; pin.dataset.slot=slot;
      pin.style.left=(f.x*100)+'%';
      pin.style.top =((1-f.y)*100)+'%';
      const pid=slots[slot]; const p=pid?getPlayerById(pid):null;
      if(p){
        const col=this._css3(this._rosterColor(p));
        pin.innerHTML=`<div class="pin-avatar" style="background:${col}">${this._initials(p)}</div><div class="pin-name">${p.nickname||p.name}</div>`;
      } else {
        pin.classList.add('empty');
        pin.innerHTML=`<div style="font-size:9px;opacity:.55">${roles[slot]}</div>`;
      }
      if(sel&&sel.type==='slot'&&sel.slot===slot) pin.classList.add('selected');
      pin.addEventListener('click',()=>this._onSquadPinClick({type:'slot',slot}));
      pitch.appendChild(pin);
    });
    const strip=document.getElementById('bench-strip'); strip.innerHTML='';
    [...this._edBench()].forEach(pid=>{
      const p=getPlayerById(pid); if(!p) return;
      const pin=document.createElement('div'); pin.className='bench-pin'; pin.dataset.benchId=pid;
      const col=this._css3(this._rosterColor(p));
      pin.innerHTML=`<div class="pin-avatar" style="background:${col};width:32px;height:32px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:rgba(0,0,0,.8)">${this._initials(p)}</div><div class="pin-name">${p.nickname||p.name}</div>`;
      if(sel&&sel.type==='bench'&&sel.id===pid) pin.classList.add('selected');
      pin.addEventListener('click',()=>this._onSquadPinClick({type:'bench',id:pid}));
      strip.appendChild(pin);
    });
    document.getElementById('bench-count').textContent=this._edBench().size;
    // The counter/button reflect the side on screen, but starting the match
    // only ever needs YOUR OWN squad complete — the rival tops itself off
    // automatically (see _rivalSquadPayload), so it never blocks Confirm.
    const shownFilled=slots.filter(Boolean).length;
    const shownRating=this._teamRating(slots);
    document.getElementById('squad-fill-count').textContent=`${shownFilled}/11 filled${shownRating!=null?` · ⭐ ${shownRating} avg`:''}`;
    const myFilled=this.squadSlots.filter(Boolean).length;
    const btn=document.getElementById('confirm-squad-btn');
    btn.textContent=`Confirm squad (${myFilled}/11)`; btn.disabled=myFilled!==TEAM_SIZE;
    // Offer the remove action only while a selected pin actually holds someone
    const selP=sel?this._squadSelPlayer(sel):null;
    const bar=document.getElementById('squad-remove-bar');
    bar.style.display=selP?'flex':'none';
    if(selP) document.getElementById('squad-remove-btn').textContent=`✕ Remove ${selP.nickname||selP.name}`;
  }

  /** Team/game line for a card — with the game tag added whenever this
   *  name shows up more than once in the roster (the same character
   *  appearing once per game they were in, e.g. Mark Evans in both IE1 and
   *  Ares), since otherwise two such cards read as identical duplicates. */
  _teamLine(p){
    const base=p.team||p.game;
    if(!this.duplicateNames?.has(p.name)) return base;
    return p.team?`${base} (${p.game})`:base;
  }

  /** A single summary number from a player's 5 core stats — not a new
   *  gameplay stat, just something readable for the cards, on a rough
   *  0-99 scale (stats themselves average ~1.0, scaled up so a typical
   *  player lands somewhere around 70 rather than reading as "1"). */
  _playerRating(p){
    const st=p.stats;
    const avg=(st.speed+st.shotPower+st.dribblePower+st.defensePower+st.keeperPower)/5;
    return Phaser.Math.Clamp(Math.round(avg*70),30,99);
  }
  /** Average rating across a set of roster ids (a squad's XI, say) — null
   *  if there's nobody to average yet. */
  _teamRating(ids){
    const players=(ids||[]).filter(Boolean).map(id=>getPlayerById(id)).filter(Boolean);
    if(!players.length) return null;
    return Math.round(players.reduce((sum,p)=>sum+this._playerRating(p),0)/players.length);
  }

  _showPlayerStats(p){
    // Populate and show the stat panel overlay
    const el=document.getElementById('player-stat-panel');
    const col=this._css3(this._rosterColor(p));
    // All of a category's techniques, not just the one active in combat —
    // a player with two of the same kind can use either (see techniquesFor).
    const techs=['shot','dribble','defense','keeper'].flatMap(cat=>techniquesFor(p,cat))
      .map(t=>`<div style="display:flex;justify-content:space-between;gap:8px"><span>${t.name}</span><span style="opacity:.7">${t.cost} PT</span></div>`).join('');
    const st=p.stats;
    // Mid-match, whoever's actually on the pitch has live PT/stamina; show
    // current/total for them. Otherwise (pre-match, or still on the bench)
    // there's no "current" yet, just their fresh starting totals.
    const live=this.matchStarted?this._statsFor(this.role,p.id):null;
    const ptLine=live?`${Math.round(live.sp)}/${Math.round(live.maxSP)}`:`${p.maxSP||100} max`;
    const staLine=live?`${Math.round(live.stamina)}/${Math.round(live.maxStamina)}`:`${p.maxStamina||150} max`;
    el.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="width:44px;height:44px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:bold;color:rgba(0,0,0,.8);flex-shrink:0">${this._initials(p)}</span>
        <div>
          <div style="font-weight:bold;font-size:15px">${p.name} <span style="opacity:.75;font-weight:normal;font-size:12px">· ⭐ ${this._playerRating(p)}</span></div>
          <div style="font-size:12px;opacity:.75">${p.position} · ${this._teamLine(p)}</div>
        </div>
        <button onclick="document.getElementById('player-stat-panel').style.display='none'" style="margin-left:auto;background:none;border:none;color:white;font-size:20px;cursor:pointer">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;margin-bottom:10px;">
        <div>⚡ Shot <b>${st.shotPower.toFixed(2)}</b></div>
        <div>💨 Dribble <b>${st.dribblePower.toFixed(2)}</b></div>
        <div>🛡 Defense <b>${st.defensePower.toFixed(2)}</b></div>
        <div>🧤 Keeper <b>${st.keeperPower.toFixed(2)}</b></div>
        <div>🏃 Speed <b>${st.speed.toFixed(2)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;margin-bottom:10px;">
        <div>🔋 PT <b>${ptLine}</b></div>
        <div>🏋 Stamina <b>${staLine}</b></div>
      </div>
      ${techs?`<div style="font-size:11px;opacity:.7;margin-bottom:4px">Supertechniques:</div><div style="font-size:12px;display:flex;flex-direction:column;gap:3px">${techs}</div>`:'<div style="font-size:11px;opacity:.5">No supertechniques</div>'}
    `;
    el.style.display='block';
  }

  // Tap-to-swap: tap a pin to select it, tap a different one to swap them,
  // tap the same one again to view its stats. Replaces drag-and-drop, which
  // was unreliable on touch (lost pointer capture, accidental scrolling).
  _squadSel=null;
  _onSquadPinClick(sel){
    if(!this._squadSel){ this._squadSel=sel; this._renderPitch(); return; }
    if(this._squadSel.type===sel.type&&(sel.type==='slot'?this._squadSel.slot===sel.slot:this._squadSel.id===sel.id)){
      const p=this._squadSelPlayer(sel);
      this._squadSel=null; this._renderPitch();
      if(p) this._showPlayerStats(p);
      return;
    }
    this._swapSquadSelections(this._squadSel,sel);
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }
  _squadSelPlayer(sel){
    const id=sel.type==='slot'?this._edSlots()[sel.slot]:sel.id;
    return id?getPlayerById(id):null;
  }
  _swapSquadSelections(a,b){
    const slots=this._edSlots(), bench=this._edBench();
    if(a.type==='slot'&&b.type==='slot'){
      const tmp=slots[a.slot]; slots[a.slot]=slots[b.slot]; slots[b.slot]=tmp;
    } else if(a.type==='bench'&&b.type==='bench'){
      // Nothing changes — both stay on the bench.
    } else {
      const slotSel=a.type==='slot'?a:b, benchSel=a.type==='bench'?a:b;
      const cur=slots[slotSel.slot];
      slots[slotSel.slot]=benchSel.id;
      bench.delete(benchSel.id);
      if(cur) bench.add(cur);
    }
  }

  _renderPickList(){
    const list=document.getElementById('squad-pick-list');
    const q=(document.getElementById('squad-search').value||'').toLowerCase();
    const gf=document.getElementById('squad-game-filter').value;
    const tf=document.getElementById('squad-team-filter').value;
    const inSquad=this._allInSquad(); const MAX=120;
    const matches=this.rosterAll.filter(p=>(!gf||p.game===gf)&&(!tf||p.team===tf)&&(!q||p.name.toLowerCase().includes(q)||(p.nickname||'').toLowerCase().includes(q)));
    document.getElementById('pick-count').textContent=matches.length>MAX?`Showing ${MAX} of ${matches.length}`:`${matches.length} players`;
    list.innerHTML='';
    matches.slice(0,MAX).forEach(p=>{
      const card=document.createElement('div');
      card.className='pick-card'+(inSquad.has(p.id)?' in-squad':'');
      const col=this._css3(this._rosterColor(p));
      card.innerHTML=`<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;"><span class="av" style="width:20px;height:20px;font-size:8px;background:${col};flex-shrink:0">${this._initials(p)}</span><span class="pick-name">${p.nickname||p.name}</span><span style="margin-left:auto;font-size:10px;font-weight:bold;color:#ffd966;">${this._playerRating(p)}</span></div><div style="font-size:10px;opacity:.7">${p.position} · ${this._teamLine(p)}</div><div style="font-size:10px;opacity:.6">SPD ${p.stats.speed} SHT ${p.stats.shotPower}</div>`;
      card.addEventListener('click',()=>{ if(inSquad.has(p.id)){this._showPlayerStats(p);return;} const slots=this._edSlots(), bench=this._edBench(); const e=slots.findIndex(s=>s===null); if(e!==-1){slots[e]=p.id;}else if(bench.size<BENCH_MAX){bench.add(p.id);} this._renderPitch();this._renderPickList(); });
      list.appendChild(card);
    });
    document.getElementById('squad-whole-team-btn').disabled=!gf&&!tf;
  }

  /** Fills the XI from `pool` so every slot gets someone who actually plays
   *  that position (keeper slot from keepers, defensive slots from defenders
   *  and so on), then stocks the bench with a spread of cover. */
  _fillSquadByPosition(pool){
    const roles=SLOT_ROLES[this._edFormation()]||SLOT_ROLES[DEFAULT_FORMATION];
    const byPos={};
    for(const p of pool) (byPos[p.position]=byPos[p.position]||[]).push(p);
    Object.values(byPos).forEach(list=>Phaser.Utils.Array.Shuffle(list));
    const take=pos=>{ const l=byPos[pos]; return l&&l.length?l.pop().id:null; };
    const takeAny=()=>{ for(const l of Object.values(byPos)) if(l.length) return l.pop().id; return null; };
    const slots=roles.slice(0,TEAM_SIZE).map(r=>take(r));
    // A narrow pool (one club, say) may not field four defenders — backfill
    // from whoever is left so the XI still comes out complete.
    for(let i=0;i<TEAM_SIZE;i++) if(!slots[i]) slots[i]=takeAny();
    this._edSetSlots(slots);
    this._edSetBench(new Set(BENCH_COVER.map(pos=>take(pos)||takeAny()).filter(Boolean)));
  }

  _useWholeTeam(){
    const gf=document.getElementById('squad-game-filter').value;
    const tf=document.getElementById('squad-team-filter').value;
    if(!gf&&!tf) return;
    this._fillSquadByPosition(this.rosterAll.filter(p=>(!tf||p.team===tf)&&(!gf||p.game===gf)));
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }

  _randomize(){
    // Shape first, then fill it position by position — the slot roles depend
    // on the formation, so picking it afterwards would mismatch them.
    this._edSetFormation(Phaser.Utils.Array.GetRandom(Object.keys(FORMATIONS)));
    document.getElementById('formation-select').value=this._edFormation();
    this._fillSquadByPosition(this.rosterAll);
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }

  _confirmSquad(){
    const starterIds=this.squadSlots.filter(Boolean); if(starterIds.length!==TEAM_SIZE) return;
    const payload={starterIds,benchIds:[...this.benchIds],formation:this.chosenFormation};
    this.mySquadPayload=payload; this.mySquadConfirmed=true;
    this.net.sendSquad(payload);
    document.getElementById('confirm-squad-btn').disabled=true;
    if(this.role==='A'){
      if(!this.net.hasPeer()) this._startMatch(payload,this._rivalSquadPayload());
      else if(this.remoteSquadPayload) this._startMatch(payload,this.remoteSquadPayload);
      else document.getElementById('squad-status').textContent='Waiting for opponent…';
    } else { document.getElementById('squad-status').textContent='Waiting for match to start…'; }
  }


  // ════════════════════════════════════════════════════════════════════
  // Match setup
  // ════════════════════════════════════════════════════════════════════
  _buildTeam(role, starterIds, withPhysics){
    const team=[]; const map=role==='A'?this.statsMapA:this.statsMapB;
    const tColor=role==='A'?this.teamColorA:this.teamColorB;
    starterIds.forEach((id,slot)=>{
      const rp=getPlayerById(id); if(!rp) return;
      const pos=this._formPos(role,slot,{x:this.FIELD_W/2,y:this.FIELD_H/2},true);
      const body=withPhysics?this.matter.add.circle(pos.x,pos.y,12,{frictionAir:.16,label:`${role}${slot}`,
        collisionFilter:{category:CAT_PLAYER,mask:CAT_BALL|CAT_DEFAULT}}):null;
      if(body) this.bodyOwner.set(body,{role,id});
      const gfx=this.add.circle(pos.x,pos.y,12,tColor).setDepth(5);
      const label=this.add.text(pos.x,pos.y+15,rp.nickname||rp.name,
        {fontSize:'7px',color:'#fff',stroke:'#000',strokeThickness:3,resolution:3}).setOrigin(.5,0).setDepth(6);
      team.push({id,body,gfx,label,slot,wanderPhase:Math.random()*Math.PI*2});
      const st=createPlayerStats(); applyRosterPlayerToStats(st,rp); map.set(id,st);
    });
    return team;
  }

  _findGkId(ids){ return ids.find(id=>getPlayerById(id)?.position==='GK')||ids[0]; }

  _startMatch(payloadA,payloadB){
    this.formation.A=payloadA.formation||DEFAULT_FORMATION;
    this.formation.B=payloadB.formation||DEFAULT_FORMATION;
    // Ensure distinct team colors
    const rawA=this._squadColor(payloadA.starterIds,0x3399ff);
    const rawB=this._squadColor(payloadB.starterIds,0xff4444);
    this.teamColorA=rawA;
    this.teamColorB=distinctColor(rawB,rawA);
    this.teamA=this._buildTeam('A',payloadA.starterIds,true);
    this.teamB=this._buildTeam('B',payloadB.starterIds,true);
    this.benchA=(payloadA.benchIds||[]).filter(id=>getPlayerById(id));
    this.benchB=(payloadB.benchIds||[]).filter(id=>getPlayerById(id));
    this.gkIdA=this._findGkId(payloadA.starterIds);
    this.gkIdB=this._findGkId(payloadB.starterIds);
    this.activeIdA=this.teamA[0]?.id; this.activeIdB=this.teamB[0]?.id;
    this.matchStarted=true;
    document.getElementById('squad-editor-panel').style.display='none';
    document.getElementById('sub-button').style.display='block';
    document.getElementById('scroll-controls').style.display='flex';
  }

  _buildClientTeams(){
    if(this.clientTeamsBuilt||!this.mySquadPayload||!this.remoteSquadPayload) return;
    this.formation.A=this.remoteSquadPayload.formation||DEFAULT_FORMATION;
    this.formation.B=this.mySquadPayload.formation||DEFAULT_FORMATION;
    const rawA=this._squadColor(this.remoteSquadPayload.starterIds,0x3399ff);
    const rawB=this._squadColor(this.mySquadPayload.starterIds,0xff4444);
    this.teamColorA=rawA; this.teamColorB=distinctColor(rawB,rawA);
    this.teamA=this._buildTeam('A',this.remoteSquadPayload.starterIds,false);
    this.teamB=this._buildTeam('B',this.mySquadPayload.starterIds,false);
    this.benchA=this.remoteSquadPayload.benchIds||[]; this.benchB=this.mySquadPayload.benchIds||[];
    this.gkIdA=this._findGkId(this.remoteSquadPayload.starterIds);
    this.gkIdB=this._findGkId(this.mySquadPayload.starterIds);
    this.clientTeamsBuilt=true;
    document.getElementById('sub-button').style.display='block';
    document.getElementById('scroll-controls').style.display='flex';
  }

  /** Formation position in world coords. Defensive slot roles (GK/DF) stay deep;
   *  offensive ones (MF/FW) pull toward the ball's Y. */
  _formPos(role,slot,ballPos,clampOwnHalf=false){
    const preset=FORMATIONS[this.formation[role]]||FORMATIONS[DEFAULT_FORMATION];
    const roles=SLOT_ROLES[this.formation[role]]||SLOT_ROLES[DEFAULT_FORMATION];
    const f=preset[slot]||preset[preset.length-1];
    const slotRole=roles[slot]||'MF';

    const pSize=this.FIELD_H, sSize=this.FIELD_W, margin=40;

    // Base Y spread from own goal line up to near the rival box, so the
    // shape covers the full pitch. The team you control (role A) defends
    // the bottom of the map (pSize) and attacks toward 0, so its own
    // formation gets mirrored instead of B's.
    const depth=Phaser.Math.Clamp((f.y-SLOT_Y_MIN)/(SLOT_Y_MAX-SLOT_Y_MIN),0,1);
    let primary=(FORM_DEEPEST+depth*(FORM_HIGHEST-FORM_DEEPEST))*pSize;
    if(role==='A') primary=pSize-primary;

    // Secondary spread (X) tracks ball loosely
    let secondary=f.x*sSize;
    secondary+=Phaser.Math.Clamp((ballPos.x-sSize/2)*0.15,-50,50);

    // Autonomous "find space": pull forward/backward toward ball based on role
    const ballY=ballPos.y;
    const attackDir=role==='A'?-1:1;
    const toBall=(ballY-primary)*attackDir;  // +ve means ball is in front of us

    // Role-based position bias
    let yBias=0;
    if(slotRole==='FW')       yBias= Math.min(toBall*0.28, 120);   // forwards chase ball aggressively
    else if(slotRole==='MF')  yBias= Math.min(toBall*0.14,  60);   // mids follow somewhat
    else if(slotRole==='DF')  yBias= Math.max(toBall*0.06, -20);   // defenders hold back

    // Whole-team push: when this team has the ball, everyone advances as a
    // unit by default (not just whoever's dribbling); when the opponent
    // does, drop back a little instead of holding the exact formation line.
    // (Smaller than it used to be: the full-pitch base spread above now does
    // most of the work, this only shifts the block a line or so.)
    if(slot!==0){
      if(this.possRole===role){
        yBias += slotRole==='FW'?90:slotRole==='MF'?80:45;
      } else if(this.possRole&&this.possRole!==role){
        yBias += slotRole==='FW'?-90:slotRole==='MF'?-50:-15;
      }
    }
    // GK never moves from goal line
    if(slot===0){ yBias=0; secondary=sSize/2; }   // keeper always central

    primary = Phaser.Math.Clamp(primary+yBias*attackDir, margin, pSize-margin);
    // Kickoff/restart: everyone stays on their own side of the halfway line
    // — the ball-chasing bias above is meant for open play, not the moment
    // before a whistle, where drifting a forward across it looks wrong.
    if(clampOwnHalf){
      const half=pSize/2;
      primary = role==='A' ? Math.max(primary,half) : Math.min(primary,half);
    }
    return {x:secondary, y:primary};
  }

  /** Where an off-ball player (not the one being explicitly steered) should
   *  drift to. Keeps the formation shape as a base, but blends in a forward
   *  supporting run (to offer a passing option) when this team has the
   *  ball, or a press toward the ball carrier when the opponent does —
   *  applies to both the human team's teammates and the AI team's players. */
  _offBallTarget(role,e,activeId,iHaveBall,ballCarrier){
    const base=this._formPos(role,e.slot,this.ball.position);
    if(e.slot===0||e.id===activeId) return base; // keeper & the on-ball player keep plain formation logic

    let target=base;
    if(iHaveBall){
      const carrier=this._activeEntry(role);
      if(carrier){
        const attackDir=role==='A'?-1:1;
        const side=(e.body.position.x>=carrier.body.position.x)?1:-1;
        const supportSpot={
          x:carrier.body.position.x+side*130,
          y:carrier.body.position.y+attackDir*130
        };
        target={
          x:Phaser.Math.Linear(base.x,supportSpot.x,SUPPORT_BLEND),
          y:Phaser.Math.Linear(base.y,supportSpot.y,SUPPORT_BLEND)
        };
      }
    } else if(ballCarrier){
      const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,ballCarrier.body.position.x,ballCarrier.body.position.y);
      if(d<PRESS_RANGE){
        const ownGoalY=role==='A'?this.FIELD_H:0;
        const pressSpot={
          x:Phaser.Math.Linear(ballCarrier.body.position.x,e.body.position.x,0.25),
          y:Phaser.Math.Linear(ballCarrier.body.position.y,ownGoalY,0.15)
        };
        target={
          x:Phaser.Math.Linear(base.x,pressSpot.x,PRESS_BLEND),
          y:Phaser.Math.Linear(base.y,pressSpot.y,PRESS_BLEND)
        };
      }
    }
    return this._applyWander(e,target,iHaveBall);
  }

  /** Nudges an off-ball target around with two slow out-of-phase sines so
   *  players keep finding little pockets of space instead of parking on an
   *  exact formation spot. Wider when attacking, tighter when defending. */
  _applyWander(e,target,iHaveBall){
    const t=this.time.now, ph=e.wanderPhase||0;
    const amp=WANDER_AMPLITUDE*(iHaveBall?1:0.6);
    return {
      x:Phaser.Math.Clamp(target.x+Math.sin(t/WANDER_PERIOD_X+ph)*amp,30,this.FIELD_W-30),
      y:Phaser.Math.Clamp(target.y+Math.cos(t/WANDER_PERIOD_Y+ph*1.7)*amp,40,this.FIELD_H-40)
    };
  }

  /** Where to sprint for a ball nobody owns — a pass in flight, a rebound, a
   *  loose touch. The side's closest player always goes, as does anyone it
   *  has been played right next to, so passes get collected instead of the
   *  receiver drifting along at formation pace. Returns null when there's
   *  nothing to chase. */
  _looseBallChase(e,activeId){
    if(this.possRole||this.confrontation) return null;
    const bp=this.ball.position;
    const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,bp.x,bp.y);
    if(e.slot===0) return d<KEEPER_CHASE_RANGE?{x:bp.x,y:bp.y}:null; // keeper only for balls at their feet
    if(e.id===activeId||d<BALL_CHASE_RANGE) return {x:bp.x,y:bp.y};
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Team panel (mid-match): formation preset + substitutions together
  // ════════════════════════════════════════════════════════════════════
  /** Single-tab team panel: formation presets at the top, then the pitch
   *  (current XI) and bench together below — exactly like the pre-match
   *  squad editor. Tap a player on the pitch, then one on the bench (or
   *  vice versa), to sub them. */
  _openSubPanel(){
    this.subSel=null; this._renderSubPanel();
    document.getElementById('sub-panel').style.display='flex';
  }
  _renderFormationPresets(){
    const wrap=document.getElementById('formation-preset-btns'); wrap.innerHTML='';
    const current=this.formation[this.role];
    Object.keys(FORMATIONS).forEach(name=>{
      const btn=document.createElement('button'); btn.textContent=name;
      if(name===current) btn.classList.add('active');
      btn.addEventListener('click',()=>{
        this.formation[this.role]=name; this.pendingFormChange=name;
        this._renderSubPanel();
      });
      wrap.appendChild(btn);
    });
  }
  _renderSubPanel(){
    this._renderFormationPresets();
    document.getElementById('sub-panel-title').textContent='Tap two pitch players to swap positions, or a pitch player then a bench one to substitute';
    const listEl=document.getElementById('sub-list-inner'); listEl.innerHTML='';
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    const myBench=this.role==='A'?(this.benchA||[]):(this.benchB||[]);
    const pitchHtml=this._renderMiniPitch(myTeam,this.role,this.subSel);
    const benchHtml=`<div class="bench-strip" style="margin-top:12px;">${
      myBench.map(id=>{
        const p=getPlayerById(id); if(!p) return '';
        const col=this._css3(this._rosterColor(p));
        const selCls=(this.subSel&&this.subSel.type==='bench'&&this.subSel.id===id)?' selected':'';
        return `<div class="bench-pin${selCls}" data-bench-id="${id}">
          <div class="pin-avatar" style="background:${col};width:32px;height:32px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:rgba(0,0,0,.8)">${this._initials(p)}</div>
          <div class="pin-name">${p.nickname||p.name}</div>
        </div>`;
      }).join('')||'<p style="font-size:11px;opacity:.7;">No bench players.</p>'
    }</div>`;
    listEl.innerHTML=pitchHtml+benchHtml;
    listEl.querySelectorAll('.slot-pin[data-roster-id]').forEach(pin=>{
      pin.addEventListener('click',()=>this._onSubPinClick({type:'slot',id:pin.dataset.rosterId}));
    });
    listEl.querySelectorAll('.bench-pin[data-bench-id]').forEach(pin=>{
      pin.addEventListener('click',()=>this._onSubPinClick({type:'bench',id:pin.dataset.benchId}));
    });
  }
  _onSubPinClick(sel){
    if(!this.subSel){ this.subSel=sel; this._renderSubPanel(); return; }
    if(this.subSel.id===sel.id){
      const p=getPlayerById(sel.id); this.subSel=null; this._renderSubPanel();
      if(p) this._showPlayerStats(p);
      return;
    }
    if(this.subSel.type==='slot'&&sel.type==='slot'){
      // Two pitch players: swap which position each of them plays. No PT or
      // stamina resets — unlike a substitution, neither of them is coming
      // fresh off the bench.
      this.pendingReposition={aId:this.subSel.id,bId:sel.id};
      this.subSel=null;
      document.getElementById('sub-panel').style.display='none';
      return;
    }
    if(this.subSel.type===sel.type){ this.subSel=null; this._renderSubPanel(); return; } // both bench: not a valid action
    const outId=this.subSel.type==='slot'?this.subSel.id:sel.id;
    const inId =this.subSel.type==='bench'?this.subSel.id:sel.id;
    this.pendingSub={outId,inId};
    this.subSel=null;
    document.getElementById('sub-panel').style.display='none';
  }

  /** Render a simplified pitch HTML with current player positions for use in
   *  the sub panel and mid-match formation view (same look as squad editor). */
  _renderMiniPitch(team, role, sel){
    const preset=FORMATIONS[this.formation[role]]||FORMATIONS[DEFAULT_FORMATION];
    const teamColor=role==='A'?this._css3(this.teamColorA):this._css3(this.teamColorB);
    const pins=preset.map((f,slot)=>{
      const entry=team[slot]; const p=entry?getPlayerById(entry.id):null;
      const col=p?this._css3(this._rosterColor(p)):teamColor;
      const left=(f.x*100).toFixed(1)+'%';
      const top =((1-f.y)*100).toFixed(1)+'%';
      const selCls=(p&&sel&&sel.type==='slot'&&sel.id===entry.id)?' selected':'';
      if(p){
        const isOut=this._isOut(role,entry.id);
        return `<div class="slot-pin${selCls}" style="left:${left};top:${top};${isOut?'opacity:.4;pointer-events:none;':''}" data-roster-id="${entry.id}">
          <div class="pin-avatar" style="background:${col}">${this._initials(p)}</div>
          <div class="pin-name">${p.nickname||p.name}${isOut?' (OFF)':''}</div>
        </div>`;
      }
      return `<div class="slot-pin empty" style="left:${left};top:${top}"><div style="font-size:9px;opacity:.5">–</div></div>`;
    }).join('');
    return `<div class="mini-pitch-wrap" style="width:100%;aspect-ratio:2/3;background:#1e7a3c;border:2px solid white;border-radius:8px;position:relative;overflow:hidden;pointer-events:auto;touch-action:manipulation;"><div class="pitch-line-h"></div>${pins}</div>`;
  }

  _trySub(role,req){
    if(!req?.outId||!req?.inId) return;
    if(this._isOut(role,req.outId)) return; // a sent-off player can't be replaced
    const team=role==='A'?this.teamA:this.teamB;
    const bench=role==='A'?this.benchA:this.benchB;
    const map=role==='A'?this.statsMapA:this.statsMapB;
    const bIdx=bench.indexOf(req.inId); const entry=team.find(t=>t.id===req.outId);
    if(bIdx===-1||!entry) return;
    const rp=getPlayerById(req.inId); if(!rp) return;
    entry.id=req.inId;
    if(entry.body) this.bodyOwner.set(entry.body,{role,id:req.inId});
    const st=createPlayerStats(); applyRosterPlayerToStats(st,rp); map.set(req.inId,st);
    bench.splice(bIdx,1,req.outId);
    if(role==='A'&&this.activeIdA===req.outId) this.activeIdA=req.inId;
    if(role==='B'&&this.activeIdB===req.outId) this.activeIdB=req.inId;
    if(role==='A'&&this.gkIdA===req.outId) this.gkIdA=req.inId;
    if(role==='B'&&this.gkIdB===req.outId) this.gkIdB=req.inId;
  }

  /** Swaps which of two pitch slots each of these two players occupies —
   *  a straight reposition, not a substitution: their PT/stamina/active-id
   *  references are all tracked by roster id already, so nothing about them
   *  needs to change, only which body (and its slot's formation anchor)
   *  they're now tied to. */
  _tryReposition(role,req){
    if(!req?.aId||!req?.bId||req.aId===req.bId) return;
    const team=role==='A'?this.teamA:this.teamB;
    const eA=team.find(t=>t.id===req.aId), eB=team.find(t=>t.id===req.bId);
    if(!eA||!eB) return;
    if(this._isOut(role,eA.id)||this._isOut(role,eB.id)) return; // a sent-off player can't be repositioned
    const tmp=eA.id; eA.id=eB.id; eB.id=tmp;
    if(eA.body) this.bodyOwner.set(eA.body,{role,id:eA.id});
    if(eB.body) this.bodyOwner.set(eB.body,{role,id:eB.id});
  }

  // ════════════════════════════════════════════════════════════════════
  // In-game pointer input (converts screen → world coords)
  // ════════════════════════════════════════════════════════════════════
  _pointerDown(pointer){
    if(!this.matchStarted||this.matchClock.ended) return;
    const w=this._toWorld(pointer.x,pointer.y);
    if(this._iHavePossession()&&this._inGoalRegion(w)&&!this.confrontation){ this.pendingShoot=true; return; }
    // Play is frozen during a confrontation, but drawing runs still works —
    // it's the natural moment to set up where everyone goes next. Only the
    // tap-to-pass in _pointerUp stays disabled until the duel resolves.
    this.gestureStart={x:w.x,y:w.y,sx:pointer.x,sy:pointer.y}; this.gestureMoved=false;
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    let nearest=null, nearestD=PLAYER_SEL_RADIUS;
    myTeam.forEach(e=>{ const d=Phaser.Math.Distance.Between(e.gfx.x,e.gfx.y,w.x,w.y); if(d<nearestD){nearestD=d;nearest=e;} });
    const activeId=this.role==='A'?this.activeIdA:this.activeIdB;
    this.pendingSelectedPlayerId=nearest?nearest.id:activeId;
    this.drawing=true;
  }
  _pointerMove(pointer){
    if(!this.drawing) return;
    if(!this.gestureMoved){
      if(!this.gestureStart||Phaser.Math.Distance.Between(this.gestureStart.sx,this.gestureStart.sy,pointer.x,pointer.y)<DRAG_THRESHOLD) return;
      this.gestureMoved=true;
      this.selectedPlayerId=this.pendingSelectedPlayerId;
      const w=this._toWorld(pointer.x,pointer.y);
      // The line has to start from wherever the player actually is, not
      // from the raw tap-down point — those only coincide if you tapped
      // exactly on top of them. Off by even a little (or defaulting to the
      // active player from a tap that hit nobody), the path's first leg was
      // a detour out to that tap point before doubling back, which is what
      // made drawn lines look like they had a mind of their own.
      const myTeam=this.role==='A'?this.teamA:this.teamB;
      const entry=myTeam.find(e=>e.id===this.selectedPlayerId);
      const startPos=entry?(entry.body?entry.body.position:entry.gfx):this.gestureStart;
      this.myPaths.set(this.selectedPlayerId,[{x:startPos.x,y:startPos.y},{x:w.x,y:w.y}]);
      this.autoPathIds.delete(this.selectedPlayerId);
      return;
    }
    const path=this.myPaths.get(this.selectedPlayerId); if(!path) return;
    const w=this._toWorld(pointer.x,pointer.y); const last=path[path.length-1];
    if(!last||Phaser.Math.Distance.Between(last.x,last.y,w.x,w.y)>MIN_PATH_PT_DIST) path.push({x:w.x,y:w.y});
  }
  _pointerUp(){
    if(this.drawing&&!this.gestureMoved&&this.gestureStart&&this.matchStarted&&!this.confrontation&&this._iHavePossession())
      this.pendingPass={x:this.gestureStart.x,y:this.gestureStart.y};
    this.drawing=false; this.gestureStart=null;
  }
  _inGoalRegion(w){
    const half=this.FIELD_W/2;
    const towardMax=this.role==='B'; // A attacks toward y=0 now, B toward y=FIELD_H
    const withinX=Math.abs(w.x-half)<GOAL_HALF_WIDTH+40;
    // Reaches from just in front of the line all the way back through the goal
    // box, so the whole rectangle is a shooting tap.
    return withinX&&(towardMax
      ? w.y>this.FIELD_H-GOAL_CLICK_MARGIN&&w.y<this.WORLD_Y_MAX
      : w.y<GOAL_CLICK_MARGIN&&w.y>this.WORLD_Y_MIN);
  }
  _iHavePossession(){ return this.currentPossession===this.role; }

  _computeTargets(){
    const myTeam=this.role==='A'?this.teamA:this.teamB; const targets=[];
    for(const e of myTeam){
      const path=this.myPaths.get(e.id); if(!path||!path.length) continue;
      const pos=e.body?e.body.position:e.gfx;
      while(path.length&&Phaser.Math.Distance.Between(pos.x,pos.y,path[0].x,path[0].y)<WAYPOINT_RADIUS) path.shift();
      // Following a drawn line is a deliberate run — sprint for it.
      if(path.length){ targets.push({id:e.id,x:path[0].x,y:path[0].y,sprint:true}); continue; }
      // The drawn line ran out: keep making ground while we're attacking
      // rather than turning straight back into the formation.
      const runOn=this._runOnWaypoint(pos);
      if(runOn){ path.push(runOn); this.autoPathIds.add(e.id); targets.push({id:e.id,...runOn,sprint:true}); }
      else { this.myPaths.delete(e.id); this.autoPathIds.delete(e.id); }
    }
    return targets;
  }

  /** Next carry-on waypoint up the player's channel, or null once we've lost
   *  the ball or they're already deep enough to stop. */
  _runOnWaypoint(pos){
    if(this.currentPossession!==this.role) return null;
    const attackDir=this.role==='A'?-1:1;
    const goalY=this.role==='A'?0:this.FIELD_H;
    if(Math.abs(pos.y-goalY)<RUN_ON_STOP+WAYPOINT_RADIUS) return null;
    return {x:pos.x,y:Phaser.Math.Clamp(pos.y+attackDir*RUN_ON_STEP,RUN_ON_STOP,this.FIELD_H-RUN_ON_STOP)};
  }

  _drawPaths(){
    this.pathGfx.clear(); if(!this.matchStarted) return;
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    myTeam.forEach(e=>{
      const path=this.myPaths.get(e.id); if(!path||!path.length) return;
      const last=path[path.length-1];
      // The automatic "keep running" carry-on (see _runOnWaypoint) isn't
      // something the player drew — showing it as a line reads as a second,
      // self-drawn path. Just a small marker at where they're headed instead.
      if(this.autoPathIds.has(e.id)){
        this.pathGfx.fillStyle(0xffe066,.6); this.pathGfx.fillCircle(last.x,last.y,4);
        return;
      }
      const pos=e.body?e.body.position:e.gfx;
      this.pathGfx.lineStyle(2,0xffe066,.85);
      this.pathGfx.beginPath(); this.pathGfx.moveTo(pos.x,pos.y);
      path.forEach(pt=>this.pathGfx.lineTo(pt.x,pt.y)); this.pathGfx.strokePath();
      this.pathGfx.fillStyle(0xffe066,1); this.pathGfx.fillCircle(last.x,last.y,5);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Physics helpers
  // ════════════════════════════════════════════════════════════════════
  _isStunned(id,now){ return (this.stunMap.get(id)||0)>now; }

  /** Drains every on-pitch player's stamina at a flat rate — host only,
   *  called once per tick regardless of half or possession. Fresh legs from
   *  a substitution are the only way to reset it (see _trySub/_buildTeam). */
  _tickFatigue(delta){
    const dec=FATIGUE_DRAIN_PER_SEC*(delta/1000);
    for(const st of this.statsMapA.values()) st.stamina=Math.max(0,st.stamina-dec);
    for(const st of this.statsMapB.values()) st.stamina=Math.max(0,st.stamina-dec);
  }
  /** Speed multiplier from fatigue: full pace above the threshold, easing
   *  down to the floor as stamina empties out. */
  _fatigueMul(st){
    if(!st||!st.maxStamina) return 1;
    const ratio=st.stamina/st.maxStamina;
    if(ratio>=FATIGUE_THRESHOLD) return 1;
    return FATIGUE_MIN_MUL+(1-FATIGUE_MIN_MUL)*(ratio/FATIGUE_THRESHOLD);
  }

  _steer(body,target,speed=1,force=STEER_FORCE){
    const dx=target.x-body.position.x, dy=target.y-body.position.y;
    const dist=Math.hypot(dx,dy); if(dist<6) return;
    const f=force*speed;
    this.matter.body.applyForce(body,body.position,{x:(dx/dist)*f,y:(dy/dist)*f});
    const v=body.velocity, s=Math.hypot(v.x,v.y), mx=BASE_MAX_SPEED*speed;
    if(s>mx) this.matter.body.setVelocity(body,{x:(v.x/s)*mx,y:(v.y/s)*mx});
  }

  _glueBall(){
    if(!this.possRole) return;
    const e=this._activeEntry(this.possRole); if(!e?.body) return;
    const b=e.body,vel=b.velocity,sp=Math.hypot(vel.x,vel.y);
    const dy=(sp>0.05?vel.y/sp:(this.possRole==='A'?-1:1)), dx=(sp>0.05?vel.x/sp:0);
    this.matter.body.setPosition(this.ball,{x:b.position.x+dx*POSSESS_OFFSET,y:b.position.y+dy*POSSESS_OFFSET});
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
  }
  _doPass(role,target){
    const e=this._activeEntry(role); if(!e?.body) return;
    const dx=target.x-e.body.position.x, dy=target.y-e.body.position.y, dist=Math.hypot(dx,dy)||1;
    this.possRole=null;
    // Weight the pass to the distance: friction eats speed/BALL_FRICTION_AIR
    // worth of travel, so aim for a touch beyond the target rather than
    // kicking every ball the same and leaving long ones short.
    const speed=Phaser.Math.Clamp(dist*BALL_FRICTION_AIR*PASS_REACH_BOOST,PASS_MIN_SPEED,PASS_MAX_SPEED);
    this.matter.body.setVelocity(this.ball,{x:(dx/dist)*speed,y:(dy/dist)*speed});
    this._startPassFlight({x:this.ball.position.x,y:this.ball.position.y},dist);
  }

  /** Lifts the ball for the first PASS_LOFT_FRAC of a pass: while it's up
   *  there it stops colliding with players, so the chip clears anyone close to
   *  the passer, and it drops back to the ground short of the target. */
  _startPassFlight(from,dist){
    const range=Math.max(PASS_LOFT_MIN,dist*PASS_LOFT_FRAC);
    this.ballFlight={x0:from.x,y0:from.y,range,peak:Phaser.Math.Clamp(range*0.28,14,52),h:0};
    this.ball.collisionFilter.mask=CAT_GOAL;
  }
  _endPassFlight(){
    if(!this.ballFlight) return;
    this.ballFlight=null;
    this.ball.collisionFilter.mask=CAT_PLAYER|CAT_GOAL;
  }
  _updatePassFlight(){
    const f=this.ballFlight; if(!f) return;
    const b=this.ball.position;
    const d=Math.hypot(b.x-f.x0,b.y-f.y0);
    const sp=Math.hypot(this.ball.velocity.x,this.ball.velocity.y);
    // Down again once it has covered its arc, or early if the pass died or
    // the ball was handed to someone (a dead-ball restart, say).
    if(this.possRole||d>=f.range||sp<0.35){ this._endPassFlight(); return; }
    f.h=Math.sin((d/f.range)*Math.PI)*f.peak;
  }

  /** Ball with its height: lifted off its ground position and drawn bigger,
   *  with the shadow left behind on the grass. */
  _drawBall(x,y,h){
    this.ballGfx.setPosition(x,y-h*0.55).setScale(1+h/70);
    this.ballShadow.setVisible(h>1).setPosition(x,y).setScale(1-Math.min(0.3,h/170));
  }
  /** Picks a reasonable pass target for the AI: the most advanced teammate
   *  (closer to the rival goal than the passer) within a sane passing
   *  range, preferring the furthest-advanced one among nearby options. */
  _aiPickPassTarget(role,entry){
    const team=role==='A'?this.teamA:this.teamB;
    const attackDir=role==='A'?-1:1; // A attacks decreasing y (their goal is at the bottom), B increasing y
    let best=null,bestScore=-Infinity;
    for(const c of team){
      if(c.id===entry.id||c.slot===0) continue; // not myself, not the keeper
      const dx=c.body.position.x-entry.body.position.x, dy=c.body.position.y-entry.body.position.y;
      const dist=Math.hypot(dx,dy);
      if(dist<50||dist>560) continue; // too close to bother, too far to pick out
      const advance=dy*attackDir; // positive = further forward than the passer
      const score=advance-dist*0.15;
      if(score>bestScore){ bestScore=score; best=c; }
    }
    return best;
  }
  _knockback(loser,winner){
    if(!loser?.body||!winner?.body) return;
    const dx=loser.body.position.x-winner.body.position.x, dy=loser.body.position.y-winner.body.position.y, d=Math.hypot(dx,dy)||1;
    this.matter.body.setVelocity(loser.body,{x:(dx/d)*KNOCKBACK_SPEED,y:(dy/d)*KNOCKBACK_SPEED});
  }
  _activeEntry(role){ const team=role==='A'?this.teamA:this.teamB, id=role==='A'?this.activeIdA:this.activeIdB; return team.find(t=>t.id===id)||null; }
  _setActive(role,id){ if(role==='A') this.activeIdA=id; else this.activeIdB=id; }
  _updateActive(role){
    const team=(role==='A'?this.teamA:this.teamB).filter(e=>!this._isOut(role,e.id));
    if(!team.length) return;
    const bp=this.ball.position;
    let best=team[0], bestD=Phaser.Math.Distance.Between(team[0].body.position.x,team[0].body.position.y,bp.x,bp.y);
    for(const e of team){ const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,bp.x,bp.y); if(d<bestD){bestD=d;best=e;} }
    const cur=role==='A'?this.activeIdA:this.activeIdB;
    if(best.id!==cur){ const ce=team.find(t=>t.id===cur); const cd=ce?Phaser.Math.Distance.Between(ce.body.position.x,ce.body.position.y,bp.x,bp.y):Infinity; if(cd-bestD>24){if(role==='A')this.activeIdA=best.id;else this.activeIdB=best.id;} }
  }

  // ════════════════════════════════════════════════════════════════════
  // Collisions (host only)
  // ════════════════════════════════════════════════════════════════════
  /** Players no longer physically collide with each other (see the
   *  collision categories above) — only the ball can touch them, and
   *  duels trigger on proximity (_checkForDuel) rather than a Matter
   *  contact event. This just tracks ball touches (for lastTouch/
   *  possession) and goal-sensor overlaps. */
  _collisions(event){
    if(this.role!=='A'||!this.matchStarted) return;
    for(const pair of event.pairs){
      const bodies=[pair.bodyA,pair.bodyB];
      const lbls=[pair.bodyA.label,pair.bodyB.label];
      if(!lbls.includes('ball')) continue;
      const other=bodies.find(b=>b.label!=='ball');
      const owner=other&&this.bodyOwner.get(other);
      if(owner){
        this.lastTouch=owner;
        if(!this.possRole&&!this.confrontation) this.possRole=owner.role;
      }
      if(lbls.includes('goalMin')) this._onGoal('a');
      if(lbls.includes('goalMax')) this._onGoal('b');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Confrontations
  // ════════════════════════════════════════════════════════════════════
  /** `opts.skipBlockCheck` skips the wall-defender check (used when chaining
   *  in from a beaten block, so the same shot can't be walled twice).
   *  `opts.powerMulOverride` forces the shot's power multiplier instead of
   *  recomputing it from distance (used for that same chained shot, which
   *  already lost extra power grazing past the blocker). */
  _startConfront(type,aRole,dRole,now,opts={}){
    const aId=aRole==='A'?this.activeIdA:this.activeIdB;
    if(type==='shot'){
      const eAtk=this._activeEntry(aRole);
      const goalY=aRole==='A'?0:this.FIELD_H; // the goal aRole is shooting at
      const shotDist=eAtk?Math.abs(goalY-eAtk.body.position.y):0;
      const powerMul=opts.powerMulOverride!=null?opts.powerMulOverride:this._shotPowerMul(shotDist);
      if(!opts.skipBlockCheck&&shotDist>=BLOCK_MIN_DIST){
        const blocker=this._findBlocker(aRole,dRole,eAtk,goalY);
        if(blocker){
          this.confrontation={type:'block',attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:blocker.id,deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:null,powerMul,chainShot:{aRole,dRole}};
          return;
        }
      }
      const dId=dRole==='A'?this.gkIdA:this.gkIdB;
      // Chained in from a beaten block: the attacker already committed to —
      // and already paid PT for — how hard they shot to power through the
      // blocker. Carry that same resolved technique (or lack of one)
      // straight into the keeper duel instead of asking them again for
      // what's really the same shot, and don't charge them a second time
      // for it (presetAttackerTech skips _tryTech in _prepareConfrontReveal
      // entirely; attackerLocked hides their panel — see _updateConfrontUI).
      const locked=opts.attackerLocked===true;
      this.confrontation={type:'shot',attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:dId,deadline:now+CONFRONT_MS,attackerChoice:locked?'normal':null,defenderChoice:null,powerMul,attackerLocked:locked,presetAttackerTech:locked?(opts.attackerTechPreset??null):undefined};
      return;
    }
    const dId=dRole==='A'?this.activeIdA:this.activeIdB;
    this.confrontation={type,attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:dId,deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:null};
  }
  /** Full power up close, easing down to a floor at long range. */
  _shotPowerMul(dist){
    if(dist<=SHOT_FALLOFF_NEAR) return 1;
    if(dist>=SHOT_FALLOFF_FAR) return SHOT_FALLOFF_MIN;
    const t=(dist-SHOT_FALLOFF_NEAR)/(SHOT_FALLOFF_FAR-SHOT_FALLOFF_NEAR);
    return 1-t*(1-SHOT_FALLOFF_MIN);
  }
  /** Finds the nearest defending outfield player (not the keeper) standing
   *  close to the straight line between the shooter and the goal, between
   *  the two (not behind either) — the one who'd actually get a foot to it. */
  _findBlocker(aRole,dRole,eAtk,goalY){
    if(!eAtk) return null;
    const team=dRole==='A'?this.teamA:this.teamB;
    const gkId=dRole==='A'?this.gkIdA:this.gkIdB;
    const goalX=this.FIELD_W/2;
    const sx=eAtk.body.position.x, sy=eAtk.body.position.y;
    const dx=goalX-sx, dy=goalY-sy, lineLenSq=dx*dx+dy*dy||1;
    const now=this.time.now;
    let best=null, bestD=BLOCK_CORRIDOR_HALF;
    for(const e of team){
      if(e.id===gkId||!e.body) continue;
      if(this._isOut(dRole,e.id)||this._isStunned(e.id,now)) continue;
      const px=e.body.position.x-sx, py=e.body.position.y-sy;
      const t=(px*dx+py*dy)/lineLenSq;
      if(t<=0.12||t>=0.92) continue; // not meaningfully between shooter and goal
      const projX=sx+dx*t, projY=sy+dy*t;
      const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,projX,projY);
      if(d<bestD){ bestD=d; best=e; }
    }
    return best;
  }
  _aiParams(){ return AI_LEVELS[this.aiLevel]||AI_LEVELS[AI_LEVEL_DEFAULT]; }
  /** Picks the strongest `category` technique this player can actually
   *  afford right now, as a {tech:index} choice into techniquesFor's list —
   *  or 'normal' if none of them fit their remaining PT. */
  _bestTechChoice(stats,cat){
    const list=techniquesFor(stats,cat);
    let bestIdx=-1,bestPower=-1;
    list.forEach((t,i)=>{ if(stats.sp>=t.cost&&t.power>bestPower){ bestPower=t.power; bestIdx=i; } });
    return bestIdx===-1?'normal':{tech:bestIdx};
  }
  _aiChoice(stats,cat){ return canActivate(stats,cat)&&Math.random()<this._aiParams().techChance?this._bestTechChoice(stats,cat):'normal'; }
  /** Resolves a choice ('normal' or {tech:index}) against `stats`' own
   *  techniquesFor(cat) list, spends the PT if it's actually affordable, and
   *  returns the technique used — or null for a normal action / an
   *  unaffordable or now-stale choice (e.g. sent before a PT-costing choice
   *  elsewhere already spent it this tick). */
  _tryTech(stats,cat,choice){
    if(!choice||typeof choice!=='object'||typeof choice.tech!=='number') return null;
    const tech=techniquesFor(stats,cat)[choice.tech];
    if(!tech||stats.sp<tech.cost) return null;
    stats.sp-=tech.cost;
    return tech;
  }
  _statsFor(role,id){ return (role==='A'?this.statsMapA:this.statsMapB).get(id); }

  _entryById(role,id){ const team=role==='A'?this.teamA:this.teamB; return team.find(t=>t.id===id)||null; }

  /** Rolls the outcome and puts the confrontation into its reveal beat: both
   *  moves are shown facing each other, then the winner lights up, and only
   *  after that does _applyConfrontOutcome actually move anything. Play is
   *  already frozen while a confrontation is live, so this reads as a pause. */
  _prepareConfrontReveal(now){
    const c=this.confrontation;
    const as=this._statsFor(c.attackerRole,c.attackerId), ds=this._statsFor(c.defenderRole,c.defenderId);
    if(!as||!ds){this.confrontation=null;return;}
    const atk=c.type==='duel'?'dribble':'shot';
    const def=c.type==='shot'?'keeper':'defense'; // duel and block both face a 'defense' roll
    // A shot chained in from a beaten block already spent its attacker's PT
    // (and locked in their technique) back when they powered through the
    // blocker — reuse that resolved result instead of charging them again.
    const aTech=c.presetAttackerTech!==undefined?c.presetAttackerTech:this._tryTech(as,atk,c.attackerChoice);
    const dTech=this._tryTech(ds,def,c.defenderChoice);
    // A shot's power fades with distance (see _shotPowerMul) — applies to
    // both the block attempt and the eventual keeper duel, since it's the
    // same weakened strike either way.
    const powerMul=(c.type==='shot'||c.type==='block')?(c.powerMul||1):1;
    const aP=(aTech?aTech.power:NORMAL_ACTION_POWER)*as[STAT_FIELD_FOR_TECH[atk]]*powerMul;
    const dP=(dTech?dTech.power:NORMAL_ACTION_POWER)*ds[STAT_FIELD_FOR_TECH[def]];
    // Blocking a shot takes a real supertechnique — a normal challenge can't
    // stop it, only soften what happens after (see BLOCK_PASS_PENALTY).
    const aWins=(c.type==='block'&&!dTech)?true:Math.random()<aP/(aP+dP);
    const aTN=aTech?aTech.name:'Normal', dTN=dTech?dTech.name:'Normal';
    // Visual flourish data for whoever actually used a supertechnique —
    // rendered identically on host and client from the synced result.
    const eAtk=this._entryById(c.attackerRole,c.attackerId), eDef=this._entryById(c.defenderRole,c.defenderId);
    const fx={
      a: aTech&&eAtk ? {x:eAtk.body.position.x,y:eAtk.body.position.y,color:c.attackerRole==='A'?this.teamColorA:this.teamColorB,name:aTN} : null,
      d: dTech&&eDef ? {x:eDef.body.position.x,y:eDef.body.position.y,color:c.defenderRole==='A'?this.teamColorA:this.teamColorB,name:dTN} : null
    };
    c.pending={aWins,aTN,dTN,fx,aName:as.name,dName:ds.name,aTech};
    c.reveal={
      until:now+DUEL_REVEAL_MS, litAt:now+DUEL_REVEAL_LIT_MS,
      a:{name:as.name,move:aTN,winner:aWins},
      d:{name:ds.name,move:dTN,winner:!aWins}
    };
  }

  _applyConfrontOutcome(now){
    const c=this.confrontation, r=c.pending;
    if(!r){ this.confrontation=null; return; }
    const {aWins,aTN,dTN,fx,aName,dName,aTech}=r;
    let title,outcome=`${aName}: ${aTN} · ${dName}: ${dTN}`;
    if(c.type==='duel'){
      const eA=this._activeEntry(c.attackerRole), eD=this._activeEntry(c.defenderRole);
      if(aWins){ this._knockback(eD,eA); this.stunMap.set(c.defenderId,now+STUN_MS); title=`${aName} dribbles past!`; }
      else { this.possRole=c.defenderRole; this._setActive(c.defenderRole,c.defenderId); this._knockback(eA,eD); this.stunMap.set(c.attackerId,now+STUN_MS); title=`${dName} wins the ball!`; }
      this.duelLockUntil=now+STUN_MS+200;
    } else if(c.type==='block'){
      if(aWins){
        // Grazed past the wall — the shot is still on, just weaker for it.
        // Chain straight into the real shot-vs-keeper duel rather than
        // ending the confrontation here (skip the block check so the same
        // shot can't be walled twice).
        this.confrontation=null;
        this.confrontResult={title:`${aName} gets the shot away past ${dName}!`,outcome,until:now+1200,outcomeAt:now+RESULT_DELAY_MS,fx};
        const {aRole,dRole}=c.chainShot;
        this._startConfront('shot',aRole,dRole,now,{skipBlockCheck:true,powerMulOverride:(c.powerMul||1)*BLOCK_PASS_PENALTY,attackerLocked:true,attackerTechPreset:aTech??null});
        return;
      }
      // Blocked clean: the ball pops loose at the blocker's feet, turnover.
      // Look them up by the id the confrontation actually names — they
      // aren't necessarily who was "active" for the team before this.
      const eD=this._entryById(c.defenderRole,c.defenderId);
      this.possRole=c.defenderRole;
      this._setActive(c.defenderRole,c.defenderId);
      if(eD?.body){ this.matter.body.setPosition(this.ball,{x:eD.body.position.x,y:eD.body.position.y}); this.matter.body.setVelocity(this.ball,{x:0,y:0}); }
      title=`${dName} blocks the shot!`;
    } else if(aWins){
      this._onGoal(c.attackerRole==='A'?'a':'b');
      title=`⚽ GOAL! ${aName} scores!`;
    } else {
      // The keeper (defenderId here, not necessarily whoever was "active"
      // before the shot) made the save — the ball, and possession, are
      // theirs now.
      this.possRole=c.defenderRole;
      this._setActive(c.defenderRole,c.defenderId);
      title=`${dName} saves it!`;
    }
    this.confrontation=null;
    this.confrontResult={title,outcome,until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS,fx};
  }

  _onGoal(scorer){
    this.score[scorer]+=1;
    document.querySelector('#scoreboard .score').textContent=`${this.score.a} - ${this.score.b}`;
    this.possRole=null;
    this._endPassFlight();
    this.matter.body.setPosition(this.ball,{x:this.FIELD_W/2,y:this.FIELD_H/2});
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
    this.stunMap.clear();
    this._resetFormPos();
  }
  _resetFormPos(){
    const bp={x:this.FIELD_W/2,y:this.FIELD_H/2};
    this.teamA.forEach(e=>{ const p=this._formPos('A',e.slot,bp,true); this.matter.body.setPosition(e.body,p); this.matter.body.setVelocity(e.body,{x:0,y:0}); });
    this.teamB.forEach(e=>{ const p=this._formPos('B',e.slot,bp,true); this.matter.body.setPosition(e.body,p); this.matter.body.setVelocity(e.body,{x:0,y:0}); });
    this.myPaths.clear();
    this.autoPathIds.clear();
  }

  // ════════════════════════════════════════════════════════════════════
  // Duels-by-proximity, fouls, cards & dead-ball restarts (host only)
  // ════════════════════════════════════════════════════════════════════
  /** Duels no longer fire off a physical collision (players pass through
   *  each other now) — instead, when the two teams' active players get
   *  within DUEL_HITBOX_RADIUS of each other, roll for a foul first; if
   *  it isn't one, start the normal duel confrontation as before. */
  _checkForDuel(now){
    if(!this.possRole||this.confrontation||now<this.duelLockUntil) return;
    const attackerRole=this.possRole, defenderRole=attackerRole==='A'?'B':'A';
    const eA=this._activeEntry(attackerRole), eD=this._activeEntry(defenderRole);
    if(!eA||!eD) return;
    if(this._isStunned(eA.id,now)||this._isStunned(eD.id,now)) return;
    const d=Phaser.Math.Distance.Between(eA.body.position.x,eA.body.position.y,eD.body.position.x,eD.body.position.y);
    if(d>=DUEL_HITBOX_RADIUS) return;
    const ds=this._statsFor(defenderRole,eD.id);
    const foulChance=Phaser.Math.Clamp(FOUL_CHANCE_BASE/(ds?ds.defensePower:1),FOUL_CHANCE_MIN,FOUL_CHANCE_MAX);
    if(Math.random()<foulChance) this._commitFoul(defenderRole,eD.id,attackerRole,now);
    else this._startConfront('duel',attackerRole,defenderRole,now);
  }

  _cardKey(role,id){ return `${role}:${id}`; }
  _isOut(role,id){ return !!this.cards.get(this._cardKey(role,id))?.red; }
  /** Books `id` and sends them off on a second yellow. Returns 'yellow' or 'red'. */
  _addCard(role,id,now){
    const key=this._cardKey(role,id);
    const rec=this.cards.get(key)||{yellow:0,red:false};
    rec.yellow+=1;
    let type='yellow';
    if(rec.yellow>=2&&!rec.red){ rec.red=true; type='red'; this._sendOff(role,id,now); }
    this.cards.set(key,rec);
    return type;
  }
  _sendOff(role,id,now){
    const team=role==='A'?this.teamA:this.teamB;
    const e=team.find(t=>t.id===id); if(!e) return;
    e.gfx.setVisible(false); e.label.setVisible(false);
    if(e.body){ e.body.collisionFilter.mask=0x0000; this.matter.body.setVelocity(e.body,{x:0,y:0}); }
    this.stunMap.delete(id);
  }

  /** Foul committed by `offenderRole`'s player on `fouledRole`. Books a
   *  card and awards either a penalty (foul inside the offender's own box
   *  — resolved as a normal shot-vs-keeper confrontation) or a free kick
   *  (simple dead-ball restart, no separate aiming step). */
  _commitFoul(offenderRole,offenderId,fouledRole,now){
    const eOff=this._activeEntry(offenderRole);
    const spot={x:eOff?eOff.body.position.x:this.ball.position.x, y:eOff?eOff.body.position.y:this.ball.position.y};
    const cardType=this._addCard(offenderRole,offenderId,now);
    const offenderName=this._statsFor(offenderRole,offenderId)?.name||'Player';
    const cardTxt=cardType==='red'?' — RED CARD, sent off!':' (yellow card)';
    if(this._inPenaltyBox(offenderRole,spot)){
      this._placeBallAndAward(fouledRole,spot,now);
      this._startConfront('shot',fouledRole,offenderRole,now,{skipBlockCheck:true}); // a penalty is never walled
      this.confrontResult={title:`Penalty! Foul by ${offenderName}${cardTxt}`,outcome:'',until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS};
    } else {
      this._placeBallAndAward(fouledRole,spot,now);
      this.confrontResult={title:`Foul by ${offenderName}${cardTxt}`,outcome:'Free kick awarded',until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS};
    }
  }

  /** Generic dead-ball restart: place the ball at `spot`, hand possession
   *  to `awardedRole`, and teleport one of their eligible players there
   *  (their keeper if `preferGk`, otherwise whoever's nearest) to take it. */
  _placeBallAndAward(awardedRole,spot,now,{preferGk=false}={}){
    this._endPassFlight();
    this.matter.body.setPosition(this.ball,spot);
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
    const team=awardedRole==='A'?this.teamA:this.teamB;
    const gkId=awardedRole==='A'?this.gkIdA:this.gkIdB;
    let mover=preferGk?team.find(e=>e.id===gkId&&!this._isOut(awardedRole,e.id)):null;
    if(!mover){
      let bestD=Infinity;
      for(const e of team){
        if(this._isOut(awardedRole,e.id)) continue;
        const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,spot.x,spot.y);
        if(d<bestD){ bestD=d; mover=e; }
      }
    }
    if(mover){
      this.matter.body.setPosition(mover.body,spot);
      this.matter.body.setVelocity(mover.body,{x:0,y:0});
      this._setActive(awardedRole,mover.id);
    }
    this.possRole=awardedRole;
    this.duelLockUntil=now+600;
  }

  /** Checks whether the ball has left the pitch and, if so, restarts play
   *  with a throw-in, corner or goal kick. Returns true if it did (so the
   *  caller can skip the rest of this tick's open-play logic). */
  _checkOutOfBounds(now){
    const b=this.ball.position, m=10;
    if(b.y<-m||b.y>this.FIELD_H+m){
      const overTop=b.y<-m;
      const defendingRole=overTop?'B':'A'; // A now defends the bottom, B the top
      const sideX=b.x<this.FIELD_W/2?18:this.FIELD_W-18;
      const lineY=overTop?18:this.FIELD_H-18;
      if(this.lastTouch&&this.lastTouch.role===defendingRole){
        const attackingRole=defendingRole==='A'?'B':'A';
        this._placeBallAndAward(attackingRole,{x:sideX,y:lineY},now);
        this.confrontResult={title:'Corner kick',outcome:'',until:now+1800,outcomeAt:now+1800};
      } else {
        const gkY=overTop?this.PA_H*0.6:this.FIELD_H-this.PA_H*0.6;
        this._placeBallAndAward(defendingRole,{x:this.FIELD_W/2,y:gkY},now,{preferGk:true});
        this.confrontResult={title:'Goal kick',outcome:'',until:now+1800,outcomeAt:now+1800};
      }
      return true;
    }
    if(b.x<-m||b.x>this.FIELD_W+m){
      const awarded=this.lastTouch&&this.lastTouch.role==='A'?'B':'A';
      const spot={x:Phaser.Math.Clamp(b.x,15,this.FIELD_W-15),y:Phaser.Math.Clamp(b.y,20,this.FIELD_H-20)};
      this._placeBallAndAward(awarded,spot,now);
      this.confrontResult={title:'Throw-in',outcome:'',until:now+1800,outcomeAt:now+1800};
      return true;
    }
    return false;
  }
  // ════════════════════════════════════════════════════════════════════
  // Clock
  // ════════════════════════════════════════════════════════════════════
  _tickClock(delta){
    if(this.matchClock.ended) return;
    this.matchClock.secondsRemaining-=delta/1000;
    if(this.matchClock.secondsRemaining<=0){
      if(this.matchClock.half===1){ this.matchClock.half=2; this.matchClock.secondsRemaining=HALF_S; this.possRole=null; this.confrontation=null; this.matter.body.setPosition(this.ball,{x:this.FIELD_W/2,y:this.FIELD_H/2}); this.matter.body.setVelocity(this.ball,{x:0,y:0}); this._resetFormPos(); }
      else { this.matchClock.ended=true; this.matchClock.secondsRemaining=0; }
    }
  }
  static _fmtClock(s){ s=Math.max(0,Math.ceil(s)); const m=Math.floor(s/60),r=s%60; return `${m}:${r<10?'0':''}${r}`; }
  _renderClock(c){
    if(!c) return;
    document.getElementById('match-clock').textContent=c.ended?'Full time':`${c.half===1?'1st':'2nd'} half — ${GameScene._fmtClock(c.secondsRemaining)}`;
    if(c.ended) this._showFullTime();
  }

  /** Full time: show the final score, then drop back to the start menu. The
   *  reset is a reload on purpose — every control in the menu is bound to this
   *  scene instance, so rebuilding a match in place would leave the old
   *  bindings behind. The room code lives in the URL, so it survives. */
  _showFullTime(){
    if(this._fullTimeShown) return;
    this._fullTimeShown=true;
    const scoreTxt=document.querySelector('#scoreboard .score').textContent;
    const [a,b]=scoreTxt.split('-').map(n=>parseInt(n,10)||0);
    const mine=this.role==='A'?a:b, theirs=this.role==='A'?b:a;
    document.getElementById('fulltime-score').textContent=scoreTxt;
    document.getElementById('fulltime-verdict').textContent=mine>theirs?'You win!':mine<theirs?'You lose':'Draw';
    document.getElementById('confrontation-ui').style.display='none';
    document.getElementById('duel-reveal').style.display='none';
    document.getElementById('fulltime-panel').style.display='flex';
    const cd=document.getElementById('fulltime-countdown');
    let left=Math.round(FULLTIME_MENU_MS/1000);
    const tick=()=>{
      if(left<=0){ this._returnToMenu(); return; }
      cd.textContent=`Back to the menu in ${left}s…`;
      left-=1;
    };
    tick();
    this._fullTimeTimer=setInterval(tick,1000);
  }

  _returnToMenu(){
    if(this._fullTimeTimer){ clearInterval(this._fullTimeTimer); this._fullTimeTimer=null; }
    window.location.reload();
  }

  // ════════════════════════════════════════════════════════════════════
  // Main loop
  // ════════════════════════════════════════════════════════════════════
  update(time,delta){
    const amHost=this.role==='A';
    if(!amHost&&this.matchStarted&&!this.clientTeamsBuilt) this._buildClientTeams();
    if(this.matchStarted) this._tickScroll(delta);

    const targets=this.matchStarted?this._computeTargets():[];
    const myInput={targets,shootRequest:this.pendingShoot,passTarget:this.pendingPass,confrontationChoice:this.pendingChoice,subRequest:this.pendingSub,repositionRequest:this.pendingReposition,formationChange:this.pendingFormChange};
    this.pendingShoot=false; this.pendingPass=null; this.pendingChoice=null; this.pendingSub=null; this.pendingReposition=null; this.pendingFormChange=null;
    this.net.sendInput(myInput);

    if(amHost){ if(this.matchStarted) this._hostUpdate(time,delta,myInput); else if(time-this.lastStateSent>1000/STATE_HZ){this.lastStateSent=time;this.net.sendState({matchStarted:false});} }
    else this._clientUpdate(time);

    if(this.matchStarted){ this._updateConfrontUI(this.confrontation,time); this._drawPaths(); }
  }

  _hostUpdate(now,delta,myInput){
    const aiActive=!this.net.hasPeer();
    document.getElementById('ai-badge').style.display=aiActive?'block':'none';
    let inputB=this.remoteInput;
    if(aiActive){
      const eB=this._activeEntry('B');
      const ai=decideAIMove({selfPos:eB?eB.body.position:{x:this.FIELD_W/2,y:0},ballPos:this.ball.position,axis:'y',ownGoalValue:0,rivalGoalValue:this.FIELD_H,fieldPrimarySize:this.FIELD_H,
        hasBall:this.possRole==='B',goalCentre:this.FIELD_W/2});
      inputB={targets:eB?[{id:eB.id,...ai.target}]:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,repositionRequest:null,formationChange:null};
    }
    this.currentPossession=this.possRole;
    if(myInput.formationChange) this.formation.A=myInput.formationChange;
    if(!aiActive&&inputB.formationChange) this.formation.B=inputB.formationChange;
    if(!this.matchClock.ended) this._tickClock(delta);
    if(!this.matchClock.ended) this._tickFatigue(delta);

    if(this.confrontation){
      this._progressConfront(now,myInput,inputB,aiActive);
    } else if(!this.matchClock.ended && !this._checkOutOfBounds(now)){
      this._updateActive('A'); this._updateActive('B');
      this._moveTeam('A',myInput.targets,now); this._moveTeam('B',inputB.targets,now);
      if(myInput.passTarget&&this.possRole==='A') this._doPass('A',myInput.passTarget);
      else if(!aiActive&&inputB.passTarget&&this.possRole==='B') this._doPass('B',inputB.passTarget);
      if(myInput.shootRequest&&this.possRole==='A') this._startConfront('shot','A','B',now);
      else if(!aiActive&&inputB.shootRequest&&this.possRole==='B') this._startConfront('shot','B','A',now);
      else if(aiActive&&this.possRole==='B'){
        const eB=this._activeEntry('B'), p=this._aiParams();
        // Shoot as soon as it's in range rather than dithering around the box
        if(eB&&eB.body.position.y>this.FIELD_H-p.shootRange&&Math.random()<p.shootChance) this._startConfront('shot','B','A',now);
        else if(eB&&Math.random()<p.passChance){
          const mate=this._aiPickPassTarget('B',eB);
          if(mate) this._doPass('B',{x:mate.body.position.x,y:mate.body.position.y});
        }
      }
      if(!this.confrontation) this._checkForDuel(now);
      if(myInput.subRequest) this._trySub('A',myInput.subRequest);
      if(!aiActive&&inputB.subRequest) this._trySub('B',inputB.subRequest);
      if(myInput.repositionRequest) this._tryReposition('A',myInput.repositionRequest);
      if(!aiActive&&inputB.repositionRequest) this._tryReposition('B',inputB.repositionRequest);
    }

    this._updatePassFlight();
    this._glueBall(); this._syncGfx();
    this._renderClock(this.matchClock);
    this._renderResultBanner(this.confrontResult,now);
    const as=this._statsFor('A',this.activeIdA); if(as) this._paintHUD(as.sp,as.maxSP,as.stamina,as.maxStamina);

    if(now-this.lastStateSent>1000/STATE_HZ){
      this.lastStateSent=now;
      const as2=this._statsFor('A',this.activeIdA), bs=this._statsFor('B',this.activeIdB);
      const stunAry=[...this.stunMap.entries()].map(([k,v])=>({id:k,until:v}));
      const statsAll={
        a:this.teamA.map(e=>{const s=this._statsFor('A',e.id); return s?s.sp:null;}),
        b:this.teamB.map(e=>{const s=this._statsFor('B',e.id); return s?s.sp:null;})
      };
      const sentOff={
        a:this.teamA.filter(e=>this._isOut('A',e.id)).map(e=>e.id),
        b:this.teamB.filter(e=>this._isOut('B',e.id)).map(e=>e.id)
      };
      this.net.sendState({matchStarted:true,ball:{x:this.ball.position.x,y:this.ball.position.y},ballH:this.ballFlight?Math.round(this.ballFlight.h):0,teamA:this.teamA.map(e=>({x:e.body.position.x,y:e.body.position.y})),teamB:this.teamB.map(e=>({x:e.body.position.x,y:e.body.position.y})),activeIdA:this.activeIdA,activeIdB:this.activeIdB,score:this.score,sp:{a:as2?as2.sp:0,b:bs?bs.sp:0},maxSp:{a:as2?as2.maxSP:100,b:bs?bs.maxSP:100},stamina:{a:as2?as2.stamina:0,b:bs?bs.stamina:0},maxStamina:{a:as2?as2.maxStamina:150,b:bs?bs.maxStamina:150},statsAll,sentOff,possession:this.possRole,confrontation:this.confrontation?{type:this.confrontation.type,attackerRole:this.confrontation.attackerRole,defenderRole:this.confrontation.defenderRole,attackerId:this.confrontation.attackerId,defenderId:this.confrontation.defenderId,deadline:this.confrontation.deadline,reveal:this.confrontation.reveal||null,powerMul:this.confrontation.powerMul||1,attackerLocked:!!this.confrontation.attackerLocked}:null,confrontResult:(this.confrontResult&&now<this.confrontResult.until)?this.confrontResult:null,benchIds:{a:this.benchA,b:this.benchB},starterIds:{a:this.teamA.map(e=>e.id),b:this.teamB.map(e=>e.id)},clock:{half:this.matchClock.half,secondsRemaining:this.matchClock.secondsRemaining,ended:this.matchClock.ended},stuns:stunAry});
    }
  }

  _moveTeam(role,targets,now){
    const team=role==='A'?this.teamA:this.teamB;
    const byId=new Map(targets.map(t=>[t.id,t]));
    const activeId=role==='A'?this.activeIdA:this.activeIdB;
    const iHaveBall=this.possRole===role;
    const oppHasBall=!!this.possRole&&this.possRole!==role;
    const ballCarrier=oppHasBall?this._activeEntry(this.possRole):null;
    team.forEach(e=>{
      if(this._isOut(role,e.id)) return; // sent off: frozen, invisible, ignored entirely
      if(this._isStunned(e.id,now)){
        // Stunned: drain velocity, don't steer, and can't touch the ball —
        // otherwise a knocked-back player clipping the ball at speed could
        // fling it (this is what caused the ball to "shoot" after a duel).
        if(e.body) e.body.collisionFilter.mask=CAT_DEFAULT;
        this.matter.body.setVelocity(e.body,{x:e.body.velocity.x*0.85,y:e.body.velocity.y*0.85});
        return;
      }
      if(e.body&&e.body.collisionFilter.mask!==(CAT_BALL|CAT_DEFAULT)) e.body.collisionFilter.mask=CAT_BALL|CAT_DEFAULT;
      const st=this._statsFor(role,e.id), sp=st?st.speed*this._fatigueMul(st):1;
      const t=byId.get(e.id);
      const chase=t?null:this._looseBallChase(e,activeId);
      // The sprint bonus itself shrinks as stamina drains, on top of the
      // general fatigue cutoff already baked into `sp` above.
      const staminaRatio=st?Phaser.Math.Clamp(st.stamina/st.maxStamina,0,1):1;
      const sprintSpeedMul=1+SPRINT_MAX_SPEED_BONUS*staminaRatio;
      const sprintForceMul=1+SPRINT_MAX_FORCE_BONUS*staminaRatio;
      if(t) this._steer(e.body,t,t.sprint?sp*sprintSpeedMul:sp,t.sprint?STEER_FORCE*sprintForceMul:STEER_FORCE);
      else if(chase) this._steer(e.body,chase,sp,STEER_FORCE); // full pace, not the off-ball amble
      else {
        // Autonomous position: hold roughly to formation, but lean into a
        // supporting run when we have the ball, or press the ball carrier
        // when the opponent does.
        const autoPos=this._offBallTarget(role,e,activeId,iHaveBall,ballCarrier);
        this._steer(e.body,autoPos,sp,AUTO_STEER_FORCE);
        // Soft speed cap for autonomous movement — scaled by the player's
        // own speed stat too, so quick players still look quick off the ball.
        const cap=AUTO_MAX_SPEED*sp;
        const v=e.body.velocity, s=Math.hypot(v.x,v.y);
        if(s>cap) this.matter.body.setVelocity(e.body,{x:(v.x/s)*cap,y:(v.y/s)*cap});
      }
    });
  }

  _progressConfront(now,myInput,inputB,aiActive){
    const c=this.confrontation;
    // Already showing the VS cards: no more input matters, just wait out the
    // beat and then apply what was rolled.
    if(c.reveal){
      // The host owns the timing and flips the flag, so the client lights the
      // same card at the same moment instead of racing its own clock.
      if(now>=c.reveal.litAt) c.reveal.lit=true;
      if(now>=c.reveal.until) this._applyConfrontOutcome(now);
      return;
    }
    if(myInput.confrontationChoice){ if(c.attackerRole==='A'&&!c.attackerChoice)c.attackerChoice=myInput.confrontationChoice; if(c.defenderRole==='A'&&!c.defenderChoice)c.defenderChoice=myInput.confrontationChoice; }
    if(!aiActive&&inputB.confrontationChoice){ if(c.attackerRole==='B'&&!c.attackerChoice)c.attackerChoice=inputB.confrontationChoice; if(c.defenderRole==='B'&&!c.defenderChoice)c.defenderChoice=inputB.confrontationChoice; }
    if(aiActive){
      const tf=r=>{
        if(c.type==='duel') return r===c.attackerRole?'dribble':'defense';
        if(c.type==='block') return r===c.attackerRole?'shot':'defense';
        return r===c.attackerRole?'shot':'keeper';
      };
      if(c.attackerRole==='B'&&!c.attackerChoice){const s=this._statsFor('B',c.attackerId);c.attackerChoice=s?this._aiChoice(s,tf('B')):'normal';}
      if(c.defenderRole==='B'&&!c.defenderChoice){
        const s=this._statsFor('B',c.defenderId);
        // A normal block never works — the AI always reaches for its best
        // affordable supertechnique here instead of rolling its usual chance.
        c.defenderChoice=c.type==='block'?(s?this._bestTechChoice(s,'defense'):'normal'):(s?this._aiChoice(s,tf('B')):'normal');
      }
    }
    if((c.attackerChoice&&c.defenderChoice)||now>=c.deadline){ if(!c.attackerChoice)c.attackerChoice='normal'; if(!c.defenderChoice)c.defenderChoice='normal'; this._prepareConfrontReveal(now); }
  }

  _incomingState(data){
    this.remoteState=data;
    if(data.matchStarted&&!this.matchStarted){ this.matchStarted=true; document.getElementById('squad-editor-panel').style.display='none'; }
  }

  _clientUpdate(time){
    if(!this.remoteState?.matchStarted||!this.clientTeamsBuilt) return;
    const lerp=0.3;
    this._syncClientIds(this.remoteState);
    if(this.remoteState.stuns) this.remoteState.stuns.forEach(({id,until})=>this.stunMap.set(id,until));
    // Track the ball's position on the ground and add the synced height on
    // top, so a chipped pass looks the same on both screens.
    if(!this._clientBall) this._clientBall={x:this.remoteState.ball.x,y:this.remoteState.ball.y};
    this._clientBall.x=Phaser.Math.Linear(this._clientBall.x,this.remoteState.ball.x,lerp);
    this._clientBall.y=Phaser.Math.Linear(this._clientBall.y,this.remoteState.ball.y,lerp);
    this._drawBall(this._clientBall.x,this._clientBall.y,this.remoteState.ballH||0);
    this.teamA.forEach((e,i)=>{ const p=this.remoteState.teamA[i]; if(!p)return; e.gfx.x=Phaser.Math.Linear(e.gfx.x,p.x,lerp); e.gfx.y=Phaser.Math.Linear(e.gfx.y,p.y,lerp); e.label.setPosition(e.gfx.x,e.gfx.y+15); });
    this.teamB.forEach((e,i)=>{ const p=this.remoteState.teamB[i]; if(!p)return; e.gfx.x=Phaser.Math.Linear(e.gfx.x,p.x,lerp); e.gfx.y=Phaser.Math.Linear(e.gfx.y,p.y,lerp); e.label.setPosition(e.gfx.x,e.gfx.y+15); });
    if(this.remoteState.sentOff){
      const outA=new Set(this.remoteState.sentOff.a||[]), outB=new Set(this.remoteState.sentOff.b||[]);
      this.teamA.forEach(e=>{ const out=outA.has(e.id); e.gfx.setVisible(!out); e.label.setVisible(!out); if(out) this.cards.set(this._cardKey('A',e.id),{yellow:2,red:true}); });
      this.teamB.forEach(e=>{ const out=outB.has(e.id); e.gfx.setVisible(!out); e.label.setVisible(!out); if(out) this.cards.set(this._cardKey('B',e.id),{yellow:2,red:true}); });
    }
    this.activeIdA=this.remoteState.activeIdA; this.activeIdB=this.remoteState.activeIdB;
    this._highlightActive();
    document.querySelector('#scoreboard .score').textContent=`${this.remoteState.score.a} - ${this.remoteState.score.b}`;
    this._renderClock(this.remoteState.clock);
    this.currentPossession=this.remoteState.possession;
    this.confrontation=this.remoteState.confrontation;
    this._renderResultBanner(this.remoteState.confrontResult,time);
    this._paintHUD(this.remoteState.sp.b,(this.remoteState.maxSp?.b)||100,this.remoteState.stamina?.b,(this.remoteState.maxStamina?.b)||150);
    this._updatePossRing();
  }

  _syncClientIds(rs){
    if(!rs.starterIds) return;
    ['A','B'].forEach(role=>{ const team=role==='A'?this.teamA:this.teamB,ids=role==='A'?rs.starterIds.a:rs.starterIds.b,map=role==='A'?this.statsMapA:this.statsMapB; team.forEach((e,i)=>{ const nid=ids[i]; if(nid&&nid!==e.id){e.id=nid;if(!map.has(nid)){const rp=getPlayerById(nid);if(rp){const s=createPlayerStats();applyRosterPlayerToStats(s,rp);map.set(nid,s);}}}}); });
    if(rs.benchIds){this.benchA=rs.benchIds.a||this.benchA;this.benchB=rs.benchIds.b||this.benchB;}
    // PT only truly regenerates on the host — mirror its authoritative
    // values into our local copy so a client's own PT bar and technique
    // gating stay correct instead of frozen at their initial value.
    if(rs.statsAll){
      ['A','B'].forEach(role=>{
        const team=role==='A'?this.teamA:this.teamB, map=role==='A'?this.statsMapA:this.statsMapB;
        const arr=role==='A'?rs.statsAll.a:rs.statsAll.b; if(!arr) return;
        team.forEach((e,i)=>{ const sp=arr[i]; const st=map.get(e.id); if(sp!=null&&st) st.sp=sp; });
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // HUD
  // ════════════════════════════════════════════════════════════════════
  _paintHUD(sp,max,stamina,maxStamina){
    document.getElementById('sp-value').textContent=`${Math.round(sp)}/${Math.round(max||100)}`;
    if(stamina==null) return;
    const pct=Math.round(100*stamina/(maxStamina||150));
    const el=document.getElementById('stamina-value');
    el.textContent=`${pct}%`;
    el.classList.toggle('low',pct<40);
  }

  _renderResultBanner(result,now){
    const el=document.getElementById('confrontation-result');
    if(result&&now<result.until){
      if(result.until!==this._lastFxUntil){
        this._lastFxUntil=result.until;
        if(result.fx){ this._playTechniqueFx(result.fx.a); this._playTechniqueFx(result.fx.d); }
      }
      document.getElementById('result-title').textContent=result.title||'';
      const out=document.getElementById('result-outcome');
      out.textContent=(result.outcomeAt&&now>=result.outcomeAt)?result.outcome||'':'';
      el.style.display='block';
    } else el.style.display='none';
  }

  /** Expanding colored ring + the technique's name floating up — a quick,
   *  sprite-free flourish for when a player actually spends PT on a
   *  supertechnique, shown at their position on both host and client. */
  _playTechniqueFx(data){
    if(!data) return;
    const ring=this.add.circle(data.x,data.y,16,data.color,0).setStrokeStyle(5,data.color,1).setDepth(8).setScale(0.4).setAlpha(1);
    this.tweens.add({targets:ring,scale:3.2,alpha:0,duration:650,ease:'Cubic.Out',onComplete:()=>ring.destroy()});
    const txt=this.add.text(data.x,data.y-26,data.name,{fontSize:'11px',fontStyle:'bold',color:'#fff176',stroke:'#000',strokeThickness:4,resolution:3}).setOrigin(0.5,1).setDepth(9);
    this.tweens.add({targets:txt,y:txt.y-24,alpha:0,duration:900,ease:'Cubic.Out',onComplete:()=>txt.destroy()});
  }

  /** The VS beat: two cards face off, then the winner's lights up and the
   *  loser's dims. Shown to both players, whoever is involved. */
  _renderDuelReveal(rv){
    const wrap=document.getElementById('duel-reveal');
    wrap.style.display='flex';
    const side=(pre,d,lit)=>{
      const card=document.getElementById(`duel-card-${pre}`);
      card.querySelector('.duel-who').textContent=d.name;
      card.querySelector('.duel-move').textContent=d.move==='Normal'?'Normal action':d.move;
      card.classList.toggle('winner',lit&&d.winner);
      card.classList.toggle('loser',lit&&!d.winner);
    };
    const lit=!!rv.lit;
    side('a',rv.a,lit); side('d',rv.d,lit);
  }

  _updateConfrontUI(confrontation,now){
    const panel=document.getElementById('confrontation-ui');
    const reveal=document.getElementById('duel-reveal');
    if(!confrontation){panel.style.display='none';reveal.style.display='none';return;}
    if(confrontation.reveal){ panel.style.display='none'; this._renderDuelReveal(confrontation.reveal); return; }
    reveal.style.display='none';
    const amA=confrontation.attackerRole===this.role, amD=confrontation.defenderRole===this.role;
    if(!amA&&!amD){panel.style.display='none';return;}
    panel.style.display='flex';
    // Chained in from a beaten block: the attacker already made this call
    // (see _startConfront) — show them it's out of their hands now instead
    // of asking again for what's really the same shot.
    if(amA&&confrontation.attackerLocked){
      document.getElementById('confrontation-title').textContent="You're through — waiting for the keeper!";
      document.getElementById('conf-normal').style.display='none';
      document.getElementById('conf-tech-list').innerHTML='';
      document.getElementById('confrontation-player-info').innerHTML='';
      const rem=Math.max(0,confrontation.deadline-now);
      document.getElementById('confrontation-timer-fill').style.width=`${(rem/CONFRONT_MS)*100}%`;
      return;
    }
    const isDuel=confrontation.type==='duel', isBlock=confrontation.type==='block';
    const techId=isDuel?(amA?'dribble':'defense'):isBlock?(amA?'shot':'defense'):(amA?'shot':'keeper');
    const relId=amA?confrontation.attackerId:confrontation.defenderId;
    const relRole=amA?confrontation.attackerRole:confrontation.defenderRole;
    const stats=this._statsFor(relRole,relId); const rp=relId?getPlayerById(relId):null;
    document.getElementById('confrontation-title').textContent=isDuel?(amA?"Duel! You're being tackled":'Duel! Go for the tackle')
      :isBlock?(amA?'A defender is in the way!':'Block the shot — needs a supertechnique!')
      :(amA?'Shoot for goal!':'Save the shot!');
    // A block only stops anything with a supertechnique (see
    // _prepareConfrontReveal) — "normal" there just means the defender
    // deliberately does nothing, e.g. to save the PT for later.
    const normalBtn=document.getElementById('conf-normal');
    normalBtn.style.display='block';
    normalBtn.textContent=isDuel?(amA?'Normal dribble':'Normal tackle')
      :isBlock?(amA?'Shoot anyway':"Let it through")
      :(amA?'Normal shot':'Normal save');
    const myChoice=amA?confrontation.attackerChoice:confrontation.defenderChoice;
    const myChoiceIsTech=myChoice&&typeof myChoice==='object'&&typeof myChoice.tech==='number';
    normalBtn.classList.toggle('active',myChoice==='normal');
    document.getElementById('confrontation-player-info').innerHTML=stats?`<b>${rp?.name||stats.name}</b> — PT ${Math.round(stats.sp)}/${Math.round(stats.maxSP)}`:'';
    // One button per technique this player has in the category — a player
    // with more than one of the same kind (see techniquesFor) can pick
    // whichever they want, not just whichever happens to be "the" one.
    const techWrap=document.getElementById('conf-tech-list'); techWrap.innerHTML='';
    const techs=stats?techniquesFor(stats,techId):[];
    techs.forEach((tech,idx)=>{
      const btn=document.createElement('button');
      btn.className='conf-btn'; btn.dataset.idx=idx;
      btn.innerHTML=`${tech.name}<span class="cost">${tech.cost} PT</span>`;
      btn.disabled=!stats||stats.sp<tech.cost;
      if(myChoiceIsTech&&myChoice.tech===idx) btn.classList.add('active');
      techWrap.appendChild(btn);
    });
    const rem=Math.max(0,confrontation.deadline-now);
    document.getElementById('confrontation-timer-fill').style.width=`${(rem/CONFRONT_MS)*100}%`;
  }

  _syncGfx(){
    this._drawBall(this.ball.position.x,this.ball.position.y,this.ballFlight?this.ballFlight.h:0);
    const now=this.time.now;
    this.teamA.forEach(e=>{
      e.gfx.setPosition(e.body.position.x,e.body.position.y);
      e.label.setPosition(e.body.position.x,e.body.position.y+15);
      // Flash stun visual: tint grey while stunned
      e.gfx.setFillStyle(this._isStunned(e.id,now)?0x888888:this.teamColorA);
    });
    this.teamB.forEach(e=>{
      e.gfx.setPosition(e.body.position.x,e.body.position.y);
      e.label.setPosition(e.body.position.x,e.body.position.y+15);
      e.gfx.setFillStyle(this._isStunned(e.id,now)?0x888888:this.teamColorB);
    });
    this._highlightActive(); this._updatePossRing();
  }

  _highlightActive(){
    this.teamA.forEach(e=>e.gfx.setStrokeStyle(e.id===this.activeIdA?3:0,0xffffff));
    this.teamB.forEach(e=>e.gfx.setStrokeStyle(e.id===this.activeIdB?3:0,0xffffff));
  }

  _updatePossRing(){
    if(this.currentPossession){ const e=this._activeEntry(this.currentPossession); if(e){this.possRing.setPosition(e.gfx.x,e.gfx.y).setVisible(true);return;} }
    this.possRing.setVisible(false);
  }
}
