'use strict';

const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');

const requested = Number(process.argv[2] || 1);
if (!Number.isInteger(requested) || requested < 1 || requested > 10) {
    console.error('Usage: node scripts/sluice-keygen.js [oracle-count: 1-10]');
    process.exit(1);
}

const oracleKeys = Array.from({ length: requested }, () => new Ed25519Keypair());
const gasKey = new Ed25519Keypair();
const publicHex = keypair => `0x${Buffer.from(keypair.getPublicKey().toRawBytes()).toString('hex')}`;

console.log(JSON.stringify({
    warning: 'Store private values only in GitHub Actions secrets. Public values belong in repository variables.',
    repositoryVariables: {
        SLUICE_ORACLE_PUBLIC_KEYS: oracleKeys.map(publicHex).join(','),
        SLUICE_ORACLE_THRESHOLD: requested === 1 ? 1 : requested,
    },
    repositorySecrets: {
        SLUICE_ORACLE_PRIVATE_KEYS: oracleKeys.map(keypair => keypair.getSecretKey()).join(','),
        SLUICE_RELAYER_PRIVATE_KEY: gasKey.getSecretKey(),
    },
    relayerGasAddress: gasKey.toSuiAddress(),
}, null, 2));
