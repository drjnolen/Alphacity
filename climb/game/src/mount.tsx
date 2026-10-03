import {createRoot} from 'react-dom/client';
import Home from './app/page';
import type {LeaderboardClient} from './lib/leaderboard';
import './app/globals.css';
export function mountGame(container:HTMLElement,address:string,options:{leaderboard?:LeaderboardClient}={}){const root=createRoot(container);root.render(<Home saveKey={'alphacity-climb-v1:'+address.toLowerCase()} leaderboardClient={options.leaderboard}/>);return ()=>root.unmount();}
