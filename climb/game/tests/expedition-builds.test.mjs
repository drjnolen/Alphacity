import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,guardAmount,weaponDamage,skillDamage} from '../src/lib/game.ts';
import {TALENTS,CLOCKS,talentPoints,canLearn,canClock,signatureCost} from '../src/lib/expedition.ts';
import {emptyBook,preparedRun,migrateSave,settleExpedition,continueClimb} from '../src/lib/progression.ts';
import {combatFeedback} from '../src/lib/combat-feedback.ts';
const step=(r,a)=>transition(r,a,()=>.5);
function battle(hero='glitchborn',talents=[]){
 let r=step(step(preparedRun(emptyBook(),hero,{weapon:'sword',tool:'hook',charm:'phoenix'},1),{type:'begin'}),{type:'visit',id:'bridge'});
 r.talents=talents;r.insight=9;r.combat.hero={x:3,y:1};r.combat.enemies=r.combat.enemies.slice(0,2);
 r.combat.enemies.forEach((e,i)=>Object.assign(e,{x:4,y:i+1,hp:200,maxHp:200,armor:0,poison:0,intent:[],advancing:false,role:'enforcer'}));
 r.combat.obstacles=[];delete r.combat.arena;delete r.combat.layout;delete r.combat.terrain;r.combat.block=0;r.combat.firstStrike=false;return r;
}
function unlock(r,...slots){r.overclocks=Object.fromEntries(slots.map(s=>[s,['active']]));r.armedClocks=slots;return r;}
const hit=r=>step(r,{type:'attack',id:1});
const skill=r=>step(r,{type:'attack',id:1,skill:true});
const dealt=r=>r.lastHits.find(h=>h.target==='enemy'&&h.enemyId===1)?.damage;

test('every branch is reachable, costs seven insight, supports hybrids and cannot be completed alongside its sibling',()=>{
 for(const hero of ['glitchborn','chainbreaker','nodewalker','coinbroker']){
  const talents=TALENTS.filter(t=>t.hero===hero);assert.equal(talents.length,8);
  for(const branch of [...new Set(talents.map(t=>t.branch))]){
   let r=step(createRun(hero),{type:'begin'});r.insight=9;
   for(const t of talents.filter(t=>t.branch===branch)){assert.ok(canLearn(r,t.id));r=step(r,{type:'learnTalent',id:t.id});}
   assert.equal(talentPoints(r),2);
   const other=talents.filter(t=>t.branch!==branch);r=step(r,{type:'learnTalent',id:other[0].id});r=step(r,{type:'learnTalent',id:other[1].id});
   assert.equal(talentPoints(r),0);assert.equal(canLearn(r,other[2].id),false);
   assert.equal(step(r,{type:'learnTalent',id:other[0].id}),r);
  }
 }
});
test('doctrine rejects foreign classes, missing prerequisites, insufficient points and mid-combat edits',()=>{
 const r=step(createRun(),{type:'begin'});
 for(const id of ['coil','escape','contagion','unknown'])assert.equal(step(r,{type:'learnTalent',id}),r);
 assert.equal(step(battle(),{type:'learnTalent',id:'momentum'}).talents.length,0);
});
test('Glitchborn movement and corruption paths change sequencing, with capped AP refund',()=>{
 let r=battle('glitchborn',['momentum','escape','residue','catalyst','silence','contagion']);
 r=step(r,{type:'move',position:{x:3,y:2}});r=step(r,{type:'attack',id:2});
 assert.equal(r.lastHits[0].damage,weaponDamage(r)+3);assert.equal(r.combat.enemies[1].poison,2);
 r.combat.ap=3;r.combat.enemies[0].poison=3;r=skill(r);
 assert.equal(dealt(r),skillDamage(r)+9);assert.equal(r.combat.enemies[0].poison,0);assert.equal(r.combat.enemies[0].weaken,25);
 r.combat.ap=2;r.combat.hero={x:3,y:1};r.combat.enemies[0].hp=1;r=hit(r);assert.equal(r.combat.ap,2);assert.equal(r.combat.enemies[0].poison,2);
});
test('isolated Ghost Step earns guard; nearby enemies deny it; direct kills recover signature once',()=>{
 let r=battle('glitchborn',['isolation','reset']);assert.equal(skill(r).combat.block,0);
 r.combat.enemies[1].x=8;assert.equal(skill(r).combat.block,6);
 r.combat.enemies[0].hp=1;r=skill(r);assert.equal(r.combat.cooldown,2);
});
test('Chainbreaker converts guard to offense, banks absorbed damage and earns one fourth AP',()=>{
 let r=battle('chainbreaker',['coil','convert','absorb','counter']);r=step(r,{type:'guard'});assert.equal(r.combat.block,guardAmount(r)+3);
 r=hit(r);assert.equal(dealt(r),weaponDamage(r)+6);assert.equal(r.combat.block,guardAmount(r)-3);
 r.combat.block=20;r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=10;
 r=step(r,{type:'end'});assert.equal(r.combat.ap,4);assert.equal(r.combat.memory.charge,4);
 r.combat.enemies.forEach(e=>e.intent=[]);assert.equal(dealt(hit(r)),weaponDamage(r)+4);
});
test('Rupture rewards slow setup and low health, trading guard and cooldown for burst',()=>{
 let r=battle('chainbreaker',['drag','fault','redline','unbound']);r.hp=Math.floor(r.maxHp/2);
 assert.equal(guardAmount(r),guardAmount({...r,talents:[]})-2);assert.equal(signatureCost(r),1);
 r=hit(r);assert.equal(r.combat.enemies[0].slow,1);r=skill(r);
 assert.equal(dealt(r),skillDamage(r)+6);assert.equal(r.lastHits[1].damage,5);assert.equal(r.combat.ap,1);assert.equal(r.combat.cooldown,4);
});
test('Nodewalker suppression precedes faster recovery and expanded suppressing splash',()=>{
 let r=battle('nodewalker',['suppress','feedback','relay','storm']);r.combat.enemies[1].x=7;r.combat.enemies[1].y=1;
 r=hit(r);assert.equal(r.combat.enemies[0].weaken,25);r=skill(r);
 assert.equal(r.combat.cooldown,2);assert.equal(dealt(r),skillDamage(r)-2);assert.equal(r.combat.enemies[1].weaken,25);
});
test('Clocksmith chooses stronger three-AP signatures or banks actions for recovery; gear bridges cooldowns',()=>{
 let r=battle('nodewalker',['airgap','coldboot','overdrive','parallel']);
 assert.equal(signatureCost(r),3);assert.equal(skill(r).combat.ap,0);assert.equal(dealt(skill(r)),skillDamage(r)+6);
 r=step(r,{type:'move',position:{x:1,y:1}});assert.equal(r.combat.block,4);assert.equal(signatureCost(r),2);
 r.combat.cooldown=3;r.combat.enemies.forEach(e=>e.intent=[]);r=step(r,{type:'end'});assert.equal(r.combat.cooldown,1);
 unlock(r,'charm');r=step(r,{type:'overclock',slot:'charm'});assert.equal(r.combat.cooldown,0);
 r.combat.hero={x:3,y:1};r=skill(r);assert.equal(r.combat.gearCooldowns.charm,3);
});
test('Coinbroker marks pay once, hostile bids spend reserves, and maker recovers the signature',()=>{
 let r=battle('coinbroker',['levy','bid','maker']);r.salvage=20;r=hit(r);assert.equal(r.salvage,24);
 r=skill(r);assert.equal(r.salvage,12);assert.equal(dealt(r),skillDamage(r)+5);assert.equal(r.combat.block,3);assert.equal(r.combat.cooldown,2);
 r.combat.ap=3;r=hit(r);assert.equal(r.salvage,12);
});
test('Underwriter has capped insurance, a poor-build damage option and one paid bailout per encounter',()=>{
 let r=battle('coinbroker',['collateral','hedge','liquidity','bailout']);r.salvage=200;assert.equal(guardAmount(r),guardAmount({...r,talents:[]})+5);
 r.salvage=0;assert.equal(dealt(hit(r)),weaponDamage(r)+2);assert.equal(dealt(skill(r)),skillDamage(r)+4);
 r.hp=10;r.salvage=20;r=step(r,{type:'guard'});assert.equal(r.hp,16);assert.equal(r.salvage,5);
 r=step(r,{type:'guard'});assert.equal(r.hp,16);
 r.hp=r.maxHp=1000;r.combat.block=0;
 for(let i=0;i<5;i++){r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=10;r=step(r,{type:'end'});}
 assert.equal(r.salvage,29);
});
test('rebate cannot be farmed indefinitely and applies once per round',()=>{
 let r=unlock(battle('coinbroker',['cashback']),'charm','tool');
 for(let i=0;i<6;i++){r.combat.ap=3;r.combat.gearCooldowns={};r=step(r,{type:'overclock',slot:'charm'});r=step(r,{type:'overclock',slot:'tool',id:1});r.combat.enemies.forEach(e=>e.intent=[]);r=step(r,{type:'end'});}
 assert.equal(r.salvage,18);
});
test('all gear actions charge AP, set cooldowns, enforce targets, and respect lockout',()=>{
 for(const slot of Object.keys(CLOCKS)){
  let r=unlock(battle(),slot),a={type:'overclock',slot,id:1};assert.ok(canClock(r,slot,1));
  const next=step(r,a);assert.equal(next.combat.ap,3-CLOCKS[slot].cost);assert.equal(next.combat.gearCooldowns[slot],CLOCKS[slot].cooldown);
  assert.equal(step(next,a),next);assert.ok(combatFeedback(r,next,a));
  r.combat.lockout=1;assert.equal(step(r,a),r);r.combat.lockout=0;r.combat.ap=0;assert.equal(step(r,a),r);
 }
});
test('Breach strike respects board occupancy and leaves already announced intentions fixed',()=>{
 let r=unlock(battle('nodewalker'),'weapon');r.combat.enemies[0].intent=[{x:3,y:1}];const next=step(r,{type:'overclock',slot:'weapon',id:1});
 assert.equal(next.combat.enemies[0].x,5);assert.deepEqual(next.combat.enemies[0].intent,r.combat.enemies[0].intent);
 r.combat.obstacles=[{x:5,y:1}];const blocked=step(r,{type:'overclock',slot:'weapon',id:1});assert.equal(blocked.combat.enemies[0].x,4);assert.equal(dealt(blocked),dealt(next)+3);
});
test('Predictive breach is consumed once, expires each round, and Discharge consumes defense',()=>{
 let r=unlock(battle('chainbreaker'),'cranial','chassis');r=step(r,{type:'overclock',slot:'cranial',id:1});r.combat.block=9;
 r=step(r,{type:'overclock',slot:'chassis',id:1});assert.equal(dealt(r),16);assert.equal(r.combat.block,0);assert.equal(r.combat.enemies[0].exposed,0);
 r.combat.enemies[0].exposed=4;r.combat.enemies.forEach(e=>e.intent=[]);r=step(r,{type:'end'});assert.equal(r.combat.enemies[0].exposed,0);
});
test('passive overclocks are bounded and require no active loadout slot',()=>{
 let r=battle('nodewalker');r.overclocks=Object.fromEntries(Object.keys(CLOCKS).map(s=>[s,['passive']]));r.hp-=10;
 const s=skill(r);assert.equal(dealt(s),skillDamage(r)+4);
 r=step(r,{type:'move',position:{x:2,y:1}});assert.equal(r.combat.block,3);
 r=step(r,{type:'move',position:{x:3,y:1}});assert.equal(r.combat.block,3);
 r.combat.enemies[0].hp=1;r=hit(r);assert.equal(r.hp,r.maxHp-6);
 r.combat.block=10;r.combat.enemies.forEach(e=>e.intent=[]);r=step(r,{type:'end'});assert.equal(r.combat.block,3);
});
test('gear damage can critically strike and a lethal overclock retains its visual impact',()=>{
 const r=unlock(battle(),'chassis');r.combat.block=10;
 const a={type:'overclock',slot:'chassis',id:1};assert.equal(dealt(transition(r,a,()=>0)),dealt(step(r,a))*2);
 r.combat.enemies=r.combat.enemies.slice(0,1);r.combat.enemies[0].hp=1;const win=step(r,a);assert.equal(win.mode,'reward');assert.ok(combatFeedback(r,win,a).impacts.some(i=>i.killed));
});
test('boss rewards offer persistent choices, award one insight, prevent duplicate unlocks and carry builds forward',()=>{
 let b=emptyBook(),r=step(preparedRun(b,'glitchborn',createRun().gear,1),{type:'begin'});r.depth=4;r=step(r,{type:'visit',id:'guardian'});
 r.combat.enemies.forEach(e=>{e.hp=1;e.poison=1;});r=step(r,{type:'end'});assert.equal(r.insight,2);
 r=step(r,{type:'learnTalent',id:'residue'});r=step(r,{type:'upgradeGear',choice:'active'});const slot=r.upgradeOffer.slot;assert.deepEqual(r.overclocks[slot],['active']);
 const reload=migrateSave({version:5,run:r,book:b}).run;assert.deepEqual(reload.overclocks,r.overclocks);assert.deepEqual(reload.upgradeOffer,r.upgradeOffer);
 r=step(reload,{type:'extract'});b=settleExpedition(b,r);r=continueClimb(b,r);assert.equal(r.insight,2);assert.deepEqual(r.talents,['residue']);assert.deepEqual(r.armedClocks,[slot]);
 r.mode='reward';r.relic=true;r.upgradeOffer={slot,cost:1,resolved:false,purchased:false};r.salvage=10;assert.equal(step(r,{type:'upgradeGear',choice:'active'}),r);
 assert.notEqual(step(r,{type:'upgradeGear',choice:'passive'}),r);
});
test('active loadouts cap at three, lock during combat, and invalid saves cannot add foreign talents',()=>{
 let r=battle();r.mode='map';r.overclocks=Object.fromEntries(Object.keys(CLOCKS).map(s=>[s,['active']]));r.armedClocks=[];
 for(const slot of ['weapon','tool','charm'])r=step(r,{type:'armClock',slot});assert.equal(step(r,{type:'armClock',slot:'chassis'}),r);
 r.mode='combat';assert.equal(step(r,{type:'armClock',slot:'weapon'}),r);r.insight=1;r.talents=['contagion','coil','momentum','momentum'];
 const restored=migrateSave({version:5,run:r,book:emptyBook()}).run;assert.deepEqual(restored.talents,['momentum']);assert.equal(restored.insight,1);
});
test('death and final liberation reset doctrine, gear abilities and temporary stat upgrades',()=>{
 for(const final of [false,true]){
  let r=unlock(battle('chainbreaker',['coil']),'chassis');r.boosts={chassis:2};r.maxHp+=8;
  if(final){r.chapter=9;r.relic=true;r.mode='reward';r=step(r,{type:'extract'});}else{r.hp=1;r.phoenixUsed=true;r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=999;r=step(r,{type:'end'});}
  assert.equal(r.climbActive,false);assert.deepEqual(r.talents,[]);assert.deepEqual(r.overclocks,{});assert.deepEqual(r.armedClocks,[]);assert.deepEqual(r.boosts,{});
 }
});

test('a kill heal cannot erase the cooldown price of a low-health signature',()=>{
 let r=battle('chainbreaker',['unbound']);r.hp=Math.floor(r.maxHp/2);r.overclocks={charm:['passive']};r.combat.enemies[0].hp=1;
 r=skill(r);assert.ok(r.hp>r.maxHp/2);assert.equal(r.combat.ap,2);assert.equal(r.combat.cooldown,4);
});
