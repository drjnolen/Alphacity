const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView,
    URL, URLSearchParams, Headers, Request, Response, fetch, atob, btoa,
    console, setTimeout, clearTimeout, Event,
    document: { createElement: () => ({ relList: { supports: () => true } }) },
});
context.window = context;
const asset = fs.readFileSync(path.join(root, 'assets/index-BymD0MH7.js'), 'utf8');
// Load the actual shipped legacy builder without starting the staking UI.
const boot = 'Lo();Po();_t();Xr();Co();Yr();d.protocolStatsTimer=setInterval(Yr,so);';
assert.ok(asset.includes(boot));
vm.runInContext(asset.replace(boot, 'globalThis.LegacyTransaction=$e;'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'shared/sui-client.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'staking/transaction-client.js'), 'utf8'), context);

const owner = `0x${'1'.repeat(64)}`;
const digest = '11111111111111111111111111111111';
function legacyTransaction(action = 'claim_credits') {
    const tx = new context.LegacyTransaction();
    tx.setSender(owner);
    tx.moveCall({
        target: `0xabc::city_staking::${action}`, typeArguments: ['0xabc::city::CITY'],
        arguments: [
            tx.sharedObjectRef({ objectId: '0x10', initialSharedVersion: '1', mutable: true }),
            tx.objectRef({ objectId: '0x11', version: '2', digest }),
            tx.sharedObjectRef({ objectId: '0x6', initialSharedVersion: '1', mutable: false }),
        ],
    });
    return tx;
}

function mockClient({ addressBalance = '100000000', coins = [], failure = false } = {}) {
    const client = context.AlphaCitySuiBundle.createSuiDataLayer().grpcClient;
    // Exercise the real gRPC resolver; only the node's simulation response is mocked.
    client.transactionExecutionService.simulateTransaction = async (request) => {
        assert.equal(request.doGasSelection, true);
        assert.equal(request.transaction.sender, owner);
        if (failure) throw new Error('Stake is locked');
        if (addressBalance === '0' && !coins.length) throw new Error('No valid gas coins found for the transaction.');
        const useBalance = BigInt(addressBalance) >= 2400000n;
        return { response: { transaction: {
            effects: { status: { success: true } },
            transaction: {
                ...request.transaction,
                gasPayment: { owner, budget: 2400000n, price: 1000n,
                    objects: useBalance ? [] : coins.map(coin => ({ ...coin, version: BigInt(coin.version) })) },
                expiration: useBalance ? { kind: 3, minEpoch: 123n, epoch: 124n, chain: digest, nonce: 1 } : { kind: 1 },
            },
        } } };
    };
    return client;
}

function layer(config) {
    return context.AlphaCitySuiBundle.createSuiDataLayer({ grpcClient: mockClient(config) });
}

test('shipped legacy builder reproduces the reported error with no gas coin objects', async () => {
    const tx = legacyTransaction();
    tx.setGasBudget(2400000);
    tx.setGasPrice(1000);
    await assert.rejects(tx.build({ client: {
        getCoins: async () => ({ data: [] }),
        getProtocolConfig: async () => ({ attributes: { max_gas_payment_objects: { u64: '256' } } }),
    } }), /No valid gas coins/);
});

for (const action of ['claim_credits', 'unstake']) {
    test(`${action} builds from SUI address balance without gas coin objects`, async () => {
        const legacy = legacyTransaction(action);
        const original = legacy.serialize();
        const { transaction, bytes } = await layer().prepareTransaction(legacy);
        const data = transaction.getData();
        assert.ok(bytes.length > 0);
        assert.equal(data.sender, owner);
        assert.equal(data.commands[0].MoveCall.function, action);
        assert.equal(data.commands[0].MoveCall.arguments.length, 3);
        assert.equal(data.gasData.budget, '2400000');
        assert.equal(data.gasData.payment.length, 0);
        assert.equal(data.expiration.ValidDuring.minEpoch, '123');
        assert.equal(data.expiration.ValidDuring.maxEpoch, '124');
        assert.equal(legacy.serialize(), original);
        assert.deepEqual(await transaction.build(), bytes);
    });
}

test('coin-based gas remains supported when the address balance cannot cover the budget', async () => {
    const coin = { objectId: `0x${'2'.repeat(64)}`, version: '7', digest, balance: '100000000' };
    const { transaction } = await layer({ addressBalance: '1', coins: [coin] }).prepareTransaction(legacyTransaction('unstake'));
    assert.equal(transaction.getData().gasData.payment[0].objectId, coin.objectId);
    assert.equal(transaction.getData().gasData.payment[0].version, '7');
});

test('migration preserves bulk calls and CITY coin commands used when staking', async () => {
    const tx = legacyTransaction('unstake');
    tx.moveCall({
        target: '0xabc::city_staking::unstake', typeArguments: ['0xabc::city::CITY'],
        arguments: [tx.objectRef({ objectId: '0x12', version: '2', digest })],
    });
    const city = tx.objectRef({ objectId: '0x20', version: '2', digest });
    tx.mergeCoins(city, [tx.objectRef({ objectId: '0x21', version: '2', digest })]);
    const [amount] = tx.splitCoins(city, [tx.pure.u64('1000000000')]);
    tx.moveCall({ target: '0xabc::city_staking::stake_new', typeArguments: ['0xabc::city::CITY'],
        arguments: [amount, tx.pure.u64(7)] });
    const { transaction } = await layer().prepareTransaction(tx);
    const commands = transaction.getData().commands;
    assert.equal(commands.length, 5);
    assert.equal(commands[1].MoveCall.function, 'unstake');
    assert.ok(commands[2].MergeCoins);
    assert.ok(commands[3].SplitCoins);
    assert.equal(commands[4].MoveCall.function, 'stake_new');
    assert.equal(commands[4].MoveCall.arguments[0].NestedResult[0], 3);
});

test('missing gas and failed simulations stop before any signing request', async () => {
    for (const config of [{ addressBalance: '0' }, { failure: true }]) {
        context.AlphaCitySui = layer(config);
        let calls = 0;
        await assert.rejects(context.AlphaCityStakingTransactions.signAndExecute({
            transaction: legacyTransaction(), account: { address: owner },
            wallet: { signAndExecuteTransaction: async () => { calls++; } },
        }), /No valid gas coins|Stake is locked/);
        assert.equal(calls, 0);
    }
});

test('modern Slush feature receives a resolved Transaction and the selected account', async () => {
    context.AlphaCitySui = layer();
    const account = { address: owner };
    let calls = 0;
    const result = await context.AlphaCityStakingTransactions.signAndExecute({
        transaction: legacyTransaction(), account,
        wallet: { features: {
            'sui:signAndExecuteTransaction': { async signAndExecuteTransaction(input) {
                calls++;
                assert.equal(input.account, account);
                assert.equal(input.chain, 'sui:mainnet');
                assert.equal(typeof input.transaction.toJSON, 'function');
                assert.equal(JSON.parse(await input.transaction.toJSON()).gasData.payment.length, 0);
                return { digest: 'executed' };
            } },
            'sui:signAndExecuteTransactionBlock': { async signAndExecuteTransactionBlock() { assert.fail('Legacy API selected'); } },
        } },
    });
    assert.equal(result.digest, 'executed');
    assert.equal(calls, 1);
});

test('legacy standard and injected wallets receive built bytes', async () => {
    context.AlphaCitySui = layer();
    const api = { async signAndExecuteTransactionBlock(input) {
        assert.ok(input.transactionBlock.length > 0);
        assert.equal(input.options.showEffects, true);
        return [{ digest: 'legacy-executed' }];
    } };
    for (const wallet of [api, { features: { 'sui:signAndExecuteTransactionBlock': api } }]) {
        const result = await context.AlphaCityStakingTransactions.signAndExecute({ transaction: legacyTransaction(), wallet, account: owner });
        assert.equal(result.digest, 'legacy-executed');
    }
});

test('wallet rejection is propagated without another execution attempt', async () => {
    context.AlphaCitySui = layer();
    let calls = 0;
    await assert.rejects(context.AlphaCityStakingTransactions.signAndExecute({
        transaction: legacyTransaction(), account: owner,
        wallet: {
            async signAndExecuteTransaction() { calls++; throw new Error('User rejected'); },
            async signAndExecuteTransactionBlock() { assert.fail('Retried execution'); },
        },
    }), /User rejected/);
    assert.equal(calls, 1);
});

test('all three shipped wallet adapters use the new transaction path', () => {
    assert.equal(asset.match(/window\.AlphaCityStakingTransactions\.signAndExecute\(/g).length, 3);
    assert.equal(asset.includes('.build({client:bt})'), false);
    const html = fs.readFileSync(path.join(root, 'staking/index.html'), 'utf8');
    assert.ok(html.indexOf('/staking/transaction-client.js') < html.indexOf('/assets/index-BymD0MH7.js'));
});
