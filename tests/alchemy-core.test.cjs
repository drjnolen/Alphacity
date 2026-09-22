const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../shared/alchemy-core.js');

function holding(overrides = {}) {
    return {
        coinType: '0xabc::dust::DUST',
        totalBalance: '123000000',
        metadata: { decimals: 9, symbol: 'DUST', name: 'Dust' },
        usdMicros: 750_000n,
        targetRoute: { coinOut: { amount: 25_000_000_000n } },
        ...overrides,
    };
}

test('normalizes equivalent Sui coin type addresses', () => {
    assert.equal(
        core.normalizeCoinType('0x0002::sui::SUI'),
        core.normalizeCoinType('0x2::sui::SUI'),
    );
    assert.equal(core.exclusionReason('0x0002::sui::SUI'), 'Gas coin');
});

test('excludes CITY and structured holdings', () => {
    assert.equal(core.exclusionReason(core.CITY_TYPE), 'Already CITY');
    assert.match(core.exclusionReason('0xabc::af_lp::AF_LP'), /LP/);
    assert.match(core.exclusionReason('0xabc::vault::Receipt'), /vault/);
});

test('formats integer balances without floating point loss', () => {
    assert.equal(core.formatUnits('123456789012345678', 9, 4), '123456789.0123');
    assert.equal(core.formatUsdMicros(999_999n), '$0.9999');
});

test('auto-selects below five dollars and allows manual selection at or above five', () => {
    for (const value of [10_001n, 999_999n, 1_000_000n, 4_999_999n, 5_000_000n, 5_000_001n, 100_000_000n]) {
        const row = holding({ usdMicros: value });
        assert.equal(core.classifyHolding(row).eligible, true);
        assert.equal(core.selectInitialHoldings([row]).length, value < 5_000_000n ? 1 : 0);
        assert.equal(core.selectionTotals([row], [row.coinType], 1).usdMicros, value);
    }
    assert.equal(core.classifyHolding(holding({ usdMicros: 5_000_000n })).code, 'manual-selection');
    assert.equal(core.classifyHolding(holding({ usdMicros: 100_000_000n, targetRoute: null })).eligible, false);
});

test('requires executable value and a target route, not input display metadata', () => {
    assert.equal(core.classifyHolding(holding({ metadata: null })).eligible, true);
    assert.equal(core.classifyHolding(holding({ usdMicros: null })).code, 'unverified');
    assert.equal(core.classifyHolding(holding({ targetRoute: null })).code, 'no-target-route');
});

test('missing or malformed decimals are never interpreted as zero', () => {
    for (const value of [null, undefined, '', ' ', false, true, {}, -1, 1.5, 31]) {
        assert.equal(core.clampDecimals(value), null);
    }
    for (const value of [0, '0', 6, 8, 9]) assert.equal(core.clampDecimals(value), Number(value));
});

test('selects the lowest-value eligible holdings first up to the batch cap', () => {
    const rows = [
        holding({ coinType: '0x1::a::A', usdMicros: 100_000n }),
        holding({ coinType: '0x2::b::B', usdMicros: 900_000n }),
        holding({ coinType: '0x3::c::C', usdMicros: 500_000n }),
        holding({ coinType: '0x4::d::D', usdMicros: 1_500_000n }),
    ];
    assert.deepEqual(core.selectInitialHoldings(rows, 2), ['0x1::a::A', '0x3::c::C']);
    assert.equal(core.DEFAULT_BATCH_LIMIT, 10);
});

test('computes aggregate minimum output using BigInt', () => {
    const rows = [
        holding({ coinType: '0x1::a::A', usdMicros: 100_000n, targetRoute: { coinOut: { amount: 1000n } } }),
        holding({ coinType: '0x2::b::B', usdMicros: 200_000n, targetRoute: { coinOut: { amount: 2000n } } }),
    ];
    const totals = core.selectionTotals(rows, rows.map(row => row.coinType), 1);
    assert.equal(totals.count, 2);
    assert.equal(totals.usdMicros, 300_000n);
    assert.equal(totals.targetAmount, 3000n);
    assert.equal(totals.minimumTargetAmount, 2970n);
});

test('recognizes fresh quotes and calculates net gas', () => {
    assert.equal(core.quoteIsFresh(10_000, 39_999, 30_000), true);
    assert.equal(core.quoteIsFresh(10_000, 40_001, 30_000), false);
    assert.equal(core.DEFAULT_PREPARED_MAX_AGE_MS, 90_000);
    assert.equal(core.gasUsedNet({
        computationCost: '100',
        storageCost: '50',
        storageRebate: '20',
        nonRefundableStorageFee: '5',
    }), 135n);
});

test('only displays verified holdings worth more than one cent', () => {
    for (const value of [null, undefined, 'invalid', -1n, 0n, 10_000n]) {
        assert.equal(core.isVisibleHolding(holding({ usdMicros: value })), false);
        assert.equal(core.classifyHolding(holding({ usdMicros: value })).eligible, false);
    }
    for (const value of [10_001n, 999_999n, 1_000_000n]) {
        assert.equal(core.isVisibleHolding(holding({ usdMicros: value })), true);
    }
    assert.equal(core.classifyHolding(holding({ usdMicros: 10_001n })).eligible, true);
    assert.deepEqual(core.selectInitialHoldings([holding({ usdMicros: 10_000n })]), []);
});

test('excludes the selected output token and allows the other target as input', () => {
    const lofi = core.TARGETS.LOFI;
    assert.equal(core.exclusionReason(core.LOFI_TYPE, lofi), 'Already LOFI');
    assert.equal(core.exclusionReason(core.CITY_TYPE, lofi), '');
    assert.equal(core.exclusionReason(core.LOFI_TYPE), '');
    const city = holding({ coinType: core.CITY_TYPE });
    assert.equal(core.classifyHolding(city, lofi).eligible, true);
    assert.deepEqual(core.selectInitialHoldings([city], 10, lofi), [core.CITY_TYPE]);
    assert.equal(core.selectionTotals([city], [city.coinType], 1, lofi).count, 1);
    assert.equal(core.classifyHolding(holding({ targetRoute: null }), lofi).label, 'No LOFI route');
});
