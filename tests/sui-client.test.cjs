const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

global.window = global;
const bundle = fs.readFileSync(path.join(__dirname, '..', 'shared', 'sui-client.js'), 'utf8');
vm.runInThisContext(bundle, { filename: 'shared/sui-client.js' });

const { createSuiDataLayer, legacyMoveJson, legacyObject } = AlphaCitySuiBundle;

function mockLayer(
    graphqlResponder = () => ({ data: {} }),
    moveFunctionResponder = async () => ({
        function: {
            visibility: 'public',
            isEntry: false,
            typeParameters: [],
            parameters: [],
            returns: [],
        },
    }),
) {
    const grpcClient = {
        async getBalance() {
            return { balance: { coinType: '0x2::sui::SUI', balance: '42', coinBalance: '40', addressBalance: '2' } };
        },
        async listBalances() {
            return { balances: [{ coinType: '0x2::sui::SUI', balance: '42', coinBalance: '40', addressBalance: '2' }], hasNextPage: false, cursor: null };
        },
        async listCoins() {
            return { objects: [{ objectId: '0x1', version: '7', digest: 'digest', type: '0x2::coin::Coin<0x2::sui::SUI>', balance: '42' }], hasNextPage: false, cursor: null };
        },
        async listOwnedObjects() {
            return {
                objects: [{
                    objectId: '0xstake', version: '9', digest: 'digest',
                    type: '0x0000000000000000000000000000000000000000000000000000000000000abc::staking::Stake', owner: { AddressOwner: '0xowner' },
                    json: { staked_amount: '100', principal: { value: '100' } },
                    display: { output: { name: 'Stake' }, errors: null },
                }],
                hasNextPage: false, cursor: null,
            };
        },
        async getObject({ objectId }) {
            return { object: { objectId, version: '1', digest: 'd', type: '0xabc::m::T', owner: { AddressOwner: '0xowner' }, json: { value: '1' }, display: null } };
        },
        async getObjects({ objectIds }) {
            return { objects: objectIds.map(objectId => ({ objectId, version: '1', digest: 'd', type: '0xabc::m::T', owner: { AddressOwner: '0xowner' }, json: { value: '1' }, display: null })) };
        },
        async getCoinMetadata() {
            return { coinMetadata: { id: '0xmeta', decimals: 9, name: 'Sui', symbol: 'SUI', description: '', iconUrl: '' } };
        },
        async getReferenceGasPrice() {
            return { referenceGasPrice: '100' };
        },
        async simulateTransaction({ transaction }) {
            assert.deepEqual([...transaction], [1, 2, 3]);
            return {
                $kind: 'Transaction',
                Transaction: {
                    epoch: '9',
                    effects: {
                        status: { success: true, error: null },
                        gasUsed: {
                            computationCost: '1000', storageCost: '200', storageRebate: '50', nonRefundableStorageFee: '5',
                        },
                        transactionDigest: 'dry-run-digest',
                        dependencies: ['dependency'],
                    },
                },
            };
        },
        core: {
            async getProtocolConfig() {
                return {
                    protocolConfig: {
                        protocolVersion: '128',
                        featureFlags: { enableEffectsV2: true },
                        attributes: {
                            max_tx_gas: '50000000000000',
                            max_gas_payment_objects: '256',
                            max_tx_size_bytes: '131072',
                            max_pure_argument_size: '16384',
                        },
                    },
                };
            },
        },
        stateService: {
            async getCoinInfo() { return { response: { treasury: { totalSupply: 1000n } } }; },
        },
    };
    return createSuiDataLayer({
        grpcClient,
        graphqlUrls: ['mock'],
        graphqlClients: [{ query: graphqlResponder, getMoveFunction: moveFunctionResponder }],
    });
}

test('Move JSON exposes both modern and legacy nested field access', () => {
    const result = legacyMoveJson({ principal: { value: '100' } });
    assert.equal(result.principal.value, '100');
    assert.equal(result.fields.principal.fields.value, '100');
});

test('gRPC balance and object responses retain JSON-RPC shapes', async () => {
    const layer = mockLayer();
    const balance = await layer.rpc('suix_getBalance', ['0xowner', '0x2::sui::SUI']);
    assert.equal(balance.totalBalance, '42');

    const objects = await layer.rpc('suix_getOwnedObjects', [
        '0xowner',
        { filter: { StructType: '0xabc::staking::Stake' }, options: { showContent: true, showDisplay: true } },
        null,
        50,
    ]);
    assert.equal(objects.data[0].data.content.fields.staked_amount, '100');
    assert.equal(objects.data[0].data.content.fields.principal.fields.value, '100');
    assert.equal(objects.data[0].data.display.data.name, 'Stake');
});

test('GraphQL transaction history retains balanceChanges and status shapes', async () => {
    const layer = mockLayer(async ({ query, variables }) => {
        assert.match(query, /QueryTransactions/);
        assert.equal(variables.limit, 50);
        return {
            data: {
                transactions: {
                    pageInfo: { hasPreviousPage: false, startCursor: null },
                    nodes: [{
                        digest: 'tx', sender: { address: '0xowner' },
                        effects: {
                            status: 'SUCCESS', timestamp: '2026-07-11T00:00:00Z',
                            balanceChanges: { nodes: [{ amount: '-10', coinType: { repr: '0x2::sui::SUI' }, owner: { address: '0xowner' } }] },
                        },
                    }],
                },
            },
        };
    });
    const page = await layer.rpc('suix_queryTransactionBlocks', [{ filter: { FromAddress: '0xowner' } }, null, 100, true]);
    assert.equal(page.data[0].effects.status.status, 'success');
    assert.equal(page.data[0].balanceChanges[0].owner.AddressOwner, '0xowner');
    assert.equal(page.data[0].balanceChanges[0].amount, '-10');
});

test('legacy object helper reports missing objects without throwing', () => {
    assert.equal(legacyObject(new Error('missing')).error.message, 'missing');
});

test('staking transaction builder methods retain legacy JSON-RPC response shapes', async () => {
    const layer = mockLayer(undefined, async ({ packageId, moduleName, name }) => {
        assert.equal(packageId, '0x0abc');
        assert.equal(moduleName, 'city_staking');
        assert.equal(name, 'claim_credits');
        return {
            function: {
                visibility: 'public',
                isEntry: false,
                typeParameters: [{ isPhantom: false, constraints: ['key'] }],
                parameters: [
                    {
                        reference: 'immutable',
                        body: {
                            $kind: 'datatype',
                            datatype: { typeName: '0x0abc::city_staking::StakingPool', typeParameters: [] },
                        },
                    },
                    {
                        reference: 'mutable',
                        body: {
                            $kind: 'datatype',
                            datatype: {
                                typeName: '0x0abc::city_staking::UserStake',
                                typeParameters: [{ $kind: 'typeParameter', index: 0 }],
                            },
                        },
                    },
                    {
                        reference: 'immutable',
                        body: {
                            $kind: 'datatype',
                            datatype: {
                                typeName: '0x0000000000000000000000000000000000000000000000000000000000000002::clock::Clock',
                                typeParameters: [],
                            },
                        },
                    },
                    {
                        reference: 'immutable',
                        body: {
                            $kind: 'datatype',
                            datatype: {
                                typeName: '0x0000000000000000000000000000000000000000000000000000000000000002::tx_context::TxContext',
                                typeParameters: [],
                            },
                        },
                    },
                ],
                returns: [],
            },
        };
    });
    assert.equal(await layer.rpc('suix_getReferenceGasPrice'), '100');

    const protocol = await layer.rpc('sui_getProtocolConfig');
    assert.equal(protocol.protocolVersion, '128');
    assert.equal(protocol.attributes.max_tx_gas.u64, '50000000000000');
    assert.equal(protocol.attributes.max_tx_size_bytes.u64, '131072');

    const dryRun = await layer.rpc('sui_dryRunTransactionBlock', ['AQID']);
    assert.equal(dryRun.effects.status.status, 'success');
    assert.equal(dryRun.effects.gasUsed.computationCost, '1000');
    assert.equal(dryRun.effects.gasUsed.storageRebate, '50');

    const moveFunction = await layer.rpc('sui_getNormalizedMoveFunction', [
        '0x0abc',
        'city_staking',
        'claim_credits',
    ]);
    assert.equal(moveFunction.visibility, 'Public');
    assert.deepEqual(moveFunction.typeParameters, [{ abilities: ['Key'] }]);
    assert.equal(moveFunction.parameters[0].Reference.Struct.name, 'StakingPool');
    assert.equal(moveFunction.parameters[0].Reference.Struct.address, '0xabc');
    assert.equal(moveFunction.parameters[1].MutableReference.Struct.typeArguments[0].TypeParameter, 0);
    assert.equal(moveFunction.parameters[2].Reference.Struct.name, 'Clock');

    const txContext = moveFunction.parameters[3].Reference.Struct;
    assert.equal(txContext.address, '0x2');
    assert.equal(txContext.module, 'tx_context');
    assert.equal(txContext.name, 'TxContext');
    assert.equal(moveFunction.parameters.slice(0, -1).length, 3);
});

test('staking bridge reroutes only legacy JSON-RPC requests', async () => {
    const originalFetch = global.fetch;
    const originalLayer = global.AlphaCitySui;
    const bridge = fs.readFileSync(path.join(__dirname, '..', 'shared', 'sui-jsonrpc-bridge.js'), 'utf8');
    delete global.__alphaCitySuiJsonRpcBridgeInstalled;
    global.AlphaCitySui = { rpc: async (method) => ({ method, totalBalance: '42' }) };
    vm.runInThisContext(bridge, { filename: 'shared/sui-jsonrpc-bridge.js' });

    const response = await global.fetch('https://fullnode.mainnet.sui.io:443', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'suix_getBalance', params: ['0xowner'] }),
    });
    const payload = await response.json();
    assert.equal(payload.id, 9);
    assert.equal(payload.result.method, 'suix_getBalance');
    assert.equal(payload.result.totalBalance, '42');

    global.fetch = originalFetch;
    global.AlphaCitySui = originalLayer;
    delete global.__alphaCitySuiJsonRpcBridgeInstalled;
});
