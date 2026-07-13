(function (root) {
    'use strict';

    const ALERT_TYPES = Object.freeze({
        price_above: Object.freeze({ metric: 'priceUsd', operator: 'gte', label: 'Price above', unit: 'USD' }),
        price_below: Object.freeze({ metric: 'priceUsd', operator: 'lte', label: 'Price below', unit: 'USD' }),
        liquidity_below: Object.freeze({ metric: 'liquidityUsd', operator: 'lte', label: 'Liquidity below', unit: 'USD' }),
        change_1h_up: Object.freeze({ metric: 'changeH1', operator: 'gte', label: '1h gain above', unit: '%' }),
        change_1h_down: Object.freeze({ metric: 'changeH1', operator: 'lte-negative', label: '1h drop below', unit: '%' }),
    });

    function finiteNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function canonicalSuiPackage(value) {
        const packagePart = String(value || '').trim().toLowerCase().split('::')[0];
        const hex = packagePart.replace(/^0x/, '');
        if (!hex || !/^[0-9a-f]+$/.test(hex)) return '';
        return `0x${hex.replace(/^0+/, '') || '0'}`;
    }

    function normalizeSuiTokenId(value) {
        const token = String(value || '').trim().toLowerCase();
        if (!token) return '';
        const parts = token.split('::');
        const packageId = canonicalSuiPackage(parts[0]);
        if (!packageId) return token;
        if (parts.length >= 3 && parts[1] && parts[2]) {
            return `${packageId}::${parts[1]}::${parts.slice(2).join('::')}`;
        }
        return packageId;
    }

    function tokenMatchesPairAddress(watchedToken, pairToken) {
        const watched = normalizeSuiTokenId(watchedToken);
        const candidate = normalizeSuiTokenId(pairToken);
        if (!watched || !candidate) return false;
        if (watched === candidate) return true;

        const watchedIsType = watched.includes('::');
        const candidateIsType = candidate.includes('::');
        if (watchedIsType && candidateIsType) return false;

        const watchedPackage = canonicalSuiPackage(watched);
        const candidatePackage = canonicalSuiPackage(candidate);
        return Boolean(watchedPackage && candidatePackage && watchedPackage === candidatePackage);
    }

    function createRule({ id, token, type, threshold, now = Date.now() }) {
        const normalizedToken = String(token || '').trim();
        const normalizedType = String(type || '');
        const normalizedThreshold = finiteNumber(threshold);
        if (!normalizedToken) throw new Error('Choose a token for this alert.');
        if (!ALERT_TYPES[normalizedType]) throw new Error('Choose a supported alert type.');
        if (normalizedThreshold === null || normalizedThreshold <= 0) {
            throw new Error('Enter a threshold greater than zero.');
        }
        return {
            id: String(id || `${now}-${Math.random().toString(36).slice(2, 9)}`),
            token: normalizedToken,
            type: normalizedType,
            threshold: normalizedThreshold,
            createdAt: Number(now),
            lastCheckedAt: null,
            lastTriggeredAt: null,
            currentValue: null,
            isTriggered: false,
        };
    }

    function evaluateRule(rule, snapshot) {
        const definition = ALERT_TYPES[rule?.type];
        if (!definition || !snapshot) return { evaluable: false, matches: false, value: null };
        const value = finiteNumber(snapshot[definition.metric]);
        const threshold = finiteNumber(rule.threshold);
        if (value === null || threshold === null) return { evaluable: false, matches: false, value };

        let matches = false;
        if (definition.operator === 'gte') matches = value >= threshold;
        if (definition.operator === 'lte') matches = value <= threshold;
        if (definition.operator === 'lte-negative') matches = value <= -Math.abs(threshold);
        return { evaluable: true, matches, value };
    }

    function evaluateRules(rules, snapshots, now = Date.now()) {
        const triggered = [];
        const updatedRules = (Array.isArray(rules) ? rules : []).map(rule => {
            const evaluation = evaluateRule(rule, snapshots?.[rule.token]);
            if (!evaluation.evaluable) return { ...rule, lastCheckedAt: Number(now) };

            const crossed = evaluation.matches && !rule.isTriggered;
            const updated = {
                ...rule,
                currentValue: evaluation.value,
                isTriggered: evaluation.matches,
                lastCheckedAt: Number(now),
                lastTriggeredAt: crossed ? Number(now) : (rule.lastTriggeredAt || null),
            };
            if (crossed) triggered.push(updated);
            return updated;
        });
        return { rules: updatedRules, triggered };
    }

    function definitionFor(type) {
        return ALERT_TYPES[type] || null;
    }

    root.AlphaCityTradeAlerts = Object.freeze({
        ALERT_TYPES,
        createRule,
        definitionFor,
        evaluateRule,
        evaluateRules,
        finiteNumber,
        normalizeSuiTokenId,
        tokenMatchesPairAddress,
    });
})(typeof window !== 'undefined' ? window : globalThis);
