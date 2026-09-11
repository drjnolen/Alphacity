import type { Combat, Enemy, Position } from './game.ts';
import { boardCells } from './battlefield.ts';

export const BOSS_PROTOCOLS=[
 {name:'Warrant hunt',effect:'hunt',hint:'The Hound closes one tile after its marked pounce. Below half health, the search radius expands.'},
 {name:'Hostile liquidation',effect:'ledger',hint:'Ledger plating adds armor. Marked hits also confiscate up to 20 unsecured credits.'},
 {name:'Furnace barrage',effect:'fire',hint:'Molten impacts ignite the marked floor for the following turn. Phase II launches a wider barrage.'},
 {name:'Broadcast blackout',effect:'emp',hint:'Alternates signal sweeps with a cross-shaped blackout. A direct hit jams your next signature.'},
 {name:'Sequential erasure',effect:'erase',hint:'Sweeps two adjacent columns. Phase II repeats the previous erasure lane, so keep moving.'},
 {name:'Privateer broadside',effect:'shell',hint:'Alternates horizontal cannon fire and a close blast. The second phase also floods the opposite row.'},
 {name:'Forced restoration',effect:'heal',hint:'Restores 4 health to surviving escorts each turn, or 8 in phase II. Jamming the Curator stops restoration.'},
 {name:'Final sentence',effect:'sentence',hint:'Every third turn is an execution: +8 damage and signature suppression. Phase II widens its sentence.'},
 {name:'Dynasty collapse',effect:'sovereign',hint:'Three phases at 100%, 65%, and 30% health: Crownfire, Ledger Cross, then a wide Sovereign Purge.'},
] as const;
export function bossPlan(c:Combat,e:Enemy):{intent:Position[];phase:number;ability:string;extra:number} {
 const ch=c.chapter??1,phase=ch===9?(e.hp<=e.maxHp*.3?3:e.hp<=e.maxHp*.65?2:1):(e.hp<=e.maxHp*.5?2:1),cells=boardCells(c),h=c.hero;
 const radius=(p:Position,n:number)=>Math.abs(p.x-h.x)+Math.abs(p.y-h.y)<=n;
 let intent:Position[]=[],ability:string=BOSS_PROTOCOLS[ch-1].name,extra=0;
 switch(ch){
 case 1:intent=cells.filter(p=>radius(p,phase));ability=phase===2?'Bloodhound pursuit':'Warrant pounce';break;
 case 2:intent=cells.filter(p=>p.x===h.x||(phase===2&&p.y===h.y));e.armor=phase===2?6:3;ability=phase===2?'Total liquidation':'Asset seizure';break;
 case 3:intent=cells.filter(p=>radius(p,phase)||p.y===h.y&&p.x%2===c.round%2);ability=phase===2?'Meltdown barrage':'Molten barrage';break;
 case 4:intent=cells.filter(p=>c.round%2?p.y===h.y:p.x===h.x||p.y===h.y);ability=c.round%2?'Carrier sweep':'Network blackout';break;
 case 5:intent=cells.filter(p=>p.x===h.x||p.x===(h.x+1)%9||(phase===2&&p.x===(e.lastColumn??-1)));ability=phase===2?'Recursive erasure':'Column deletion';e.lastColumn=h.x;break;
 case 6:intent=cells.filter(p=>c.round%2?p.y===h.y||(phase===2&&p.y===(h.y+3)%6):radius(p,phase));ability=c.round%2?'Port broadside':'Depth charge';break;
 case 7:intent=cells.filter(p=>radius(p,phase)||p.x===h.x&&p.y%2===c.round%2);ability=phase===2?'Compulsory renewal':'Devotion pulse';break;
 case 8:intent=cells.filter(p=>p.x===h.x||(phase===2&&p.y===h.y));extra=c.round%3===0?8:0;ability=extra?'FINAL SENTENCE':'Recalibration beam';break;
 case 9:intent=cells.filter(p=>phase===1?p.x===h.x:phase===2?p.x===h.x||p.y===h.y:radius(p,2)||p.x===(h.x+4)%9);ability=['Crownfire','Ledger Cross','Sovereign Purge'][phase-1];e.armor=2+phase*2;extra=phase===3?5:0;break;
 }
 return {intent,phase,ability,extra};
}
