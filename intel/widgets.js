(function () {
    'use strict';
    const feeds = window.AlphaCityIntelFeeds;
    const safety = window.AlphaCityTokenSafety;
    const byId = id => document.getElementById(id);
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className || '';
        if (text !== undefined) node.textContent = String(text);
        return node;
    };
    const link = (url, className, text) => {
        const node = element('a', className, text);
        node.href = feeds.safeUrl(url);
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        return node;
    };
    const clockLabel = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const datedLabel = timestamp => new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    async function fetchJson(url, timeout = 8000) {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: 'no-cache' });
        if (!response.ok) throw new Error('Data source unavailable');
        return response.json();
    }

    let newsStore;
    let newsCategory = 'sui';
    let newsGeneration = 0;
    let newsModel = null;
    function renderNews(model) {
        newsModel = model;
        const filter = byId('news-source-filter');
        const selected = filter.value;
        filter.replaceChildren(element('option', '', 'All sources'));
        filter.firstChild.value = '';
        model.sources.forEach(source => {
            const option = element('option', '', source.label);
            option.value = source.id;
            filter.append(option);
        });
        filter.value = model.sources.some(source => source.id === selected) ? selected : '';
        filter.parentElement.classList.toggle('hidden', model.sources.length < 2);
        const articles = model.articles.filter(article => !filter.value || article.sourceId === filter.value);
        const fragment = document.createDocumentFragment();
        for (const article of articles) {
            const card = link(article.url, 'block p-3 rounded-lg bg-dark-bg/40 border border-gray-800/40 hover:border-brand-primary/30 hover:bg-dark-bg/60 transition-all group');
            card.append(element('h4', 'text-xs font-semibold text-white group-hover:text-brand-secondary line-clamp-2 leading-snug mb-1.5', article.title));
            const metadata = element('div', 'flex flex-wrap items-center gap-2 text-[10px] text-dark-text-secondary');
            metadata.append(element('span', 'bg-gray-800 px-1.5 py-0.5 rounded text-[9px] font-bold text-gray-400', article.publisher));
            if (article.sponsored) metadata.append(element('span', 'text-orange-300 font-semibold', 'Sponsored'));
            const date = element('time', '', article.publishedAt ? timeAgo(article.publishedAt) : 'Publication time unknown');
            if (article.publishedAt) {
                date.dateTime = new Date(article.publishedAt).toISOString();
                date.title = datedLabel(article.publishedAt);
            }
            metadata.append(date);
            card.append(metadata);
            fragment.append(card);
        }
        if (!articles.length) {
            fragment.append(element('p', 'text-xs text-gray-500 py-6 text-center',
                model.sources.every(source => source.state === 'unavailable') ? 'News is temporarily unavailable. Try Refresh.' : 'No articles available for this source.'));
        }
        byId('news-content').replaceChildren(fragment);
        const fresh = model.sources.filter(source => source.state === 'fresh');
        const cached = model.sources.filter(source => source.state === 'stale');
        byId('news-status').textContent = fresh.length === model.sources.length ? 'Checked ' + clockLabel(Math.min(...fresh.map(source => source.fetchedAt))) :
            fresh.length ? 'Partial update' : cached.length ? 'Cached news' : 'Unavailable';
        byId('news-source-status').textContent = model.sources.map(source => source.label + ': ' +
            (source.state === 'fresh' ? 'checked ' + clockLabel(source.fetchedAt) :
                source.state === 'stale' ? 'cached from ' + datedLabel(source.fetchedAt) + '; refresh unavailable' : 'unavailable')).join(' · ');
    }

    async function loadNews(category, { force = false } = {}) {
        if (!feeds.SOURCES[category]) return;
        newsCategory = category;
        const generation = ++newsGeneration;
        const refresh = byId('news-refresh');
        refresh.disabled = true;
        const cached = newsStore.peek(category);
        if (cached.articles.length) renderNews(cached);
        else byId('news-content').replaceChildren(element('p', 'text-xs text-gray-500 py-6 text-center', 'Loading news…'));
        byId('news-status').textContent = cached.articles.length ? 'Refreshing…' : 'Loading…';
        try {
            const model = await newsStore.load(category, { force });
            if (generation === newsGeneration) renderNews(model);
        } finally {
            if (generation === newsGeneration) refresh.disabled = false;
        }
    }

    function initNews() {
        let storage;
        try { storage = sessionStorage; } catch (_) {}
        newsStore = feeds.createStore({ storage });
        const buttons = [...document.querySelectorAll('.news-tab-btn')];
        function activate(button) {
            buttons.forEach(candidate => {
                const active = candidate === button;
                candidate.className = 'news-tab-btn px-2.5 py-1.5 rounded text-[10px] font-semibold cursor-pointer whitespace-nowrap ' +
                    (active ? 'active bg-brand-primary/10 border border-brand-primary/20 text-brand-primary' : 'text-dark-text-secondary hover:text-white');
                candidate.setAttribute('aria-selected', String(active));
                candidate.tabIndex = active ? 0 : -1;
            });
            byId('news-source-filter').value = '';
            loadNews(button.dataset.category);
        }
        buttons.forEach((button, index) => {
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', 'news-content');
            button.setAttribute('aria-selected', String(index === 0));
            button.tabIndex = index === 0 ? 0 : -1;
            button.addEventListener('click', () => activate(button));
            button.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
                    (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus();
                activate(buttons[next]);
            });
        });
        byId('news-refresh').addEventListener('click', () => loadNews(newsCategory, { force: true }));
        byId('news-source-filter').addEventListener('change', () => {
            if (newsModel?.category === newsCategory) renderNews(newsModel);
        });
        loadNews('sui');
        createVisibleInterval(() => loadNews(newsCategory), feeds.TTL_MS);
    }

    function initX() {
        const accounts = [
            ['Sui Network', 'SuiNetwork'], ['DeepBook', 'DeepBookonSui'],
            ['SuiNS', 'SuiNSdapp'], ['Walrus Protocol', 'WalrusProtocol'],
            ['Eman Abio', 'EmanAbio'], ['Kostas Crypto', 'kostascrypto'],
            ['Deep Trade', '_deeptrade'], ['Evan Web3', 'EvanWeb3'],
        ];
        byId('x-feed-container').replaceChildren(...accounts.map(([name, handle]) => {
            const card = link('https://x.com/' + handle, 'block p-3 rounded-lg bg-dark-bg/40 border border-gray-800/60 hover:border-brand-primary/30');
            card.append(element('div', 'text-xs font-bold text-white', name + ' ↗'));
            card.append(element('span', 'text-[10px] text-gray-400', '@' + handle));
            return card;
        }));
    }

    const APY_TTL_MS = 15 * 60_000;
    const APY_MAX_STALE_MS = 6 * 60 * 60_000;
    const APY_CACHE_KEY = 'ac_intel_yields_v2';
    let apyMemory = null;
    let apyPending = null;
    let endpointPromise = null;
    function validateYields(payload) {
        const age = Date.now() - payload?.fetchedAt;
        if (payload?.version !== 1 || !Number.isFinite(age) || age < -60_000 || age > APY_MAX_STALE_MS ||
            !Array.isArray(payload.pools) || payload.pools.length > 5 || typeof payload.stale !== 'boolean') throw new Error('Invalid yields response');
        if (payload.pools.some(pool => !pool || typeof pool.symbol !== 'string' || typeof pool.project !== 'string' ||
            !Number.isFinite(pool.apy) || pool.apy <= 0 || !Number.isFinite(pool.tvlUsd) || pool.tvlUsd < 20000)) throw new Error('Invalid yield pool');
        return payload;
    }
    function readYields() {
        try {
            return validateYields(apyMemory || JSON.parse(sessionStorage.getItem(APY_CACHE_KEY) || 'null'));
        } catch (_) { return null; }
    }
    async function dataEndpoint() {
        if (!endpointPromise) {
            endpointPromise = fetchJson('/intel/data-config.json').then(config => {
                const url = new URL(config.endpoint);
                const localPreview = ['localhost', '127.0.0.1', '::1'].includes(location.hostname) &&
                    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
                if ((!localPreview && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
                    throw new Error('Invalid data endpoint');
                }
                return url.origin;
            }).catch(error => { endpointPromise = null; throw error; });
        }
        return endpointPromise;
    }
    async function loadYields({ force = false } = {}) {
        const cached = readYields();
        if (!force && cached && !cached.stale && Date.now() - cached.fetchedAt < APY_TTL_MS) return cached;
        if (apyPending) return apyPending;
        apyPending = Promise.resolve().then(async () => {
            try {
                const payload = validateYields(await fetchJson(await dataEndpoint() + '/v1/yields', 15000));
                const pools = await Promise.all(payload.pools.map(async pool => ({
                    ...pool, resolvedAddress: await resolvePoolAddress(pool.project, pool.underlyingTokens).catch(() => null),
                })));
                apyMemory = { ...payload, pools };
                try { sessionStorage.setItem(APY_CACHE_KEY, JSON.stringify(apyMemory)); } catch (_) {}
                return apyMemory;
            } catch (error) {
                const stale = readYields();
                if (stale) return { ...stale, stale: true };
                throw error;
            } finally { apyPending = null; }
        });
        return apyPending;
    }
    function renderYields(snapshot) {
        const cards = snapshot.pools.map(pool => {
            const card = link(getPoolDetailedUrl(pool.project, pool.resolvedAddress),
                'flex items-center justify-between gap-2 py-2 border-b border-gray-800/40 text-xs hover:bg-gray-800/20 rounded px-1.5');
            const identity = element('div', 'min-w-0');
            identity.append(element('div', 'text-white font-semibold truncate', pool.symbol));
            identity.append(element('div', 'text-[10px] text-gray-400', formatApyProjectName(pool.project) + ' · TVL ' + fmtUsd(pool.tvlUsd)));
            const value = element('div', 'text-right');
            value.append(element('div', 'text-green-400 font-bold font-mono text-sm', pool.apy.toFixed(1) + '%'));
            value.append(element('div', 'text-[9px] text-gray-500', 'APY'));
            card.append(identity, value);
            return card;
        });
        byId('widget-apy-list').replaceChildren(...(cards.length ? cards : [element('p', 'text-xs text-gray-500 py-4', 'No eligible Sui yield pools reported.')]));
        byId('widget-apy-status').textContent = (snapshot.stale ? 'Cached · refresh unavailable · ' : 'Updated ') + datedLabel(snapshot.fetchedAt);
    }
    async function refreshYields(options = {}) {
        const refresh = byId('widget-apy-refresh-btn');
        refresh.disabled = true;
        const cached = readYields();
        if (cached) renderYields({ ...cached, stale: cached.stale || Date.now() - cached.fetchedAt >= APY_TTL_MS });
        byId('widget-apy-status').textContent = 'Refreshing…';
        try { renderYields(await loadYields(options)); }
        catch (_) {
            byId('widget-apy-list').replaceChildren(element('p', 'text-xs text-gray-500 py-4', 'Yield data is temporarily unavailable. Try Refresh.'));
            byId('widget-apy-status').textContent = 'Unavailable';
        } finally { refresh.disabled = false; }
    }
    function initYields() {
        byId('widget-apy-refresh-btn').addEventListener('click', () => refreshYields({ force: true }));
        refreshYields();
        createVisibleInterval(() => refreshYields(), APY_TTL_MS);
    }

    function safetyMessage(text) {
        byId('widget-sniffer-status').textContent = text;
        byId('widget-sniffer-status').className = 'text-[9px] text-gray-400 font-mono';
    }
    async function scanSafety(input) {
        const coinType = safety.coinKey(input);
        if (!coinType) {
            byId('widget-sniffer-results').classList.add('hidden');
            safetyMessage('Enter a full coin type');
            byId('widget-sniffer-input').setAttribute('aria-invalid', 'true');
            return;
        }
        const button = byId('widget-sniffer-scan-btn');
        if (button.disabled) return;
        button.disabled = true;
        byId('widget-sniffer-input').removeAttribute('aria-invalid');
        byId('widget-sniffer-results').classList.add('hidden');
        safetyMessage('Checking…');
        try {
            const [security, market] = await Promise.all([
                fetchJson('https://api.gopluslabs.io/api/v1/sui/token_security?contract_addresses=' + encodeURIComponent(coinType))
                    .then(payload => safety.securityRecord(payload, coinType)).catch(() => ({ state: 'unavailable', data: null })),
                fetchJson('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(coinType))
                    .then(payload => safety.marketRecord(payload, coinType)).catch(() => ({ state: 'unavailable', pair: null })),
            ]);
            const assessment = safety.assess({ security, market });
            const metadata = security.data || {};
            const marketToken = [market.pair?.baseToken, market.pair?.quoteToken].find(token => safety.coinKey(token?.address) === coinType);
            const name = typeof metadata.name === 'string' ? metadata.name : metadata.name?.name;
            byId('sniffer-token-name').textContent = typeof name === 'string' ? name : marketToken?.name || 'Unknown coin';
            byId('sniffer-token-symbol').textContent = typeof metadata.symbol === 'string' ? metadata.symbol : marketToken?.symbol || coinType.split('::').pop();
            byId('sniffer-safety-score').textContent = assessment.known + '/' + assessment.total;
            byId('sniffer-safety-score').className = 'text-xl font-bold font-mono text-gray-300';
            byId('sniffer-stat-liquidity').textContent = assessment.liquidity === null ? 'Unknown' : fmtUsd(assessment.liquidity);
            byId('sniffer-stat-supply').textContent = assessment.supply === null ? 'Unknown' : assessment.supply.toLocaleString(undefined, { maximumFractionDigits: 2 });
            byId('sniffer-holder-concentration').textContent = assessment.holderShare === null ? 'Unknown' : assessment.holderShare.toFixed(1) + '%';
            byId('sniffer-alerts-list').replaceChildren(...assessment.checks.map(check => {
                const row = element('div', 'text-[10px] leading-relaxed py-1 border-b border-gray-800/20');
                const label = check.risk ? 'Review' : check.state === 'inactive' ? 'Reported inactive' :
                    check.state === 'reported' ? 'Reported' : check.state === 'unavailable' ? 'Unavailable' :
                        check.state === 'unsupported' ? 'No coverage' : 'Unknown';
                row.append(element('span', check.risk ? 'text-orange-300 font-semibold' : 'text-gray-300 font-semibold', label + ' · '));
                row.append(element('span', 'text-gray-400', check.text));
                return row;
            }));
            const holderRows = assessment.holders.map(holder => {
                const row = element('div', 'flex justify-between gap-2 text-[10px] py-1 font-mono');
                const address = element('span', 'text-gray-400 truncate', shortAddr(holder.address) + (holder.tag ? ' · ' + holder.tag : ''));
                address.title = holder.address;
                row.append(address, element('span', 'text-white', holder.percent.toFixed(2) + '%'));
                return row;
            });
            byId('sniffer-holders-list').replaceChildren(...(holderRows.length ? holderRows : [element('p', 'text-[10px] text-gray-500 py-2', 'Distribution data unavailable or incomplete.')]));
            safetyMessage(assessment.known < assessment.total ? 'Incomplete data' : assessment.riskCount ? 'Review flags' : 'Checks returned');
            byId('widget-sniffer-results').classList.remove('hidden');
        } catch (_) {
            safetyMessage('Unable to check');
        } finally { button.disabled = false; }
    }
    function initSafety() {
        byId('widget-sniffer-scan-btn').addEventListener('click', () => scanSafety(byId('widget-sniffer-input').value.trim()));
        byId('widget-sniffer-input').addEventListener('keydown', event => {
            if (event.key === 'Enter') scanSafety(event.currentTarget.value.trim());
        });
    }

    window.AlphaCityIntelWidgets = { initNews, initX, initYields, initSafety };
})();
