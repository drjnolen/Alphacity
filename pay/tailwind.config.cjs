const base = require('../tailwind.config.cjs');

module.exports = {
    ...base,
    content: [
        './pay/index.html',
        './pay/request/index.html',
        './shared/wallet-connector.js',
    ],
};
