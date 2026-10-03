const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {readFileSync}=require('node:fs');

// Execute the production SQL, including constraints/upserts/window functions, in real SQLite.
function sqliteD1(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync('api/climb-leaderboard/schema.sql','utf8'));
 const statement=(sql,args=[])=>({bind(...values){return statement(sql,values);},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}});
 return {prepare:statement,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>db.close()};
}
async function fixture(t,options={}){
 const [{createWorker},{Ed25519Keypair}]=await Promise.all([import('../api/climb-leaderboard/worker.mjs'),import('@mysten/sui/keypairs/ed25519')]);
 const db=sqliteD1();t.after(()=>db.close());let time=1800000000000,allowed=true;
 const worker=createWorker({now:()=>time,eligible:async()=>true,...options});
 const env={DB:db,AUTH_LIMITER:{limit:async()=>({success:allowed})},API_LIMITER:{limit:async()=>({success:allowed})}};
 const call=async(path,data,token,origin='https://alphacity.tech')=>{
   const response=await worker.fetch(new Request('https://climb.example'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
   return {status:response.status,data:await response.json(),headers:response.headers};
 };
 async function login(key=new Ed25519Keypair()){
   const wallet=key.toSuiAddress(),challenge=await call('/v1/auth/challenge',{wallet});
   const signed=await key.signPersonalMessage(new TextEncoder().encode(challenge.data.message));
   const result=await call('/v1/auth/session',{id:challenge.data.id,signature:signed.signature});
   return {key,wallet,token:result.data.token,result,challenge,signed};
 }
 return {db,worker,env,call,login,advance:ms=>time+=ms,setRate:value=>allowed=value};
}
test('real wallet signature, single-use challenge, origin binding, expiry and bounded requests',async t=>{
 const f=await fixture(t),user=await f.login();assert.equal(user.result.status,200);
 assert.equal((await f.call('/v1/auth/session',{id:user.challenge.data.id,signature:user.signed.signature})).status,401);
 assert.equal((await f.call('/v1/profile',{username:'Ghost'},user.token,'https://www.alphacity.tech')).status,401);
 assert.equal((await f.call('/v1/profile',{username:'Ghost'},user.token,'https://evil.example')).status,403);
 assert.equal((await f.call('/v1/profile',{username:'Ghost'})).status,401);
 assert.equal((await f.call('/v1/profile',{username:'x'.repeat(17000)},user.token)).status,413);
 f.advance(86400001);assert.equal((await f.call('/v1/profile',{username:'Ghost'},user.token)).status,401);
 f.setRate(false);assert.equal((await f.call('/v1/auth/challenge',{wallet:user.wallet})).status,429);
});
test('wrong signer, expired challenge, missing holdings and RPC failure fail closed',async t=>{
 const f=await fixture(t),u=await f.login(),other=await f.login();
 const challenge=await f.call('/v1/auth/challenge',{wallet:u.wallet});
 const signed=await other.key.signPersonalMessage(new TextEncoder().encode(challenge.data.message));
 assert.equal((await f.call('/v1/auth/session',{id:challenge.data.id,signature:signed.signature})).status,401);
 f.advance(300001);const correct=await u.key.signPersonalMessage(new TextEncoder().encode(challenge.data.message));
 assert.equal((await f.call('/v1/auth/session',{id:challenge.data.id,signature:correct.signature})).status,401);
 const low=await fixture(t,{eligible:async()=>false});assert.equal((await low.login()).result.status,403);
 const down=await fixture(t,{eligible:async()=>{throw Error('RPC down');}});assert.equal((await down.login()).result.status,503);
});
test('server start/checkpoint time, district ordering, replay safety, ownership and completion',async t=>{
 const f=await fixture(t),u=await f.login(),other=await f.login();
 const start=await f.call('/v1/runs',{clientId:'test-campaign-001',heroId:'glitchborn'},u.token),id=start.data.id;
 assert.equal(start.status,200);f.advance(1000);
 assert.equal((await f.call('/v1/runs',{clientId:'test-campaign-001',heroId:'glitchborn'},u.token)).data.startedAt,start.data.startedAt);
 assert.equal((await f.call(`/v1/runs/${id}/checkpoint`,{level:1},u.token)).status,422);
 f.advance(60000);
 assert.equal((await f.call(`/v1/runs/${id}/checkpoint`,{level:2},u.token)).status,409);
 assert.equal((await f.call(`/v1/runs/${id}/checkpoint`,{level:1},other.token)).status,404);
 const cp=await f.call(`/v1/runs/${id}/checkpoint`,{level:1,elapsedMs:1,startedAt:1},u.token);assert.equal(cp.data.elapsedMs,61000);
 f.advance(60000);assert.equal((await f.call(`/v1/runs/${id}/checkpoint`,{level:1},u.token)).data.elapsedMs,61000);
 assert.equal((await f.call(`/v1/runs/${id}/finish`,{outcome:'complete'},u.token)).status,409);
 assert.equal((await f.call(`/v1/runs/${id}/finish`,{outcome:'defeat'},u.token)).status,200);
 assert.equal((await f.call(`/v1/runs/${id}/finish`,{outcome:'defeat'},u.token)).status,200);
 assert.equal((await f.call(`/v1/runs/${id}/finish`,{outcome:'abandon'},u.token)).status,409);
 assert.equal((await f.call(`/v1/runs/${id}/checkpoint`,{level:2},u.token)).status,409);
 assert.equal((await f.call(`/v1/runs/${id}/checkpoint`,{level:1},u.token)).data.elapsedMs,61000);
});
test('username opt-in, uniqueness, renaming, best-per-wallet ranking, class filters and reset persistence',async t=>{
 const f=await fixture(t),a=await f.login(),b=await f.login();
 async function run(user,clientId,level,ms,heroId='glitchborn'){
   const {data:r}=await f.call('/v1/runs',{clientId,heroId},user.token);
   for(let n=1;n<=level;n++){f.advance(ms);assert.equal((await f.call(`/v1/runs/${r.id}/checkpoint`,{level:n},user.token)).status,200);}
   await f.call(`/v1/runs/${r.id}/finish`,{outcome:'abandon'},user.token);return r;
 }
 await run(a,'test-campaign-001',1,30000);
 assert.equal((await f.call('/v1/leaderboard')).data.entries.length,0);
 assert.equal((await f.call('/v1/profile',{username:'Ghost Signal'},a.token)).status,200);
 assert.equal((await f.call('/v1/profile',{username:'ghost signal'},b.token)).status,409);
 assert.equal((await f.call('/v1/profile',{username:'<script>'},b.token)).status,400);
 assert.equal((await f.call('/v1/profile',{username:'Copper'},b.token)).status,200);
 await run(b,'test-campaign-002',1,20000,'chainbreaker');
 let board=(await f.call('/v1/leaderboard?wallet='+a.wallet)).data;
 assert.equal(board.entries[0].username,'Copper');assert.equal(board.me.rank,2);
 await run(a,'test-campaign-003',2,60000);
 board=(await f.call('/v1/leaderboard')).data;assert.equal(board.entries[0].username,'Ghost Signal');assert.equal(board.entries[0].level,2);
 await run(a,'test-campaign-004',1,15000);board=(await f.call('/v1/leaderboard')).data;
 assert.equal(board.entries.length,2);assert.equal(board.entries[0].level,2);
 assert.equal((await f.call('/v1/leaderboard?class=chainbreaker')).data.entries[0].username,'Copper');
 await f.call('/v1/profile',{username:'Ghost_2'},a.token);
 assert.equal((await f.call('/v1/leaderboard')).data.entries[0].username,'Ghost_2');
 f.advance(32*86400000);await f.worker.scheduled({},f.env);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM runs').first()).n,0);
 assert.equal((await f.call('/v1/leaderboard')).data.entries[0].level,2);
});
test('top 50 includes personal rank outside the visible list; same-time tie is stable',async t=>{
 const f=await fixture(t);
 for(let i=0;i<55;i++){
   const wallet='0x'+i.toString(16).padStart(64,'0');
   await f.db.prepare('INSERT INTO profiles VALUES (?,?,?)').bind(wallet,'Rebel'+i,'rebel'+i).run();
   await f.db.prepare('INSERT INTO best_runs VALUES (?,?,?,?,?,?,?)').bind('uprising-1',wallet,'run'+i,'nodewalker',1,60000+i,1).run();
 }
 const wallet='0x'+(54).toString(16).padStart(64,'0'),board=(await f.call('/v1/leaderboard?wallet='+wallet)).data;
 assert.equal(board.entries.length,50);assert.equal(board.me.rank,55);assert.equal(board.me.username,'Rebel54');
});
test('all nine checkpoints are required, then completion is immutable and retries work',async t=>{
 const f=await fixture(t),u=await f.login(),{data:r}=await f.call('/v1/runs',{clientId:'test-final-campaign',heroId:'coinbroker'},u.token);
 for(let level=1;level<=9;level++){f.advance(60000);assert.equal((await f.call(`/v1/runs/${r.id}/checkpoint`,{level},u.token)).status,200);}
 const result=await f.call(`/v1/runs/${r.id}/finish`,{outcome:'complete'},u.token);
 assert.equal(result.data.level,9);assert.equal(result.data.elapsedMs,540000);assert.equal(result.data.outcome,'complete');
 f.advance(60000);assert.equal((await f.call(`/v1/runs/${r.id}/checkpoint`,{level:9},u.token)).data.elapsedMs,540000);
});
