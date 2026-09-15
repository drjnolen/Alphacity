import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition,planEnemies,guardAmount} from '../src/lib/game.ts';
import {emptyBook,migrateSave} from '../src/lib/progression.ts';
import {enemyDamage} from '../src/lib/equipment.ts';

function enter(ch=1,id='bridge'){
 let r=transition(createRun('glitchborn',undefined,ch,ch),{type:'begin'});
 r.depth=id==='guardian'?4:['gate','detour'].includes(id)?2:0;
 return transition(r,{type:'visit',id});
}

test('every district raises patrol, elite and boss damage without inflating enemy health',()=>{
 let previous=0;
 for(let ch=1;ch<=9;ch++){
  const patrol=enter(ch),elite=enter(ch,'gate'),boss=enter(ch,'guardian');
  const base=Math.min(...patrol.combat.enemies.map(e=>e.damage));
  assert.ok(base>previous);previous=base;
  for(const r of [patrol,enter(ch,'garden'),elite,enter(ch,'detour'),boss]){
   for(const [i,e] of r.combat.enemies.entries()){
    if(e.support){assert.equal(e.intent.length,0);continue;}
    const commander=r.nodeId==='gate'&&i===0,isBoss=e.type==='boss';
    const old=6+ch+(isBoss?5:commander?3:e.role==='sniper'?2:0);
    assert.ok(e.damage>=Math.ceil(old*1.3),`${ch}/${r.nodeId}/${e.name}: ${e.damage}`);
    if(ch>=7)assert.ok(e.damage>=old*1.8);
    assert.equal(e.maxHp,(isBoss?54+ch*12:17+ch*4+(commander?10:0)-(i?3:0))+r.danger*3);
   }
  }
  assert.ok(elite.combat.enemies[0].damage>base);
  const c=boss.combat,e=c.enemies[0],phaseOne=e.intentDamage;
  e.hp=Math.floor(e.maxHp*.25);planEnemies(c);
  assert.ok(c.enemies[0].intentDamage>phaseOne,`district ${ch} phase escalation`);
 }
});

test('higher incoming hits still reward guard, suppression and leaving the telegraph in every district',()=>{
 for(let ch=1;ch<=9;ch++){
  const r=enter(ch),c=r.combat;
  // Isolate one real district enemy's damage from scenery and other attackers.
  c.arena=undefined;c.terrain=undefined;c.layout=undefined;c.hazards=[];c.obstacles=[];
  c.hero={x:0,y:2};c.block=0;c.enemies=c.enemies.slice(0,1);
  const e=c.enemies[0];e.assault=false;e.charger=false;delete e.charge;e.x=1;e.y=2;e.intent=[{...c.hero}];e.advancing=false;
  const hit=transition(r,{type:'end'});assert.equal(r.hp-hit.hp,enemyDamage(e));
  const braced=transition(transition(r,{type:'guard'}),{type:'end'});
  assert.equal(r.hp-braced.hp,Math.max(0,enemyDamage(e)-guardAmount(r)));
  const suppressed=structuredClone(r);suppressed.combat.enemies[0].weaken=40;
  assert.equal(r.hp-transition(suppressed,{type:'end'}).hp,Math.ceil(enemyDamage(e)*.6));
  const moved=transition(r,{type:'move',position:{x:0,y:3}});
  assert.notEqual(moved,r);assert.deepEqual(moved.combat.enemies[0].intent,e.intent);
  assert.equal(transition(moved,{type:'end'}).hp,r.hp);
 }
});

test('ignoring enemy intentions is lethal in every district with district-matched mastery',()=>{
 for(let ch=1;ch<=9;ch++){
  let r=enter(ch);let rounds=0;
  while(r.mode==='combat'&&rounds++<20)r=transition(r,{type:'end'});
  assert.equal(r.mode,'result',`district ${ch}`);assert.equal(r.victory,false);
 }
});

test('loading a battle preserves announced damage; the next encounter uses the new curve',()=>{
 const r=enter();for(const e of r.combat.enemies){e.damage=7;e.intentDamage=7;}
 const loaded=migrateSave({version:5,run:r,book:emptyBook()}).run;
 assert.deepEqual(loaded.combat.enemies.map(e=>[e.damage,e.intentDamage]),r.combat.enemies.map(e=>[e.damage,e.intentDamage]));
 loaded.mode='map';loaded.depth=2;loaded.nodeId='archive';loaded.combat=undefined;
 const next=transition(loaded,{type:'visit',id:'detour'});
 assert.equal(next.mode,'combat');assert.ok(next.combat.enemies.every(e=>e.damage>=10));
});
