import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun,transition} from '../src/lib/game.ts';
import {TALENTS,canLearn,hasClock} from '../src/lib/expedition.ts';
import {emptyBook,preparedRun,continueClimb,settleExpedition} from '../src/lib/progression.ts';
import {bestTurn} from './planner.mjs';

// Same tactical search and starter economy as the baseline campaign regression,
// now choosing a specialization, a complementary entry, and new gear actions.
for(const [i,branch] of [...new Set(TALENTS.map(t=>t.branch))].entries())test(`nine-district expedition: ${branch}`,()=>{
 const nodes=TALENTS.filter(t=>t.branch===branch),hero=nodes[0].hero,other=TALENTS.filter(t=>t.hero===hero&&t.branch!==branch),priority=[...nodes,...other];
 const oldRandom=Math.random;Math.random=()=>[.1,.3,.5,.7,.9][i%5];
 try{
  let b=emptyBook(),r=preparedRun(b,hero,createRun().gear,1),turns=0,learned=0;
  r=transition(r,{type:'begin'});
  for(let ch=1;ch<=9;ch++){
   for(const t of priority)if(canLearn(r,t.id)){r=transition(r,{type:'learnTalent',id:t.id});learned++;}
   for(const id of ['bridge','archive','gate','sanctum','guardian']){
    r=transition(r,{type:'visit',id});
    if(r.mode==='event')r=transition(r,{type:'event',choice:id==='archive'?'study':'rest'});
    let round=0;
    while(r.mode==='combat'&&round++<45){r=bestTurn(r,{builds:true});turns++;}
    assert.equal(r.mode,'reward',JSON.stringify({branch,ch,id,hp:r.hp,mode:r.mode,talents:r.talents}));
    if(id!=='guardian')r=transition(r,{type:'continue'});
   }
   if(r.upgradeOffer){const slot=r.upgradeOffer.slot,choice=!hasClock(r,slot,'active')?'active':!hasClock(r,slot,'passive')?'passive':'calibrate';r=transition(r,{type:r.salvage>=r.upgradeOffer.cost?'upgradeGear':'skipUpgrade',choice});}
   r=transition(r,{type:'extract'});b=settleExpedition(b,r);
   if(ch<9)r=continueClimb(b,r);
  }
  assert.equal(b.cleared.length,9);assert.ok(learned>=5);assert.deepEqual(r.talents,[]);assert.equal(r.climbActive,false);
  console.log(JSON.stringify({branch,turns,learned,finalHP:r.hp,credits:b.salvage}));
 }finally{Math.random=oldRandom;}
});
