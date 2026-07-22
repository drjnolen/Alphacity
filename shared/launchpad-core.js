(function launchpadCoreFactory(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AlphaCityLaunchpadCore = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLaunchpadCore() {
    'use strict';

    const MIST_PER_SUI = 1_000_000_000n;
    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const SUPPORTED_MEDIA_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
    const REQUIRED_COLUMNS = Object.freeze(['Name', 'Description', 'File Name', 'Reserve For Creator']);
    const DEFAULT_NETWORK = Object.freeze({
        name: 'Sui Mainnet',
        chain: 'sui:mainnet',
        rpcUrl: 'https://fullnode.mainnet.sui.io:443',
        coinType: '0x2::sui::SUI',
    });

    function clean(value) {
        return String(value == null ? '' : value).trim();
    }

    function slugify(value) {
        return clean(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 64);
    }

    function escapeCsv(value) {
        const text = String(value == null ? '' : value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function parseCsv(text) {
        const input = String(text == null ? '' : text).replace(/^\uFEFF/, '');
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;

        for (let index = 0; index < input.length; index += 1) {
            const character = input[index];
            if (quoted) {
                if (character === '"' && input[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else if (character === '"') {
                    quoted = false;
                } else {
                    field += character;
                }
                continue;
            }
            if (character === '"') quoted = true;
            else if (character === ',') {
                row.push(field);
                field = '';
            } else if (character === '\n') {
                row.push(field.replace(/\r$/, ''));
                if (row.some((value) => value !== '')) rows.push(row);
                row = [];
                field = '';
            } else {
                field += character;
            }
        }
        if (quoted) throw new Error('CSV contains an unterminated quoted field.');
        row.push(field.replace(/\r$/, ''));
        if (row.some((value) => value !== '')) rows.push(row);
        if (!rows.length) return { headers: [], rows: [] };

        const headers = rows[0].map(clean);
        const records = rows.slice(1).map((values, rowIndex) => {
            const record = { __row: rowIndex + 2 };
            headers.forEach((header, columnIndex) => { record[header] = clean(values[columnIndex]); });
            return record;
        });
        return { headers, rows: records };
    }

    function toBoolean(value) {
        return ['true', 'yes', 'y', '1'].includes(clean(value).toLowerCase());
    }

    function mediaExtension(fileName) {
        const match = clean(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
        return match ? match[1] : '';
    }

    function mediaBaseName(fileName) {
        return clean(fileName).replace(/^.*[\\/]/, '');
    }

    function normalizeSuiAddress(value) {
        const address = clean(value).toLowerCase();
        if (!/^0x[0-9a-f]{1,64}$/.test(address)) return '';
        return `0x${address.slice(2).padStart(64, '0')}`;
    }

    function isValidSuiAddress(value) {
        return Boolean(normalizeSuiAddress(value));
    }

    function suiToMist(value) {
        const normalized = clean(value);
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(normalized)) {
            throw new Error('SUI amount must be a non-negative decimal with no more than 9 decimal places.');
        }
        const [whole, fractional = ''] = normalized.split('.');
        return BigInt(whole) * MIST_PER_SUI + BigInt(fractional.padEnd(9, '0'));
    }

    function mistToSui(value, trim = true) {
        const amount = BigInt(value || 0);
        const whole = amount / MIST_PER_SUI;
        const fraction = (amount % MIST_PER_SUI).toString().padStart(9, '0');
        const decimals = trim ? fraction.replace(/0+$/, '') : fraction;
        return decimals ? `${whole}.${decimals}` : whole.toString();
    }

    function parseTimestamp(value, label, errors) {
        if (value == null || value === '') return 0;
        const timestamp = typeof value === 'number' ? value : Date.parse(value);
        if (!Number.isFinite(timestamp) || timestamp < 0 || !Number.isSafeInteger(timestamp)) {
            errors.push(`${label} must be a valid date and time.`);
            return 0;
        }
        return timestamp;
    }

    function readNumber(value, label, errors, options = {}) {
        const number = Number(value);
        if (!Number.isFinite(number) || !Number.isInteger(number)) {
            errors.push(`${label} must be a whole number.`);
            return options.fallback || 0;
        }
        if (number < (options.min == null ? 0 : options.min)) errors.push(`${label} is below the allowed minimum.`);
        if (options.max != null && number > options.max) errors.push(`${label} exceeds the allowed maximum.`);
        return number;
    }

    function normalizeStage(stage, index, errors) {
        const prefix = `Mint stage ${index + 1}`;
        let priceMist = 0n;
        try { priceMist = suiToMist(stage?.priceSui == null ? '' : stage.priceSui); }
        catch (error) { errors.push(`${prefix}: ${error.message}`); }
        const startTimeMs = parseTimestamp(stage?.startTime, `${prefix} start time`, errors);
        const endTimeMs = parseTimestamp(stage?.endTime, `${prefix} end time`, errors);
        if (endTimeMs && startTimeMs && endTimeMs <= startTimeMs) errors.push(`${prefix} must end after it starts.`);
        const walletLimit = readNumber(stage?.walletLimit ?? 1, `${prefix} wallet limit`, errors, { min: 1, max: 10_000 });
        const allocation = readNumber(stage?.allocation ?? 0, `${prefix} allocation`, errors, { min: 0 });
        const allowlist = Array.isArray(stage?.allowlist) ? stage.allowlist.map((entry, allowIndex) => {
            const rawAddress = typeof entry === 'string' ? entry : entry?.address;
            const address = normalizeSuiAddress(rawAddress);
            if (!address) errors.push(`${prefix} allowlist row ${allowIndex + 1} has an invalid Sui address.`);
            const limit = readNumber(typeof entry === 'string' ? walletLimit : (entry?.limit ?? walletLimit), `${prefix} allowlist row ${allowIndex + 1} limit`, errors, { min: 1, max: 10_000 });
            return { address, limit };
        }) : [];
        if (stage?.allowlistOnly && !allowlist.length) errors.push(`${prefix} is allowlist-only but has no allowlist entries.`);
        return {
            id: index,
            name: clean(stage?.name) || `Stage ${index + 1}`,
            priceSui: clean(stage?.priceSui),
            priceMist: priceMist.toString(),
            startTimeMs,
            endTimeMs,
            walletLimit,
            allocation,
            allowlistOnly: Boolean(stage?.allowlistOnly),
            allowlist,
        };
    }

    function normalizeProject(project) {
        const input = project && typeof project === 'object' ? project : {};
        const errors = [];
        const warnings = [];
        const name = clean(input.name);
        const id = slugify(input.id || name);
        if (!name) errors.push('Collection name is required.');
        if (!id) errors.push('Collection slug is required.');
        const creatorAddress = normalizeSuiAddress(input.creatorAddress || input.creator?.address);
        if (!creatorAddress) errors.push('A valid Sui creator payout address is required.');
        const royaltyBps = readNumber(input.royaltyBps ?? 0, 'Royalty basis points', errors, { min: 0, max: 10_000 });
        const platformFeeBps = readNumber(input.platformFeeBps ?? 500, 'Platform fee basis points', errors, { min: 0, max: 2_500 });
        const maxPerTx = readNumber(input.maxPerTx ?? 5, 'Maximum per transaction', errors, { min: 1, max: 50 });
        const stagesInput = Array.isArray(input.stages) ? input.stages : [];
        if (!stagesInput.length) errors.push('At least one mint stage is required.');
        const stages = stagesInput.map((stage, index) => normalizeStage(stage, index, errors));
        const duplicateStageNames = stages.map((stage) => stage.name.toLowerCase()).filter((value, index, values) => values.indexOf(value) !== index);
        if (duplicateStageNames.length) warnings.push('Mint stage names should be unique for clearer reporting.');
        const heroFile = mediaBaseName(input.heroFile || '');
        const heroImage = clean(input.heroImage || '');
        if (!heroFile && !heroImage) warnings.push('No hero image file or hosted hero image URL has been provided.');
        const revealMode = input.reveal?.mode === 'delayed' ? 'delayed' : 'instant';
        if (revealMode === 'delayed') warnings.push('Delayed reveal is recorded but not enabled in the managed MVP contract.');
        const website = clean(input.website || input.creator?.website);
        const twitter = clean(input.twitter || input.creator?.twitter);
        const discord = clean(input.discord || input.creator?.discord);
        [website, twitter, discord].filter(Boolean).forEach((url) => {
            try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
            } catch (_) { errors.push(`Project link must be a valid HTTP(S) URL: ${url}`); }
        });
        return {
            value: {
                schemaVersion: 1,
                id,
                name,
                eyebrow: clean(input.eyebrow) || 'Alpha City Launchpad',
                headline: clean(input.headline) || name,
                tagline: clean(input.tagline),
                description: clean(input.description),
                creatorName: clean(input.creatorName || input.creator?.name) || name,
                creatorAddress,
                website,
                twitter,
                discord,
                heroFile,
                heroImage,
                mediaBaseUrl: clean(input.mediaBaseUrl),
                royaltyBps,
                platformFeeBps,
                maxPerTx,
                stages,
                reveal: { mode: revealMode },
                contract: {
                    packageId: clean(input.contract?.packageId),
                    module: clean(input.contract?.module) || 'managed_drop',
                    dropId: clean(input.contract?.dropId),
                    adminCapId: clean(input.contract?.adminCapId),
                },
            },
            errors,
            warnings,
        };
    }

    function normalizeFiles(files) {
        return Array.from(files || []).map((file) => ({
            name: mediaBaseName(file.name || file.webkitRelativePath || ''),
            size: Number(file.size || 0),
            type: clean(file.type),
            source: file,
        }));
    }

    function validateSubmission(projectInput, csvText, files) {
        const projectResult = normalizeProject(projectInput);
        const errors = [...projectResult.errors];
        const warnings = [...projectResult.warnings];
        let parsed;
        try { parsed = parseCsv(csvText); }
        catch (error) {
            return { valid: false, project: projectResult.value, items: [], files: normalizeFiles(files), errors: [...errors, error.message], warnings };
        }
        const missing = REQUIRED_COLUMNS.filter((column) => !parsed.headers.includes(column));
        if (missing.length) errors.push(`Metadata CSV is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
        const attributeHeaders = parsed.headers.filter((header) => /^attributes\[[^\]]+\]$/.test(header));
        const mediaFiles = normalizeFiles(files);
        const fileMap = new Map();
        if (!mediaFiles.length) errors.push('A media folder with the collection images is required.');
        mediaFiles.forEach((file) => {
            const key = file.name.toLowerCase();
            if (fileMap.has(key)) errors.push(`Duplicate media filename: ${file.name}.`);
            else fileMap.set(key, file);
            const extension = mediaExtension(file.name);
            if (!SUPPORTED_MEDIA_EXTENSIONS.includes(extension)) errors.push(`${file.name} uses an unsupported media format.`);
            if (file.size > MAX_FILE_BYTES) errors.push(`${file.name} exceeds the 50 MB per-file limit.`);
        });
        const seenNames = new Set();
        const referencedFiles = new Set();
        const items = parsed.rows.map((record, index) => {
            const row = record.__row || index + 2;
            const name = clean(record.Name);
            const description = clean(record.Description);
            const fileName = mediaBaseName(record['File Name']);
            const key = fileName.toLowerCase();
            if (!name) errors.push(`CSV row ${row}: Name is required.`);
            if (!description) warnings.push(`CSV row ${row}: Description is empty.`);
            if (!fileName) errors.push(`CSV row ${row}: File Name is required.`);
            if (seenNames.has(name.toLowerCase())) warnings.push(`CSV row ${row}: duplicate item name “${name}”.`);
            seenNames.add(name.toLowerCase());
            if (key) referencedFiles.add(key);
            if (key && !fileMap.has(key)) errors.push(`CSV row ${row}: media file “${fileName}” was not supplied.`);
            if (fileName && !SUPPORTED_MEDIA_EXTENSIONS.includes(mediaExtension(fileName))) errors.push(`CSV row ${row}: “${fileName}” uses an unsupported media format.`);
            const attributes = {};
            attributeHeaders.forEach((header) => {
                const trait = header.slice(11, -1).trim();
                const value = clean(record[header]);
                if (trait && value) attributes[trait] = value;
            });
            return {
                index,
                name,
                description,
                fileName,
                reserved: toBoolean(record['Reserve For Creator']),
                attributes,
            };
        });
        if (!items.length) errors.push('Metadata CSV must contain at least one item.');
        mediaFiles.forEach((file) => {
            if (!referencedFiles.has(file.name.toLowerCase()) && file.name.toLowerCase() !== projectResult.value.heroFile.toLowerCase()) {
                warnings.push(`Media file “${file.name}” is not referenced by the CSV.`);
            }
        });
        if (projectResult.value.heroFile && !fileMap.has(projectResult.value.heroFile.toLowerCase())) {
            errors.push(`Hero file “${projectResult.value.heroFile}” was not supplied.`);
        }
        const publicSupply = items.filter((item) => !item.reserved).length;
        const reservedSupply = items.length - publicSupply;
        projectResult.value.stages.forEach((stage) => {
            if (stage.allocation > publicSupply) errors.push(`Mint stage “${stage.name}” allocation exceeds the public supply.`);
        });
        return {
            valid: errors.length === 0,
            project: projectResult.value,
            items,
            files: mediaFiles,
            supply: items.length,
            publicSupply,
            reservedSupply,
            errors,
            warnings,
        };
    }

    function joinUrl(base, fileName) {
        if (!base) return fileName;
        return `${base.replace(/\/$/, '')}/${encodeURIComponent(fileName).replace(/%2F/gi, '/')}`;
    }

    function prepareLaunch(validation, options = {}) {
        if (!validation?.valid) throw new Error('Cannot prepare a launch with validation errors.');
        const project = validation.project;
        const mediaBaseUrl = clean(options.mediaBaseUrl || project.mediaBaseUrl);
        if (!/^https:\/\/[^\s]+$/i.test(mediaBaseUrl)) throw new Error('An HTTPS media base URL is required before preparing a launch.');
        const platformTreasury = normalizeSuiAddress(options.platformTreasury || '');
        if (!platformTreasury) throw new Error('A valid AlphaCity platform treasury address is required.');
        const contract = options.contract || project.contract || {};
        const live = isValidSuiAddress(contract.packageId) && isValidSuiAddress(contract.dropId);
        const items = validation.items.map((item) => ({
            ...item,
            mediaUrl: joinUrl(mediaBaseUrl, item.fileName),
            attributeKeys: Object.keys(item.attributes),
            attributeValues: Object.values(item.attributes),
            attributesJson: JSON.stringify(item.attributes),
        }));
        const firstStage = project.stages[0];
        const heroImage = project.heroImage || joinUrl(mediaBaseUrl, project.heroFile || validation.items[0]?.fileName || '');
        return {
            generatedAt: new Date().toISOString(),
            initialization: {
                name: project.name,
                description: project.description,
                creatorAddress: project.creatorAddress,
                platformTreasury,
                platformFeeBps: project.platformFeeBps,
                royaltyBps: project.royaltyBps,
                publicSupply: validation.publicSupply,
                reservedSupply: validation.reservedSupply,
                stages: project.stages,
                publicItems: items.filter((item) => !item.reserved),
                reservedItems: items.filter((item) => item.reserved),
            },
            collection: {
                id: project.id,
                name: project.name,
                creator: { name: project.creatorName, address: project.creatorAddress },
                eyebrow: project.eyebrow,
                headline: project.headline,
                tagline: project.tagline,
                description: project.description,
                supply: validation.supply,
                publicSupply: validation.publicSupply,
                reservedSupply: validation.reservedSupply,
                minted: 0,
                priceSui: Number(firstStage.priceSui || 0),
                maxPerTx: project.maxPerTx,
                royaltyBps: project.royaltyBps,
                platformFeeBps: project.platformFeeBps,
                network: { ...DEFAULT_NETWORK },
                status: live ? 'live' : 'coming-soon',
                statusLabel: live ? 'Minting Live' : 'Awaiting Publication',
                heroImage,
                gallery: items.slice(0, 8).map((item) => ({ name: item.name, image: item.mediaUrl })),
                mintNote: live ? 'Mint directly from the collection contract on Sui.' : 'Assets are validated. Contract publication is the remaining step.',
                contract: live ? {
                    mode: 'managed-drop',
                    packageId: normalizeSuiAddress(contract.packageId),
                    module: clean(contract.module) || 'managed_drop',
                    dropId: normalizeSuiAddress(contract.dropId),
                    ctaLabel: 'Mint now',
                } : {
                    mode: 'coming-soon',
                    ctaLabel: 'Mint opens soon',
                    message: 'This collection has been prepared but is not published on-chain yet.',
                },
                phases: project.stages.map((stage, index) => ({
                    id: stage.id,
                    name: stage.name,
                    description: stage.allowlistOnly ? 'Limited to approved wallets.' : 'Open to all connected Sui wallets.',
                    priceMist: stage.priceMist,
                    priceSui: stage.priceSui,
                    startTimeMs: stage.startTimeMs,
                    endTimeMs: stage.endTimeMs,
                    walletLimit: stage.walletLimit,
                    allocation: stage.allocation,
                    allowlistOnly: stage.allowlistOnly,
                    state: index === 0 ? 'upcoming' : 'scheduled',
                })),
                details: [
                    { label: 'Network', value: DEFAULT_NETWORK.name },
                    { label: 'Collection Size', value: `${validation.supply.toLocaleString()} NFTs` },
                    { label: 'Creator', value: project.creatorName },
                    { label: 'Royalty metadata', value: `${project.royaltyBps / 100}%` },
                ],
            },
        };
    }

    function metadataExampleCsv() {
        return [
            REQUIRED_COLUMNS.concat(['attributes[Background]', 'attributes[Edition]']).map(escapeCsv).join(','),
            ['Example #1', 'First item', '001.png', 'false', 'Midnight', 'Genesis'].map(escapeCsv).join(','),
            ['Example #2', 'Reserved for the project', '002.png', 'true', 'Sunrise', 'Genesis'].map(escapeCsv).join(','),
        ].join('\n');
    }

    return Object.freeze({
        DEFAULT_NETWORK,
        MAX_FILE_BYTES,
        MIST_PER_SUI,
        REQUIRED_COLUMNS,
        SUPPORTED_MEDIA_EXTENSIONS,
        isValidSuiAddress,
        mediaBaseName,
        metadataExampleCsv,
        mistToSui,
        normalizeProject,
        normalizeSuiAddress,
        parseCsv,
        prepareLaunch,
        slugify,
        suiToMist,
        validateSubmission,
    });
});
