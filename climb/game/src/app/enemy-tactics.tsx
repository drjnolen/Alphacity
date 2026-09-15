import {canDisableRelay,tacticalHint,tacticalArmor,supportArmor,supportStrength} from '@/lib/enemy-tactics';
import {tileLabel} from '@/lib/battlefield';
import type {Run,GameAction,Enemy,Combat} from '@/lib/game';
import './enemy-tactics.css';
export function EnemyTactics({c,e}:{c:Combat;e:Enemy}){
 const hint=tacticalHint(c,e),brief=e.support?`Shield link · ${(e.jammed??0)>0?0:supportStrength(e)} armor within 2 tiles`:e.charge?`${e.charge.damage} damage ${e.charge.phase==='windup'?'next round':'this turn'} · ${Math.max(0,e.charge.required-(e.charge.startHp-e.hp))} damage to interrupt`:e.interrupted?'CHARGE INTERRUPTED':e.assault?'Move + strike · slow or push to disrupt':'';
 return <>{hint&&<small className="tactic-hint" title={hint}>{brief}</small>}{e.commander&&<small className={`enrage-hint ${e.enrage?'is-enraged':''}`}>{e.enrage?`ENRAGED ${e.enrage}/2 · +${e.enrage*20}% base damage · −${e.enrage*2} armor`:'Enrage at 50% / 25% HP · +20% / +40% damage, −2 / −4 armor'}</small>}{supportArmor(c,e)>0&&<small className="relay-hint">LINKED · {supportArmor(c,e)} relay armor · {tacticalArmor(c,e)} total armor</small>}</>;
}
export function TacticalObjectives({run,act,busy}:{run:Run;act:(a:GameAction)=>void;busy:boolean}){
 const c=run.combat;if(!c)return null;const relays=c.enemies.filter(e=>e.support&&e.hp>0);
 if(!relays.length)return null;
 return <section className="tactical-objectives" aria-label="Enemy relays and objectives">{relays.map(e=><div className="tactical-objective" key={e.id}><div><strong>{e.name} · {tileLabel(e)}</strong><p>{e.objective?e.objective.triggered?'Reinforcement deployed · no further waves':`${e.objective.turns} enemy turns until one reinforcement${(e.jammed??0)>0||(e.weaken??0)>=25?' · PAUSED':''}. Jam or 25% suppression pauses the clock.`:'Shield support remains active until disabled. Suppression weakens the shield; jam shuts it off.'}</p><small>Destroy it at range or reach a connected adjacent tile to disable it.</small></div><button className="secondary-button" disabled={busy||!canDisableRelay(c,e)} onClick={()=>act({type:'disableRelay',id:e.id})}>Disable relay · 1 AP</button></div>)}</section>;
}
