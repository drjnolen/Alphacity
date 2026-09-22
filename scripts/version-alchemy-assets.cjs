const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const assets = ['/shared/alchemy-core.js', '/alchemy/app.js'];

// One release key keeps the UI bundle and its shared core on the same version.
function assetVersion(root) {
    const hash = createHash('sha256');
    for (const asset of assets) {
        hash.update(asset);
        hash.update(fs.readFileSync(path.join(root, asset), 'utf8').replace(/\r\n/g, '\n'));
    }
    return hash.digest('hex').slice(0, 16);
}

function versionAssets(root) {
    const version = assetVersion(root);
    const file = path.join(root, 'alchemy/index.html');
    let html = fs.readFileSync(file, 'utf8');
    for (const asset of assets) {
        const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`src="${escaped}(?:\\?[^"\\s]*)?"`, 'g');
        if (!pattern.test(html)) throw new Error(`Missing Alchemy script: ${asset}`);
        html = html.replace(pattern, `src="${asset}?v=${version}"`);
    }
    fs.writeFileSync(file, html);
    return version;
}

if (require.main === module) versionAssets(path.join(__dirname, '..'));
module.exports = { assetVersion, versionAssets, assets };
