import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,planEnemies} from '../src/lib/game.ts';
import {planTactics,effectiveIntent,supportArmor,tacticalArmor,canDisableRelay} from '../src/lib/enemy-tactics.ts';
import {combatFeedback} from '../src/lib/combat-feedback.ts';
import {migrateSave,emptyBook} from '../src/lib/progression.ts';
function fixture(kind='assault'){
 const r=transition(transition(createRun('nodewalker'),{type:'begin'}),{type:'visit',id:'bridge'});
 const e={id:1,x:4,y:2,hp:100,maxHp:100,damage:10,type:kind==='assault'?'husk':'watcher',role:kind==='assault'?'enforcer':'sniper',poison:0,intent:[{x:1,y:2}],intentDamage:10,advancing:false,assault:kind==='assault',charger:kind==='charge'};
 r.hp=r.maxHp=200;r.combat={tactics:true,chapter:1,hero:{x:1,y:2},enemies:[e],ap:3,round:1,block:0,cooldown:0,firstStrike:false,obstacles:[],last:'',hazards:[]};
 planTactics(r.combat,e);return r;
}
test('assaults follow announced paths then strike; slowing, jamming and displacement prevent contact',()=>{
 const r=fixture(),e=r.combat.enemies[0],plan=structuredClone(e.advancePath);
 assert.deepEqual(plan,[{x:4,y:2},{x:3,y:2},{x:2,y:2}]);assert.equal(effectiveIntent(r.combat,e).length,1);
 const hit=transition(r,{type:'end'});assert.equal(hit.hp,r.hp-10);assert.deepEqual(hit.combat.travel[0].path,plan);
 for(const kind of ['slow','jam','push','sideways']){const copy=structuredClone(r),enemy=copy.combat.enemies[0];if(kind==='slow')enemy.slow=1;if(kind==='jam')enemy.jammed=1;if(kind==='push')enemy.x++;if(kind==='sideways'){enemy.x=1;enemy.y=3;}
  assert.equal(effectiveIntent(copy.combat,enemy).length,0);const after=transition(copy,{type:'end'});assert.equal(after.hp,r.hp);assert.equal(combatFeedback(copy,after,{type:'end'}).attacks.length,0);
 }
});
test('moving onto an assault path blocks movement without retargeting the locked strike',()=>{
 const r=fixture(),old=structuredClone(r.combat.enemies[0].intent);r.combat.hero={x:3,y:2};
 const after=transition(r,{type:'end'});assert.equal(after.hp,r.hp);assert.equal(after.combat.travel.length,0);assert.deepEqual(old,[{x:1,y:2}]);
});
test('charges grant a full warning turn, retain their target on release and do not repeat indefinitely',()=>{
 const r=fixture('charge');assert.equal(r.combat.enemies[0].charge.phase,'windup');assert.equal(effectiveIntent(r.combat,r.combat.enemies[0]).length,0);
 let after=transition(r,{type:'end'});assert.equal(after.hp,r.hp);assert.equal(after.combat.enemies[0].charge.phase,'release');
 const tiles=structuredClone(after.combat.enemies[0].intent);after=transition(after,{type:'move',position:{x:1,y:3}});assert.deepEqual(after.combat.enemies[0].intent,tiles);
 after=transition(after,{type:'end'});assert.equal(after.hp,r.hp);assert.equal(after.combat.enemies[0].charge,undefined);
});
test('basic damage, jam signatures, corruption and gear control interrupt charges with accurate feedback',()=>{
 for(const method of ['damage','jam','poison','snare','push']){
  let r=fixture('charge');r.combat.enemies[0].x=3;r.combat.enemies[0].charge.origin={x:3,y:2};
  if(method==='poison'){r.combat.enemies[0].hp=92;r.combat.enemies[0].poison=1;r.combat.enemies[0].charge.phase='release';r.combat.enemies[0].intent=r.combat.enemies[0].charge.tiles;const after=transition(r,{type:'end'});assert.equal(after.hp,r.hp);assert.equal(after.combat.volleys.length,0);assert.equal(combatFeedback(r,after,{type:'end'}).attacks.length,0);continue;}
  let action={type:'attack',id:1};
  if(method==='jam'){r.heroId='coinbroker';r.combat.enemies[0].charge.required=100;action.skill=true;}
  if(method==='snare'||method==='push'){const slot=method==='snare'?'tool':'weapon';r.overclocks={[slot]:['active']};r.armedClocks=[slot];action={type:'overclock',slot,id:1};r.combat.enemies[0].charge.required=100;}
  if(method==='damage'){const first=transition(r,action);assert.ok(first.combat.enemies[0].charge);r=first;}
  const after=transition(r,action);assert.notEqual(after,r);assert.equal(after.combat.enemies[0].charge,undefined,method);assert.equal(after.combat.enemies[0].interrupted,true);assert.ok(combatFeedback(r,after,action).impacts.some(i=>i.text==='INTERRUPTED'));
 }
});
test('relay armor follows live range and status, and piercing attacks bypass it',()=>{
 const r=fixture('plain'),e=r.combat.enemies[0];e.x=2;e.armor=2;
 const relay={...e,id:2,x:3,y:2,support:true,armor:0,intent:[]};r.combat.enemies.push(relay);
 assert.equal(tacticalArmor(r.combat,e),6);relay.weaken=10;assert.equal(supportArmor(r.combat,e),3);relay.weaken=25;assert.equal(supportArmor(r.combat,e),0);relay.weaken=0;relay.jammed=1;assert.equal(supportArmor(r.combat,e),0);relay.jammed=0;relay.x=6;assert.equal(supportArmor(r.combat,e),0);
 relay.x=3;const protectedHit=transition(r,{type:'attack',id:1});relay.support=false;const unprotectedHit=transition(r,{type:'attack',id:1});assert.equal(protectedHit.combat.enemies[0].hp,unprotectedHit.combat.enemies[0].hp); // Nullblades pierce.
 r.gear.weapon='sword';relay.support=true;const shielded=transition(r,{type:'attack',id:1});relay.support=false;const bare=transition(r,{type:'attack',id:1});assert.equal(shielded.combat.enemies[0].hp-bare.combat.enemies[0].hp,4);
});
test('commander enrage trades armor for damage only when the next intent is planned',()=>{
 const r=fixture('plain'),e=r.combat.enemies[0];e.commander=true;e.armor=5;planTactics(r.combat,e);e.hp=25;
 assert.equal(e.intentDamage,10);e.intentDamage=10;planTactics(r.combat,e);assert.equal(e.enrage,2);assert.equal(e.intentDamage,14);assert.equal(tacticalArmor(r.combat,e),1);
});
test('objective countdown pauses under control, summons at most one enemy, and never attacks on arrival',()=>{
 const r=fixture('plain'),e=r.combat.enemies[0];e.support=true;e.charger=false;e.objective={name:'Test relay',turns:1,triggered:false};e.jammed=1;
 let after=transition(r,{type:'end'});assert.equal(after.combat.enemies[0].objective.turns,1);after.combat.enemies[0].weaken=25;
 after=transition(after,{type:'end'});assert.equal(after.combat.enemies.length,1);after=transition(after,{type:'end'});
 assert.equal(after.combat.enemies.length,2);assert.equal(after.combat.enemies[0].objective.triggered,true);assert.equal(after.lastHits.length,0);
 after.combat.enemies[1].jammed=10;for(let n=0;n<5;n++)after=transition(after,{type:'end'});assert.equal(after.combat.enemies.length,2);
});
test('adjacent relay disable spends one AP, cancels reinforcements and rejects remote interactions',()=>{
 const r=fixture('plain'),e=r.combat.enemies[0];e.support=true;e.objective={name:'Relay',turns:1,triggered:false};assert.equal(transition(r,{type:'disableRelay',id:1}),r);
 e.x=2;r.combat.enemies.push({...e,id:2,x:6,support:false,objective:undefined});assert.equal(canDisableRelay(r.combat,e),true);const after=transition(r,{type:'disableRelay',id:1});assert.equal(after.mode,'combat');assert.equal(after.combat.ap,2);assert.equal(after.combat.enemies.length,1);assert.equal(after.combat.enemies[0].objective,undefined);assert.equal(after.salvage,r.salvage);assert.equal(transition(after,{type:'disableRelay',id:1}),after);
});
test('saved tactical warnings and countdowns survive reload; legacy battles gain no new behavior mid-fight',()=>{
 const r=fixture('charge');const reload=migrateSave({version:6,run:r,book:emptyBook()});assert.deepEqual(reload.run.combat.enemies[0].charge,r.combat.enemies[0].charge);
 const old=fixture('plain');delete old.combat.tactics;delete old.combat.enemies[0].charger;delete old.combat.enemies[0].assault;
 const restored=migrateSave({version:6,run:old,book:emptyBook()}).run;assert.equal(restored.combat.tactics,undefined);assert.equal(restored.combat.enemies[0].assault,undefined);
});

test('a blocker dying or moving cannot reveal an unannounced assault during the enemy turn',()=>{
 for(const poison of [0,1]){
  const r=fixture(),assault=r.combat.enemies[0];
  const blocker={...assault,id:2,x:3,y:2,hp:1,poison,assault:false,intent:[],advancing:true};
  r.combat.enemies=[blocker,assault];assert.equal(effectiveIntent(r.combat,assault).length,0);
  const after=transition(r,{type:'end'});assert.equal(after.hp,r.hp);assert.equal(after.combat.volleys.length,0);
 }
});

test('new encounters introduce pressure gradually without replacing original enemies',()=>{
 for(let ch=1;ch<=9;ch++)for(const id of ['bridge','gate','guardian']){
  let r=createRun('glitchborn');r.chapter=ch;r=transition(r,{type:'begin'});r.depth=id==='bridge'?0:id==='gate'?2:4;
  r=transition(r,{type:'visit',id});const c=r.combat;assert.ok(c?.tactics);
  const relay=c.enemies.find(e=>e.support);assert.equal(!!relay,ch>=3&&id!=='bridge');
  if(relay){assert.equal(relay.hp,10+ch*2);assert.equal(!!relay.objective,ch>=5);assert.equal(relay.intent.length,0);assert.ok(c.enemies.length>=4);}
  if(id==='guardian'){const boss=c.enemies.find(e=>e.type==='boss');assert.ok(boss.commander);assert.equal(!!boss.charger,ch>=4);}
 }
});
test('reload preserves assault routes and objective state without a second reinforcement wave',()=>{
 const r=fixture(),e=r.combat.enemies[0];e.support=true;e.assault=false;e.objective={name:'Relay',turns:2,triggered:false};
 let after=migrateSave({version:6,run:r,book:emptyBook()}).run;assert.deepEqual(after.combat.enemies[0].objective,e.objective);assert.deepEqual(after.combat.enemies[0].advancePath,e.advancePath);
 e.objective={name:'Relay',turns:0,triggered:true};after=migrateSave({version:6,run:r,book:emptyBook()}).run;assert.deepEqual(after.combat.enemies[0].objective,e.objective);
 for(let n=0;n<5;n++)after=transition(after,{type:'end'});assert.equal(after.combat.enemies.length,1);
});
