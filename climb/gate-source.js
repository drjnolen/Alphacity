import {verifyPersonalMessageSignature} from '@mysten/sui/verify';
import {readAccessCache,writeAccessCache} from './access-cache.mjs';
import {fetchEligibility,formatCity} from './eligibility.mjs';
const el=id=>document.getElementById(id),panel=el('climb-gate'),game=el('climb-game'),status=el('access-status'),verify=el('verify-access');
let wallet=null,epoch=0,authorized=null,unmount=null,checking=false,connector;
function lock(message){authorized=null;if(unmount){unmount();unmount=null;}game.hidden=true;panel.hidden=false;status.textContent=message;}
function balanceText(b){el('liquid-city').textContent=formatCity(b.liquid);el('staked-city').textContent=formatCity(b.staked);}
async function balances(address){return fetchEligibility((method,params)=>Promise.race([window.AlphaCitySui.rpc(method,params),new Promise((_,reject)=>setTimeout(()=>reject(Error('Balance check timed out. Please retry.')),15000))]),address);}
function cached(address){try{return readAccessCache(sessionStorage,address);}catch{return null;}}
function remember(address,result){try{writeAccessCache(sessionStorage,address,result);}catch{}}
async function enter(){
 const address=wallet?.address,requestEpoch=epoch;if(!address||checking)return;
 checking=true;verify.disabled=true;status.textContent='Checking liquid and staked CITY…';
 try{
  const saved=cached(address);
  const result=saved?.allowed?saved:await balances(address);if(requestEpoch!==epoch)return;balanceText(result);
  if(!result.allowed){lock('At least 5,000,000 CITY held or staked is required.');return;}
  if(!saved?.allowed){
  status.textContent='Confirm wallet ownership. Sign the access message in your wallet; no transaction or fee.';
  const message=new TextEncoder().encode('Alpha City Climb access\nOrigin: '+location.origin+'\nWallet: '+address+'\nNonce: '+crypto.randomUUID()+'\nIssued: '+new Date().toISOString());
  const signed=await connector.signPersonalMessage(message);
  await verifyPersonalMessageSignature(message,signed.signature,{address,client:window.AlphaCitySui.grpcClient});
  if(requestEpoch!==epoch||connector.getSession()?.address!==address)return;
  // Recheck after the wallet prompt in case it was left open for a long time.
  const confirmed=await balances(address);if(requestEpoch!==epoch)return;
  balanceText(confirmed);if(!confirmed.allowed){lock('Your CITY balance is below the access requirement.');return;}
  remember(address,confirmed);
  }
  status.textContent='Loading your climb…';
  const module=await import('/climb/assets/game.js');if(requestEpoch!==epoch)return;
  if(unmount)unmount();unmount=module.mountGame(game,address);authorized=address;panel.hidden=true;game.hidden=false;
  el('membership-status').textContent='5M CITY access verified';
 }catch(error){if(requestEpoch===epoch)lock(error.message||'Access could not be verified. Please retry.');}
 finally{if(requestEpoch===epoch){checking=false;verify.disabled=!wallet;}}
}
async function refresh(){
 if(!authorized||checking||document.hidden||cached(authorized)?.allowed)return;
 const address=authorized,requestEpoch=epoch;checking=true;
 try{const result=await balances(address);if(requestEpoch!==epoch)return;balanceText(result);remember(address,result);if(!result.allowed)lock('Your balance is now below 5,000,000 CITY. Restore your balance and verify to resume.');}
 catch{if(requestEpoch===epoch){try{sessionStorage.removeItem('alphacity_gate_verified_at');}catch{}lock('CITY access could not be rechecked. Verify again to resume your saved climb.');}}
 finally{if(requestEpoch===epoch){checking=false;verify.disabled=!wallet;}}
}
try{
 if(!window.AlphaCityWalletConnector||!window.AlphaCitySui)throw Error('Wallet services failed to load. Refresh to retry.');
 connector=window.AlphaCityWalletConnector.create({button:el('connect-wallet'),requirePersonalMessage:true,onChange(session){epoch++;wallet=session;checking=false;lock(session?'Wallet connected. Verify access to begin.':'Connect your Sui wallet to play.');verify.disabled=!session;el('membership-status').textContent='5,000,000 CITY required';el('liquid-city').textContent='—';el('staked-city').textContent='—';if(session&&cached(session.address)?.allowed)queueMicrotask(enter);}});
 verify.addEventListener('click',enter);setInterval(refresh,60000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}catch(error){lock(error.message);verify.disabled=true;}
