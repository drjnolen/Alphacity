(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AlphaCityPredictArcade = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const DISTRICTS = Object.freeze([
        Object.freeze({ key: 'glass-crown', name: 'Glass Crown', zone: 'Overcity', accent: '#72a7ff' }),
        Object.freeze({ key: 'neon-court', name: 'Neon Court', zone: 'Overcity', accent: '#a78bfa' }),
        Object.freeze({ key: 'meridian', name: 'The Meridian', zone: 'Overcity', accent: '#f7d365' }),
        Object.freeze({ key: 'relay', name: 'The Relay', zone: 'Underground', accent: '#44d7b6' }),
        Object.freeze({ key: 'bazaar', name: 'The Bazaar', zone: 'Underground', accent: '#fb923c' }),
        Object.freeze({ key: 'hollows', name: 'The Hollows', zone: 'Underground', accent: '#f472b6' }),
        Object.freeze({ key: 'foundry', name: 'Iron Foundry', zone: 'Underground', accent: '#f87171' }),
        Object.freeze({ key: 'undercroft', name: 'The Undercroft', zone: 'Underground', accent: '#94a3b8' }),
        Object.freeze({ key: 'deep-ledger', name: 'Deep Ledger', zone: 'Underground', accent: '#22d3ee' }),
    ]);

    const ASSET_META = Object.freeze({
        SUI: Object.freeze({ name: 'Sui', accent: '#72a7ff', spot: 3.184, decimals: 3 }),
        BTC: Object.freeze({ name: 'Bitcoin', accent: '#f59e0b', spot: 117420, decimals: 0 }),
        DEEP: Object.freeze({ name: 'DeepBook', accent: '#a78bfa', spot: 0.1264, decimals: 4 }),
    });

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value)));
    }

    function round(value, places) {
        const factor = 10 ** places;
        return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
    }

    function makeDemoMarkets(now = Date.now()) {
        const hour = 60 * 60 * 1000;
        const day = 24 * hour;
        const seeds = [
            ['sui-quick-325', 'SUI', 3.25, 6 * hour, 0.46, 184320, 1248, 'Quick round', '6H'],
            ['sui-daily-350', 'SUI', 3.5, 30 * hour, 0.31, 428760, 2184, 'Daily signal', '1D'],
            ['sui-weekly-400', 'SUI', 4, 7 * day, 0.18, 892140, 3821, 'Weekly frontier', '7D'],
            ['btc-quick-120k', 'BTC', 120000, 18 * hour, 0.42, 724580, 2940, 'Quick round', '1D'],
            ['btc-weekly-125k', 'BTC', 125000, 5 * day, 0.27, 1128640, 4302, 'Weekly frontier', '7D'],
            ['deep-daily-014', 'DEEP', 0.14, 36 * hour, 0.34, 96780, 822, 'Protocol pulse', '1D'],
            ['deep-weekly-016', 'DEEP', 0.16, 8 * day, 0.21, 218430, 1187, 'Protocol pulse', '7D'],
        ];
        return seeds.map((seed, index) => {
            const [id, symbol, strike, offset, probabilityUp, volume, participants, theme, cadence] = seed;
            const meta = ASSET_META[symbol];
            return Object.freeze({
                id,
                symbol,
                name: meta.name,
                spot: meta.spot,
                strike,
                expiry: now + offset,
                probabilityUp,
                volume,
                participants,
                theme,
                cadence,
                accent: meta.accent,
                oracle: 'Block Scholes preview',
                settlement: 'DeepBook Predict testnet',
                featured: index === 0,
            });
        });
    }

    function marketDirectionProbability(market, direction) {
        const up = clamp(market?.probabilityUp, 0.01, 0.99);
        return String(direction).toUpperCase() === 'DOWN' ? 1 - up : up;
    }

    function quotePosition(market, direction, amount) {
        const stake = Number(amount);
        if (!Number.isFinite(stake) || stake <= 0) throw new Error('Enter a paper position greater than 0 USDC.');
        if (stake > 10000) throw new Error('Paper positions are capped at 10,000 USDC in this preview.');
        const probability = marketDirectionProbability(market, direction);
        const shares = stake / probability;
        const payout = shares;
        const profit = payout - stake;
        return Object.freeze({
            stake: round(stake, 2),
            probability: round(probability, 4),
            contractPrice: round(probability, 4),
            shares: round(shares, 2),
            payout: round(payout, 2),
            profit: round(profit, 2),
            roi: round((profit / stake) * 100, 1),
        });
    }

    function hashString(value) {
        let hash = 2166136261;
        const input = String(value || '').toLowerCase();
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function districtForAddress(address) {
        const normalized = String(address || '').trim();
        if (!normalized) return null;
        return DISTRICTS[hashString(normalized) % DISTRICTS.length];
    }

    function createPaperPosition(market, direction, amount, address, now = Date.now()) {
        if (!market?.id) throw new Error('Choose a valid market.');
        const side = String(direction || '').toUpperCase();
        if (!['UP', 'DOWN'].includes(side)) throw new Error('Choose UP or DOWN.');
        const quote = quotePosition(market, side, amount);
        const identity = String(address || 'guest');
        return Object.freeze({
            id: `paper-${now}-${hashString(`${market.id}:${side}:${identity}:${now}`).toString(16)}`,
            marketId: market.id,
            symbol: market.symbol,
            strike: market.strike,
            expiry: market.expiry,
            direction: side,
            openedAt: now,
            address: address || null,
            status: 'OPEN',
            ...quote,
        });
    }

    function filterMarkets(markets, filters = {}, now = Date.now()) {
        const asset = String(filters.asset || 'ALL').toUpperCase();
        const cadence = String(filters.cadence || 'ALL').toUpperCase();
        const search = String(filters.search || '').trim().toLowerCase();
        return (Array.isArray(markets) ? markets : []).filter((market) => {
            if (asset !== 'ALL' && market.symbol !== asset) return false;
            if (cadence !== 'ALL' && String(market.cadence).toUpperCase() !== cadence) return false;
            if (market.expiry <= now) return false;
            if (!search) return true;
            const haystack = `${market.symbol} ${market.name} ${market.strike} ${market.theme}`.toLowerCase();
            return haystack.includes(search);
        });
    }

    function countdown(expiry, now = Date.now()) {
        const remaining = Math.max(0, Number(expiry) - Number(now));
        const totalSeconds = Math.floor(remaining / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return Object.freeze({ remaining, days, hours, minutes, seconds, expired: remaining === 0 });
    }

    function formatCountdown(expiry, now = Date.now()) {
        const value = countdown(expiry, now);
        if (value.expired) return 'Settling';
        if (value.days) return `${value.days}d ${String(value.hours).padStart(2, '0')}h`;
        return `${String(value.hours).padStart(2, '0')}:${String(value.minutes).padStart(2, '0')}:${String(value.seconds).padStart(2, '0')}`;
    }

    function formatStrike(market) {
        const decimals = ASSET_META[market?.symbol]?.decimals ?? 2;
        return Number(market?.strike || 0).toLocaleString(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
    }

    function positionStorageKey(address) {
        const identity = String(address || 'guest').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 72) || 'guest';
        return `ac_predict_paper_positions_v1:${identity}`;
    }

    function missionProgress(positions) {
        const list = Array.isArray(positions) ? positions : [];
        const uniqueMarkets = new Set(list.map((position) => position.marketId));
        const suiPositions = list.filter((position) => position.symbol === 'SUI').length;
        return Object.freeze({
            firstSignal: Math.min(1, list.length),
            marketScout: Math.min(3, uniqueMarkets.size),
            suiSpecialist: Math.min(3, suiPositions),
            credits: (list.length ? 25 : 0) + Math.min(3, uniqueMarkets.size) * 15 + Math.min(3, suiPositions) * 10,
        });
    }

    function buildShareText(market, direction) {
        const side = String(direction || 'UP').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP';
        const probability = Math.round(marketDirectionProbability(market, side) * 100);
        return `My signal: ${market.symbol} ${side} ${formatStrike(market)} · market odds ${probability}% · Alpha City Predict preview`;
    }

    return Object.freeze({
        DISTRICTS,
        ASSET_META,
        clamp,
        round,
        makeDemoMarkets,
        marketDirectionProbability,
        quotePosition,
        districtForAddress,
        createPaperPosition,
        filterMarkets,
        countdown,
        formatCountdown,
        formatStrike,
        positionStorageKey,
        missionProgress,
        buildShareText,
    });
});
