const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const address='0x'+'a'.repeat(64);
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const cache=()=>import('../climb/access-cache.mjs');
test('shared verification uses exact combined holdings, not Tools unlocked flag',async()=>{
 const {readAccessCache,writeAccessCache}=await cache(),s=storage();
 writeAccessCache(s,address,{liquid:2000000n*10n**9n,staked:3000000n*10n**9n,total:5000000n*10n**9n},1000);
 assert.equal(readAccessCache(s,address,1001).allowed,true);
 s.setItem('alphacity_gate_liquid','1999999999999999');
 assert.equal(readAccessCache(s,address,1001).allowed,false);
});
test('cache rejects wrong wallet, expired, future, legacy and malformed snapshots',async()=>{
 const {readAccessCache,writeAccessCache}=await cache(),s=storage();
 writeAccessCache(s,address,{liquid:5000000n*10n**9n,staked:0n,total:5000000n*10n**9n},1000);
 assert.equal(readAccessCache(s,'0x'+'b'.repeat(64),1001),null);
 assert.equal(readAccessCache(s,address,301000),null);
 assert.equal(readAccessCache(s,address,999),null);
 s.setItem('alphacity_gate_liquid','-1');assert.equal(readAccessCache(s,address,1001),null);
 s.removeItem('alphacity_gate_verified_at');assert.equal(readAccessCache(s,address,1001),null);
 assert.equal(readAccessCache({getItem(){throw Error('unavailable')}},address),null);
});
test('connected eligible session mounts automatically without RPC or signing, disconnect unmounts',async()=>{
 const {readAccessCache,writeAccessCache}=await cache(),s=storage();
 writeAccessCache(s,address,{liquid:5000000n*10n**9n,staked:0n,total:5000000n*10n**9n});
 const elements=new Map();let onChange,mounts=0,unmounts=0;
 let source=fs.readFileSync('climb/gate-source.js','utf8').replace(/^import .*;$/gm,'').replace("import('/climb/assets/game.js')","Promise.resolve(gameModule)");
 const ctx={readAccessCache,writeAccessCache,sessionStorage:s,formatCity:String,queueMicrotask,setInterval(){},document:{getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id)},addEventListener(){}},window:{addEventListener(){},AlphaCitySui:{},AlphaCityWalletConnector:{create(options){onChange=options.onChange;return {}}}},gameModule:{mountGame(){mounts++;return ()=>unmounts++}}};
 vm.runInNewContext(source,ctx);onChange({address});await new Promise(r=>setImmediate(r));
 assert.equal(mounts,1);assert.equal(elements.get('climb-game').hidden,false);
 onChange(null);assert.equal(unmounts,1);assert.equal(elements.get('climb-game').hidden,true);
});
