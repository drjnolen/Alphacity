// No dependency on the game's render loop. Network activity happens at run boundaries only.
export function createLeaderboardClient({wallet, sign, isCurrent, storage, fetcher = fetch, origin = location.origin}) {
  let endpoint, session, authenticating;
  const key = 'alphacity-climb-leaderboard-session:' + wallet.toLowerCase();
  const current = () => { if (!isCurrent()) throw Error('Wallet changed. Reopen the game with the original wallet.'); };
  const read = () => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
  const save = value => { session = value; try { if (value) storage.setItem(key, JSON.stringify(value)); else storage.removeItem(key); } catch {} };
  async function configuration() {
    current();
    if (endpoint !== undefined) return endpoint;
    const result = await fetcher('/climb/leaderboard-config.json', {cache:'no-store', signal:AbortSignal.timeout(10000)});
    if (!result.ok) throw Error('Leaderboard configuration could not be loaded. Please retry.');
    const data = await result.json();
    if (!data.endpoint) return endpoint = null;
    const url = new URL(data.endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw Error('Invalid leaderboard service address.');
    return endpoint = url.origin;
  }
  async function request(path, data, authorized = false) {
    const base = await configuration();
    if (!base) throw Error('The shared leaderboard has not been connected yet. You can still play unranked.');
    current();
    const headers = {'Content-Type':'application/json'};
    if (authorized) {
      session ??= read();
      if (!session || session.wallet !== wallet.toLowerCase() || session.endpoint !== base || session.expiresAt <= Date.now()) {
        save(null); throw Error('Sign in to sync your leaderboard results.');
      }
      headers.Authorization = 'Bearer ' + session.token;
    }
    const response = await fetcher(base + path, {method:data === undefined ? 'GET' : 'POST', headers, ...(data === undefined ? {} : {body:JSON.stringify(data)}), signal:AbortSignal.timeout(15000)});
    current();
    const value = await response.json();
    if (!response.ok) { if (response.status === 401 && authorized) save(null); throw Error(value.error || 'Leaderboard request failed. Please retry.'); }
    return value;
  }
  async function authenticate() {
    const base = await configuration();
    if (!base) throw Error('The shared leaderboard has not been connected yet.');
    current(); session ??= read();
    if (session?.wallet === wallet.toLowerCase() && session.endpoint === base && session.expiresAt > Date.now() + 30000) return;
    if (authenticating) return authenticating;
    authenticating = (async () => {
      const challenge = await request('/v1/auth/challenge', {wallet});
      current();
      // Never ask a wallet to sign a response for another domain or account.
      if (typeof challenge.message !== 'string' || !challenge.message.startsWith('Alpha City Climb leaderboard\n') || !challenge.message.includes('\nOrigin: ' + origin + '\n') || !challenge.message.includes('\nWallet: ' + wallet.toLowerCase() + '\n')) throw Error('Invalid leaderboard sign-in request.');
      const signed = await sign(new TextEncoder().encode(challenge.message)); current();
      const result = await request('/v1/auth/session', {id:challenge.id, signature:signed.signature}); current();
      if (result.wallet !== wallet.toLowerCase()) throw Error('Leaderboard wallet mismatch.');
      save({...result, endpoint:base});
    })();
    try { await authenticating; } finally { authenticating = null; }
  }
  return {
    wallet:wallet.toLowerCase(),
    available:async () => !!(await configuration()),
    authenticate,
    async startRun(clientId, heroId) { await authenticate(); return request('/v1/runs', {clientId, heroId}, true); },
    checkpoint:(id, level) => request('/v1/runs/' + encodeURIComponent(id) + '/checkpoint', {level}, true),
    finish:(id, outcome) => request('/v1/runs/' + encodeURIComponent(id) + '/finish', {outcome}, true),
    board:(hero = 'all') => request('/v1/leaderboard?class=' + encodeURIComponent(hero) + '&wallet=' + encodeURIComponent(wallet)),
    async publish(username) { await authenticate(); return request('/v1/profile', {username}, true); },
  };
}
