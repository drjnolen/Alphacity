import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,weaponDamage,skillDamage,guardAmount,climbBoost} from '../src/lib/game.ts';
import {emptyBook,preparedRun,settleExpedition,continueClimb,migrateSave,mintAtSafehouse} from '../src/lib/progression.ts';
import {ENCOUNTERS} from '../src/lib/encounter-arenas.ts';
import {boardCells,route,sceneBounds,projectCell} from '../src/lib/battlefield.ts';
import {district} from './planner.mjs';
const boss=(ch=1)=>{let r=transition(createRun('glitchborn',undefined,ch),{type:'begin'});r.depth=4;return transition(r,{type:'visit',id:'guardian'});};
function win(r){for(const e of r.combat.enemies){e.hp=1;e.poison=1;}return transition(r,{type:'end'});}
test('all 45 encounter rooms have connected floors, distinct district footprints, features and framing',()=>{
 for(let ch=1;ch<=9;ch++){const footprints=new Set(),names=new Set();for(const id of ENCOUNTERS){let r=transition(createRun('glitchborn',undefined,ch),{type:'begin'});r.depth=id==='guardian'?4:['gate','detour'].includes(id)?2:0;r=transition(r,{type:'visit',id});const c=r.combat;footprints.add(c.arena.rows.join(''));names.add(c.arena.name);assert.ok(c.arena.props.length>0);assert.equal(c.encounter,id);const bounds=sceneBounds(c);c.enemies=[];for(const p of boardCells(c)){const q=projectCell(c,p);assert.ok(q.x-58>=bounds.x&&q.x+58<=bounds.x+bounds.width&&q.y-160>=bounds.y);if(!c.obstacles.some(o=>o.x===p.x&&o.y===p.y))assert.ok(route(c,c.hero,p).length,`${ch}/${id}: ${JSON.stringify(p)}`);}}assert.equal(footprints.size,5);assert.equal(names.size,5);}
});
test('boss offer targets equipped gear, persists on reload and charges at most once',()=>{
 let r=win(boss()),b=emptyBook();assert.ok(Object.keys(r.gear).includes(r.upgradeOffer.slot));const before=migrateSave({version:5,run:r,book:b});assert.deepEqual(before.run.upgradeOffer,r.upgradeOffer);assert.equal(transition(r,{type:'extract'}),r);assert.equal(transition(r,{type:'mint'}),r);const credits=r.salvage;r=transition(r,{type:'upgradeGear'});assert.equal(r.salvage,credits-r.upgradeOffer.cost);assert.equal(climbBoost(r,r.upgradeOffer.slot),1);assert.equal(transition(r,{type:'upgradeGear'}),r);assert.equal(b.inventory.length,10);
 const poor={...win(boss()),salvage:0};assert.equal(transition(poor,{type:'upgradeGear'}),poor);assert.equal(transition(transition(poor,{type:'skipUpgrade'}),{type:'extract'}).mode,'result');
});
test('each temporary slot upgrade grants the promised stats and disappears on death',()=>{
 for(const slot of ['weapon','tool','charm','cranial','chassis']){let r=preparedRun(emptyBook(),'glitchborn',createRun().gear,1);r=transition(r,{type:'begin'});r.depth=4;r=win(transition(r,{type:'visit',id:'guardian'}));r.upgradeOffer={slot,cost:1,resolved:false,purchased:false};const old=structuredClone(r);r=transition(r,{type:'upgradeGear'});if(slot==='weapon'){assert.equal(weaponDamage(r),weaponDamage(old)+2);assert.equal(skillDamage(r),skillDamage(old)+2);}if(slot==='cranial')assert.equal(skillDamage(r),skillDamage(old)+2);if(slot==='charm')assert.equal(guardAmount(r),guardAmount(old)+2);if(slot==='chassis')assert.equal(r.maxHp,old.maxHp+4);
 r.mode='map';r.depth=0;r.nodeId='threshold';r.relic=false;r=transition(r,{type:'visit',id:'bridge'});if(slot==='tool'){const plain={...old,mode:'map',depth:0,nodeId:'threshold',relic:false};const base=transition(plain,{type:'visit',id:'bridge'});assert.equal(r.combat.block,base.combat.block+3);}
 r.hp=1;r.phoenixUsed=true;r.combat.block=0;r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=1000;r=transition(r,{type:'end'});assert.equal(r.mode,'result');assert.deepEqual(r.boosts,{});assert.equal(r.climbActive,false);}
});
test('continuing districts retains health, supplies, loadout and upgrades; completing nine resets them',()=>{
 let b=emptyBook(),r=boss();r=win(r);r.upgradeOffer.slot='weapon';r=transition(r,{type:'upgradeGear'});r.hp=17;r.supplies=4;r=transition(r,{type:'extract'});b=settleExpedition(b,r);const inventory=b.inventory.length,saved=migrateSave({version:5,book:b,run:r});r=continueClimb(saved.book,saved.run);assert.equal(r.chapter,2);assert.equal(r.hp,17);assert.equal(r.supplies,4);assert.equal(r.boosts.weapon,1);assert.equal(r.climbActive,true);assert.equal(r.mode,'map');assert.equal(transition(r,{type:'extract'}),r);
 for(let ch=2;ch<=9;ch++){r.depth=4;r=win(transition(r,{type:'visit',id:'guardian'}));if(r.upgradeOffer)r=transition(r,{type:'skipUpgrade'});r=transition(r,{type:'extract'});b=settleExpedition(b,r);if(ch<9)r=continueClimb(b,r);}
 assert.equal(r.chapter,9);assert.equal(r.climbActive,false);assert.deepEqual(r.boosts,{});assert.equal(b.inventory.length,inventory);assert.equal(b.cleared.length,9);
});
test('safehouse mints spend only banked funds and cannot change an ongoing loadout',()=>{
 const b={...emptyBook(),salvage:1000},r=transition(preparedRun(b,'glitchborn',createRun().gear,1),{type:'begin'}),copy=structuredClone(r),after=mintAtSafehouse(b);assert.equal(after.salvage,0);assert.equal(after.inventory.length,11);assert.deepEqual(r,copy);assert.equal(after.inventory.at(-1).origin,'safehouse');
});
test('four fresh factions can complete a continuous climb with earned overclocks and no new permanent forging',()=>{
 const original=Math.random;let draw=0;Math.random=()=>((draw++%5)+.1)/5;
 try{for(const hero of ['glitchborn','chainbreaker','nodewalker','coinbroker']){let b=emptyBook(),r=preparedRun(b,hero,createRun().gear,1);for(let ch=1;ch<=9;ch++){r=district(r,true,true);assert.ok(r.victory&&r.relic,JSON.stringify({hero,ch,mode:r.mode,node:r.nodeId,hp:r.hp,boosts:r.boosts}));b=settleExpedition(b,r);if(ch<9)r=continueClimb(b,r);}assert.equal(b.cleared.length,9);assert.deepEqual(r.boosts,{});}console.log('Four uninterrupted nine-district climbs passed without new permanent forge upgrades.');}finally{Math.random=original;}
});

test('long-climb health and captured power survive reload without old district caps',()=>{const r=boss(),book=emptyBook();r.maxHp=312;r.hp=307;r.bonusPower=28;r.boosts={chassis:5};const saved=migrateSave({version:5,run:r,book});assert.equal(saved.run.hp,307);assert.equal(saved.run.maxHp,312);assert.equal(saved.run.bonusPower,28);assert.equal(saved.run.boosts.chassis,5);});
