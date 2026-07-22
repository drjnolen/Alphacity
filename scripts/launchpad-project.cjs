#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('../shared/launchpad-core.js');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT, 'contracts', 'managed_drop_template');

function fail(message, code = 1) {
    process.stderr.write(`${message}\n`);
    process.exitCode = code;
}

function usage() {
    return [
        'AlphaCity managed launch preparation',
        '',
        'Usage:',
        '  node scripts/launchpad-project.cjs validate <project-directory>',
        '  node scripts/launchpad-project.cjs prepare <project-directory> --treasury <0x...> [--media-base-url <https://...>] [--out <directory>]',
        '',
        'The project directory must contain project.json, metadata.csv, and a media/ folder.',
        'Preparation never publishes or signs a transaction.',
    ].join('\n');
}

function parseArgs(argv) {
    const [command, projectDirectory, ...rest] = argv;
    const flags = {};
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
        const name = token.slice(2);
        const next = rest[index + 1];
        if (!next || next.startsWith('--')) throw new Error(`Missing value for --${name}`);
        flags[name] = next;
        index += 1;
    }
    return { command, projectDirectory, flags };
}

function readProjectDirectory(projectDirectory) {
    const directory = path.resolve(projectDirectory || '');
    const projectPath = path.join(directory, 'project.json');
    const metadataPath = path.join(directory, 'metadata.csv');
    const mediaDirectory = path.join(directory, 'media');
    if (!projectDirectory || !fs.existsSync(directory)) throw new Error(`Project directory not found: ${projectDirectory || '(missing)'}`);
    if (!fs.existsSync(projectPath)) throw new Error(`Missing ${projectPath}`);
    if (!fs.existsSync(metadataPath)) throw new Error(`Missing ${metadataPath}`);
    if (!fs.existsSync(mediaDirectory) || !fs.statSync(mediaDirectory).isDirectory()) throw new Error(`Missing media directory: ${mediaDirectory}`);
    let project;
    try { project = JSON.parse(fs.readFileSync(projectPath, 'utf8')); }
    catch (error) { throw new Error(`project.json is not valid JSON: ${error.message}`); }
    const csvText = fs.readFileSync(metadataPath, 'utf8');
    const files = fs.readdirSync(mediaDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
            const filePath = path.join(mediaDirectory, entry.name);
            const stat = fs.statSync(filePath);
            return { name: entry.name, size: stat.size, type: '' };
        });
    return { directory, project, csvText, files };
}

function printReport(result) {
    const mark = result.valid ? 'VALID' : 'INVALID';
    process.stdout.write(`${mark}: ${result.supply || 0} items (${result.publicSupply || 0} public, ${result.reservedSupply || 0} reserved)\n`);
    result.warnings.forEach((warning) => process.stdout.write(`WARNING: ${warning}\n`));
    result.errors.forEach((error) => process.stderr.write(`ERROR: ${error}\n`));
}

function ensureEmptyOutput(directory) {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length) {
        throw new Error(`Output directory is not empty: ${directory}. Choose a new --out directory.`);
    }
    fs.mkdirSync(directory, { recursive: true });
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeMoveAlias(id) {
    const alias = core.slugify(id).replace(/-/g, '_').replace(/^[^a-z_]+/, '');
    return alias || 'managed_collection';
}

function copyContract(outputDirectory, projectId) {
    const alias = safeMoveAlias(projectId);
    const target = path.join(outputDirectory, 'contract');
    fs.cpSync(TEMPLATE_DIR, target, {
        recursive: true,
        filter(source) {
            const relative = path.relative(TEMPLATE_DIR, source);
            return !relative.split(path.sep).some((segment) => ['build', 'tests', 'Move.lock', 'Published.toml'].includes(segment));
        },
    });
    const manifestPath = path.join(target, 'Move.toml');
    const sourcePath = path.join(target, 'sources', 'managed_drop.move');
    fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf8')
        .replace('name = "managed_drop_template"', `name = "${alias}"`)
        .replace('managed_drop_template = "0x0"', `${alias} = "0x0"`), 'utf8');
    fs.writeFileSync(sourcePath, fs.readFileSync(sourcePath, 'utf8')
        .replace('module managed_drop_template::managed_drop', `module ${alias}::managed_drop`)
        .replace('https://alphacity.tech/launchpad', `https://alphacity.tech/launchpad/?collection=${core.slugify(projectId)}`), 'utf8');
    return { alias, directory: target };
}

function functionCall(target, argumentsList) {
    return { target: `\${PACKAGE_ID}::managed_drop::${target}`, arguments: argumentsList };
}

function buildTransactionPlan(bundle) {
    const init = bundle.initialization;
    const create = functionCall('create_drop', [
        { type: 'string', value: init.name },
        { type: 'string', value: init.description },
        { type: 'address', value: init.creatorAddress },
        { type: 'address', value: init.platformTreasury },
        { type: 'u64', value: init.platformFeeBps },
        { type: 'u64', value: init.royaltyBps },
        { type: 'u64', value: init.publicSupply },
        { type: 'u64', value: init.reservedSupply },
    ]);
    const display = functionCall('create_display', [
        { type: 'object', value: '${PUBLISHER_ID}' },
        { type: 'object', value: '0xd' },
    ]);
    const stages = init.stages.map((stage) => functionCall('add_stage', [
        { type: 'object', value: '${ADMIN_CAP_ID}' },
        { type: 'object', value: '${DROP_ID}' },
        { type: 'string', value: stage.name },
        { type: 'u64', value: stage.priceMist },
        { type: 'u64', value: stage.startTimeMs },
        { type: 'u64', value: stage.endTimeMs },
        { type: 'u64', value: stage.walletLimit },
        { type: 'u64', value: stage.allocation },
        { type: 'bool', value: stage.allowlistOnly },
    ]));
    const allowlist = init.stages.flatMap((stage) => stage.allowlist.map((entry) => functionCall('add_allowlist', [
        { type: 'object', value: '${ADMIN_CAP_ID}' },
        { type: 'object', value: '${DROP_ID}' },
        { type: 'u64', value: stage.id },
        { type: 'address', value: entry.address },
        { type: 'u64', value: entry.limit },
    ])));
    const items = [...init.publicItems, ...init.reservedItems].map((item) => functionCall('add_item', [
        { type: 'object', value: '${ADMIN_CAP_ID}' },
        { type: 'object', value: '${DROP_ID}' },
        { type: 'bool', value: item.reserved },
        { type: 'string', value: item.name },
        { type: 'string', value: item.description },
        { type: 'string', value: item.mediaUrl },
        { type: 'vector<string>', value: item.attributeKeys },
        { type: 'vector<string>', value: item.attributeValues },
    ]));
    const batches = [];
    for (let index = 0; index < items.length; index += 50) batches.push(items.slice(index, index + 50));
    const allowlistBatches = [];
    for (let index = 0; index < allowlist.length; index += 100) allowlistBatches.push(allowlist.slice(index, index + 100));
    return {
        version: 1,
        placeholders: {
            '${PACKAGE_ID}': 'Published package ID',
            '${PUBLISHER_ID}': 'Publisher object created during package publication',
            '${ADMIN_CAP_ID}': 'AdminCap object created by create_drop',
            '${DROP_ID}': 'Shared Drop object created by create_drop',
        },
        order: ['publish-package', 'create-display', 'create-drop', 'add-stages', 'add-allowlists', 'add-inventory', 'publish-drop'],
        createDisplay: display,
        createDrop: create,
        stages,
        allowlistBatches,
        inventoryBatches: batches,
        publishDrop: functionCall('publish_drop', [
            { type: 'object', value: '${ADMIN_CAP_ID}' },
            { type: 'object', value: '${DROP_ID}' },
        ]),
    };
}

function handoffMarkdown(bundle, contract) {
    return `# ${bundle.collection.name} launch handoff

This directory was generated from a validated project intake. It contains no signing key.

## Publication sequence

1. Review \`launch-bundle.json\`, \`transactions.json\`, and every hosted media URL.
2. Build the package: \`sui move build --path "${contract.directory}"\`.
3. Publish the package using the AlphaCity multisig or hardware wallet.
4. Record the package, Publisher, AdminCap, and shared Drop object IDs.
5. Execute the calls in \`transactions.json\` in order. Inventory is split into batches of 50 calls.
6. Re-export the public config with package and drop IDs, then add it to \`launchpad/collections/index.json\`.
7. Dry-run a mint, pause/unpause, reserved mint, and proceeds split before announcing the launch.

The final \`publish_drop\` call locks stages and item metadata. Do not run it until review is complete.
`;
}

function validateCommand(directory) {
    const input = readProjectDirectory(directory);
    const result = core.validateSubmission(input.project, input.csvText, input.files);
    printReport(result);
    if (!result.valid) process.exitCode = 2;
    return result;
}

function prepareCommand(directory, flags) {
    const input = readProjectDirectory(directory);
    const result = core.validateSubmission(input.project, input.csvText, input.files);
    printReport(result);
    if (!result.valid) { process.exitCode = 2; return; }
    const treasury = flags.treasury;
    if (!core.isValidSuiAddress(treasury)) throw new Error('prepare requires --treasury with a valid Sui address.');
    const mediaBaseUrl = flags['media-base-url'] || result.project.mediaBaseUrl;
    if (!/^https:\/\//i.test(mediaBaseUrl || '')) throw new Error('prepare requires an HTTPS --media-base-url (or mediaBaseUrl in project.json).');
    const output = path.resolve(flags.out || path.join(input.directory, 'prepared'));
    ensureEmptyOutput(output);
    const bundle = core.prepareLaunch(result, { platformTreasury: treasury, mediaBaseUrl });
    const contract = copyContract(output, result.project.id);
    const transactions = buildTransactionPlan(bundle);
    writeJson(path.join(output, 'launch-bundle.json'), bundle);
    writeJson(path.join(output, 'collection.json'), bundle.collection);
    writeJson(path.join(output, 'transactions.json'), transactions);
    fs.writeFileSync(path.join(output, 'README.md'), handoffMarkdown(bundle, contract), 'utf8');
    process.stdout.write(`PREPARED: ${output}\n`);
    process.stdout.write(`Contract: ${contract.directory}\n`);
    process.stdout.write('No package was published and no transaction was signed.\n');
}

function main() {
    let parsed;
    try { parsed = parseArgs(process.argv.slice(2)); }
    catch (error) { fail(`${error.message}\n\n${usage()}`); return; }
    if (!['validate', 'prepare'].includes(parsed.command) || !parsed.projectDirectory) {
        fail(usage());
        return;
    }
    try {
        if (parsed.command === 'validate') validateCommand(parsed.projectDirectory);
        else prepareCommand(parsed.projectDirectory, parsed.flags);
    } catch (error) {
        fail(`ERROR: ${error.message}`);
    }
}

if (require.main === module) main();
module.exports = { buildTransactionPlan, parseArgs, readProjectDirectory, safeMoveAlias };
