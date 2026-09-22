const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
const tick=()=>new Promise(r=>setImmediate(r));
function documentStub(){
 const links=[];
 return {links,getElementById:id=>links.find(l=>l.id===id),createElement(){
  const events=new Map();return {addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),fire:n=>events.get(n)?.(),remove(){links.splice(links.indexOf(this),1);}};
 },head:{append:link=>links.push(link)}};
}
test('game code and CSS load together, mount readiness waits for both, repeated entry reuses downloads',async()=>{
 const {createGameLoader}=await import('../climb/game-loader.mjs'),document=documentStub();let imports=0;
 const module={mountGame(){}};
 const load=createGameLoader({document,importGame:async()=>{imports++;return module;}});
 const first=load();assert.equal(load(),first);await tick();assert.equal(imports,1);assert.equal(document.links.length,1);
 let ready=false;first.then(()=>ready=true);await tick();assert.equal(ready,false);
 document.links[0].sheet={};document.links[0].fire('load');assert.equal(await first,module);assert.equal(await load(),module);assert.equal(imports,1);
});
test('failed or stalled CSS gives a retryable error instead of opening an unstyled game',async()=>{
 const {createGameLoader}=await import('../climb/game-loader.mjs'),document=documentStub();
 const load=createGameLoader({document,importGame:async()=>({}),timeoutMs:20});
 const first=load(),failure=assert.rejects(first,/styles could not load/);document.links[0].fire('error');await failure;assert.equal(document.links.length,0);
 await assert.rejects(load(),/styles could not load/);assert.equal(document.links.length,0);
 const retry=load();document.links[0].sheet={};document.links[0].fire('load');await retry;
});
test('liquid and stake reads overlap while all stake pages remain mandatory',async()=>{
 const {fetchEligibility,REQUIRED_CITY}=await import('../climb/eligibility.mjs');let release,stakes=0;
 const pending=fetchEligibility(async method=>method==='suix_getBalance'?new Promise(r=>release=r):(stakes++,{data:[],hasNextPage:false}),'0x'+'a'.repeat(64));
 assert.equal(stakes,1);release({totalBalance:String(REQUIRED_CITY)});assert.equal((await pending).allowed,true);
});
test('disconnect while cached-access assets load never mounts the previous wallet game',async()=>{
 const {readAccessCache,writeAccessCache}=await import('../climb/access-cache.mjs');const map=new Map(),sessionStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)},address='0x'+'a'.repeat(64);
 writeAccessCache(sessionStorage,address,{liquid:5000000n*10n**9n,staked:0n,total:5000000n*10n**9n});let onChange,finish,mounts=0;
 const source=fs.readFileSync('climb/gate-source.js','utf8').replace(/^import .*;$/gm,'');
 const elements=new Map(),ctx={readAccessCache,writeAccessCache,sessionStorage,queueMicrotask,setInterval(){},formatCity:String,
  createGameLoader:()=>()=>new Promise(r=>finish=r),document:{getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id);},addEventListener(){}},
  window:{addEventListener(){},AlphaCitySui:{},AlphaCityWalletConnector:{create(o){onChange=o.onChange;return {};}}}};
 vm.runInNewContext(source,ctx);onChange({address});await tick();onChange(null);finish({mountGame(){mounts++;}});await tick();assert.equal(mounts,0);assert.equal(elements.get('climb-game').hidden,true);
});
test('all optimized art matches its manifest and materially reduces transfer without changing dimensions',()=>{
 const root='climb/game/public/art/',manifest=JSON.parse(fs.readFileSync(root+'optimized-manifest.json','utf8'));
 assert.equal(manifest.assets.length,33);let before=0,after=0;
 for(const a of manifest.assets){
  const png=fs.readFileSync(root+a.source),webp=fs.readFileSync(root+a.runtime);
  assert.equal(createHash('sha256').update(png).digest('hex'),a.sourceSha256);assert.equal(createHash('sha256').update(webp).digest('hex'),a.runtimeSha256);
  assert.equal(png.readUInt32BE(16),a.width);assert.equal(png.readUInt32BE(20),a.height);
  assert.equal(webp.subarray(0,4).toString(),'RIFF');assert.equal(webp.subarray(8,12).toString(),'WEBP');
  // Extended WebP header records the unchanged canvas, including alpha sprites.
  if(webp.subarray(12,16).toString()==='VP8X'){assert.equal(webp.readUIntLE(24,3)+1,a.width);assert.equal(webp.readUIntLE(27,3)+1,a.height);}
  else{assert.equal(webp.subarray(12,16).toString(),'VP8 ');assert.equal(webp.readUInt16LE(26)&0x3fff,a.width);assert.equal(webp.readUInt16LE(28)&0x3fff,a.height);}
  before+=png.length;after+=webp.length;
 }
 assert.ok(after<before*.3,`${before} -> ${after}`);
});

test('prefetched assets cannot open a fresh session before ownership and the final balance check',async()=>{
 const address='0x'+'a'.repeat(64),elements=new Map();let onChange,sign,loads=0,mounts=0,reads=0,verified=0;
 const source=fs.readFileSync('climb/gate-source.js','utf8').replace(/^import .*;$/gm,'');
 const ctx={TextEncoder,crypto:{randomUUID:()=> 'test-nonce'},location:{origin:'https://alphacity.tech'},queueMicrotask,setInterval(){},sessionStorage:{},
  readAccessCache:()=>null,writeAccessCache(){},formatCity:String,fetchEligibility:async()=>{reads++;return {allowed:true,liquid:5000000n,staked:0n};},
  verifyPersonalMessageSignature:async()=>{verified++;},createGameLoader:()=>async()=>{loads++;return {mountGame(){mounts++;return ()=>{};}};},
  document:{getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(_,fn){this.click=fn;}});return elements.get(id);},addEventListener(){}},
  window:{addEventListener(){},AlphaCitySui:{},AlphaCityWalletConnector:{create(o){onChange=o.onChange;return {getSession:()=>({address}),signPersonalMessage:()=>new Promise(r=>sign=r)};}}}};
 vm.runInNewContext(source,ctx);onChange({address});const entering=elements.get('verify-access').click();await tick();
 assert.equal(loads,1);assert.equal(reads,1);assert.equal(mounts,0);assert.equal(verified,0);
 sign({signature:'test-signature'});await entering;assert.equal(verified,1);assert.equal(reads,2);assert.equal(mounts,1);
});
