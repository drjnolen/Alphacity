const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const modulePromise = import(pathToFileURL(path.resolve(__dirname, '../scripts/build-service-config.mjs')));

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-services-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const dir of ['config', 'climb', 'intel']) await fs.mkdir(path.join(root, dir));
    for (const [file, data] of Object.entries({
        'config/services.json': { openaiProxy: 'https://ai.example' },
        'climb/leaderboard-config.json': { endpoint: 'https://climb.example' },
        'intel/data-config.json': { endpoint: 'https://intel.example' },
    })) await fs.writeFile(path.join(root, file), JSON.stringify(data));
    await fs.writeFile(path.join(root, 'intel/index.html'), "const OPENAI_PROXY_URL = '__OPENAI_PROXY_URL__';\nconst sentinel = '__OPENAI_PROXY_URL__';");
    return root;
}

test('publication preserves all configured URLs without fetching or backend credentials', async t => {
    const root = await fixture(t);
    const { buildServiceConfig } = await modulePromise;
    const urls = await buildServiceConfig(root, {});
    assert.deepEqual(urls, { climb: 'https://climb.example', intel: 'https://intel.example', openai: 'https://ai.example' });
    const html = await fs.readFile(path.join(root, 'intel/index.html'), 'utf8');
    assert.match(html, /const OPENAI_PROXY_URL = "https:\/\/ai.example";/);
    assert.match(html, /const sentinel = '__OPENAI_PROXY_URL__';/);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'climb/leaderboard-config.json'))).endpoint, urls.climb);
});

test('explicit overrides win and absent services remain unconfigured', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, 'intel/data-config.json'), '{"endpoint":""}');
    await fs.writeFile(path.join(root, 'climb/leaderboard-config.json'), '{"endpoint":null}');
    const { buildServiceConfig } = await modulePromise;
    const urls = await buildServiceConfig(root, { OPENAI_PROXY_URL: 'https://new.example/', CLIMB_LEADERBOARD_URL: 'https://scores.example' });
    assert.deepEqual(urls, { openai: 'https://new.example', climb: 'https://scores.example', intel: '' });
});

test('invalid endpoint configuration fails before modifying publication files', async t => {
    const root = await fixture(t);
    const { buildServiceConfig, endpoint } = await modulePromise;
    for (const url of ['http://insecure.example', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?key=value', 'https://example.com/#fragment', "https://example.com/</script>"]) {
        assert.throws(() => endpoint(url));
    }
    await assert.rejects(buildServiceConfig(root, { INTEL_DATA_URL: 'invalid' }));
    assert.match(await fs.readFile(path.join(root, 'intel/index.html'), 'utf8'), /const OPENAI_PROXY_URL = '__OPENAI_PROXY_URL__';/);
});

test('Pages remains independent and service workflows only publish main', async () => {
    const root = path.resolve(__dirname, '..');
    const pages = await fs.readFile(path.join(root, '.github/workflows/deploy.yml'), 'utf8');
    assert.doesNotMatch(pages, /wrangler|CLOUDFLARE_|deploy-climb-leaderboard|deploy-intel-data|needs:|continue-on-error/);
    assert.match(pages, /npm test/);
    assert.match(pages, /node scripts\/build-service-config.mjs/);
    assert.match(pages, /actions\/deploy-pages/);
    for (const service of ['climb', 'intel', 'openai']) {
        const workflow = await fs.readFile(path.join(root, '.github/workflows/deploy-' + service + '.yml'), 'utf8');
        assert.match(workflow, /paths:/);
        assert.match(workflow, /workflow_dispatch:/);
        assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
        assert.doesNotMatch(workflow, /actions\/deploy-pages/);
    }
});
