import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,availableNodes,reachable,HEROES,ITEMS,same,planEnemies,ranksZero,basicRange,weaponDamage,skillDamage,enemyPortrait} from '../src/lib/game.ts';
import {CHAPTERS,nodesForChapter,eventChoices} from '../src/lib/campaign.ts';
import {emptyBook,migrateSave,preparedRun,settleExpedition,upgradeItem,upgradeCost,trainHero,earnedXP,levelFor,canEnterChapter,XP_THRESHOLDS} from '../src/lib/progression.ts';
import {district} from './planner.mjs';
const enter=(r=createRun())=>transition(transition(r,{type:'begin'}),{type:'visit',id:'bridge'});
const ranks=n=>Object.fromEntries(ITEMS.map(i=>[i.id,n]));

test('all nine lore districts finish at a boss, with an optional elite branch and safehouse',()=>{
 assert.equal(CHAPTERS.length,9);assert.equal(CHAPTERS.at(-1).name,'The Overlord’s Spire');
 for(const ch of CHAPTERS){const ns=nodesForChapter(ch.id),last=ns.filter(n=>n.depth===ch.stages);assert.equal(last.length,1);assert.equal(last[0].kind,'boss');assert.equal(last[0].name,ch.boss);const elite=ns.find(n=>n.kind==='elite');assert.ok(ns.some(n=>n.depth===elite.depth&&n.kind==='combat'));assert.ok(eventChoices(ch.id,'sanctum').some(c=>c.heal>0));}
 assert.equal(new Set(CHAPTERS.map(c=>c.boss)).size,9);
});
test('four factions have distinct passives, ranges, and signatures',()=>{
 assert.deepEqual(HEROES.map(h=>h.id),['glitchborn','chainbreaker','nodewalker','coinbroker']);
 assert.deepEqual(HEROES.map(h=>basicRange(createRun(h.id))),[1,1,3,2]);
 for(const h of HEROES){const r=enter(createRun(h.id));r.combat.hero={x:3,y:1};r.combat.enemies[1].x=5;r.combat.enemies[1].y=1;const a=transition(r,{type:'attack',id:1,skill:true});assert.notEqual(a,r);assert.equal(a.combat.ap,1);assert.equal(a.combat.cooldown,3);if(h.id==='chainbreaker')assert.equal(a.combat.block,11);if(h.id==='nodewalker')assert.equal(a.combat.enemies[1].hp,r.combat.enemies[1].hp-4);if(h.id==='coinbroker')assert.equal(a.combat.enemies[0].jammed,1);}
});
test('movement obeys occupancy, obstacles, range, action cost, and fixed intentions',()=>{
 const r=enter(),old=structuredClone(r),a=transition(r,{type:'move',position:{x:2,y:2}});assert.equal(a.combat.ap,2);assert.deepEqual(r,old);assert.deepEqual(a.combat.enemies.map(e=>e.intent),r.combat.enemies.map(e=>e.intent));assert.equal(reachable(r.combat,r.combat.hero,{x:2,y:0},5),false);assert.equal(transition(r,{type:'move',position:r.combat.enemies[0]}),r);assert.equal(transition(r,{type:'extract'}),r);
});
test('Coinbroker jamming cancels attack, movement, and nullifier effects for one enemy turn',()=>{
 const r=enter(createRun('coinbroker'));r.combat.hero={x:2,y:1};r.combat.enemies=r.combat.enemies.slice(0,1);const e=r.combat.enemies[0];e.hp=e.maxHp=60;e.intent=[{...r.combat.hero}];e.damage=e.intentDamage=20;e.advancing=true;e.role='nullifier';
 const hit=transition(r,{type:'attack',id:1,skill:true}),end=transition(hit,{type:'end'});assert.equal(end.hp,r.hp);assert.equal(end.combat.lockout,0);assert.ok(same(end.combat.enemies[0],e));assert.equal(end.combat.enemies[0].jammed,0);
});
test('nullifier attacks lock the next signature only, ordinary actions still work',()=>{
 const r=enter();r.combat.enemies=r.combat.enemies.slice(0,1);const e=r.combat.enemies[0];e.role='nullifier';e.intent=[{...r.combat.hero}];e.intentDamage=1;e.advancing=false;const end=transition(r,{type:'end'});assert.equal(end.combat.lockout,1);end.combat.hero={x:3,y:1};assert.equal(transition(end,{type:'attack',id:1,skill:true}),end);assert.notEqual(transition(end,{type:'attack',id:1}),end);end.combat.enemies[0].intent=[];const clear=transition(end,{type:'end'});assert.equal(clear.combat.lockout,0);
});
test('armor reduces strikes; signatures pierce it; corruption ticks before enemy attacks',()=>{
 const r=enter(createRun('glitchborn',{weapon:'sword',tool:'hook',charm:'phoenix'}));r.combat.hero={x:3,y:1};r.combat.firstStrike=false;r.combat.enemies[0].armor=4;const a=transition(r,{type:'attack',id:1});assert.equal(r.combat.enemies[0].hp-a.combat.enemies[0].hp,4);
 const b=transition(r,{type:'attack',id:1,skill:true});assert.equal(r.combat.enemies[0].hp-b.combat.enemies[0].hp,11);
 for(const e of r.combat.enemies){e.hp=1;e.poison=1;e.intent=[r.combat.hero];e.intentDamage=100;}const won=transition(r,{type:'end'});assert.equal(won.mode,'reward');assert.equal(won.hp,r.hp);
});
test('guard absorbs combined floor and attack damage; emergency medical restart fires once',()=>{
 const r=enter(createRun('chainbreaker',{weapon:'sword',tool:'hook',charm:'armor'}));r.combat.enemies.forEach(e=>{e.intent=[];e.advancing=false;});r.combat.enemies[0].intent=[r.combat.hero];r.combat.enemies[0].intentDamage=5;r.combat.hazards=[r.combat.hero];r.combat.hazardDamage=5;const a=transition(r,{type:'end'});assert.equal(a.hp,r.hp-1);assert.equal(a.combat.block,0);
 const v=enter();v.hp=1;v.combat.enemies[0].intent=[v.combat.hero];v.combat.enemies[0].intentDamage=100;let after=transition(v,{type:'end'});assert.equal(after.hp,14);assert.equal(after.phoenixUsed,true);after.combat.enemies[0].intent=[after.combat.hero];after.combat.enemies[0].intentDamage=100;after=transition(after,{type:'end'});assert.equal(after.mode,'result');assert.equal(after.hp,0);
});
test('elite win grants power and extra credits; boss victory unlock requires securing the district',()=>{
 let r=transition(createRun(),{type:'begin'});r.depth=2;r=transition(r,{type:'visit',id:'gate'});for(const e of r.combat.enemies){e.hp=1;e.poison=1;}r=transition(r,{type:'end'});assert.equal(r.bonusPower,1);assert.equal(r.relic,false);
 let boss=transition(createRun(),{type:'begin'});boss.depth=4;boss=transition(boss,{type:'visit',id:'guardian'});for(const e of boss.combat.enemies){e.hp=1;e.poison=1;}boss=transition(boss,{type:'end'});assert.equal(boss.relic,true);assert.equal(boss.completedDepth,5);assert.equal(settleExpedition(emptyBook(),boss).cleared.length,0);boss=transition(boss,{type:'skipUpgrade'});boss=transition(boss,{type:'extract'});const book=settleExpedition(emptyBook(),boss);assert.equal(book.cleared[0],1);assert.equal(book.xp.glitchborn,100);assert.equal(settleExpedition(book,boss),book);
});
test('Coinbroker dividends apply to rewards without inflating other factions',()=>{
 const amounts=HEROES.map(h=>{let r=transition(createRun(h.id),{type:'begin'});r.depth=1;r=transition(r,{type:'visit',id:'archive'});r=transition(r,{type:'event',choice:'salvage'});return r.salvage;});assert.equal(amounts[0],100);assert.equal(amounts[3],125);
});
test('twelve mastery levels and five shared equipment ranks cost real credits and lock during runs',()=>{
 let b=emptyBook();b.salvage=10000;for(let rank=0;rank<5;rank++){const before=b.salvage;b=upgradeItem(b,'daggers');assert.equal(b.salvage,before-upgradeCost(rank));}assert.equal(b.ranks.daggers,5);assert.equal(upgradeItem(b,'daggers'),b);assert.equal(upgradeItem(b,'armor',true),b);assert.equal(trainHero(b,'coinbroker',true),b);b.xp.coinbroker=3300;assert.equal(levelFor(b.xp.coinbroker),12);assert.equal(trainHero(b,'coinbroker'),b);
 const strong=createRun('glitchborn',undefined,9,9,ranks(5));assert.ok(weaponDamage(strong)>weaponDamage(createRun()));assert.ok(skillDamage(strong)>skillDamage(createRun()));assert.equal(XP_THRESHOLDS.length,12);
});
test('legacy saves retain credits, mastery, gear and pending earnings while starting the new story',()=>{
 const old={version:2,book:{salvage:400,xp:{vesper:240,rook:100,lyra:140},ranks:{daggers:2,hook:1},cleared:[1,2,3],hearts:3},run:{...createRun(),heroId:'vesper',mode:'combat',salvage:50,completedDepth:2}};
 const moved=migrateSave(old);assert.equal(moved.run.heroId,'glitchborn');assert.equal(moved.run.mode,'camp');assert.equal(moved.book.salvage,450);assert.equal(moved.book.xp.glitchborn,260);assert.equal(moved.book.ranks.daggers,2);assert.deepEqual(moved.book.cleared,[]);
 const reload=migrateSave({version:3,...moved});assert.equal(reload.book.salvage,450);assert.deepEqual(reload.book.xp,moved.book.xp);
});
test('current saves keep a level nine battle, jams, ranks, and unlock order',()=>{
 const book=emptyBook();book.cleared=CHAPTERS.slice(0,8).map(c=>c.id);book.ranks=ranks(5);book.xp.coinbroker=1920;const run=enter(preparedRun(book,'coinbroker',createRun().gear,9));run.combat.enemies[0].jammed=1;const saved=migrateSave({version:3,run,book});assert.equal(saved.run.chapter,9);assert.equal(saved.run.combat.enemies[0].jammed,1);assert.equal(saved.run.ranks.daggers,5);assert.equal(canEnterChapter(emptyBook(),9),false);assert.throws(()=>preparedRun(emptyBook(),'glitchborn',run.gear,9));
});
test('security formations escalate and use diverse minions with distinct art and boss patterns',()=>{
 const names=new Set(),portraits=new Set();let previous=0;
 for(const ch of CHAPTERS){let r=transition(createRun('glitchborn',undefined,ch.id),{type:'begin'});r.depth=4;r=transition(r,{type:'visit',id:'guardian'});const boss=r.combat.enemies[0];assert.ok(boss.maxHp>previous);previous=boss.maxHp;const old=boss.intent.length;boss.hp=1;planEnemies(r.combat);assert.equal(r.combat.enemies[0].phase,ch.id===9?3:2);assert.ok(r.combat.enemies[0].intent.length>0);for(const id of ['bridge','garden']){const b=transition(transition(createRun('glitchborn',undefined,ch.id),{type:'begin'}),{type:'visit',id});for(const e of b.combat.enemies){names.add(e.name);portraits.add(enemyPortrait(b,e));}}}
 assert.ok(names.size>=8);assert.ok(portraits.size>=8);
});
test('all four factions complete all nine districts at recommended progression, including elite routes',()=>{
 const failures=[];for(const ch of CHAPTERS)for(const h of HEROES){const r=district(createRun(h.id,undefined,ch.id,ch.recommendedLevel,ranks(ch.recommendedRank)),true);if(!(r.mode==='result'&&r.victory&&r.relic))failures.push({chapter:ch.id,hero:h.id,mode:r.mode,hp:r.hp,node:r.nodeId});}
 assert.deepEqual(failures,[]);console.log('36 elite-route district runs passed.');
});
test('a continuous nine-level revolution earns enough mastery and equipment funding for every faction',()=>{
 for(const h of HEROES){let b=emptyBook();for(const ch of CHAPTERS){for(const id of Object.values(createRun().gear)){while(b.ranks[id]<ch.recommendedRank){const next=upgradeItem(b,id);if(next===b)break;b=next;}}const r=district(preparedRun(b,h.id,createRun().gear,ch.id),true);assert.ok(r.victory&&r.relic,JSON.stringify({hero:h.id,chapter:ch.id,level:r.level,ranks:b.ranks,hp:r.hp,node:r.nodeId}));b=settleExpedition(b,r);}assert.equal(b.cleared.length,9);assert.ok(levelFor(b.xp[h.id])>=9);}
 console.log('Four complete campaigns passed with earned XP and purchased upgrades only.');
});

test('all 32 faction and equipment combinations can liberate the opening and final districts',()=>{
 const failures=[];for(const ch of [CHAPTERS[0],CHAPTERS[8]])for(const h of HEROES)for(const weapon of ['daggers','sword'])for(const tool of ['hook','lantern'])for(const charm of ['armor','phoenix']){const gear={weapon,tool,charm},r=district(createRun(h.id,gear,ch.id,ch.recommendedLevel,ranks(ch.recommendedRank)),true);if(!r.victory||!r.relic)failures.push({chapter:ch.id,hero:h.id,gear,node:r.nodeId,hp:r.hp});}assert.deepEqual(failures,[]);console.log('64 opening/finale loadout checks passed.');
});
test('replaying a liberated district awards resources but never inflates the district count',()=>{
 const b=emptyBook();b.cleared=[1];b.hearts=1;const r={...createRun(),mode:'result',victory:true,relic:true,completedDepth:5,salvage:100};const after=settleExpedition(b,r);assert.equal(after.hearts,1);assert.equal(after.salvage,100);assert.equal(after.xp.glitchborn,100);
});
