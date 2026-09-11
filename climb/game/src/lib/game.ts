import {encounterArena} from './encounter-arenas.ts';
import type {DistrictArena} from './district-arenas.ts';
import { bossPlan } from './bosses.ts';
import { bonusDamage, equippedItem, potency, weaponType, weakenPercent, siphonCredits, enemyDamage, SLOTS, type Equipment } from './equipment.ts';
import { arenaFor, combatArena } from './district-arenas.ts';
import { BOARD_COLUMNS, BOARD_ROWS, BOARD_SIZE, CELLS, boardCells, hasTile, connected, neighbors, onBoard, route, terrainForChapter, terrainObstacles, type TerrainId } from './battlefield.ts';
import { CHAPTER_NODES, chapterFor, nodesForChapter, eventChoices, type ChapterId, type EnemyFaction } from './campaign.ts';
export type HeroId = 'glitchborn' | 'chainbreaker' | 'nodewalker' | 'coinbroker';
export type ItemId = 'daggers' | 'hook' | 'lantern' | 'sword' | 'armor' | 'phoenix' | 'capacitor' | 'repeater' | 'visor' | 'crown' | 'plate' | 'mantle';
export type Slot = 'weapon' | 'tool' | 'charm' | 'cranial' | 'chassis';
export type Gear = Record<'weapon'|'tool'|'charm',ItemId> & Partial<Record<'cranial'|'chassis',ItemId>>;
export type Mode = 'camp' | 'map' | 'event' | 'combat' | 'reward' | 'result';
export type Position = { x: number; y: number };
export type ActionMode = 'move' | 'attack' | 'skill';
export const HEROES = [
 {id:'glitchborn' as HeroId,name:'Nyx',lore:'Illegal and unregistered, Glitchborn are born without neural implants. Saboteurs and spies, they move beyond the Singularity’s sight.',title:'Glitchborn',role:'AMBUSH / SABOTAGE',hp:34,portrait:0,serial:'0042',trait:'Unregistered',passive:'The first attack in each encounter deals +3 damage. You are invisible to the ledger.',skill:'Ghost Step',skillText:'Blink beside a target within 3 tiles. Deal 10 damage.',skillRange:3,skillDamage:10,quote:'No implant. No record. No permission.'},
 {id:'chainbreaker' as HeroId,name:'Atlas',lore:'Genetically modified to survive the destruction of their neural implants, Chainbreakers wield the Underground’s weaponized analog augments.',title:'Chainbreaker',role:'ASSAULT / PROTECTION',hp:44,portrait:1,serial:'0108',trait:'Analog resolve',passive:'Start every encounter with 5 guard plus your level bonus.',skill:'Breach Pulse',skillText:'Deal 13 damage to an adjacent target. Gain 5 guard.',skillRange:1,skillDamage:13,quote:'They built these chains. We built the answer.'},
 {id:'nodewalker' as HeroId,name:'Echo',lore:'Nodewalkers hack early-generation implants to encrypt their minds, forge identities, and hijack Overcity mainframes.',title:'Nodewalker',role:'RANGE / DISRUPTION',hp:30,portrait:2,serial:'0017',trait:'Ghost network',passive:'Basic attacks reach 3 tiles. Hacked implants turn the city’s network against its owners.',skill:'Fork Bomb',skillText:'Deal 10 damage within 4 tiles and 4 to nearby enemies.',skillRange:4,skillDamage:10,quote:'Every locked system still has a door.'},
 {id:'coinbroker' as HeroId,name:'Vex',lore:'Coinbrokers finance the rebellion with forbidden tokens, untraceable assets, off-chain wealth, and the right bribe at the right moment.',title:'Coinbroker',role:'CONTROL / ECONOMY',hp:36,portrait:3,serial:'0088',trait:'Off-chain dividends',passive:'Earn 25% more credits from encounter rewards. Basic attacks reach 2 tiles.',skill:'Market Crash',skillText:'Deal 8 damage within 3 tiles. Jam the target: it skips its next attack and movement.',skillRange:3,skillDamage:8,quote:'A revolution needs more than belief. It needs liquidity.'},
];
export const ITEMS = [
 {id:'daggers' as ItemId,name:'Nullblades',slot:'weapon' as Slot,rarity:'RARE',art:0,serial:'0086',detail:'5 damage. Attacks apply 2 corruption for 2 turns.',effect:'Corruption on hit',lore:'No neural signature. Just a cut in the system.'},
 {id:'hook' as ItemId,name:'Magline',slot:'tool' as Slot,rarity:'RARE',art:1,serial:'0124',detail:'Move up to 3 tiles. Access elevated caches.',effect:'Vertical infiltration · +1 movement',lore:'The city was never built for the people beneath it.'},
 {id:'lantern' as ItemId,name:'Ghostkey',slot:'tool' as Slot,rarity:'RARE',art:2,serial:'0031',detail:'Bypass surveillance at exploration checkpoints and recover hidden credits.',effect:'Spoof cameras · hidden caches',lore:'Your face was never here.'},
 {id:'sword' as ItemId,name:'Railbreaker',slot:'weapon' as Slot,rarity:'EPIC',art:3,serial:'0059',detail:'7 damage. An analog weapon that hits beyond the network.',effect:'+2 basic attack damage',lore:'Copper coils. Blue fire. A very old idea about freedom.'},
 {id:'armor' as ItemId,name:'Kinetic Aegis',slot:'charm' as Slot,rarity:'RARE',art:4,serial:'0216',detail:'Gain 3 guard before enemies act each turn.',effect:'+3 guard each enemy turn',lore:'No subscription required to stay alive.'},
 {id:'phoenix' as ItemId,name:'Dead-Man Core',slot:'charm' as Slot,rarity:'EPIC',art:5,serial:'0009',detail:'Once per operation, survive a fatal hit with 14 health.',effect:'Emergency medical restart',lore:'The last order is always: bring them home.'},
];
ITEMS.push(
 {id:'capacitor',name:'Arc Caster',slot:'weapon',rarity:'Salvage',art:3,serial:'0310',detail:'6 base damage. Enertech suppresses the next enemy attack.',effect:'Enertech suppression',lore:'Steal the current. Break the command.'},
 {id:'repeater',name:'Dividend Repeater',slot:'weapon',rarity:'Salvage',art:0,serial:'0311',detail:'6 base damage. Siphon returns credits on every direct hit.',effect:'Siphon credits on hit',lore:'Every round is an off-chain withdrawal.'},
 {id:'visor',name:'Deadeye Visor',slot:'cranial',rarity:'Salvage',art:6,serial:'0312',detail:'+2 signature damage, plus quality and rarity bonuses.',effect:'Precision signature amplifier',lore:'See the weak point behind the propaganda.'},
 {id:'crown',name:'Signal Crown',slot:'cranial',rarity:'Salvage',art:7,serial:'0313',detail:'Signature cooldown reduced by 1 turn (minimum 1).',effect:'Faster signature recovery',lore:'A crown with no sovereign.'},
 {id:'plate',name:'Copper Bastion',slot:'chassis',rarity:'Salvage',art:8,serial:'0314',detail:'+8 maximum health, plus quality and rarity bonuses.',effect:'Reinforced health reserve',lore:'Built in the Foundry. Paid for in defiance.'},
 {id:'mantle',name:'Broker’s Mantle',slot:'chassis',rarity:'Salvage',art:9,serial:'0315',detail:'+2 guard each enemy turn, plus quality and rarity health bonuses.',effect:'Reactive armor weave',lore:'Insure the one asset the rebellion cannot replace.'}
);
ITEMS.forEach(i=>i.rarity='Salvage');
export const NODES = CHAPTER_NODES[1];
export const EDGES = [['threshold','bridge'],['threshold','garden'],['bridge','archive'],['bridge','cistern'],['garden','archive'],['garden','cistern'],['archive','guardian'],['cistern','guardian'],['guardian','heart']];
export type Enemy = Position & { id: number; name: string; hp: number; maxHp: number; damage: number; type: 'husk' | 'watcher' | 'boss'; poison: number; armor?:number; phase?:number; intentDamage?:number; intent: Position[]; advancing: boolean; faction?:EnemyFaction; portrait?:number; role?:'drone'|'sniper'|'nullifier'|'enforcer'; jammed?:number; slow?:number; weaken?:number; ability?:string; lastColumn?:number };
export type Combat = { arena?:DistrictArena; encounter?:string;  bossRules?:boolean; lingering?:Position[];  layout?:ChapterId; terrain?:TerrainId; travel?:{enemyId:number;path:Position[]}[]; chapter?:ChapterId; hazards?:Position[]; hazardDamage?:number; hero: Position; enemies: Enemy[]; ap: number; round: number; block: number; cooldown: number; firstStrike: boolean; obstacles: Position[]; last: string; lockout?:number };
export type DamageRoll = {target:'hero'|'enemy';enemyId:number;damage:number;critical:boolean};
export const CRITICAL_CHANCE=.02;
export type Run = {lastHits?:DamageRoll[];climbId?:string;climbActive?:boolean;boosts?:Partial<Record<Slot,number>>;upgradeOffer?:{slot:Slot;cost:number;resolved:boolean;purchased:boolean};  id:string; chapter:ChapterId; level:number; ranks:Record<ItemId,number>; completedDepth:number; bonusPower:number; mode: Mode; heroId: HeroId; gear: Gear; loadout?:Partial<Record<Slot,Equipment>>; minted?:Equipment; mintResolved?:boolean; hp: number; maxHp: number; supplies: number; salvage: number; depth: number; nodeId: string; visited: string[]; combat: Combat | null; log: string[]; rewardTitle: string; rewardText: string; victory: boolean; outcome: string; phoenixUsed: boolean; turns: number; relic: boolean; danger: number };
export const heroFor = (r: Run) => HEROES.find(h => h.id === r.heroId)!;
export const itemFor = (id: ItemId) => ITEMS.find(i => i.id === id)!;
export const nodeFor = (id: string, chapter:ChapterId=1) => nodesForChapter(chapter).find(n => n.id === id)!;
export const ranksZero=():Record<ItemId,number>=>({daggers:0,sword:0,hook:0,lantern:0,armor:0,phoenix:0,capacitor:0,repeater:0,visor:0,crown:0,plate:0,mantle:0});
export const climbBoost=(r:Run,slot:Slot)=>r.boosts?.[slot]??0;
export const upgradeBenefit=(slot:Slot)=>({weapon:'+2 weapon and signature damage',tool:'+3 starting guard each encounter',charm:'+2 guard when bracing',cranial:'+2 signature damage',chassis:'+4 maximum health and restore 4 health'})[slot];
export function clearClimb(r:Run){r.maxHp-=climbBoost(r,'chassis')*4;r.hp=Math.min(r.hp,r.maxHp);r.boosts={};r.bonusPower=0;r.climbActive=false;}
export const weaponDamage=(r:Run)=>(r.gear.weapon==='sword'?7:['capacitor','repeater'].includes(r.gear.weapon)?6:5)+(r.level-1)+r.ranks[r.gear.weapon]*2+r.bonusPower+bonusDamage(r)+climbBoost(r,'weapon')*2;
export const skillDamage=(r:Run)=>heroFor(r).skillDamage+(r.level-1)*2+r.ranks[r.gear.weapon]*2+r.bonusPower+bonusDamage(r)+(r.gear.cranial==='visor'?2+(r.ranks.visor??0):r.gear.cranial==='crown'?(r.ranks.crown??0):0)+potency(equippedItem(r,'cranial'))+climbBoost(r,'weapon')*2+climbBoost(r,'cranial')*2;
export const moveRange=(r:Run)=>r.gear.tool==='hook'?3+Math.ceil(r.ranks.hook/2):2;
export const healAmount=(r:Run)=>12+(r.level-1)*3;
export const guardAmount=(r:Run)=>7+(r.level-1)+potency(equippedItem(r,'charm'))+climbBoost(r,'charm')*2;
export const poisonDamage=(r:Run)=>2+r.ranks.daggers;
export const armorGuard=(r:Run)=>3+r.ranks.armor*2;
export const reviveAmount=(r:Run)=>14+r.ranks.phoenix*8;
export const enemyPortrait=(_r:Run,e:Enemy)=>e.portrait??(e.faction==='Overlords'?4:e.faction==='Neuralifes'?6:5);
export const basicRange=(r:Run)=>r.heroId==='nodewalker'?3:r.heroId==='coinbroker'?2:1;
export const distance = (a: Position, b: Position) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export const same = (a: Position,b: Position) => a.x===b.x&&a.y===b.y;
export const inBoard = onBoard;
export function createRun(heroId: HeroId = 'glitchborn', gear: Gear = { weapon:'daggers', tool:'hook', charm:'phoenix' }, chapter:ChapterId=1, level=1, ranks:Record<ItemId,number>=ranksZero()): Run {
  const hero=HEROES.find(h=>h.id===heroId)!;
  const maxHp=hero.hp+(level-1)*5;
  return { id:crypto.randomUUID(),chapter,level,ranks:{...ranks},completedDepth:0,bonusPower:0,mode:'camp',heroId,gear:{...gear},hp:maxHp,maxHp,supplies:2,salvage:0,depth:0,nodeId:'threshold',visited:['threshold'],combat:null,log:[chapterFor(chapter).intro],rewardTitle:'',rewardText:'',victory:false,outcome:'',phoenixUsed:false,turns:0,relic:false,danger:0 };
}
export function append(r: Run, message: string) { r.log = [...r.log.slice(-24),message]; }
export function availableNodes(r: Run) { return nodesForChapter(r.chapter).filter(n=>n.depth===r.depth+1&&(n.id!=='archive'||r.gear.tool==='hook')); }
export function reachable(c: Combat, from: Position, to: Position, max: number) { return route(c,from,to,max).length>0; }
export function blinkLanding(c:Combat,target:Position):Position|undefined {
 return neighbors(target).filter(p=>connected(c,target,p)&&!c.obstacles.some(o=>same(o,p))&&!c.enemies.some(e=>e.hp>0&&same(e,p))).sort((a,b)=>distance(a,c.hero)-distance(b,c.hero))[0];
}
export function canAttack(r:Run,enemy:Enemy,skill=false):boolean {
 const c=r.combat;if(!c||c.ap<(skill?2:1)||enemy.hp<=0||(skill&&(c.cooldown>0||(c.lockout??0)>0)))return false;
 const range=skill?heroFor(r).skillRange:basicRange(r);
 if(distance(c.hero,enemy)>range)return false;
 if(skill&&r.heroId==='glitchborn')return !!blinkLanding(c,enemy);
 return range!==1||connected(c,c.hero,enemy);
}
export function planEnemies(c: Combat) {
 const chapter=c.chapter??1,ch=chapterFor(chapter);
 c.enemies=c.enemies.filter(e=>e.hp>0).map(e=>{
  let intent:Position[]=[],advancing=false;
  let phase=e.type==='boss'&&e.hp<=e.maxHp/2?2:1;
  let extra=0;
  if(e.type==='boss'&&c.bossRules){const plan=bossPlan(c,e);intent=plan.intent;phase=plan.phase;e.ability=plan.ability;extra=plan.extra;}else if(e.type==='boss'){
   const row=(y:number)=>Array.from({length:BOARD_COLUMNS},(_,x)=>({x,y})),col=(x:number)=>Array.from({length:BOARD_ROWS},(_,y)=>({x,y}));
   if(ch.bossPattern==='columns')intent=[...col(c.hero.x),...(phase===2?col((c.hero.x+Math.floor(BOARD_COLUMNS/2))%BOARD_COLUMNS):[])];
   else if(ch.bossPattern==='rows')intent=[...row(c.hero.y),...(phase===2?row((c.hero.y+Math.floor(BOARD_ROWS/2))%BOARD_ROWS):[])];
   else if(ch.bossPattern==='ring')intent=CELLS.filter(p=>distance(p,c.hero)<=(phase===2?2:1));
   else intent=[...row(c.hero.y),...(c.round%2===0||phase===2?col(c.hero.x):[])];
  }else if(e.role==='drone'){
   intent=[{...c.hero},{x:c.hero.x+(c.round%2?1:-1),y:c.hero.y}].filter(inBoard);
  }else if(e.type==='watcher'){
   const row=c.layout?c.hero.y:(c.hero.y+e.id-2+BOARD_ROWS)%BOARD_ROWS,col=c.layout?c.hero.x:(c.hero.x+e.id-2+BOARD_COLUMNS)%BOARD_COLUMNS;
   intent=(c.round+e.id)%2===0?Array.from({length:BOARD_COLUMNS},(_,x)=>({x,y:row})):Array.from({length:BOARD_ROWS},(_,y)=>({x:col,y}));
  }else if((route(c,e,c.hero,2,'enemy').length||99)<=3){intent=[{...c.hero}];if(chapter>=6)intent.push(...[{x:c.hero.x+1,y:c.hero.y},{x:c.hero.x-1,y:c.hero.y}].filter(inBoard));}
  else advancing=true;
  intent=intent.filter(p=>hasTile(c,p)&&!c.obstacles.some(o=>same(o,p)));
  return {...e,intent,advancing,phase,intentDamage:e.damage+(phase>=2?3+Math.floor(chapter/3):0)+extra};
 });
 c.hazardDamage=chapter===1?0:3+Math.floor(chapter*.75);c.hazards=[];
 if(chapter>=2&&chapter<=3)c.hazards=Array.from({length:BOARD_ROWS},(_,y)=>({x:[2,5,8,1,4,7,0,3,6][(c.round-1)%BOARD_COLUMNS],y}));
 else if(chapter>=4)c.hazards=CELLS.filter(p=>(p.x+p.y*2+c.round)% (chapter>=7?5:6)===0);
 c.hazards=[...c.hazards,...(c.lingering??[])];
 c.hazards=c.hazards.filter(p=>hasTile(c,p)&&!c.obstacles.some(o=>same(o,p)));
}
function enterCombat(r:Run,boss:boolean){
 const ch=r.chapter,elite=nodeFor(r.nodeId,ch).kind==='elite',ranged=r.nodeId==='garden',hp=17+ch*4,damage=6+ch;
 const profiles:{name:string;type:Enemy['type'];role:Enemy['role'];faction:EnemyFaction}[]=[
  {name:'Implant Militia',type:'husk',role:'enforcer',faction:'Neuralifes'},
  {name:'Audit Drone',type:'watcher',role:'drone',faction:'The Singularity'},
  {name:'Debt Enforcer',type:'husk',role:'enforcer',faction:'Overlords'},
  {name:'Devotion Gunner',type:'watcher',role:'sniper',faction:'Neuralifes'},
  {name:'Neural Nullifier',type:'watcher',role:'nullifier',faction:'The Singularity'},
  {name:'Ledger Executioner',type:'watcher',role:'sniper',faction:'The Singularity'},
  {name:'Gilded Praetorian',type:'husk',role:'enforcer',faction:'Overlords'},
  {name:'Correction Surgeon',type:'watcher',role:'nullifier',faction:'The Singularity'},
 ];
 const count=(elite||boss||ch>=6)?4:3;
 const enemies:Enemy[]=Array.from({length:count},(_,i)=>{
  const profileIndex=(ch-1+i*2+(ranged?1:0)+(elite?2:0))%profiles.length,base=profiles[profileIndex];
  const isBoss=boss&&i===0,commander=elite&&i===0;
  const health=isBoss?54+ch*12:hp+(commander?10:0)-(i?3:0);
  return {...base,id:i+1,x:[4,7,5,7][i],y:[1,3,2,1][i],name:isBoss?chapterFor(ch).boss:commander?`Elite ${base.name}`:base.name,type:isBoss?'boss':base.type,faction:isBoss?chapterFor(ch).faction:base.faction,portrait:isBoss?undefined:7+profileIndex,hp:health+r.danger*3,maxHp:health+r.danger*3,damage:damage+(isBoss?5:commander?3:base.role==='sniper'?2:0),armor:ch===1?1:Math.floor(ch/3)+(commander||base.role==='enforcer'?1:0),poison:0,jammed:0,intent:[],advancing:false};
 });
 const guard=climbBoost(r,'tool')*3+potency(equippedItem(r,'tool'))+(r.heroId==='chainbreaker'?5+r.level-1:0)+(r.gear.tool==='hook'?r.ranks.hook*2:r.ranks.lantern*3);
 const obstacles=ch>=6?[{x:2,y:0},{x:2,y:2},{x:4,y:2}]:boss?[{x:2,y:1},{x:3,y:3}]:[{x:2,y:0},{x:3,y:3}];
 const {terrain,arena}=encounterArena(ch,r.nodeId), floor=boardCells({layout:ch,arena}), occupied:Position[]=[{x:0,y:2}];
 for(const enemy of enemies){const candidates=floor.filter(p=>!occupied.some(o=>same(o,p))&&!arena.props.some(o=>same(o,p))).sort((a,b)=>distance(a,enemy)-distance(b,enemy));const spot=candidates[0];enemy.x=spot.x;enemy.y=spot.y;occupied.push(spot);}
 const props=arena.solid?arena.props:[];
 const scenery=terrainObstacles(terrain,[...props,...obstacles,{x:6,y:3},{x:7,y:1}],ch,[...occupied,...(!arena.solid?arena.props:[])],arena);
 if(arena.solid){arena.props=arena.props.filter(p=>scenery.some(q=>same(p,q)));if(!arena.props.length&&scenery.length)arena.props=[scenery[0]];}

 r.upgradeOffer=undefined;r.mintResolved=undefined;r.minted=undefined;
 r.combat={arena,encounter:r.nodeId,bossRules:boss,layout:ch,terrain,chapter:ch,hero:{x:0,y:2},enemies,ap:3,round:1,block:guard,cooldown:0,firstStrike:true,obstacles:scenery,last:'Security is closing in. Read the red attack tiles before spending your actions.',lockout:0};
 planEnemies(r.combat);r.mode='combat';append(r,boss?`${chapterFor(ch).boss} activates the district lockdown.`:elite?'An elite security formation blocks the checkpoint.':chapterFor(ch).mechanic);
}
function hurt(r:Run,amount:number){
  r.hp=Math.max(0,r.hp-amount);
  if(r.hp<=0&&r.gear.charm==='phoenix'&&!r.phoenixUsed){r.hp=Math.min(r.maxHp,reviveAmount(r));r.phoenixUsed=true;append(r,`Dead-Man Core triggers. You return with ${r.hp} health.`);}
  else if(r.hp<=0){clearClimb(r);r.mode='result';r.outcome='Operation compromised';r.victory=false;append(r,'Your rebel returns to the safehouse. Unsecured credits are lost.');}
}
function reward(r:Run,title:string,text:string,amount:number){const credits=r.heroId==='coinbroker'?Math.floor(amount*1.25):amount;r.completedDepth=r.depth;r.salvage+=credits;r.mode='reward';r.rewardTitle=title;r.rewardText=text;append(r,`${title} · +${credits} credits${r.heroId==='coinbroker'&&amount?' (Off-chain dividends)':''}`);}
function combatWon(r:Run){const n=nodeFor(r.nodeId,r.chapter);r.combat=null;if(n.kind==='boss'){r.relic=true;r.mintResolved=true;if(r.chapter<9){const slots=SLOTS.filter(s=>r.gear[s]);r.upgradeOffer={slot:slots[Math.floor(Math.random()*slots.length)],cost:60+r.chapter*20,resolved:false,purchased:false};}reward(r,`${chapterFor(r.chapter).name}: network severed`,chapterFor(r.chapter).ending,n.reward);}else{if(n.kind==='elite')r.bonusPower++;reward(r,n.kind==='elite'?'Elite checkpoint broken':'Patrol neutralized',n.kind==='elite'?'Captured equipment grants +1 damage for the rest of this operation.':'The patrol is disabled. Recover its off-chain credits and an intact medical supply.',n.reward);r.supplies++;}}
export type GameAction = {type:'upgradeGear'}|{type:'skipUpgrade'}|{type:'begin'}|{type:'visit';id:string}|{type:'event';choice:string}|{type:'continue'}|{type:'extract'}|{type:'move';position:Position}|{type:'attack';id:number;skill?:boolean}|{type:'guard'}|{type:'end'}|{type:'heal'};
export function transition(original:Run,action:GameAction,random:()=>number=Math.random):Run{
  const r=structuredClone(original);const c=r.combat;r.lastHits=[];
  const hit=(target:DamageRoll['target'],enemyId:number,base:number)=>{const critical=random()<CRITICAL_CHANCE,damage=base*(critical?2:1);r.lastHits!.push({target,enemyId,damage,critical});return damage;};
  if(action.type==='upgradeGear'&&r.mode==='reward'&&r.relic&&r.upgradeOffer&&!r.upgradeOffer.resolved&&r.salvage>=r.upgradeOffer.cost){const offer=r.upgradeOffer;r.salvage-=offer.cost;r.boosts={...r.boosts,[offer.slot]:climbBoost(r,offer.slot)+1};offer.resolved=true;offer.purchased=true;if(offer.slot==='chassis'){r.maxHp+=4;r.hp=Math.min(r.maxHp,r.hp+4);}append(r,`${itemFor(r.gear[offer.slot]!).name} overclocked for this climb: ${upgradeBenefit(offer.slot)}.`);return r;}
  if(action.type==='skipUpgrade'&&r.mode==='reward'&&r.upgradeOffer&&!r.upgradeOffer.resolved){r.upgradeOffer.resolved=true;return r;}
  if(action.type==='begin'&&r.mode==='camp'){r.climbActive=true;r.climbId??=r.id;r.mode='map';append(r,`${heroFor(r).name} joins the Alpha City uprising.`);return r;}
  if(action.type==='visit'&&r.mode==='map'){
    if(!availableNodes(r).some(n=>n.id===action.id))return original;
    const n=nodeFor(action.id,r.chapter);r.nodeId=n.id;r.depth=n.depth;r.visited.push(n.id);
    if(n.kind==='combat'||n.kind==='elite'||n.kind==='boss')enterCombat(r,n.kind==='boss');
    else if(n.kind==='relic'){r.relic=true;reward(r,`${chapterFor(r.chapter).relic} recovered`,`${chapterFor(r.chapter).relic} is yours. Extract to secure it and complete the chapter.`,n.reward);}
    else {r.mode='event';append(r,`Discovered ${n.name}.`);}return r;
  }
  if(action.type==='event'&&r.mode==='event'){
    const choice=eventChoices(r.chapter,r.nodeId,r.ranks[r.gear.tool]).find(c=>c.id===action.choice);
    if(!choice||(choice.requires&&r.gear.tool!==choice.requires)||r.supplies<(choice.supplyCost??0))return original;
    r.supplies-=choice.supplyCost??0;
    if(choice.hurt)hurt(r,choice.hurt);
    if(r.hp<=0)return r;
    r.maxHp+=choice.maxHp??0;r.hp=Math.min(r.maxHp,r.hp+(choice.maxHp??0)+(choice.heal??0));r.supplies+=choice.supplies??0;r.danger+=choice.danger??0;r.bonusPower+=choice.power??0;
    reward(r,choice.title,choice.result,choice.salvage);return r;
  }
  if(action.type==='continue'&&r.mode==='reward'&&!r.relic){r.mode='map';return r;}
  if(action.type==='extract'&&['map','reward'].includes(r.mode)){if((r.upgradeOffer&&!r.upgradeOffer.resolved)||(r.climbActive&&!r.relic))return original;if(r.chapter===9||!r.relic)clearClimb(r);r.mode='result';r.victory=true;r.outcome=r.relic?(r.chapter===9?'Alpha City is free':`District ${chapterFor(r.chapter).roman} liberated`):'Back behind the signal';append(r,`Secured ${r.salvage} off-chain credits${r.relic?' · '+chapterFor(r.chapter).name+' liberated':''}.`);return r;}
  if(action.type==='heal'&&['map','combat'].includes(r.mode)&&r.supplies>0&&r.hp<r.maxHp){if(c&&c.ap<1)return original;r.supplies--;r.hp=Math.min(r.maxHp,r.hp+healAmount(r));if(c)c.ap--;append(r,`Medkit: restore ${healAmount(r)} health.`);return r;}
  if(r.mode!=='combat'||!c)return original;
  if(action.type==='move'){
    if(c.ap<1||same(c.hero,action.position)||!reachable(c,c.hero,action.position,moveRange(r)))return original;
    c.hero={...action.position};c.ap--;c.last='Position changed. The marked attacks stay where they were.';return r;
  }
  if(action.type==='guard'){
    if(c.ap<1)return original;c.ap--;c.block+=guardAmount(r);c.last=`Brace: +${guardAmount(r)} guard until the next enemy turn.`;append(r,c.last);return r;
  }
  if(action.type==='attack'){
    const enemy=c.enemies.find(e=>e.id===action.id&&e.hp>0);if(!enemy)return original;
    const hero=heroFor(r);const cost=action.skill?2:1;
    if(!canAttack(r,enemy,action.skill))return original;
    if(action.skill&&r.heroId==='glitchborn'){
      const landing=blinkLanding(c,enemy);if(!landing)return original;c.hero=landing;
    }
    let damage=action.skill?skillDamage(r):weaponDamage(r);
    if(!action.skill&&weaponType(r)!=='Umbral')damage=Math.max(1,damage-(enemy.armor??0));
    if(c.firstStrike&&r.heroId==='glitchborn')damage+=3;c.firstStrike=false;
    damage=hit('enemy',enemy.id,damage);enemy.hp=Math.max(0,enemy.hp-damage);
    const weapon=equippedItem(r,'weapon');if(weapon?.damageType==='Kinetic')enemy.slow=1;if(weapon?.damageType==='Enertech')enemy.weaken=weakenPercent(weapon);if(weapon?.damageType==='Siphon')r.salvage+=siphonCredits(weapon);if(r.gear.weapon==='daggers')enemy.poison=2+(r.ranks.daggers>=2?1:0);
    if(action.skill&&r.heroId==='coinbroker')enemy.jammed=1;
    if(action.skill){c.cooldown=Math.max(1,(r.level>=4?2:3)-(r.gear.cranial==='crown'?1:0));if(r.heroId==='chainbreaker')c.block+=5+(r.level-1);if(r.heroId==='nodewalker')c.enemies.forEach(e=>{if(e.id!==enemy.id&&distance(e,enemy)<=2)e.hp=Math.max(0,e.hp-hit('enemy',e.id,4+(r.level-1)));});}
    c.ap-=cost;c.last=`${action.skill?hero.skill:'Strike'} hits ${enemy.name} for ${damage}${r.lastHits!.some(h=>h.critical)?' · CRITICAL ×2':''}${r.gear.weapon==='daggers'?' + corruption':''}.`;append(r,c.last);
    c.enemies=c.enemies.filter(e=>e.hp>0);if(!c.enemies.length)combatWon(r);return r;
  }
  if(action.type==='end'){
    c.travel=[];r.turns++;const arena=combatArena(c);if(c.layout===2&&arena?.props.some(p=>distance(p,c.hero)===1))c.block+=3;if(r.gear.charm==='armor')c.block+=armorGuard(r);if(r.gear.chassis==='mantle')c.block+=2+(r.ranks.mantle??0);let total=0;
    c.enemies.forEach(e=>{if(e.poison>0){e.hp-=poisonDamage(r);e.poison--;}});c.enemies=c.enemies.filter(e=>e.hp>0);
    if(!c.enemies.length){combatWon(r);return r;}
    let jamHit=false;c.lingering=[];
    c.enemies.forEach(e=>{
      if((e.jammed??0)>0){e.jammed!--;e.slow=0;e.weaken=0;return;}
      if((e.role==='nullifier'||(c.bossRules&&e.type==='boss'&&[4,8].includes(r.chapter)))&&e.intent.some(p=>same(p,c.hero)))jamHit=true;
      if(e.intent.some(p=>same(p,c.hero))){total+=hit('hero',e.id,enemyDamage(e));if(c.bossRules&&e.type==='boss'&&r.chapter===2)r.salvage=Math.max(0,r.salvage-20);}
      if(c.bossRules&&e.type==='boss'){if(r.chapter===3)c.lingering=e.intent.map(p=>({...p}));if(r.chapter===7)c.enemies.forEach(ally=>{if(ally.id!==e.id)ally.hp=Math.min(ally.maxHp,ally.hp+(e.phase===2?8:4));});}
      if(e.advancing||(c.bossRules&&e.type==='boss'&&r.chapter===1)){
        const path=route(c,e,c.hero,BOARD_SIZE,'enemy');
        const steps=Math.max(0,(e.type==='boss'?1:2)-(e.slow??0)),end=Math.min(steps,path.length-2);
        const next=end>0?path[end]:undefined;
        if(next){c.travel!.push({enemyId:e.id,path:path.slice(0,end+1)});e.x=next.x;e.y=next.y;}
      }
      e.slow=0;e.weaken=0;
    });
    if(c.hazards?.some(p=>same(p,c.hero)))total+=c.hazardDamage??0;
    if(arena?.damage&&arena.props.some(p=>same(p,c.hero)))total+=arena.damage;
    const damage=Math.max(0,total-c.block);hurt(r,damage);if(r.hp<=0)return r;
    c.last=damage?`Enemy turn: ${damage} damage taken. Find safety before the next strike.`:total?'Your guard absorbs the attack.':'You evade every attack. The next intentions are revealed.';if(jamHit)c.last+=' Signature jammed for your next turn.';
    if(r.lastHits!.some(h=>h.critical))c.last+=' Critical strike: double damage.';append(r,c.last);c.block=0;c.ap=3;c.round++;c.cooldown=Math.max(0,c.cooldown-1-(c.layout===4&&arena?.props.some(p=>distance(p,c.hero)===1)?1:0));c.lockout=jamHit?1:0;planEnemies(c);return r;
  }
  return original;
}
