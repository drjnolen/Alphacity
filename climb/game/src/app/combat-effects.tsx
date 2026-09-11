'use client';
import { useEffect, useRef, type CSSProperties } from 'react';
import type { CombatCue } from '@/lib/combat-feedback';
import type { Position } from '@/lib/game';

const xy = (p: Position) => ({ x: (p.x + .5) * 100, y: (p.y + .5) * 100 });
const at = (p: Position): CSSProperties => ({left:`${(p.x+.5)/6*100}%`,top:`${(p.y+.5)/4*100}%`});
const delay = (ms:number): CSSProperties => ({animationDelay:`${ms}ms`});
const travel = (a:Position,b:Position,ms=0): CSSProperties => ({...at(a),'--to-x':`${(b.x+.5)/6*100}%`,'--to-y':`${(b.y+.5)/4*100}%`,animationDelay:`${ms}ms`} as CSSProperties);

function Traveler({cue,portrait,reduced}:{cue:CombatCue;portrait:number;reduced:boolean}){
  const ref=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    if(reduced||!cue.path||!ref.current)return;
    const animation=ref.current.animate(cue.path.map(p=>({left:`${(p.x+.5)/6*100}%`,top:`${(p.y+.5)/4*100}%`})),{duration:400,fill:'forwards',easing:'linear'});
    return()=>animation.cancel();
  },[cue,reduced]);
  return <span ref={ref} className="fx-traveler" style={{...travel(cue.source,cue.destination!),...(cue.path?{animation:'none'}:{})}}><span className={`portrait portrait-${portrait}`}/></span>;
}

export function CombatEffects({cue,portrait,reduced}:{cue:CombatCue;portrait:number;reduced:boolean}) {
  const from=xy(cue.source),to=xy(cue.target),arrival=xy(cue.destination??cue.source);
  return <div className={`combat-fx fx-${cue.tone} fx-${cue.kind} ${reduced?'fx-reduced':''}`} aria-hidden="true">
    <svg className="fx-vectors" viewBox="0 0 600 400" preserveAspectRatio="none">
      <defs><filter id="hollow-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3"/></filter></defs>
      {cue.destination&&<path className="fx-trail" d={cue.path?cue.path.map((p,i)=>`${i?'L':'M'}${xy(p).x},${xy(p).y}`).join(' '):`M${from.x},${from.y} L${arrival.x},${arrival.y}`}/>}
      {(cue.kind==='strike'||cue.kind==='signature')&&<g>
        {cue.tone==='nodewalker'?<>
          <path className="fx-bolt fx-bolt-glow" d={cue.kind==='signature'?`M${to.x-90},-80 L${to.x},${to.y}`:`M${from.x},${from.y} Q${(from.x+to.x)/2},${Math.min(from.y,to.y)-90} ${to.x},${to.y}`}/>
          <path className="fx-bolt" d={cue.kind==='signature'?`M${to.x-90},-80 L${to.x},${to.y}`:`M${from.x},${from.y} Q${(from.x+to.x)/2},${Math.min(from.y,to.y)-90} ${to.x},${to.y}`}/>
        </>:<>
          <path className="fx-slash fx-slash-glow" d={`M${to.x-43},${to.y+39} Q${to.x-8},${to.y-2} ${to.x+43},${to.y-38}`}/>
          <path className="fx-slash" d={`M${to.x-43},${to.y+39} Q${to.x-8},${to.y-2} ${to.x+43},${to.y-38}`}/>
          {cue.tone==='glitchborn'&&<path className="fx-slash fx-cross-slash" d={`M${to.x-36},${to.y-31} Q${to.x},${to.y+8} ${to.x+39},${to.y+32}`}/>}
        </>}
      </g>}
      {cue.attacks.map((attack,i)=><g key={i} className={attack.boss?'fx-sweep':'fx-enemy-volley'}>
        {attack.tiles.map((p,j)=>{const a=xy(attack.source),b=xy(p);return <path key={j} className="fx-enemy-ray" style={delay(attack.delay)} d={`M${a.x},${a.y} L${b.x},${b.y}`}/>;})}
      </g>)}
    </svg>
    {cue.destination&&<Traveler cue={cue} portrait={portrait} reduced={reduced}/>}
    {cue.movements.map((m,i)=><span key={`move${i}`} className="fx-traveler fx-enemy-traveler" style={travel(m.source,m.target,m.delay)}><span className={`portrait portrait-${m.portrait}`}/></span>)}
    {(cue.kind==='guard'||cue.kind==='heal')&&<span className="fx-ward" style={at(cue.source)}><i/><i/><i/></span>}
    {cue.attacks.flatMap((a,i)=>a.tiles.map((p,j)=><span key={`tile${i}-${j}`} className="fx-tile-hit" style={{...at(p),...delay(a.delay+100)}}/>))}
    {cue.hazards.map((p,i)=><span key={`hazard${i}`} className="fx-hazard-eruption" style={{...at(p),...delay(720)}}/>)}
    {cue.impacts.map((hit,i)=><span key={i} className={`fx-impact fx-${hit.tone} ${hit.killed?'fx-finisher':''}`} style={{...at(hit.position),marginTop:cue.impacts.slice(0,i).filter(h=>h.position.x===hit.position.x&&h.position.y===hit.position.y).length*22}}>
      <i className="fx-impact-ring" style={delay(hit.delay)}/>
      {Array.from({length:cue.kind==='signature'?12:7},(_,j)=><i key={j} className="fx-spark" style={{'--angle':`${j*137.5}deg`,'--reach':`${26+(j%4)*12}px`,...delay(hit.delay)} as CSSProperties}/>)}
      <b className="fx-number" style={delay(hit.delay+60)}>{hit.text}{hit.killed&&<small>DISABLED</small>}</b>
    </span>)}
    {cue.kind==='signature'&&<span className={`fx-sigil fx-sigil-${cue.tone}`} style={at(cue.target)}><i/><i/><i/></span>}
    {cue.revived&&<span className="fx-rebirth" style={{...at(cue.source),...delay(1050)}}/>}
    {cue.victory&&<div className="fx-victory" style={delay(cue.duration-650)}><span>ENCOUNTER COMPLETE</span><strong>Checkpoint cleared</strong></div>}
  </div>;
}

export function CombatBanner({cue}:{cue:CombatCue|null}) {
  return <div className={`combat-banner ${cue?`is-active fx-${cue.tone}`:''}`} aria-live="polite" aria-atomic="true">
    <span>{cue?.subtitle??'INTENTIONS LOCKED · YOUR MOVE'}</span><strong>{cue?.title??'Read. Move. Strike.'}</strong><i/>
  </div>;
}
