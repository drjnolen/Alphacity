import {useEffect,useRef,useState} from 'react';
import type {Run} from '@/lib/game';
import {beginRecord,emptyJournal,observeRun,readJournal,type RunJournal,type RunOutcome,type LeaderboardClient} from '@/lib/leaderboard';

export function useLeaderboard(saveKey:string, client?:LeaderboardClient) {
  const key=saveKey+':leaderboard';
  const [journal,setJournal]=useState<RunJournal>(emptyJournal),journalRef=useRef(journal);
  const [open,setOpen]=useState(false),[resultId,setResultId]=useState<string|null>(null);
  const [error,setError]=useState(''),[storageError,setStorageError]=useState(''),[syncing,setSyncing]=useState(false);
  const [starting,setStarting]=useState(false),[startError,setStartError]=useState('');
  const alive=useRef(true),flight=useRef<Promise<void>|null>(null);
  function persist(value:RunJournal) {
    journalRef.current=value;
    if (!alive.current) return;
    setJournal(value);
    try {localStorage.setItem(key,JSON.stringify(value));setStorageError('');}
    catch {setStorageError('This browser could not save your pending results. Keep this page open until they sync.');}
  }
  // Patch only the acknowledged fields of a record: another boss or end-of-run may arrive during a request.
  function patch(id:string, update:(r:NonNullable<RunJournal['active']>)=>NonNullable<RunJournal['active']>) {
    const current=journalRef.current;
    persist({active:current.active?.clientId===id?update(current.active):current.active,recent:current.recent.map(r=>r.clientId===id?update(r):r)});
  }
  async function flush() {
    if (!client) return;
    if (flight.current) return flight.current;
    const work=(async()=>{
      if(alive.current){setSyncing(true);setError('');}
      const failed=new Set<string>();let firstError:unknown;
      try {
        while(alive.current) {
          const j=journalRef.current;
          const record=[...j.recent,...(j.active?[j.active]:[])].find(r=>r.serverId&&!failed.has(r.clientId)&&(r.pendingLevels.length||r.outcome&&!r.synced));
          if(!record)break;
          try {
          if(record.pendingLevels.length) {
            const level=record.pendingLevels[0],response=await client.checkpoint(record.serverId!,level);
            if(!alive.current)return;
            patch(record.clientId,r=>({...r,pendingLevels:r.pendingLevels.filter(l=>l>response.level),elapsedMs:r.level===response.level?response.elapsedMs:r.elapsedMs}));
          } else if(record.outcome) {
            const response=await client.finish(record.serverId!,record.outcome);
            if(!alive.current)return;
            patch(record.clientId,r=>({...r,synced:true,elapsedMs:response.level?response.elapsedMs:r.elapsedMs}));
          }
          } catch(e) {failed.add(record.clientId);firstError??=e;}
        }
        if(firstError)throw firstError;
      } catch(e) {if(alive.current)setError(e instanceof Error?e.message:'Results are waiting to sync.');throw e;}
      finally {if(alive.current)setSyncing(false);}
    })();
    flight.current=work;
    try{await work;}finally{flight.current=null;}
  }
  useEffect(()=>{
    alive.current=true;
    try{const value=readJournal(JSON.parse(localStorage.getItem(key)||'null'));journalRef.current=value;setJournal(value);
      if(value.recent[0]&&!value.recent[0].seen){setResultId(value.recent[0].clientId);setOpen(true);}
    }catch{}
    void flush().catch(()=>{});
    const retry=()=>{void flush().catch(()=>{});};window.addEventListener('online',retry);
    return()=>{alive.current=false;window.removeEventListener('online',retry);};
  },[key]);
  async function begin(run:Run, unranked=false):Promise<boolean> {
    setStarting(true);setStartError('');
    try {
      const server=!unranked&&run.chapter===1&&client&&await client.available()?await client.startRun(run.climbId??run.id,run.heroId):null;
      if(!alive.current)return false;
      persist({...journalRef.current,active:beginRecord(run,server)});return true;
    }catch(e){if(alive.current)setStartError(e instanceof Error?e.message:'Ranked play is unavailable.');return false;}
    finally{if(alive.current)setStarting(false);}
  }
  function observe(before:Run,next:Run,manual?:RunOutcome) {
    const previous=journalRef.current,updated=observeRun(previous,before,next,manual);
    if(updated===previous)return;
    persist(updated);
    if(updated.recent[0]&&updated.recent[0].clientId!==previous.recent[0]?.clientId){setResultId(updated.recent[0].clientId);setOpen(true);}
    void flush().catch(()=>{});
  }
  function show(){setResultId(journalRef.current.recent[0]?.clientId??null);setOpen(true);}
  function changeOpen(value:boolean){setOpen(value);if(!value&&resultId)patch(resultId,r=>({...r,seen:true}));}
  async function submit(username:string) {
    if(!client)throw Error('The leaderboard service is unavailable.');
    await client.authenticate();await flush().catch(()=>{});await client.publish(username);
  }
  return {journal,open,changeOpen,show,result:journal.recent.find(r=>r.clientId===resultId)??null,
    starting,startError,begin,observe,submit,syncing,error:storageError||error,client};
}
