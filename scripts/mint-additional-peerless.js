const { spawnSync } = require('child_process');
const path = require('path');

const SUI_CLI = 'c:\\Users\\Julia\\Documents\\antigravity\\delightful-bohr\\scripts\\sui-cli-new\\sui.exe';
const RECIPIENT = '0x6da4d96a61b069d1223bb4fa2d23b94ca2ea00db25b709fd9f04fa73656d15b2';

// Currently active mainnet deployment IDs
const PACKAGE_ID = '0x4efba6334d099dc4bfb7725213f273fb32de4ef828175de5be99fcea8bec7141';
const MINT_CAP_ID = '0xc18d2bfb0c21e3839c21e439ade9450f5e1e044db7d952e4258232be3b3b8615';

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

async function main() {
    try {
        console.log('--- Step 1: Preparing Metadata for 2 Additional Peerless NFTs ---');
        const names = ['City Tech #036', 'City Tech #037'];
        const description = "A collection of mysterious items. Something tells you they're important.";
        const descriptions = [description, description];
        const imageUrls = [
            'https://alphacity.tech/assets/city-tech/Peerless.png',
            'https://alphacity.tech/assets/city-tech/Peerless.png'
        ];
        
        // Flat attributes: Type, Rarity, Quality (x2)
        const attributeKeysFlat = ['Type', 'Rarity', 'Quality', 'Type', 'Rarity', 'Quality'];
        const attributeValuesFlat = [
            'Biologic Upgrade', 'Peerless', '3',
            'Biologic Upgrade', 'Peerless', '3'
        ];
        const attributesSizes = ['3', '3'];

        console.log('--- Step 2: Executing Batch Mint ---');
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
            JSON.stringify(attributeKeysFlat),
            JSON.stringify(attributeValuesFlat),
            JSON.stringify(attributesSizes),
            RECIPIENT,
            '--gas-budget', '50000000', // 0.05 SUI should be plenty for 2 items
            '--json'
        ]);

        const mintData = JSON.parse(mintOutput);
        console.log(`\nBatch Mint Executed Successfully!`);
        console.log(`Transaction Digest: ${mintData.digest}`);
        console.log(`SuiScan link: https://suiscan.xyz/mainnet/tx/${mintData.digest}\n`);

        console.log('--- Summary ---');
        console.log(`Successfully minted City Tech #036 and #037 to ${RECIPIENT}`);

    } catch (err) {
        console.error('Fatal Error during execution:', err);
        process.exit(1);
    }
}

main();
