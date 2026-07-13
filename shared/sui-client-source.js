import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';

const DEFAULT_GRPC_URL = 'https://fullnode.mainnet.sui.io:443';
const DEFAULT_GRAPHQL_URLS = [
    'https://graphql.mainnet.sui.io/graphql',
    'https://sui-mainnet.mystenlabs.com/graphql',
];

const STAKED_SUI_QUERY = `
query GetStakes($owner: SuiAddress!) {
  address(address: $owner) {
    stakedSuis {
      nodes {
        principal
        stakeActivationEpoch
        estimatedReward
      }
    }
  }
}`;

const EVENTS_QUERY_ASC = `
query QueryEvents($filter: EventFilter, $limit: Int, $cursor: String) {
  events(first: $limit, after: $cursor, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      sequenceNumber
      timestamp
      sender { address }
      transaction { digest }
      transactionModule { name package { address } }
      contents { type { repr } bcs json }
    }
  }
}`;

const EVENTS_QUERY_DESC = `
query QueryEvents($filter: EventFilter, $limit: Int, $cursor: String) {
  events(last: $limit, before: $cursor, filter: $filter) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      sequenceNumber
      timestamp
      sender { address }
      transaction { digest }
      transactionModule { name package { address } }
      contents { type { repr } bcs json }
    }
  }
}`;

const TRANSACTIONS_QUERY_ASC = `
query QueryTransactions($filter: TransactionFilter, $limit: Int, $cursor: String) {
  transactions(first: $limit, after: $cursor, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      digest
      sender { address }
      effects {
        status
        timestamp
        balanceChanges(first: 50) {
          nodes { amount coinType { repr } owner { address } }
        }
      }
    }
  }
}`;

const TRANSACTIONS_QUERY_DESC = `
query QueryTransactions($filter: TransactionFilter, $limit: Int, $cursor: String) {
  transactions(last: $limit, before: $cursor, filter: $filter) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      digest
      sender { address }
      effects {
        status
        timestamp
        balanceChanges(first: 50) {
          nodes { amount coinType { repr } owner { address } }
        }
      }
    }
  }
}`;

const DYNAMIC_FIELDS_QUERY = `
query DynamicFields($parent: SuiAddress!, $limit: Int, $cursor: String) {
  owner: address(address: $parent) {
    dynamicFields(first: $limit, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        name { type { repr } json }
        value {
          ... on MoveObject { address contents { type { repr } json } }
          ... on MoveValue { type { repr } json }
        }
      }
    }
  }
}`;

const QUERY_OBJECTS = `
query QueryObjects($filter: ObjectFilter!, $limit: Int, $cursor: String) {
  objects(first: $limit, after: $cursor, filter: $filter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      address
      version
      digest
      owner {
        __typename
        ... on AddressOwner { address { address } }
        ... on ObjectOwner { address { address } }
        ... on Shared { initialSharedVersion }
        ... on ConsensusAddressOwner { address { address } startVersion }
      }
      asMoveObject { contents { type { repr } json } }
    }
  }
}`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function pageSize(limit, fallback = 50) {
    const parsed = Number(limit || fallback);
    return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : fallback, 50));
}

function base64ToBytes(value) {
    if (typeof value !== 'string' || !value) throw new Error('Transaction bytes must be base64 encoded');
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function legacyProtocolConfigAttribute(value) {
    if (value == null) return null;
    const normalized = String(value);
    if (normalized === 'true' || normalized === 'false') return { bool: normalized };
    if (/^\d+$/.test(normalized)) return { u64: normalized };
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return { f64: normalized };
    return null;
}

function executionErrorMessage(error) {
    if (!error) return null;
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string') return error.message;
    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error);
    }
}

function normalizeOptions(options = {}) {
    return {
        json: Boolean(options.showContent),
        display: Boolean(options.showDisplay),
        previousTransaction: Boolean(options.showPreviousTransaction),
    };
}

// gRPC/GraphQL JSON uses plain nested objects. Legacy JSON-RPC wrapped Move
// structs in `{ fields: ... }`. Preserve both access styles during migration.
export function legacyMoveJson(value) {
    if (Array.isArray(value)) return value.map(legacyMoveJson);
    if (!value || typeof value !== 'object') return value;
    const direct = {};
    for (const [key, child] of Object.entries(value)) {
        direct[key] = legacyMoveJson(child);
    }
    return { ...direct, fields: direct };
}

function legacyOwner(owner) {
    if (!owner || typeof owner !== 'object') return owner || null;
    if (owner.AddressOwner) return { AddressOwner: owner.AddressOwner };
    if (owner.ObjectOwner) return { ObjectOwner: owner.ObjectOwner };
    if (owner.Shared) return { Shared: { initial_shared_version: owner.Shared.initialSharedVersion } };
    if (owner.Immutable) return 'Immutable';
    if (owner.ConsensusAddressOwner) {
        return { ConsensusAddressOwner: owner.ConsensusAddressOwner };
    }
    return null;
}

export function legacyObject(object, options = {}) {
    if (!object || object instanceof Error) return { error: { message: object?.message || 'Object not found' } };
    const json = options.showContent ? legacyMoveJson(object.json || {}) : null;
    const data = {
        objectId: object.objectId,
        version: object.version,
        digest: object.digest,
        type: object.type,
        owner: legacyOwner(object.owner),
    };
    if (options.showContent) {
        data.content = {
            dataType: 'moveObject',
            type: object.type,
            fields: json?.fields || {},
        };
    }
    if (options.showDisplay) {
        data.display = { data: object.display?.output || null, error: object.display?.errors || null };
    }
    if (options.showPreviousTransaction) data.previousTransaction = object.previousTransaction || null;
    return { data };
}

function legacyGraphqlObject(node, options = {}) {
    const move = node?.asMoveObject;
    const type = move?.contents?.type?.repr || '';
    return legacyObject({
        objectId: node?.address,
        version: node?.version != null ? String(node.version) : '',
        digest: node?.digest || '',
        type,
        owner: graphqlOwner(node?.owner),
        json: move?.contents?.json || null,
        display: null,
    }, options);
}

function graphqlOwner(owner) {
    if (!owner) return null;
    if (owner.__typename === 'AddressOwner') return { AddressOwner: owner.address?.address || '' };
    if (owner.__typename === 'ObjectOwner') return { ObjectOwner: owner.address?.address || '' };
    if (owner.__typename === 'Shared') return { Shared: { initialSharedVersion: String(owner.initialSharedVersion || '') } };
    if (owner.__typename === 'Immutable') return { Immutable: true };
    if (owner.__typename === 'ConsensusAddressOwner') {
        return { ConsensusAddressOwner: { owner: owner.address?.address || '', startVersion: String(owner.startVersion || '') } };
    }
    return null;
}

function legacyFilterType(filter) {
    if (!filter) return null;
    if (filter.StructType) return filter.StructType;
    return null;
}

function normalizedType(type) {
    return String(type || '').replace(/0x[0-9a-fA-F]+/g, address => {
        const hex = address.slice(2).toLowerCase();
        return `0x${hex.padStart(64, '0')}`;
    });
}

function matchesFilter(type, filter) {
    if (!filter) return true;
    const canonicalType = normalizedType(type);
    if (filter.StructType) return canonicalType === normalizedType(filter.StructType);
    if (filter.Package) return canonicalType.startsWith(`${normalizedType(filter.Package)}::`);
    if (filter.MoveModule) {
        const pkg = normalizedType(filter.MoveModule.package);
        const mod = filter.MoveModule.module;
        return canonicalType.startsWith(`${pkg}::${mod}::`);
    }
    if (Array.isArray(filter.MatchAll)) return filter.MatchAll.every(item => matchesFilter(type, item));
    if (Array.isArray(filter.MatchAny)) return filter.MatchAny.some(item => matchesFilter(type, item));
    if (filter.MatchNone) return !matchesFilter(type, filter.MatchNone);
    return true;
}

function eventFilter(query = {}) {
    if (query.MoveEventType) return { type: query.MoveEventType };
    if (query.MoveEventModule) return { module: `${query.MoveEventModule.package}::${query.MoveEventModule.module}` };
    if (query.MoveModule) return { module: `${query.MoveModule.package}::${query.MoveModule.module}` };
    if (query.Sender) return { sender: query.Sender };
    return {};
}

function transactionFilter(query = {}) {
    if (query.FromAddress) return { sentAddress: query.FromAddress };
    if (query.ToAddress) return { affectedAddress: query.ToAddress };
    if (query.InputObject) return { affectedObject: query.InputObject };
    if (query.ChangedObject) return { affectedObject: query.ChangedObject };
    if (query.MoveFunction) {
        const fn = query.MoveFunction;
        return { function: [fn.package, fn.module, fn.function].filter(Boolean).join('::') };
    }
    return {};
}

export function createSuiDataLayer(config = {}) {
    const runtimeConfig = typeof window !== 'undefined' ? (window.ALPHA_CITY_SUI_CONFIG || {}) : {};
    const merged = { ...runtimeConfig, ...config };
    const network = merged.network || 'mainnet';
    const grpcUrl = merged.grpcUrl || DEFAULT_GRPC_URL;
    const graphqlUrls = merged.graphqlUrls || DEFAULT_GRAPHQL_URLS;
    const grpc = merged.grpcClient || new SuiGrpcClient({ network, baseUrl: grpcUrl });
    const graphqlClients = merged.graphqlClients || graphqlUrls.map(url => new SuiGraphQLClient({ network, url }));

    async function graphql(query, variables, attempts = 2) {
        let lastError = new Error('SUI GraphQL request failed');
        let schemaError = null;
        for (let pass = 0; pass < attempts; pass++) {
            for (const client of graphqlClients) {
                try {
                    const result = await client.query({ query, variables });
                    if (result.errors?.length) {
                        schemaError = new Error(result.errors.map(error => error.message).join('; '));
                        throw schemaError;
                    }
                    if (!result.data) throw new Error('SUI GraphQL returned no data');
                    return result.data;
                } catch (error) {
                    lastError = error;
                }
            }
            if (pass + 1 < attempts) await sleep(250 * (pass + 1));
        }
        throw schemaError || lastError;
    }

    async function getBalance(params) {
        const [owner, coinType] = params;
        const { balance } = await grpc.getBalance({ owner, coinType });
        return {
            coinType: balance.coinType,
            totalBalance: balance.balance,
            coinBalance: balance.coinBalance,
            addressBalance: balance.addressBalance,
            coinObjectCount: 0,
            lockedBalance: {},
        };
    }

    async function getAllBalances(params) {
        const [owner] = params;
        const rows = [];
        let cursor = null;
        do {
            const page = await grpc.listBalances({ owner, cursor, limit: 50 });
            rows.push(...page.balances.map(balance => ({
                coinType: balance.coinType,
                totalBalance: balance.balance,
                coinBalance: balance.coinBalance,
                addressBalance: balance.addressBalance,
                coinObjectCount: 0,
                lockedBalance: {},
            })));
            cursor = page.hasNextPage ? page.cursor : null;
        } while (cursor);
        return rows;
    }

    async function getCoins(params) {
        const [owner, coinType, cursor, limit = 50] = params;
        const page = await grpc.listCoins({ owner, coinType, cursor, limit: pageSize(limit) });
        return {
            data: page.objects.map(coin => ({
                coinType: coinType || coin.type?.match(/<(.+)>/)?.[1] || '',
                coinObjectId: coin.objectId,
                version: coin.version,
                digest: coin.digest,
                balance: coin.balance,
                previousTransaction: null,
            })),
            hasNextPage: page.hasNextPage,
            nextCursor: page.cursor,
        };
    }

    async function getOwnedObjects(params) {
        const [owner, query = {}, cursor = null, limit = 50] = params;
        const options = query?.options || {};
        const filter = query?.filter || null;
        const page = await grpc.listOwnedObjects({
            owner,
            cursor,
            limit: pageSize(limit),
            type: legacyFilterType(filter) || undefined,
            include: normalizeOptions(options),
        });
        return {
            data: page.objects
                .filter(object => matchesFilter(object.type || '', filter))
                .map(object => legacyObject(object, options)),
            hasNextPage: page.hasNextPage,
            nextCursor: page.cursor,
        };
    }

    async function getObject(params) {
        const [objectId, options = {}] = params;
        const { object } = await grpc.getObject({ objectId, include: normalizeOptions(options) });
        return legacyObject(object, options);
    }

    async function multiGetObjects(params) {
        const [objectIds, options = {}] = params;
        const result = await grpc.getObjects({ objectIds, include: normalizeOptions(options) });
        return result.objects.map(object => legacyObject(object, options));
    }

    async function getCoinMetadata(params) {
        const [coinType] = params;
        const { coinMetadata } = await grpc.getCoinMetadata({ coinType });
        if (!coinMetadata) return null;
        return {
            id: coinMetadata.id,
            decimals: coinMetadata.decimals,
            name: coinMetadata.name,
            symbol: coinMetadata.symbol,
            description: coinMetadata.description,
            iconUrl: coinMetadata.iconUrl,
        };
    }

    async function getTotalSupply(params) {
        const [coinType] = params;
        const { response } = await grpc.stateService.getCoinInfo({ coinType });
        return { value: response.treasury?.totalSupply?.toString() || '0' };
    }

    async function getReferenceGasPrice() {
        const { referenceGasPrice } = await grpc.getReferenceGasPrice();
        return String(referenceGasPrice || '0');
    }

    async function getProtocolConfig() {
        const { protocolConfig } = await grpc.core.getProtocolConfig();
        const attributes = {};
        for (const [key, value] of Object.entries(protocolConfig.attributes || {})) {
            attributes[key] = legacyProtocolConfigAttribute(value);
        }
        return {
            attributes,
            featureFlags: { ...(protocolConfig.featureFlags || {}) },
            minSupportedProtocolVersion: String(protocolConfig.protocolVersion || ''),
            maxSupportedProtocolVersion: String(protocolConfig.protocolVersion || ''),
            protocolVersion: String(protocolConfig.protocolVersion || ''),
        };
    }

    async function dryRunTransactionBlock(params) {
        const [transactionBytes] = params;
        const simulation = await grpc.simulateTransaction({
            transaction: base64ToBytes(transactionBytes),
            include: { effects: true },
        });
        const transaction = simulation.Transaction || simulation.FailedTransaction;
        const effects = transaction?.effects;
        if (!effects) throw new Error('SUI gRPC simulation returned no transaction effects');
        const success = Boolean(effects.status?.success);
        return {
            effects: {
                status: {
                    status: success ? 'success' : 'failure',
                    error: success ? null : executionErrorMessage(effects.status?.error),
                },
                executedEpoch: String(transaction?.epoch || ''),
                gasUsed: {
                    computationCost: String(effects.gasUsed?.computationCost || '0'),
                    storageCost: String(effects.gasUsed?.storageCost || '0'),
                    storageRebate: String(effects.gasUsed?.storageRebate || '0'),
                    nonRefundableStorageFee: String(effects.gasUsed?.nonRefundableStorageFee || '0'),
                },
                transactionDigest: effects.transactionDigest || transaction?.digest || '',
                dependencies: effects.dependencies || [],
            },
            events: [],
            objectChanges: [],
            balanceChanges: [],
            input: null,
        };
    }

    async function getDynamicFields(params) {
        const [parent, cursor = null, limit = 50] = params;
        const data = await graphql(DYNAMIC_FIELDS_QUERY, { parent, cursor, limit: pageSize(limit) });
        const connection = data.owner?.dynamicFields;
        return {
            data: (connection?.nodes || []).map(node => {
                const valueObject = node.value?.address ? node.value : null;
                return {
                    name: { type: node.name?.type?.repr || '', value: node.name?.json ?? null },
                    objectId: valueObject?.address || node.address,
                    objectType: valueObject?.contents?.type?.repr || node.value?.type?.repr || '',
                };
            }),
            hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
            nextCursor: connection?.pageInfo?.endCursor || null,
        };
    }

    async function queryEvents(params) {
        const [query = {}, cursor = null, limit = 50, descending = false] = params;
        const data = await graphql(descending ? EVENTS_QUERY_DESC : EVENTS_QUERY_ASC, {
            filter: eventFilter(query), cursor, limit: pageSize(limit),
        });
        const connection = data.events;
        return {
            data: (connection?.nodes || []).map(node => ({
                id: { txDigest: node.transaction?.digest || '', eventSeq: String(node.sequenceNumber ?? 0) },
                packageId: node.transactionModule?.package?.address || '',
                transactionModule: node.transactionModule?.name || '',
                sender: node.sender?.address || '',
                type: node.contents?.type?.repr || '',
                parsedJson: node.contents?.json || null,
                bcs: node.contents?.bcs || '',
                timestampMs: node.timestamp ? String(Date.parse(node.timestamp)) : null,
            })),
            hasNextPage: descending
                ? Boolean(connection?.pageInfo?.hasPreviousPage)
                : Boolean(connection?.pageInfo?.hasNextPage),
            nextCursor: descending
                ? connection?.pageInfo?.startCursor || null
                : connection?.pageInfo?.endCursor || null,
        };
    }

    async function queryTransactionBlocks(params) {
        const [query = {}, cursor = null, limit = 50, descending = false] = params;
        const data = await graphql(descending ? TRANSACTIONS_QUERY_DESC : TRANSACTIONS_QUERY_ASC, {
            filter: transactionFilter(query?.filter || query), cursor, limit: pageSize(limit),
        });
        const connection = data.transactions;
        return {
            data: (connection?.nodes || []).map(node => ({
                digest: node.digest,
                timestampMs: node.effects?.timestamp ? String(Date.parse(node.effects.timestamp)) : null,
                transaction: { data: { sender: node.sender?.address || '' } },
                effects: { status: { status: node.effects?.status === 'SUCCESS' ? 'success' : 'failure' } },
                balanceChanges: (node.effects?.balanceChanges?.nodes || []).map(change => ({
                    owner: { AddressOwner: change.owner?.address || '' },
                    coinType: change.coinType?.repr || '',
                    amount: String(change.amount || '0'),
                })),
            })),
            hasNextPage: descending
                ? Boolean(connection?.pageInfo?.hasPreviousPage)
                : Boolean(connection?.pageInfo?.hasNextPage),
            nextCursor: descending
                ? connection?.pageInfo?.startCursor || null
                : connection?.pageInfo?.endCursor || null,
        };
    }

    async function getStakes(params) {
        const [owner] = params;
        let nodes = [];
        try {
            const data = await graphql(STAKED_SUI_QUERY, { owner }, 1);
            nodes = data.address?.stakedSuis?.nodes || [];
        } catch (error) {
            // Some public GraphQL deployments do not yet expose `stakedSuis`.
            // Principal remains available as an owned StakedSui object over gRPC.
            console.warn('SUI GraphQL staking query unavailable; using gRPC principal fallback:', error.message);
            let cursor = null;
            do {
                const page = await grpc.listOwnedObjects({
                    owner,
                    type: '0x3::staking_pool::StakedSui',
                    cursor,
                    limit: 50,
                    include: { json: true },
                });
                nodes.push(...page.objects.map(object => ({
                    id: object.objectId,
                    principal: object.json?.principal || '0',
                    stakeActivationEpoch: object.json?.stake_activation_epoch || '',
                    estimatedReward: '0',
                })));
                cursor = page.hasNextPage ? page.cursor : null;
            } while (cursor);
        }
        if (!nodes.length) return [];
        return [{
            validatorAddress: '',
            stakingPool: '',
            stakes: nodes.map((stake, index) => ({
                stakedSuiId: stake.id || `staked-sui-${index}`,
                stakeRequestEpoch: String(stake.stakeActivationEpoch ?? ''),
                stakeActiveEpoch: String(stake.stakeActivationEpoch ?? ''),
                principal: String(stake.principal || '0'),
                status: 'Active',
                estimatedReward: String(stake.estimatedReward || '0'),
            })),
        }];
    }

    async function queryObjects(params) {
        const [query = {}, cursor = null, limit = 50] = params;
        const filter = query.filter || {};
        let type = filter.StructType || filter.Package || null;
        if (filter.MoveModule) type = `${filter.MoveModule.package}::${filter.MoveModule.module}`;
        if (!type) throw new Error('queryObjects requires a type, package, or module filter');
        const data = await graphql(QUERY_OBJECTS, { filter: { type }, cursor, limit: pageSize(limit) });
        const connection = data.objects;
        return {
            data: (connection?.nodes || []).map(node => legacyGraphqlObject(node, query.options || {})),
            hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
            nextCursor: connection?.pageInfo?.endCursor || null,
        };
    }

    async function rpc(method, params = []) {
        switch (method) {
            case 'suix_getBalance': return getBalance(params);
            case 'suix_getAllBalances': return getAllBalances(params);
            case 'suix_getCoins': return getCoins(params);
            case 'suix_getOwnedObjects': return getOwnedObjects(params);
            case 'sui_getObject': return getObject(params);
            case 'sui_multiGetObjects': return multiGetObjects(params);
            case 'suix_getCoinMetadata': return getCoinMetadata(params);
            case 'suix_getTotalSupply': return getTotalSupply(params);
            case 'suix_getReferenceGasPrice': return getReferenceGasPrice(params);
            case 'sui_getProtocolConfig': return getProtocolConfig(params);
            case 'sui_dryRunTransactionBlock': return dryRunTransactionBlock(params);
            case 'suix_getDynamicFields': return getDynamicFields(params);
            case 'suix_queryEvents': return queryEvents(params);
            case 'suix_queryTransactionBlocks': return queryTransactionBlocks(params);
            case 'suix_getStakes': return getStakes(params);
            case 'suix_queryObjects': return queryObjects(params);
            default: throw new Error(`Unsupported SUI compatibility method: ${method}`);
        }
    }

    return {
        rpc,
        graphql,
        grpcClient: grpc,
        transport: 'grpc+graphql',
        version: '2',
        config: { network, grpcUrl, graphqlUrls: [...graphqlUrls] },
    };
}

const defaultLayer = typeof window !== 'undefined' ? createSuiDataLayer() : null;
if (typeof window !== 'undefined') window.AlphaCitySui = defaultLayer;

export default defaultLayer;
