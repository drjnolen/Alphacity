import {readFile,writeFile,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw Error('Climb leaderboard requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN repository secrets. The token needs Workers Scripts: Edit, D1: Edit and account subdomain read access.');
if (!/^[a-f\d]{32}$/i.test(account)) throw Error('Invalid Cloudflare account ID.');
const apiBase = `https://api.cloudflare.com/client/v4/accounts/${account}`;
async function api(path, data) {
  const response = await fetch(apiBase + path, {
    method:data ? 'POST' : 'GET', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(data ? {body:JSON.stringify(data)} : {}), signal:AbortSignal.timeout(30000),
  });
  const value = await response.json();
  if (!response.ok || !value.success) throw Error(`Cloudflare ${path} failed (${response.status}). Check the token's D1 and Workers permissions. No credentials are printed.`);
  return value.result;
}
const template = JSON.parse(await readFile(new URL('api/climb-leaderboard/wrangler.json',root),'utf8'));
const name = template.d1_databases[0].database_name;
const databases = await api('/d1/database?name=' + encodeURIComponent(name));
let database = databases.find(d=>d.name===name);
if (!database) database = await api('/d1/database',{name});
if (!database.uuid) throw Error('Cloudflare did not return a D1 database ID.');
const subdomain = (await api('/workers/subdomain')).subdomain;
if (!/^[a-z0-9-]+$/.test(subdomain??'')) throw Error('Enable a workers.dev subdomain for this Cloudflare account before deployment.');
template.d1_databases[0].database_id = database.uuid;
const generated = new URL('api/climb-leaderboard/.wrangler.deploy.json',root);
await writeFile(generated,JSON.stringify(template,null,2));
try {
  // Idempotent initial schema. Future changes should use additive, versioned migrations.
  execFileSync('wrangler',['d1','execute',name,'--remote','--file',fileURLToPath(new URL('api/climb-leaderboard/schema.sql',root)),'--config',fileURLToPath(generated)],{stdio:'inherit',cwd:fileURLToPath(root)});
  execFileSync('wrangler',['deploy','--config',fileURLToPath(generated)],{stdio:'inherit',cwd:fileURLToPath(root)});
  const endpoint = `https://${template.name}.${subdomain}.workers.dev`;
  let healthy = false;
  for(let attempt=0;attempt<5;attempt++) {
    try {const response=await fetch(endpoint+'/v1/leaderboard',{signal:AbortSignal.timeout(10000)});const result=await response.json();healthy=response.ok&&Array.isArray(result.entries);}catch{}
    if(healthy)break;
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!healthy)throw Error('The leaderboard health check failed. Pages publication stopped; existing site stays deployed.');
  await writeFile(new URL('climb/leaderboard-config.json',root),JSON.stringify({endpoint})+'\n');
  console.log('Climb leaderboard is ready; public endpoint configuration generated.');
} finally {await unlink(generated).catch(()=>{});}
