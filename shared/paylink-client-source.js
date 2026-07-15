import {
    DEFAULT_REGISTRY_NAME,
    createPaymentTransactionUri,
    parsePaymentTransactionUri,
} from '@mysten/payment-kit';
import { bcs } from '@mysten/sui/bcs';
import { normalizeStructTag } from '@mysten/sui/utils';
import QRCode from 'qrcode';

const PAYMENT_KIT_PACKAGE_IDS = Object.freeze({
    mainnet: '0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6',
    testnet: '0x7e069abe383e80d32f2aec17b3793da82aabc8c2edf84abbf68dd7b719e71497',
});
const PaymentKey = bcs.struct('PaymentKey', {
    nonce: bcs.string(),
    payment_amount: bcs.u64(),
    receiver: bcs.Address,
});
const PaymentRecord = bcs.struct('PaymentRecord', {
    epoch_at_time_of_record: bcs.u64(),
});

let suiClient = null;
let dataLayer = null;
let initializedConfig = null;

function normalizeError(error, fallback = 'Payment service request failed.') {
    const message = error?.message || String(error || fallback);
    return new Error(message.length > 300 ? `${message.slice(0, 297)}…` : message);
}

function isMissingRecordError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return /not found|does not exist|could not find|dynamic field.*missing|objectnotfound/.test(message);
}

function initialize(options = {}) {
    const layer = options.dataLayer || (typeof window !== 'undefined' ? window.AlphaCitySui : null);
    const client = options.suiClient || layer?.grpcClient;
    if (!client?.core || typeof client.core.getDynamicField !== 'function') {
        throw new Error('Sui payment client is unavailable. Refresh the page and try again.');
    }
    const network = options.network || layer?.config?.network || 'mainnet';
    if (!['mainnet', 'testnet'].includes(network)) throw new Error(`Unsupported Payment Kit network: ${network}`);
    suiClient = client;
    dataLayer = layer;
    initializedConfig = {
        network,
        registryId: options.registryId || null,
        registryName: options.registryName || DEFAULT_REGISTRY_NAME,
        paymentKitPackageId: options.paymentKitPackageId || PAYMENT_KIT_PACKAGE_IDS[network],
        slushPaymentBaseUrl: options.slushPaymentBaseUrl || 'https://my.slush.app/pay',
        payerRequestBaseUrl: options.payerRequestBaseUrl || 'https://alphacity.tech/pay/request/',
    };
    return { ...initializedConfig };
}

function requireClient() {
    if (!suiClient || !initializedConfig) throw new Error('Payment client has not been initialized.');
}

function registryParams(invoice = {}) {
    const registryId = invoice.registryId || initializedConfig?.registryId;
    if (registryId) return { registryId };
    return { registryName: invoice.registryName || initializedConfig?.registryName || DEFAULT_REGISTRY_NAME };
}

function createPaymentUri(invoice) {
    requireClient();
    const params = {
        receiverAddress: invoice.receiverAddress,
        amount: BigInt(invoice.amountAtomic),
        coinType: invoice.coinType,
        nonce: invoice.nonce,
        label: invoice.label || undefined,
        message: invoice.message || undefined,
        ...registryParams(invoice),
    };
    let uri;
    try {
        uri = createPaymentTransactionUri(params);
    } catch (error) {
        throw normalizeError(error, 'Unable to create the payment link.');
    }
    const parsed = parsePaymentUri(uri);
    const expectedRegistry = params.registryId || params.registryName;
    const parsedRegistry = parsed.registryId || parsed.registryName;
    if (
        parsed.receiverAddress.toLowerCase() !== String(params.receiverAddress).toLowerCase()
        || parsed.amount !== params.amount
        || parsed.coinType !== params.coinType
        || parsed.nonce !== params.nonce
        || parsedRegistry !== expectedRegistry
    ) {
        throw new Error('Payment link validation failed. No invoice was saved.');
    }
    return uri;
}

function parsePaymentUri(uri) {
    try {
        return parsePaymentTransactionUri(uri);
    } catch (error) {
        throw normalizeError(error, 'Unable to parse the payment link.');
    }
}

function createSlushUniversalUrl(uri, baseUrl) {
    parsePaymentUri(uri);
    const question = uri.indexOf('?');
    if (question < 0) throw new Error('Payment URI has no query parameters.');
    const universalUrl = new URL(baseUrl || initializedConfig?.slushPaymentBaseUrl || 'https://my.slush.app/pay');
    universalUrl.search = uri.slice(question + 1);
    // Slush mobile reconstructs the Payment Kit URI from the documented query
    // fields. Its current web route instead expects the complete URI in a
    // `uri` route parameter. Supplying both keeps one link compatible with both
    // clients; Payment Kit safely ignores the additional parameter on mobile.
    universalUrl.searchParams.set('uri', uri);
    return universalUrl.toString();
}

function createPayerRequestUrl(invoice, baseUrl) {
    const paymentUri = invoice?.paymentUri || invoice?.uri;
    parsePaymentUri(paymentUri);
    const payerUrl = new URL(baseUrl || initializedConfig?.payerRequestBaseUrl || 'https://alphacity.tech/pay/request/');
    payerUrl.searchParams.set('request', paymentUri);
    payerUrl.searchParams.set('symbol', String(invoice?.symbol || '').trim().toUpperCase());
    payerUrl.searchParams.set('decimals', String(invoice?.decimals ?? ''));
    return payerUrl.toString();
}

async function getPaymentRecord(invoice) {
    requireClient();
    const registryId = invoice.registryId || initializedConfig.registryId;
    if (!registryId) throw new Error('A registry object ID is required to check payment status.');
    const coinType = normalizeStructTag(invoice.coinType);
    const paymentKeyType = `${initializedConfig.paymentKitPackageId}::payment_kit::PaymentKey<${coinType}>`;
    const paymentKeyBcs = PaymentKey.serialize({
        nonce: invoice.nonce,
        payment_amount: BigInt(invoice.amountAtomic),
        receiver: invoice.receiverAddress,
    }).toBytes();
    try {
        // Payment Kit 0.2.5 appends a concrete type argument to the generated
        // `PaymentKey<phantom T>` display name, producing an invalid type. Query
        // the same documented dynamic-field composite directly until upstream
        // removes the placeholder from its runtime type name.
        const result = await suiClient.core.getDynamicField({
            parentId: registryId,
            name: { type: paymentKeyType, bcs: paymentKeyBcs },
        });
        const record = result?.dynamicField;
        if (!record) return null;
        const decoded = PaymentRecord.parse(record.value.bcs);
        return {
            key: record.fieldId || null,
            transactionDigest: record.previousTransaction || null,
            epochAtTimeOfRecord: decoded.epoch_at_time_of_record == null ? null : String(decoded.epoch_at_time_of_record),
        };
    } catch (error) {
        if (isMissingRecordError(error)) return null;
        throw normalizeError(error, 'Unable to check payment status.');
    }
}

async function getCoinMetadata(coinType) {
    if (!dataLayer?.rpc) throw new Error('Sui token metadata service is unavailable.');
    try {
        const metadata = await dataLayer.rpc('suix_getCoinMetadata', [coinType]);
        if (!metadata) throw new Error('No metadata was found for this coin type.');
        const decimals = Number(metadata.decimals);
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
            throw new Error('Token metadata contains unsupported decimals.');
        }
        return {
            coinType,
            symbol: String(metadata.symbol || '').trim().toUpperCase(),
            name: String(metadata.name || metadata.symbol || 'Custom token').trim(),
            decimals,
            iconUrl: metadata.iconUrl || null,
        };
    } catch (error) {
        throw normalizeError(error, 'Unable to load token metadata.');
    }
}

async function renderQr(canvas, value, options = {}) {
    if (!canvas) throw new Error('QR canvas is missing.');
    await QRCode.toCanvas(canvas, value, {
        width: options.width || 320,
        margin: options.margin == null ? 2 : options.margin,
        errorCorrectionLevel: options.errorCorrectionLevel || 'M',
        color: {
            dark: options.dark || '#0b1220',
            light: options.light || '#ffffff',
        },
    });
    return canvas;
}

function downloadQr(canvas, filename = 'alpha-city-paylink.png') {
    if (!canvas?.toDataURL) throw new Error('QR image is unavailable.');
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/png');
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
}

if (typeof window !== 'undefined') {
    window.AlphaCityPaylinkClient = Object.freeze({
        version: '1',
        defaultRegistryName: DEFAULT_REGISTRY_NAME,
        initialize,
        createPaymentUri,
        parsePaymentUri,
        createSlushUniversalUrl,
        createPayerRequestUrl,
        getPaymentRecord,
        getCoinMetadata,
        renderQr,
        downloadQr,
        isMissingRecordError,
    });
}

export {
    initialize,
    createPaymentUri,
    parsePaymentUri,
    createSlushUniversalUrl,
    createPayerRequestUrl,
    getPaymentRecord,
    getCoinMetadata,
    renderQr,
    downloadQr,
    isMissingRecordError,
};
