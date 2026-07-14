const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'shared', 'staking-credits.js'), 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(source, context);
const credits = context.globalThis.AlphaCityStakingCredits;

const USER = '0xcd2d5f5fc335aba0d01e629d451c0de458ce7ed0afae8062213a97f80562e87f';
const PACKAGE = '0xstaking';
const CITY = '0xcity::city::CITY';

function stakeObject({
    objectId,
    address = USER,
    staked = 0n,
    claimed = 0n,
    unclaimed = 0n,
    multiplierBps = 0,
    lastAccrualMs = 0,
    lockEndMs = 0,
}) {
    return {
        data: {
            objectId,
            owner: { AddressOwner: address },
            content: {
                fields: {
                    staked_amount: staked.toString(),
                    claimed_credits: claimed.toString(),
                    unclaimed_credits: unclaimed.toString(),
                    multiplier_bps: String(multiplierBps),
                    last_accrual_ms: String(lastAccrualMs),
                    lock_end_ms: String(lockEndMs),
                },
            },
        },
    };
}

test('aggregates every retained stake position into exact lifetime claimed credits', () => {
    const claimedValues = [
        4_319_999_999_997n,
        8_399_999_999_999n,
        74_520_000_000_000n,
        1_679_999_999n,
        53_999_999_999_998n,
        8_399_999_998n,
        168_023_693_704_851n,
        3_359_999_999_999n,
        2_240_316_666n,
    ];
    const objects = claimedValues.map((claimed, index) => stakeObject({ objectId: `0x${index}`, claimed }));
    const snapshot = credits.aggregateStakeObjects(objects, 0);

    assert.equal(snapshot.positions.length, 9);
    assert.equal(snapshot.claimedLeaderboard.length, 1);
    assert.equal(snapshot.claimedLeaderboard[0].address, USER);
    assert.equal(snapshot.claimedLeaderboard[0].claimedCreditsAtomic, 312_636_014_021_507n);
});

test('calculates pending credits with the staking contract integer formula and accrual cap', () => {
    const parsed = credits.parseStakeObject(stakeObject({
        objectId: '0xactive',
        staked: 1_000_000_000_000_000n,
        unclaimed: 2_000_000_000n,
        multiplierBps: 10_000,
        lastAccrualMs: 1_000,
        lockEndMs: 3_601_000,
    }));

    assert.equal(credits.calculateCurrentUnclaimed(parsed, 3_601_000), 12_000_000_000n);
    assert.equal(credits.calculateCurrentUnclaimed(parsed, 7_201_000), 12_000_000_000n);

    const inactive = credits.parseStakeObject(stakeObject({
        objectId: '0xinactive',
        unclaimed: 7_500_000_000n,
    }));
    assert.equal(credits.calculateCurrentUnclaimed(inactive, 99_999_999), 7_500_000_000n);
});

test('paginates the global UserStake object query without per-wallet RPC fan-out', async () => {
    const calls = [];
    const pages = new Map([
        [null, { data: [stakeObject({ objectId: '0x1', claimed: 1n })], hasNextPage: true, nextCursor: 'page-2' }],
        ['page-2', { data: [stakeObject({ objectId: '0x2', claimed: 2n })], hasNextPage: false, nextCursor: null }],
    ]);
    const rpc = async (method, params) => {
        calls.push({ method, params });
        return pages.get(params[1]);
    };

    const snapshot = await credits.loadSnapshot({ rpc, packageIds: [PACKAGE], coinType: CITY, nowMs: 0 });

    assert.equal(snapshot.positions.length, 2);
    assert.deepEqual(calls.map((call) => call.method), ['suix_queryObjects', 'suix_queryObjects']);
    assert.equal(calls[0].params[0].filter.StructType, `${PACKAGE}::city_staking::UserStake<${CITY}>`);
    assert.equal(calls[0].params[0].options.showOwner, true);
});

test('staking and airdrop surfaces use the shared object-state accounting path', () => {
    const stakingHtml = fs.readFileSync(path.join(root, 'staking', 'index.html'), 'utf8');
    const airdropHtml = fs.readFileSync(path.join(root, 'airdrop', 'index.html'), 'utf8');
    const bridgeSource = fs.readFileSync(path.join(root, 'staking', 'credits-data-bridge.js'), 'utf8');

    assert.match(stakingHtml, /src="\/shared\/staking-credits\.js"/);
    assert.match(stakingHtml, /src="\/staking\/credits-data-bridge\.js"/);
    assert.ok(stakingHtml.indexOf('/shared/staking-credits.js') < stakingHtml.indexOf('/assets/index-BymD0MH7.js'));
    assert.match(bridgeSource, /AlphaCityStakingCredits\.loadSnapshot/);
    assert.match(airdropHtml, /snapshot\.claimedLeaderboard/);
    assert.match(airdropHtml, /snapshot\.totalLeaderboard/);
    assert.match(airdropHtml, /snapshot\.stakers\.map/);
    assert.doesNotMatch(airdropHtml, /queryAllEvents\(/);
});

test('staking compatibility bridge paginates synthetic state events and forwards unrelated RPC calls', async () => {
    const bridgeSource = fs.readFileSync(path.join(root, 'staking', 'credits-data-bridge.js'), 'utf8');
    const forwarded = [];
    const positions = Array.from({ length: 117 }, (_, index) => ({
        objectId: `0x${index}`,
        address: USER,
        stakedAmountAtomic: BigInt(index + 1),
        claimedCreditsAtomic: BigInt(index * 10),
    }));
    const bridgeContext = {
        window: {
            AlphaCitySui: {
                rpc: async (method, params) => {
                    forwarded.push({ method, params });
                    return { forwarded: true };
                },
            },
            AlphaCityStakingCredits: {
                loadSnapshot: async ({ rpc }) => {
                    await rpc('suix_queryObjects', []);
                    return { positions };
                },
            },
        },
        Date,
        Set,
    };
    vm.createContext(bridgeContext);
    vm.runInContext(bridgeSource, bridgeContext);

    const eventPrefix = '0x008856d5d6d60a088f6153dbe6f7697d19f81d1d0403695c9e9fbaecdc8b29a9::city_staking::';
    const first = await bridgeContext.window.AlphaCitySui.rpc('suix_queryEvents', [
        { MoveEventType: `${eventPrefix}StakeCreated` }, null, 100, false,
    ]);
    const second = await bridgeContext.window.AlphaCitySui.rpc('suix_queryEvents', [
        { MoveEventType: `${eventPrefix}StakeCreated` }, first.nextCursor, 100, false,
    ]);
    const claims = await bridgeContext.window.AlphaCitySui.rpc('suix_queryEvents', [
        { MoveEventType: `${eventPrefix}CreditsClaimed` }, null, 1, false,
    ]);
    const forwardedResponse = await bridgeContext.window.AlphaCitySui.rpc('suix_getBalance', ['0xowner']);

    assert.equal(first.data.length, 100);
    assert.equal(first.hasNextPage, true);
    assert.equal(second.data.length, 17);
    assert.equal(second.hasNextPage, false);
    assert.equal(claims.data[0].parsedJson.lifetime_claimed, '0');
    assert.equal(forwardedResponse.forwarded, true);
    assert.deepEqual(forwarded.map(({ method }) => method), ['suix_queryObjects', 'suix_getBalance']);
});
