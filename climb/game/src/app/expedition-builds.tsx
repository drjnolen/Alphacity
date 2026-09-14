import {useRef} from 'react';
import {Check, LockKeyhole, Sparkles, Zap, GitBranch} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {TALENTS, CLOCKS, clockText, canLearn, hasTalent, talentPoints, hasClock, armedClocks} from '@/lib/expedition';
import {heroFor, itemFor, type Run, type GameAction} from '@/lib/game';
import {SLOTS} from '@/lib/equipment';
import './expedition-builds.css';

const NOTES={
 glitchborn:'Move to open a blind angle, or let corruption mature before consuming it. Exit strategy rewards finishing blows; Contagion rewards choosing where a target falls.',
 chainbreaker:'Guard is both shelter and ammunition. Spend it before a dangerous enemy turn, or absorb a hit to earn charge and a fourth action. Redline rewards risk without removing it.',
 nodewalker:'Suppress first, then fork the signal. Leave an action unused to recover faster, or spend the whole turn on Overdrive. Gear cooldowns become a second clock to manage.',
 coinbroker:'A large reserve makes Collateral stronger. Hostile bids spend that reserve; Liquid reserves makes a lean build viable. Rebates and insurance have encounter caps.'
};
export function BuildDialog({run,open,onOpenChange,act}:{run:Run;open:boolean;onOpenChange:(open:boolean)=>void;act:(a:GameAction)=>void}){
 const heading=useRef<HTMLHeadingElement>(null);
 const talents=TALENTS.filter(t=>t.hero===run.heroId),branches=[...new Set(talents.map(t=>t.branch))],points=talentPoints(run),editable=!!run.climbActive&&['map','reward','result'].includes(run.mode),armed=armedClocks(run);
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent initialFocus={heading} className={`hollow-dialog build-dialog build-${run.heroId}`}>
  <span className="small-label build-eyebrow"><GitBranch size={16}/> EXPEDITION DOCTRINE</span>
  <DialogTitle ref={heading} tabIndex={-1}>{heroFor(run).title} / build your rebellion.</DialogTitle>
  <DialogDescription>Begin with 1 insight. Each of the first eight district bosses grants 1 more. Learn between encounters; choices last this climb. Primary hits affect the selected target; splash and corruption do not trigger them. A complete branch costs 7 of your 9 possible insight.</DialogDescription>
  <div className="build-summary"><strong>{points}<small>INSIGHT AVAILABLE</small></strong><p>{NOTES[run.heroId]}</p></div>
  {!editable&&<p className="build-notice">{run.mode==='combat'?'Doctrine and active loadout are locked during combat.':'Launch your operation to spend insight. Preview both paths below.'}</p>}
  <div className="doctrine-tree">{branches.map((branch,i)=><section className="doctrine-branch" key={branch}><h3><span>0{i+1}</span>{branch}</h3>{talents.filter(t=>t.branch===branch).map((t,index)=>{
   const owned=hasTalent(run,t.id),ready=canLearn(run,t.id),parent=talents.find(p=>p.id===t.requires);
   return <article key={t.id} className={`talent-node ${owned?'learned':ready?'available':'locked'}`}><div className="talent-heading"><span className="talent-rank">{owned?<Check size={15}/>:index+1}</span><h4>{t.name}</h4><small>{t.cost} insight</small></div><p>{t.text}</p><div className="talent-footer"><small>{parent?`Requires ${parent.name}`:'Branch entry · mix paths freely'}</small><button disabled={!ready} onClick={()=>act({type:'learnTalent',id:t.id})}>{owned?<><Check size={12}/> Learned</>:ready?'Learn':!editable?'Preview':parent&&!hasTalent(run,parent.id)?<><LockKeyhole size={12}/> Locked</>:`Need ${Math.max(0,t.cost-points)} insight`}</button></div></article>;
  })}</section>)}</div>
  <section className="build-loadout"><div><span className="small-label">GEAR ABILITIES</span><h3>{armed.length}/3 equipped + your signature</h3><p>Active overclocks unlock after bosses. Equip up to three between encounters. Unequip one to replace it when all three slots are full. Installed passive effects always apply.</p></div><div className="build-clock-list">{SLOTS.filter(s=>run.gear[s]).map(s=><div key={s}><span><small>{s} · {itemFor(run.gear[s]!).name}</small><strong>{CLOCKS[s].name}</strong><p>{clockText(run,s)}</p>{hasClock(run,s,'passive')&&<em><Sparkles size={12}/> {CLOCKS[s].passive}: {CLOCKS[s].passiveText}</em>}</span><button disabled={!editable||!hasClock(run,s,'active')||(!armed.includes(s)&&armed.length>=3)} aria-pressed={armed.includes(s)} onClick={()=>act({type:'armClock',slot:s})}>{armed.includes(s)?'Equipped':hasClock(run,s,'active')?'Equip':'Not unlocked'}</button></div>)}</div></section>
 </DialogContent></Dialog>;
}
export function BuildButton({run,onClick}:{run:Run;onClick:()=>void}){return <button className="build-button" onClick={onClick}><GitBranch size={17}/><span>Expedition doctrine<small>{run.talents?.length??0} learned · {talentPoints(run)} insight available</small></span><Zap size={14}/></button>;}
