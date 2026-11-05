const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

// Minimal DOM contract for testing asynchronous widget behavior without live network services.
class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.handlers = {};
        this.value = '';
        this._text = '';
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }
    set innerHTML(_) { throw Error('Widgets must not render untrusted HTML'); }
    get firstChild() { return this.children[0]; }
    append(...nodes) {
        for (const node of nodes) {
            if (node.tagName === 'FRAGMENT') this.append(...node.children);
            else { node.parentElement = this; this.children.push(node); }
        }
    }
    replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    focus() {}
    fire(name, extras = {}) { return this.handlers[name]?.({ currentTarget: this, preventDefault() {}, ...extras }); }
}

function harness(fetchImpl) {
    const ids = [...fs.readFileSync(path.join(root, 'intel/index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(match => match[1]);
    const nodes = new Map(ids.map(id => [id, new Element()]));
    nodes.get('news-source-filter').parentElement = new Element('label');
    const tabs = ['sui', 'crypto', 'macro', 'good', 'science'].map(category => {
        const node = new Element('button');
        node.dataset.category = category;
        return node;
    });
    const storage = new Map();
    const scheduled = [];
    const context = vm.createContext({
        document: {
            getElementById: id => nodes.get(id),
            createElement: tag => new Element(tag),
            createDocumentFragment: () => new Element('fragment'),
            querySelectorAll: selector => selector === '.news-tab-btn' ? tabs : [],
        },
        fetch: fetchImpl, URL, AbortSignal, console,
        location: { hostname: 'localhost' },
        sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        createVisibleInterval: callback => scheduled.push(callback),
        timeAgo: () => '1h ago', fmtUsd: value => '$' + value, shortAddr: value => value,
        resolvePoolAddress: async () => null, getPoolDetailedUrl: () => 'https://example.com/pool',
        formatApyProjectName: value => value,
    });
    context.window = context;
    for (const file of ['shared/intel-feeds.js', 'shared/token-safety.js', 'intel/widgets.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    }
    return { api: context.AlphaCityIntelWidgets, nodes, tabs, scheduled };
}
const rss = title => Response.json({ status: 'ok', items: [{ title, link: 'https://example.com/' + encodeURIComponent(title) }] });
const wire = title => Response.json({ version: 'https://jsonfeed.org/version/1.1', items: [{ title, url: 'https://suiwire.com/news/story', _suiwire: { sponsored: true } }] });

test('late news responses cannot overwrite the currently selected category or refresh state', async () => {
    const requests = [];
    const ui = harness(url => {
        const pending = deferred();
        requests.push({ url, ...pending });
        return pending.promise;
    });
    ui.api.initNews();
    await flush();
    ui.tabs[1].fire('click');
    await flush();
    requests.find(item => item.url.includes('cointelegraph')).resolve(rss('Crypto wins'));
    await flush();
    assert.match(ui.nodes.get('news-content').textContent, /Crypto wins/);
    assert.equal(ui.nodes.get('news-refresh').disabled, false);
    requests.find(item => item.url.includes('suiwire')).resolve(wire('Late SuiWire'));
    requests.find(item => item.url.includes('google')).resolve(rss('Late Google'));
    await flush();
    assert.match(ui.nodes.get('news-content').textContent, /Crypto wins/);
    assert.doesNotMatch(ui.nodes.get('news-content').textContent, /Late/);
});

test('news titles render as text, sponsored labels survive filtering, and Refresh retains content during outages', async () => {
    let fail = false;
    let calls = 0;
    const ui = harness(async url => {
        calls++;
        if (fail) throw Error('offline');
        return url.includes('suiwire') ? wire('<img src=x onerror=alert(1)> Sponsor') : rss('Independent news');
    });
    ui.api.initNews();
    await flush();
    const content = ui.nodes.get('news-content');
    assert.match(content.textContent, /<img src=x onerror=alert\(1\)> Sponsor/);
    assert.match(content.textContent, /Sponsored/);
    assert.match(content.textContent, /Publication time unknown/);
    assert.equal(content.children[0].children[0].tagName, 'H4');
    ui.nodes.get('news-source-filter').value = 'suiwire';
    ui.nodes.get('news-source-filter').fire('change');
    assert.doesNotMatch(content.textContent, /Independent news/);
    assert.equal(calls, 2);
    fail = true;
    ui.nodes.get('news-refresh').fire('click');
    assert.match(content.textContent, /Sponsor/);
    await flush();
    assert.match(content.textContent, /Sponsor/);
    assert.match(ui.nodes.get('news-source-status').textContent, /cached from/);
    assert.equal(calls, 4);
});

test('social account links are usable immediately without a fetch', () => {
    const ui = harness(() => { throw Error('No social request expected'); });
    ui.api.initX();
    const links = ui.nodes.get('x-feed-container').children;
    assert.equal(links.length, 8);
    assert.equal(links[0].href, 'https://x.com/SuiNetwork');
    assert.equal(links[0].rel, 'noopener noreferrer');
});

test('APY widget fetches only the compact Worker endpoint and labels cached fallback on failure', async () => {
    let fail = false;
    const urls = [];
    const ui = harness(async url => {
        urls.push(url);
        if (url === '/intel/data-config.json') return Response.json({ endpoint: 'https://intel.example' });
        assert.equal(url, 'https://intel.example/v1/yields');
        if (fail) throw Error('offline');
        return Response.json({ version: 1, fetchedAt: Date.now(), stale: false,
            pools: [{ pool: 'one', symbol: 'SUI', project: 'navi-lending', apy: 5, tvlUsd: 30000 }] });
    });
    ui.api.initYields();
    await flush();
    assert.match(ui.nodes.get('widget-apy-list').textContent, /SUI/);
    assert.match(ui.nodes.get('widget-apy-list').textContent, /5.0%/);
    fail = true;
    ui.nodes.get('widget-apy-refresh-btn').fire('click');
    await flush();
    assert.match(ui.nodes.get('widget-apy-list').textContent, /SUI/);
    assert.match(ui.nodes.get('widget-apy-status').textContent, /Cached · refresh unavailable/);
    assert.equal(urls.some(url => url.includes('yields.llama.fi')), false);
});

test('safety scanner rejects package-only input and displays incomplete fields without a safety score', async () => {
    const urls = [];
    const ui = harness(async url => {
        urls.push(url);
        if (url.includes('goplus')) return Response.json({ code: 1, result: { '0xa::coin::COIN': { mintable: { value: '2' }, name: 'Coin' } } });
        throw Error('market source offline');
    });
    ui.api.initSafety();
    const input = ui.nodes.get('widget-sniffer-input');
    input.value = '0xa';
    ui.nodes.get('widget-sniffer-scan-btn').fire('click');
    assert.equal(urls.length, 0);
    assert.match(ui.nodes.get('widget-sniffer-status').textContent, /full coin type/);
    input.value = '0x000a::coin::COIN';
    ui.nodes.get('widget-sniffer-scan-btn').fire('click');
    await flush();
    assert.equal(urls.length, 2);
    assert.equal(ui.nodes.get('sniffer-safety-score').textContent, '1/5');
    assert.match(ui.nodes.get('sniffer-alerts-list').textContent, /capability reported active/);
    assert.match(ui.nodes.get('sniffer-alerts-list').textContent, /Unknown/);
    assert.match(ui.nodes.get('sniffer-stat-liquidity').textContent, /Unknown/);
    assert.equal(ui.nodes.get('widget-sniffer-status').textContent, 'Incomplete data');
    let previousResultsHidden = false;
    ui.nodes.get('widget-sniffer-results').classList.add = value => { previousResultsHidden = value === 'hidden'; };
    input.value = '0xa';
    ui.nodes.get('widget-sniffer-scan-btn').fire('click');
    assert.equal(previousResultsHidden, true);
    assert.equal(urls.length, 2);
});
