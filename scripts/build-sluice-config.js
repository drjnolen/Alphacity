'use strict';

const fs = require('node:fs');
const path = require('node:path');

const legacyPackageAddress = process.env.SLUICE_LEGACY_PACKAGE_ADDRESS
    || '0x7c7ca3da6bad849a02d9f888b2f8cab40d507b2c01bbcab3f2d816334c17aa07';
const oraclePublicKeys = String(process.env.SLUICE_ORACLE_PUBLIC_KEYS || '')
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean);
const config = {
    network: process.env.SLUICE_NETWORK || 'mainnet',
    v2PackageAddress: process.env.SLUICE_V2_PACKAGE_ADDRESS || '',
    legacyPackageAddress,
    oraclePublicKeys,
    oracleThreshold: Number(process.env.SLUICE_ORACLE_THRESHOLD || 1),
};

const output = `// Generated at deploy time from public repository variables.\nwindow.SLUICE_CONFIG = Object.freeze(${JSON.stringify(config, null, 4)});\n`;
fs.writeFileSync(path.join(__dirname, '..', 'sluice', 'config.js'), output, 'utf8');
console.log(`Sluice runtime config generated (V2 package: ${config.v2PackageAddress || 'not configured'}, oracles: ${oraclePublicKeys.length}).`);
