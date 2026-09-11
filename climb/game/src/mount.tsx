import {createRoot} from 'react-dom/client';
import Home from './app/page';
import './app/globals.css';
export function mountGame(container:HTMLElement,address:string){const root=createRoot(container);root.render(<Home saveKey={'alphacity-climb-v1:'+address.toLowerCase()}/>);return ()=>root.unmount();}
