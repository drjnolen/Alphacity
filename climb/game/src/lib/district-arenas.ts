import type { Position } from './game.ts';

export type DistrictArena = {
  name: string; rows: string[]; feature: string; description: string;
  props: Position[]; solid: boolean; damage: number; transit?: 'tunnel' | 'lift';
};
// Dots are physical floor; dashes are open void. Every footprint fits the 9 × 6 envelope.
export const DISTRICT_ARENAS: DistrictArena[] = [
  {name:'Rat-run junction',rows:['.....----','.......--','.........','.........','---......','-----....'],feature:'Rat-run tunnels',description:'Paired service tunnels connect B3 and G4. Crossing the tunnel counts as one movement step.',props:[{x:1,y:2},{x:6,y:3}],solid:false,damage:0,transit:'tunnel'},
  {name:'Exchange crossroads',rows:['---...---','---...---','.........','.........','---...---','---...---'],feature:'Off-chain kiosk',description:'End your turn beside the broker’s kiosk for 3 extra guard before security fires.',props:[{x:4,y:4}],solid:true,damage:0},
  {name:'Split furnace floor',rows:['......---','.........','...--....','.........','.........','---......'],feature:'Lava containment pools',description:'Lava deals 6 damage when you end your turn on it. Guard absorbs the heat.',props:[{x:6,y:2},{x:5,y:4}],solid:false,damage:6},
  {name:'Broadcast hub',rows:['--.....--','--.....--','.........','.........','---...---','---...---'],feature:'Pirate transmitter',description:'End beside the transmitter to reduce signature cooldown by one extra turn.',props:[{x:3,y:0}],solid:true,damage:0},
  {name:'Cold-storage corridor',rows:['---------','.........','.........','.........','---------','---------'],feature:'Frozen memory stacks',description:'Frozen archive stacks block the corridor. Take the side lanes to avoid execution beams.',props:[{x:3,y:1},{x:6,y:3}],solid:true,damage:0},
  {name:'Smuggler’s dock fingers',rows:['..--...--','..---..--','.........','.........','..--...--','..---..--'],feature:'Runoff pipes',description:'Leaking dock pipes leave toxic pools: 4 damage if you end your turn on a marked spill.',props:[{x:5,y:4},{x:1,y:4}],solid:false,damage:4},
  {name:'Synthetic garden courts',rows:['..-----..','.........','.........','.........','..-----..','..-----..'],feature:'Neural garden beacons',description:'Artificial trees conceal the compliance transmitters. Their bases block movement; watch the orange control grid.',props:[{x:0,y:4},{x:8,y:4}],solid:true,damage:0},
  {name:'Recalibration horseshoe',rows:['.........','.........','...---...','...---...','...---...','.........'],feature:'Reprogramming chambers',description:'Sealed neural pods divide the treatment wings. Circle the central shaft to outflank the nullifiers.',props:[{x:1,y:0},{x:7,y:4}],solid:true,damage:0},
  {name:'Sovereign’s ascent',rows:['------...','---......','.........','.........','---......','------...'],feature:'Executive elevators',description:'Linked elevators at D3 and H4 bridge the Spire’s floors. Riding between them counts as one movement step.',props:[{x:3,y:2},{x:7,y:3}],solid:false,damage:0,transit:'lift'},
];
export const arenaFor = (chapter?:number) => chapter ? DISTRICT_ARENAS[chapter-1] : undefined;

export const combatArena=(c:{layout?:number;arena?:DistrictArena})=>c.arena??arenaFor(c.layout);
