(function () {
    'use strict';

    if (window.__alphaCitySuiJsonRpcBridgeInstalled) return;
    window.__alphaCitySuiJsonRpcBridgeInstalled = true;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = async function alphaCityFetchBridge(input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const body = init?.body;

        if (typeof body !== 'string' || !/fullnode\.mainnet\.sui\.io(?::443)?\/?$/i.test(url)) {
            return nativeFetch(input, init);
        }

        let request;
        try {
            request = JSON.parse(body);
        } catch (_) {
            return nativeFetch(input, init);
        }

        if (request?.jsonrpc !== '2.0' || typeof request?.method !== 'string') {
            return nativeFetch(input, init);
        }

        try {
            if (!window.AlphaCitySui?.rpc) throw new Error('SUI data client failed to load');
            const result = await window.AlphaCitySui.rpc(request.method, request.params || []);
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, result }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (error) {
            return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: request.id ?? null,
                error: { code: -32000, message: error?.message || String(error) },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    };
})();
