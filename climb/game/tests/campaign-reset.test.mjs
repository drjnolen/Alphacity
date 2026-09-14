import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,HEROES} from '../src/lib/game.ts';
import {emptyBook,preparedRun,restartCampaign,settleExpedition,continueClimb,migrateSave,mintAtSafehouse,levelFor} from '../src/lib/progression.ts';

function campaign(hero='glitchborn'){
 let book=emptyBook();book.salvage=4000;book=mintAtSafehouse(book);
 const minted=book.inventory.at(-1);book.equipped[minted.slot]=minted.id;
 book.inventory.push({...minted,id:'legacy-boss-mint',origin:'boss'});
 book.inventory.push({...minted,id:'temporary-starter-copy',origin:'starter'});
 book.xp=Object.fromEntries(HEROES.map(h=>[h.id,900]));book.ranks=Object.fromEntries(Object.keys(book.ranks).map(k=>[k,3]));
 book.cleared=[1,2,3];book.hearts=3;book.lifetimeSalvage=9000;book.expeditions=7;
 let run=transition(preparedRun(book,hero,createRun().gear,4),{type:'begin'});
 run=transition(run,{type:'visit',id:'bridge'});
 run.salvage=800;run.insight=4;run.talents=['momentum','escape'];run.boosts={weapon:3,chassis:2};
 run.overclocks={weapon:['active','passive']};run.armedClocks=['weapon'];run.bonusPower=7;
 run.combat.gearCooldowns={weapon:3};run.combat.memory={charge:8};
 run.upgradeOffer={slot:'weapon',cost:140,resolved:false,purchased:false};
 return {book,run,minted};
}
function freshState(state){
 const {run,book}=state;
 assert.equal(run.chapter,1);assert.equal(run.mode,'camp');assert.equal(run.level,1);assert.equal(run.nodeId,'threshold');
 assert.equal(run.hp,run.maxHp);assert.equal(run.supplies,2);assert.equal(run.salvage,0);assert.equal(run.bonusPower,0);
 assert.equal(run.combat,null);assert.equal(run.upgradeOffer,undefined);assert.equal(run.phoenixUsed,false);assert.equal(!!run.climbActive,false);
 assert.deepEqual(run.talents,[]);assert.deepEqual(run.overclocks,{});assert.deepEqual(run.armedClocks,[]);assert.equal(run.insight,1);
 assert.ok(Object.values(run.boosts??{}).every(n=>n===0));assert.ok(Object.values(run.ranks).every(n=>n===0));
 assert.ok(Object.values(book.xp).every(x=>levelFor(x)===1&&x===0));assert.ok(Object.values(book.ranks).every(n=>n===0));
 for(const key of ['salvage','lifetimeSalvage','expeditions','hearts'])assert.equal(book[key],0);
 assert.deepEqual(book.cleared,[]);
}
test('manual reset clears every faction and every campaign phase, preserving only minted collection gains',()=>{
 for(const h of HEROES)for(const mode of ['map','event','combat','reward','result']){
  const {book,run,minted}=campaign(h.id);run.mode=mode;const before=structuredClone({book,run});
  const next=restartCampaign(book,run);freshState(next);
  assert.notEqual(next.run.id,run.id);assert.equal(next.run.heroId,h.id);assert.equal(next.run.resetReason,'abandon');
  assert.deepEqual(next.book.inventory.filter(i=>i.origin!=='starter'),book.inventory.filter(i=>i.origin!=='starter'));
  assert.equal(next.book.inventory.filter(i=>i.origin==='starter').length,10);
  assert.equal(next.book.equipped[minted.slot],minted.id);assert.deepEqual(next.run.loadout[minted.slot],minted);
  assert.deepEqual({book,run},before);
 }
});
test('fatal combat resets banked progression, cannot award XP, and cannot be settled twice',()=>{
 const {book,run}=campaign();run.hp=1;run.phoenixUsed=true;run.combat.block=0;
 run.combat.enemies[0].intent=[run.combat.hero];run.combat.enemies[0].intentDamage=1000;
 const dead=transition(run,{type:'end'});assert.equal(dead.mode,'result');assert.equal(dead.victory,false);
 const settled=settleExpedition(book,dead);assert.equal(settled.salvage,0);assert.equal(settled.xp.glitchborn,0);
 assert.equal(settleExpedition(settled,dead),settled);
 const reset=restartCampaign(settled,dead,'defeat');freshState(reset);assert.equal(reset.run.resetReason,'defeat');
});
test('lethal exploration also ends progression, while the unused medical core still revives',()=>{
 const {book}=campaign();let r=transition(preparedRun(book,'glitchborn',{weapon:'daggers',tool:'hook',charm:'phoenix'},4),{type:'begin'});
 r=transition(r,{type:'visit',id:'bridge'});r.hp=1;r.combat.block=0;r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=1000;
 // Equipped minted charm can differ; force the medical core to test revival separately.
 r.gear.charm='phoenix';const revived=transition(r,{type:'end'});assert.equal(revived.mode,'combat');assert.equal(revived.phoenixUsed,true);
 let event=transition(preparedRun(book,'glitchborn',createRun().gear,4),{type:'begin'});
 event.depth=1;event=transition(event,{type:'visit',id:'cistern'});assert.equal(event.mode,'event');
 event.hp=1;event.phoenixUsed=true;const dead=transition(event,{type:'event',choice:'wade'});
 assert.equal(dead.mode,'result');assert.equal(dead.victory,false);
 freshState(restartCampaign(settleExpedition(book,dead),dead,'defeat'));
});
test('district completion keeps mastery, credits, skills and gear until the campaign actually ends',()=>{
 const {book,run}=campaign();run.mode='result';run.victory=true;run.relic=true;run.completedDepth=5;
 const paid=settleExpedition(book,run);assert.ok(paid.salvage>book.salvage);assert.ok(paid.xp.glitchborn>book.xp.glitchborn);
 assert.ok(paid.cleared.includes(4));const next=continueClimb(paid,run);
 assert.equal(next.chapter,5);assert.deepEqual(next.talents,run.talents);assert.deepEqual(next.overclocks,run.overclocks);assert.equal(next.hp,run.hp);
});
test('final liberation resets the campaign without losing minted equipment or re-crediting the finale',()=>{
 const {book,run}=campaign();run.chapter=9;run.mode='reward';run.relic=true;run.upgradeOffer=undefined;
 const won=transition(run,{type:'extract'});assert.equal(won.victory,true);assert.equal(won.climbActive,false);
 const reset=restartCampaign(settleExpedition(book,won),won,'complete');freshState(reset);
 assert.equal(reset.run.resetReason,'complete');assert.equal(settleExpedition(reset.book,won),reset.book);
});
test('new saves survive reload after reset without restoring old progression or repeating the reset',()=>{
 const {book,run}=campaign();const reset=restartCampaign(book,run);
 const reload=migrateSave({version:6,...reset});freshState(reload);assert.equal(reload.run.resetReason,'abandon');
 assert.deepEqual(reload.book,reset.book);
 const begun=transition(reload.run,{type:'begin'});assert.equal(begun.resetReason,undefined);assert.equal(begun.chapter,1);
});
test('legacy active campaigns continue, but ended campaigns and old safehouses reset on migration',()=>{
 const {book,run}=campaign();const active=migrateSave({version:5,book,run});assert.equal(active.run.chapter,4);assert.equal(active.book.salvage,book.salvage);assert.equal(active.run.hp,run.hp);
 for(const version of [5,6]){const ended={...run,mode:'result',climbActive:false,victory:false};freshState(migrateSave({version,book,run:ended}));}
 const camp={...run,mode:'camp',climbActive:false};freshState(migrateSave({version:5,book,run:camp}));
});
