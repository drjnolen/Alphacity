import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ENEMY_ART,enemyArt} from '../src/lib/enemy-art.ts';
import {createRun,transition} from '../src/lib/game.ts';
import {emptyBook,migrateSave} from '../src/lib/progression.ts';

test('every boss and elite commander resolves unique standalone art, including existing saves',()=>{
 const names=new Set(),assets=new Set();
 for(let chapter=1;chapter<=9;chapter++)for(const id of ['gate','guardian']){
  let r=transition(createRun('glitchborn',undefined,chapter),{type:'begin'});
  r.depth=id==='guardian'?4:2;r=transition(r,{type:'visit',id});
  const commander=r.combat.enemies[0],art=enemyArt(commander);
  assert.ok(art,commander.name);names.add(commander.name);assets.add(art);
  assert.equal(enemyArt(migrateSave({version:5,run:r,book:{...emptyBook(),cleared:[1,2,3,4,5,6,7,8,9]}}).run.combat.enemies[0]),art);
 }
 assert.equal(names.size,17);assert.equal(assets.size,17);
 const hashes=new Set(Object.keys(ENEMY_ART).map(name=>{
  const bytes=readFileSync(new URL(`../public${enemyArt({name}).replace('/climb/assets','')}`,import.meta.url));
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
  return createHash('sha256').update(bytes).digest('hex');
 }));
 assert.equal(hashes.size,17);
 assert.equal(enemyArt({name:'Audit Drone'}),undefined);
});
