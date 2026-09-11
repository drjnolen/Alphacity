import { arenaFor, type DistrictArena } from './district-arenas.ts';
import { terrainForChapter, terrainCell, connected, neighbors, type TerrainId } from './battlefield.ts';
import type { Position } from './game.ts';

export const ENCOUNTERS=['bridge','garden','gate','detour','guardian'] as const;
const MASKS=[
 ['.....----','.......--','.........','.........','---......','-----....'],
 ['---------','.........','.........','.........','---------','---------'],
 ['---...---','---...---','.........','.........','---...---','---...---'],
 ['..--...--','..---..--','.........','.........','..--...--','..---..--'],
 ['.........','.........','...---...','...---...','...---...','.........'],
 ['......---','.........','...--....','.........','.........','---......'],
 ['--.....--','--.....--','.........','.........','---...---','---...---'],
 ['..-----..','.........','.........','.........','..-----..','..-----..'],
 ['------...','---......','.........','.........','---......','------...'],
];
// Explicit geography per named route. Each district uses five different footprints.
const SHAPES=[[0,1,2,3,8],[2,1,5,7,4],[5,3,8,1,2],[6,1,4,3,8],[1,3,2,0,4],[3,8,2,1,5],[7,1,2,3,6],[4,1,5,0,8],[8,1,4,3,2]];
const ROOMS=[
 ['Shelter junction','Abandoned rail platform','Warrant barricade','Rat-run service fingers','Hound tracking chamber'],
 ['Exchange crossroads','Off-chain trading aisle','Liquidation vault','Ticker courtyards','Debt tribunal'],
 ['Split assembly floor','Geothermal intake docks','Siege loading ramp','Scrap conveyor lane','Titan furnace crucible'],
 ['Dish approach hub','Narrow signal trench','Censor battery horseshoe','Cable-run maintenance fingers','Censor Prime command dais'],
 ['Cold-storage corridor','Server catacomb branches','Deletion checkpoint','Legacy-stack junction','Erasure core chamber'],
 ['Container dock fingers','Crane loading ramp','Boarding checkpoint','Dry-dock channel','Lockjaw cannon deck'],
 ['Garden gate courts','Loyalty promenade','Devotion checkpoint','Synthetic orchard paths','Curator compliance pavilion'],
 ['Intake horseshoe','Recalibration corridor','Neural execution wing','Patient-transfer junction','Judicator sentencing dais'],
 ['Onyx ascent','Dynasty causeway','Praetorian barricade','Executive gallery wings','Sovereign throne nexus'],
];
const key=(p:Position)=>`${p.x},${p.y}`;
export function encounterArena(chapter:number,nodeId:string):{arena:DistrictArena;terrain:TerrainId}{
 const index=Math.max(0,ENCOUNTERS.indexOf(nodeId as typeof ENCOUNTERS[number])),base=arenaFor(chapter)!,rows=MASKS[SHAPES[chapter-1][index]],floor=rows.flatMap((row,y)=>[...row].flatMap((c,x)=>c==='.'?[{x,y}]:[]));
 const arena:DistrictArena={...base,rows:[...rows],props:[],name:ROOMS[chapter-1][index]};
 const options=[terrainForChapter(chapter),...(['concourse','terraces','gantry','flat'] as TerrainId[])];
 const unique=[...new Set([...(index===1?['flat' as TerrainId]:index===3?['gantry' as TerrainId,'concourse' as TerrainId]:[]),...options])];
 // Select a real elevation scheme only when every floor tile connects through stairs.
 const terrain=unique.find(terrain=>{const context={terrain,arena},seen=new Set([key(floor[0])]),queue=[floor[0]];for(let i=0;i<queue.length;i++)for(const p of neighbors(queue[i])){if(!seen.has(key(p))&&connected(context,queue[i],p)){seen.add(key(p));queue.push(p);}}return seen.size===floor.length;})!;
 const candidates=floor.filter(p=>!terrainCell(terrain,p).stair&&!(p.x===0&&p.y===2));
 base.props.forEach((p,i)=>{const target={x:(p.x+index*2+i)%9,y:(p.y+index)%6},chosen=candidates.filter(q=>!arena.props.some(v=>key(v)===key(q))).sort((a,b)=>(Math.abs(a.x-target.x)+Math.abs(a.y-target.y))-(Math.abs(b.x-target.x)+Math.abs(b.y-target.y)))[0];if(chosen)arena.props.push(chosen);});
 if(base.transit)arena.description=`Linked ${base.transit==='lift'?'elevators':'rat-run tunnels'} at ${arena.props.map(p=>`${'ABCDEFGHI'[p.x]}${p.y+1}`).join(' and ')} connect this ${index===4?'commander chamber':'route'}. Crossing costs one movement step.`;
 else arena.description=`${ROOMS[chapter-1][index]}. ${base.description}`;
 return {arena,terrain};
}
