import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !/^[a-f\d]{32}$/i.test(account)) {
    throw new Error('Intel data deployment requires the existing CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN repository secrets.');
}
const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/subdomain', {
    headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000),
});
const result = await response.json();
const subdomain = result?.result?.subdomain;
if (!response.ok || !result.success || !/^[a-z0-9-]+$/.test(subdomain || '')) {
    throw new Error('Cannot resolve the Cloudflare workers.dev subdomain. Check account subdomain read access.');
}
const config = new URL('api/intel-data/wrangler.json', root);
const template = JSON.parse(await readFile(config, 'utf8'));
execFileSync('wrangler', ['deploy', '--config', fileURLToPath(config)], { stdio: 'inherit', cwd: fileURLToPath(root) });
const endpoint = 'https://' + template.name + '.' + subdomain + '.workers.dev';
let healthy = false;
for (let attempt = 0; attempt < 5; attempt++) {
    try {
        const health = await fetch(endpoint + '/health', { signal: AbortSignal.timeout(10000) });
        const payload = await health.json();
        healthy = health.ok && payload.version === 1 && payload.ok === true;
    } catch (_) {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
}
if (!healthy) throw new Error('Intel data health check failed; service deployment failed.');
await writeFile(new URL('intel/data-config.json', root), JSON.stringify({ endpoint }) + '\n');
console.log('Intel data Worker is ready; public endpoint configuration generated.');
