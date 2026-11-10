(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AlphaCityTokenSafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function coinKey(value) {
        const match = /^(?:0x)?([a-fA-F0-9]{1,64})::([a-zA-Z_][a-zA-Z0-9_]*)::([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(String(value || '').trim());
        if (!match) return '';
        // Sui addresses are case-insensitive; Move module/type identifiers are not.
        return '0x' + (match[1].toLowerCase().replace(/^0+/, '') || '0') + '::' + match[2] + '::' + match[3];
    }

    function finiteNumber(value) {
        if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }

    function capability(field, providerState = 'available') {
        if (providerState !== 'available') return { state: providerState, owner: '' };
        const value = field?.value;
        const owner = typeof field?.cap_owner === 'string' ? field.cap_owner.trim() : '';
        if (!['0', '1', '2', 0, 1, 2].includes(value)) return { state: 'unknown', owner };
        // GoPlus Sui documents both 1 and 2 as available. Missing owners do not revoke a capability.
        if (String(value) === '0' || owner.toLowerCase() === 'immutable') return { state: 'inactive', owner };
        return { state: 'active', owner };
    }

    function securityRecord(payload, coinType) {
        if (!payload || payload.code !== 1 || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
            return { state: 'unavailable', data: null };
        }
        const key = coinKey(coinType);
        const match = key && Object.keys(payload.result).find(candidate => coinKey(candidate) === key);
        const data = match ? payload.result[match] : null;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { state: 'unsupported', data: null };
        return { state: 'available', data };
    }

    function marketRecord(payload, coinType) {
        if (!payload || !(Array.isArray(payload.pairs) || payload.pairs === null)) return { state: 'unavailable', pair: null };
        const key = coinKey(coinType);
        const pairs = (payload.pairs || []).filter(pair =>
            pair?.chainId === 'sui' && key &&
            [pair.baseToken?.address, pair.quoteToken?.address].some(address => coinKey(address) === key)
        ).sort((a, b) => (finiteNumber(b.liquidity?.usd) ?? -1) - (finiteNumber(a.liquidity?.usd) ?? -1));
        return { state: pairs.length ? 'available' : 'unsupported', pair: pairs[0] || null };
    }

    function assess({ security = { state: 'unavailable', data: null }, market = { state: 'unavailable', pair: null } } = {}) {
        const data = security.data || {};
        const checks = [];
        for (const [key, label] of [['mintable', 'Mint authority'], ['blacklist', 'Transfer restrictions'], ['contract_upgradeable', 'Contract upgrades']]) {
            const cap = capability(data[key], security.state);
            let text;
            if (cap.state === 'active') text = label + ': capability reported active' + (cap.owner ? ' (' + cap.owner + ')' : '; owner not reported') + '.';
            else if (cap.state === 'inactive') text = label + ': provider reports capability unavailable' + (cap.owner.toLowerCase() === 'immutable' ? ' (immutable)' : '') + '.';
            else if (cap.state === 'unavailable') text = label + ': source unavailable; could not check.';
            else if (cap.state === 'unsupported') text = label + ': no provider coverage for this coin type.';
            else text = label + ': unknown; the provider did not return a recognized value.';
            checks.push({ key, state: cap.state, risk: cap.state === 'active', text });
        }
        const liquidity = finiteNumber(market.pair?.liquidity?.usd);
        checks.push({
            key: 'liquidity',
            state: liquidity !== null ? 'reported' : market.state === 'available' ? 'unknown' : market.state,
            risk: liquidity !== null && liquidity < 10000,
            text: liquidity !== null ? 'Largest indexed pool liquidity: $' + liquidity.toLocaleString('en-US', { maximumFractionDigits: 0 }) +
                (liquidity < 10000 ? '; shallow liquidity.' : '. This is not total liquidity across all pools.') :
                market.state === 'unavailable' ? 'Liquidity source unavailable; could not check.' : 'Liquidity unknown; no matching pool data was returned. This does not establish that the token is untradable.',
        });
        const rawHolders = Array.isArray(data.holders) ? data.holders : [];
        const holders = rawHolders.slice(0, 10).map(holder => {
            const share = finiteNumber(holder?.percent);
            if (!/^0x[a-fA-F0-9]{1,64}$/.test(holder?.address || '') || share === null || share > 1) return null;
            return { address: holder.address, percent: share * 100, tag: typeof holder.tag === 'string' ? holder.tag.slice(0, 80) : '' };
        }).filter(Boolean).sort((a, b) => b.percent - a.percent);
        const totalShare = holders.reduce((sum, holder) => sum + holder.percent, 0);
        const holdersKnown = holders.length > 0 && holders.length === Math.min(rawHolders.length, 10) && totalShare <= 100.01;
        const topThree = holders.slice(0, 3).reduce((sum, holder) => sum + holder.percent, 0);
        checks.push({
            key: 'holders', state: holdersKnown ? 'reported' : security.state === 'available' ? 'unknown' : security.state,
            risk: holdersKnown && topThree > 50,
            text: holdersKnown ? 'Largest ' + Math.min(3, holders.length) + ' reported holders: ' + topThree.toFixed(1) + '% of supply. Addresses may include pools or custodians.' :
                'Holder concentration unknown; complete, valid distribution data was not returned.',
        });
        const known = checks.filter(check => ['active', 'inactive', 'reported'].includes(check.state)).length;
        return {
            checks, known, total: checks.length, riskCount: checks.filter(check => check.risk).length,
            liquidity, holders: holdersKnown ? holders : [], holderShare: holdersKnown ? totalShare : null,
            supply: finiteNumber(data.total_supply),
        };
    }
    return { coinKey, finiteNumber, capability, securityRecord, marketRecord, assess };
});
