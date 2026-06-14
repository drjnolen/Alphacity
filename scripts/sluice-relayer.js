const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration
const SUI_RPC = 'https://fullnode.mainnet.sui.io';
const PACKAGE_ADDRESS = process.env.SLUICE_PACKAGE_ADDRESS || '0x7c7ca3da6bad849a02d9f888b2f8cab40d507b2c01bbcab3f2d816334c17aa07';

// Relayer Bot Private Key (32-byte hex string stored in GitHub Secrets)
const PRIVATE_KEY_HEX = process.env.SLUICE_ORACLE_PRIVATE_KEY;

// Check directory exists
const ATTESTATIONS_DIR = path.join(__dirname, '..', 'sluice', 'attestations');
if (!fs.existsSync(ATTESTATIONS_DIR)) {
    fs.mkdirSync(ATTESTATIONS_DIR, { recursive: true });
}

// Helper: Make SUI RPC requests
async function rpc(method, params) {
    const res = await fetch(SUI_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`RPC error: ${data.error.message}`);
    return data.result;
}

// Helper: Import Ed25519 Private Key in Node.js
function getPrivateKeyBuffer(hexSeed) {
    const seed = Buffer.from(hexSeed.replace('0x', ''), 'hex');
    // Prepend PKCS8 header for Ed25519 raw 32-byte seed
    const header = Buffer.from([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
    ]);
    return Buffer.concat([header, seed]);
}

// Helper: Sign message with Ed25519
function signEd25519(messageBytes, hexSeed) {
    const pkcs8Key = getPrivateKeyBuffer(hexSeed);
    const privateKey = crypto.createPrivateKey({
        key: pkcs8Key,
        format: 'der',
        type: 'pkcs8'
    });
    return crypto.sign(null, messageBytes, privateKey);
}

// Helper: Fetch Token Marketcap from DexScreener
async function fetchTokenMarketcap(coinType) {
    try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(coinType)}`);
        const data = await res.json();
        const pairs = data.pairs || [];
        if (pairs.length === 0) return null;
        
        // Sort by liquidity descending (Safeguard 2: Highest liquidity pool routing)
        pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
        const topPair = pairs[0];
        
        // Return fully diluted valuation or calculated marketcap
        return topPair.fdv || (parseFloat(topPair.priceUsd) * (topPair.liquidity?.base || 0) * 2); // Fallback estimate
    } catch (err) {
        console.warn(`  [DexScreener] Failed to query ${coinType}:`, err.message);
        return null;
    }
}

async function main() {
    if (!PRIVATE_KEY_HEX) {
        console.log('Error: SLUICE_ORACLE_PRIVATE_KEY is not configured. Skipping relayer process.');
        process.exit(0);
    }

    if (PACKAGE_ADDRESS === '0xPLACEHOLDER_SLUICE_PACKAGE') {
        console.log('Sluice package address is not set. Skipping relayer scan.');
        process.exit(0);
    }

    console.log(`Scanning Sluice contracts for package: ${PACKAGE_ADDRESS}...`);

    try {
        // Query all Shared Objects created by the Sluice package
        const structType = `${PACKAGE_ADDRESS}::sluice::VestingSchedule`;
        const objects = await rpc('suix_queryObjects', [{
            filter: { StructType: structType },
            options: { showContent: true }
        }]);

        const schedules = objects.data || [];
        console.log(`Found ${schedules.length} schedules on-chain.`);

        let changesMade = false;

        for (const obj of schedules) {
            const fields = obj.data?.content?.fields;
            if (!fields) continue;

            const id = fields.id.id;
            const coinType = obj.data?.content?.type.split('<')[1].replace('>', '');
            const milestoneStatus = parseInt(fields.milestone_status);
            const targetMcap = fields.target_marketcap ? parseInt(fields.target_marketcap) : null;

            if (milestoneStatus !== 1) {
                // If it is not locked (e.g. already active), skip
                continue;
            }

            console.log(`Processing Locked Stream: ${id}`);
            console.log(`  Coin Type: ${coinType}`);
            console.log(`  Target Marketcap: $${targetMcap}`);

            // Fetch current marketcap from DexScreener highest liquidity pool
            const currentMcap = await fetchTokenMarketcap(coinType);
            if (currentMcap === null) {
                console.log(`  Skipping: No liquidity pools indexed on DexScreener.`);
                continue;
            }

            console.log(`  Current Marketcap (highest LP): $${currentMcap.toLocaleString()}`);

            const historyFile = path.join(ATTESTATIONS_DIR, `history_${id}.json`);
            
            if (currentMcap >= targetMcap) {
                let firstCrossedAt = Date.now();

                if (fs.existsSync(historyFile)) {
                    const histData = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
                    firstCrossedAt = histData.first_crossed_at;
                    
                    const elapsedMin = (Date.now() - firstCrossedAt) / (60 * 1000);
                    console.log(`  Threshold Met. Elapsed validation window: ${elapsedMin.toFixed(1)} / 30.0 minutes`);

                    if (elapsedMin >= 30) {
                        // 30 minutes window met! Generate signature
                        console.log(`  [SAFEGUARD CLEARED] Generating unlock signature...`);
                        
                        // Signature message: raw bytes of the 32-byte schedule ID
                        const msgBytes = Buffer.from(id.replace('0x', ''), 'hex');
                        const sigBytes = signEd25519(msgBytes, PRIVATE_KEY_HEX);

                        const attestation = {
                            id: id,
                            coinType: coinType,
                            targetMarketcap: targetMcap,
                            firstCrossedAt: firstCrossedAt,
                            activatedAt: Date.now(),
                            signature: '0x' + sigBytes.toString('hex'),
                            unlocked: true
                        };

                        // Save public attestation file
                        fs.writeFileSync(path.join(ATTESTATIONS_DIR, `${id}.json`), JSON.stringify(attestation, null, 2));
                        console.log(`  Saved attestation signature: sluice/attestations/${id}.json`);
                        
                        // Remove history file
                        try { fs.unlinkSync(historyFile); } catch (_) {}
                        changesMade = true;
                    }
                } else {
                    console.log(`  Threshold Crossed! Starting 30-minute volatility check window.`);
                    fs.writeFileSync(historyFile, JSON.stringify({ first_crossed_at: firstCrossedAt }));
                    changesMade = true;
                }
            } else {
                // If it was tracking but dipped, reset the validation window (Safeguard 1)
                if (fs.existsSync(historyFile)) {
                    console.log(`  [SAFEGUARD TRIGGERED] Marketcap dipped below target. Resetting validation window.`);
                    try { fs.unlinkSync(historyFile); } catch (_) {}
                    changesMade = true;
                } else {
                    console.log(`  Target unmet. Resting...`);
                }
            }
        }

        // Commit and push updates to Github Pages if changes occurred
        if (changesMade) {
            console.log('Committing changes to repository...');
            try {
                execSync('git config --global user.name "Sluice Attestation Bot"');
                execSync('git config --global user.email "bot@sluice.tech"');
                execSync('git add sluice/attestations/');
                execSync('git commit -m "Update Sluice verification states and attestations [skip ci]"');
                execSync('git push');
                console.log('Attestations successfully pushed to GitHub Pages.');
            } catch (gitErr) {
                console.warn('Git commit/push skipped or failed (possibly no changes or config):', gitErr.message);
            }
        } else {
            console.log('No state changes detected in this run.');
        }

    } catch (err) {
        console.error('Fatal error in relayer execution:', err);
    }
}

main();
