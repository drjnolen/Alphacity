import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Clock3,LoaderCircle,RefreshCw,ShieldCheck,Trophy} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {HEROES} from '@/lib/game';
import {CHAPTERS} from '@/lib/campaign';
import {formatRunTime,type LeaderboardData,type LeaderboardEntry} from '@/lib/leaderboard';
import type {useLeaderboard} from './use-leaderboard';
import './leaderboard.css';

export function LeaderboardDialog({board}:{board:ReturnType<typeof useLeaderboard>}) {
  const [data,setData]=useState<LeaderboardData|null>(null),[filter,setFilter]=useState('all');
  const [loading,setLoading]=useState(false),[failure,setFailure]=useState(''),[username,setUsername]=useState('');
  const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[formError,setFormError]=useState('');
  const requestId=useRef(0),dirty=useRef(false),mounted=useRef(true);
  const result=board.result,client=board.client;
  useEffect(()=>()=>{mounted.current=false;requestId.current++;},[]);
  async function load(){
    const id=++requestId.current;setLoading(true);setFailure('');
    try {
      if(!client||!await client.available())throw Error('The shared leaderboard is not connected yet. You can continue playing; these runs are unranked.');
      const next=await client.board(filter);if(id!==requestId.current||!mounted.current)return;
      setData(next);if(!dirty.current)setUsername(next.username);
    }catch(e){if(id===requestId.current&&mounted.current){setData(null);setFailure(e instanceof Error?e.message:'Unable to load rankings.');}}
    finally{if(id===requestId.current&&mounted.current)setLoading(false);}
  }
  useEffect(()=>{if(board.open){setSaved(false);setFormError('');void load();}else requestId.current++;},[board.open,filter]);
  // A queued checkpoint may finish just after the end-of-run dialog opens.
  useEffect(()=>{if(board.open&&!board.syncing)void load();},[board.syncing]);
  async function submit(e:React.FormEvent){
    e.preventDefault();setSaving(true);setSaved(false);setFormError('');
    try{await board.submit(username);if(!mounted.current)return;dirty.current=false;setSaved(true);await load();}
    catch(e){if(mounted.current)setFormError(e instanceof Error?e.message:'Unable to submit. Please retry.');}
    finally{if(mounted.current)setSaving(false);}
  }
  const outcome=result?.outcome==='complete'?'Alpha City is free.':result?.outcome==='abandon'?'Operation retired.':'Your resistance lives on.';
  function row(entry:LeaderboardEntry,personal=false){return <tr key={entry.wallet} className={entry.wallet===client?.wallet?'leaderboard-you':''}>
    <td><span className={`leaderboard-rank rank-${entry.rank}`}>{entry.rank<=3?<Trophy size={15}/>:null}{String(entry.rank).padStart(2,'0')}</span></td>
    <td><strong>{entry.username}</strong>{entry.wallet===client?.wallet&&<span className="leaderboard-you-tag">YOU</span>}<small>{HEROES.find(h=>h.id===entry.heroId)?.title}</small></td>
    <td><b>{entry.level}<span> / 9</span></b><small>{CHAPTERS[entry.level-1]?.name}</small></td>
    <td className="leaderboard-time">{formatRunTime(entry.elapsedMs)}{personal&&<small>Personal best</small>}</td>
  </tr>;}
  return <Dialog open={board.open} onOpenChange={board.changeOpen}><DialogContent className="hollow-dialog leaderboard-dialog">
    <div className="leaderboard-heading"><span className="leaderboard-emblem"><Trophy size={27}/></span><div><span className="small-label gold">ALPHA CITY / HALL OF RESISTANCE</span><DialogTitle>{result?outcome:'The revolution remembers.'}</DialogTitle></div></div>
    <DialogDescription>Highest district cleared wins. Faster boss-clear times break ties. One personal best per wallet.</DialogDescription>
    {result&&<section className="leaderboard-result" aria-label="Completed run">
      <div><span className="small-label">YOUR LAST EXPEDITION</span><strong>{HEROES.find(h=>h.id===result.heroId)?.name}<small> · {HEROES.find(h=>h.id===result.heroId)?.title}</small></strong></div>
      <div><b>{result.level}<em> / 9</em></b><span>DISTRICTS CLEARED</span></div><div><b>{formatRunTime(result.elapsedMs)}</b><span>TO LAST BOSS CLEAR</span></div>
      <p>{!result.serverId?'Unranked expedition. Start a new ranked run to enter the board.':!result.level?'No boss cleared yet. Your next expedition is another chance.':board.syncing?'Syncing your expedition…':result.synced?(data?.username?'Run recorded. Your personal best stays with your callsign.':'Run recorded. Choose a username to appear on the board.'):'Result saved in this browser. Submit below to finish syncing.'}</p>
    </section>}
    <form className="leaderboard-profile" onSubmit={submit}>
      <label htmlFor="rebel-username">YOUR REBEL CALLSIGN <span>Public username</span></label>
      <div><input id="rebel-username" name="username" autoComplete="nickname" minLength={3} maxLength={20} required pattern="[A-Za-z0-9][A-Za-z0-9 _\-]{2,19}" placeholder="e.g. GhostSignal" value={username} onChange={e=>{dirty.current=true;setUsername(e.target.value);setSaved(false);}} aria-describedby="callsign-help"/>
      <button className="primary-button" disabled={saving||board.syncing||!client||!!failure} type="submit">{saving?<LoaderCircle className="leaderboard-spin" size={16}/>:saved?<Check size={16}/>:<ArrowUpRight size={16}/>} {saving?'Submitting…':saved?'Saved':result?.serverId?'Save name & submit':'Save username'}</button></div>
      <p id="callsign-help">3–20 characters. Your name and best result are public and linked to your wallet. A wallet message may be requested; no transaction or fee.</p>
      {(formError||board.error)&&<p className="leaderboard-error" role="alert">{formError||board.error}</p>}{saved&&<p className="leaderboard-success" role="status">Callsign saved. {data?.me?'Your personal best is on the board.':'Clear a boss in a ranked run to join the board.'}</p>}
    </form>
    <div className="leaderboard-toolbar"><div><span className="small-label">UPRISING / SEASON 01</span><h3>Rebel standings</h3></div><div><label className="sr-only" htmlFor="leaderboard-class">Filter by operative class</label><select id="leaderboard-class" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All classes</option>{HEROES.map(h=><option key={h.id} value={h.id}>{h.title}</option>)}</select><button type="button" className="icon-button" aria-label="Refresh leaderboard" disabled={loading} onClick={()=>void load()}><RefreshCw size={17} className={loading?'leaderboard-spin':''}/></button></div></div>
    {loading&&!data?<div className="leaderboard-empty" role="status"><LoaderCircle className="leaderboard-spin"/><strong>Contacting the rebel network…</strong></div>:failure?<div className="leaderboard-empty" role="status"><ShieldCheck/><strong>Rankings temporarily unavailable</strong><p>{failure}</p><button className="secondary-button" onClick={()=>void load()}>Retry connection</button></div>:data&&!data.entries.length?<div className="leaderboard-empty"><Trophy size={33}/><strong>{filter==='all'?'Be the first to leave your mark.':'No ranked runs for this class yet.'}</strong><p>Launch a ranked expedition, defeat a district boss, and register your callsign.</p></div>:<div className="leaderboard-table-wrap"><table className="leaderboard-table"><caption className="sr-only">Top 50 rebel expeditions</caption><thead><tr><th scope="col">RANK</th><th scope="col">OPERATIVE</th><th scope="col">LEVEL CLEARED</th><th scope="col">TIME</th></tr></thead><tbody>{data?.entries.map(entry=>row(entry))}{data?.me&&!data.entries.some(e=>e.wallet===data.me!.wallet)&&row(data.me,true)}</tbody></table></div>}
    <div className="leaderboard-footer"><Clock3 size={15}/><p>Ranked time includes breaks and offline time, ending at the server’s last boss-clear receipt. Campaign resets keep your record. Rankings use basic validation, not fully verified combat.</p></div>
  </DialogContent></Dialog>;
}
