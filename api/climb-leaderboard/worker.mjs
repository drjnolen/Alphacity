import {verifyPersonalMessageSignature} from '@mysten/sui/verify';
import {SuiGrpcClient} from '@mysten/sui/grpc';
import {fetchEligibility} from '../../climb/eligibility.mjs';

export const SEASON = 'uprising-1';
const HEROES = ['glitchborn', 'chainbreaker', 'nodewalker', 'coinbroker'];
const DAY = 86_400_000;
const MAX_RUN_AGE = 30 * DAY;
const SESSION_AGE = DAY;
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const walletAddress = value => /^0x[\da-f]{64}$/i.test(value ?? '') ? value.toLowerCase() : fail(400, 'Invalid wallet address.');
const idValue = value => typeof value === 'string' && /^[\w-]{10,80}$/.test(value) ? value : fail(400, 'Invalid run or challenge ID.');
export function usernameValue(value) {
  const name = typeof value === 'string' ? value.trim().replace(/ +/g, ' ') : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{2,19}$/.test(name)) fail(400, 'Use 3–20 letters, numbers, spaces, underscores or hyphens. Start with a letter or number.');
  return name;
}
async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
async function bodyOf(request) {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) fail(415, 'JSON is required.');
  if (Number(request.headers.get('content-length')) > 16384) fail(413, 'Request too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Missing request.');
  const chunks = []; let length = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length; if (length > 16384) { await reader.cancel(); fail(413, 'Request too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; }
  catch { fail(400, 'Invalid JSON request.'); }
}
const runView = r => ({id:r.id, heroId:r.hero_id, startedAt:r.started_at, level:r.level, elapsedMs:r.elapsed_ms, outcome:r.outcome});
const rankColumns = 'b.wallet, p.username, b.hero_id AS heroId, b.level, b.elapsed_ms AS elapsedMs';
const ranking = 'b.level DESC, b.elapsed_ms ASC, b.achieved_at ASC, b.wallet ASC';

async function checkHoldings(wallet, env) {
  const rpc = async (method, params) => {
    const response = await fetch(env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0', id:1, method, params}), signal:AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error('RPC unavailable');
    const json = await response.json(); if (json.error) throw Error('RPC unavailable'); return json.result;
  };
  return (await fetchEligibility(rpc, wallet)).allowed;
}

// Dependency injection is for tests; production always verifies signatures and CITY holdings.
export function createWorker({now = Date.now, verify = verifyPersonalMessageSignature, eligible = checkHoldings} = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get('Origin');
      const allowed = (env.ALLOWED_ORIGINS || 'https://alphacity.tech,https://www.alphacity.tech').split(',').map(s => s.trim());
      const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Origin', 'X-Content-Type-Options':'nosniff'};
      if (allowed.includes(origin)) Object.assign(headers, {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization', 'Access-Control-Max-Age':'600'});
      const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers});
      try {
        const url = new URL(request.url), path = url.pathname;
        if (origin && !allowed.includes(origin)) fail(403, 'This origin is not allowed.');
        if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
        if (!env.DB) fail(503, 'Leaderboard is not configured.');
        const authPath = path.startsWith('/v1/auth/');
        const limiter = authPath ? env.AUTH_LIMITER : env.API_LIMITER;
        if (!limiter || !(await limiter.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'})).success) fail(429, 'Too many requests. Please wait a minute and retry.');
        const db = env.DB, time = now();
        const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
        if (request.method === 'GET' && path === '/v1/leaderboard') {
          const hero = url.searchParams.get('class') || 'all';
          if (hero !== 'all' && !HEROES.includes(hero)) fail(400, 'Unknown class.');
          const wallet = url.searchParams.has('wallet') ? walletAddress(url.searchParams.get('wallet')) : null;
          const where = hero === 'all' ? '' : ' AND b.hero_id = ?';
          const args = hero === 'all' ? [SEASON] : [SEASON, hero];
          const ranked = `SELECT ${rankColumns}, ROW_NUMBER() OVER (ORDER BY ${ranking}) AS rank FROM best_runs b JOIN profiles p ON p.wallet=b.wallet WHERE b.season=?${where}`;
          const rows = await stmt(`SELECT * FROM (${ranked}) ORDER BY rank LIMIT 50`, ...args).all();
          const me = wallet ? await stmt(`SELECT * FROM (${ranked}) WHERE wallet=?`, ...args, wallet).first() : null;
          const profile = wallet ? await stmt('SELECT username FROM profiles WHERE wallet=?', wallet).first() : null;
          return json({season:SEASON, entries:rows.results, me, username:profile?.username ?? '', clock:'elapsed'});
        }
        if (request.method !== 'POST') fail(404, 'Not found.');
        if (!origin || !allowed.includes(origin)) fail(403, 'An allowed Origin is required.');
        const data = await bodyOf(request);
        if (path === '/v1/auth/challenge') {
          const wallet = walletAddress(data.wallet), id = crypto.randomUUID(), expiresAt = time + 300000;
          const message = `Alpha City Climb leaderboard\nSign in to record ranked runs and choose a public username.\nNo transaction or fee.\nOrigin: ${origin}\nWallet: ${wallet}\nNonce: ${id}\nExpires: ${new Date(expiresAt).toISOString()}`;
          await stmt('INSERT INTO challenges VALUES (?,?,?,?,?)', id, wallet, origin, message, expiresAt).run();
          return json({id, message, expiresAt});
        }
        if (path === '/v1/auth/session') {
          const challenge = await stmt('SELECT * FROM challenges WHERE id=? AND origin=? AND expires_at>?', idValue(data.id), origin, time).first();
          if (!challenge) fail(401, 'This sign-in request expired. Please retry.');
          if (typeof data.signature !== 'string' || data.signature.length > 12000) fail(400, 'Invalid signature.');
          try { await verify(new TextEncoder().encode(challenge.message), data.signature, {address:challenge.wallet, client:new SuiGrpcClient({network:'mainnet', baseUrl:env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443'})}); }
          catch { fail(401, 'Wallet ownership could not be verified. Please sign in again.'); }
          let qualifies;
          try { qualifies = await eligible(challenge.wallet, env); }
          catch { fail(503, 'CITY holdings could not be checked. Please retry.'); }
          if (!qualifies) fail(403, 'Ranked play requires 5,000,000 CITY held or staked.');
          const consumed = await stmt('DELETE FROM challenges WHERE id=? AND expires_at>? RETURNING id', challenge.id, now()).first();
          if (!consumed) fail(401, 'This sign-in request has already been used or expired.');
          const token = crypto.randomUUID() + crypto.randomUUID(), expiresAt = now() + SESSION_AGE;
          await stmt('INSERT INTO sessions VALUES (?,?,?,?)', await hash(token), challenge.wallet, origin, expiresAt).run();
          return json({token, expiresAt, wallet:challenge.wallet});
        }
        const bearer = request.headers.get('Authorization')?.match(/^Bearer ([\w-]{72})$/)?.[1];
        if (!bearer) fail(401, 'Sign in to the leaderboard to sync this run.');
        const session = await stmt('SELECT wallet FROM sessions WHERE token_hash=? AND origin=? AND expires_at>?', await hash(bearer), origin, time).first();
        if (!session) fail(401, 'Your leaderboard session expired. Sign in again to sync.');
        const wallet = session.wallet;
        if (path === '/v1/profile') {
          const username = usernameValue(data.username);
          try { await stmt('INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(wallet) DO UPDATE SET username=excluded.username, username_key=excluded.username_key', wallet, username, username.toLowerCase()).run(); }
          catch (error) { if (/UNIQUE constraint failed.*username_key/i.test(error.message)) fail(409, 'That username is taken. Choose another.'); throw error; }
          return json({username});
        }
        if (path === '/v1/runs') {
          const clientId = idValue(data.clientId);
          if (!HEROES.includes(data.heroId)) fail(400, 'Unknown class.');
          await stmt('INSERT INTO runs (id,wallet,season,client_id,hero_id,started_at,checkpoint_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(wallet,season,client_id) DO NOTHING', crypto.randomUUID(), wallet, SEASON, clientId, data.heroId, time, time).run();
          const run = await stmt('SELECT * FROM runs WHERE wallet=? AND season=? AND client_id=?', wallet, SEASON, clientId).first();
          if (run.hero_id !== data.heroId || run.outcome || time - run.started_at > MAX_RUN_AGE) fail(409, 'This ranked run is closed. Start a new campaign.');
          return json(runView(run));
        }
        const route = path.match(/^\/v1\/runs\/([\w-]+)\/(checkpoint|finish)$/);
        if (!route) fail(404, 'Not found.');
        const run = await stmt('SELECT * FROM runs WHERE id=? AND wallet=? AND season=?', idValue(route[1]), wallet, SEASON).first();
        if (!run) fail(404, 'Ranked run not found for this wallet.');
        if (time - run.started_at > MAX_RUN_AGE) fail(410, 'This ranked run expired after 30 days.');
        if (route[2] === 'checkpoint') {
          const level = data.level;
          if (!Number.isInteger(level) || level < 1 || level > 9) fail(400, 'Invalid district.');
          if (level > run.level) {
            if (run.outcome) fail(409, 'This run is already finished.');
            if (level !== run.level + 1) fail(409, 'Clear districts in order. Sync earlier checkpoints first.');
            // A low sanity floor, not proof of honest combat. Delayed/offline delivery counts as elapsed time.
            if (time - run.started_at < level * 15000) fail(422, 'Checkpoint arrived too quickly. Please retry shortly.');
            await stmt('UPDATE runs SET level=?, elapsed_ms=?-started_at, checkpoint_at=? WHERE id=? AND level=? AND outcome IS NULL', level, time, time, run.id, level-1).run();
          }
          // Replay-safe: retries use the original server checkpoint timestamp, never a client time.
          await stmt(`INSERT INTO best_runs (season,wallet,run_id,hero_id,level,elapsed_ms,achieved_at)
            SELECT season,wallet,id,hero_id,level,elapsed_ms,checkpoint_at FROM runs WHERE id=? AND level>0
            ON CONFLICT(season,wallet) DO UPDATE SET run_id=excluded.run_id,hero_id=excluded.hero_id,level=excluded.level,elapsed_ms=excluded.elapsed_ms,achieved_at=excluded.achieved_at
            WHERE excluded.level>best_runs.level OR (excluded.level=best_runs.level AND excluded.elapsed_ms<best_runs.elapsed_ms)`, run.id).run();
        } else {
          if (!['defeat','abandon','complete'].includes(data.outcome)) fail(400, 'Invalid run outcome.');
          if (data.outcome === 'complete' && run.level !== 9) fail(409, 'All nine districts must be cleared before completion.');
          if (run.outcome && run.outcome !== data.outcome) fail(409, 'This run already has a different outcome.');
          await stmt('UPDATE runs SET outcome=?, ended_at=? WHERE id=? AND outcome IS NULL', data.outcome, time, run.id).run();
        }
        return json(runView(await stmt('SELECT * FROM runs WHERE id=?', run.id).first()));
      } catch (error) { return json({error:error.status ? error.message : 'Leaderboard is temporarily unavailable. Your game can continue.'}, error.status || 503); }
    },
    async scheduled(_event, env) {
      const time = now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM challenges WHERE expires_at<?').bind(time),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(time),
        // Published personal bests are independent of the short-lived run journal.
        env.DB.prepare('DELETE FROM runs WHERE started_at<?').bind(time - MAX_RUN_AGE - DAY),
      ]);
    },
  };
}
export default createWorker();
