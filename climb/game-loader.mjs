// One shared, retryable download. Authorization still belongs to the wallet gate.
export function createGameLoader({document, importGame, timeoutMs=30000}) {
 let pending;
 function stylesheet() {
  const existing=document.getElementById('climb-game-styles');
  if(existing?.sheet)return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const link=existing||document.createElement('link');
   let timer;
   const clean=()=>{clearTimeout(timer);link.removeEventListener('load',loaded);link.removeEventListener('error',failed);};
   const loaded=()=>{clean();resolve();};
   const failed=()=>{clean();link.remove();reject(Error('Game styles could not load. Please retry.'));};
   link.addEventListener('load',loaded);link.addEventListener('error',failed);
   timer=setTimeout(failed,timeoutMs);
   if(!existing){link.id='climb-game-styles';link.rel='stylesheet';link.href='/climb/assets/game.css';document.head.append(link);}
  });
 }
 return function loadGame(){
  if(!pending)pending=Promise.all([stylesheet(),Promise.resolve().then(importGame)])
   .then(([,module])=>module).catch(error=>{pending=undefined;throw error;});
  return pending;
 };
}
