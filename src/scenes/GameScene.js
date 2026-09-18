import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate } from '../data/players.js';
import { loadRoster, getPlayerById, getGames } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';

// ─── Field & physics constants ────────────────────────────────────────
const GOAL_HALF_WIDTH       = 55;
const GOAL_CLICK_MARGIN     = 60;
const WAYPOINT_RADIUS       = 14;
const MIN_PATH_POINT_DIST   = 14;
const PLAYER_SELECT_RADIUS  = 26;
const DRAG_THRESHOLD        = 12;
const CONFRONTATION_WINDOW_MS = 20000;
const RESULT_BANNER_MS      = 3500;
const RESULT_OUTCOME_DELAY  = 800;
const POSSESSION_OFFSET     = 20;
const PASS_SPEED            = 3.0;
const TEAM_SIZE             = 11;
const BENCH_MAX             = 5;
const HALF_DURATION_S       = 3 * 60;
const STATE_HZ              = 20;

const STEER_FORCE           = 0.00028;   // very slow — RPG pace
const FORMATION_STEER_FORCE = 0.00016;
const BASE_MAX_SPEED        = 0.7;

// ─── Formation presets ────────────────────────────────────────────────
// Slot 0 = keeper. x = 0..1 across secondary axis; y = 0..1 from own
// goal (0) to halfway line (1). Orientation-independent.
const FORMATIONS = {
  '4-4-2': [
    {x:.50,y:.07},
    {x:.15,y:.24},{x:.38,y:.20},{x:.62,y:.20},{x:.85,y:.24},
    {x:.15,y:.43},{x:.38,y:.41},{x:.62,y:.41},{x:.85,y:.43},
    {x:.35,y:.63},{x:.65,y:.63}
  ],
  '4-3-3': [
    {x:.50,y:.07},
    {x:.16,y:.24},{x:.38,y:.20},{x:.62,y:.20},{x:.84,y:.24},
    {x:.25,y:.43},{x:.50,y:.40},{x:.75,y:.43},
    {x:.22,y:.62},{x:.50,y:.66},{x:.78,y:.62}
  ],
  '4-2-3-1': [
    {x:.50,y:.07},
    {x:.15,y:.22},{x:.38,y:.18},{x:.62,y:.18},{x:.85,y:.22},
    {x:.35,y:.35},{x:.65,y:.35},
    {x:.20,y:.52},{x:.50,y:.50},{x:.80,y:.52},
    {x:.50,y:.68}
  ],
  '3-5-2': [
    {x:.50,y:.07},
    {x:.25,y:.20},{x:.50,y:.18},{x:.75,y:.20},
    {x:.12,y:.40},{x:.32,y:.36},{x:.50,y:.34},{x:.68,y:.36},{x:.88,y:.40},
    {x:.38,y:.62},{x:.62,y:.62}
  ]
};
const DEFAULT_FORMATION = '4-4-2';

// Fallback color per game tag (used when a player has no team color)
const GAME_FALLBACK = {
  IE1:0x3399ff, IE2:0xff9933, IE3:0x66cc66,
  GO1:0xcc66ff, GO2:0xff6699, GO3:0x66cccc,
  Ares:0xcccc33, VR:0x999999
};
function hexToInt(hex){ const n=parseInt((hex||'').replace('#',''),16); return isNaN(n)?null:n; }

export default class GameScene extends Phaser.Scene {
  constructor(){ super('GameScene'); }

  create(){
    this.horizontal = window.innerWidth > window.innerHeight;
    this.FIELD_W = this.horizontal ? 760 : 480;
    this.FIELD_H = this.horizontal ? 480 : 760;

    const roomCode = getOrCreateRoomCode();
    document.getElementById('room-code').textContent = roomCode;
    this.net = connectToRoom(roomCode);
    this.role = this.net.isHost() ? 'A' : 'B';

    this._drawField();
    this.pathGraphics = this.add.graphics();

    // Physics world
    this.matter.world.setBounds(0, 0, this.FIELD_W, this.FIELD_H);
    this.ball = this.matter.add.circle(this.FIELD_W/2, this.FIELD_H/2, 7,
      {restitution:.7, frictionAir:.02, label:'ball'});
    this.ballGfx = this.add.circle(this.ball.position.x, this.ball.position.y, 7, 0xffffff);
    this._drawGoals();

    this.possessionRing = this.add.circle(0,0,15)
      .setStrokeStyle(3,0xffd966).setFillStyle(0,0).setVisible(false);

    // Teams
    this.teamA=[]; this.teamB=[];
    this.statsMapA=new Map(); this.statsMapB=new Map();
    this.activeIdA=null; this.activeIdB=null;
    this.teamColorA=0x3399ff; this.teamColorB=0xff4444;
    this.score={a:0,b:0};
    this.clientTeamsBuilt=false;
    this.formation={A:DEFAULT_FORMATION, B:DEFAULT_FORMATION};
    this.pendingFormationChange=null;

    this.matchClock={half:1, secondsRemaining:HALF_DURATION_S, ended:false};

    this.possessorRole=null; this.currentPossession=null;
    this.duelLockUntil=0; this.confrontation=null;
    this.confrontationResult=null;
    this.resultCountdown=null;

    this.matchStarted=false;
    // Squad is now stored as a list-of-slots (starterIds[slot]) + bench
    this.squadSlots=Array(TEAM_SIZE).fill(null);   // [rosterId | null]
    this.benchIds=new Set();
    this.chosenFormation=DEFAULT_FORMATION;
    this.mySquadConfirmed=false;
    this.mySquadPayload=null;
    this.remoteSquadPayload=null;

    // Input state
    this.myPaths=new Map();
    this.drawing=false;
    this.selectedPlayerId=null;
    this.gestureStart=null;
    this.gestureMoved=false;
    this.pendingShootRequest=false;
    this.pendingPassTarget=null;
    this.pendingConfrontationChoice=null;
    this.pendingSubRequest=null;
    this.subOutSelection=null;

    // Pointer handlers (for in-game path drawing / passing)
    this.input.on('pointerdown',   (p)=>this._onPointerDown(p));
    this.input.on('pointermove',   (p)=>{ if(p.isDown) this._extendPath(p); });
    this.input.on('pointerup',     (p)=>this._onPointerUp(p));
    this.input.on('pointerupoutside',(p)=>this._onPointerUp(p));

    // Confrontation panel buttons
    document.getElementById('conf-normal').addEventListener('pointerdown',(e)=>{
      e.stopPropagation(); this.pendingConfrontationChoice='normal';
    });
    document.getElementById('conf-technique').addEventListener('pointerdown',(e)=>{
      e.stopPropagation(); this.pendingConfrontationChoice='technique';
    });

    // In-match UI buttons
    document.getElementById('sub-button').addEventListener('click',()=>this._openSubPanel());
    document.getElementById('sub-cancel-btn').addEventListener('click',()=>{
      document.getElementById('sub-panel').style.display='none';
    });
    document.getElementById('formation-button').addEventListener('click',()=>this._openFormationPickPanel());
    document.getElementById('formation-pick-close').addEventListener('click',()=>{
      document.getElementById('formation-pick-panel').style.display='none';
    });

    // Build squad-editor UI
    this.rosterAll=[];
    document.getElementById('squad-pick-list').innerHTML=
      '<p style="opacity:.8;font-size:12px;">Loading roster…</p>';
    loadRoster().then((data)=>{
      this.rosterAll=data;
      const gs=document.getElementById('squad-game-filter');
      getGames().forEach((g)=>{
        const o=document.createElement('option');
        o.value=g; o.textContent=g; gs.appendChild(o);
      });
      this._initSquadEditor();
    }).catch((err)=>{
      console.error('[roster]',err);
      document.getElementById('squad-pick-list').innerHTML=
        `<p style="color:#f88">Couldn't load roster.<br>${err.message}</p>`;
    });

    document.getElementById('confirm-squad-btn').addEventListener('click',()=>this._confirmSquad());

    // Networking
    this.remoteState=null;
    this.remoteInput={targets:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,formationChange:null};
    this.net.onInput((d)=>{ this.remoteInput=d; });
    this.net.onState((d)=>this._handleIncomingState(d));
    this.net.onSquad((d)=>{
      this.remoteSquadPayload=d;
      if(this.role==='A' && this.mySquadConfirmed && !this.matchStarted)
        this._startMatch(this.mySquadPayload, d);
    });

    this.matter.world.on('collisionstart',(ev)=>this._handleCollisions(ev));
    this.lastStateSent=0;
  }

  // ════════════════════════════════════════════════════════════════════
  // Field drawing
  // ════════════════════════════════════════════════════════════════════
  _drawField(){
    const {FIELD_W:w,FIELD_H:h}=this;
    this.add.rectangle(w/2,h/2,w,h,0x1e7a3c).setStrokeStyle(4,0xffffff);
    if(this.horizontal)
      this.add.rectangle(w/2,h/2,1,h,0xffffff).setAlpha(0.4);
    else
      this.add.rectangle(w/2,h/2,w,1,0xffffff).setAlpha(0.4);
  }
  _drawGoals(){
    const {FIELD_W:w,FIELD_H:h}=this;
    if(this.horizontal){
      this.add.rectangle(10,h/2,6,GOAL_HALF_WIDTH*2,0xffffff);
      this.add.rectangle(w-10,h/2,6,GOAL_HALF_WIDTH*2,0xffffff);
      this.goalMin=this.matter.add.rectangle(0,h/2,12,GOAL_HALF_WIDTH*2,{isSensor:true,isStatic:true,label:'goalMin'});
      this.goalMax=this.matter.add.rectangle(w,h/2,12,GOAL_HALF_WIDTH*2,{isSensor:true,isStatic:true,label:'goalMax'});
    } else {
      this.add.rectangle(w/2,10,GOAL_HALF_WIDTH*2,6,0xffffff);
      this.add.rectangle(w/2,h-10,GOAL_HALF_WIDTH*2,6,0xffffff);
      this.goalMin=this.matter.add.rectangle(w/2,0,GOAL_HALF_WIDTH*2,12,{isSensor:true,isStatic:true,label:'goalMin'});
      this.goalMax=this.matter.add.rectangle(w/2,h,GOAL_HALF_WIDTH*2,12,{isSensor:true,isStatic:true,label:'goalMax'});
    }
  }
  _primaryAxis()    { return this.horizontal?'x':'y'; }
  _secondaryAxis()  { return this.horizontal?'y':'x'; }
  _primarySize()    { return this.horizontal?this.FIELD_W:this.FIELD_H; }
  _secondarySize()  { return this.horizontal?this.FIELD_H:this.FIELD_W; }

  // ════════════════════════════════════════════════════════════════════
  // Avatar helpers
  // ════════════════════════════════════════════════════════════════════
  _rosterColor(p){ return hexToInt(p&&p.teamColor) ?? (GAME_FALLBACK[p&&p.game]??0x999999); }
  _initials(p){
    return (p.nickname||p.name||'?').split(' ').map(w=>w[0]||'').slice(0,2).join('').toUpperCase();
  }
  _css3Color(intColor){ return '#'+intColor.toString(16).padStart(6,'0'); }

  // ════════════════════════════════════════════════════════════════════
  // Squad editor (topological / pitch-based)
  // ════════════════════════════════════════════════════════════════════

  _initSquadEditor(){
    const formSel=document.getElementById('formation-select');
    formSel.addEventListener('change',()=>{
      this.chosenFormation=formSel.value;
      this._renderPitch();
    });

    document.getElementById('randomize-squad-btn').addEventListener('click',()=>this._randomizeSquad());
    document.getElementById('squad-whole-team-btn').addEventListener('click',()=>this._useWholeTeam());

    const searchEl=document.getElementById('squad-search');
    const gameEl=document.getElementById('squad-game-filter');
    searchEl.addEventListener('input',()=>this._renderPickList());
    gameEl.addEventListener('change',()=>this._renderPickList());

    this._renderPitch();
    this._renderPickList();
    this._refreshConfirmBtn();
  }

  _slotMatches(){
    return this.squadSlots.filter(Boolean).length;
  }

  _allInSquad(){
    const set=new Set(this.squadSlots.filter(Boolean));
    for(const id of this.benchIds) set.add(id);
    return set;
  }

  // ---- Pitch rendering -------------------------------------------------

  _renderPitch(){
    const pitch=document.getElementById('formation-pitch');
    pitch.innerHTML='<div class="pitch-line-h"></div>';

    const preset=FORMATIONS[this.chosenFormation]||FORMATIONS[DEFAULT_FORMATION];

    preset.forEach((f,slot)=>{
      const pin=document.createElement('div');
      pin.className='slot-pin';
      pin.dataset.slot=slot;
      // x=secondary(across pitch), y=primary(from own goal)
      // The pitch HTML element is always portrait (aspect-ratio:2/3)
      // secondary maps to left, primary maps to top (from bottom = own goal)
      pin.style.left=(f.x*100)+'%';
      pin.style.top = ((1-f.y)*100)+'%';   // invert: 0=own goal=bottom

      const pid=this.squadSlots[slot];
      const p=pid?getPlayerById(pid):null;
      if(p){
        const color=this._css3Color(this._rosterColor(p));
        pin.innerHTML=`<div class="pin-avatar" style="background:${color}">${this._initials(p)}</div><div class="pin-name">${p.nickname||p.name}</div>`;
      } else {
        pin.classList.add('empty');
        pin.innerHTML=`<div style="font-size:10px;opacity:.5;">slot ${slot===0?'GK':slot}</div>`;
      }
      this._makePinDraggable(pin, 'slot', slot);
      pitch.appendChild(pin);
    });

    // bench strip
    const strip=document.getElementById('bench-strip');
    strip.innerHTML='';
    [...this.benchIds].forEach((pid)=>{
      const p=getPlayerById(pid);
      if(!p) return;
      const pin=document.createElement('div');
      pin.className='bench-pin';
      pin.dataset.benchId=pid;
      const color=this._css3Color(this._rosterColor(p));
      pin.innerHTML=`<div class="pin-avatar" style="background:${color};width:32px;height:32px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:rgba(0,0,0,.8)">${this._initials(p)}</div><div class="pin-name">${p.nickname||p.name}</div>`;
      this._makePinDraggable(pin, 'bench', pid);
      strip.appendChild(pin);
    });

    document.getElementById('bench-count').textContent=this.benchIds.size;
    document.getElementById('squad-fill-count').textContent=`${this._slotMatches()}/11 filled`;
    this._refreshConfirmBtn();
  }

  // ---- Drag-and-drop between pitch slots and the pick list ---------------

  _dragState=null;   // {type:'slot'|'bench'|'list', id, el, ghost}

  _makePinDraggable(el, type, idOrSlot){
    el.addEventListener('pointerdown',(e)=>{
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const ghost=el.cloneNode(true);
      ghost.style.cssText+=';position:fixed;pointer-events:none;opacity:0.85;z-index:100;';
      ghost.classList.add('dragging');
      document.body.appendChild(ghost);
      this._dragState={type, id:idOrSlot, el, ghost,
        startX:e.clientX, startY:e.clientY, moved:false};
      this._moveDragGhost(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove',(e)=>{
      if(!this._dragState||this._dragState.el!==el) return;
      this._dragState.moved=true;
      this._moveDragGhost(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup',(e)=>{
      if(!this._dragState||this._dragState.el!==el) return;
      this._dragState.ghost.remove();
      if(this._dragState.moved) this._dropAt(e.clientX, e.clientY, this._dragState);
      this._dragState=null;
    });
  }

  _moveDragGhost(cx,cy){
    const g=this._dragState.ghost;
    g.style.left=(cx-22)+'px'; g.style.top=(cy-22)+'px';
  }

  _dropAt(cx,cy,drag){
    // Find what's under the pointer: another slot-pin, bench-pin, or pick-card?
    const els=document.elementsFromPoint(cx,cy);

    // Priority 1: drop on a slot-pin
    const targetSlotEl=els.find(el=>el.classList.contains('slot-pin')&&!el.classList.contains('dragging'));
    if(targetSlotEl){
      const targetSlot=parseInt(targetSlotEl.dataset.slot);
      this._swapToSlot(drag, targetSlot);
      this._renderPitch();
      this._renderPickList();
      return;
    }

    // Priority 2: drop on bench strip or a bench-pin
    const benchArea=document.getElementById('bench-strip');
    const inBench=els.includes(benchArea)||els.find(el=>el.classList.contains('bench-pin')&&!el.classList.contains('dragging'));
    if(inBench){
      this._moveToBench(drag);
      this._renderPitch();
      this._renderPickList();
      return;
    }

    // No valid target — drop back (no-op, already cleaned up)
  }

  _swapToSlot(drag, targetSlot){
    const currentInTarget=this.squadSlots[targetSlot];
    if(drag.type==='slot'){
      const sourceSlot=drag.id;
      this.squadSlots[targetSlot]=this.squadSlots[sourceSlot];
      this.squadSlots[sourceSlot]=currentInTarget;
    } else if(drag.type==='bench'){
      const pid=drag.id;
      if(currentInTarget) this.benchIds.add(currentInTarget);
      this.squadSlots[targetSlot]=pid;
      this.benchIds.delete(pid);
    } else if(drag.type==='list'){
      const pid=drag.id;
      if(currentInTarget && !this._allInSquad().has(currentInTarget)){
        // was nowhere; just remove from slot cleanly
      } else if(currentInTarget){
        this.squadSlots[this.squadSlots.indexOf(currentInTarget)]=null;
      }
      if(currentInTarget) { /* push old occupant out — it's just removed */ }
      this.squadSlots[targetSlot]=pid;
    }
  }

  _moveToBench(drag){
    if(this.benchIds.size>=BENCH_MAX && drag.type!=='bench') return;
    if(drag.type==='slot'){
      const pid=this.squadSlots[drag.id];
      if(!pid) return;
      if(this.benchIds.size<BENCH_MAX){
        this.benchIds.add(pid);
        this.squadSlots[drag.id]=null;
      }
    } else if(drag.type==='list'){
      if(this.benchIds.size<BENCH_MAX) this.benchIds.add(drag.id);
    }
    // bench→bench: no-op (already there)
  }

  // ---- Pick list (roster search) ----------------------------------------

  _renderPickList(){
    const list=document.getElementById('squad-pick-list');
    const q=(document.getElementById('squad-search').value||'').toLowerCase();
    const gf=document.getElementById('squad-game-filter').value;
    const inSquad=this._allInSquad();
    const MAX=120;

    const matches=this.rosterAll.filter(p=>
      (!gf||p.game===gf)&&
      (!q||p.name.toLowerCase().includes(q)||(p.nickname||'').toLowerCase().includes(q))
    );
    document.getElementById('pick-count').textContent=
      matches.length>MAX?`Showing ${MAX} of ${matches.length} — narrow the search`:`${matches.length} players`;

    list.innerHTML='';
    matches.slice(0,MAX).forEach(p=>{
      const card=document.createElement('div');
      card.className='pick-card'+(inSquad.has(p.id)?' in-squad':'');
      const color=this._css3Color(this._rosterColor(p));
      card.innerHTML=`
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
          <span class="av" style="width:20px;height:20px;font-size:8px;background:${color}">${this._initials(p)}</span>
          <span class="pick-name">${p.nickname||p.name}</span>
        </div>
        <div style="font-size:10px;opacity:.7">${p.position} · ${p.team||p.game}</div>
        <div style="font-size:10px;opacity:.6">SPD ${p.stats.speed} SHT ${p.stats.shotPower}</div>`;

      // Tap to fill first empty slot
      card.addEventListener('click',()=>{
        if(inSquad.has(p.id)) return;
        const empty=this.squadSlots.findIndex(s=>s===null);
        if(empty===-1 && this.benchIds.size<BENCH_MAX){ this.benchIds.add(p.id); }
        else if(empty!==-1){ this.squadSlots[empty]=p.id; }
        this._renderPitch(); this._renderPickList();
      });
      // Drag from list
      this._makePinDraggable(card,'list',p.id);
      list.appendChild(card);
    });

    // enable "use whole team" only when a game is filtered
    document.getElementById('squad-whole-team-btn').disabled=!gf;
  }

  _useWholeTeam(){
    const gf=document.getElementById('squad-game-filter').value;
    if(!gf) return;
    const pool=this.rosterAll.filter(p=>p.game===gf);
    const gk=pool.find(p=>p.position==='GK');
    const rest=pool.filter(p=>!gk||p.id!==gk.id);
    const ordered=gk?[gk,...rest]:rest;
    this.squadSlots=ordered.slice(0,TEAM_SIZE).map(p=>p.id);
    while(this.squadSlots.length<TEAM_SIZE) this.squadSlots.push(null);
    this.benchIds=new Set(ordered.slice(TEAM_SIZE,TEAM_SIZE+BENCH_MAX).map(p=>p.id));
    this._renderPitch(); this._renderPickList();
  }

  _randomizeSquad(){
    const pool=[...this.rosterAll];
    Phaser.Utils.Array.Shuffle(pool);
    const gk=pool.find(p=>p.position==='GK');
    const rest=pool.filter(p=>!gk||p.id!==gk.id);
    const ordered=gk?[gk,...rest]:rest;
    this.squadSlots=ordered.slice(0,TEAM_SIZE).map(p=>p.id);
    while(this.squadSlots.length<TEAM_SIZE) this.squadSlots.push(null);
    this.benchIds=new Set(ordered.slice(TEAM_SIZE,TEAM_SIZE+BENCH_MAX).map(p=>p.id));
    const fkeys=Object.keys(FORMATIONS);
    this.chosenFormation=Phaser.Utils.Array.GetRandom(fkeys);
    document.getElementById('formation-select').value=this.chosenFormation;
    this._renderPitch(); this._renderPickList();
  }

  _refreshConfirmBtn(){
    const filled=this._slotMatches();
    const btn=document.getElementById('confirm-squad-btn');
    btn.textContent=`Confirm squad (${filled}/11)`;
    btn.disabled=filled!==TEAM_SIZE;
  }

  _confirmSquad(){
    const starterIds=this.squadSlots.filter(Boolean);
    if(starterIds.length!==TEAM_SIZE) return;
    const payload={
      starterIds,
      benchIds:[...this.benchIds],
      formation:this.chosenFormation
    };
    this.mySquadPayload=payload;
    this.mySquadConfirmed=true;
    this.net.sendSquad(payload);
    document.getElementById('confirm-squad-btn').disabled=true;

    if(this.role==='A'){
      if(!this.net.hasPeer()){
        this._startMatch(payload, this._defaultAISquad());
      } else if(this.remoteSquadPayload){
        this._startMatch(payload, this.remoteSquadPayload);
      } else {
        document.getElementById('squad-status').textContent='Waiting for opponent…';
      }
    } else {
      document.getElementById('squad-status').textContent='Waiting for match to start…';
    }
  }

  _defaultAISquad(){
    const pool=this.rosterAll;
    const gk=pool.find(p=>p.position==='GK');
    const rest=pool.filter(p=>!gk||p.id!==gk.id);
    const ordered=gk?[gk,...rest]:rest;
    return{
      starterIds:ordered.slice(0,TEAM_SIZE).map(p=>p.id),
      benchIds:ordered.slice(TEAM_SIZE,TEAM_SIZE+3).map(p=>p.id),
      formation:DEFAULT_FORMATION
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // Match setup
  // ════════════════════════════════════════════════════════════════════

  /** Derive one "team color" from the majority kit color of the squad. */
  _squadColor(starterIds, fallback){
    const colorCounts={};
    for(const id of starterIds){
      const p=getPlayerById(id);
      const col=p&&p.teamColor?p.teamColor:null;
      if(col) colorCounts[col]=(colorCounts[col]||0)+1;
    }
    const top=Object.entries(colorCounts).sort((a,b)=>b[1]-a[1])[0];
    return top?hexToInt(top[0]):fallback;
  }

  _buildTeam(role, starterIds, withPhysics){
    const team=[];
    const map=role==='A'?this.statsMapA:this.statsMapB;
    const teamColor=role==='A'?this.teamColorA:this.teamColorB;
    starterIds.forEach((id,slot)=>{
      const rp=getPlayerById(id);
      if(!rp) return;
      const pos=this._formPos(role, slot, {x:this.FIELD_W/2, y:this.FIELD_H/2});
      const body=withPhysics?this.matter.add.circle(pos.x,pos.y,9,{frictionAir:.14,label:`${role}${slot}`}):null;
      const gfx=this.add.circle(pos.x,pos.y,9,teamColor);
      // Name label
      const label=this.add.text(pos.x, pos.y+13, rp.nickname||rp.name,
        {fontSize:'6px', color:'#ffffff', stroke:'#000', strokeThickness:2, resolution:3});
      label.setOrigin(0.5,0);
      team.push({id, body, gfx, label, slot});
      const stats=createPlayerStats();
      applyRosterPlayerToStats(stats,rp);
      map.set(id,stats);
    });
    return team;
  }

  _findGkId(starterIds){
    const found=starterIds.find(id=>{ const p=getPlayerById(id); return p&&p.position==='GK'; });
    return found||starterIds[0];
  }

  _startMatch(payloadA, payloadB){
    this.formation.A=payloadA.formation||DEFAULT_FORMATION;
    this.formation.B=payloadB.formation||DEFAULT_FORMATION;
    this.teamColorA=this._squadColor(payloadA.starterIds,0x3399ff);
    this.teamColorB=this._squadColor(payloadB.starterIds,0xff4444);
    this.teamA=this._buildTeam('A',payloadA.starterIds,true);
    this.teamB=this._buildTeam('B',payloadB.starterIds,true);
    this.benchA=(payloadA.benchIds||[]).filter(id=>getPlayerById(id));
    this.benchB=(payloadB.benchIds||[]).filter(id=>getPlayerById(id));
    this.gkIdA=this._findGkId(payloadA.starterIds);
    this.gkIdB=this._findGkId(payloadB.starterIds);
    this.activeIdA=this.teamA[0]?this.teamA[0].id:null;
    this.activeIdB=this.teamB[0]?this.teamB[0].id:null;
    this.matchStarted=true;
    document.getElementById('squad-editor-panel').style.display='none';
    document.getElementById('formation-button').style.display='block';
  }

  _buildClientTeams(){
    if(this.clientTeamsBuilt||!this.mySquadPayload||!this.remoteSquadPayload) return;
    this.formation.A=this.remoteSquadPayload.formation||DEFAULT_FORMATION;
    this.formation.B=this.mySquadPayload.formation||DEFAULT_FORMATION;
    this.teamColorA=this._squadColor(this.remoteSquadPayload.starterIds,0x3399ff);
    this.teamColorB=this._squadColor(this.mySquadPayload.starterIds,0xff4444);
    this.teamA=this._buildTeam('A',this.remoteSquadPayload.starterIds,false);
    this.teamB=this._buildTeam('B',this.mySquadPayload.starterIds,false);
    this.benchA=this.remoteSquadPayload.benchIds||[];
    this.benchB=this.mySquadPayload.benchIds||[];
    this.gkIdA=this._findGkId(this.remoteSquadPayload.starterIds);
    this.gkIdB=this._findGkId(this.mySquadPayload.starterIds);
    this.clientTeamsBuilt=true;
    document.getElementById('formation-button').style.display='block';
  }

  _formPos(role, slot, ballPos){
    const preset=FORMATIONS[this.formation[role]]||FORMATIONS[DEFAULT_FORMATION];
    const f=preset[slot]||preset[preset.length-1];
    const pSize=this._primarySize(), sSize=this._secondarySize(), margin=24;
    const halfP=pSize/2-margin;
    let primary=f.y*halfP+margin;
    if(role==='B') primary=pSize-primary;
    let secondary=f.x*sSize;
    secondary+=Phaser.Math.Clamp((ballPos[this._secondaryAxis()]-sSize/2)*0.12,-35,35);
    return this.horizontal?{x:primary,y:secondary}:{x:secondary,y:primary};
  }

  // ════════════════════════════════════════════════════════════════════
  // Formation change (mid-match)
  // ════════════════════════════════════════════════════════════════════
  _openFormationPickPanel(){
    const wrap=document.getElementById('formation-preset-btns');
    wrap.innerHTML='';
    Object.keys(FORMATIONS).forEach(name=>{
      const btn=document.createElement('button');
      btn.textContent=name;
      btn.addEventListener('click',()=>{
        this.pendingFormationChange=name;
        document.getElementById('formation-pick-panel').style.display='none';
      });
      wrap.appendChild(btn);
    });
    document.getElementById('formation-pick-panel').style.display='flex';
  }

  // ════════════════════════════════════════════════════════════════════
  // Substitutions
  // ════════════════════════════════════════════════════════════════════
  _openSubPanel(){
    this.subOutSelection=null;
    this._renderSubStep();
    document.getElementById('sub-panel').style.display='flex';
  }
  _renderSubStep(){
    const title=document.getElementById('sub-panel-title');
    const listEl=document.getElementById('sub-list-inner');
    listEl.innerHTML='';
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    const myBench=this.role==='A'?(this.benchA||[]):(this.benchB||[]);
    if(!this.subOutSelection){
      title.textContent='Who comes off?';
      myTeam.forEach(entry=>{
        const p=getPlayerById(entry.id); if(!p) return;
        const c=document.createElement('div'); c.className='sub-card';
        const color=this._css3Color(this._rosterColor(p));
        c.innerHTML=`<div style="display:flex;align-items:center;gap:6px;"><span class="av" style="width:24px;height:24px;font-size:9px;background:${color};flex-shrink:0">${this._initials(p)}</span><b>${p.nickname||p.name}</b></div><div style="font-size:10px;opacity:.7">${p.position}</div><button>Sub off</button>`;
        c.querySelector('button').addEventListener('click',()=>{ this.subOutSelection=entry.id; this._renderSubStep(); });
        listEl.appendChild(c);
      });
    } else {
      title.textContent='Who comes on?';
      const bench=myBench.map(id=>getPlayerById(id)).filter(Boolean);
      if(!bench.length){ listEl.innerHTML='<p>No bench players.</p>'; return; }
      bench.forEach(p=>{
        const c=document.createElement('div'); c.className='sub-card';
        const color=this._css3Color(this._rosterColor(p));
        c.innerHTML=`<div style="display:flex;align-items:center;gap:6px;"><span class="av" style="width:24px;height:24px;font-size:9px;background:${color};flex-shrink:0">${this._initials(p)}</span><b>${p.nickname||p.name}</b></div><div style="font-size:10px;opacity:.7">${p.position}</div><button>Bring on</button>`;
        c.querySelector('button').addEventListener('click',()=>{
          this.pendingSubRequest={outId:this.subOutSelection, inId:p.id};
          document.getElementById('sub-panel').style.display='none';
        });
        listEl.appendChild(c);
      });
    }
  }
  _trySub(role, req){
    if(!req||!req.outId||!req.inId) return;
    const team=role==='A'?this.teamA:this.teamB;
    const bench=role==='A'?this.benchA:this.benchB;
    const map=role==='A'?this.statsMapA:this.statsMapB;
    const benchIdx=bench.indexOf(req.inId);
    const entry=team.find(t=>t.id===req.outId);
    if(benchIdx===-1||!entry) return;
    const rp=getPlayerById(req.inId); if(!rp) return;
    entry.id=req.inId;
    const st=createPlayerStats(); applyRosterPlayerToStats(st,rp); map.set(req.inId,st);
    bench.splice(benchIdx,1,req.outId);
    if(role==='A'&&this.activeIdA===req.outId) this.activeIdA=req.inId;
    if(role==='B'&&this.activeIdB===req.outId) this.activeIdB=req.inId;
    if(role==='A'&&this.gkIdA===req.outId) this.gkIdA=req.inId;
    if(role==='B'&&this.gkIdB===req.outId) this.gkIdB=req.inId;
  }

  // ════════════════════════════════════════════════════════════════════
  // In-game input
  // ════════════════════════════════════════════════════════════════════
  _onPointerDown(pointer){
    if(!this.matchStarted||this.matchClock.ended) return;
    const towardMax=this.role==='A';
    if(this._iHavePossession()&&this._inGoalRegion(pointer.x,pointer.y,towardMax)&&!this.confrontation){
      this.pendingShootRequest=true; return;
    }
    if(this.confrontation) return;
    this.gestureStart={x:pointer.x,y:pointer.y};
    this.gestureMoved=false;
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    let nearest=null, nearestD=PLAYER_SELECT_RADIUS;
    myTeam.forEach(e=>{
      const d=Phaser.Math.Distance.Between(e.gfx.x,e.gfx.y,pointer.x,pointer.y);
      if(d<nearestD){nearestD=d;nearest=e;}
    });
    const activeId=this.role==='A'?this.activeIdA:this.activeIdB;
    this.pendingSelectedPlayerId=nearest?nearest.id:activeId;
    this.drawing=true;
  }
  _extendPath(pointer){
    if(!this.drawing) return;
    if(!this.gestureMoved){
      if(!this.gestureStart||Phaser.Math.Distance.Between(this.gestureStart.x,this.gestureStart.y,pointer.x,pointer.y)<DRAG_THRESHOLD) return;
      this.gestureMoved=true;
      this.selectedPlayerId=this.pendingSelectedPlayerId;
      this.myPaths.set(this.selectedPlayerId,[{x:this.gestureStart.x,y:this.gestureStart.y},{x:pointer.x,y:pointer.y}]);
      return;
    }
    const path=this.myPaths.get(this.selectedPlayerId);
    if(!path) return;
    const last=path[path.length-1];
    if(!last||Phaser.Math.Distance.Between(last.x,last.y,pointer.x,pointer.y)>MIN_PATH_POINT_DIST)
      path.push({x:pointer.x,y:pointer.y});
  }
  _onPointerUp(){
    if(this.drawing&&!this.gestureMoved&&this.gestureStart&&this.matchStarted&&!this.confrontation)
      if(this._iHavePossession()) this.pendingPassTarget={x:this.gestureStart.x,y:this.gestureStart.y};
    this.drawing=false; this.gestureStart=null;
  }
  _inGoalRegion(x,y,towardMax){
    const pv=this.horizontal?x:y, sv=this.horizontal?y:x;
    const ps=this._primarySize(), ss=this._secondarySize();
    return Math.abs(sv-ss/2)<GOAL_HALF_WIDTH+30&&(towardMax?pv>ps-GOAL_CLICK_MARGIN:pv<GOAL_CLICK_MARGIN);
  }
  _iHavePossession(){ return this.currentPossession===this.role; }

  _computeMyTargets(){
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    const targets=[];
    for(const entry of myTeam){
      const path=this.myPaths.get(entry.id);
      if(!path||!path.length) continue;
      const pos=entry.body?entry.body.position:entry.gfx;
      while(path.length&&Phaser.Math.Distance.Between(pos.x,pos.y,path[0].x,path[0].y)<WAYPOINT_RADIUS) path.shift();
      if(path.length) targets.push({id:entry.id,x:path[0].x,y:path[0].y});
      else this.myPaths.delete(entry.id);
    }
    return targets;
  }

  _drawPaths(){
    this.pathGraphics.clear();
    if(!this.matchStarted) return;
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    this.pathGraphics.lineStyle(2,0xffe066,0.85);
    myTeam.forEach(entry=>{
      const path=this.myPaths.get(entry.id);
      if(!path||!path.length) return;
      const pos=entry.body?entry.body.position:entry.gfx;
      this.pathGraphics.beginPath();
      this.pathGraphics.moveTo(pos.x,pos.y);
      path.forEach(pt=>this.pathGraphics.lineTo(pt.x,pt.y));
      this.pathGraphics.strokePath();
      const last=path[path.length-1];
      this.pathGraphics.fillStyle(0xffe066,1);
      this.pathGraphics.fillCircle(last.x,last.y,4);
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // Physics helpers
  // ════════════════════════════════════════════════════════════════════
  _steer(body,target,speed=1,force=STEER_FORCE){
    const dx=target.x-body.position.x, dy=target.y-body.position.y;
    const dist=Math.hypot(dx,dy); if(dist<4) return;
    const f=force*speed;
    this.matter.body.applyForce(body,body.position,{x:(dx/dist)*f,y:(dy/dist)*f});
    const v=body.velocity, s=Math.hypot(v.x,v.y), mx=BASE_MAX_SPEED*speed;
    if(s>mx) this.matter.body.setVelocity(body,{x:(v.x/s)*mx,y:(v.y/s)*mx});
  }
  _glueBall(){
    if(!this.possessorRole) return;
    const e=this._activeEntry(this.possessorRole); if(!e||!e.body) return;
    const b=e.body, vel=b.velocity, sp=Math.hypot(vel.x,vel.y);
    let dx=0,dy=0;
    if(sp>0.05){dx=vel.x/sp;dy=vel.y/sp;}
    else{ const ax=this._primaryAxis(),sign=this.possessorRole==='A'?1:-1; if(ax==='x')dx=sign; else dy=sign; }
    this.matter.body.setPosition(this.ball,{x:b.position.x+dx*POSSESSION_OFFSET,y:b.position.y+dy*POSSESSION_OFFSET});
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
  }
  _doPass(role,target){
    const e=this._activeEntry(role); if(!e||!e.body) return;
    const dx=target.x-e.body.position.x, dy=target.y-e.body.position.y;
    const dist=Math.hypot(dx,dy)||1;
    this.possessorRole=null;
    this.matter.body.setVelocity(this.ball,{x:(dx/dist)*PASS_SPEED,y:(dy/dist)*PASS_SPEED});
  }
  _knockback(loserE,winnerE){
    if(!loserE.body||!winnerE.body) return;
    const dx=loserE.body.position.x-winnerE.body.position.x;
    const dy=loserE.body.position.y-winnerE.body.position.y;
    const d=Math.hypot(dx,dy)||1;
    this.matter.body.setVelocity(loserE.body,{x:(dx/d)*3,y:(dy/d)*3});
  }
  _activeEntry(role){
    const team=role==='A'?this.teamA:this.teamB;
    const id=role==='A'?this.activeIdA:this.activeIdB;
    return team.find(t=>t.id===id)||null;
  }
  _updateActive(role){
    const team=role==='A'?this.teamA:this.teamB;
    if(!team.length) return;
    const bp=this.ball.position;
    let best=team[0], bestD=Phaser.Math.Distance.Between(team[0].body.position.x,team[0].body.position.y,bp.x,bp.y);
    for(const e of team){
      const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,bp.x,bp.y);
      if(d<bestD){bestD=d;best=e;}
    }
    const cur=role==='A'?this.activeIdA:this.activeIdB;
    if(best.id!==cur){
      const ce=team.find(t=>t.id===cur);
      const cd=ce?Phaser.Math.Distance.Between(ce.body.position.x,ce.body.position.y,bp.x,bp.y):Infinity;
      if(cd-bestD>18){ if(role==='A')this.activeIdA=best.id; else this.activeIdB=best.id; }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Collisions
  // ════════════════════════════════════════════════════════════════════
  _handleCollisions(event){
    if(this.role!=='A'||!this.matchStarted) return;
    const now=this.time.now;
    const eA=this._activeEntry('A'), eB=this._activeEntry('B');
    if(!eA||!eB) return;
    for(const pair of event.pairs){
      const lbls=[pair.bodyA.label,pair.bodyB.label];
      const bods=[pair.bodyA,pair.bodyB];
      const ball=lbls.includes('ball');
      const hA=bods.includes(eA.body), hB=bods.includes(eB.body);
      if(ball&&(hA||hB)&&!this.possessorRole&&!this.confrontation)
        this.possessorRole=hA?'A':'B';
      if(hA&&hB&&this.possessorRole&&!this.confrontation&&now>=this.duelLockUntil)
        this._startConfrontation('duel',this.possessorRole,this.possessorRole==='A'?'B':'A',now);
      if(ball&&lbls.includes('goalMin')) this._onGoal('b');
      if(ball&&lbls.includes('goalMax')) this._onGoal('a');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Confrontations
  // ════════════════════════════════════════════════════════════════════
  _startConfrontation(type,attackerRole,defenderRole,now){
    const attackerId=attackerRole==='A'?this.activeIdA:this.activeIdB;
    const defenderId=type==='shot'?(defenderRole==='A'?this.gkIdA:this.gkIdB):(defenderRole==='A'?this.activeIdA:this.activeIdB);
    this.confrontation={type,attackerRole,defenderRole,attackerId,defenderId,deadline:now+CONFRONTATION_WINDOW_MS,attackerChoice:null,defenderChoice:null};
  }
  _aiChoice(stats,category){ return canActivate(stats,category)&&Math.random()<0.55?'technique':'normal'; }
  _tryTech(stats,category){
    if(!canActivate(stats,category)) return false;
    stats.sp-=stats.techniques[category].cost; return true;
  }
  _statsFor(role,id){ return (role==='A'?this.statsMapA:this.statsMapB).get(id); }

  _resolveConfrontation(now){
    const c=this.confrontation;
    const as=this._statsFor(c.attackerRole,c.attackerId);
    const ds=this._statsFor(c.defenderRole,c.defenderId);
    if(!as||!ds){this.confrontation=null;return;}
    const atk=c.type==='duel'?'dribble':'shot', def=c.type==='duel'?'defense':'keeper';
    const aUsed=c.attackerChoice==='technique'&&this._tryTech(as,atk);
    const dUsed=c.defenderChoice==='technique'&&this._tryTech(ds,def);
    const aPow=(aUsed?as.techniques[atk].power:NORMAL_ACTION_POWER)*as[STAT_FIELD_FOR_TECH[atk]];
    const dPow=(dUsed?ds.techniques[def].power:NORMAL_ACTION_POWER)*ds[STAT_FIELD_FOR_TECH[def]];
    const aWins=Math.random()<aPow/(aPow+dPow);

    let title, outcome, aTechName=aUsed?as.techniques[atk].name:'Normal action';
    let dTechName=dUsed?ds.techniques[def].name:'Normal action';

    if(c.type==='duel'){
      const eA=this._activeEntry(c.attackerRole), eD=this._activeEntry(c.defenderRole);
      if(aWins){ this._knockback(eD,eA); title=`${as.name} dribbles past!`; }
      else { this.possessorRole=c.defenderRole; this._knockback(eA,eD); title=`${ds.name} wins the ball!`; }
      outcome=`${as.name} used ${aTechName} · ${ds.name} used ${dTechName}`;
      this.duelLockUntil=now+1000;
    } else if(aWins){
      this._onGoal(c.attackerRole==='A'?'a':'b');
      title=`⚽ GOAL! ${as.name} scores!`;
      outcome=`${as.name} used ${aTechName} · ${ds.name} used ${dTechName}`;
    } else {
      this.possessorRole=c.defenderRole;
      title=`${ds.name} saves it!`;
      outcome=`${as.name} used ${aTechName} · ${ds.name} used ${dTechName}`;
    }

    this.confrontation=null;
    // Show result banner with a short delay for the outcome detail
    this.confrontationResult={title, outcome, until:now+RESULT_BANNER_MS, outcomeAt:now+RESULT_OUTCOME_DELAY};
  }

  _onGoal(scorer){
    this.score[scorer]+=1;
    document.querySelector('#scoreboard .score').textContent=`${this.score.a} - ${this.score.b}`;
    this.possessorRole=null;
    this.matter.body.setPosition(this.ball,{x:this.FIELD_W/2,y:this.FIELD_H/2});
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
    this._resetFormation();
  }
  _resetFormation(){
    const bp={x:this.FIELD_W/2,y:this.FIELD_H/2};
    this.teamA.forEach(e=>{ const p=this._formPos('A',e.slot,bp); this.matter.body.setPosition(e.body,p); this.matter.body.setVelocity(e.body,{x:0,y:0}); });
    this.teamB.forEach(e=>{ const p=this._formPos('B',e.slot,bp); this.matter.body.setPosition(e.body,p); this.matter.body.setVelocity(e.body,{x:0,y:0}); });
    this.myPaths.clear();
  }
  _regenSP(map,dt){ for(const s of map.values()) s.sp=Math.min(s.maxSP,s.sp+s.spRegenPerSec*(dt/1000)); }

  // ════════════════════════════════════════════════════════════════════
  // Clock
  // ════════════════════════════════════════════════════════════════════
  _tickClock(delta){
    if(this.matchClock.ended) return;
    this.matchClock.secondsRemaining-=delta/1000;
    if(this.matchClock.secondsRemaining<=0){
      if(this.matchClock.half===1){
        this.matchClock.half=2; this.matchClock.secondsRemaining=HALF_DURATION_S;
        this.possessorRole=null; this.confrontation=null;
        this.matter.body.setPosition(this.ball,{x:this.FIELD_W/2,y:this.FIELD_H/2});
        this.matter.body.setVelocity(this.ball,{x:0,y:0});
        this._resetFormation();
      } else { this.matchClock.ended=true; this.matchClock.secondsRemaining=0; }
    }
  }
  static _fmtClock(s){ s=Math.max(0,Math.ceil(s)); const m=Math.floor(s/60),r=s%60; return `${m}:${r<10?'0':''}${r}`; }
  _renderClock(c){ if(!c) return; document.getElementById('match-clock').textContent=c.ended?'Full time':`${c.half===1?'1st':'2nd'} half — ${GameScene._fmtClock(c.secondsRemaining)}`; }

  // ════════════════════════════════════════════════════════════════════
  // Main loop
  // ════════════════════════════════════════════════════════════════════
  update(time,delta){
    const amHost=this.role==='A';
    if(!amHost&&this.matchStarted&&!this.clientTeamsBuilt) this._buildClientTeams();

    const targets=this.matchStarted?this._computeMyTargets():[];
    const myInput={targets,shootRequest:this.pendingShootRequest,passTarget:this.pendingPassTarget,confrontationChoice:this.pendingConfrontationChoice,subRequest:this.pendingSubRequest,formationChange:this.pendingFormationChange};
    this.pendingShootRequest=false; this.pendingPassTarget=null; this.pendingConfrontationChoice=null; this.pendingSubRequest=null; this.pendingFormationChange=null;
    this.net.sendInput(myInput);

    if(amHost){
      if(this.matchStarted) this._updateHost(time,delta,myInput);
      else if(time-this.lastStateSent>1000/STATE_HZ){ this.lastStateSent=time; this.net.sendState({matchStarted:false}); }
    } else { this._updateClient(time); }

    if(this.matchStarted){ this._updateConfrontationUI(this.confrontation,time); this._drawPaths(); }
  }

  _updateHost(now,delta,myInput){
    const aiActive=!this.net.hasPeer();
    document.getElementById('ai-badge').style.display=aiActive?'block':'none';
    let inputB=this.remoteInput;
    if(aiActive){
      const eB=this._activeEntry('B');
      const ai=decideAIMove({selfPos:eB?eB.body.position:{x:this.FIELD_W/2,y:this.FIELD_H},ballPos:this.ball.position,axis:this._primaryAxis(),ownGoalValue:this._primarySize(),rivalGoalValue:0,fieldPrimarySize:this._primarySize()});
      inputB={targets:eB?[{id:eB.id,...ai.target}]:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,formationChange:null};
    }
    this._regenSP(this.statsMapA,delta); this._regenSP(this.statsMapB,delta);
    this.currentPossession=this.possessorRole;
    if(myInput.formationChange) this.formation.A=myInput.formationChange;
    if(!aiActive&&inputB.formationChange) this.formation.B=inputB.formationChange;
    if(!this.matchClock.ended) this._tickClock(delta);

    if(this.confrontation){
      this._progressConfrontation(now,myInput,inputB,aiActive);
    } else if(!this.matchClock.ended){
      this._updateActive('A'); this._updateActive('B');
      this._moveTeam('A',myInput.targets); this._moveTeam('B',inputB.targets);
      if(myInput.passTarget&&this.possessorRole==='A') this._doPass('A',myInput.passTarget);
      else if(!aiActive&&inputB.passTarget&&this.possessorRole==='B') this._doPass('B',inputB.passTarget);
      if(myInput.shootRequest&&this.possessorRole==='A') this._startConfrontation('shot','A','B',now);
      else if(!aiActive&&inputB.shootRequest&&this.possessorRole==='B') this._startConfrontation('shot','B','A',now);
      else if(aiActive&&this.possessorRole==='B'){
        const eB=this._activeEntry('B');
        if(eB&&eB.body.position[this._primaryAxis()]<160&&Math.random()<0.02) this._startConfrontation('shot','B','A',now);
      }
      if(this.confrontation&&this.confrontation.defenderRole==='B'&&aiActive){
        const ds=this._statsFor('B',this.confrontation.defenderId);
        this.confrontation.defenderChoice=this._aiChoice(ds,'keeper');
      }
      if(myInput.subRequest) this._trySub('A',myInput.subRequest);
      if(!aiActive&&inputB.subRequest) this._trySub('B',inputB.subRequest);
    }

    this._glueBall();
    this._syncGfx();
    this._renderClock(this.matchClock);
    this._renderResultBanner(this.confrontationResult,now);
    const as=this._statsFor('A',this.activeIdA);
    if(as) this._paintHUD(as.sp,as.maxSP);
    document.getElementById('sub-button').style.display=(this.benchA&&this.benchA.length)?'block':'none';

    if(now-this.lastStateSent>1000/STATE_HZ){
      this.lastStateSent=now;
      const as2=this._statsFor('A',this.activeIdA), bs=this._statsFor('B',this.activeIdB);
      this.net.sendState({
        matchStarted:true,
        ball:{x:this.ball.position.x,y:this.ball.position.y},
        teamA:this.teamA.map(e=>({x:e.body.position.x,y:e.body.position.y})),
        teamB:this.teamB.map(e=>({x:e.body.position.x,y:e.body.position.y})),
        activeIdA:this.activeIdA, activeIdB:this.activeIdB,
        score:this.score,
        sp:{a:as2?as2.sp:0,b:bs?bs.sp:0}, maxSp:{a:as2?as2.maxSP:100,b:bs?bs.maxSP:100},
        possession:this.possessorRole,
        confrontation:this.confrontation?{type:this.confrontation.type,attackerRole:this.confrontation.attackerRole,defenderRole:this.confrontation.defenderRole,attackerId:this.confrontation.attackerId,defenderId:this.confrontation.defenderId,deadline:this.confrontation.deadline}:null,
        confrontationResult:(this.confrontationResult&&now<this.confrontationResult.until)?this.confrontationResult:null,
        benchIds:{a:this.benchA,b:this.benchB},
        starterIds:{a:this.teamA.map(e=>e.id),b:this.teamB.map(e=>e.id)},
        clock:{half:this.matchClock.half,secondsRemaining:this.matchClock.secondsRemaining,ended:this.matchClock.ended}
      });
    }
  }

  _moveTeam(role,targets){
    const team=role==='A'?this.teamA:this.teamB;
    const byId=new Map(targets.map(t=>[t.id,t]));
    team.forEach(e=>{
      const st=this._statsFor(role,e.id), sp=st?st.speed:1;
      const t=byId.get(e.id);
      if(t) this._steer(e.body,t,sp,STEER_FORCE);
      else   this._steer(e.body,this._formPos(role,e.slot,this.ball.position),1,FORMATION_STEER_FORCE);
    });
  }

  _progressConfrontation(now,myInput,inputB,aiActive){
    const c=this.confrontation;
    if(myInput.confrontationChoice){
      if(c.attackerRole==='A'&&c.attackerChoice===null) c.attackerChoice=myInput.confrontationChoice;
      if(c.defenderRole==='A'&&c.defenderChoice===null) c.defenderChoice=myInput.confrontationChoice;
    }
    if(!aiActive&&inputB.confrontationChoice){
      if(c.attackerRole==='B'&&c.attackerChoice===null) c.attackerChoice=inputB.confrontationChoice;
      if(c.defenderRole==='B'&&c.defenderChoice===null) c.defenderChoice=inputB.confrontationChoice;
    }
    if(aiActive){
      const techFor=(r)=>c.type==='duel'?(r===c.attackerRole?'dribble':'defense'):(r===c.attackerRole?'shot':'keeper');
      if(c.attackerRole==='B'&&c.attackerChoice===null){const s=this._statsFor('B',c.attackerId);c.attackerChoice=s?this._aiChoice(s,techFor('B')):'normal';}
      if(c.defenderRole==='B'&&c.defenderChoice===null){const s=this._statsFor('B',c.defenderId);c.defenderChoice=s?this._aiChoice(s,techFor('B')):'normal';}
    }
    if((c.attackerChoice!==null&&c.defenderChoice!==null)||now>=c.deadline){
      if(!c.attackerChoice)c.attackerChoice='normal';
      if(!c.defenderChoice)c.defenderChoice='normal';
      this._resolveConfrontation(now);
    }
  }

  _handleIncomingState(data){
    this.remoteState=data;
    if(data.matchStarted&&!this.matchStarted){
      this.matchStarted=true;
      document.getElementById('squad-editor-panel').style.display='none';
    }
  }

  _updateClient(time){
    if(!this.remoteState||!this.remoteState.matchStarted||!this.clientTeamsBuilt) return;
    const lerp=0.3;
    this._syncClientIdentities(this.remoteState);
    this.ballGfx.x=Phaser.Math.Linear(this.ballGfx.x,this.remoteState.ball.x,lerp);
    this.ballGfx.y=Phaser.Math.Linear(this.ballGfx.y,this.remoteState.ball.y,lerp);
    this.teamA.forEach((e,i)=>{ const p=this.remoteState.teamA[i]; if(p){e.gfx.x=Phaser.Math.Linear(e.gfx.x,p.x,lerp);e.gfx.y=Phaser.Math.Linear(e.gfx.y,p.y,lerp);e.label.setPosition(e.gfx.x,e.gfx.y+13);} });
    this.teamB.forEach((e,i)=>{ const p=this.remoteState.teamB[i]; if(p){e.gfx.x=Phaser.Math.Linear(e.gfx.x,p.x,lerp);e.gfx.y=Phaser.Math.Linear(e.gfx.y,p.y,lerp);e.label.setPosition(e.gfx.x,e.gfx.y+13);} });
    this.activeIdA=this.remoteState.activeIdA; this.activeIdB=this.remoteState.activeIdB;
    this._highlightActive();
    document.querySelector('#scoreboard .score').textContent=`${this.remoteState.score.a} - ${this.remoteState.score.b}`;
    this._renderClock(this.remoteState.clock);
    this.currentPossession=this.remoteState.possession;
    this.confrontation=this.remoteState.confrontation;
    this._renderResultBanner(this.remoteState.confrontationResult,time);
    this._paintHUD(this.remoteState.sp.b,(this.remoteState.maxSp&&this.remoteState.maxSp.b)||100);
    this._updatePossessionRing();
    const benchB=(this.remoteState.benchIds&&this.remoteState.benchIds.b)||[];
    document.getElementById('sub-button').style.display=benchB.length?'block':'none';
  }

  _syncClientIdentities(rs){
    if(!rs.starterIds) return;
    ['A','B'].forEach(role=>{
      const team=role==='A'?this.teamA:this.teamB;
      const ids=role==='A'?rs.starterIds.a:rs.starterIds.b;
      const map=role==='A'?this.statsMapA:this.statsMapB;
      team.forEach((e,i)=>{ const nid=ids[i]; if(nid&&nid!==e.id){e.id=nid;if(!map.has(nid)){const rp=getPlayerById(nid);if(rp){const s=createPlayerStats();applyRosterPlayerToStats(s,rp);map.set(nid,s);}}}});
    });
    if(rs.benchIds){this.benchA=rs.benchIds.a||this.benchA;this.benchB=rs.benchIds.b||this.benchB;}
  }

  // ════════════════════════════════════════════════════════════════════
  // HUD
  // ════════════════════════════════════════════════════════════════════
  _paintHUD(sp,maxSp){ document.getElementById('sp-value').textContent=`${Math.round(sp)}/${Math.round(maxSp||100)}`; }

  _renderResultBanner(result,now){
    const el=document.getElementById('confrontation-result');
    if(result&&now<result.until){
      document.getElementById('result-title').textContent=result.title||'';
      const outEl=document.getElementById('result-outcome');
      if(result.outcomeAt&&now>=result.outcomeAt){ outEl.textContent=result.outcome||''; }
      else { outEl.textContent=''; }
      el.style.display='block';
    } else { el.style.display='none'; }
  }

  _updateConfrontationUI(confrontation,now){
    const panel=document.getElementById('confrontation-ui');
    if(!confrontation){panel.style.display='none';return;}
    const amA=confrontation.attackerRole===this.role, amD=confrontation.defenderRole===this.role;
    if(!amA&&!amD){panel.style.display='none';return;}
    panel.style.display='flex';
    const techId=confrontation.type==='duel'?(amA?'dribble':'defense'):(amA?'shot':'keeper');
    document.getElementById('confrontation-title').textContent=confrontation.type==='duel'
      ?(amA?'Duel! You\'re being tackled':'Duel! Go for the tackle')
      :(amA?'Shoot for goal!':'Save the shot!');
    document.getElementById('conf-normal').textContent=confrontation.type==='duel'
      ?(amA?'Normal dribble':'Normal tackle'):(amA?'Normal shot':'Normal save');
    const myChoice=amA?confrontation.attackerChoice:confrontation.defenderChoice;
    document.getElementById('conf-normal').classList.toggle('active',myChoice==='normal');
    document.getElementById('conf-technique').classList.toggle('active',myChoice==='technique');

    const relId=amA?confrontation.attackerId:confrontation.defenderId;
    const relRole=amA?confrontation.attackerRole:confrontation.defenderRole;
    const stats=this._statsFor(relRole,relId);
    const rp=relId?getPlayerById(relId):null;
    document.getElementById('confrontation-player-info').innerHTML=stats
      ?`<b>${rp?rp.name:stats.name}</b> — PT ${Math.round(stats.sp)}/${Math.round(stats.maxSP)}`:'';

    const techBtn=document.getElementById('conf-technique');
    const tech=stats?stats.techniques[techId]:null;
    if(tech){ techBtn.style.display='block'; techBtn.innerHTML=`${tech.name}<span class="cost">${tech.cost} PT</span>`; techBtn.disabled=!stats||!canActivate(stats,techId); }
    else { techBtn.style.display='none'; }
    const rem=Math.max(0,confrontation.deadline-now);
    document.getElementById('confrontation-timer-fill').style.width=`${(rem/CONFRONTATION_WINDOW_MS)*100}%`;
  }

  _syncGfx(){
    this.ballGfx.setPosition(this.ball.position.x,this.ball.position.y);
    this.teamA.forEach(e=>{e.gfx.setPosition(e.body.position.x,e.body.position.y);e.label.setPosition(e.body.position.x,e.body.position.y+13);});
    this.teamB.forEach(e=>{e.gfx.setPosition(e.body.position.x,e.body.position.y);e.label.setPosition(e.body.position.x,e.body.position.y+13);});
    this._highlightActive();
    this._updatePossessionRing();
  }
  _highlightActive(){
    this.teamA.forEach(e=>e.gfx.setStrokeStyle(e.id===this.activeIdA?2:0,0xffffff));
    this.teamB.forEach(e=>e.gfx.setStrokeStyle(e.id===this.activeIdB?2:0,0xffffff));
  }
  _updatePossessionRing(){
    if(this.currentPossession){const e=this._activeEntry(this.currentPossession);if(e){this.possessionRing.setPosition(e.gfx.x,e.gfx.y).setVisible(true);return;}}
    this.possessionRing.setVisible(false);
  }
}
