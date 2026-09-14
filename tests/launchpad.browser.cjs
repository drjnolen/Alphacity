'use strict';
// Run with Node, Playwright and Chrome. See launchpad/README.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
const project = {
    schemaVersion: 3, name: 'Night Shift', id: 'night-shift', intendedSupply: 201,
    description: 'A collection built after midnight.', creatorAddress: `0x${'1'.repeat(64)}`,
    heroFile: 'hero.png', royaltyBps: 525, platformFeeBps: 0, maxPerTx: 5,
    assignmentPolicy: 'sequential-equivalent', mediaReleaseVerified: true,
    mediaBaseUrl: `https://media.example.com/night-shift/releases/${'a'.repeat(64)}/media`,
    stages: [{ name: 'Public mint', priceSui: '1.000000001', startTime: '2099-08-01T18:00:12.123Z', endTime: '', walletLimit: 5, allocation: 0, allowlistOnly: false, allowlist: [] }],
};
const jsonFile = (input) => ({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });

(async () => {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}${url.pathname.endsWith('/') ? 'index.html' : ''}`);
        if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
        fs.readFile(file, (error, data) => {
            if (error) { res.writeHead(404); return res.end(); }
            res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
            res.end(data);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    const url = `http://127.0.0.1:${server.address().port}/launchpad/`;
    const page = await context.newPage();
    const ready = async (target = page) => target.waitForFunction(() => !document.getElementById('new-project').disabled && !document.getElementById('builder-content').inert);
    const saved = async (target = page) => target.waitForFunction(() => document.getElementById('autosave-state').textContent.includes('Saved in this browser'));
    const step = async (index) => page.locator(`[data-step-target="${index}"]`).click();
    try {
        await page.goto(url); await ready();
        assert.equal(await page.locator('#collection-validation').isVisible(), false);
        await page.locator('#collection-name').fill('First project');
        await page.locator('#collection-slug').fill('custom-slug');
        await page.locator('#website').fill('https://example.com');
        await saved();
        const firstId = await page.locator('#project-switcher').inputValue();
        await page.locator('#new-project').click();
        await page.waitForFunction(() => document.getElementById('collection-name').value === '');
        assert.equal(await page.locator('#website').inputValue(), '');
        await page.locator('#collection-name').fill('Second project');
        await saved();
        await page.locator('#project-switcher').selectOption(firstId);
        await page.waitForFunction(() => document.getElementById('collection-name').value === 'First project');
        await page.locator('#collection-name').fill('Renamed project');
        assert.equal(await page.locator('#collection-slug').inputValue(), 'custom-slug');
        await saved();

        await step(1);
        await page.evaluate(() => {
            const file = new File(['Name,Description,File Name,Reserve For Creator\nStale,Stale,old.png,false'], 'old.csv', { type: 'text/csv' });
            file.text = () => new Promise((resolve) => { window.finishOldCsv = () => resolve('Name,Description,File Name,Reserve For Creator\nStale,Stale,old.png,false'); });
            const transfer = new DataTransfer(); transfer.items.add(file);
            const input = document.getElementById('metadata-file'); input.files = transfer.files;
            input.dispatchEvent(new Event('change'));
        });
        await page.locator('#new-project').click(); await ready();
        await page.evaluate(() => window.finishOldCsv());
        assert.equal(await page.locator('#summary-items').textContent(), '0');
        console.log('PASS: late CSV reads cannot populate a different project');

        // Even incomplete exports can be imported, without inheriting old fields.
        await page.locator('#project-file').setInputFiles(jsonFile({ schemaVersion: 3, name: 'Unfinished', id: 'unfinished', stages: [] }));
        await page.waitForFunction(() => document.getElementById('collection-name').value === 'Unfinished');
        assert.equal(await page.locator('#website').inputValue(), '');
        await page.locator('#project-file').setInputFiles(jsonFile(project));
        await page.waitForFunction(() => document.getElementById('collection-name').value === 'Night Shift');
        await ready();
        assert.equal(await page.locator('#assignment-policy-equivalent').isChecked(), false);
        assert.equal(await page.evaluate(() => window.AlphaCityLaunchpadBuilder.formProject().stages[0].startTime), project.stages[0].startTime);

        await step(1);
        const csv = 'Name,Description,File Name,Reserve For Creator\n' + Array.from({ length: 201 }, (_, i) => `Item ${i},Description,hero.png,false`).join('\n');
        await page.locator('#metadata-file').setInputFiles({ name: 'metadata.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
        await page.locator('#media-individual-files').setInputFiles({ name: 'hero.png', mimeType: 'image/png', buffer: png });
        await page.waitForFunction(() => document.getElementById('summary-items').textContent === '201');
        assert.equal(await page.locator('#item-table tr').count(), 100);
        await page.locator('#items-next').click();
        assert.match(await page.locator('#item-table tr').first().textContent(), /Item 100/);
        await page.locator('#items-next').click();
        assert.equal(await page.locator('#item-table tr').count(), 1);
        await page.locator('#assignment-policy-equivalent').check();
        await step(5);
        await page.locator('#media-release-verified').check();
        await page.waitForFunction(() => !document.getElementById('export-bundle').disabled);
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-bundle').click()]);
        const bundle = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert.equal(bundle.collection.id, 'night-shift');
        assert.equal(bundle.collection.royaltyBps, 525);
        assert.equal(bundle.collection.phases[0].priceMist, '1000000001');
        console.log('PASS: multi-project isolation, incomplete imports, exact terms, pagination and prepared export');

        // File handles survive switching in this tab, but not a reload.
        await saved();
        const nightId = await page.locator('#project-switcher').inputValue();
        await page.locator('#project-switcher').selectOption(firstId); await ready();
        await page.locator('#project-switcher').selectOption(nightId); await ready();
        await page.waitForFunction(() => !document.getElementById('export-bundle').disabled);
        const other = await context.newPage(); await other.goto(url); await ready(other);
        assert.match(await other.locator('#collection-name').inputValue(), /\(copy\)$/);
        assert.notEqual(await other.locator('#project-switcher').inputValue(), nightId);
        await other.close();
        await page.reload(); await ready();
        // The active project is local to the browser and may be the copy from the other tab.
        await page.locator('#project-switcher').selectOption(nightId); await ready();
        assert.equal(await page.locator('#assignment-policy-equivalent').isChecked(), false);
        assert.equal(await page.locator('#export-bundle').isDisabled(), true);
        assert.equal(await page.locator('#summary-items').textContent(), '0');
        console.log('PASS: tab conflict protection, file isolation and reload validation');

        await step(0);
        await page.setViewportSize({ width: 390, height: 844 });
        for (let index = 0; index < 6; index++) {
            await step(index);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Step ${index + 1} overflows mobile viewport`);
        }
        await step(2); await page.locator('#add-phase').click();
        assert.equal(await page.locator('#phase-dialog').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#phase-dialog').isVisible(), false);
        if (process.env.LAUNCHPAD_SCREENSHOT_DIR) {
            fs.mkdirSync(process.env.LAUNCHPAD_SCREENSHOT_DIR, { recursive: true });
            await step(0);
            await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
            await page.screenshot({ path: path.join(process.env.LAUNCHPAD_SCREENSHOT_DIR, 'launchpad-mobile.png'), fullPage: true });
            await page.setViewportSize({ width: 1440, height: 1000 });
            await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
            await page.screenshot({ path: path.join(process.env.LAUNCHPAD_SCREENSHOT_DIR, 'launchpad-desktop.png'), fullPage: true });
        }
        assert.deepEqual(errors, []);
        console.log('PASS: all six mobile steps, keyboard dialog dismissal and no browser errors');
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
