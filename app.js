import * as THREE from 'three';
import { createClient } from '@supabase/supabase-js';

const CONFIG = window.WORTH_CONFIG || {};
const supabase = CONFIG.supabaseUrl && CONFIG.supabasePublishableKey
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey)
  : null;

const MAPS = ['Neon Foundry','Skybridge','Dustpoint','Glacier Run','Orbit Yard'];
const FORMATS = [
  {id:'1v1',label:'1V1',size:2,teams:2},
  {id:'2v2',label:'2V2',size:4,teams:2},
  {id:'3v3',label:'3V3',size:6,teams:2},
  {id:'5v5',label:'5V5',size:10,teams:2},
  {id:'1v1v1',label:'1V1V1',size:3,teams:3,ffa:true}
];
const SHOP_ITEMS = [
  {id:'Pixel Spark',cost:250,color:'#9b82ff',desc:'A violet pixel trail for your player ring.'},
  {id:'Comet Wake',cost:400,color:'#ffce83',desc:'A warm comet-gold trail for your player ring.'}
];
const DEFAULT_KEYBINDS = {
  forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',
  jump:'Space',sprint:'ShiftLeft',roll:'ControlLeft',interact:'KeyE'
};
function loadKeybinds(){
  try{return {...DEFAULT_KEYBINDS,...JSON.parse(localStorage.getItem('worth-keybinds')||'{}')};}
  catch{return {...DEFAULT_KEYBINDS};}
}
function cleanNickname(value){
  const clean=String(value||'').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,16);
  return clean.length>=3?clean:'Rookie';
}
const GEAR = {
  movement: ['Sprint Soles','Air Wing','Gravity Boots'],
  utility: ['Bounce Core','Time Bubble','Signal Beacon'],
  support: ['Shield Halo','Echo Trail','Boost Ring'],
  style: ['Aurora Trail','Pixel Spark','Comet Wake']
};
const CONTRACTS = [
  {id:'checkpoints',icon:'✦',title:'Route Runner',desc:'Pass through 12 checkpoint rings in practice or online.',reward:180,goal:12},
  {id:'zone',icon:'◈',title:'Center Stage',desc:'Control a central zone for 45 seconds.',reward:240,goal:45},
  {id:'matches',icon:'🏁',title:'Ready to Compete',desc:'Finish one first-to-five match.',reward:320,goal:1}
];
const $ = id => document.getElementById(id);
const bootStartedAt=Date.now();
function setLoadingProgress(percent,label){const f=$('loading-fill'),s=$('loading-status');if(f)f.style.width=Math.max(0,Math.min(100,percent))+'%';if(s&&label)s.textContent=label;}
const state = {
  mode:'loadout', map:MAPS[0], matchFormat:'1v1', screen:'welcome', credits:0, nickname:'Rookie', inventory:['Aurora Trail'], keybinds:loadKeybinds(), paused:false, mapVote:null,
  session:null, user:null, loadout:{movement:GEAR.movement[0],utility:GEAR.utility[0],support:GEAR.support[0],style:GEAR.style[0]},
  upgrades:{moveSpeed:0,jump:0,stamina:0,recharge:0,zoneControl:0}, upgradePoints:0,
  contracts:Object.fromEntries(CONTRACTS.map(c=>[c.id,{progress:0,claimed:false}])),
  socket:null, queued:false, roomId:null, local:false, playerId:'guest', serverTimeScale:1,stamina:100,bootComplete:false,
  scoreA:0,scoreB:0, roundWinsA:0,roundWinsB:0, scoreTimer:0,
  checkpointCount:0, zoneSeconds:0, matchStart:0, completedMatches:0, nextCheckpoint:0
};
const keys = new Set();
let renderer,scene,camera,clock,player,playerModel,worldGroup,zoneGroup;
let yaw=0,pitch=.18,cameraDistance=5.2,sensitivity=1;
let velocity=new THREE.Vector3(), onGround=true, crouching=false, rolling=false, rollTime=0, rollDir=new THREE.Vector3(0,0,-1);
let sprinting=false,mobileSprintHeld=false,matchWakeController=null;
let aiming=false, landingPulse=0;
let nearest=null, interactables=[], checkpoints=[], remotes=new Map(), toastTimer=0;
let localZoneTimer=0, zoneMaterial, zoneRing, currentWorld='lobby';
const UP = new THREE.Vector3(0,1,0);

init();

function init(){
  setLoadingProgress(12,'INITIALIZING DISPLAY');
  try {
    renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.setSize(innerWidth,innerHeight);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.15;
    $('world').appendChild(renderer.domElement);
    setLoadingProgress(42,'BUILDING ARENA');
  } catch (err) {
    $('loading-screen').hidden=true;
    $('world').innerHTML='<div class="fatal">WORTH needs WebGL enabled in this browser.</div>';
    console.error(err); return;
  }
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0a1020);
  scene.fog=new THREE.FogExp2(0x0a1020,.022);
  camera=new THREE.PerspectiveCamera(74,innerWidth/innerHeight,.1,260);
  clock=new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0xaedaff,0x15152b,2.1));
  const keyLight=new THREE.DirectionalLight(0xffffff,2.3);
  keyLight.position.set(12,23,9);keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);
  scene.add(keyLight);
  const rim=new THREE.PointLight(0x45ddeb,90,42);rim.position.set(-12,8,-5);scene.add(rim);
  const violet=new THREE.PointLight(0x8866ff,75,38);violet.position.set(12,7,6);scene.add(violet);
  worldGroup=new THREE.Group();scene.add(worldGroup);
  zoneGroup=new THREE.Group();scene.add(zoneGroup);
  player=createPlayer(0x5ce5ed);
  player.position.set(0,0,2);
  scene.add(player);
  playerModel=player;
  buildWorld('lobby',state.map);
  setLoadingProgress(78,'PREPARING CONTROLS');
  bindUI();
  setLoadingProgress(91,'LOADING PLAYER PROFILE');
  loadSession();
  onResize();
  addEventListener('resize',onResize);
  renderer.domElement.addEventListener('click',()=>{if(canUseGameControls())lockMouse();});
  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
  renderer.domElement.addEventListener('mousedown',e=>{
    if(e.button!==2||!canUseGameControls())return;
    e.preventDefault();
    setAiming(true);
    if(!document.pointerLockElement)lockMouse();
  });
  document.addEventListener('mouseup',e=>{if(e.button===2)setAiming(false);});
  document.addEventListener('pointerlockchange',()=>{
    if(document.pointerLockElement===renderer.domElement)toast('MOUSE LOCKED · ESC FOR SETTINGS');
    else if(aiming)setAiming(false);
  });
  document.addEventListener('pointerlockerror',()=>toast('MOUSE LOCK FAILED · CLICK THE ARENA TO RETRY'));
  document.addEventListener('mousemove',e=>{
    if(document.pointerLockElement===renderer.domElement){
      yaw-=e.movementX*.0022*sensitivity;
      pitch=Math.max(-.72,Math.min(.72,pitch+e.movementY*.0018*sensitivity));
    }
  });
  document.addEventListener('keydown',onKeyDown);
  document.addEventListener('keyup',onKeyUp);
  renderer.setAnimationLoop(animate);
}

function lockMouse(){
  if(!renderer?.domElement||!canUseGameControls()||document.pointerLockElement===renderer.domElement)return;
  try{const req=renderer.domElement.requestPointerLock?.();req?.catch?.(()=>toast('CLICK THE ARENA TO CAPTURE THE MOUSE'));}
  catch{toast('CLICK THE ARENA TO CAPTURE THE MOUSE');}
}
function mat(color,rough=.65,metal=.1,emissive=null,intensity=0){
  return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal,emissive:emissive??0x000000,emissiveIntensity:intensity});
}
function box(parent,x,y,z,sx,sy,sz,material,cast=true){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),material);
  mesh.position.set(x,y,z);mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function addLabel(text,x,y,z,color='#c9fbff',scale=1){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,128);
  ctx.fillStyle='rgba(5,10,24,.82)';ctx.strokeStyle=color;ctx.lineWidth=4;
  ctx.beginPath();ctx.roundRect(8,8,496,112,16);ctx.fill();ctx.stroke();
  ctx.fillStyle=color;ctx.font='bold 44px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text.toUpperCase(),256,66);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));
  sprite.position.set(x,y,z);sprite.scale.set(4.3*scale,1.08*scale,1);worldGroup.add(sprite);return sprite;
}
function createPlayer(color=0x5ce5ed){
  const g=new THREE.Group();
  const bodyMat=mat(color,.42,.3,color,.22),dark=mat(0x18243c,.55,.25),visor=mat(0xc8fbff,.22,.5,0x54dfea,.55);
  const bodyPivot=new THREE.Group();bodyPivot.position.y=1.02;g.add(bodyPivot);
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.35,.68,5,10),bodyMat);
  body.castShadow=true;body.name='body';bodyPivot.add(body);

  const headPivot=new THREE.Group();headPivot.position.set(0,1.73,0);g.add(headPivot);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,20,16),dark);head.castShadow=true;headPivot.add(head);
  const face=new THREE.Mesh(new THREE.SphereGeometry(.19,18,12),visor);
  face.scale.set(1,.55,.42);face.position.set(0,.015,-.225);headPivot.add(face);

  // A compact focus camera is visibly strapped to the player's helmet.
  const headStrap=new THREE.Mesh(new THREE.TorusGeometry(.285,.027,8,36),mat(0x52647f,.45,.55));
  headStrap.rotation.x=Math.PI/2;headStrap.position.y=.055;headPivot.add(headStrap);
  const cameraMount=new THREE.Mesh(new THREE.BoxGeometry(.24,.13,.15),mat(0x101a30,.32,.55,0x2a92b3,.3));
  cameraMount.position.set(0,.07,-.255);headPivot.add(cameraMount);
  const cameraLens=new THREE.Mesh(new THREE.SphereGeometry(.067,16,12),mat(0x9cf8ff,.14,.65,0x39d9ef,1.6));
  cameraLens.scale.set(1,1,.45);cameraLens.position.set(0,.07,-.345);headPivot.add(cameraLens);
  const lensRing=new THREE.Mesh(new THREE.TorusGeometry(.078,.014,8,24),mat(0x6eeaf4,.28,.5,0x36d7ee,.8));
  lensRing.position.set(0,.07,-.342);headPivot.add(lensRing);
  for(const side of [-1,1]){
    const strapArm=new THREE.Mesh(new THREE.BoxGeometry(.045,.09,.22),mat(0x52647f,.48,.4));
    strapArm.position.set(side*.275,.045,-.04);headPivot.add(strapArm);
  }
  const cameraAnchor=new THREE.Object3D();cameraAnchor.position.set(0,.07,-.42);headPivot.add(cameraAnchor);

  const arms=[],legs=[];
  for(const side of [-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.42,1.43,0);g.add(arm);
    const upperArm=new THREE.Mesh(new THREE.CapsuleGeometry(.105,.47,4,9),dark);
    upperArm.position.y=-.29;upperArm.castShadow=true;arm.add(upperArm);
    const hand=new THREE.Mesh(new THREE.SphereGeometry(.105,12,10),mat(0x263550,.5,.28));
    hand.position.y=-.57;arm.add(hand);arms.push(arm);

    const leg=new THREE.Group();leg.position.set(side*.18,.62,0);g.add(leg);
    const lowerBody=new THREE.Mesh(new THREE.CapsuleGeometry(.135,.48,4,9),dark);
    lowerBody.position.y=-.31;lowerBody.castShadow=true;leg.add(lowerBody);
    const boot=new THREE.Mesh(new THREE.BoxGeometry(.25,.13,.36),mat(0x17243d,.42,.38,0x274c6b,.18));
    boot.position.set(0,-.59,-.045);leg.add(boot);legs.push(leg);
  }
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.42,.035,8,36),new THREE.MeshStandardMaterial({color:color,emissive:color,emissiveIntensity:.65}));
  ring.rotation.x=Math.PI/2;ring.position.y=.05;g.add(ring);
  // Center pivot makes the roll a forward somersault, not a sideways fall.
  const rollPivot=new THREE.Group();rollPivot.position.y=.85;
  for(const child of [...g.children]){g.remove(child);child.position.y-=.85;rollPivot.add(child);}
  g.add(rollPivot);
  g.userData={
    body,bodyPivot,head,headPivot,arms,legs,ring,cameraAnchor,rollPivot,baseColor:color,
    animTime:Math.random()*4,targetPosition:new THREE.Vector3(),targetYaw:0
  };
  return g;
}
function animateCharacter(model,dt,moving,isRolling,isCrouching,inAir,landPulse=0,isSprinting=false){
  const rig=model?.userData;if(!rig)return;
  rig.animTime=(rig.animTime||0)+dt*(isSprinting?12.2:moving?8.8:1.55);
  const phase=rig.animTime;
  const stride=moving?1:0;
  const crouch=isCrouching?1:0;
  const airborne=inAir?1:0;
  const roll=isRolling?1:0;
  const gait=Math.sin(phase);
  rig.legs.forEach((leg,index)=>{
    const side=index===0?-1:1;
    leg.rotation.x=gait*stride*.62*side+airborne*(index===0?-.22:.24)+roll*.2;
    leg.rotation.z=side*(crouch*.1+roll*.16);
  });
  rig.arms.forEach((arm,index)=>{
    const side=index===0?-1:1;
    arm.rotation.x=-gait*stride*.55*side-airborne*.72+roll*(index===0?-.55:.55);
    arm.rotation.z=side*(.12+crouch*.3+airborne*.1);
  });
  rig.bodyPivot.rotation.x=(moving ? .055 : 0)+airborne*.06+roll*-.06+crouch*.18+(isSprinting?-.08:0);
  rig.bodyPivot.position.y=.17+Math.sin(phase*2)*.025*(moving?1:.45)-landPulse*.12;
  rig.bodyPivot.scale.set(1,1-landPulse*.16,1);
  rig.headPivot.rotation.x=airborne*-.06+roll*.08;
  rig.headPivot.rotation.z=Math.sin(phase*.5)*.025;
  rig.ring.scale.setScalar(1+(moving ? .045 : 0)+(roll ? .12 : 0));
  if(rig.body.material)rig.body.material.emissiveIntensity=isRolling ? .65 : (moving ? .3 : .2);
}
function clearGroup(group){while(group.children.length){const o=group.children.pop();o.parent=null;}}
function buildWorld(kind='lobby',mapName=MAPS[0]){
  clearGroup(worldGroup);clearGroup(zoneGroup);interactables=[];checkpoints=[];
  currentWorld=kind;
  const floorMat=mat(kind==='lobby'?0x1b2741:0x202b45,.88,.18);
  const floor=box(worldGroup,0,-.4,0,58,.7,58,floorMat,false);floor.receiveShadow=true;
  const under=box(worldGroup,0,-.92,0,60,.4,60,mat(0x080d1b,.5,.4,0x172d4b,.35),false);
  const grid=new THREE.GridHelper(58,58,0x367b8a,0x283c5b);grid.position.y=-.035;worldGroup.add(grid);
  for(let i=0;i<22;i++){
    const a=(i/22)*Math.PI*2,r=22+(i%3)*1.3;
    const x=Math.cos(a)*r,z=Math.sin(a)*r,h=2.5+(i%6)*.75;
    const m=box(worldGroup,x,h/2,z,1.2,h,1.2,mat(i%2?0x22365b:0x26304f,.5,.25,0x376e8b,.12),false);
    m.rotation.y=(i%4)*.24;
    const strip=box(worldGroup,x,h*.72,z,1.22,.08,1.22,mat(0x64dce6,.3,.4,0x38b6db,.85),false);
  }
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2,r=14;
    const pillar=box(worldGroup,Math.cos(a)*r,1.6,Math.sin(a)*r,.3,3.2,.3,mat(0x273b60,.4,.35),false);
    const glow=box(worldGroup,Math.cos(a)*r,2.6,Math.sin(a)*r,.34,.09,.34,mat(0x6af3fa,.22,.2,0x4fe4f0,1),false);
  }
  if(kind==='lobby'){
    // Contract board.
    box(worldGroup,0,1.25,-8,7.5,2.6,.5,mat(0x182543,.35,.35),false);
    box(worldGroup,0,1.28,-7.72,6.9,2.08,.08,mat(0x0c1830,.3,.2,0x162e55,.5),false);
    box(worldGroup,0,2.42,-7.63,6.9,.06,.12,mat(0x54dce8,.2,.3,0x54dce8,1),false);
    addLabel('CONTRACT BOARD',0,3.35,-7.6,'#9df8ff',.86);
    const board=new THREE.Mesh(new THREE.BoxGeometry(7.3,2.4,.3),new THREE.MeshBasicMaterial({color:0x50d9e9,transparent:true,opacity:.035}));
    board.position.set(0,1.2,-7.55);worldGroup.add(board);
    interactables.push({type:'board',position:new THREE.Vector3(0,0,-5.7)});
    const pads=[
      {x:-10,z:5,label:'1V1',type:'queue',format:'1v1'},
      {x:-10,z:-2,label:'2V2',type:'queue',format:'2v2'},
      {x:-3,z:-12,label:'3V3',type:'queue',format:'3v3'},
      {x:8,z:-10,label:'5V5',type:'queue',format:'5v5'},
      {x:10,z:3,label:'1V1V1',type:'queue',format:'1v1v1'},
      {x:0,z:12,label:'PRACTICE',type:'practice'}
    ];
    pads.forEach((p,i)=>{
      const base=new THREE.Mesh(new THREE.CylinderGeometry(2.05,2.3,.4,40),mat(i%2?0x27395e:0x25365a,.35,.4));base.position.set(p.x,.02,p.z);base.castShadow=true;worldGroup.add(base);
      const glow=new THREE.Mesh(new THREE.TorusGeometry(1.68,.07,10,48),new THREE.MeshStandardMaterial({color:p.type==='practice'?0xffd782:0x62e6ef,emissive:p.type==='practice'?0xd08a34:0x3cc8e5,emissiveIntensity:1.25,metalness:.3,roughness:.25}));glow.rotation.x=Math.PI/2;glow.position.set(p.x,.26,p.z);worldGroup.add(glow);
      const center=new THREE.Mesh(new THREE.CircleGeometry(1.54,40),new THREE.MeshBasicMaterial({color:p.type==='practice'?0x9d7136:0x4b73cb,transparent:true,opacity:.22,side:THREE.DoubleSide}));center.rotation.x=-Math.PI/2;center.position.set(p.x,.245,p.z);worldGroup.add(center);
      addLabel(p.label,p.x,1.2,p.z,p.type==='practice'?'#ffdfa0':'#c4fbff',.55);
      interactables.push({type:p.type,label:p.label,format:p.format,position:new THREE.Vector3(p.x,0,p.z)});
    });
    addLabel('WORTH ATRIUM',0,2.1,0,'#ffffff',.7);
  }else{
    const names=mapName.split(' ');
    addLabel(mapName,0,2.3,-10,'#c6faff',.65);
    const arenaBase=new THREE.Mesh(new THREE.CylinderGeometry(16,16,1.2,64),mat(0x27375c,.6,.25));arenaBase.position.y=-.1;worldGroup.add(arenaBase);
    const outer=new THREE.Mesh(new THREE.TorusGeometry(16,.12,10,80),new THREE.MeshStandardMaterial({color:0x55dce8,emissive:0x32bed6,emissiveIntensity:.8}));outer.rotation.x=Math.PI/2;outer.position.y=.55;worldGroup.add(outer);
    const obstacleMat=mat(0x394b70,.55,.3,0x243b60,.15);
    for(let i=0;i<13;i++){
      const a=i*2.399,r=4+(i%4)*2.2;
      const h=1.1+(i%3)*.7;
      const obs=box(worldGroup,Math.cos(a)*r,h/2,Math.sin(a)*r,1.1,h,1.1,obstacleMat);
      obs.rotation.y=a;
    }
    // Floating paths and ramps make the map a 3D playground.
    for(let i=0;i<4;i++){
      const a=i*Math.PI/2;
      const bridge=box(worldGroup,Math.cos(a)*8,.65,Math.sin(a)*8,7,.3,2.15,mat(0x2b4269,.42,.24,0x294d75,.12));
      bridge.rotation.y=-a;
      for(let j=0;j<4;j++){
        const x=Math.cos(a)*(5+j*1.9),z=Math.sin(a)*(5+j*1.9);
        const mark=box(worldGroup,x,.84,z,.12,.04,.85,mat(0x67e4eb,.22,.2,0x56e5ed,.9),false);mark.rotation.y=a;
      }
    }
    const ring=new THREE.Mesh(new THREE.TorusGeometry(2.2,.18,14,56),new THREE.MeshStandardMaterial({color:0x6ef3ed,emissive:0x31d9d4,emissiveIntensity:1.2,metalness:.2,roughness:.2}));
    ring.rotation.x=Math.PI/2;ring.position.set(0,.65,0);zoneGroup.add(ring);zoneRing=ring;
    const disc=new THREE.Mesh(new THREE.CircleGeometry(2.1,48),new THREE.MeshBasicMaterial({color:0x48d5de,transparent:true,opacity:.2,side:THREE.DoubleSide}));disc.rotation.x=-Math.PI/2;disc.position.y=.53;zoneGroup.add(disc);
    for(let i=0;i<5;i++){
      const a=i/5*Math.PI*2+Math.PI/5;
      const cp=new THREE.Group();cp.position.set(Math.cos(a)*11,.5,Math.sin(a)*11);
      const torus=new THREE.Mesh(new THREE.TorusGeometry(.72,.07,10,32),new THREE.MeshStandardMaterial({color:0x9b87ff,emissive:0x7960ff,emissiveIntensity:1.1}));cp.add(torus);
      const spark=new THREE.Mesh(new THREE.SphereGeometry(.1,12,8),mat(0xc4faff,.25,.1,0xb2f8ff,1.2));spark.position.y=.8;cp.add(spark);
      worldGroup.add(cp);checkpoints.push(cp);
    }
    const variations={
      'Skybridge':0x4a85a2,'Dustpoint':0x9a7658,'Glacier Run':0x76aebe,'Orbit Yard':0x625aa5
    };
    if(variations[mapName])scene.fog.color.setHex(variations[mapName]);
  }
  if(player){player.position.set(0,0,kind==='lobby'?2:12);velocity.set(0,0,0);}
  for(const remote of remotes.values())scene.remove(remote);
  remotes.clear();
  $('world-name').textContent=kind==='lobby'?'THE ATRIUM':mapName.toUpperCase();
  $('world-sub').textContent=kind==='lobby'?'Explore the hub · Find a challenge':'Control the center · Tag the checkpoints · First to five';
}
function onResize(){if(!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
function onKeyDown(e){
  if(rebindAction){
    e.preventDefault();e.stopPropagation();
    if(e.code==='Escape'){rebindAction=null;renderKeybinds();return;}
    if(['Backspace','Tab','Enter'].includes(e.code)){toast('CHOOSE A DIFFERENT KEY');return;}
    state.keybinds[rebindAction]=e.code;rebindAction=null;keys.clear();
    try{localStorage.setItem('worth-keybinds',JSON.stringify(state.keybinds));}catch{}
    renderKeybinds();toast('KEYBIND SAVED');return;
  }
  if(e.code==='Escape'){
    e.preventDefault();e.stopPropagation();keys.clear();sprinting=false;mobileSprintHeld=false;setAiming(false);
    if(!$('map-vote-modal').hidden){toast('MAP VOTE IN PROGRESS');return;}
    const openModals=[...document.querySelectorAll('.modal-wrap:not([hidden])')];
    if(openModals.length){
      const activeModal=openModals[openModals.length-1];
      if(activeModal.id==='match-modal')cancelQueue();else closeModal(activeModal.id);
    }else if(!$('welcome-screen').hidden){return;}
    else if(state.paused)closePauseMenu();
    else openPauseMenu();
    return;
  }
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  keys.add(e.code);
  if(e.code===state.keybinds.interact)interact();
  if(e.code==='KeyU'&&state.screen==='online'){openModal('pad-modal');renderMatchSetup();}
  if(e.code===state.keybinds.jump){
    if(rolling){rolling=false;rollTime=0;toast('ROLL CANCELLED');}
    else if(onGround){velocity.y=8.1+state.upgrades.jump*.35;onGround=false;}
  }
  if(e.code===state.keybinds.roll){
    const moving=keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD');
    if(moving&&!rolling){rolling=true;crouching=false;rollTime=.78;rollDir.copy(moveDirection());if(rollDir.lengthSq()<.01)rollDir.set(0,0,-1);toast('ROLL BOOST');}
    else if(!moving)crouching=true;
  }
}
function onKeyUp(e){keys.delete(e.code);if(e.code===state.keybinds.roll)crouching=false;}
function moveDirection(){
  const forward=new THREE.Vector3(Math.sin(yaw),0,-Math.cos(yaw));
  const right=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
  const v=new THREE.Vector3();
  if(keys.has(state.keybinds.forward))v.add(forward);
  if(keys.has(state.keybinds.back))v.sub(forward);
  if(keys.has(state.keybinds.right))v.add(right);
  if(keys.has(state.keybinds.left))v.sub(right);
  return v.lengthSq()?v.normalize():v;
}
function updatePlayer(dt){
  if(!player||state.paused)return;
  const wasGrounded=onGround;
  const direction=moveDirection();
  if(rolling)direction.copy(rollDir);
  const moving=direction.lengthSq()>.01;
  if(rolling){
    rollTime=Math.max(0,rollTime-dt);
    const progress=1-rollTime/.78;
    player.userData.rollPivot.rotation.x=-THREE.MathUtils.clamp(progress,0,1)*Math.PI*2;
    if(rollTime<=0){rolling=false;player.userData.rollPivot.rotation.x=0;}
  }else player.userData.rollPivot.rotation.x=0;
  const wantsSprint=keys.has(state.keybinds.sprint)||mobileSprintHeld;
  sprinting=!!(wantsSprint&&moving&&!rolling&&!crouching&&state.stamina>0);
  state.stamina=THREE.MathUtils.clamp(state.stamina+(sprinting?-32:22)*dt,0,100);
  let speed=6.1+state.upgrades.moveSpeed*.35;
  if(sprinting)speed*=1.48;
  if(crouching)speed*=.55;
  if(rolling)speed*=1.65;
  if(state.loadout.movement==='Air Wing')speed*=1.035;
  const desired=direction.multiplyScalar(speed);
  const smoothing=1-Math.exp(-11*dt);
  velocity.x=THREE.MathUtils.lerp(velocity.x,desired.x,smoothing);
  velocity.z=THREE.MathUtils.lerp(velocity.z,desired.z,smoothing);
  if(rolling){velocity.x=THREE.MathUtils.lerp(velocity.x,rollDir.x*speed,.22);velocity.z=THREE.MathUtils.lerp(velocity.z,rollDir.z*speed,.22);}
  velocity.y-=22*dt;
  player.position.x+=velocity.x*dt;player.position.z+=velocity.z*dt;player.position.y+=velocity.y*dt;
  const limit=currentWorld==='lobby'?25:18;
  player.position.x=THREE.MathUtils.clamp(player.position.x,-limit,limit);
  player.position.z=THREE.MathUtils.clamp(player.position.z,-limit,limit);
  if(player.position.y<0){player.position.y=0;velocity.y=0;onGround=true;}
  if(!wasGrounded&&onGround&&velocity.y===0)landingPulse=.18;
  player.rotation.y=yaw;player.rotation.z=0;
  player.scale.y=THREE.MathUtils.lerp(player.scale.y,crouching ? .9 : 1,Math.min(1,dt*12));
  animateCharacter(player,dt,moving,rolling,crouching,!onGround,landingPulse,sprinting);
  $('stamina-hud').hidden=state.screen==='welcome';
  $('stamina-fill').style.width=state.stamina+'%';
  $('stamina-value').textContent=Math.round(state.stamina);
  document.body.classList.toggle('sprinting',sprinting);
  landingPulse=Math.max(0,landingPulse-dt);
}
function updateCamera(dt){
  if(!player)return;
  const target=player.position.clone().add(new THREE.Vector3(0,1.38,0));
  const forward=new THREE.Vector3(Math.sin(yaw),0,-Math.cos(yaw));
  const right=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw));
  if(aiming){
    // The viewpoint is placed just in front of the head-mounted camera lens.
    const lensPosition=player.userData.cameraAnchor.getWorldPosition(new THREE.Vector3());
    const sway=Math.sin((player.userData.animTime||0)*1.5)*.006;
    lensPosition.y+=sway;
    const cp=Math.cos(pitch),sp=Math.sin(pitch);
    const lookDirection=new THREE.Vector3(forward.x*cp,-sp,forward.z*cp);
    camera.position.copy(lensPosition);
    camera.lookAt(lensPosition.clone().add(lookDirection.multiplyScalar(12)));
  }else{
    const desired=target.clone()
      .add(forward.clone().multiplyScalar(-cameraDistance))
      .add(right.multiplyScalar(.55))
      .add(new THREE.Vector3(0,1.05+cameraDistance*Math.sin(pitch),0));
    camera.position.lerp(desired,1-Math.exp(-8.5*dt));
    camera.lookAt(target);
  }
  const targetFov=aiming?62:74;
  const nextFov=THREE.MathUtils.lerp(camera.fov,targetFov,1-Math.exp(-7*dt));
  if(Math.abs(camera.fov-nextFov)>.01){camera.fov=nextFov;camera.updateProjectionMatrix();}
}
function canUseGameControls(){
  return $('welcome-screen').hidden&&$('pause-menu').hidden&&!state.paused&&!document.querySelector('.modal-wrap:not([hidden])')&&$('result-banner').hidden;
}
function setAiming(value){
  const next=!!value;
  if(aiming===next)return;
  aiming=next;
  document.body.classList.toggle('aiming',aiming);
  $('aim-reticle').hidden=!aiming;
  $('aim-status').hidden=!aiming;
  if(state.socket?.readyState===WebSocket.OPEN&&state.roomId)sendInput();
}
function updateInteractable(){
  nearest=null;let best=4.2;
  for(const item of interactables){const d=player.position.distanceTo(item.position);if(d<best){best=d;nearest=item;}}
  const prompt=$('interact-prompt');
  if(nearest){prompt.hidden=false;$('interact-text').textContent=nearest.type==='board'?'OPEN CONTRACT BOARD':nearest.type==='practice'?'ENTER PRACTICE ARENA':'JOIN '+nearest.label+' QUEUE';}
  else prompt.hidden=true;
}
function interact(){
  if(state.screen==='welcome')return;
  if(nearest){
    if(nearest.type==='board')openModal('board-modal');
    if(nearest.type==='practice')localPractice();
    if(nearest.type==='queue'){state.matchFormat=nearest.format||'1v1';openModal('pad-modal');renderMatchSetup();}
    return;
  }
  if(currentWorld==='practice'&&player.position.distanceTo(new THREE.Vector3(0,0,0))<3)scoreLocalZone();
}
function scoreLocalZone(){
  state.scoreA++;$('score-a').textContent=state.scoreA;$('score-b').textContent=state.scoreB;
  toast('ZONE POINT +1');
  if(state.scoreA>=5){completeLocalRound();}
}
function completeLocalRound(){
  state.roundWinsA++;state.scoreA=0;state.scoreB=0;
  if(state.roundWinsA>=5){finishLocalMatch();return;}
  toast('ROUND '+state.roundWinsA+' WON · FIRST TO 5 ROUNDS');
  updateScoreHud();
}
function finishLocalMatch(){
  state.credits+=120;$('credits').textContent=state.credits;
  state.completedMatches++;state.upgradePoints+=3;
  grantContractProgress('matches',1);persistProgress();
  $('result-title').textContent='NICE RUN.';
  $('result-copy').textContent='Practice complete · +120 credits · +3 Addition points.';
  $('result-banner').hidden=false;
}
function updateScoreHud(){
  $('score-a').textContent=state.scoreA;$('score-b').textContent=state.scoreB;
  $('zone-progress').style.width=(state.scoreA/5*100)+'%';
  $('zone-note').textContent='Round wins '+state.roundWinsA+' — '+state.roundWinsB+' · first to five';
}
function localPractice(){
  state.paused=false;$('pause-menu').hidden=true;state.local=true;state.screen='practice';state.scoreA=0;state.scoreB=0;state.roundWinsA=0;state.roundWinsB=0;state.scoreTimer=0;state.nextCheckpoint=0;localZoneTimer=0;
  $('welcome-screen').hidden=true;$('pad-modal').hidden=true;$('match-modal').hidden=true;$('zone-hud').hidden=false;
  buildWorld('practice',state.map);lockMouse();
  toast('PRACTICE STARTED · SHIFT TO SPRINT · CTRL TO ROLL');
}
function enterLobby(){
  state.paused=false;$('pause-menu').hidden=true;state.screen='lobby';$('welcome-screen').hidden=true;$('world-hud').hidden=false;
  buildWorld('lobby',state.map);lockMouse();toast('WELCOME TO THE ATRIUM');
}
function openModal(id){keys.clear();crouching=false;sprinting=false;mobileSprintHeld=false;$(id).hidden=false;setAiming(false);document.exitPointerLock?.();}
function closeModal(id){$(id).hidden=true;}
function openPauseMenu(){
  state.paused=true;keys.clear();crouching=false;sprinting=false;mobileSprintHeld=false;setAiming(false);
  $('pause-menu').hidden=false;document.exitPointerLock?.();
  if(state.socket?.readyState===WebSocket.OPEN&&state.roomId)sendInput();
}
function closePauseMenu(){
  $('pause-menu').hidden=true;state.paused=false;keys.clear();
  if(state.screen!=='welcome')lockMouse();
}
function goMainMenu(){
  state.paused=false;$('pause-menu').hidden=true;$('welcome-screen').hidden=false;
  $('result-banner').hidden=true;$('zone-hud').hidden=true;$('stamina-hud').hidden=true;
  state.local=false;state.screen='welcome';setAiming(false);document.exitPointerLock?.();
  if(state.socket){try{state.socket.close();}catch{}state.socket=null;}
  state.roomId=null;buildWorld('lobby',state.map);
}
let rebindAction=null;
const KEY_LABELS={forward:'Move forward',back:'Move backward',left:'Move left',right:'Move right',jump:'Jump',sprint:'Sprint',roll:'Roll / crouch',interact:'Interact'};
function prettyKey(code){return String(code||'').replace('Key','').replace('Digit','').replace('ShiftLeft','Left Shift').replace('ShiftRight','Right Shift').replace('ControlLeft','Left Ctrl').replace('ControlRight','Right Ctrl');}
function renderKeybinds(){
  const host=$('keybind-list');if(!host)return;
  host.innerHTML=Object.entries(KEY_LABELS).map(([id,label])=>'<div class="keybind-row"><span>'+label+'</span><button data-bind="'+id+'" class="'+(rebindAction===id?'waiting':'')+'">'+(rebindAction===id?'PRESS A KEY':prettyKey(state.keybinds[id]))+'</button></div>').join('');
  host.querySelectorAll('[data-bind]').forEach(b=>b.addEventListener('click',()=>{rebindAction=b.dataset.bind;renderKeybinds();$('keybind-status').textContent='Press the new key for '+KEY_LABELS[rebindAction]+'.';}));
}
function openUsernameModal(){
  $('username-input').value=state.nickname;$('username-modal').hidden=false;document.exitPointerLock?.();
}
async function saveUsername(){
  const raw=$('username-input').value.trim(),name=raw.replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,16);
  if(name.length<3){toast('USERNAME MUST BE 3–16 CHARACTERS');return;}
  if(state.user&&supabase){
    const {error}=await supabase.from('profiles').upsert({id:state.user.id,username:name,updated_at:new Date().toISOString()},{onConflict:'id'});
    if(error){toast(error.code==='23505'?'THAT USERNAME IS ALREADY TAKEN':error.message);return;}
    const meta=await supabase.auth.updateUser({data:{nickname:name}});
    if(meta.error)console.warn('Username metadata update:',meta.error.message);
  }else{
    try{localStorage.setItem('worth-guest-name',name);}catch{}
  }
  state.nickname=name;
  if(state.user)persistProgress();
  if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify({type:'profileUpdate',nickname:name}));
  updateAccountUI();closeModal('username-modal');toast('USERNAME UPDATED');
}

function bindUI(){
  $('enter-lobby').addEventListener('click',enterLobby);
  $('quick-practice').addEventListener('click',()=>{state.map=MAPS[0];localPractice();});
  $('account-open').addEventListener('click',()=>openModal('account-modal'));
  $('settings-open').addEventListener('click',()=>openModal('settings-modal'));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
  $('board-modal').addEventListener('click',e=>{if(e.target===$('board-modal'))closeModal('board-modal');});
  $('pad-modal').addEventListener('click',e=>{if(e.target===$('pad-modal'))closeModal('pad-modal');});
  $('sign-in').addEventListener('click',()=>authenticate('signin'));
  $('sign-up').addEventListener('click',()=>authenticate('signup'));
  $('sign-out').addEventListener('click',async()=>{await supabase?.auth.signOut();state.session=null;state.user=null;state.nickname='Rookie';updateAccountUI();toast('SIGNED OUT');});
  $('find-match').addEventListener('click',queueMatch);
  $('cancel-queue').addEventListener('click',cancelQueue);
  $('practice-instead').addEventListener('click',localPractice);
  $('result-continue').addEventListener('click',()=>{$('result-banner').hidden=true;state.screen='lobby';buildWorld('lobby',state.map);$('zone-hud').hidden=true;});
  $('sensitivity').addEventListener('input',e=>sensitivity=Number(e.target.value));
  $('camera-distance').addEventListener('input',e=>cameraDistance=Number(e.target.value));
  $('hints-toggle').addEventListener('change',e=>$('bottom-hints').hidden=!e.target.checked);
  $('reduced-motion').addEventListener('change',e=>document.body.classList.toggle('reduced-motion',e.target.checked));
  $('mobile-jump').addEventListener('touchstart',e=>{e.preventDefault();if(onGround){velocity.y=8.1;onGround=false;}});
  $('mobile-roll').addEventListener('touchstart',e=>{e.preventDefault();if(moveDirection().lengthSq()>.01&&!rolling){rolling=true;rollTime=.78;rollDir.copy(moveDirection());}});
  $('mobile-sprint').addEventListener('touchstart',e=>{e.preventDefault();mobileSprintHeld=true;});
  $('mobile-sprint').addEventListener('touchend',()=>{mobileSprintHeld=false;});
  $('mobile-sprint').addEventListener('touchcancel',()=>{mobileSprintHeld=false;});
  $('mobile-interact').addEventListener('touchstart',e=>{e.preventDefault();interact();});
  const stick=$('move-stick');let touchId=null;
  stick.addEventListener('touchstart',e=>{e.preventDefault();touchId=e.changedTouches[0].identifier;});
  stick.addEventListener('touchmove',e=>{const t=[...e.changedTouches].find(x=>x.identifier===touchId);if(!t)return;const r=stick.getBoundingClientRect();const dx=(t.clientX-r.left-r.width/2)/(r.width/2),dy=(t.clientY-r.top-r.height/2)/(r.height/2);setTouchKeys(dx,dy);});
  stick.addEventListener('touchend',()=>{touchId=null;['KeyW','KeyA','KeyS','KeyD'].forEach(k=>keys.delete(k));});
  renderContractBoard();renderMatchSetup();updateAccountUI();
}
function setTouchKeys(dx,dy){
  ['KeyW','KeyA','KeyS','KeyD'].forEach(k=>keys.delete(k));
  if(dy<-.22)keys.add('KeyW');if(dy>.22)keys.add('KeyS');if(dx<-.22)keys.add('KeyA');if(dx>.22)keys.add('KeyD');
}
function renderContractBoard(){
  $('contract-list').innerHTML=CONTRACTS.map(c=>{
    const progress=state.contracts[c.id].progress,claimed=state.contracts[c.id].claimed;
    return '<article class="contract"><div class="contract-icon">'+c.icon+'</div><h3>'+c.title+'</h3><p>'+c.desc+'</p><strong>✦ '+c.reward+' CREDITS</strong><div class="contract-progress">'+Math.min(progress,c.goal)+' / '+c.goal+'</div><button data-contract="'+c.id+'" '+(claimed?'disabled':'')+'>'+(claimed?'COMPLETED':'CLAIM CONTRACT')+'</button></article>';
  }).join('');
  $('contract-list').querySelectorAll('[data-contract]').forEach(b=>b.addEventListener('click',()=>claimContract(b.dataset.contract)));
}
function claimContract(id){
  const c=CONTRACTS.find(x=>x.id===id),p=state.contracts[id];
  if(!c||p.claimed||p.progress<c.goal){toast('CONTRACT NOT COMPLETE YET');return;}
  p.claimed=true;state.credits+=c.reward;$('credits').textContent=state.credits;
  renderContractBoard();persistProgress();toast('CONTRACT CLAIMED · +'+c.reward+' CREDITS');
}
function grantContractProgress(id,amount){
  const p=state.contracts[id];if(!p||p.claimed)return;
  const c=CONTRACTS.find(x=>x.id===id);p.progress=Math.min(c.goal,p.progress+amount);renderContractBoard();
}
function renderMatchSetup(){
  $('map-list').innerHTML=MAPS.map((m,i)=>'<button class="map-choice '+(state.map===m?'active':'')+'" data-map="'+m+'"><span class="map-thumb" style="filter:hue-rotate('+(i*45)+'deg)"></span><span>'+m+'</span></button>').join('');
  $('map-list').querySelectorAll('[data-map]').forEach(b=>b.addEventListener('click',()=>{state.map=b.dataset.map;renderMatchSetup();}));
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===state.mode);b.onclick=()=>{state.mode=b.dataset.mode;renderMatchSetup();};});
  const panel=$('loadout-panel');
  if(state.mode==='loadout'){
    panel.innerHTML='<div class="loadout-card"><h3>MOVEMENT / SUPPORT GEAR</h3>'+Object.entries(GEAR).map(([slot,items])=>'<div class="gear-row"><span>'+slot.toUpperCase()+'</span><select data-gear="'+slot+'">'+items.map(item=>'<option '+(state.loadout[slot]===item?'selected':'')+'>'+item+'</option>').join('')+'</select></div>').join('')+'</div><p class="muted" style="margin-top:10px">This mode uses movement and support abilities. Your style trail is cosmetic.</p>';
    panel.querySelectorAll('[data-gear]').forEach(sel=>sel.addEventListener('change',()=>{state.loadout[sel.dataset.gear]=sel.value;sendProfileUpdate();}));
  }else{
    panel.innerHTML='<div class="loadout-card"><h3>ADDITION · '+state.upgradePoints+' POINTS</h3><p class="muted">After each match loss, earn three points to distribute.</p><div class="upgrade-grid">'+[
      ['moveSpeed','Movement speed','Run faster'],
      ['jump','Jump power','Reach higher paths'],
      ['stamina','Stamina','Maintain movement longer'],
      ['recharge','Ability recovery','Recover support abilities sooner'],
      ['zoneControl','Zone control','Build score in the zone faster']
    ].map(([id,label,desc])=>'<div class="upgrade-row"><span>'+label+'<small>'+desc+' · Level '+state.upgrades[id]+'</small></span><span class="stepper"><button data-upgrade="'+id+'" data-delta="-1">−</button><b>'+state.upgrades[id]+'</b><button data-upgrade="'+id+'" data-delta="1">+</button></span></div>').join('')+'</div></div>';
    panel.querySelectorAll('[data-upgrade]').forEach(b=>b.addEventListener('click',()=>{
      const id=b.dataset.upgrade,delta=Number(b.dataset.delta);
      if(delta>0&&state.upgradePoints<=0){toast('NO ADDITION POINTS AVAILABLE');return;}
      if(delta<0&&state.upgrades[id]<=0)return;
      state.upgrades[id]+=delta;state.upgradePoints-=delta;renderMatchSetup();sendProfileUpdate();
    }));
  }
}
async function loadSession(){
  if(!supabase){$('account-status').textContent='Supabase is not configured. Guest practice is available.';return;}
  const {data}=await supabase.auth.getSession();
  state.session=data.session;state.user=data.session?.user||null;
  if(state.user)await loadProgress();
  updateAccountUI();
  supabase.auth.onAuthStateChange(async(_event,session)=>{
    state.session=session;state.user=session?.user||null;
    if(state.user)await loadProgress();
    updateAccountUI();
  });
}
async function authenticate(kind){
  if(!supabase){toast('ACCOUNT SERVICE NOT CONFIGURED');return;}
  const email=$('auth-email').value.trim(),password=$('auth-password').value;
  if(!email||password.length<8){toast('ENTER EMAIL AND A PASSWORD OF AT LEAST 8 CHARACTERS');return;}
  const response=kind==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});
  if(response.error){toast(response.error.message);return;}
  state.session=response.data.session;state.user=response.data.user;
  if(kind==='signup'&&!state.session){$('account-status').textContent='Check your email for the confirmation link, then sign in.';toast('CHECK YOUR EMAIL TO CONFIRM');return;}
  if(state.user){await loadProgress();updateAccountUI();toast('ACCOUNT READY');}
}
function updateAccountUI(){
  const status=$('account-status');
  if(state.user){status.textContent='Signed in · '+(state.user.email||'WORTH player');$('sign-out').hidden=false;$('sign-in').hidden=true;$('sign-up').hidden=true;}
  else{status.textContent='Play locally as a guest or sign in to sync your progress.';$('sign-out').hidden=true;$('sign-in').hidden=false;$('sign-up').hidden=false;}
  $('connection-label').textContent=CONFIG.serverUrl?'SERVER READY':'LOCAL PRACTICE READY';
}
async function loadProgress(){
  if(!supabase||!state.user)return;
  const {data,error}=await supabase.from('worth_player_data').select('*').eq('user_id',state.user.id).maybeSingle();
  if(error){console.warn(error.message);return;}
  if(data){
    state.nickname=data.nickname||'Rookie';state.credits=data.credits||0;
    state.upgrades={...state.upgrades,...(data.upgrades||{})};state.loadout={...state.loadout,...(data.loadout||{})};
    if(data.contracts)state.contracts={...state.contracts,...data.contracts};
    state.roundWinsA=data.round_wins||0;state.upgradePoints=data.addition_points||0;
    $('credits').textContent=state.credits;renderContractBoard();renderMatchSetup();
  }else await persistProgress();
}
let saveChain=Promise.resolve();
function persistProgress(){
  if(!supabase||!state.user)return;
  const payload={user_id:state.user.id,nickname:state.nickname,credits:state.credits,round_wins:state.roundWinsA,addition_points:state.upgradePoints,upgrades:state.upgrades,loadout:state.loadout,contracts:state.contracts,updated_at:new Date().toISOString()};
  saveChain=saveChain.then(()=>supabase.from('worth_player_data').upsert(payload,{onConflict:'user_id'})).then(({error})=>{if(error)console.warn('Progress save:',error.message);}).catch(console.error);
}
function socketUrl(){
  const base=(CONFIG.serverUrl||'').trim().replace(/\/$/,'');
  if(!base)return '';
  return base.replace(/^http:/,'ws:').replace(/^https:/,'wss:')+'/ws';
}
async function queueMatch(){
  const base=(CONFIG.serverUrl||'').trim().replace(/\/+$/,'');
  const url=socketUrl();
  openModal('match-modal');$('queue-ring').hidden=false;$('cancel-queue').textContent='CANCEL';
  if(!url){
    state.queued=false;$('queue-ring').hidden=true;$('match-title').textContent='SERVER NOT CONNECTED';
    $('match-status').textContent='The multiplayer server is not linked yet. Deploy WORTH-Server on Render, then add its HTTPS URL to serverUrl in config.js.';
    return;
  }
  $('match-title').textContent='WAKING MATCH SERVER';$('match-status').textContent='Contacting the WORTH server…';
  state.queued=true;matchWakeController=new AbortController();
  const wakeTimeout=setTimeout(()=>matchWakeController?.abort(),90000);
  try{
    const response=await fetch(base+'/health',{method:'GET',cache:'no-store',signal:matchWakeController.signal});
    if(!response.ok)throw new Error('Health check returned HTTP '+response.status);
  }catch(err){
    if(!state.queued){clearTimeout(wakeTimeout);return;}
    state.queued=false;$('queue-ring').hidden=true;$('match-title').textContent='SERVER UNAVAILABLE';
    $('match-status').textContent=err?.name==='AbortError'?'The server did not wake within 90 seconds. Check its Render status and try again.':'Could not reach the server health check. Check the Render URL and CLIENT_ORIGIN settings.';
    clearTimeout(wakeTimeout);matchWakeController=null;return;
  }
  clearTimeout(wakeTimeout);matchWakeController=null;
  if(!state.queued)return;
  $('match-title').textContent='FINDING A MATCH';$('match-status').textContent='Server online · opening secure match connection…';
  const ws=new WebSocket(url);state.socket=ws;
  ws.addEventListener('open',async()=>{
    if(!state.queued||ws.readyState!==WebSocket.OPEN)return;
    let accessToken=null;
    try{const {data}=await supabase?.auth.getSession()||{data:{session:null}};accessToken=data.session?.access_token||null;}catch{}
    if(ws.readyState!==WebSocket.OPEN)return;
    ws.send(JSON.stringify({type:'hello',token:accessToken,nickname:state.nickname}));
    ws.send(JSON.stringify({type:'queue',map:state.map,mode:state.mode,loadout:state.loadout,upgrades:state.upgrades,additionPoints:state.upgradePoints}));
    $('match-status').textContent='Waiting for another player…';
  });
  ws.addEventListener('message',event=>{
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    handleServerMessage(msg);
  });
  ws.addEventListener('error',()=>{
    $('queue-ring').hidden=true;$('match-title').textContent='CONNECTION FAILED';
    $('match-status').textContent='The WebSocket could not connect. Check that Render is live and the client has the correct serverUrl.';
  });
  ws.addEventListener('close',()=>{
    if(state.socket===ws)state.socket=null;
    if(state.queued){state.queued=false;$('queue-ring').hidden=true;$('match-title').textContent='CONNECTION CLOSED';$('match-status').textContent='The server closed the matchmaking connection. Check Render logs for the cause.';}
  });
}
function cancelQueue(){
  state.queued=false;matchWakeController?.abort();matchWakeController=null;
  if(state.socket?.readyState===WebSocket.OPEN||state.socket?.readyState===WebSocket.CONNECTING)state.socket.close();
  state.socket=null;closeModal('match-modal');
}
function handleServerMessage(msg){
  if(msg.type==='queued'){$('match-status').textContent='Waiting for another player · '+(msg.map||state.map)+' · '+(msg.mode||state.mode);return;}
  if(msg.type==='matchFound'){
    state.roomId=msg.roomId;state.playerId=msg.playerId||state.playerId;state.local=false;state.serverTimeScale=1;state.stamina=100;state.queued=false;closeModal('match-modal');closeModal('pad-modal');
    $('zone-hud').hidden=false;state.screen='online';buildWorld('practice',msg.map||state.map);$('world-name').textContent=msg.map.toUpperCase();toast('MATCH FOUND · FIRST TO 5 ROUNDS');return;
  }
  if(msg.type==='snapshot'){
    state.serverTimeScale=Number(msg.timeScale)===0.38 ? 0.38 : 1;
    if(msg.map&&msg.map!==state.map){state.map=msg.map;buildWorld('practice',state.map);}
    const selfSnapshot=(msg.players||[]).find(p=>p.id===state.playerId);
    if(selfSnapshot&&Number.isFinite(selfSnapshot.stamina))state.stamina=selfSnapshot.stamina;
    updateRemotePlayers(msg.players||[]);
    if(msg.score){state.scoreA=msg.score.self||0;state.scoreB=msg.score.opponent||0;}
    if(msg.roundWins){state.roundWinsA=msg.roundWins.self||0;state.roundWinsB=msg.roundWins.opponent||0;}
    updateScoreHud();if(msg.zoneOwner)$('zone-note').textContent=msg.zoneOwner==='self'?'Your team controls the center':msg.zoneOwner==='opponent'?'Opponent controls the center':'Contested · Move into the center';
  }
  if(msg.type==='roundEnd'){toast((msg.winner==='self'?'ROUND WON':'ROUND LOST')+' · '+msg.selfWins+'–'+msg.opponentWins);if(msg.additionPoints!==undefined){state.upgradePoints=msg.additionPoints;renderMatchSetup();persistProgress();}}
  if(msg.type==='matchEnd'){
    state.completedMatches++;grantContractProgress('matches',1);persistProgress();
    $('result-title').textContent=msg.winner==='self'?'YOU WON.':'GOOD MATCH.';
    $('result-copy').textContent=msg.winner==='self'?'Match win · 350 credits awarded.':'Match complete · 100 credits awarded.';
    $('result-banner').hidden=false;state.roomId=null;state.serverTimeScale=1;$('zone-hud').hidden=true;state.screen='lobby';buildWorld('lobby',state.map);
  }
  if(msg.type==='creditsAwarded'){state.credits=Number(msg.totalCredits)||state.credits;$('credits').textContent=state.credits;persistProgress();}
  if(msg.type==='notice')toast(msg.message||'MATCH UPDATE');
  if(msg.type==='backToLobby'){state.screen='lobby';state.serverTimeScale=1;buildWorld('lobby',state.map);$('zone-hud').hidden=true;}
  if(msg.type==='error')toast(msg.message||'SERVER ERROR');
}
function updateRemotePlayers(players){
  const seen=new Set();
  for(const p of players){
    if(p.id===msgOwnId())continue;
    seen.add(p.id);
    let mesh=remotes.get(p.id);
    if(!mesh){mesh=createPlayer(0x9b86ff);mesh.userData.justCreated=true;scene.add(mesh);remotes.set(p.id,mesh);}
    mesh.userData.targetPosition.set(p.x||0,p.y||0,p.z||0);mesh.userData.targetYaw=p.yaw||0;
    if(!!p.rolling&&!mesh.userData.remoteRolling)mesh.userData.remoteRollStarted=performance.now();
    mesh.userData.remoteRolling=!!p.rolling;mesh.userData.remoteSprinting=!!p.sprinting;
    if(mesh.userData.justCreated){mesh.position.copy(mesh.userData.targetPosition);mesh.rotation.y=mesh.userData.targetYaw;mesh.userData.justCreated=false;}
  }
  for(const [id,mesh] of remotes){if(!seen.has(id)){scene.remove(mesh);remotes.delete(id);}}
}
function msgOwnId(){return state.playerId;}
function sendProfileUpdate(){
  if(state.socket?.readyState===WebSocket.OPEN&&state.roomId)state.socket.send(JSON.stringify({type:'profileUpdate',loadout:state.loadout,upgrades:state.upgrades,additionPoints:state.upgradePoints}));
  persistProgress();
}
function sendInput(){
  if(state.socket?.readyState!==WebSocket.OPEN||!state.roomId)return;
  state.socket.send(JSON.stringify({type:'input',keys:[...keys].filter(k=>['KeyW','KeyA','KeyS','KeyD','Space'].includes(k)),yaw,roll:rolling,rollX:rollDir.x,rollZ:rollDir.z,crouch:crouching,sprint:sprinting,aim:aiming}));
}
let sendAccumulator=0;
function animateRemotePlayers(realDt,simDt){
  for(const mesh of remotes.values()){
    const target=mesh.userData.targetPosition;
    const gap=mesh.position.distanceTo(target);
    mesh.position.lerp(target,1-Math.exp(-15*realDt));
    const angle=Math.atan2(
      Math.sin(mesh.userData.targetYaw-mesh.rotation.y),
      Math.cos(mesh.userData.targetYaw-mesh.rotation.y)
    );
    mesh.rotation.y+=angle*(1-Math.exp(-15*realDt));
    if(mesh.userData.remoteRolling){
      const progress=THREE.MathUtils.clamp((performance.now()-(mesh.userData.remoteRollStarted||performance.now()))/780,0,1);
      mesh.userData.rollPivot.rotation.x=-progress*Math.PI*2;
    }else mesh.userData.rollPivot.rotation.x=0;
    animateCharacter(mesh,simDt,gap>.025,mesh.userData.remoteRolling,false,false,0,mesh.userData.remoteSprinting);
  }
}
function animate(){
  const realDt=Math.min(clock.getDelta(),.04);
  const activeTimeScale=state.roomId?(aiming?.38:state.serverTimeScale):(aiming?.38:1);
  const simDt=realDt*activeTimeScale;
  updatePlayer(simDt);
  updateCamera(realDt);
  if(zoneRing)zoneRing.rotation.z+=simDt*.24;
  for(const cp of checkpoints){
    cp.userData.animTime=(cp.userData.animTime||0)+simDt;
    cp.rotation.y+=simDt*.5;
    cp.position.y=.55+Math.sin(cp.userData.animTime*2+cp.position.x)*.12;
  }
  animateRemotePlayers(realDt,simDt);
  updateInteractable();
  if(currentWorld==='practice'&&state.local){
    const inside=player.position.length()<2.45;
    if(inside){localZoneTimer+=simDt;grantContractProgress('zone',simDt);}
    else localZoneTimer=Math.max(0,localZoneTimer-simDt*.35);
    if(localZoneTimer>=5.5){localZoneTimer=0;scoreLocalZone();}
    const checkpoint=checkpoints[state.nextCheckpoint%Math.max(1,checkpoints.length)];
    if(checkpoint&&player.position.distanceTo(checkpoint.position)<1.25){state.nextCheckpoint++;grantContractProgress('checkpoints',1);toast('CHECKPOINT +1');}
  }
  if(state.socket?.readyState===WebSocket.OPEN){sendAccumulator+=realDt;if(sendAccumulator>.05){sendAccumulator=0;sendInput();}}
  renderer.render(scene,camera);
  if(!state.bootComplete){
    state.bootComplete=true;setLoadingProgress(100,'READY');
    const remaining=Math.max(0,420-(Date.now()-bootStartedAt));
    setTimeout(()=>{const loader=$('loading-screen');if(!loader)return;loader.classList.add('is-hidden');setTimeout(()=>{loader.hidden=true;},500);},remaining);
  }
}
function toast(message){
  const el=$('toast');el.textContent=message;el.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2300);
}
