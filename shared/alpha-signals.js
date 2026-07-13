(function (root) {
    'use strict';

    const HOUR_MS = 60 * 60 * 1000;

    function number(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function median(values) {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return null;
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function tokenKey(pair) {
        return String(pair?.baseToken?.address || pair?.pairAddress || '').trim().toLowerCase();
    }

    function pairMetrics(pair, now = Date.now()) {
        const liquidityUsd = number(pair?.liquidity?.usd);
        const volumeH1 = number(pair?.volume?.h1);
        const volumeH24 = number(pair?.volume?.h24);
        const buysH1 = number(pair?.txns?.h1?.buys);
        const sellsH1 = number(pair?.txns?.h1?.sells);
        const transactionsH1 = buysH1 + sellsH1;
        const buySharePct = transactionsH1 ? (buysH1 / transactionsH1) * 100 : null;
        const fdvUsd = number(pair?.fdv || pair?.marketCap);
        const createdAt = number(pair?.pairCreatedAt);
        return {
            liquidityUsd,
            volumeH1,
            volumeH24,
            changeH1: number(pair?.priceChange?.h1),
            changeH6: number(pair?.priceChange?.h6),
            changeH24: number(pair?.priceChange?.h24),
            buysH1,
            sellsH1,
            transactionsH1,
            buySharePct,
            sellSharePct: buySharePct === null ? null : 100 - buySharePct,
            volumeVelocity: volumeH1 / Math.max(volumeH24 / 24, 1),
            turnoverH24: volumeH24 / Math.max(liquidityUsd, 1),
            liquidityToFdvPct: fdvUsd > 0 ? (liquidityUsd / fdvUsd) * 100 : null,
            ageHours: createdAt > 0 ? Math.max(0, (now - createdAt) / HOUR_MS) : null,
        };
    }

    function signalForPair(pair, now = Date.now()) {
        const metrics = pairMetrics(pair, now);
        const reasons = [];
        const risks = [];
        let score = 0;

        const liquidityLog = Math.log10(Math.max(metrics.liquidityUsd, 1));
        score += clamp((liquidityLog - 4) / 3, 0, 1) * 25;
        score += clamp((metrics.volumeVelocity - 0.5) / 3.5, 0, 1) * 20;
        score += clamp(metrics.transactionsH1 / 100, 0, 1) * 10;
        if (metrics.buySharePct !== null) score += clamp((metrics.buySharePct - 45) / 25, 0, 1) * 15;

        const h1IsSane = Math.abs(metrics.changeH1) <= 50;
        const h24IsSane = Math.abs(metrics.changeH24) <= 300;
        if (h1IsSane && metrics.changeH1 > 0) score += clamp(metrics.changeH1 / 10, 0, 1) * 15;
        if (h24IsSane && metrics.changeH24 > 0) score += clamp(metrics.changeH24 / 25, 0, 1) * 10;
        if (metrics.liquidityToFdvPct === null) score += 2;
        else if (metrics.liquidityToFdvPct >= 5) score += 5;
        else if (metrics.liquidityToFdvPct >= 1) score += 2.5;
        if (metrics.ageHours !== null && metrics.ageHours >= 24) score += 5;
        else if (metrics.ageHours !== null && metrics.ageHours >= 6) score += 2;

        if (metrics.liquidityUsd < 25000) {
            score -= 15;
            risks.push('shallow liquidity');
        } else if (metrics.liquidityUsd >= 250000) reasons.push('deep liquidity');
        if (metrics.transactionsH1 < 5) {
            score -= 8;
            risks.push('thin 1h activity');
        }
        if (!h1IsSane || Math.abs(metrics.changeH1) > 25) {
            score -= 10;
            risks.push('extended 1h move');
        }
        if (!h24IsSane) {
            score -= 25;
            risks.push('anomalous 24h change');
        }
        if (metrics.sellSharePct !== null && metrics.sellSharePct >= 70) {
            score -= 10;
            risks.push('sell-heavy transactions');
        }
        if (metrics.ageHours !== null && metrics.ageHours < 2) {
            score -= 10;
            risks.push('under 2h old');
        }

        if (metrics.volumeVelocity >= 2) reasons.push(`${metrics.volumeVelocity.toFixed(1)}× hourly volume velocity`);
        if (metrics.buySharePct !== null && metrics.buySharePct >= 60) reasons.push(`${metrics.buySharePct.toFixed(0)}% buy transactions`);
        if (h1IsSane && metrics.changeH1 >= 1 && metrics.changeH1 <= 20) reasons.push(`+${metrics.changeH1.toFixed(1)}% 1h momentum`);

        const normalizedScore = Math.round(clamp(score, 0, 100));
        const tier = normalizedScore >= 70 ? 'strong' : normalizedScore >= 55 ? 'watch' : normalizedScore >= 40 ? 'neutral' : 'weak';
        return { pair, metrics, score: normalizedScore, tier, reasons: reasons.slice(0, 3), risks: risks.slice(0, 3) };
    }

    function dedupeDeepestPairs(pairs) {
        const deepest = new Map();
        for (const pair of Array.isArray(pairs) ? pairs : []) {
            const key = tokenKey(pair);
            if (!key) continue;
            const existing = deepest.get(key);
            if (!existing || number(pair?.liquidity?.usd) > number(existing?.liquidity?.usd)) deepest.set(key, pair);
        }
        return [...deepest.values()];
    }

    function rankSignals(pairs, { now = Date.now(), minLiquidityUsd = 25000, limit = 20 } = {}) {
        return dedupeDeepestPairs(pairs)
            .map(pair => signalForPair(pair, now))
            .filter(signal => signal.metrics.liquidityUsd >= minLiquidityUsd)
            .sort((a, b) => b.score - a.score || b.metrics.volumeH24 - a.metrics.volumeH24)
            .slice(0, limit);
    }

    function marketRegime(pairs, { now = Date.now(), minLiquidityUsd = 10000 } = {}) {
        const signals = dedupeDeepestPairs(pairs)
            .map(pair => signalForPair(pair, now))
            .filter(signal => signal.metrics.liquidityUsd >= minLiquidityUsd && Math.abs(signal.metrics.changeH1) <= 50);
        const directional = signals.filter(signal => signal.metrics.changeH1 !== 0);
        const advancers = directional.filter(signal => signal.metrics.changeH1 > 0).length;
        const breadthPct = directional.length ? (advancers / directional.length) * 100 : null;
        const buys = signals.reduce((sum, signal) => sum + signal.metrics.buysH1, 0);
        const sells = signals.reduce((sum, signal) => sum + signal.metrics.sellsH1, 0);
        const buySharePct = buys + sells ? (buys / (buys + sells)) * 100 : null;
        const medianChangeH1 = median(signals.map(signal => signal.metrics.changeH1));
        const medianVolumeVelocity = median(signals.map(signal => signal.metrics.volumeVelocity));

        let regime = 'mixed';
        if (breadthPct !== null && buySharePct !== null && breadthPct >= 60 && buySharePct >= 52 && medianChangeH1 > 0) regime = 'risk-on';
        else if (breadthPct !== null && buySharePct !== null && breadthPct <= 35 && buySharePct <= 52 && medianChangeH1 < 0) regime = 'risk-off';
        else if (medianVolumeVelocity >= 1.5) regime = 'rotation';

        return { regime, breadthPct, buySharePct, medianChangeH1, medianVolumeVelocity, sampleSize: signals.length };
    }

    function launchQuality(pair, now = Date.now()) {
        const metrics = pairMetrics(pair, now);
        const risks = [];
        let score = 0;
        score += clamp((Math.log10(Math.max(metrics.liquidityUsd, 1)) - 3) / 3, 0, 1) * 35;
        score += clamp(metrics.turnoverH24 / 2, 0, 1) * 20;
        score += clamp(metrics.transactionsH1 / 100, 0, 1) * 15;
        if (metrics.buySharePct !== null) score += clamp((metrics.buySharePct - 40) / 30, 0, 1) * 10;
        if (metrics.liquidityToFdvPct === null) score += 3;
        else if (metrics.liquidityToFdvPct >= 5) score += 15;
        else if (metrics.liquidityToFdvPct >= 1) score += 8;
        if (metrics.ageHours !== null && metrics.ageHours >= 24) score += 10;
        else if (metrics.ageHours !== null && metrics.ageHours >= 6) score += 5;

        if (metrics.liquidityUsd < 5000) risks.push('under $5K liquidity');
        if (metrics.transactionsH1 < 5) risks.push('low 1h activity');
        if (Math.abs(metrics.changeH24) > 300) {
            score -= 20;
            risks.push('anomalous price change');
        }
        if (metrics.sellSharePct !== null && metrics.sellSharePct >= 70) risks.push('sell-heavy transactions');
        const normalizedScore = Math.round(clamp(score, 0, 100));
        const grade = normalizedScore >= 75 ? 'A' : normalizedScore >= 60 ? 'B' : normalizedScore >= 45 ? 'C' : 'D';
        return { pair, metrics, score: normalizedScore, grade, risks: risks.slice(0, 3) };
    }

    function rankNewPools(pairs, { now = Date.now(), maxAgeHours = 24 * 7, minLiquidityUsd = 1000, limit = 20 } = {}) {
        return (Array.isArray(pairs) ? pairs : [])
            .filter(pair => number(pair?.pairCreatedAt) > 0)
            .map(pair => launchQuality(pair, now))
            .filter(item => item.metrics.ageHours <= maxAgeHours && item.metrics.liquidityUsd >= minLiquidityUsd)
            .sort((a, b) => b.score - a.score || a.metrics.ageHours - b.metrics.ageHours)
            .slice(0, limit);
    }

    function findDislocations(pairs, { minLiquidityUsd = 25000, minSpreadPct = 0.25, maxSpreadPct = 20, limit = 20 } = {}) {
        const groups = new Map();
        for (const pair of Array.isArray(pairs) ? pairs : []) {
            const key = tokenKey(pair);
            const price = number(pair?.priceUsd);
            const liquidity = number(pair?.liquidity?.usd);
            if (!key || price <= 0 || liquidity < minLiquidityUsd) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(pair);
        }

        const results = [];
        for (const group of groups.values()) {
            const byVenue = new Map();
            for (const pair of group) {
                const venue = String(pair?.dexId || pair?.pairAddress || '').toLowerCase();
                const existing = byVenue.get(venue);
                if (!existing || number(pair?.liquidity?.usd) > number(existing?.liquidity?.usd)) byVenue.set(venue, pair);
            }
            const venues = [...byVenue.values()].sort((a, b) => number(a.priceUsd) - number(b.priceUsd));
            if (venues.length < 2) continue;
            const lowPool = venues[0];
            const highPool = venues[venues.length - 1];
            const lowPrice = number(lowPool.priceUsd);
            const highPrice = number(highPool.priceUsd);
            const midpoint = (lowPrice + highPrice) / 2;
            const spreadPct = midpoint > 0 ? ((highPrice - lowPrice) / midpoint) * 100 : 0;
            if (spreadPct < minSpreadPct || spreadPct > maxSpreadPct) continue;
            const minimumLiquidityUsd = Math.min(number(lowPool.liquidity?.usd), number(highPool.liquidity?.usd));
            const transactionsH1 = venues.reduce((sum, pair) => sum + number(pair?.txns?.h1?.buys) + number(pair?.txns?.h1?.sells), 0);
            const confidence = minimumLiquidityUsd >= 250000 && transactionsH1 >= 20 && spreadPct <= 5
                ? 'high'
                : minimumLiquidityUsd >= 50000 && transactionsH1 >= 5 ? 'medium' : 'low';
            results.push({
                tokenAddress: lowPool.baseToken?.address,
                symbol: lowPool.baseToken?.symbol || '?',
                lowPool,
                highPool,
                spreadPct,
                minimumLiquidityUsd,
                transactionsH1,
                confidence,
                rankValue: spreadPct * Math.log10(Math.max(minimumLiquidityUsd, 10)),
            });
        }
        return results.sort((a, b) => b.rankValue - a.rankValue).slice(0, limit);
    }

    root.AlphaCityAlphaSignals = Object.freeze({
        dedupeDeepestPairs,
        findDislocations,
        launchQuality,
        marketRegime,
        pairMetrics,
        rankNewPools,
        rankSignals,
        signalForPair,
    });
})(typeof window !== 'undefined' ? window : globalThis);
