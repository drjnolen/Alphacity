const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SUI_CLI = 'c:\\Users\\Julia\\Documents\\antigravity\\delightful-bohr\\scripts\\sui-cli-new\\sui.exe';
const PACKAGE_PATH = 'c:\\Users\\Julia\\Documents\\antigravity\\delightful-bohr\\contracts\\city_tech';
const RECIPIENT = '0x6da4d96a61b069d1223bb4fa2d23b94ca2ea00db25b709fd9f04fa73656d15b2';

// Rarity assets and properties
const ASSETS = {
    PEERLESS: {
        rarity: 'Peerless',
        quality: 3,
        url: 'https://alphacity.tech/assets/city-tech/Peerless.png',
        count: 5
    },
    BLACK_MARKET: {
        rarity: 'Black Market',
        quality: 2,
        url: 'https://alphacity.tech/assets/city-tech/Black%20Market.png',
        count: 10
    },
    STREET_MOD: {
        rarity: 'Street Mod',
        quality: 1,
        url: 'https://alphacity.tech/assets/city-tech/Street%20Mod.png',
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

function buildNFTBatchData() {
    const names = [];
    const descriptions = [];
    const imageUrls = [];
    
    const attributeKeysFlat = [];
    const attributeValuesFlat = [];
    const attributesSizes = [];

    const desc = "A collection of mysterious items. Something tells you they're important.";
    let id = 1;

    const addItems = (config) => {
        for (let i = 0; i < config.count; i++) {
            names.push(`City Tech #${String(id).padStart(3, '0')}`);
            descriptions.push(desc);
            imageUrls.push(config.url);
            
            // Flat traits: Type, Rarity, Quality
            attributeKeysFlat.push('Type', 'Rarity', 'Quality');
            attributeValuesFlat.push('Biologic Upgrade', config.rarity, String(config.quality));
            attributesSizes.push('3'); // u64 represented as string
            
            id++;
        }
    };

    addItems(ASSETS.PEERLESS);
    addItems(ASSETS.BLACK_MARKET);
    addItems(ASSETS.STREET_MOD);

    return { names, descriptions, imageUrls, attributeKeysFlat, attributeValuesFlat, attributesSizes };
}

async function main() {
    try {
        // Delete old Published.toml to force redeployment
        const pubPath = path.join(PACKAGE_PATH, 'Published.toml');
        if (fs.existsSync(pubPath)) {
            fs.unlinkSync(pubPath);
            console.log('Removed old Published.toml to force redeployment.');
        }

        console.log('--- Step 1: Publishing Contract "City Tech" to Sui Mainnet ---');
        const publishOutput = runCommand(SUI_CLI, [
            'client', 'publish',
            '--gas-budget', '80000000', // 0.08 SUI
            '--json'
        ], { cwd: PACKAGE_PATH });

        const publishData = JSON.parse(publishOutput);
        const objectChanges = publishData.objectChanges || [];

        let packageId = null;
        let mintCapId = null;

        for (const change of objectChanges) {
            if (change.type === 'published') {
                packageId = change.packageId;
            } else if (change.type === 'created' && change.objectType.endsWith('::city_tech::MintCap')) {
                mintCapId = change.objectId;
            }
        }

        if (!packageId || !mintCapId) {
            throw new Error(`Failed to extract packageId (${packageId}) or mintCapId (${mintCapId}) from publish response.`);
        }

        console.log(`Package Published Successfully!`);
        console.log(`Package ID: ${packageId}`);
        console.log(`MintCap ID: ${mintCapId}`);
        console.log(`SuiScan link: https://suiscan.xyz/mainnet/tx/${publishData.digest}\n`);

        console.log('--- Step 2: Generating Batch Metadata ---');
        const { names, descriptions, imageUrls, attributeKeysFlat, attributeValuesFlat, attributesSizes } = buildNFTBatchData();
        console.log(`Generated batch data for ${names.length} NFTs.`);

        console.log('--- Step 3: Executing Batch Mint ---');
        const mintOutput = runCommand(SUI_CLI, [
            'client', 'call',
            '--package', packageId,
            '--module', 'city_tech',
            '--function', 'mint_batch',
            '--args',
            mintCapId,
            JSON.stringify(names),
            JSON.stringify(descriptions),
            JSON.stringify(imageUrls),
            JSON.stringify(attributeKeysFlat),
            JSON.stringify(attributeValuesFlat),
            JSON.stringify(attributesSizes),
            RECIPIENT,
            '--gas-budget', '250000000', // 0.25 SUI
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
