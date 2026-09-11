import {enemyDamage, weaponType} from './equipment.ts';
import {BOSS_PROTOCOLS} from './bosses.ts';
import { arenaFor, combatArena } from './district-arenas.ts';
import { BOARD_SIZE, route } from './battlefield.ts';
import { armorGuard, heroFor, enemyPortrait, poisonDamage, same, distance, blinkLanding, type GameAction, type Position, type Run, type Combat } from './game.ts';

export type CombatCue = {
  bossEffect?:string;phaseChange?:boolean;
  kind: 'move' | 'strike' | 'signature' | 'end' | 'guard' | 'heal';
  title: string; subtitle: string; tone: string; duration: number;
  source: Position; target: Position; destination?: Position; path?: Position[];
  impacts: { position: Position; text: string; tone: string; delay: number; killed?: boolean; enemyId?: number }[];
  attacks: { source: Position; tiles: Position[]; delay: number; boss: boolean; effect?:string }[];
  movements: { source: Position; target: Position; portrait: number; delay: number; path: Position[]; enemyId: number }[];
  hazards: Position[]; victory: boolean; revived: boolean;
};

export function movementPath(c: Combat, target: Position): Position[] { return route(c,c.hero,target); }

// Presentation describes an already validated transition; it never applies game rules.
export function combatFeedback(before: Run, after: Run, action: GameAction): CombatCue | null {
  const c = before.combat;
  if (before === after || before.mode !== 'combat' || !c || !['move','attack','end','guard','heal'].includes(action.type)) return null;
  const kind = action.type === 'attack' ? action.skill ? 'signature' : 'strike' : action.type as CombatCue['kind'];
  const hero = heroFor(before), target = action.type === 'attack' ? c.enemies.find(e => e.id === action.id)! : c.hero;
  const cue: CombatCue = {
    kind, title: kind === 'signature' ? hero.skill : kind === 'strike' ? 'Strike' : kind === 'move' ? 'Reposition' : kind === 'guard' ? 'Brace' : kind === 'heal' ? 'Second wind' : 'Security responds',
    subtitle: kind === 'signature' ? `${hero.name} · SIGNATURE ABILITY` : kind === 'end' ? 'ENEMY TURN' : `${hero.name} · ${kind === 'move' ? 'MOVEMENT' : 'ACTION'}`,
    tone: kind === 'end' ? 'enemy' : kind === 'guard' ? 'gold' : kind === 'heal' ? 'heal' : before.heroId,
    duration: kind === 'move' ? 420 : kind === 'signature' ? 1150 : kind === 'end' ? 1600 : 850,
    source: c.hero, target, impacts: [], attacks: [], movements: [], hazards: [], victory: after.mode === 'reward', revived: !before.phoenixUsed && after.phoenixUsed,
  };
  const boss=c.enemies.find(e=>e.type==='boss'),newBoss=after.combat?.enemies.find(e=>e.type==='boss');
  if(c.bossRules&&boss&&!(boss.jammed??0)&&boss.hp>(boss.poison>0?poisonDamage(before):0)&&kind==='end'){cue.bossEffect=BOSS_PROTOCOLS[before.chapter-1].effect;cue.title=boss.ability??cue.title;cue.subtitle=`${boss.name} · PHASE ${boss.phase??1}`;}
  cue.phaseChange=!!(newBoss&&boss&&(newBoss.phase??1)>(boss.phase??1));
  if (after.combat && !same(c.hero, after.combat.hero)) cue.destination = after.combat.hero;
  if (kind === 'move' && cue.destination) { cue.path = movementPath(c,cue.destination); cue.duration = Math.max(500,(cue.path.length-1)*180); }
  // A lethal blink clears combat in the engine; preserve its adjacent landing for the finish.
  if (kind === 'signature' && before.heroId === 'glitchborn' && !cue.destination && cue.victory) {
    cue.destination = blinkLanding(c,target);
  }
  if(kind==='signature'&&before.heroId==='coinbroker')cue.subtitle='VEX · TARGET JAMMED';
  const impactTime = kind === 'signature' ? 380 : kind === 'end' ? 100 : 190;
  for (const enemy of c.enemies) {
    const survivor = after.combat?.enemies.find(e => e.id === enemy.id);
    const loss = enemy.hp - (survivor?.hp ?? 0);
    if(loss<0)cue.impacts.push({position:enemy,text:`+${-loss} RESTORED`,tone:'heal',delay:900,enemyId:enemy.id});
    const critical=after.lastHits?.some(h=>h.target==='enemy'&&h.enemyId===enemy.id&&h.critical);
    if (loss > 0) cue.impacts.push({ position: enemy, text: `−${loss}${critical?' CRIT':''}`, tone: kind === 'end' ? 'poison' : cue.tone, delay: impactTime, killed: !survivor, enemyId: enemy.id });
  }
  if(action.type==='attack'&&after.salvage>before.salvage)cue.impacts.push({position:target,text:`+${after.salvage-before.salvage} CREDITS`,tone:'gold',delay:500});
  if(action.type==='attack'&&after.combat?.enemies.some(e=>e.id===action.id)&&['Kinetic','Enertech'].includes(weaponType(before)??''))cue.impacts.push({position:target,text:weaponType(before)==='Kinetic'?'SLOWED':'SUPPRESSED',tone:'heal',delay:500});
  if (kind === 'guard' && after.combat) cue.impacts.push({position:c.hero,text:`+${after.combat.block-c.block} GUARD`,tone:'gold',delay:150});
  if (kind === 'heal') cue.impacts.push({position:c.hero,text:`+${after.hp-before.hp}`,tone:'heal',delay:150});
  if (kind === 'signature' && before.heroId === 'chainbreaker' && after.combat) cue.impacts.push({position:c.hero,text:`+${after.combat.block-c.block} GUARD`,tone:'gold',delay:500});
  if (kind === 'end' && !cue.victory) {
    const living = c.enemies.filter(e => e.hp > (e.poison > 0 ? poisonDamage(before) : 0));
    living.forEach((e, i) => {
      const delay = 280 + i * 160;
      if (!e.advancing && !(e.jammed??0)) cue.attacks.push({source:e,tiles:e.intent,delay,boss:e.type === 'boss',effect:e.type==='boss'?cue.bossEffect:undefined});
      const next = after.combat?.enemies.find(n => n.id === e.id);
      if (next && !same(e,next)) cue.movements.push({source:e,target:next,portrait:enemyPortrait(before,e),delay,path:after.combat?.travel?.find(t=>t.enemyId===e.id)?.path??route(c,e,next,BOARD_SIZE,'enemy'),enemyId:e.id});
    });
    const arena=combatArena(c);
    cue.hazards = [...(c.hazards ?? []),...(arena?.damage?arena.props:[])];
    const total = living.filter(e=>!(e.jammed??0)&&e.intent.some(p=>same(p,c.hero))).reduce((sum,e)=>sum+(after.lastHits?.find(h=>h.target==='hero'&&h.enemyId===e.id)?.damage??enemyDamage(e)),0)+(c.hazards?.some(p=>same(p,c.hero))?(c.hazardDamage??0):0)+(arena?.props.some(p=>same(p,c.hero))?arena.damage:0);
    const absorbed = Math.min(total,c.block+(before.gear.charm==='armor'?armorGuard(before):0)+(before.gear.chassis==='mantle'?2+(before.ranks.mantle??0):0)+(c.layout===2&&arena?.props.some(p=>distance(p,c.hero)===1)?3:0));
    if(absorbed) cue.impacts.push({position:c.hero,text:`${absorbed} BLOCKED`,tone:'gold',delay:670});
    if(total>absorbed) cue.impacts.push({position:c.hero,text:`−${Math.min(before.hp,total-absorbed)}`,tone:'enemy',delay:830});
    if(!total) cue.impacts.push({position:c.hero,text:'EVADED',tone:'heal',delay:670});
    if(cue.revived){cue.impacts.push({position:c.hero,text:`+${after.hp} REBORN`,tone:'gold',delay:1080});cue.duration=1850;cue.title='Dead-Man Core online';}
  }
  if(after.lastHits?.some(h=>h.critical)){cue.title=kind==='end'?'Enemy critical strike':'Critical strike';cue.subtitle+=' · 2× DAMAGE';}
  if (cue.victory) cue.duration += 400;
  return cue;
}
