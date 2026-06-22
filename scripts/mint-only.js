const { spawnSync } = require('child_process');
const path = require('path');

const SUI_CLI = 'c:\\Users\\Julia\\Documents\\antigravity\\delightful-bohr\\scripts\\sui-cli-new\\sui.exe';
const RECIPIENT = '0x6da4d96a61b069d1223bb4fa2d23b94ca2ea00db25b709fd9f04fa73656d15b2';

// Already published values
const PACKAGE_ID = '0x00e680f8927efa6382c77201d7694a3a2587fd19912b97576a1f73b0112bf70a';
const MINT_CAP_ID = '0x0fdd2c92f89e793aa5ec936a2520ecffc1760819abc70cb57abc3e5fd89d1a03';

// Rarity assets and properties
const ASSETS = {
    PEERLESS: {
        rarity: 'Peerless',
        amp: 3,
        url: 'https://raw.githubusercontent.com/drjnolen/Alphacity/main/assets/city-tech/Peerless.png',
        count: 5
    },
    BLACK_MARKET: {
        rarity: 'Black Market',
        amp: 2,
        url: 'https://raw.githubusercontent.com/drjnolen/Alphacity/main/assets/city-tech/Black%20Market.png',
        count: 10
    },
    STREET_MOD: {
        rarity: 'Street Mod',
        amp: 1,
        url: 'https://raw.githubusercontent.com/drjnolen/Alphacity/main/assets/city-tech/Street%20Mod.png',
        count: 20
    }
};

function runCommand(bin, args, options = {}) {
    console.log(`Executing: ${bin} ${args.join(' ')}`);
    const res = spawnSync(bin, args, { encoding: 'utf-8', ...options });
    if (res.error) {
        throw res.error;
    }
    if (res.status !== 0) {
        console.error(`Command failed with status ${res.status}`);
        console.error(`Stderr: ${res.stderr}`);
        console.error(`Stdout: ${res.stdout}`);
        throw new Error(`Command execution failed`);
    }
    return res.stdout;
}

function buildNFTLists() {
    const names = [];
    const descriptions = [];
    const imageUrls = [];
    const rarities = [];
    const amps = [];

    let id = 1;

    // Helper to add items
    const addItems = (config) => {
        for (let i = 0; i < config.count; i++) {
            names.push(`Biologic Upgrade #${String(id).padStart(3, '0')}`);
            descriptions.push(`${config.rarity} Biologic Upgrade (Amp: ${config.amp}) for the City Tech collection.`);
            imageUrls.push(config.url);
            rarities.push(config.rarity);
            amps.push(String(config.amp)); // Pass u64 as string representation
            id++;
        }
    };

    addItems(ASSETS.PEERLESS);
    addItems(ASSETS.BLACK_MARKET);
    addItems(ASSETS.STREET_MOD);

    return { names, descriptions, imageUrls, rarities, amps };
}

async function main() {
    try {
        console.log('--- Step 1: Generating NFT Metadata Lists ---');
        const { names, descriptions, imageUrls, rarities, amps } = buildNFTLists();
        console.log(`Generated metadata for ${names.length} NFTs.`);

        console.log('--- Step 2: Executing Batch Mint (Higher Gas Budget) ---');
        const mintOutput = runCommand(SUI_CLI, [
            'client', 'call',
            '--package', PACKAGE_ID,
            '--module', 'city_tech',
            '--function', 'mint_batch',
            '--args',
            MINT_CAP_ID,
            JSON.stringify(names),
            JSON.stringify(descriptions),
            JSON.stringify(imageUrls),
            JSON.stringify(rarities),
            JSON.stringify(amps),
            RECIPIENT,
            '--gas-budget', '200000000', // 0.2 SUI
            '--json'
        ]);

        const mintData = JSON.parse(mintOutput);
        console.log(`Batch Mint Executed Successfully!`);
        console.log(`Transaction Digest: ${mintData.digest}`);
        console.log(`SuiScan link: https://suiscan.xyz/mainnet/tx/${mintData.digest}\n`);

        console.log('--- Summary of Minted NFTs ---');
        console.log(`Total Minted: ${names.length} NFTs`);
        console.log(`Recipient: ${RECIPIENT}`);
        console.log(`Verification link: https://suiscan.xyz/mainnet/account/${RECIPIENT}/portfolio`);

    } catch (err) {
        console.error('Fatal Error during execution:', err);
        process.exit(1);
    }
}

main();
