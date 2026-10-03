import type {HeroId, Run} from './game.ts';

export type RunOutcome = 'defeat'|'abandon'|'complete';
export type ServerRun = {id:string; heroId:HeroId; startedAt:number; level:number; elapsedMs:number; outcome:RunOutcome|null};
export type LeaderboardEntry = {wallet:string; username:string; heroId:HeroId; level:number; elapsedMs:number; rank:number};
export type LeaderboardData = {season:string; entries:LeaderboardEntry[]; me:LeaderboardEntry|null; username:string};
export type LeaderboardClient = {
  wallet:string; available:()=>Promise<boolean>; authenticate:()=>Promise<void>;
  startRun:(clientId:string, heroId:HeroId)=>Promise<ServerRun>;
  checkpoint:(id:string, level:number)=>Promise<ServerRun>;
  finish:(id:string, outcome:RunOutcome)=>Promise<ServerRun>;
  board:(hero?:string)=>Promise<LeaderboardData>;
  publish:(username:string)=>Promise<{username:string}>;
};
export type RunRecord = {
  clientId:string; serverId:string|null; heroId:HeroId; startedAt:number|null;
  level:number; elapsedMs:number|null; pendingLevels:number[]; outcome:RunOutcome|null;
  synced:boolean; endedAt?:number; seen?:boolean;
};
export type RunJournal = {active:RunRecord|null; recent:RunRecord[]};
export const emptyJournal = ():RunJournal => ({active:null, recent:[]});
export function beginRecord(run:Run, server:ServerRun|null, now=Date.now()):RunRecord {
  return {clientId:run.climbId??run.id, serverId:server?.id??null, heroId:run.heroId,
    startedAt:server?.startedAt??now, level:0, elapsedMs:null, pendingLevels:[], outcome:null, synced:false};
}
export function observeRun(journal:RunJournal, before:Run, next:Run, manual?:RunOutcome, now=Date.now()):RunJournal {
  const bossCleared = next.relic && !before.relic && next.nodeId === 'guardian';
  const outcome = manual ?? (next.mode==='result' && before.mode!=='result' && !next.climbActive ? (next.victory?'complete':'defeat') : null);
  if (!bossCleared && !outcome) return journal;
  const clientId = before.climbId??before.id;
  if (outcome && journal.recent.some(r=>r.clientId===clientId)) return journal;
  // Saves from before this feature have no trusted start; show a summary, never backfill a ranked score.
  let record = journal.active?.clientId===clientId ? structuredClone(journal.active) : {
    ...beginRecord(before,null,now), startedAt:null, level:Math.max(0,before.chapter-1)+(before.relic?1:0),
  };
  if (bossCleared && next.chapter > record.level) {
    record.level=next.chapter;
    record.elapsedMs=record.startedAt===null?null:Math.max(0,now-record.startedAt);
    if (record.serverId) record.pendingLevels.push(next.chapter);
    record.synced=false;
  }
  if (outcome) {
    record={...record,outcome,endedAt:now,synced:!record.serverId};
    // Never drop pending submissions when a player starts another campaign.
    const old=journal.recent.filter(r=>r.clientId!==record.clientId);
    return {active:null,recent:[record,...old.filter(r=>!r.synced),...old.filter(r=>r.synced).slice(0,4)]};
  }
  return {...journal,active:record};
}
export function readJournal(value:unknown):RunJournal {
  if (!value||typeof value!=='object') return emptyJournal();
  const source=value as RunJournal;
  const valid=(r:RunRecord)=>r && typeof r.clientId==='string' && ['glitchborn','chainbreaker','nodewalker','coinbroker'].includes(r.heroId) &&
    (r.serverId===null||typeof r.serverId==='string') && (r.startedAt===null||Number.isFinite(r.startedAt)) &&
    Number.isInteger(r.level)&&r.level>=0&&r.level<=9 && (r.elapsedMs===null||(Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0)) &&
    (r.outcome===null||['defeat','abandon','complete'].includes(r.outcome)) && Array.isArray(r.pendingLevels) &&
    r.pendingLevels.every(n=>Number.isInteger(n)&&n>0&&n<=r.level);
  return {active:source.active&&valid(source.active)?source.active:null,recent:Array.isArray(source.recent)?source.recent.filter(valid):[]};
}
export function formatRunTime(ms:number|null) {
  if (ms===null) return '—';
  const seconds=Math.floor(Math.max(0,ms)/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds/60)%60,s=seconds%60;
  return `${h?String(h).padStart(2,'0')+':':''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
