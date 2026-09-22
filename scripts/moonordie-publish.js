'use strict';

const fs = require('node:fs');
const { Transaction } = require('@mysten/sui/transactions');
const { SuiGrpcClient } = require('@mysten/sui/grpc');
const { keypairFromSecret, effectSucceeded, waitForFinality } = require('./sluice-relayer.js');

function immutablePublishTransaction(build) {
    if (!Array.isArray(build?.modules) || !build.modules.length || !Array.isArray(build.dependencies)) {
        throw new Error('Expected JSON output from sui move build --dump-bytecode-as-base64');
    }
    const tx = new Transaction();
    const [upgradeCap] = tx.publish({ modules: build.modules, dependencies: build.dependencies });
    // Consume the capability in the publication transaction, before the package
    // can accept any user deposits. There is no administrator holding it later.
    tx.moveCall({ target: '0x2::package::make_immutable', arguments: [upgradeCap] });
    return tx;
}

async function main() {
    const args = process.argv.slice(2);
    const file = args[args.indexOf('--build-json') + 1];
    if (!args.includes('--build-json') || !file) throw new Error('Usage: node scripts/moonordie-publish.js --build-json <file> [--execute]');
    const network = process.env.SUI_NETWORK || 'testnet';
    if (!['mainnet', 'testnet'].includes(network)) throw new Error('Unsupported network');
    const tx = immutablePublishTransaction(JSON.parse(fs.readFileSync(file, 'utf8')));
    const client = new SuiGrpcClient({ network, baseUrl: process.env.SUI_GRPC_URL || `https://fullnode.${network}.sui.io:443` });
    if (!args.includes('--execute')) {
        if (!process.env.MOONORDIE_PUBLISHER_ADDRESS) throw new Error('MOONORDIE_PUBLISHER_ADDRESS is required for simulation');
        tx.setSender(process.env.MOONORDIE_PUBLISHER_ADDRESS);
        const result = await client.core.simulateTransaction({ transaction: tx, include: { effects: true } });
        console.log(JSON.stringify(result));
        if (!effectSucceeded(result)) throw new Error('Publication simulation failed');
        return;
    }
    const keypair = keypairFromSecret(process.env.MOONORDIE_PUBLISHER_PRIVATE_KEY);
    const result = await keypair.signAndExecuteTransaction({ transaction: tx, client, include: { effects: true } });
    if (!effectSucceeded(result)) throw new Error('Publication failed');
    const digest = await waitForFinality(client, result);
    console.log(JSON.stringify({ network, digest, result }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { immutablePublishTransaction };
