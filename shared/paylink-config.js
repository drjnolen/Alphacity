(function (root) {
    'use strict';

    const config = {
        version: 1,
        network: 'mainnet',
        registryName: 'default-payment-registry',
        registryId: '0x0481b22fd3c73f3176db4c20419e1d09c6a3074aeed65acdc776f7359285ffd2',
        paymentKitPackageId: '0xbc126f1535fba7d641cb9150ad9eae93b104972586ba20f3c60bfe0e53b69bc6',
        explorerTransactionBaseUrl: 'https://suiscan.xyz/mainnet/tx/',
        slushPaymentBaseUrl: 'https://my.slush.app/pay',
        payerRequestBaseUrl: 'https://alphacity.tech/pay/request/',
        graphqlUrls: [
            'https://graphql.mainnet.sui.io/graphql',
            'https://sui-mainnet.mystenlabs.com/graphql',
        ],
        pollIntervalMs: 60_000,
        maxAutomaticChecks: 20,
        maxConcurrentChecks: 3,
        maxStoredInvoices: 500,
        tokenPresets: [
            {
                symbol: 'USDC',
                name: 'USD Coin',
                coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
                decimals: 6,
                tone: 'blue',
            },
            {
                symbol: 'SUI',
                name: 'Sui',
                coinType: '0x2::sui::SUI',
                decimals: 9,
                tone: 'cyan',
            },
            {
                symbol: 'CITY',
                name: 'Alpha City',
                coinType: '0x308fa16c7aead43e3a49a4ff2e76205ba2a12697234f4fe80a2da66515284060::city::CITY',
                decimals: 9,
                tone: 'amber',
            },
        ],
    };

    config.tokenPresets.forEach(Object.freeze);
    Object.freeze(config.tokenPresets);
    Object.freeze(config.graphqlUrls);
    root.AlphaCityPaylinkConfig = Object.freeze(config);
})(typeof window !== 'undefined' ? window : globalThis);
