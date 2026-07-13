const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'shared', 'lp-tools.js'), 'utf8'),
    context,
    { filename: 'shared/lp-tools.js' },
);

const tools = context.AlphaCityLpTools;
const TURBOS_TYPE = '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1::position_nft::TurbosPositionNFT';

test('automatic LP detection recognizes a Turbos position NFT', () => {
    const position = {
        data: {
            objectId: '0xd342753fce4a8326906a70c32b25969d28ad97c4baee1d646e1a329db92d2cb1',
            type: TURBOS_TYPE,
            content: {
                fields: {
                    pool_id: '0x0df4f02d0e210169cb6d5aabd03c3058328c06f2c4dbb0804faa041159c78443',
                    position_id: '0x90224cc7002e5c82af422945b0039c143cca2f8e16481e0f9fbb3384c8a31ed9',
                    coin_type_a: '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
                    coin_type_b: 'dba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
                },
            },
        },
    };
    assert.equal(tools.isConcentratedPositionObject(position), true);
    assert.equal(tools.protocolForType(TURBOS_TYPE), 'turbos');
    assert.ok(Array.from(tools.POSITION_TYPES).includes(TURBOS_TYPE));
});

test('live Turbos SUI-USDC fixture calculates both current pool holdings', () => {
    const amounts = tools.calculateClmmAmounts(
        {
            liquidity: '161933041856',
            tick_lower_index: { fields: { bits: 4294893916 } },
            tick_upper_index: { fields: { bits: 4294895756 } },
        },
        { sqrt_price: '493609098690667824' },
    );
    const sui = amounts.amountA / 1e9;
    const usdc = amounts.amountB / 1e6;
    assert.ok(Math.abs(sui - 260.9507564) < 0.0001);
    assert.ok(Math.abs(usdc - 202.7345408) < 0.0001);
});

test('live Turbos DEEP-USDC fixture honors six-decimal metadata', () => {
    const amounts = tools.calculateClmmAmounts(
        {
            liquidity: '9621761827',
            tick_lower_index: { fields: { bits: 4294926856 } },
            tick_upper_index: { fields: { bits: 4294930636 } },
        },
        { sqrt_price: '2464489720465139994' },
    );
    assert.ok(Math.abs(amounts.amountA / 1e6 - 11863.365013) < 0.0001);
    assert.ok(Math.abs(amounts.amountB / 1e6 - 11.5119734) < 0.0001);
});

test('Turbos positions link directly to their protocol position page', () => {
    const positionId = '0xd342753fce4a8326906a70c32b25969d28ad97c4baee1d646e1a329db92d2cb1';
    assert.equal(
        tools.positionUrl({ protocol: 'turbos', positionId }),
        `https://app.turbos.finance/#/pools/${positionId}/position`,
    );
});
