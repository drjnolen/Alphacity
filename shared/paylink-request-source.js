const DEFAULT_GRAPHQL_URLS = [
    'https://graphql.mainnet.sui.io/graphql',
    'https://sui-mainnet.mystenlabs.com/graphql',
];
const MAX_U64 = (1n << 64n) - 1n;
const REVIEW_QUERY = `
query ReviewPaylink($coinType: String!, $registry: SuiAddress!, $paymentKey: DynamicFieldName!) {
  coinMetadata(coinType: $coinType) {
    decimals
    name
    symbol
  }
  address(address: $registry) {
    dynamicField(name: $paymentKey) {
      address
      previousTransaction { digest }
    }
  }
}`;

function normalizeSuiAddress(value) {
    const match = String(value || '').trim().match(/^0x([0-9a-fA-F]{1,64})$/);
    if (!match) throw new Error('Payment request contains an invalid Sui address.');
    return `0x${match[1].toLowerCase().padStart(64, '0')}`;
}

function normalizeCoinType(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 512 || !/^[0-9a-zA-Z_:<>,]+$/.test(raw) || !raw.includes('::')) {
        throw new Error('Payment request contains an invalid coin type.');
    }
    return raw.replace(/0x[0-9a-fA-F]+/g, (address) => normalizeSuiAddress(address));
}

function encodeUleb128(value) {
    let remaining = Number(value);
    if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error('Invalid BCS length.');
    const bytes = [];
    do {
        let byte = remaining & 0x7f;
        remaining = Math.floor(remaining / 128);
        if (remaining) byte |= 0x80;
        bytes.push(byte);
    } while (remaining);
    return bytes;
}

function serializePaymentKey({ nonce, amountAtomic, receiverAddress }) {
    const nonceBytes = new TextEncoder().encode(String(nonce || ''));
    if (!nonceBytes.length || nonceBytes.length > 128) throw new Error('Payment request contains an invalid nonce.');
    const amount = BigInt(amountAtomic);
    if (amount <= 0n || amount > MAX_U64) throw new Error('Payment amount is outside the supported range.');
    const address = normalizeSuiAddress(receiverAddress).slice(2);
    const output = new Uint8Array(encodeUleb128(nonceBytes.length).length + nonceBytes.length + 8 + 32);
    let offset = 0;
    const lengthBytes = encodeUleb128(nonceBytes.length);
    output.set(lengthBytes, offset);
    offset += lengthBytes.length;
    output.set(nonceBytes, offset);
    offset += nonceBytes.length;
    let remaining = amount;
    for (let index = 0; index < 8; index += 1) {
        output[offset + index] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    offset += 8;
    for (let index = 0; index < 32; index += 1) {
        output[offset + index] = Number.parseInt(address.slice(index * 2, index * 2 + 2), 16);
    }
    return output;
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function requireSingle(params, name, optional = false) {
    const values = params.getAll(name);
    if ((optional && values.length > 1) || (!optional && values.length !== 1)) {
        throw new Error(`Payment request contains an invalid ${name} field.`);
    }
    return values[0] || '';
}

function parsePaymentRequest(search, config = {}) {
    const outer = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    if (outer.getAll('request').length !== 1) throw new Error('Payment request link is ambiguous.');
    const paymentUri = outer.get('request');
    if (!paymentUri) throw new Error('Payment request is missing.');
    const url = new URL(paymentUri);
    if (url.protocol !== 'sui:' || url.pathname !== 'pay' || url.hash) {
        throw new Error('Payment request uses an unsupported URI.');
    }
    const params = url.searchParams;
    const receiverAddress = normalizeSuiAddress(requireSingle(params, 'receiver'));
    const amountText = requireSingle(params, 'amount');
    if (!/^\d+$/.test(amountText)) throw new Error('Payment request contains an invalid amount.');
    const amountAtomic = BigInt(amountText);
    if (amountAtomic <= 0n || amountAtomic > MAX_U64) throw new Error('Payment amount is outside the supported range.');
    const coinType = normalizeCoinType(requireSingle(params, 'coinType'));
    const nonce = requireSingle(params, 'nonce');
    if (!nonce || new TextEncoder().encode(nonce).length > 128) throw new Error('Payment request contains an invalid nonce.');
    const registryId = normalizeSuiAddress(requireSingle(params, 'registry'));
    const expectedRegistry = normalizeSuiAddress(config.registryId);
    if (registryId !== expectedRegistry) throw new Error('Payment request does not use the Alpha City payment registry.');
    const label = requireSingle(params, 'label', true).trim();
    const message = requireSingle(params, 'message', true).trim();
    if (Array.from(label).length > 64 || Array.from(message).length > 180) {
        throw new Error('Payment request label or memo is too long.');
    }
    return Object.freeze({
        paymentUri,
        receiverAddress,
        amountAtomic,
        coinType,
        nonce,
        registryId,
        label,
        message,
    });
}

function createSlushUrl(paymentUri, baseUrl = 'https://my.slush.app/pay') {
    const question = paymentUri.indexOf('?');
    if (question < 0) throw new Error('Payment request has no query parameters.');
    const url = new URL(baseUrl);
    url.search = paymentUri.slice(question + 1);
    url.searchParams.set('uri', paymentUri);
    return url.toString();
}

async function fetchGraphql(url, variables, fetchImpl, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: REVIEW_QUERY, variables }),
            signal: controller?.signal,
        });
        if (!response.ok) throw new Error(`Sui GraphQL returned HTTP ${response.status}.`);
        const payload = await response.json();
        if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join('; '));
        if (!payload.data) throw new Error('Sui GraphQL returned no data.');
        return payload.data;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function reviewPaymentRequest(request, config = {}, options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('Payment verification is unavailable.');
    const paymentPackage = normalizeSuiAddress(config.paymentKitPackageId);
    const paymentKey = bytesToBase64(serializePaymentKey(request));
    const variables = {
        coinType: request.coinType,
        registry: request.registryId,
        paymentKey: {
            type: `${paymentPackage}::payment_kit::PaymentKey<${request.coinType}>`,
            bcs: paymentKey,
        },
    };
    const urls = Array.isArray(config.graphqlUrls) && config.graphqlUrls.length
        ? config.graphqlUrls
        : DEFAULT_GRAPHQL_URLS;
    let data = null;
    let lastError = null;
    for (const url of urls) {
        try {
            data = await fetchGraphql(url, variables, fetchImpl, options.timeoutMs || 8_000);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!data) throw new Error(`Unable to verify this payment request. ${lastError?.message || ''}`.trim());
    const metadata = data.coinMetadata;
    const decimals = Number(metadata?.decimals);
    const symbol = String(metadata?.symbol || '').trim().toUpperCase();
    const name = String(metadata?.name || symbol).trim();
    if (!metadata || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !symbol || symbol.length > 24) {
        throw new Error('Verified on-chain token metadata is unavailable for this request.');
    }
    if (!data.address) throw new Error('The Alpha City payment registry could not be verified.');
    const preset = (config.tokenPresets || []).find((token) => {
        try { return normalizeCoinType(token.coinType) === request.coinType; }
        catch (_) { return false; }
    });
    if (preset && (Number(preset.decimals) !== decimals || String(preset.symbol).toUpperCase() !== symbol)) {
        throw new Error('On-chain token metadata does not match the trusted Alpha City preset.');
    }
    const record = data.address?.dynamicField || null;
    return Object.freeze({
        metadata: Object.freeze({ decimals, symbol, name, trustedPreset: Boolean(preset) }),
        paid: Boolean(record),
        transactionDigest: record?.previousTransaction?.digest || null,
    });
}

const api = Object.freeze({
    normalizeSuiAddress,
    normalizeCoinType,
    parsePaymentRequest,
    serializePaymentKey,
    createSlushUrl,
    reviewPaymentRequest,
});

if (typeof window !== 'undefined') window.AlphaCityPaylinkRequest = api;

export {
    normalizeSuiAddress,
    normalizeCoinType,
    parsePaymentRequest,
    serializePaymentKey,
    createSlushUrl,
    reviewPaymentRequest,
};
