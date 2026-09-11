import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,weaponDamage,skillDamage,planEnemies} from '../src/lib/game.ts';
import {emptyBook,mintAtSafehouse,preparedRun,equipOwned,collectMint,migrateSave,settleExpedition} from '../src/lib/progression.ts';
import {catalogEquipment,RARITIES,rollEquipment,mintCost,starterInventory,bonusDamage,enemyDamage,siphonCredits,validEquipment} from '../src/lib/equipment.ts';
import {BOSS_PROTOCOLS} from '../src/lib/bosses.ts';
import {combatFeedback} from '../src/lib/combat-feedback.ts';
const enter=(r=createRun())=>transition(transition(r,{type:'begin'}),{type:'visit',id:'bridge'});
function boss(ch){let r=transition(createRun('nodewalker',undefined,ch),{type:'begin'});r.depth=4;return transition(r,{type:'visit',id:'guardian'});}
function target(r){r.combat.enemies=r.combat.enemies.slice(0,1);const e=r.combat.enemies[0];e.hp=e.maxHp=200;r.combat.hero={x:3,y:1};e.x=4;e.y=1;e.armor=9;r.combat.firstStrike=false;return e;}
test('five slots persist and cranial/chassis effects change actual combat stats',()=>{
 let b=emptyBook(),r=preparedRun(b,'glitchborn',createRun().gear,1);assert.equal(Object.keys(r.loadout).length,5);assert.ok(r.maxHp>createRun().maxHp);assert.ok(skillDamage(r)>skillDamage(createRun()));
 b=equipOwned(b,'starter-crown');b=equipOwned(b,'starter-mantle');r=enter(preparedRun(b,'nodewalker',createRun().gear,1));target(r);let a=transition(r,{type:'attack',id:1,skill:true});assert.equal(a.combat.cooldown,2);a.combat.block=0;a.combat.hazards=[];a.combat.enemies[0].intent=[a.combat.hero];a.combat.enemies[0].intentDamage=5;const end=transition(a,{type:'end'});assert.equal(end.hp,a.hp-3);
 assert.equal(equipOwned(b,'unknown'),b);assert.equal(equipOwned(b,'starter-visor',true),b);
});
test('all weapon types grant their exact faction affinity and Umbral bypasses armor',()=>{
 for(const [baseId,hero] of [['daggers','glitchborn'],['sword','chainbreaker'],['capacitor','nodewalker'],['repeater','coinbroker']]){const r=createRun(hero,{weapon:baseId,tool:'hook',charm:'phoenix'});assert.equal(bonusDamage(r),3);const other=createRun(hero==='glitchborn'?'nodewalker':'glitchborn',r.gear);assert.equal(bonusDamage(other),1);}
 const r=enter();const e=target(r),a=transition(r,{type:'attack',id:1});assert.equal(e.hp-a.combat.enemies[0].hp,weaponDamage(r));
});
test('Kinetic and Enertech affect only the next enemy turn; repeated hits do not stack',()=>{
 let r=enter(createRun('nodewalker',{weapon:'capacitor',tool:'hook',charm:'phoenix'}));target(r);r.combat.block=0;r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=20;
 let a=transition(r,{type:'attack',id:1});a=transition(a,{type:'attack',id:1});assert.equal(a.combat.enemies[0].weaken,10);assert.equal(enemyDamage(a.combat.enemies[0]),18);const end=transition(a,{type:'end'});assert.equal(end.hp,a.hp-18);assert.equal(end.combat.enemies[0].weaken,0);assert.ok(combatFeedback(a,end,{type:'end'}).impacts.some(i=>i.text==='−18'));
 r=enter(createRun('chainbreaker',{weapon:'sword',tool:'hook',charm:'phoenix'}));target(r);a=transition(r,{type:'attack',id:1});a.combat.hero={x:0,y:2};a.combat.enemies[0].advancing=true;a.combat.enemies[0].intent=[];a.combat.obstacles=[];delete a.combat.terrain;delete a.combat.layout;delete a.combat.arena;const slowed=transition(a,{type:'end'});assert.equal(slowed.combat.travel[0].path.length,2);assert.equal(slowed.combat.enemies[0].slow,0);
});
test('Siphon payout uses quality and rarity once per valid primary hit',()=>{
 const r=enter(createRun('coinbroker',{weapon:'repeater',tool:'hook',charm:'phoenix'}));target(r);const item={...catalogEquipment().find(i=>i.baseId==='repeater'),rarity:4,quality:3};r.loadout={weapon:item};const a=transition(r,{type:'attack',id:1});assert.equal(a.salvage-r.salvage,siphonCredits(item));assert.equal(siphonCredits(item),24);assert.equal(transition(r,{type:'attack',id:99}),r);
});
test('mint distribution boundaries cover all tiers, slots and quality levels',()=>{
 assert.equal(RARITIES.reduce((n,r)=>n+r.weight,0),100);let lower=0;for(let rarity=0;rarity<6;rarity++){const values=[.1,.1,(lower+.01)/100,.99];const item=rollEquipment(1,()=>values.shift());assert.equal(item.rarity,rarity);assert.equal(item.quality,3);assert.ok(validEquipment(item));lower+=RARITIES[rarity].weight;}
 for(let slot=0;slot<5;slot++){const values=[(slot+.1)/5,.1,.1,0];assert.equal(rollEquipment(1,()=>values.shift()).slot,['weapon','tool','charm','cranial','chassis'][slot]);}
});
test('safehouse mint deducts banked credits and permanently collects an item',()=>{
 const poor={...emptyBook(),salvage:999};assert.equal(mintAtSafehouse(poor),poor);const b={...emptyBook(),salvage:2000},a=mintAtSafehouse(b);assert.equal(a.salvage,1000);assert.equal(a.inventory.length,b.inventory.length+1);assert.equal(a.inventory.at(-1).origin,'safehouse');const saved=migrateSave({version:5,book:a,run:createRun()});assert.equal(saved.book.inventory.at(-1).id,a.lastMintId);assert.equal(saved.book.salvage,1000);const second=mintAtSafehouse(a);assert.equal(second.salvage,0);assert.notEqual(second.lastMintId,a.lastMintId);
});
test('version three saves retain progress and gain starter equipment without a reset',()=>{
 const book=emptyBook();book.cleared=[1,2,3];book.salvage=600;delete book.inventory;delete book.equipped;const run=boss(3);const save=migrateSave({version:3,book,run});assert.deepEqual(save.book.cleared,[1,2,3]);assert.equal(save.book.salvage,600);assert.equal(save.run.mode,'combat');assert.equal(save.book.inventory.length,10);
});
test('nine bosses expose distinct protocols, fixed telegraphs, phases and meaningful effects',()=>{
 assert.equal(new Set(BOSS_PROTOCOLS.map(p=>p.name)).size,9);for(let ch=1;ch<=9;ch++){let r=boss(ch),c=r.combat,e=c.enemies[0];assert.ok(e.ability);const before=JSON.stringify(e.intent);e.hp=Math.floor(e.maxHp*.25);assert.equal(JSON.stringify(e.intent),before);planEnemies(c);assert.equal(c.enemies[0].phase,ch===9?3:2);c.enemies.forEach(n=>n.poison=0);r.hp=r.maxHp=500;const end=transition(r,{type:'end'}),cue=combatFeedback(r,end,{type:'end'});assert.equal(cue.bossEffect,BOSS_PROTOCOLS[ch-1].effect);assert.ok(cue.attacks.some(a=>a.boss&&a.effect));}
});
test('Titan fire lingers, Curator heals escorts and jamming cancels boss mechanics',()=>{
 let r=boss(3);r.hp=r.maxHp=500;const fire=r.combat.enemies[0].intent;let end=transition(r,{type:'end'});assert.deepEqual(end.combat.lingering,fire);assert.ok(fire.every(p=>end.combat.hazards.some(q=>q.x===p.x&&q.y===p.y)));
 r=boss(7);r.hp=r.maxHp=500;r.combat.enemies[1].hp-=10;end=transition(r,{type:'end'});assert.equal(end.combat.enemies[1].hp,r.combat.enemies[1].hp+4);r.combat.enemies[0].jammed=1;end=transition(r,{type:'end'});assert.equal(end.combat.enemies[1].hp,r.combat.enemies[1].hp);assert.equal(combatFeedback(r,end,{type:'end'}).bossEffect,undefined);
});
