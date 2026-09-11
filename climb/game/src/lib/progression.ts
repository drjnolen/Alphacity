import { starterInventory, SAFEHOUSE_MINT_COST, rollEquipment, validEquipment, equippedItem, potency, type Equipment } from './equipment.ts';
import { HEROES, ITEMS, createRun, ranksZero, type Run, type HeroId, type ItemId, type Slot, type Gear } from './game.ts';
import { CHAPTERS, nodesForChapter, type ChapterId } from './campaign.ts';
export type RecordBook={lastMintId?:string;inventory:Equipment[];equipped:Partial<Record<Slot,string>>;salvage:number;lifetimeSalvage:number;expeditions:number;hearts:number;xp:Record<HeroId,number>;ranks:Record<ItemId,number>;cleared:ChapterId[];settled:string[]};
export const XP_THRESHOLDS=[0,100,240,420,640,900,1200,1540,1920,2340,2800,3300];
export const levelFor=(xp:number)=>Math.min(12,XP_THRESHOLDS.filter(t=>xp>=t).length);
export const upgradeCost=(rank:number)=>[90,200,340,520,760][rank]??0;
export const emptyBook=():RecordBook=>({inventory:starterInventory(),equipped:{cranial:'starter-visor',chassis:'starter-plate'},salvage:0,lifetimeSalvage:0,expeditions:0,hearts:0,xp:{glitchborn:0,chainbreaker:0,nodewalker:0,coinbroker:0},ranks:ranksZero(),cleared:[],settled:[]});
export const canEnterChapter=(book:RecordBook,id:ChapterId)=>id===1||book.cleared.includes((id-1) as ChapterId);
export function preparedRun(book:RecordBook,hero:HeroId,gear:Gear,chapter:ChapterId){
 if(!canEnterChapter(book,chapter))throw new Error('Liberate the preceding district first.');
 const fullGear:Gear={cranial:'visor',chassis:'plate',...gear},loadout:Partial<Record<Slot,Equipment>>={};
 for(const slot of ['weapon','tool','charm','cranial','chassis'] as Slot[]){const selected=book.inventory.find(i=>i.id===book.equipped[slot]&&i.slot===slot);const item=selected??book.inventory.find(i=>i.baseId===fullGear[slot]);if(item){loadout[slot]=item;fullGear[slot]=item.baseId;}}
 const run=createRun(hero,fullGear,chapter,levelFor(book.xp[hero]),book.ranks);run.loadout=structuredClone(loadout);
 run.maxHp+=(fullGear.chassis==='plate'?8+(book.ranks.plate??0)*2:0)+potency(equippedItem(run,'chassis'))*2;run.hp=run.maxHp;return run;
}
export function equipOwned(book:RecordBook,id:string,active=false):RecordBook{const item=book.inventory.find(i=>i.id===id);return active||!item?book:{...book,equipped:{...book.equipped,[item.slot]:id}};}
export function mintAtSafehouse(book:RecordBook):RecordBook{if(book.salvage<SAFEHOUSE_MINT_COST)return book;const item={...rollEquipment(1),origin:'safehouse' as const};delete item.district;return {...book,salvage:book.salvage-SAFEHOUSE_MINT_COST,inventory:[...book.inventory,item],lastMintId:item.id};}
export function continueClimb(book:RecordBook,previous:Run):Run{
 if(previous.mode!=='result'||!previous.victory||!previous.relic||!previous.climbActive||previous.chapter>=9)return previous;
 const next=preparedRun(book,previous.heroId,previous.gear,(previous.chapter+1) as ChapterId);
 next.climbActive=true;next.climbId=previous.climbId??previous.id;next.boosts={...previous.boosts};next.loadout=structuredClone(previous.loadout);next.gear={...previous.gear};next.ranks={...previous.ranks};next.bonusPower=previous.bonusPower;
 next.maxHp=previous.maxHp+Math.max(0,next.level-previous.level)*5;next.hp=Math.min(previous.hp,next.maxHp);next.supplies=previous.supplies;next.phoenixUsed=previous.phoenixUsed;next.mode='map';
 next.log=[...previous.log.slice(-20),`The climb continues into ${CHAPTERS[next.chapter-1].name}. Health, supplies and temporary gear upgrades carry forward.`];return next;
}
export function collectMint(book:RecordBook,r:Run):RecordBook{return r.minted&&validEquipment(r.minted)&&!book.inventory.some(i=>i.id===r.minted!.id)?{...book,inventory:[...book.inventory,r.minted]}:book;}
export const earnedXP=(r:Run)=>Math.max(0,r.completedDepth)*(r.victory?12:6)+(r.victory&&r.relic?40*r.chapter:0);
export function settleExpedition(book:RecordBook,r:Run):RecordBook{
 if(r.mode!=='result'||book.settled.includes(r.id))return book;
 const b=structuredClone(collectMint(book,r));b.settled=[...b.settled,r.id].slice(-200);b.expeditions++;b.xp[r.heroId]+=earnedXP(r);
 if(r.victory){b.salvage+=r.salvage;b.lifetimeSalvage+=r.salvage;if(r.relic){if(!b.cleared.includes(r.chapter))b.cleared.push(r.chapter);b.hearts=b.cleared.length;}}
 return b;
}
export function upgradeItem(book:RecordBook,id:ItemId,active=false):RecordBook{
 if(active||!ITEMS.some(i=>i.id===id))return book;const rank=book.ranks[id],cost=upgradeCost(rank);if(rank>=5||book.salvage<cost)return book;
 return {...book,salvage:book.salvage-cost,ranks:{...book.ranks,[id]:rank+1}};
}
export function trainHero(book:RecordBook,id:HeroId,active=false):RecordBook{if(active||!HEROES.some(h=>h.id===id)||book.salvage<75||levelFor(book.xp[id])>=12)return book;return {...book,salvage:book.salvage-75,xp:{...book.xp,[id]:book.xp[id]+80}};}
export function itemDescription(id:ItemId,rank:number){
 switch(id){case 'capacitor':case 'repeater':return `${6+rank*2} base weapon damage before type and faction bonuses.`;case 'visor':return `+${2+rank} signature damage, plus rarity and quality.`;case 'crown':return `Signature cooldown reduced by 1 turn (minimum 1). +${rank} signature damage before rarity and quality.`;case 'plate':return `+${8+rank*2} maximum health, plus rarity and quality.`;case 'mantle':return `+${2+rank} guard each enemy turn, plus rarity and quality health.`;case 'daggers':return `${5+rank*2} weapon damage. Attacks apply ${2+rank} corruption for ${rank>=2?3:2} turns.`;case 'sword':return `${7+rank*2} weapon damage before character bonuses. Signature attacks ignore enemy armor.`;case 'hook':return `Move up to ${3+Math.ceil(rank/2)} tiles. Reach elevated rebel caches.${rank?` Start battles with ${rank*2} guard.`:''}`;case 'lantern':return `Bypass surveillance during exploration (combat hazards still deal damage).${rank?` +${rank*15} hidden credits and ${rank*3} starting guard.`:''}`;case 'armor':return `Gain ${3+rank*2} guard before enemies act every turn.`;case 'phoenix':return `Once per operation, survive a fatal blow with ${14+rank*8} health (up to maximum).`;}
}
const count=(v:unknown,max=1000000)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(max,Math.floor(v))):0;
export function migrateSave(value:unknown):{run:Run;book:RecordBook}{
 const fallback={run:createRun(),book:emptyBook()};if(!value||typeof value!=='object')return fallback;
 const source=value as {run?:Partial<Run>;book?:Partial<RecordBook>;version?:number},old=source.book??{},raw=source.run;
 const b=emptyBook();b.salvage=count(old.salvage);b.lifetimeSalvage=Math.max(b.salvage,count(old.lifetimeSalvage??old.salvage));b.expeditions=count(old.expeditions);b.hearts=count(old.hearts);
 for(const h of HEROES)b.xp[h.id]=count(old.xp?.[h.id]);for(const i of ITEMS)b.ranks[i.id]=count(old.ranks?.[i.id],5);
 b.cleared=Array.isArray(old.cleared)?[...new Set(old.cleared.filter((c):c is ChapterId=>CHAPTERS.some(ch=>ch.id===c)))]:[];
 const highest=Math.max(0,...b.cleared);b.cleared=CHAPTERS.filter(c=>c.id<=highest).map(c=>c.id);
 b.settled=Array.isArray(old.settled)?old.settled.filter(s=>typeof s==='string').slice(-200):[];
 const oldIds:Record<string,HeroId>={vesper:'glitchborn',rook:'chainbreaker',lyra:'nodewalker'};
 const hero=HEROES.some(h=>h.id===raw?.heroId)?raw!.heroId!:(oldIds[String(raw?.heroId)]??'glitchborn');
 if(Array.isArray(old.inventory)){const known=new Set(b.inventory.map(i=>i.id));for(const item of old.inventory){if(validEquipment(item)&&!known.has(item.id)){b.inventory.push(item);known.add(item.id);}}}
 if(typeof old.lastMintId==='string'&&b.inventory.some(i=>i.id===old.lastMintId))b.lastMintId=old.lastMintId;
 if(old.equipped)for(const slot of ['weapon','tool','charm','cranial','chassis'] as Slot[]){if(b.inventory.some(i=>i.id===old.equipped?.[slot]&&i.slot===slot))b.equipped[slot]=old.equipped[slot];}
 if(source.version!==3&&source.version!==4&&source.version!==5){
  const legacyXP=old.xp as Record<string,number>|undefined;
  for(const [previous,next] of Object.entries(oldIds))b.xp[next]=Math.max(b.xp[next],count(legacyXP?.[previous]));
  if(!old.xp&&b.hearts)b.xp[hero]=Math.max(100,b.hearts*100);
  if(raw?.mode&&raw.mode!=='camp'&&raw.mode!=='result'){
   const recovered=count(raw.salvage);b.salvage+=recovered;b.lifetimeSalvage+=recovered;b.xp[hero]+=count(raw.completedDepth??raw.depth,6)*10;
  }
  b.cleared=[];b.hearts=0;
  const gear=raw?.gear&&(['weapon','tool','charm'] as Slot[]).every(slot=>ITEMS.some(i=>i.id===raw.gear?.[slot]&&i.slot===slot))?raw.gear:undefined;
  const fresh=createRun(hero,gear,1,levelFor(b.xp[hero]),b.ranks);
  fresh.log=['Welcome to Alpha City. Your previous credits, mastery, and equipment ranks were transferred. The nine-district revolution begins in the Tangle.'];
  return {run:fresh,book:b};
 }
 if(!raw||!['camp','map','event','combat','reward','result'].includes(raw.mode??'')||!raw.gear||!(['weapon','tool','charm'] as Slot[]).every(slot=>ITEMS.some(i=>i.id===raw.gear?.[slot]&&i.slot===slot)))return {run:createRun(),book:b};
 const chapter=CHAPTERS.some(c=>c.id===raw.chapter)?raw.chapter!:1;
 for(const slot of ['cranial','chassis'] as const){if(raw.gear[slot]&&!ITEMS.some(i=>i.id===raw.gear?.[slot]&&i.slot===slot))delete raw.gear[slot];}
 if(!canEnterChapter(b,chapter)||!nodesForChapter(chapter).some(n=>n.id===raw.nodeId))return {run:preparedRun(b,hero,raw.gear,1),book:b};
 const ranks=ranksZero();for(const i of ITEMS)ranks[i.id]=count(raw.ranks?.[i.id],5);
 const seed=createRun(hero,raw.gear,chapter,Math.max(1,count(raw.level,12)),ranks);
 const r={...seed,...raw,id:typeof raw.id==='string'?raw.id:seed.id,chapter,heroId:hero,gear:{...raw.gear},level:seed.level,ranks,maxHp:Math.max(1,count(raw.maxHp,500)),hp:count(raw.hp,500),supplies:count(raw.supplies,99),salvage:count(raw.salvage),depth:count(raw.depth,5),completedDepth:count(raw.completedDepth??(['map','reward','result'].includes(raw.mode!)?raw.depth:Math.max(0,(raw.depth??0)-1)),5),bonusPower:count(raw.bonusPower,100),visited:Array.isArray(raw.visited)?raw.visited.filter(id=>nodesForChapter(chapter).some(n=>n.id===id)):['threshold'],log:Array.isArray(raw.log)?raw.log.filter(l=>typeof l==='string').slice(-25):seed.log} as Run;
 r.hp=Math.min(r.hp,r.maxHp);
 r.climbActive=raw.climbActive??!['camp','result'].includes(r.mode);r.climbId=typeof raw.climbId==='string'?raw.climbId:r.id;
 r.boosts={};for(const slot of ['weapon','tool','charm','cranial','chassis'] as Slot[])r.boosts[slot]=count(raw.boosts?.[slot],8);
 if(raw.upgradeOffer&&['weapon','tool','charm','cranial','chassis'].includes(raw.upgradeOffer.slot)&&r.gear[raw.upgradeOffer.slot])r.upgradeOffer={slot:raw.upgradeOffer.slot,cost:60+r.chapter*20,resolved:!!raw.upgradeOffer.resolved,purchased:!!raw.upgradeOffer.purchased};else {delete r.upgradeOffer;if(source.version!==5&&r.mode==='reward'&&r.relic&&r.chapter<9){const slots=(['weapon','tool','charm','cranial','chassis'] as Slot[]).filter(s=>r.gear[s]);r.upgradeOffer={slot:slots[Math.floor(Math.random()*slots.length)],cost:60+r.chapter*20,resolved:false,purchased:false};}}
 if(!r.climbActive){r.boosts={};}

 r.loadout={};for(const slot of ['weapon','tool','charm','cranial','chassis'] as Slot[]){const item=raw.loadout?.[slot];if(validEquipment(item)&&item.slot===slot&&item.baseId===r.gear[slot]&&b.inventory.some(i=>i.id===item.id))r.loadout[slot]=item;}
 if(!validEquipment(r.minted))delete r.minted;
 const collected=collectMint(b,r);b.inventory=collected.inventory;
 if(r.mode==='combat'){
  const c=r.combat;if(!c||!Array.isArray(c.enemies)||!Array.isArray(c.obstacles)||!c.hero||![c.hero.x,c.hero.y,c.ap,c.round,c.block,c.cooldown].every(Number.isFinite)||!c.enemies.every(e=>[e.x,e.y,e.hp,e.maxHp,e.damage,e.poison].every(Number.isFinite)&&Array.isArray(e.intent)))return {run:preparedRun(b,hero,r.gear,chapter),book:b};
  c.chapter=chapter;if(c.layout!==undefined&&c.layout!==chapter)delete c.layout;c.hazards??=[];c.hazardDamage??=0;
 }
 // Legacy results already credited their salvage. Never settle them twice.
 if(r.mode==='result'&&!b.settled.includes(r.id))b.settled.push(r.id);
 if(r.mode==='camp'&&!r.climbActive)return {run:preparedRun(b,hero,r.gear,chapter),book:b};
 return {run:r,book:b};
}
