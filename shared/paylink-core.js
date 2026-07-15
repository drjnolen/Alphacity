(function (root) {
    'use strict';

    const U64_MAX = 18_446_744_073_709_551_615n;
    const STORAGE_PREFIX = 'alphacity_paylink_invoices_v1';
    const SCHEMA_VERSION = 1;

    function text(value) {
        return String(value == null ? '' : value).trim();
    }

    function canonicalizeAddress(value) {
        const input = text(value).toLowerCase();
        if (!/^0x[0-9a-f]{1,64}$/.test(input)) {
            throw new Error('Enter a valid Sui address beginning with 0x.');
        }
        return `0x${input.slice(2).padStart(64, '0')}`;
    }

    function canonicalizeCoinType(value) {
        const input = text(value);
        const match = input.match(/^(0x[0-9a-fA-F]{1,64})::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
        if (!match) throw new Error('Enter a valid Sui coin type (0x…::module::TYPE).');
        const suffix = match[4] || '';
        if (suffix && !/^<.+>$/.test(suffix)) throw new Error('Enter a valid Sui coin type.');
        const address = canonicalizeAddress(match[1]);
        return `${address}::${match[2]}::${match[3]}${suffix}`;
    }

    function validateCoinType(value) {
        try {
            return { valid: true, value: canonicalizeCoinType(value), error: null };
        } catch (error) {
            return { valid: false, value: null, error: error.message };
        }
    }

    function normalizeDecimals(decimals) {
        const parsed = Number(decimals);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 18) {
            throw new Error('Token decimals must be an integer from 0 to 18.');
        }
        return parsed;
    }

    function parseDisplayAmount(value, decimals) {
        const input = text(value);
        const precision = normalizeDecimals(decimals);
        if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input)) {
            throw new Error('Enter a positive amount using plain decimal notation.');
        }
        const parts = input.split('.');
        const whole = parts[0];
        const fraction = parts[1] || '';
        if (fraction.length > precision) {
            throw new Error(`This token supports at most ${precision} decimal places.`);
        }
        const scale = 10n ** BigInt(precision);
        const atomic = BigInt(whole) * scale + BigInt((fraction.padEnd(precision, '0') || '0'));
        if (atomic <= 0n) throw new Error('Amount must be greater than zero.');
        if (atomic > U64_MAX) throw new Error('Amount exceeds the maximum supported onchain value.');
        return atomic;
    }

    function formatAtomicAmount(value, decimals, options) {
        const atomic = BigInt(value);
        const precision = normalizeDecimals(decimals);
        const opts = options || {};
        const scale = 10n ** BigInt(precision);
        const whole = atomic / scale;
        const fraction = (atomic % scale).toString().padStart(precision, '0');
        const trimmed = opts.keepTrailingZeros ? fraction : fraction.replace(/0+$/, '');
        return trimmed ? `${whole}.${trimmed}` : whole.toString();
    }

    function validateInvoiceDraft(draft) {
        const errors = {};
        let receiverAddress = null;
        let coinType = null;
        let amountAtomic = null;
        const label = text(draft && draft.label);
        const message = text(draft && draft.message);
        const symbol = text(draft && draft.symbol).toUpperCase();
        let decimals = null;

        try { receiverAddress = canonicalizeAddress(draft && draft.receiverAddress); }
        catch (error) { errors.receiverAddress = error.message; }

        try { coinType = canonicalizeCoinType(draft && draft.coinType); }
        catch (error) { errors.coinType = error.message; }

        try {
            decimals = normalizeDecimals(draft && draft.decimals);
            amountAtomic = parseDisplayAmount(draft && draft.amountDisplay, decimals);
        } catch (error) { errors.amountDisplay = error.message; }

        if (!symbol || symbol.length > 16) errors.symbol = 'Token symbol is missing or invalid.';
        if (!label) errors.label = 'Add a short invoice label.';
        else if (Array.from(label).length > 64) errors.label = 'Label must be 64 characters or fewer.';
        if (Array.from(message).length > 180) errors.message = 'Message must be 180 characters or fewer.';

        return {
            valid: Object.keys(errors).length === 0,
            errors,
            value: Object.keys(errors).length ? null : {
                receiverAddress,
                coinType,
                amountAtomic,
                amountDisplay: formatAtomicAmount(amountAtomic, decimals),
                symbol,
                decimals,
                label,
                message,
            },
        };
    }

    function createInvoiceRecord(input) {
        const nonce = text(input.nonce);
        if (!nonce || nonce.length > 36) throw new Error('Invoice nonce must be between 1 and 36 characters.');
        const creatorAddress = canonicalizeAddress(input.creatorAddress);
        const receiverAddress = canonicalizeAddress(input.receiverAddress);
        const coinType = canonicalizeCoinType(input.coinType);
        const amountAtomic = BigInt(input.amountAtomic);
        if (amountAtomic <= 0n || amountAtomic > U64_MAX) throw new Error('Invoice amount is outside the supported range.');
        const now = input.createdAt || new Date().toISOString();
        return {
            schemaVersion: SCHEMA_VERSION,
            network: text(input.network || 'mainnet'),
            id: text(input.id || nonce),
            nonce,
            creatorAddress,
            receiverAddress,
            coinType,
            symbol: text(input.symbol).toUpperCase(),
            decimals: normalizeDecimals(input.decimals),
            amountAtomic: amountAtomic.toString(),
            amountDisplay: formatAtomicAmount(amountAtomic, input.decimals),
            label: text(input.label),
            message: text(input.message),
            registryId: canonicalizeAddress(input.registryId),
            registryName: text(input.registryName),
            paymentUri: text(input.paymentUri),
            universalUrl: text(input.universalUrl),
            paymentStatus: 'pending',
            createdAt: now,
            lastCheckedAt: null,
            detectedAt: null,
            chainTimestamp: null,
            transactionDigest: null,
            archivedAt: null,
            lastError: null,
        };
    }

    function createStorageKey(network, creatorAddress) {
        return `${STORAGE_PREFIX}:${text(network || 'mainnet').toLowerCase()}:${canonicalizeAddress(creatorAddress)}`;
    }

    function normalizeStoredInvoice(value) {
        if (!value || typeof value !== 'object' || value.schemaVersion !== SCHEMA_VERSION) return null;
        try {
            const invoice = createInvoiceRecord({
                ...value,
                amountAtomic: value.amountAtomic,
                createdAt: value.createdAt,
            });
            invoice.paymentStatus = value.paymentStatus === 'paid' ? 'paid' : 'pending';
            invoice.lastCheckedAt = value.lastCheckedAt || null;
            invoice.detectedAt = value.detectedAt || null;
            invoice.chainTimestamp = value.chainTimestamp || null;
            invoice.transactionDigest = text(value.transactionDigest) || null;
            invoice.archivedAt = value.archivedAt || null;
            invoice.lastError = text(value.lastError) || null;
            return invoice;
        } catch (_) {
            return null;
        }
    }

    function loadInvoices(storage, key) {
        if (!storage || typeof storage.getItem !== 'function') return { invoices: [], corruptCount: 0 };
        let parsed;
        try {
            const raw = storage.getItem(key);
            if (!raw) return { invoices: [], corruptCount: 0 };
            parsed = JSON.parse(raw);
        } catch (_) {
            return { invoices: [], corruptCount: 1 };
        }
        if (!Array.isArray(parsed)) return { invoices: [], corruptCount: 1 };
        const invoices = [];
        let corruptCount = 0;
        for (const item of parsed) {
            const normalized = normalizeStoredInvoice(item);
            if (normalized) invoices.push(normalized);
            else corruptCount += 1;
        }
        invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return { invoices, corruptCount };
    }

    function saveInvoices(storage, key, invoices, maxRecords) {
        if (!storage || typeof storage.setItem !== 'function') throw new Error('Browser storage is unavailable.');
        const limit = Number.isInteger(maxRecords) && maxRecords > 0 ? maxRecords : 500;
        if (!Array.isArray(invoices)) throw new Error('Invoice history is invalid.');
        if (invoices.length > limit) throw new Error(`Invoice history is limited to ${limit} records. Export and archive older records first.`);
        storage.setItem(key, JSON.stringify(invoices));
        return invoices.length;
    }

    function transitionInvoiceStatus(invoice, update) {
        if (!invoice || typeof invoice !== 'object') throw new Error('Invoice is required.');
        const next = { ...invoice };
        const now = update && update.now ? update.now : new Date().toISOString();
        if (update && update.markPaid) {
            next.paymentStatus = 'paid';
            next.transactionDigest = text(update.transactionDigest) || next.transactionDigest;
            next.detectedAt = next.detectedAt || now;
            next.chainTimestamp = update.chainTimestamp || next.chainTimestamp || null;
            next.lastError = null;
        }
        if (update && update.checked) next.lastCheckedAt = now;
        if (update && Object.prototype.hasOwnProperty.call(update, 'error')) next.lastError = text(update.error) || null;
        if (update && update.archive) next.archivedAt = next.archivedAt || now;
        if (update && update.restore) next.archivedAt = null;
        return next;
    }

    function escapeCsvCell(value) {
        let output = String(value == null ? '' : value);
        if (/^[=+\-@]/.test(output)) output = `'${output}`;
        return `"${output.replace(/"/g, '""')}"`;
    }

    function buildCsv(invoices) {
        const headers = [
            'status', 'label', 'message', 'amount_display', 'amount_atomic', 'symbol', 'coin_type',
            'receiver', 'nonce', 'registry_id', 'created_at', 'detected_at', 'transaction_digest', 'paylink',
        ];
        const rows = (Array.isArray(invoices) ? invoices : []).map((invoice) => [
            invoice.paymentStatus,
            invoice.label,
            invoice.message,
            invoice.amountDisplay,
            invoice.amountAtomic,
            invoice.symbol,
            invoice.coinType,
            invoice.receiverAddress,
            invoice.nonce,
            invoice.registryId,
            invoice.createdAt,
            invoice.detectedAt || '',
            invoice.transactionDigest || '',
            invoice.universalUrl,
        ]);
        return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    }

    function shortAddress(value, lead, tail) {
        const address = text(value);
        const left = Number.isInteger(lead) ? lead : 6;
        const right = Number.isInteger(tail) ? tail : 4;
        return address.length > left + right + 1 ? `${address.slice(0, left)}…${address.slice(-right)}` : address;
    }

    function safeFilenamePart(value) {
        return text(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'paylink';
    }

    root.AlphaCityPaylinkCore = Object.freeze({
        version: SCHEMA_VERSION,
        U64_MAX,
        canonicalizeAddress,
        canonicalizeCoinType,
        validateCoinType,
        parseDisplayAmount,
        formatAtomicAmount,
        validateInvoiceDraft,
        createInvoiceRecord,
        createStorageKey,
        loadInvoices,
        saveInvoices,
        transitionInvoiceStatus,
        escapeCsvCell,
        buildCsv,
        shortAddress,
        safeFilenamePart,
    });
})(typeof window !== 'undefined' ? window : globalThis);
