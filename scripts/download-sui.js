const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const url = 'https://github.com/MystenLabs/sui/releases/download/mainnet-v1.73.2/sui-mainnet-v1.73.2-windows-x86_64.tgz';
const targetPath = path.join(__dirname, 'sui_download.tgz');
const extractDir = path.join(__dirname, 'sui-cli-new');

async function downloadFile() {
    console.log(`Downloading Sui CLI from: ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download: status ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(targetPath, buffer);
    console.log(`Successfully downloaded Sui CLI to ${targetPath}`);
}

function extractFile() {
    console.log(`Extracting to ${extractDir}...`);
    if (!fs.existsSync(extractDir)) {
        fs.mkdirSync(extractDir, { recursive: true });
    }
    
    // Use system tar command to extract
    execSync(`tar -xzf "${targetPath}" -C "${extractDir}"`, { stdio: 'inherit' });
    console.log('Extraction complete!');
    
    // Check files
    const files = fs.readdirSync(extractDir);
    console.log('Extracted files:', files);
}

async function main() {
    try {
        await downloadFile();
        extractFile();
    } catch (err) {
        console.error('Error:', err);
    }
}

main();
