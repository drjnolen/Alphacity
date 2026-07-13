(function (root) {
    'use strict';

    function finitePositive(value, label) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
        return parsed;
    }

    function estimatePoolImpact(tradeUsd, liquidityUsd) {
        const trade = finitePositive(tradeUsd, 'Trade size');
        const liquidity = finitePositive(liquidityUsd, 'Pool liquidity');
        const oneSidedReserve = liquidity / 2;
        return (trade / (oneSidedReserve + trade)) * 100;
    }

    function maxTradeForImpact(liquidityUsd, impactPct) {
        const liquidity = finitePositive(liquidityUsd, 'Pool liquidity');
        const impact = finitePositive(impactPct, 'Impact budget');
        if (impact >= 100) throw new Error('Impact budget must be below 100%.');
        const ratio = impact / 100;
        return (liquidity / 2) * ratio / (1 - ratio);
    }

    function median(values) {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return null;
        const midpoint = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
    }

    function analyzeExecution(pairs, { tradeUsd, impactBudgetPct }) {
        const trade = finitePositive(tradeUsd, 'Trade size');
        const budget = finitePositive(impactBudgetPct, 'Impact budget');
        if (budget >= 100) throw new Error('Impact budget must be below 100%.');

        const ranked = (Array.isArray(pairs) ? pairs : [])
            .filter(pair => Number(pair?.liquidity?.usd) > 0 && Number(pair?.priceUsd) > 0)
            .sort((a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
        if (!ranked.length) throw new Error('No liquid SUI pools were found for that token.');

        const bestPool = ranked[0];
        const liquidityUsd = Number(bestPool.liquidity.usd);
        const prices = ranked.map(pair => Number(pair.priceUsd)).filter(Number.isFinite);
        const medianPrice = median(prices);
        const priceSpreadPct = medianPrice && prices.length > 1
            ? ((Math.max(...prices) - Math.min(...prices)) / medianPrice) * 100
            : 0;
        const buys = Number(bestPool.txns?.h1?.buys || 0);
        const sells = Number(bestPool.txns?.h1?.sells || 0);
        const transactions = buys + sells;
        const buySharePct = transactions ? (buys / transactions) * 100 : null;

        return {
            bestPool,
            ranked,
            tradeUsd: trade,
            impactBudgetPct: budget,
            impactPct: estimatePoolImpact(trade, liquidityUsd),
            maxTradeUsd: maxTradeForImpact(liquidityUsd, budget),
            priceSpreadPct,
            buySharePct,
            sellSharePct: buySharePct === null ? null : 100 - buySharePct,
            transactionsH1: transactions,
            volumeLiquidityRatio: Number(bestPool.volume?.h24 || 0) / liquidityUsd,
        };
    }

    function buildPositionPlan({ accountUsd, riskPct, direction, entry, stop, target }) {
        const account = finitePositive(accountUsd, 'Account size');
        const risk = finitePositive(riskPct, 'Risk percentage');
        if (risk > 100) throw new Error('Risk percentage cannot exceed 100%.');
        const entryPrice = finitePositive(entry, 'Entry price');
        const stopPrice = finitePositive(stop, 'Stop price');
        const targetPrice = finitePositive(target, 'Target price');
        const side = String(direction || '').toLowerCase();
        if (!['long', 'short'].includes(side)) throw new Error('Choose long or short direction.');
        if (side === 'long' && stopPrice >= entryPrice) throw new Error('A long stop must be below the entry price.');
        if (side === 'long' && targetPrice <= entryPrice) throw new Error('A long target must be above the entry price.');
        if (side === 'short' && stopPrice <= entryPrice) throw new Error('A short stop must be above the entry price.');
        if (side === 'short' && targetPrice >= entryPrice) throw new Error('A short target must be below the entry price.');

        const riskBudgetUsd = account * risk / 100;
        const stopDistance = Math.abs(entryPrice - stopPrice);
        const rewardDistance = Math.abs(targetPrice - entryPrice);
        const units = riskBudgetUsd / stopDistance;
        const notionalUsd = units * entryPrice;

        return {
            accountUsd: account,
            riskPct: risk,
            direction: side,
            entry: entryPrice,
            stop: stopPrice,
            target: targetPrice,
            riskBudgetUsd,
            stopDistancePct: (stopDistance / entryPrice) * 100,
            units,
            notionalUsd,
            rewardRisk: rewardDistance / stopDistance,
            capitalMultiple: notionalUsd / account,
        };
    }

    root.AlphaCityTradeTools = Object.freeze({
        analyzeExecution,
        buildPositionPlan,
        estimatePoolImpact,
        maxTradeForImpact,
    });
})(typeof window !== 'undefined' ? window : globalThis);
