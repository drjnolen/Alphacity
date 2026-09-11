import { arenaFor, combatArena } from '../src/lib/district-arenas.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_COLUMNS, BOARD_ROWS, CELLS, boardCells, hasTile, ISO, connected, elevation, route, terrainCell, terrainForChapter, projectCell, surfaceCorners } from '../src/lib/battlefield.ts';
import { createRun, transition, same, planEnemies, canAttack } from '../src/lib/game.ts';
import { combatFeedback, movementPath } from '../src/lib/combat-feedback.ts';
import { migrateSave, emptyBook } from '../src/lib/progression.ts';

const enter = (chapter=1, hero='glitchborn') => transition(transition(createRun(hero,undefined,chapter),{type:'begin'}),{type:'visit',id:'bridge'});

test('every open tile in all district and boss terrains is connected through real stairs',()=>{
  for(let chapter=1;chapter<=9;chapter++) for(const encounter of ['bridge','garden','gate','guardian']) {
    let r=transition(createRun('glitchborn',undefined,chapter),{type:'begin'});
    r.depth=encounter==='guardian'?4:encounter==='gate'?2:0;
    r=transition(r,{type:'visit',id:encounter});
    const c=r.combat;c.enemies=[];
    assert.ok(['terraces','concourse','gantry','flat'].includes(c.terrain));
    assert.ok(c.terrain==='flat'||CELLS.some(p=>terrainCell(c.terrain,p).stair));
    for(const p of boardCells(c).filter(p=>!c.obstacles.some(o=>same(o,p)))) {
      const path=route(c,c.hero,p);
      assert.ok(path.length,`${chapter}/${encounter}: disconnected ${p.x},${p.y}`);
      for(let i=1;i<path.length;i++) assert.ok(connected(c,path[i-1],path[i])||(combatArena(c)?.transit&&[path[i-1],path[i]].every(p=>combatArena(c).props.some(t=>same(t,p)))));
    }
  }
});

test('stairs support ascent and descent while cliffs and sideways stair entries block movement',()=>{
  const r=enter(),c=r.combat;delete c.layout;delete c.arena;c.enemies=[];c.obstacles=[];c.hero={x:2,y:2};
  assert.equal(connected(c,c.hero,{x:3,y:2}),false);
  assert.equal(connected(c,{x:2,y:1},{x:2,y:2}),false);
  assert.equal(transition(r,{type:'move',position:{x:3,y:2}}),r);
  c.hero={x:1,y:1};
  const up=transition(r,{type:'move',position:{x:3,y:1}});
  assert.equal(up.combat.ap,2);assert.equal(elevation(up.combat,up.combat.hero),1);
  assert.deepEqual(movementPath(c,{x:3,y:1}),[{x:1,y:1},{x:2,y:1},{x:3,y:1}]);
  const down=transition(up,{type:'move',position:{x:1,y:1}});
  assert.equal(elevation(down.combat,down.combat.hero),0);
  c.obstacles=[{x:2,y:1},{x:2,y:3},{x:2,y:5}];
  assert.deepEqual(route(c,c.hero,{x:3,y:1}),[]);
});

test('melee cannot attack through a ledge, ranged fire crosses floors, and Ghost Step finds a valid landing',()=>{
  const r=enter(),c=r.combat;c.obstacles=[];c.hero={x:2,y:2};c.enemies=c.enemies.slice(0,1);
  const e=c.enemies[0];e.x=3;e.y=2;e.hp=e.maxHp=60;
  assert.equal(canAttack(r,e),false);assert.equal(transition(r,{type:'attack',id:e.id}),r);
  const blink=transition(r,{type:'attack',id:e.id,skill:true});
  assert.notEqual(blink,r);assert.ok(connected(blink.combat,blink.combat.hero,e));
  const ranged=structuredClone(r);ranged.heroId='nodewalker';
  assert.equal(canAttack(ranged,ranged.combat.enemies[0]),true);
  assert.notEqual(transition(ranged,{type:'attack',id:e.id}),ranged);
});

test('enemy pursuit routes around ledges and combat feedback reuses the exact traversed steps',()=>{
  const r=enter(),c=r.combat;c.obstacles=[];c.enemies=c.enemies.slice(0,1);
  const e=c.enemies[0];e.x=4;e.y=1;e.type='husk';e.role='enforcer';e.poison=0;
  planEnemies(c);assert.equal(c.enemies[0].advancing,true);
  const next=transition(r,{type:'end'}),cue=combatFeedback(r,next,{type:'end'}),travel=next.combat.travel[0];
  assert.ok(travel.path.length>1&&travel.path.length<=3);
  for(let i=1;i<travel.path.length;i++) assert.ok(connected(c,travel.path[i-1],travel.path[i]));
  assert.deepEqual(cue.movements[0].path,travel.path);
  assert.ok(same(travel.path.at(-1),next.combat.enemies[0]));
  assert.ok(!same(next.combat.hero,next.combat.enemies[0]));
});

test('terrain, figures and projected stair hit surfaces remain within the scene bounds',()=>{
  for(let chapter=1;chapter<=9;chapter++) {
    const c=enter(chapter).combat;
    for(const p of boardCells(c)) {
      const cell=terrainCell(c.terrain,p),center=projectCell(c,p);
      assert.ok(center.x-58>0&&center.x+58<ISO.width);
      assert.ok(center.y-180>0,`headroom ${chapter}/${p.x},${p.y}`);
      for(const q of surfaceCorners(cell,0)) assert.ok(q.x>0&&q.x<ISO.width&&q.y>0&&q.y<ISO.height);
      if(cell.stair) assert.notDeepEqual(surfaceCorners(cell),surfaceCorners({...cell,stair:undefined}));
    }
  }
});

test('existing saves keep their active battle topology; new encounters gain elevation',()=>{
  const r=enter();delete r.combat.terrain;delete r.combat.layout;delete r.combat.arena;
  const old=structuredClone(r),book=emptyBook(),restored=migrateSave({version:3,run:r,book});
  assert.deepEqual(restored.run.combat,old.combat);
  assert.equal(elevation(restored.run.combat,{x:5,y:0}),0);
  for(const e of restored.run.combat.enemies){e.hp=1;e.poison=1;}
  let next=transition(restored.run,{type:'end'});next=transition(next,{type:'continue'});
  next=transition(next,{type:'visit',id:'archive'});next=transition(next,{type:'event',choice:'study'});
  next=transition(next,{type:'continue'});next=transition(next,{type:'visit',id:'gate'});
  assert.ok(next.combat.arena);
  const reload=migrateSave({version:3,run:next,book});assert.equal(reload.run.combat.terrain,next.combat.terrain);
});

test('non-grid coordinates and occupied stair tiles cannot be entered',()=>{
  const r=enter();
  for(const position of [{x:1.5,y:2},{x:-1,y:2},{x:BOARD_COLUMNS,y:2},{x:0,y:BOARD_ROWS},{x:NaN,y:2}])assert.equal(transition(r,{type:'move',position}),r);
  r.combat.hero={x:1,y:1};r.combat.enemies[0].x=2;r.combat.enemies[0].y=1;
  assert.equal(transition(r,{type:'move',position:{x:3,y:1}}),r);
});

 test('the advance runs up and right in every terrain layout',()=>{
 for(let chapter=1;chapter<=9;chapter++){const c=enter(chapter).combat, start=projectCell(c,c.hero),destination=projectCell(c,{x:5,y:2});assert.ok(destination.x>start.x);assert.ok(destination.y<start.y);}
 });

test('battlefields expose 54 labeled cells through column I and row 6',()=>{assert.equal(CELLS.length,54);assert.deepEqual(CELLS.at(-1),{x:8,y:5});});

test('security warnings cover the outer rows and columns of the expanded board',()=>{
 const r=enter(),c=r.combat;delete c.layout;delete c.arena;c.hero={x:8,y:5};c.round=2;c.enemies=c.enemies.slice(0,1);c.enemies[0].type='boss';c.obstacles=[];planEnemies(c);
 assert.equal(new Set(c.enemies[0].intent.filter(p=>p.y===5).map(p=>p.x)).size,9);
 assert.equal(new Set(c.enemies[0].intent.filter(p=>p.x===8).map(p=>p.y)).size,6);
 const h=enter(2).combat,columns=new Set();delete h.layout;delete h.arena;h.obstacles=[];for(let round=1;round<=9;round++){h.round=round;planEnemies(h);assert.equal(h.hazards.length,6);h.hazards.forEach(p=>columns.add(p.x));}assert.equal(columns.size,9);
});


test('district footprints are distinct, omit void, and retain their environmental props',()=>{
 const signatures=new Set();for(let ch=1;ch<=9;ch++){const r=enter(ch),c=r.combat,a=combatArena(c),cells=boardCells(c);signatures.add(JSON.stringify(cells));assert.ok(cells.length<54);assert.ok(a.feature&&a.description);for(const p of a.props){assert.ok(hasTile(c,p));assert.equal(c.obstacles.some(o=>same(o,p)),a.solid);}for(const e of c.enemies){assert.ok(hasTile(c,e));assert.ok(!c.obstacles.some(o=>same(o,e)));}const voidTile=CELLS.find(p=>!hasTile(c,p));assert.equal(transition(r,{type:'move',position:voidTile}),r);assert.ok(c.enemies.every(e=>e.intent.every(p=>hasTile(c,p))));}assert.equal(signatures.size,9);
});

test('tunnels and elevators connect their paired endpoints and respect occupied exits',()=>{
 for(const ch of [1,9]){const r=enter(ch),c=r.combat,[a,b]=combatArena(c).props;c.hero={...a};c.enemies=c.enemies.filter(e=>!same(e,b));const moved=transition(r,{type:'move',position:b});assert.notEqual(moved,r);assert.equal(moved.combat.ap,c.ap-1);assert.ok(same(moved.combat.hero,b));assert.deepEqual(movementPath(c,b),[a,b]);c.enemies[0].x=b.x;c.enemies[0].y=b.y;assert.equal(transition(r,{type:'move',position:b}),r);}
});

test('lava and runoff apply advertised damage and actual damage feedback',()=>{
 for(const ch of [3,6]){const r=enter(ch),c=r.combat,a=combatArena(c);c.hero={...a.props[0]};c.hazards=[];c.enemies.forEach(e=>{e.intent=[];e.advancing=false;});c.block=0;const next=transition(r,{type:'end'});assert.equal(r.hp-next.hp,a.damage);const cue=combatFeedback(r,next,{type:'end'});assert.ok(cue.impacts.some(h=>h.text===`−${a.damage}`));assert.ok(cue.hazards.some(p=>same(p,c.hero)));}
});

test('kiosk cover and relay signal give their promised positional advantages',()=>{
 const r=enter(2),c=r.combat;c.hero={x:3,y:4};c.block=0;c.hazards=[];c.enemies.forEach(e=>{e.intent=[];e.advancing=false;});c.enemies[0].intent=[c.hero];c.enemies[0].intentDamage=5;const next=transition(r,{type:'end'});assert.equal(r.hp-next.hp,2);assert.ok(combatFeedback(r,next,{type:'end'}).impacts.some(h=>h.text==='3 BLOCKED'));
 const relay=enter(4);relay.combat.hero={x:2,y:0};relay.combat.cooldown=3;relay.combat.enemies.forEach(e=>{e.intent=[];e.advancing=false;});relay.combat.hazards=[];assert.equal(transition(relay,{type:'end'}).combat.cooldown,1);
});

test('starting patrols demand more than the old two-enemy opening and punish idle turns',()=>{
 const r=enter();assert.equal(r.combat.enemies.length,3);assert.ok(r.combat.enemies.every(e=>e.damage>=7&&e.maxHp>=18));assert.equal(r.supplies,2);let idle=r;for(let i=0;i<25&&idle.mode==='combat';i++)idle=transition(idle,{type:'end'});assert.equal(idle.mode,'result');assert.equal(idle.victory,false);
});
