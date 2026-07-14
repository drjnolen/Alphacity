(function (root) {
    'use strict';

    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function tokenKey(value) {
        const parts = String(value || '').trim().toLowerCase().split('::');
        if (!parts[0]) return '';
        const address = parts[0].replace(/^0x/, '').replace(/^0+/, '') || '0';
        return [address, ...parts.slice(1)].join('::');
    }

    function tokenPriceUsd(pair, tokenAddress) {
        const target = tokenKey(tokenAddress);
        const base = tokenKey(pair?.baseToken?.address);
        const quote = tokenKey(pair?.quoteToken?.address);
        const basePriceUsd = number(pair?.priceUsd);
        if (!target || !(basePriceUsd > 0)) return 0;
        if (target === base) return basePriceUsd;
        const priceNative = number(pair?.priceNative);
        if (target === quote && priceNative > 0) return basePriceUsd / priceNative;
        return 0;
    }

    function dedupePairs(pairs) {
        const byAddress = new Map();
        for (const pair of pairs || []) {
            if (pair?.chainId && pair.chainId !== 'sui') continue;
            const key = String(pair?.pairAddress || '').trim().toLowerCase();
            if (!key) continue;
            const existing = byAddress.get(key);
            if (!existing || number(pair?.liquidity?.usd) > number(existing?.liquidity?.usd)) {
                byAddress.set(key, pair);
            }
        }
        return [...byAddress.values()];
    }

    function normalizePromotionData(payload) {
        if (Array.isArray(payload)) return { orders: payload, boosts: [] };
        return {
            orders: Array.isArray(payload?.orders) ? payload.orders : [],
            boosts: Array.isArray(payload?.boosts) ? payload.boosts : [],
        };
    }

    function summarizeMarketIntegrity(pairs, promotionPayload, tokenAddress, options = {}) {
        const minComparableLiquidityUsd = number(options.minComparableLiquidityUsd) || 10_000;
        const promotionAvailable = options.promotionAvailable !== false;
        const uniquePairs = dedupePairs(pairs);
        const target = tokenKey(tokenAddress);
        const aggregateLiquidityUsd = uniquePairs.reduce((sum, pair) => sum + number(pair?.liquidity?.usd), 0);
        const aggregateVolumeH24 = uniquePairs.reduce((sum, pair) => sum + number(pair?.volume?.h24), 0);
        const buysH1 = uniquePairs.reduce((sum, pair) => sum + number(pair?.txns?.h1?.buys), 0);
        const sellsH1 = uniquePairs.reduce((sum, pair) => sum + number(pair?.txns?.h1?.sells), 0);
        const transactionsH1 = buysH1 + sellsH1;
        const venues = new Set(uniquePairs.map(pair => pair?.dexId).filter(Boolean));
        const deepestLiquidityUsd = uniquePairs.reduce((max, pair) => Math.max(max, number(pair?.liquidity?.usd)), 0);
        const deepestPoolSharePct = aggregateLiquidityUsd > 0
            ? (deepestLiquidityUsd / aggregateLiquidityUsd) * 100
            : null;

        const comparablePrices = uniquePairs
            .filter(pair => number(pair?.liquidity?.usd) >= minComparableLiquidityUsd)
            .map(pair => tokenPriceUsd(pair, tokenAddress))
            .filter(price => price > 0);
        const minimumPriceUsd = comparablePrices.length ? Math.min(...comparablePrices) : null;
        const maximumPriceUsd = comparablePrices.length ? Math.max(...comparablePrices) : null;
        const priceSpreadPct = comparablePrices.length >= 2 && minimumPriceUsd > 0
            ? ((maximumPriceUsd - minimumPriceUsd) / minimumPriceUsd) * 100
            : null;

        const activeBoosts = uniquePairs.reduce((max, pair) => {
            const isTargetBase = target && tokenKey(pair?.baseToken?.address) === target;
            return isTargetBase ? Math.max(max, number(pair?.boosts?.active)) : max;
        }, 0);
        const promotion = normalizePromotionData(promotionPayload);
        const paidOrders = promotion.orders.filter(order => !['cancelled', 'rejected'].includes(String(order?.status || '').toLowerCase()));
        const paidOrderTypes = [...new Set(paidOrders.map(order => String(order?.type || '')).filter(Boolean))];
        const purchasedBoostAmount = promotion.boosts.reduce((sum, boost) => sum + number(boost?.amount), 0);

        let structure = 'developing';
        if (!uniquePairs.length) {
            structure = 'unavailable';
        } else if (aggregateLiquidityUsd < 25_000 || priceSpreadPct > 5) {
            structure = 'fragile';
        } else if (
            aggregateLiquidityUsd >= 250_000
            && venues.size >= 2
            && (priceSpreadPct === null || priceSpreadPct <= 1)
            && (deepestPoolSharePct === null || deepestPoolSharePct <= 85)
        ) {
            structure = 'robust';
        } else if (priceSpreadPct > 2 || deepestPoolSharePct > 90 || aggregateLiquidityUsd < 100_000) {
            structure = 'mixed';
        }

        const observations = [];
        if (aggregateLiquidityUsd < 25_000) observations.push('thin aggregate liquidity');
        if (priceSpreadPct !== null && priceSpreadPct > 2) observations.push(`${priceSpreadPct.toFixed(2)}% liquid-pool price dispersion`);
        if (deepestPoolSharePct !== null && deepestPoolSharePct > 90 && uniquePairs.length > 1) observations.push(`${deepestPoolSharePct.toFixed(0)}% of liquidity in one pool`);
        if (transactionsH1 < 20) observations.push('limited one-hour transaction sample');
        if (transactionsH1 >= 20 && buysH1 / transactionsH1 < 0.3) observations.push(`${((sellsH1 / transactionsH1) * 100).toFixed(0)}% sell-side one-hour transaction flow`);
        if (transactionsH1 >= 20 && buysH1 / transactionsH1 > 0.7) observations.push(`${((buysH1 / transactionsH1) * 100).toFixed(0)}% buy-side one-hour transaction flow`);
        if (aggregateLiquidityUsd > 0 && aggregateVolumeH24 / aggregateLiquidityUsd > 5) observations.push('high 24-hour volume relative to liquidity');
        if (!observations.length) observations.push('no major market-structure warning in the sampled pools');

        return {
            poolCount: uniquePairs.length,
            venueCount: venues.size,
            aggregateLiquidityUsd,
            aggregateVolumeH24,
            turnoverH24: aggregateLiquidityUsd > 0 ? aggregateVolumeH24 / aggregateLiquidityUsd : null,
            buysH1,
            sellsH1,
            transactionsH1,
            buySharePct: transactionsH1 > 0 ? (buysH1 / transactionsH1) * 100 : null,
            deepestLiquidityUsd,
            deepestPoolSharePct,
            comparablePoolCount: comparablePrices.length,
            minimumPriceUsd,
            maximumPriceUsd,
            priceSpreadPct,
            activeBoosts,
            promotionAvailable,
            paidOrders,
            paidOrderTypes,
            purchasedBoostAmount,
            boostPurchaseCount: promotion.boosts.length,
            structure,
            observations,
        };
    }

    root.AlphaCityMarketIntegrity = Object.freeze({
        dedupePairs,
        normalizePromotionData,
        summarizeMarketIntegrity,
        tokenKey,
        tokenPriceUsd,
    });
})(typeof window !== 'undefined' ? window : globalThis);
