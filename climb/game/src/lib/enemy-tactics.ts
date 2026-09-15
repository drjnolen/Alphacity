import type {Combat,Enemy,Position} from './game.ts';
import {boardCells,connected,route,hasTile} from './battlefield.ts';
const same=(a:Position,b:Position)=>a.x===b.x&&a.y===b.y;
const distance=(a:Position,b:Position)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export type TacticalEnemy={assault?:boolean;support?:boolean;commander?:boolean;charger?:boolean;enrage?:number;advancePath?:Position[];charge?:{phase:'windup'|'release';tiles:Position[];damage:number;startHp:number;required:number;origin:Position};interrupted?:boolean;objective?:{name:string;turns:number;triggered:boolean}};
export const OBJECTIVES=['Memory purge beacon','Privateer distress mast','Devotion broadcaster','Sentence uplink','Dynasty reinforcement beacon'];
export function configureTactics(c:Combat){
 const ch=c.chapter??1;
 for(const [i,e] of c.enemies.entries()){
  e.commander=e.type==='boss'||(c.encounter==='gate'&&i===0);
  e.assault=e.type==='husk'&&e.role==='enforcer';
  e.charger=(ch>=2&&e.role==='sniper'&&!e.commander)||(ch>=4&&e.type==='boss');
 }
 if(ch>=3&&c.encounter!=='bridge'){
  const last=c.enemies.at(-1)!,spot=boardCells(c).filter(p=>!same(p,c.hero)&&!c.obstacles.some(o=>same(o,p))&&!c.enemies.some(o=>same(o,p))).sort((a,b)=>distance(a,last)-distance(b,last))[0];
  if(!spot)return;const e:Enemy={...last,...spot,id:Math.max(...c.enemies.map(e=>e.id))+1,hp:10+ch*2,maxHp:10+ch*2,armor:0,commander:false,enrage:0};c.enemies.push(e);e.support=true;e.assault=false;e.charger=false;e.role='drone';e.type='watcher';e.faction='The Singularity';e.portrait=8;e.name='Aegis relay';
  if(ch>=5){e.name=OBJECTIVES[ch-5];e.objective={name:e.name,turns:4,triggered:false};}
 }
}
export function supportArmor(c:Combat,e:Enemy):number{
 if(e.support)return 0;
 return c.enemies.some(s=>s.support&&s.hp>0&&!(s.jammed??0)&&distance(s,e)<=2&&supportStrength(s)>0)?Math.max(...c.enemies.filter(s=>s.support&&s.hp>0&&!(s.jammed??0)&&distance(s,e)<=2).map(s=>supportStrength(s))):0;
}
export const supportStrength=(e:Enemy)=>Math.max(0,Math.ceil(4*(1-(e.weaken??0)/25)));
export const tacticalArmor=(c:Combat,e:Enemy)=>Math.max(0,(e.armor??0)-(e.enrage??0)*2)+supportArmor(c,e);
export function cancelCharge(e:Enemy){if(e.charge){delete e.charge;e.intent=[];e.intentDamage=0;e.interrupted=true;}}
export function refreshInterrupts(c:Combat){
 for(const e of c.enemies)if(e.charge&&(e.hp<=0||(e.jammed??0)>0||(e.weaken??0)>=40||!same(e,e.charge.origin)||e.charge.startHp-e.hp>=e.charge.required))cancelCharge(e);
}
export function planTactics(c:Combat,e:Enemy){
 if(e.commander){e.enrage=e.hp<=e.maxHp*.25?2:e.hp<=e.maxHp*.5?1:0;e.intentDamage=(e.intentDamage??e.damage)+Math.ceil(e.damage*(e.enrage*.2));}
 if(e.support){e.intent=[];e.advancing=false;e.intentDamage=0;return;}
 if(e.assault){
  const path=route(c,e,c.hero,54,'enemy');e.advancePath=path.slice(0,Math.min(3,path.length-1));
  const end=e.advancePath.at(-1)??e;e.intent=distance(end,c.hero)===1&&connected(c,end,c.hero)?[{...c.hero}]:[];
  e.advancing=e.intent.length===0;return;
 }
 if(e.charger){
  if(e.charge){e.intent=e.charge.phase==='release'?e.charge.tiles:[];e.intentDamage=e.charge.damage;return;}
  if(c.round%3===1){e.charge={phase:'windup',tiles:e.intent.map(p=>({...p})),damage:Math.ceil((e.intentDamage??e.damage)*1.25),startHp:e.hp,required:8+(c.chapter??1)*2,origin:{x:e.x,y:e.y}};e.intent=[];}
 }
 e.interrupted=false;
}
// Resolve only the announced path. Slows, occupied cells and displacement can cancel contact.
export function assaultPath(c:Combat,e:Enemy):Position[]{
 const planned=e.advancePath;if(!planned?.length||!same(e,planned[0]))return [{x:e.x,y:e.y}];
 const path=[planned[0]];
 for(const p of planned.slice(1,Math.max(1,3-(e.slow??0)))){
  if(!hasTile(c,p)||!connected(c,path.at(-1)!,p)||c.obstacles.some(o=>same(o,p))||same(c.hero,p)||c.enemies.some(other=>other.id!==e.id&&other.hp>0&&same(other,p)))break;
  path.push(p);
 }
 return path;
}
export function effectiveIntent(c:Combat,e:Enemy):Position[]{
 if((e.jammed??0)>0||e.support||e.charge?.phase==='windup'||e.interrupted)return [];
 if(!e.assault)return e.intent;
 if(!e.advancePath?.length||!same(e,e.advancePath[0]))return [];
 const end=assaultPath(c,e).at(-1)!;return e.intent.filter(p=>distance(end,p)===1&&connected(c,end,p));
}
export const canDisableRelay=(c:Combat,e:Enemy)=>!!e.support&&e.hp>0&&c.ap>=1&&distance(c.hero,e)===1&&connected(c,c.hero,e);
export function tickObjectives(c:Combat):string[]{
 const messages:string[]=[];
 for(const e of [...c.enemies]){
  const o=e.objective;if(!o||o.triggered||e.hp<=0||(e.jammed??0)>0||(e.weaken??0)>=25)continue;
  if(--o.turns>0)continue;
  const candidates=boardCells(c).filter(p=>!same(p,c.hero)&&!c.obstacles.some(q=>same(q,p))&&!c.enemies.some(q=>q.hp>0&&same(p,q))&&route(c,p,c.hero,54,'enemy').length).sort((a,b)=>distance(a,e)-distance(b,e));
  const p=candidates[0];if(!p){o.turns=1;continue;}
  o.triggered=true;
  c.enemies.push({...p,id:Math.max(...c.enemies.map(e=>e.id))+1,name:'Response enforcer',hp:17+(c.chapter??1)*4,maxHp:17+(c.chapter??1)*4,damage:e.damage,type:'husk',role:'enforcer',faction:'Overlords',portrait:9,armor:1,poison:0,intent:[],advancing:true,assault:true});
  messages.push(o.name+' summoned one response enforcer. Its first attack is announced next round.');
 }
 return messages;
}
export function tacticalHint(c:Combat,e:Enemy):string{
 if(e.support)return `Relay: ${supportStrength(e)} armor to allies within 2 tiles. Pierce it, destroy the relay, suppress it, or push allies out. Adjacent rebels can disable it for 1 AP.`;
 if(e.charge)return `${e.charge.phase==='windup'?`CHARGING · ${e.charge.damage} damage next round`:'RELEASING THIS TURN'}: ${Math.max(0,e.charge.required-(e.charge.startHp-e.hp))} more damage interrupts. Jam, push or 40% suppression also cancels.`;
 if(e.interrupted)return 'CHARGE INTERRUPTED';
 if(e.assault)return `MOVE + STRIKE · up to 2 tiles. Kinetic slow shortens the announced path; pushing cancels the approach.`;
 return '';
}
