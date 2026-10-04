const {test}=require('node:test');
const assert=require('node:assert/strict');
const wallet='0x'+'a'.repeat(64),origin='https://alphacity.tech';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
async function fixture(){
 const {createLeaderboardClient}=await import('../climb/leaderboard-client.mjs');
 let current=true,signs=0,auths=0,requests=[],expired=false,rejectSign=false,wrongChallenge=false,endpoint='https://leaderboard.example';
 const s=storage();
 const fetcher=async(url,options={})=>{
   requests.push({url,...options});let data;
   if(url==='/climb/leaderboard-config.json')data={endpoint};
   else if(url.endsWith('/auth/challenge'))data={id:'challenge-123',message:`Alpha City Climb leaderboard\nOrigin: ${wrongChallenge?'https://evil.example':origin}\nWallet: ${wallet}\nNonce: challenge-123`};
   else if(url.endsWith('/auth/session')){auths++;data={token:'test-token',expiresAt:Date.now()+86400000,wallet};}
   else if(expired)return new Response(JSON.stringify({error:'Session expired'}),{status:401});
   else data={id:'server-run',level:1,entries:[]};
   return new Response(JSON.stringify(data));
 };
 const options={wallet,origin,storage:s,isCurrent:()=>current,sign:async()=>{signs++;if(rejectSign)throw Error('User declined');return {signature:'fixture-signature'};},fetcher};
 return {client:createLeaderboardClient(options),again:()=>createLeaderboardClient(options),setCurrent:v=>current=v,setExpired:v=>expired=v,setReject:v=>rejectSign=v,setWrong:v=>wrongChallenge=v,setEndpoint:v=>endpoint=v,counts:()=>({signs,auths,requests}),storage:s};
}
test('browser client reuses signed session across remounts; checkpoints never open a wallet prompt',async()=>{
 const f=await fixture();await f.client.startRun('campaign-123','glitchborn');await f.client.checkpoint('server-run',1);await f.again().startRun('campaign-456','chainbreaker');
 assert.equal(f.counts().signs,1);assert.equal(f.counts().auths,1);
 const sent=f.counts().requests.find(r=>r.url.endsWith('/checkpoint'));
 assert.deepEqual(JSON.parse(sent.body),{level:1});assert.equal(sent.headers.Authorization,'Bearer test-token');
});
test('expired session retains explicit authentication flow; rejected sign-in is retryable',async()=>{
 const f=await fixture();await f.client.authenticate();f.setExpired(true);
 await assert.rejects(f.client.checkpoint('server-run',1),/expired/);assert.equal(f.counts().signs,1);
 f.setExpired(false);f.setReject(true);await assert.rejects(f.client.authenticate(),/declined/);
 f.setReject(false);await f.client.authenticate();assert.equal(f.counts().auths,2);
});
test('wallet changes and wrong-domain challenges fail before signing or submission',async()=>{
 const f=await fixture();f.setWrong(true);await assert.rejects(f.client.authenticate(),/Invalid leaderboard/);assert.equal(f.counts().signs,0);
 f.setWrong(false);await f.client.authenticate();f.setCurrent(false);
 await assert.rejects(f.client.publish('GhostSignal'),/Wallet changed/);
});
test('missing configuration is explicitly unavailable, not a fake local leaderboard',async()=>{
 const f=await fixture();f.setEndpoint(null);assert.equal(await f.client.available(),false);
 await assert.rejects(f.client.board(),/not been connected/);assert.equal(f.counts().signs,0);
});
