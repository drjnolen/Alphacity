import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function endpoint(value) {
    if (value === null || value === undefined || value === '') return '';
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('Service endpoints must be HTTPS origins without credentials, paths, or query strings.');
    }
    return url.origin;
}

// Purely local configuration: never contact Cloudflare or probe service health during publication.
export async function buildServiceConfig(root, env = process.env) {
    const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
    const defaults = await read('config/services.json');
    const climb = await read('climb/leaderboard-config.json');
    const intel = await read('intel/data-config.json');
    const urls = {
        climb: endpoint(env.CLIMB_LEADERBOARD_URL || climb.endpoint),
        intel: endpoint(env.INTEL_DATA_URL || intel.endpoint),
        openai: endpoint(env.OPENAI_PROXY_URL || defaults.openaiProxy),
    };
    const file = path.join(root, 'intel/index.html');
    const html = await readFile(file, 'utf8');
    const declaration = /const OPENAI_PROXY_URL = '[^']*';/;
    if (!declaration.test(html)) throw new Error('Intel proxy configuration declaration was not found.');
    // Replace the declaration only, never guards or other occurrences of the placeholder.
    const configured = html.replace(declaration, () => 'const OPENAI_PROXY_URL = ' + JSON.stringify(urls.openai).replace(/</g, '\\u003c') + ';');
    await writeFile(file, configured);
    await writeFile(path.join(root, 'climb/leaderboard-config.json'), JSON.stringify({ endpoint: urls.climb || null }) + '\n');
    await writeFile(path.join(root, 'intel/data-config.json'), JSON.stringify({ endpoint: urls.intel }) + '\n');
    return urls;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await buildServiceConfig(fileURLToPath(new URL('../', import.meta.url)));
    console.log('Public service configuration generated without backend deployment.');
}
