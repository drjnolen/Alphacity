import type {HeroId, Run, Slot} from './game.ts';

export type Talent = {id:string;hero:HeroId;branch:string;name:string;text:string;cost:number;requires?:string};
const branch=(hero:HeroId,name:string,rows:[string,string,string][]):Talent[]=>rows.map(([id,title,text],i)=>({id,hero,branch:name,name:title,text,cost:i<2?1:i===2?2:3,requires:i?rows[i-1][0]:undefined}));
export const TALENTS:Talent[]=[
 ...branch('glitchborn','Ghostrunner',[
  ['momentum','Blind angle','Your first primary hit after moving each round deals +3 damage.'],
  ['escape','Exit strategy','Once per round, a primary-hit kill after moving refunds 1 AP.'],
  ['isolation','No witnesses','Ghost Step grants 6 guard if the target has no living ally within 2 tiles.'],
  ['reset','Ghost circuit','Once per round, a primary-hit kill reduces signature cooldown by 1.']]),
 ...branch('glitchborn','Saboteur',[
  ['residue','Residual code','Every basic hit applies 2 turns of corruption. Nullblades instead apply at least 3 turns.'],
  ['catalyst','Catalyst','Ghost Step consumes existing corruption for +3 damage per remaining turn (maximum +9).'],
  ['silence','Dead signal','A primary hit against an already corrupted enemy suppresses its next attack by at least 25%.'],
  ['contagion','Contagion','Primary-hit kills spread 2 turns of corruption to living enemies within 2 tiles.']]),
 ...branch('chainbreaker','Inductor',[
  ['coil','Coiled stance','Your first Brace each round grants 3 additional guard.'],
  ['convert','Capacitor fists','Your first primary hit after bracing each round consumes up to 6 guard and adds it as damage.'],
  ['absorb','Induction','Fully blocking a damaging enemy turn grants 1 extra AP next round (maximum 4 AP).'],
  ['counter','Counterweight','Store 40% of absorbed damage, up to 8, for your next primary hit. Stored charge does not stack.']]),
 ...branch('chainbreaker','Rupture',[
  ['drag','Severed servos','Basic hits slow enemy movement by 1 next turn. Primary hits against already slowed enemies deal +2 damage.'],
  ['fault','Fault line','Breach Pulse also deals 5 damage to other enemies within 1 tile of the target.'],
  ['redline','Redline','At half health or less, primary hits deal +4 damage but Brace grants 2 less guard.'],
  ['unbound','Unshackled','At half health or less, Breach Pulse costs 1 AP instead of 2 but takes 1 extra round to recover.']]),
 ...branch('nodewalker','Signal architect',[
  ['suppress','Soft reset','Basic hits suppress the target’s next attack by at least 25%.'],
  ['feedback','Feedback loop','Fork Bomb hitting an already suppressed target recovers 1 round sooner.'],
  ['relay','Packet relay','Fork Bomb’s splash radius increases from 2 to 3 tiles, but its primary hit deals 2 less damage.'],
  ['storm','Fork storm','Fork Bomb splash also suppresses every affected enemy’s next attack by at least 25%.']]),
 ...branch('nodewalker','Clocksmith',[
  ['airgap','Air gap','Once per round, moving to a tile with no enemy within 2 tiles grants 4 guard.'],
  ['coldboot','Cold boot','Ending a turn with at least 1 unused AP reduces signature cooldown by 1 extra round.'],
  ['overdrive','Overdrive','Using Fork Bomb at 3 or more AP consumes 3 AP and deals +6 primary damage. At lower AP it works normally.'],
  ['parallel','Parallel process','Once per round, a gear ability reduces signature cooldown by 1; your signature reduces all gear cooldowns by 1.']]),
 ...branch('coinbroker','Acquisitions',[
  ['levy','Marked assets','The first basic hit against each enemy earns 4 credits and marks it for this encounter.'],
  ['bid','Hostile bid','Market Crash against a marked target automatically spends 12 credits for +5 damage, if affordable.'],
  ['cashback','Rebate channel','The first gear ability each round returns 6 credits. Maximum 3 rebates per encounter.'],
  ['maker','Market maker','Market Crash against a marked target grants 3 guard and recovers 1 round sooner.']]),
 ...branch('coinbroker','Underwriter',[
  ['collateral','Collateral','Brace grants +1 guard per 40 unsecured credits, up to +5. Credits are retained.'],
  ['hedge','Hedge fund','Taking health damage from an enemy turn pays up to 8 credits. Maximum 24 credits per encounter.'],
  ['liquidity','Liquid reserves','Below 40 unsecured credits, basic hits deal +2 and Market Crash deals +4 damage.'],
  ['bailout','Bailout','Once per encounter, bracing at half health or less spends 15 credits to heal 6. If unaffordable, gain 3 guard instead.']]),
];
export const hasTalent=(r:Run,id:string)=>!!r.talents?.includes(id)&&TALENTS.some(t=>t.id===id&&t.hero===r.heroId);
export const talentPoints=(r:Run)=>Math.max(0,(r.insight??1)-TALENTS.filter(t=>hasTalent(r,t.id)).reduce((n,t)=>n+t.cost,0));
export const canLearn=(r:Run,id:string)=>{
 const t=TALENTS.find(t=>t.id===id&&t.hero===r.heroId);
 return !!t&&r.climbActive===true&&['map','reward','result'].includes(r.mode)&&!hasTalent(r,id)&&talentPoints(r)>=t.cost&&(!t.requires||hasTalent(r,t.requires));
};
export type OverclockChoice='calibrate'|'active'|'passive';
export const CLOCKS:Record<Slot,{name:string;text:string;passive:string;passiveText:string;cost:number;cooldown:number;target:boolean}>={
 weapon:{name:'Breach strike',text:'Deal 75% of signature damage at basic range +1. Pierce armor and push the target 1 connected tile away; a blocked push deals +3 damage. Applies weapon affixes.',passive:'Execution circuit',passiveText:'Primary hits deal +3 damage against enemies at half health or less.',cost:1,cooldown:3,target:true},
 tool:{name:'Signal snare',text:'Target within 4 tiles: slow movement by 1 and suppress the next attack by 40%. Gain 3 guard. Deals no damage.',passive:'Slip shield',passiveText:'Your first movement each round grants 3 guard.',cost:1,cooldown:3,target:true},
 charm:{name:'Reserve battery',text:'Gain 8 guard and reduce signature cooldown by 1. Cannot remove signature lockout.',passive:'Second wind',passiveText:'Once per encounter, a primary-hit kill restores 4 health.',cost:1,cooldown:4,target:false},
 cranial:{name:'Predictive breach',text:'Target within 4 tiles: expose it for +4 damage on your next primary hit this round and suppress its next attack by 25%.',passive:'Focus lattice',passiveText:'Your first signature each encounter deals +4 primary damage.',cost:1,cooldown:3,target:true},
 chassis:{name:'Discharge',text:'Consume up to 10 guard. Deal that amount +3 damage to one enemy within 2 tiles, piercing armor. Spends the stored defense even if it kills.',passive:'Residual plating',passiveText:'Carry up to 3 unused guard into the next round.',cost:1,cooldown:3,target:true},
};
export const hasClock=(r:Run,slot:Slot,kind:'active'|'passive')=>!!r.overclocks?.[slot]?.includes(kind);
export const armedClocks=(r:Run)=>(r.armedClocks??[]).filter(s=>hasClock(r,s,'active')&&r.gear[s]);
export const signatureCost=(r:Run)=>hasTalent(r,'unbound')&&r.hp<=r.maxHp/2?1:hasTalent(r,'overdrive')&&(r.combat?.ap??0)>=3?3:2;
export const canClock=(r:Run,slot:Slot,id?:number)=>{
 const c=r.combat,clock=CLOCKS[slot];
 if(!c||r.mode!=='combat'||!clock||!armedClocks(r).includes(slot)||c.ap<clock.cost||(c.gearCooldowns?.[slot]??0)>0||(c.lockout??0)>0)return false;
 if(!clock.target)return true;
 const e=c.enemies.find(e=>e.id===id&&e.hp>0);if(!e)return false;
 const range=slot==='weapon'?(r.heroId==='nodewalker'?4:r.heroId==='coinbroker'?3:2):slot==='chassis'?2:4;
 return Math.abs(c.hero.x-e.x)+Math.abs(c.hero.y-e.y)<=range;
};

export const dischargeLimit=(r:Run)=>8+r.level*2;
export const exposureBonus=(r:Run)=>4+Math.floor((r.level-1)/2);
export const batteryGuard=(r:Run)=>7+r.level;
export function clockText(r:Run,slot:Slot){
 if(slot==='chassis')return CLOCKS[slot].text.replace('10 guard',dischargeLimit(r)+' guard');
 if(slot==='cranial')return CLOCKS[slot].text.replace('+4 damage','+'+exposureBonus(r)+' damage');
 if(slot==='charm')return CLOCKS[slot].text.replace('8 guard',batteryGuard(r)+' guard');
 return CLOCKS[slot].text;
}

export const overclockCount=(r:Run,slot?:Slot):number=>slot?(r.boosts?.[slot]??0)+(r.overclocks?.[slot]?.length??0):(['weapon','tool','charm','cranial','chassis'] as Slot[]).reduce((n,s)=>n+overclockCount(r,s),0);
