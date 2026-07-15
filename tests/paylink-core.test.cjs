const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'shared', 'paylink-core.js'), 'utf8'),
    context,
    { filename: 'shared/paylink-core.js' },
);

const Core = context.AlphaCityPaylinkCore;
const ADDRESS = `0x${'a'.repeat(64)}`;
const REGISTRY = `0x${'b'.repeat(64)}`;

function makeInvoice(overrides = {}) {
    return Core.createInvoiceRecord({
        id: 'invoice-1',
        nonce: 'invoice-1',
        creatorAddress: ADDRESS,
        receiverAddress: ADDRESS,
        coinType: '0x2::sui::SUI',
        symbol: 'SUI',
        decimals: 9,
        amountAtomic: 1_250_000_000n,
        label: 'Consulting invoice 1042',
        message: 'Thanks for working with Alpha City.',
        registryId: REGISTRY,
        registryName: 'default-payment-registry',
        network: 'mainnet',
        paymentUri: 'sui:pay?receiver=example',
        universalUrl: 'https://my.slush.app/pay?receiver=example',
        createdAt: '2026-07-14T12:00:00.000Z',
        ...overrides,
    });
}

test('Sui addresses and coin types are canonicalized before invoice creation', () => {
    assert.equal(Core.canonicalizeAddress('0x2'), `0x${'0'.repeat(63)}2`);
    assert.equal(
        Core.canonicalizeCoinType('0x2::sui::SUI'),
        `0x${'0'.repeat(63)}2::sui::SUI`,
    );
    assert.throws(() => Core.canonicalizeAddress('2'), /valid Sui address/);
    assert.throws(() => Core.canonicalizeCoinType('not-a-coin'), /valid Sui coin type/);
});

test('display amounts use exact bigint arithmetic and enforce u64 limits', () => {
    assert.equal(Core.parseDisplayAmount('250.123456', 6), 250_123_456n);
    assert.equal(Core.parseDisplayAmount('1.25', 9), 1_250_000_000n);
    assert.equal(Core.formatAtomicAmount(1_250_000_000n, 9), '1.25');
    assert.equal(Core.formatAtomicAmount(1_250_000_000n, 9, { keepTrailingZeros: true }), '1.250000000');
    assert.throws(() => Core.parseDisplayAmount('1e3', 6), /plain decimal notation/);
    assert.throws(() => Core.parseDisplayAmount('.5', 6), /plain decimal notation/);
    assert.throws(() => Core.parseDisplayAmount('0', 6), /greater than zero/);
    assert.throws(() => Core.parseDisplayAmount('1.0000001', 6), /at most 6 decimal places/);
    assert.throws(() => Core.parseDisplayAmount((Core.U64_MAX + 1n).toString(), 0), /maximum supported/);
});

test('draft validation rejects incomplete, overly precise, and oversized content', () => {
    const valid = Core.validateInvoiceDraft({
        receiverAddress: ADDRESS,
        coinType: '0x2::sui::SUI',
        symbol: 'SUI',
        decimals: 9,
        amountDisplay: '0.5',
        label: 'Dinner split',
        message: 'Your share',
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.value.amountAtomic, 500_000_000n);

    const invalid = Core.validateInvoiceDraft({
        receiverAddress: 'wrong',
        coinType: 'wrong',
        symbol: '',
        decimals: 6,
        amountDisplay: '1.0000001',
        label: 'x'.repeat(65),
        message: 'x'.repeat(181),
    });
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.receiverAddress, /valid Sui address/);
    assert.match(invalid.errors.amountDisplay, /at most 6/);
    assert.match(invalid.errors.label, /64/);
    assert.match(invalid.errors.message, /180/);
});

test('invoice records preserve immutable payment identity and canonical values', () => {
    const invoice = makeInvoice();
    assert.equal(invoice.schemaVersion, 1);
    assert.equal(invoice.coinType, `0x${'0'.repeat(63)}2::sui::SUI`);
    assert.equal(invoice.amountAtomic, '1250000000');
    assert.equal(invoice.amountDisplay, '1.25');
    assert.equal(invoice.paymentStatus, 'pending');
    assert.equal(invoice.nonce, 'invoice-1');
    assert.equal(invoice.registryId, REGISTRY);
});

test('invoice history is wallet-scoped, versioned, durable, and corruption tolerant', () => {
    const values = new Map();
    const storage = {
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); },
    };
    const key = Core.createStorageKey('mainnet', ADDRESS);
    const invoice = makeInvoice();
    assert.match(key, /mainnet:0x[a-f0-9]{64}$/);
    assert.equal(Core.saveInvoices(storage, key, [invoice], 5), 1);
    const loaded = Core.loadInvoices(storage, key);
    assert.equal(loaded.corruptCount, 0);
    assert.equal(loaded.invoices.length, 1);
    assert.equal(loaded.invoices[0].nonce, invoice.nonce);
    assert.throws(() => Core.saveInvoices(storage, key, [invoice, invoice], 1), /limited to 1/);

    storage.setItem(key, JSON.stringify([invoice, { schemaVersion: 999 }]));
    const partiallyCorrupt = Core.loadInvoices(storage, key);
    assert.equal(partiallyCorrupt.invoices.length, 1);
    assert.equal(partiallyCorrupt.corruptCount, 1);
    storage.setItem(key, '{bad json');
    assert.equal(Core.loadInvoices(storage, key).corruptCount, 1);
});

test('paid state is monotonic while archive state remains locally reversible', () => {
    const pending = makeInvoice();
    const paid = Core.transitionInvoiceStatus(pending, {
        markPaid: true,
        checked: true,
        transactionDigest: '5d3txdigest',
        chainTimestamp: '2026-07-14T12:01:00.000Z',
        now: '2026-07-14T12:02:00.000Z',
    });
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal(paid.transactionDigest, '5d3txdigest');
    assert.equal(paid.detectedAt, '2026-07-14T12:02:00.000Z');
    const checkedAgain = Core.transitionInvoiceStatus(paid, { checked: true, error: null });
    assert.equal(checkedAgain.paymentStatus, 'paid');
    assert.equal(checkedAgain.transactionDigest, '5d3txdigest');

    const archived = Core.transitionInvoiceStatus(checkedAgain, { archive: true, now: '2026-07-14T13:00:00.000Z' });
    assert.equal(archived.archivedAt, '2026-07-14T13:00:00.000Z');
    assert.equal(Core.transitionInvoiceStatus(archived, { restore: true }).archivedAt, null);
});

test('CSV exports quote values and neutralize spreadsheet formulas', () => {
    const invoice = makeInvoice({ label: '=HYPERLINK("https://bad.example")', message: '+SUM(1,2)' });
    const csv = Core.buildCsv([invoice]);
    assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.example""\)"/);
    assert.match(csv, /"'\+SUM\(1,2\)"/);
    assert.equal(csv.split('\r\n').length, 2);
});
