import type {DistrictArena} from './district-arenas.ts';
import { arenaFor, combatArena } from './district-arenas.ts';
import type { Combat, Position } from './game.ts';

export type TerrainId = 'terraces' | 'concourse' | 'gantry' | 'flat';
export type TerrainCell = Position & { height: number; stair?: 'x+' | 'x-' | 'y-' };
export const BOARD_COLUMNS = 9;
export const BOARD_ROWS = 6;
export const BOARD_SIZE = BOARD_COLUMNS * BOARD_ROWS;
export const CELLS: Position[] = Array.from({ length: BOARD_SIZE }, (_, i) => ({ x: i % BOARD_COLUMNS, y: Math.floor(i / BOARD_COLUMNS) }));
export const terrainForChapter = (chapter: number): TerrainId =>
  (['terraces', 'concourse', 'terraces', 'gantry', 'concourse', 'gantry', 'concourse', 'gantry', 'terraces'] as TerrainId[])[chapter - 1] ?? 'terraces';
export const terrainName = (id?: TerrainId) => ({ terraces: 'Stacked terraces', concourse: 'Elevated concourse', gantry: 'Central gantry', flat: 'Street level' })[id ?? 'flat'];
export const boardCells = (c: {layout?:number;arena?:DistrictArena}) => {const arena=combatArena(c);return arena?CELLS.filter(p=>arena.rows[p.y]?.[p.x]==='.'):CELLS;};
export const hasTile = (c: {layout?:number;arena?:DistrictArena}, p:Position) => onBoard(p) && (!combatArena(c) || combatArena(c)?.rows[p.y]?.[p.x]==='.');
const equal = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
export const onBoard = (p: Position) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < BOARD_COLUMNS && p.y >= 0 && p.y < BOARD_ROWS;
export const neighbors = (p: Position): Position[] => [{ x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 }].filter(onBoard);

export function terrainCell(id: TerrainId | undefined, p: Position): TerrainCell {
  if (id === 'terraces') {
    if (p.x === 2 && (p.y === 1 || p.y === 3 || p.y === 5)) return { ...p, height: .5, stair: 'x+' };
    if (p.x === 4 && (p.y === 0 || p.y === 2 || p.y === 4)) return { ...p, height: 1.5, stair: 'x+' };
    return { ...p, height: p.x >= 5 ? 2 : p.x >= 3 ? 1 : 0 };
  }
  if (id === 'concourse') {
    if (p.y === 2 && (p.x === 1 || p.x === 4 || p.x === 7)) return { ...p, height: .5, stair: 'y-' };
    return { ...p, height: p.y <= 1 ? 1 : 0 };
  }
  if (id === 'gantry') {
    if (p.x === 1 && (p.y === 1 || p.y === 3 || p.y === 5)) return { ...p, height: .5, stair: 'x+' };
    if (p.x === 4 && (p.y === 0 || p.y === 2 || p.y === 4)) return { ...p, height: .5, stair: 'x-' };
    return { ...p, height: p.x >= 2 && p.x <= 4 ? 1 : 0 };
  }
  // Battles saved before elevation keep their existing topology until the next encounter.
  return { ...p, height: 0 };
}

export const elevation = (c: Pick<Combat, 'terrain'>, p: Position) => terrainCell(c.terrain, p).height;

/** A stair is a real connection along its run; sheer faces never connect. */
export function connected(c: {terrain?:TerrainId;layout?:number;arena?:DistrictArena}, a: Position, b: Position): boolean {
  if (!hasTile(c,a) || !hasTile(c,b) || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  const from = terrainCell(c.terrain, a), to = terrainCell(c.terrain, b), delta = Math.abs(from.height - to.height);
  if (delta === 0) return true;
  if (delta > .5) return false;
  const stair = from.stair ?? to.stair;
  return !!stair && (stair.startsWith('x') ? a.y === b.y : a.x === b.x);
}

/** One shared pathfinder for rules, previews, and animated travel. */
export function route(c: Combat, from: Position, to: Position, max = BOARD_SIZE, actor: 'hero' | 'enemy' = 'hero'): Position[] {
  if (!hasTile(c,from) || !hasTile(c,to)) return [];
  const blocked = (p: Position) => c.obstacles.some(o => equal(o, p)) || c.enemies.some(e => e.hp > 0 && equal(e, p) && !(actor === 'enemy' && equal(e, from)));
  if (blocked(to)) return [];
  const queue: Position[][] = [[{ x: from.x, y: from.y }]], seen = new Set([`${from.x},${from.y}`]);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i], p = path[path.length - 1];
    if (equal(p, to)) return path;
    if (path.length - 1 >= max) continue;
    const transit=combatArena(c)?.transit ? combatArena(c)!.props : [];
    const exits=transit.some(t=>equal(t,p)) ? transit.filter(t=>!equal(t,p)) : [];
    for (const q of [...neighbors(p),...exits]) {
      const key = `${q.x},${q.y}`;
      if (seen.has(key) || (!connected(c, p, q) && !exits.some(t=>equal(t,q))) || blocked(q)) continue;
      seen.add(key); queue.push([...path, q]);
    }
  }
  return [];
}

export function terrainObstacles(id: TerrainId, proposed: Position[], layout?:number, occupied:Position[]=[],arena?:DistrictArena): Position[] {
  // A prop must not seal a landing or leave a disconnected pocket of floor.
  const placed: Position[] = [];
  const spawns = occupied.length?occupied:[{x:0,y:2},{x:4,y:1},{x:8,y:5},{x:6,y:0},{x:8,y:1}];
  for (const p of [...proposed,{x:1,y:0},{x:0,y:0},{x:1,y:3},{x:3,y:2},{x:4,y:3}]) {
    if (placed.length === proposed.length) break;
    if (!hasTile({layout,arena},p) || terrainCell(id,p).stair || spawns.some(s=>equal(s,p)) || placed.some(o=>equal(o,p))) continue;
    const blocked = [...placed,p], open = boardCells({layout,arena}).filter(q=>!blocked.some(o=>equal(o,q)));
    const queue = [open[0]], seen = new Set([`${open[0].x},${open[0].y}`]);
    for (let i=0;i<queue.length;i++) for (const q of neighbors(queue[i])) {
      const key = `${q.x},${q.y}`;
      if (seen.has(key) || blocked.some(o=>equal(o,q)) || !connected({terrain:id,layout,arena},queue[i],q)) continue;
      seen.add(key);queue.push(q);
    }
    if (seen.size === open.length) placed.push(p);
  }
  return placed;
}

export const ISO = { width: 1240, height: 920, halfWidth: 76, halfDepth: 38, rise: 54, originX: 122, originY: 610 };
export function project(p: Position, height = 0) {
  return { x: ISO.originX + (p.x + p.y) * ISO.halfWidth, y: ISO.originY + (p.y - p.x) * ISO.halfDepth - height * ISO.rise };
}
export const projectCell = (c: Pick<Combat, 'terrain'>, p: Position) => project(p, elevation(c, p));
export const tileLabel = (p: Position) => `${'ABCDEFGHI'[p.x]}${p.y + 1}`;

/** A sloping hit surface follows the stair run instead of floating above its treads. */
export function surfaceCorners(cell: TerrainCell, inset = .04): Position[] {
  return [[inset,inset],[1-inset,inset],[1-inset,1-inset],[inset,1-inset]].map(([u,v]) => {
    const height = !cell.stair ? cell.height : Math.floor(cell.height) + (cell.stair === 'x+' ? u : cell.stair === 'x-' ? 1-u : 1-v);
    return project({ x: cell.x-.5+u, y: cell.y-.5+v },height);
  });
}

export function sceneBounds(c:Combat) {
 const pts=boardCells(c).map(p=>projectCell(c,p)),xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
 const x=Math.min(...xs)-88,y=Math.min(...ys)-188;
 return {x,y,width:Math.max(...xs)+88-x,height:Math.max(...ys)+72-y};
}
