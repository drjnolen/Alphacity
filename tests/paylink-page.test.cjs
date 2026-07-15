const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'pay', 'index.html'), 'utf8');
const requestPage = fs.readFileSync(path.join(root, 'pay', 'request', 'index.html'), 'utf8');
const walletConnector = fs.readFileSync(path.join(root, 'shared', 'wallet-connector.js'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'tools', 'index.html'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'shared', 'paylink-client-source.js'), 'utf8');
const clientBundle = fs.readFileSync(path.join(root, 'shared', 'paylink-client.js'), 'utf8');
const configSource = fs.readFileSync(path.join(root, 'shared', 'paylink-config.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the creator dashboard loads wallet sync, Sui client, and gate before Paylink code', () => {
    const wallet = page.indexOf('/shared/wallet-sync.js');
    const connector = page.indexOf('/shared/wallet-connector.js');
    const sui = page.indexOf('/shared/sui-client.js');
    const gate = page.indexOf('/shared/tools-gate.js');
    const config = page.indexOf('/shared/paylink-config.js');
    const core = page.indexOf('/shared/paylink-core.js');
    const client = page.indexOf('/shared/paylink-client.js');
    assert.ok(wallet > 0 && wallet < connector && connector < sui);
    assert.ok(sui < gate);
    assert.ok(gate < config);
    assert.ok(config < core && core < client);
});

test('generated links use a public payer context page while only creation is CITY-gated', () => {
    assert.match(page, /Creator access requires 5M CITY/i);
    assert.match(page, /payer does not need CITY/i);
    assert.match(configSource, /https:\/\/my\.slush\.app\/pay/);
    assert.match(configSource, /https:\/\/alphacity\.tech\/pay\/request\//);
    assert.match(clientSource, /createSlushUniversalUrl/);
    assert.match(clientSource, /createPayerRequestUrl/);
    assert.match(clientSource, /uri\.slice\(question \+ 1\)/);
    assert.match(clientSource, /searchParams\.set\('uri', uri\)/);
});

test('Slush links include direct mobile fields and the complete URI required by Slush web', async () => {
    const context = { window: {}, URL };
    vm.runInNewContext(clientBundle, context, { filename: 'shared/paylink-client.js' });
    const Client = context.window.AlphaCityPaylinkClient;
    const registryId = `0x${'b'.repeat(64)}`;
    const paymentUri = `sui:pay?receiver=0x${'a'.repeat(64)}&amount=1250000&coinType=0x2%3A%3Asui%3A%3ASUI&nonce=integration-test-nonce&registry=${registryId}&label=Test+invoice`;
    const universalUrl = new URL(Client.createSlushUniversalUrl(paymentUri));

    assert.equal(universalUrl.origin, 'https://my.slush.app');
    assert.equal(universalUrl.pathname, '/pay');
    assert.equal(universalUrl.searchParams.get('receiver'), `0x${'a'.repeat(64)}`);
    assert.equal(universalUrl.searchParams.get('amount'), '1250000');
    assert.equal(universalUrl.searchParams.get('coinType'), '0x2::sui::SUI');
    assert.equal(universalUrl.searchParams.get('nonce'), 'integration-test-nonce');
    assert.equal(universalUrl.searchParams.get('registry'), registryId);
    assert.equal(universalUrl.searchParams.get('uri'), paymentUri);

    const { parsePaymentTransactionUri } = await import('@mysten/payment-kit');
    const mobileParsed = parsePaymentTransactionUri(`sui:pay?${universalUrl.searchParams}`);
    assert.equal(mobileParsed.receiverAddress, `0x${'a'.repeat(64)}`);
    assert.equal(mobileParsed.registryId, registryId);

    const payerUrl = new URL(Client.createPayerRequestUrl({
        paymentUri,
        symbol: 'SUI',
        decimals: 9,
    }));
    assert.equal(payerUrl.origin, 'https://alphacity.tech');
    assert.equal(payerUrl.pathname, '/pay/request/');
    assert.equal(payerUrl.searchParams.get('request'), paymentUri);
    assert.equal(payerUrl.searchParams.get('symbol'), 'SUI');
    assert.equal(payerUrl.searchParams.get('decimals'), '9');
});

test('stored invoices are upgraded to payer and Slush URLs without changing payment identity', () => {
    assert.match(page, /function upgradePaylinkUrls\(items\)/);
    assert.match(page, /Client\.createSlushUniversalUrl\(invoice\.paymentUri, Config\.slushPaymentBaseUrl\)/);
    assert.match(page, /Client\.createPayerRequestUrl\(invoice, Config\.payerRequestBaseUrl\)/);
    assert.match(page, /return \{ \.\.\.invoice, slushUrl, payerUrl, universalUrl: payerUrl \}/);
    assert.match(page, /if \(upgraded\.changed\) persistInvoices\(\)/);
});

test('the public payer page shows label and memo before continuing to Slush', () => {
    assert.match(requestPage, /id="request-title"/);
    assert.match(requestPage, /id="request-memo"/);
    assert.match(requestPage, /Continue in Slush/i);
    assert.match(requestPage, /request\.get\('label'\)/);
    assert.match(requestPage, /request\.get\('message'\)/);
    assert.match(requestPage, /searchParams\.set\('uri', paymentUri\)/);
    assert.doesNotMatch(requestPage, /tools-gate\.js/);
});

test('Paylink mirrors the standard wallet button and wallet-management menu', () => {
    assert.match(page, /id="connect-wallet-btn"/);
    assert.match(page, /AlphaCityWalletConnector/);
    assert.match(walletConnector, /Switch Account/);
    assert.match(walletConnector, /Switch Wallet Provider/);
    assert.match(walletConnector, /Disconnect/);
    assert.match(walletConnector, /wallet-standard:app-ready/);
    assert.match(walletConnector, /standard:disconnect/);
});

test('payment requests use the registry composite identity and exact bigint values', () => {
    assert.match(clientSource, /amount: BigInt\(invoice\.amountAtomic\)/);
    assert.match(clientSource, /nonce: invoice\.nonce/);
    assert.match(clientSource, /receiver: invoice\.receiverAddress/);
    assert.match(clientSource, /suiClient\.core\.getDynamicField/);
    assert.match(clientSource, /PaymentKey<\$\{coinType\}>/);
    assert.match(clientSource, /previousTransaction/);
    assert.match(configSource, /default-payment-registry/);
    assert.match(configSource, /0481b22fd3c73f3176db4c20419e1d09c6a3074aeed65acdc776f7359285ffd2/);
    assert.match(configSource, /bc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6/);
});

test('the UI exposes safety disclosures, full receiver review, receipts, and local-only history', () => {
    assert.match(page, /Funds go directly to this address/i);
    assert.match(page, /does not custody, route, or recover funds/i);
    assert.match(page, /Verify the full destination/i);
    assert.match(page, /stores this invoice only in your current browser/i);
    assert.match(page, /Open in Slush/i);
    assert.match(page, /Export CSV/i);
    assert.match(page, /Receipt/);
    assert.doesNotMatch(page, /\.innerHTML\s*=/);
    assert.doesNotMatch(page, /signAndExecute|signTransaction|executeTransaction/);
});

test('the ecosystem dashboard links to the new gated Paylink creator', () => {
    assert.match(portal, /Alpha City Paylink/);
    assert.match(portal, /href="\/pay\/"/);
    assert.match(portal, /Open Paylink/);
});

test('Paylink dependencies are exact and included in the normal production build', () => {
    assert.equal(packageJson.dependencies['@mysten/payment-kit'], '0.2.5');
    assert.equal(packageJson.dependencies.qrcode, '1.5.4');
    assert.match(packageJson.scripts['build:paylink'], /paylink-client-source\.js/);
    assert.match(packageJson.scripts['build:paylink-css'], /pay\/tailwind\.css/);
    assert.match(packageJson.scripts.build, /build:paylink/);
    assert.match(packageJson.scripts.build, /build:paylink-css/);
    assert.match(page, /href="\/pay\/tailwind\.css"/);
    assert.doesNotMatch(page, /cdn\.tailwindcss\.com/);
});

test('the inline Paylink controller parses as JavaScript', () => {
    const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 2);
    const controller = scripts.at(-1)[1];
    assert.doesNotThrow(() => new vm.Script(controller, { filename: 'pay/index.html:inline-controller.js' }));
});

test('the inline public request controller parses as JavaScript', () => {
    const scripts = [...requestPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new vm.Script(scripts[0][1], { filename: 'pay/request/index.html:inline-controller.js' }));
});

test('Payment Kit creates and parses the exact registry-backed request URI', async () => {
    const { createPaymentTransactionUri, parsePaymentTransactionUri } = await import('@mysten/payment-kit');
    const receiverAddress = `0x${'a'.repeat(64)}`;
    const registryId = `0x${'b'.repeat(64)}`;
    const uri = createPaymentTransactionUri({
        receiverAddress,
        amount: 1_250_000n,
        coinType: '0x2::sui::SUI',
        nonce: 'integration-test-nonce',
        label: 'Test invoice',
        message: 'Paylink round trip',
        registryId,
    });
    const parsed = parsePaymentTransactionUri(uri);
    assert.equal(parsed.receiverAddress, receiverAddress);
    assert.equal(parsed.amount, 1_250_000n);
    assert.equal(parsed.coinType, '0x2::sui::SUI');
    assert.equal(parsed.nonce, 'integration-test-nonce');
    assert.equal(parsed.registryId, registryId);
});
