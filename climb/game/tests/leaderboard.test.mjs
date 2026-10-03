import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginRecord,emptyJournal,observeRun,readJournal,formatRunTime} from '../src/lib/leaderboard.ts';
import {createRun,transition} from '../src/lib/game.ts';
import {emptyBook,restartCampaign,continueClimb,settleExpedition} from '../src/lib/progression.ts';

function start(){const run=transition(createRun(),{type:'begin'});return {run,journal:{...emptyJournal(),active:beginRecord(run,{id:'server-run',startedAt:1000},1000)}};}
test('boss clear is recorded before district settlement, carries through ascent, and death survives true reset',()=>{
 let {run,journal}=start();let won={...run,relic:true,nodeId:'guardian',mode:'reward',completedDepth:5};
 journal=observeRun(journal,run,won,undefined,61000);assert.equal(journal.active.level,1);assert.equal(journal.active.elapsedMs,60000);
 const result=transition(won,{type:'extract'}),book=settleExpedition(emptyBook(),result),next=continueClimb(book,result);
 journal=observeRun(journal,won,result,undefined,80000);assert.equal(journal.recent.length,0);assert.equal(next.chapter,2);
 const died={...next,mode:'result',climbActive:false,victory:false,hp:0};journal=observeRun(journal,next,died,undefined,120000);
 const fresh=restartCampaign(book,died,'defeat');
 assert.equal(journal.active,null);assert.equal(journal.recent[0].level,1);assert.equal(journal.recent[0].elapsedMs,60000);
 assert.equal(journal.recent[0].outcome,'defeat');assert.deepEqual(journal.recent[0].pendingLevels,[1]);
 assert.equal(fresh.run.level,1);assert.equal(fresh.run.chapter,1);assert.equal(journal.recent[0].serverId,'server-run');
});
test('manual ending before first boss still produces summary without a fabricated score',()=>{
 const {run,journal}=start(),ended=observeRun(journal,run,run,'abandon',90000);
 assert.equal(ended.recent[0].outcome,'abandon');assert.equal(ended.recent[0].level,0);assert.equal(ended.recent[0].elapsedMs,null);
 assert.equal(ended.recent[0].synced,false);
});
test('final clear captures level nine and timer before final extraction resets the campaign',()=>{
 let {run,journal}=start();run={...run,chapter:9};journal.active.level=8;
 const victory={...run,nodeId:'guardian',relic:true,mode:'reward'};journal=observeRun(journal,run,victory,undefined,601000);
 const result=transition(victory,{type:'extract'});journal=observeRun(journal,victory,result,undefined,660000);
 assert.equal(journal.recent[0].level,9);assert.equal(journal.recent[0].elapsedMs,600000);assert.equal(journal.recent[0].outcome,'complete');
});
test('legacy saves remain unranked and offline submissions survive later expeditions',()=>{
 const run={...transition(createRun(),{type:'begin'}),chapter:4};
 let journal=observeRun(emptyJournal(),run,run,'abandon');
 assert.equal(journal.recent[0].serverId,null);assert.equal(journal.recent[0].startedAt,null);assert.equal(journal.recent[0].elapsedMs,null);assert.equal(journal.recent[0].level,3);
 const first=start();let pending=observeRun(first.journal,first.run,first.run,'abandon');
 for(let i=0;i<8;i++){const r=transition(createRun(),{type:'begin'});pending={...pending,active:beginRecord(r,null)};pending=observeRun(pending,r,r,'abandon');}
 assert.ok(pending.recent.some(r=>r.serverId==='server-run'&&!r.synced));
 assert.deepEqual(readJournal(JSON.parse(JSON.stringify(pending))),pending);
});
test('corrupt journal cannot create a bogus pending level and elapsed display supports long expeditions',()=>{
 assert.deepEqual(readJournal({active:{clientId:'x',pendingLevels:['9']},recent:[{}]}),emptyJournal());
 assert.equal(formatRunTime(null),'—');assert.equal(formatRunTime(0),'00:00');assert.equal(formatRunTime(3661000),'01:01:01');assert.equal(formatRunTime(90061000),'25:01:01');
});
