(function (root) {
    'use strict';

    const POSITION_TYPES = Object.freeze([
        '0x1eab533d50fc6137cfc0c03dc3d0bb201f9d5001d0a5147558d0cf3c28be558c::position::Position',
        '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::position::Position',
        '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1::position_nft::TurbosPositionNFT',
        '0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64::position_nft::TurbosPositionNFT',
    ]);

    function protocolForType(type) {
        const normalized = String(type || '').toLowerCase();
        if (normalized.includes('turbospositionnft')
            || normalized.includes('0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1')
            || normalized.includes('0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64')) return 'turbos';
        if (normalized.includes('::position::position')) return 'cetus';
        return 'sui';
    }

    function isConcentratedPositionObject(object) {
        const data = object?.data;
        const fields = data?.content?.fields || {};
        const type = String(data?.type || '').toLowerCase();
        const hasPool = Boolean(fields.pool || fields.pool_id);
        const hasPositionState = fields.liquidity !== undefined || Boolean(fields.position_id);
        const hasPair = Boolean(fields.coin_type_a && fields.coin_type_b);
        return type.includes('position') && hasPool && hasPositionState && hasPair;
    }

    function signedTick(field) {
        const bits = Number(field?.fields?.bits ?? field?.bits ?? field ?? 0);
        if (!Number.isFinite(bits)) return 0;
        return bits >= 0x80000000 ? bits - 0x100000000 : bits;
    }

    function calculateClmmAmounts(positionFields, poolFields) {
        const liquidity = Number(positionFields?.liquidity || 0);
        const sqrtPriceRaw = Number(poolFields?.current_sqrt_price || poolFields?.sqrt_price || 0);
        if (!(liquidity > 0) || !(sqrtPriceRaw > 0)) return { amountA: 0, amountB: 0 };

        const tickLower = signedTick(positionFields.tick_lower_index || positionFields.tick_lower);
        const tickUpper = signedTick(positionFields.tick_upper_index || positionFields.tick_upper);
        const sqrtLower = Math.pow(1.0001, tickLower / 2);
        const sqrtUpper = Math.pow(1.0001, tickUpper / 2);
        const sqrtCurrent = sqrtPriceRaw / Math.pow(2, 64);

        if (sqrtCurrent <= sqrtLower) {
            return { amountA: liquidity * (1 / sqrtLower - 1 / sqrtUpper), amountB: 0 };
        }
        if (sqrtCurrent >= sqrtUpper) {
            return { amountA: 0, amountB: liquidity * (sqrtUpper - sqrtLower) };
        }
        return {
            amountA: liquidity * (1 / sqrtCurrent - 1 / sqrtUpper),
            amountB: liquidity * (sqrtCurrent - sqrtLower),
        };
    }

    function formatTokenAmount(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '—';
        if (amount === 0) return '0';
        const absolute = Math.abs(amount);
        if (absolute >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
        if (absolute >= 1) return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
        if (absolute >= 0.0001) return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
        return '<0.0001';
    }

    function positionUrl({ protocol, positionId, poolId }) {
        if (!positionId && !poolId) return null;
        if (protocol === 'turbos' && positionId) {
            return `https://app.turbos.finance/#/pools/${encodeURIComponent(positionId)}/position`;
        }
        if (protocol === 'cetus' && positionId) {
            return `https://app.cetus.zone/position-detail/${encodeURIComponent(positionId)}`;
        }
        return null;
    }

    root.AlphaCityLpTools = Object.freeze({
        POSITION_TYPES,
        calculateClmmAmounts,
        formatTokenAmount,
        isConcentratedPositionObject,
        positionUrl,
        protocolForType,
        signedTick,
    });
})(typeof window !== 'undefined' ? window : globalThis);
