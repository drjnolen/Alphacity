import type { HeroId, ItemId, Slot, Run, Enemy } from './game.ts';

export const RARITIES = [
 {name:'Salvage',tier:'Common',weight:45,color:'#aab7c4'},
 {name:'Gutter-tech',tier:'Uncommon',weight:28,color:'#84d59b'},
 {name:'Street Mod',tier:'Rare',weight:16,color:'#6ac9ff'},
 {name:'Black Market',tier:'Epic',weight:8,color:'#cf91ff'},
 {name:'Node-forged',tier:'Legendary',weight:2.5,color:'#ffc768'},
 {name:'Peerless',tier:'Mythic',weight:.5,color:'#ff7caa'},
] as const;
export const SLOTS:Slot[]=['weapon','tool','charm','cranial','chassis'];
export const BASES:Record<Slot,ItemId[]>={weapon:['daggers','sword','capacitor','repeater'],tool:['hook','lantern'],charm:['armor','phoenix'],cranial:['visor','crown'],chassis:['plate','mantle']};
export type DamageType='Umbral'|'Kinetic'|'Enertech'|'Siphon';
export type Equipment={id:string;baseId:ItemId;slot:Slot;rarity:number;quality:number;damageType?:DamageType;origin:'starter'|'boss'|'safehouse';district?:number};
export const TYPE_FOR:Partial<Record<ItemId,DamageType>>={daggers:'Umbral',sword:'Kinetic',capacitor:'Enertech',repeater:'Siphon'};
export const AFFINITY:Record<DamageType,HeroId>={Umbral:'glitchborn',Kinetic:'chainbreaker',Enertech:'nodewalker',Siphon:'coinbroker'};
export const catalogEquipment=():Equipment[]=>SLOTS.flatMap(slot=>BASES[slot].map(baseId=>({id:`starter-${baseId}`,baseId,slot,rarity:0,quality:1,damageType:TYPE_FOR[baseId],origin:'starter' as const})));
export const starterInventory=():Equipment[]=>catalogEquipment().filter(i=>BASES[i.slot].slice(0,2).includes(i.baseId));
export const equippedItem=(r:Run,slot:Slot):Equipment|undefined=>r.loadout?.[slot]??catalogEquipment().find(i=>i.baseId===r.gear[slot]);
export const potency=(i?:Equipment)=>i?i.rarity+i.quality:0;
export const weaponType=(r:Run)=>equippedItem(r,'weapon')?.damageType;
export const bonusDamage=(r:Run)=>{const i=equippedItem(r,'weapon');return i?potency(i)+(i.damageType&&AFFINITY[i.damageType]===r.heroId?2+i.rarity:0):0;};
export const weakenPercent=(i:Equipment)=>[10,15,20,25,30,40][i.rarity];
export const siphonCredits=(i:Equipment)=>[1,2,3,5,8,12][i.rarity]*i.quality;
export const enemyDamage=(e:Enemy)=>Math.ceil((e.intentDamage??e.damage)*(1-(e.weaken??0)/100));
export const mintCost=(chapter:number)=>100+chapter*25;
export function rollEquipment(chapter:number,random:()=>number=Math.random):Equipment {
 const draw=()=>Math.max(0,Math.min(.999999999,random()));
 const slot=SLOTS[Math.floor(draw()*SLOTS.length)],baseId=BASES[slot][Math.floor(draw()*BASES[slot].length)];
 let value=draw()*100,rarity=5;for(let n=0;n<RARITIES.length;n++){value-=RARITIES[n].weight;if(value<0){rarity=n;break;}}
 return {id:crypto.randomUUID(),baseId,slot,rarity,quality:1+Math.floor(draw()*3),damageType:TYPE_FOR[baseId],origin:'boss',district:chapter};
}
export function equipmentText(i:Equipment):string {
 const p=potency(i),affinity=i.damageType?` ${AFFINITY[i.damageType]}: +${2+i.rarity} damage.`:'';
 if(i.damageType)return `+${p} ${i.damageType} damage.${i.damageType==='Umbral'?' Weapon hits ignore armor.':i.damageType==='Kinetic'?' Target moves 1 fewer tile next turn.':i.damageType==='Enertech'?` Target deals ${weakenPercent(i)}% less damage next turn.`:` Earn ${siphonCredits(i)} credits per successful hit.`}${affinity}`;
 return i.slot==='cranial'?`+${p} signature damage.`:i.slot==='chassis'?`+${p*2} maximum health.`:i.slot==='tool'?`+${p} starting guard.`:`+${p} brace guard.`;
}
export function validEquipment(v:unknown):v is Equipment {const i=v as Equipment;return !!i&&typeof i.id==='string'&&i.id.length<100&&SLOTS.includes(i.slot)&&BASES[i.slot].includes(i.baseId)&&Number.isInteger(i.rarity)&&i.rarity>=0&&i.rarity<=5&&Number.isInteger(i.quality)&&i.quality>=1&&i.quality<=3&&i.damageType===TYPE_FOR[i.baseId]&&['starter','boss','safehouse'].includes(i.origin);}

export const SAFEHOUSE_MINT_COST=1000;
