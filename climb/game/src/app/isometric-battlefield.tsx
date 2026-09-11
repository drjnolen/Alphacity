'use client';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Footprints, Layers3, Minus, Plus, RotateCcw } from 'lucide-react';
import { BOARD_COLUMNS, BOARD_ROWS, CELLS, ISO, boardCells, sceneBounds, elevation, project, projectCell, route, terrainCell, terrainName, surfaceCorners, tileLabel, type TerrainCell } from '@/lib/battlefield';
import { canAttack, heroFor, moveRange, same, type ActionMode, type Combat, type Enemy, type Position, type Run } from '@/lib/game';
import type { CombatCue } from '@/lib/combat-feedback';
import { ENEMY_ART_FRAMES } from '@/lib/enemy-art-frames';
import { enemyArt } from '@/lib/enemy-art';
import { REBEL_CLIPS } from '@/lib/sprite-crops';
import { arenaFor, combatArena } from '@/lib/district-arenas';
import { chapterFor } from '@/lib/campaign';
import { CombatBanner } from './combat-effects';

const points = (ps: Position[]) => ps.map(p => `${p.x},${p.y}`).join(' ');
const diamond = (p: Position, w = 70, h = 35) => points([{ x: p.x, y: p.y - h }, { x: p.x + w, y: p.y }, { x: p.x, y: p.y + h }, { x: p.x - w, y: p.y }]);
const time = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
const bodyIndex = (e: Enemy) => e.type !== 'boss' && e.role === 'drone' ? 7 : e.faction === 'Overlords' ? 4 : e.faction === 'Neuralifes' ? 6 : 5;
const BODY_BOUNDS = [[10,141,498,661], [459,125,471,685], [929,131,442,682], [1402,120,351,690], [21,16,508,816], [541,121,351,706], [950,132,328,694], [1301,152,440,561]];

function Bodies({ id }: { id: string }) {
  return <>{BODY_BOUNDS.map(([x, y, w, h], i) => <symbol key={i} id={`${id}-body-${i}`} viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMax meet" overflow="hidden">
    {/* A viewBox scales the atlas but does not isolate its pixels in letterboxed space. */}
    <g clipPath={`url(#${id}-bounds-${i})`}>
      <image href={`/climb/assets/art/alpha-${i < 4 ? 'rebel' : 'enemy'}-bodies.png`} width="1774" height="887" clipPath={i < 4 ? `url(#${id}-crop-${i})` : undefined}/>
    </g>
  </symbol>)}
    {BODY_BOUNDS.map(([x,y,width,height],i)=><clipPath key={`bounds-${i}`} id={`${id}-bounds-${i}`} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={width} height={height}/></clipPath>)}
    {REBEL_CLIPS.map((shape,i)=><clipPath key={i} id={`${id}-crop-${i}`} clipPathUnits="userSpaceOnUse"><polygon points={shape}/></clipPath>)}
  </>;
}

/** These prisms are the actual walkable cells and stair treads, projected from world coordinates. */
function Prism({ x0, y0, x1, y1, height, id, stair = false }: { x0: number; y0: number; x1: number; y1: number; height: number; id: string; stair?: boolean }) {
  const a = project({ x: x0, y: y0 }, height), b = project({ x: x1, y: y0 }, height), d = project({ x: x0, y: y1 }, height), e = project({ x: x1, y: y1 }, height);
  const bottomA = project({ x: x0, y: y0 }, -.42), bottomD = project({ x: x0, y: y1 }, -.42), bottomE = project({ x: x1, y: y1 }, -.42);
  return <g className="iso-mesh" aria-hidden="true">
    <polygon points={points([d,e,bottomE,bottomD])} fill={`url(#${id}-wall-right)`}/>
    <polygon points={points([a,d,bottomD,bottomA])} fill={`url(#${id}-wall-left)`}/>
    <polygon points={points([a,b,e,d])} fill={`url(#${id}-${stair ? 'tread' : 'floor'})`} className={stair ? 'iso-tread' : 'iso-floor'}/>
    <path d={`M${a.x},${a.y+5} L${d.x},${d.y+5} L${e.x},${e.y+5}`} className="iso-edge-light"/>
  </g>;
}

function Ground({ cell, chapter, id }: { cell: TerrainCell; chapter: number; id: string }) {
  if (cell.stair) return <g>{Array.from({ length: 6 }, (_, step) => {
    const xAxis = cell.stair!.startsWith('x'), reverse = cell.stair!.endsWith('-'), i = xAxis ? 5-step : step;
    const x0 = cell.x - .5 + (xAxis ? i / 6 : 0), y0 = cell.y - .5 + (xAxis ? 0 : i / 6);
    return <Prism key={i} x0={x0} y0={y0} x1={x0 + (xAxis ? 1 / 6 : 1)} y1={y0 + (xAxis ? 1 : 1 / 6)} height={Math.floor(cell.height) + (reverse ? 6 - i : i + 1) / 6} id={id} stair/>;
  })}</g>;
  const center = project(cell, cell.height), atlasX = ((chapter-1) % 3) * 418 + cell.x * 418 / BOARD_COLUMNS, atlasY = Math.floor((chapter-1)/3) * 418 + cell.y * 418 / BOARD_ROWS;
  return <g aria-hidden="true">
    <Prism x0={cell.x-.5} y0={cell.y-.5} x1={cell.x+.5} y1={cell.y+.5} height={cell.height} id={id}/>
    <g transform={`matrix(.76 -.38 .76 .38 ${center.x-76} ${center.y})`} pointerEvents="none">
      <svg width="100" height="100" viewBox={`${atlasX} ${atlasY} ${418/BOARD_COLUMNS} ${418/BOARD_ROWS}`} preserveAspectRatio="none" className="iso-floor-texture"><image href="/climb/assets/art/alpha-floors.png" width="1254" height="1254"/></svg>
    </g>
    <polygon points={diamond(center,75,37.5)} className="iso-grid-edge"/>
  </g>;
}

function Figure({ id, index, boss = false, moving = false, hit, attacking = false, art }: { art?: string; id: string; index: number; boss?: boolean; moving?: boolean; hit?: CombatCue['impacts'][number]; attacking?: boolean }) {
  const height = boss ? 148 : index === 7 ? 96 : 116, width = boss ? 115 : 98, frame = art ? ENEMY_ART_FRAMES[art] : undefined;
  return <g className={`iso-figure ${moving ? 'iso-walking' : index === 7 ? 'iso-hovering' : 'iso-breathing'} ${attacking ? 'iso-attacking' : ''}`}>
    <g className={hit ? hit.killed ? 'iso-disabled-unit' : 'iso-struck-unit' : undefined} style={time(hit?.delay ?? 0)}>
      {art && frame ? <svg x={-width/2} y={-height-(index===7?14:0)} width={width} height={height} viewBox={frame.viewBox} preserveAspectRatio="xMidYMax meet" overflow="hidden" className="iso-body"><image href={art} width={frame.width} height={frame.height}/></svg> : <use href={`#${id}-body-${index}`} x={-width/2} y={-height-(index===7?14:0)} width={width} height={height} className="iso-body"/>}
    </g>
  </g>;
}

function Traveler({ id, c, path, index, duration, delay = 0, reduced, boss = false, art }: { art?: string; id: string; c: Combat; path: Position[]; index: number; duration: number; delay?: number; reduced: boolean; boss?: boolean }) {
  const ref = useRef<SVGGElement>(null), start = projectCell(c, path[0]), finish = projectCell(c, path[path.length-1]);
  useEffect(() => {
    if (reduced || !ref.current || path.length < 2) return;
    const frames:Keyframe[]=[];
    path.forEach((p,i)=>{const q=projectCell(c,p),offset=i/(path.length-1),transform=`translate(${q.x}px,${q.y}px)`;
      if(i>0&&Math.abs(p.x-path[i-1].x)+Math.abs(p.y-path[i-1].y)>1){const prev=projectCell(c,path[i-1]),start=(i-1)/(path.length-1),span=offset-start;frames.push({transform:`translate(${prev.x}px,${prev.y}px)`,opacity:0,offset:start+span*.2},{transform,opacity:0,offset:start+span*.8});}
      frames.push({transform,opacity:1,offset});
    });
    const animation = ref.current.animate(frames, { duration, delay, fill: 'both', easing: 'linear' });
    return () => animation.cancel();
  }, [c,path,duration,delay,reduced]);
  const p = reduced ? finish : start;
  return <g ref={ref} style={{ transform: `translate(${p.x}px,${p.y}px)` }} className="iso-traveler" aria-hidden="true">
    <ellipse cx="0" cy="-1" rx="26" ry="10" className="iso-contact-shadow"/><Figure id={id} index={index} boss={boss} art={art} moving={!reduced}/>
  </g>;
}

function BossProjectile({source,target,delay,fire}:{source:Position;target:Position;delay:number;fire:boolean}){
 const ref=useRef<SVGCircleElement>(null);
 useEffect(()=>{if(!ref.current)return;const top=Math.min(source.y,target.y)-160,frames=Array.from({length:16},(_,i)=>{const t=i/15,u=1-t;return {transform:`translate(${u*u*source.x+2*u*t*(source.x+target.x)/2+t*t*target.x}px,${u*u*(source.y-65)+2*u*t*top+t*t*target.y}px)`};});const a=ref.current.animate(frames,{duration:650,delay,fill:'both',easing:'linear'});return()=>a.cancel();},[source.x,source.y,target.x,target.y,delay]);
 return <circle ref={ref} r={fire?9:6} className="boss-projectile" style={time(delay)}/>;
}

function Effects({ c, cue }: { c: Combat; cue: CombatCue }) {
  const from = projectCell(c,cue.source), to = projectCell(c,cue.target), signature = cue.kind === 'signature';
  return <g className={`iso-effects fx-${cue.tone}`} aria-hidden="true" pointerEvents="none">
    {cue.destination && <polyline points={points((cue.path ?? [cue.source,cue.destination]).map(p=>projectCell(c,p)))} className="iso-trail"/>}
    {(cue.kind === 'strike' || signature) && <g>
      {(cue.tone === 'nodewalker' || cue.tone === 'coinbroker') ? <>
        <path d={`M${from.x},${from.y-64} Q${(from.x+to.x)/2},${Math.min(from.y,to.y)-125} ${to.x},${to.y-58}`} className="iso-energy-beam"/>
        <path d={`M${from.x},${from.y-64} Q${(from.x+to.x)/2},${Math.min(from.y,to.y)-125} ${to.x},${to.y-58}`} className="iso-energy-core"/>
      </> : <g transform={`translate(${to.x},${to.y-48})`}>
        <path d="M-43 34 Q-2 -5 44 -43" className="iso-slash"/>
        {cue.tone === 'glitchborn' && <path d="M-42 -36 Q2 4 40 30" className="iso-slash iso-cross-slash"/>}
      </g>}
      {signature && <g transform={`translate(${to.x},${to.y})`}><ellipse rx="65" ry="32" className="iso-signature-ring"/><ellipse rx="90" ry="45" className="iso-signature-ring iso-ring-two"/></g>}
    </g>}
    {cue.attacks.map((a,i) => <g key={i}>{a.tiles.map((p,j) => { const source = projectCell(c,a.source), target = projectCell(c,p); return <g key={j}>
      <path d={`M${source.x},${source.y-65} L${target.x},${target.y}`} className={`iso-enemy-beam ${a.boss?'iso-boss-beam':''} boss-fx-${a.effect??'none'}`} style={time(a.delay)}/>
      {a.boss&&<>{['fire','shell','sovereign'].includes(a.effect??'')&&<BossProjectile source={source} target={target} delay={a.delay} fire={a.effect==='fire'}/>}<ellipse cx={target.x} cy={target.y} rx="48" ry="24" className={`boss-shockwave boss-fx-${a.effect}`} style={time(a.delay+180)}/></>}
      <polygon points={diamond(target,65,32)} className="iso-tile-detonation" style={time(a.delay+100)}/>
    </g>; })}</g>)}
    {cue.hazards.map((p,i)=><polygon key={i} points={diamond(projectCell(c,p),66,33)} className="iso-hazard-detonation" style={time(720)}/>)}
    {(cue.kind === 'guard' || cue.kind === 'heal' || cue.revived) && <g transform={`translate(${from.x},${from.y-38})`}><ellipse rx="40" ry="60" className="iso-ward" style={time(cue.revived?1000:0)}/></g>}
    {cue.impacts.map((hit,i) => { const p = projectCell(c,hit.position), stacked = cue.impacts.slice(0,i).filter(h=>same(h.position,hit.position)).length; return <g key={i} transform={`translate(${p.x},${p.y-70-stacked*24})`} className={`fx-${hit.tone}`}>
      <g className="iso-impact" style={time(hit.delay)}>{Array.from({length:signature?10:6},(_,j)=><path key={j} d={`M${Math.cos(j*2.4)*8} ${Math.sin(j*2.4)*8} l${Math.cos(j*2.4)*28} ${Math.sin(j*2.4)*28}`} className="iso-spark"/>)}</g>
      {hit.text.includes('RESTORED')&&<ellipse cy="20" rx="40" ry="60" className="boss-healing" style={time(hit.delay)}/>}<text textAnchor="middle" className={`iso-damage ${hit.text.length>5?'iso-damage-word':''}`} style={time(hit.delay+60)}>{hit.text}{hit.killed&&<tspan x="0" dy="19" className="iso-kill-label">DISABLED</tspan>}</text>
    </g>; })}
  </g>;
}

const FEATURE_BOUNDS=[[10,10,395,375],[450,0,360,392],[839,35,415,357],[40,400,345,382],[424,399,391,385],[850,412,384,371],[9,784,394,438],[504,793,273,434],[847,770,388,471]];
function EnvironmentProp({id,chapter,center}:{id:string;chapter:number;center:Position}) {
 const [x,y,w,h]=FEATURE_BOUNDS[chapter-1],low=chapter===3,width=low?122:112,height=low?70:126;
 return <svg x={center.x-width/2} y={center.y-height+9} width={width} height={height} viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMax meet" overflow="hidden" className={`iso-environment-prop iso-environment-${chapter}`} pointerEvents="none">
  <defs><clipPath id={id} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={w} height={h}/></clipPath></defs>
  <image href="/climb/assets/art/alpha-district-features.png" width="1254" height="1254" clipPath={`url(#${id})`}/>
 </svg>;
}

type Props = { run: Run; actionMode: ActionMode; hoveredEnemy: number | null; busy: boolean; cue: CombatCue | null; reduced: boolean; onChoose: (p: Position) => void; onEnemyHover: (id: number | null) => void };

export default function IsometricBattlefield({ run, actionMode, hoveredEnemy, busy, cue, reduced, onChoose, onEnemyHover }: Props) {
  const id = `iso-${useId().replace(/[^a-zA-Z0-9]/g,'')}`, c = run.combat!, hero = heroFor(run), chapter = chapterFor(run.chapter);
  const heroTravel=useMemo(()=>cue?.destination?(cue.path??[cue.source,cue.destination]):[],[cue]);
  const [hovered, setHovered] = useState<Position | null>(null), [zoom,setZoom] = useState(1);
  const cells=boardCells(c), bounds=sceneBounds(c), arena=combatArena(c);
  const targets = cells.map(p => ({p,path:route(c,c.hero,p,moveRange(run))}));
  const preview = !busy && actionMode === 'move' && hovered ? targets.find(t=>same(t.p,hovered))?.path : undefined;
  const targetEnemy = c.enemies.find(e => hovered && same(e,hovered));
  const focusCell = hovered ?? c.hero, tile = terrainCell(c.terrain,focusCell);
  const danger = c.enemies.filter(e=>!(e.jammed??0)&&e.intent.some(p=>same(p,focusCell))).reduce((s,e)=>s+(e.intentDamage??e.damage),0);
  const floorDanger = (c.hazards?.some(p=>same(p,focusCell)) ? c.hazardDamage??0 : 0)+(arena?.props.some(p=>same(p,focusCell))?arena.damage:0);
  return <div className={`iso-board-area ${cue?.bossEffect&&!reduced?'boss-impact':''} ${cue?.phaseChange&&!reduced?'boss-phase-change':''}`}>
    <CombatBanner cue={cue}/>
    <div className="iso-toolbar"><span><Layers3 size={15}/>{arena?.name??terrainName(c.terrain)}</span><div className="iso-zoom" aria-label="Battlefield zoom"><button aria-label="Zoom out battlefield" onClick={()=>setZoom(v=>Math.max(1,v-.25))} disabled={zoom<=1}><Minus size={14}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in battlefield" onClick={()=>setZoom(v=>Math.min(3,v+.25))} disabled={zoom>=3}><Plus size={14}/></button><button aria-label="Reset battlefield zoom" onClick={()=>setZoom(1)} disabled={zoom===1}><RotateCcw size={13}/></button></div></div>
    <div className="iso-viewport" tabIndex={0} aria-label="Battlefield view. Zoom in for larger figures; scroll to pan.">
      <svg className={`iso-board ${busy?'iso-resolving':''} ${reduced?'iso-reduced':''}`} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{width:`${zoom*100}%`,maxWidth:'none'}} role="group" aria-label="Isometric tactical battlefield, nine columns and six rows. Stairs connect floor heights. Select a tile to act.">
        <defs>
          <Bodies id={id}/>
          <linearGradient id={`${id}-wall-left`} x2="0" y2="1"><stop stopColor="#30414c"/><stop offset="1" stopColor="#0d171f"/></linearGradient>
          <linearGradient id={`${id}-wall-right`} x2="0" y2="1"><stop stopColor="#1c2b35"/><stop offset="1" stopColor="#081018"/></linearGradient>
          <linearGradient id={`${id}-floor`} x2="1" y2="1"><stop stopColor="#344750"/><stop offset="1" stopColor="#1c2b35"/></linearGradient>
          <linearGradient id={`${id}-tread`} x2="1" y2="1"><stop stopColor="#70808a"/><stop offset="1" stopColor="#374a56"/></linearGradient>
          <pattern id={`${id}-danger`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#e94d441e"/><rect width="3" height="12" fill="#ff7a6460"/></pattern>
          <pattern id={`${id}-hazard`} width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0L10 10M10 0L0 10" stroke="#ffd27b" strokeWidth="1" opacity=".5"/></pattern>
          <filter id={`${id}-shadow`} x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="13"/></filter>
        </defs>
        {cells.map(p=><polygon key={`shadow-${p.x}-${p.y}`} points={diamond(project(p,-.7),82,41)} fill="#000" opacity=".5" filter={`url(#${id}-shadow)`} aria-hidden="true"/>)}
        {[...cells].sort((a,b)=>a.y-a.x-(b.y-b.x)||a.x-b.x).map(p => {
          const cell = terrainCell(c.terrain,p), center = projectCell(c,p), enemy = c.enemies.find(e=>same(e,p)), player = same(c.hero,p), blocked = c.obstacles.some(o=>same(o,p));
          const threats = c.enemies.filter(e=>!(e.jammed??0)&&e.intent.some(t=>same(t,p))), threatened = hoveredEnemy===null ? threats.length>0 : threats.some(e=>e.id===hoveredEnemy);
          const hazard = c.hazards?.some(t=>same(t,p))||(!!arena?.damage&&arena.props.some(t=>same(t,p))), movable = !busy && actionMode==='move' && c.ap>0 && !player && !!targets.find(t=>same(t.p,p))?.path.length;
          const targetable = !!enemy && actionMode!=='move' && canAttack(run,enemy,actionMode==='skill'), disabled = busy||blocked||(!movable&&!targetable&&!enemy);
          const hit = cue?.impacts.find(h=>h.enemyId===enemy?.id && h.enemyId!==undefined), traveling = player ? !!cue?.destination : cue?.movements.some(m=>m.enemyId===enemy?.id);
          const feature=arena?.props.some(f=>same(f,p));
          const label = `${tileLabel(p)}, ${cell.stair?'stairs':`floor ${cell.height}`}${player?`, ${hero.name}`:enemy?`, ${enemy.name}, ${enemy.hp} health`:feature?`, ${arena!.feature}${blocked?', impassable':''}`:blocked?', impassable terrain':''}${threats.length?`, incoming ${threats.reduce((s,e)=>s+(e.intentDamage??e.damage),0)} attack damage`:''}${hazard?`, environmental hazard, ${(c.hazards?.some(t=>same(t,p))?c.hazardDamage??0:0)+(feature?arena!.damage:0)} damage`:''}${movable?', move here':targetable?', attack target':''}`;
          const previewStep = preview?.findIndex(q=>same(q,p))??-1;
          return <g key={`${p.x}-${p.y}`} className={`iso-cell ${movable?'iso-can-move':''} ${targetable?'iso-can-target':''} ${threatened?'iso-threatened':''} ${player?'iso-player-cell':''}`}>
            <Ground cell={cell} chapter={run.chapter} id={id}/>{feature&&<EnvironmentProp id={`${id}-feature-${p.x}-${p.y}`} chapter={c.layout!} center={center}/>}
            <g role="button" tabIndex={busy?-1:0} aria-label={label} aria-disabled={disabled} className="iso-cell-control" onMouseEnter={()=>{setHovered(p);if(enemy)onEnemyHover(enemy.id);}} onMouseLeave={()=>{setHovered(null);if(enemy)onEnemyHover(null);}} onFocus={()=>{setHovered(p);if(enemy)onEnemyHover(enemy.id);}} onBlur={()=>{setHovered(null);if(enemy)onEnemyHover(null);}} onClick={()=>{if(!disabled)onChoose(p);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!disabled)onChoose(p);}}}>
              <title>{label}</title>
              <polygon points={points(surfaceCorners(cell,0))} className="iso-hit-area"/>
              {movable&&<polygon points={points(surfaceCorners(cell,.06))} className="iso-move-overlay"/>}
              {threatened&&<polygon points={points(surfaceCorners(cell,.06))} fill={`url(#${id}-danger)`} className="iso-threat-overlay"/>}
              {hazard&&<polygon points={points(surfaceCorners(cell,.09))} fill={`url(#${id}-hazard)`} className="iso-hazard-overlay"/>}
              {targetable&&<polygon points={points(surfaceCorners(cell,.1))} className="iso-target-overlay"/>}
              {previewStep>0&&<g className="iso-path-step"><circle cx={center.x} cy={center.y} r="11"/><text x={center.x} y={center.y+5} textAnchor="middle">{previewStep}</text></g>}
              {cell.stair&&!enemy&&!player&&previewStep<1&&<text x={center.x} y={center.y+5} textAnchor="middle" className="iso-stair-mark">↟</text>}
              {!blocked&&<text x={center.x} y={center.y+28} textAnchor="middle" className="iso-coordinate">{tileLabel(p)}{cell.stair?' ↗':cell.height>0?` · +${cell.height}`:''}</text>}
              {blocked&&!feature&&<g transform={`translate(${center.x-49},${center.y-98})`} pointerEvents="none"><svg width="98" height="110" viewBox={`${chapter.terrain*724} 0 724 724`}><image href="/climb/assets/art/alpha-obstacles.png" width="2172" height="724"/></svg></g>}
              {(player||enemy)&&!traveling&&<g transform={`translate(${center.x},${center.y-3})`} className="iso-unit-group">
                <ellipse rx={enemy?.type==='boss'?34:25} ry="10" className="iso-contact-shadow"/>
                {player&&<path d="M-31 0 L0 15 L31 0 M-31 -4 L0 -19 L31 -4" className="iso-player-marker"/>}
                <Figure id={id} index={player?hero.portrait:bodyIndex(enemy!)} boss={enemy?.type==='boss'} art={enemyArt(enemy)} hit={hit} attacking={player&&(cue?.kind==='strike'||cue?.kind==='signature')}/>
                <g transform={`translate(0,${enemy?.type==='boss'?-162:-130})`} className="iso-unit-label">
                  <rect x="-34" y="-15" width="68" height="24" rx="4"/>
                  <text textAnchor="middle" y="2">{player?hero.name:enemy?.type==='boss'?'BOSS':`${enemy!.hp} HP`}</text>
                  {enemy&&<><rect x="-29" y="11" width="58" height="4" className="iso-life-track"/><rect x="-29" y="11" width={58*enemy.hp/enemy.maxHp} height="4" className="iso-life-fill"/></>}
                </g>
                {player&&c.block>0&&<text y="15" textAnchor="middle" className="iso-status-label">{c.block} GUARD</text>}
                {enemy&&((enemy.jammed??0)>0||enemy.poison>0)&&<text y="15" textAnchor="middle" className="iso-status-label">{(enemy.jammed??0)>0?'JAMMED':'CORRUPTED'}</text>}
              </g>}
            </g>
          </g>;
        })}
        {!!preview?.length&&preview.length>1&&!busy&&<polyline points={points(preview.map(p=>projectCell(c,p)))} className="iso-path-preview" pointerEvents="none"/>}
        {cue?.destination&&<Traveler id={id} c={c} path={heroTravel} index={hero.portrait} duration={cue.kind==='move'?cue.duration:350} reduced={reduced}/>}
        {cue?.movements.map(m=><Traveler key={m.enemyId} id={id} c={c} path={m.path.length?m.path:[m.source,m.target]} index={bodyIndex(c.enemies.find(e=>e.id===m.enemyId)!)} art={enemyArt(c.enemies.find(e=>e.id===m.enemyId))} boss={c.enemies.find(e=>e.id===m.enemyId)?.type==='boss'} duration={500} delay={m.delay} reduced={reduced}/>)}
        {cue&&<Effects c={c} cue={cue}/>}
      </svg>
      {cue?.victory&&<div className="iso-victory" style={time(Math.max(0,cue.duration-650))}><span>CHECKPOINT CLEARED</span><strong>Security neutralized</strong></div>}
    </div>
    <div className="iso-inspector" aria-live="polite"><span><b>{tileLabel(focusCell)}</b>{targetEnemy?.name??(arena?.props.some(p=>same(p,focusCell))?arena.feature:null)??(same(focusCell,c.hero)?hero.name:tile.stair?'Stairway':`Floor +${tile.height}`)}</span><span>{danger+floorDanger>0?<em>{danger+floorDanger} incoming damage</em>:preview&&preview.length>1?<><Footprints size={13}/>{preview.length-1} tiles · 1 AP</>:<><ArrowUpRight size={13}/>{tile.stair?'Stairs connect adjacent floors':`Elevation +${elevation(c,focusCell)}`}</>}</span></div>
    {arena&&<div className="iso-environment-note"><strong>{arena.feature}</strong><span>{arena.description}</span></div>}
    <div className="iso-legend"><span><i className="iso-key-move"/>Reachable</span><span><i className="iso-key-threat"/>Incoming attack</span>{run.chapter>1&&<span><i className="iso-key-hazard"/>{chapter.hazard}</span>}<span><ArrowUpRight size={13}/>Stairs</span></div>
    <p className="iso-instructions">Follow stairs to change floors. Melee needs a connected edge; ranged attacks cross elevations. Zoom in to inspect terrain; the full battlefield fits at 100%.</p>
  </div>;
}
