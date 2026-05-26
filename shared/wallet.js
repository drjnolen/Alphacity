/**
 * Alpha City — Shared Wallet Connector
 * Provides a reusable wallet connection system for Sui wallets.
 *
 * Usage:
 *   const wallet = new AlphaCity.WalletConnector({
 *       connectBtn: document.getElementById('connect-btn'),
 *       walletLabel: document.getElementById('wallet-label'),
 *       onConnect: function(address, entry) { ... },
 *       onDisconnect: function() { ... },
 *       storageKey: 'alphacity_wallet'
 *   });
 *   wallet.init();
 */

/* global window, document */

window.AlphaCity = window.AlphaCity || {};

(function (AC) {
    'use strict';

    var STORAGE_KEY = 'alphacity_wallet';
    var SUI_MAINNET_RPC = 'https://fullnode.mainnet.sui.io:443';
    var WALLET_DISCOVERY_DELAYS = [600, 1200];
    var RECONNECT_DELAY = 400;
    var TRANSACTION_TIMEOUT = 60000; // 60 seconds

    // ================================================================
    // WALLET STANDARD INITIALIZATION
    // ================================================================

    function initWalletStandard() {
        if (typeof window.global === 'undefined') window.global = window;
    }

    // ================================================================
    // WALLET DISCOVERY
    // ================================================================

    function discoverWallets() {
        var wallets = [];

        // Wallet Standard API
        if (window.navigator?.wallets) {
            try {
                var registered = [];
                window.navigator.wallets.get().forEach(function (w) { registered.push(w); });
                registered.forEach(function (wallet) {
                    if (wallet.features && wallet.features['standard:connect']) {
                        wallets.push({ name: wallet.name, source: 'standard', wallet: wallet });
                    }
                });
            } catch (e) {
                console.warn('[AlphaCity:wallet] Wallet Standard discovery error:', e);
            }
        }

        // Legacy providers
        var legacyProviders = [
            { key: 'slush', name: 'Slush' },
            { key: 'suiWallet', name: 'Sui Wallet' },
            { key: 'martian', name: 'Martian' },
            { key: 'ethos', name: 'Ethos' },
            { key: 'nightly', name: 'Nightly' }
        ];
        legacyProviders.forEach(function (lp) {
            var provider = window[lp.key];
            if (provider && typeof provider === 'object') {
                var already = wallets.some(function (w) { return w.name.toLowerCase() === lp.name.toLowerCase(); });
                if (!already) {
                    wallets.push({ name: lp.name, source: 'legacy', provider: provider });
                }
            }
        });

        return wallets;
    }

    // ================================================================
    // RPC HELPERS
    // ================================================================

    function fetchSuiBalance(address) {
        return AC.withTimeout(
            fetch(SUI_MAINNET_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getBalance', params: [address, '0x2::sui::SUI'] })
            }).then(function (r) { return r.json(); })
              .then(function (data) { return data?.result?.totalBalance || '0'; }),
            15000,
            'Balance fetch'
        ).catch(function (e) {
            console.warn('[AlphaCity:wallet] Balance fetch failed:', e);
            return null;
        });
    }

    // ================================================================
    // OVERLAY HELPERS
    // ================================================================

    function makeOverlay() {
        var overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        return overlay;
    }

    // ================================================================
    // WALLET CONNECTOR CLASS
    // ================================================================

    /**
     * @constructor
     * @param {Object} opts - Configuration.
     * @param {HTMLElement} opts.connectBtn - The connect wallet button element.
     * @param {HTMLElement} opts.walletLabel - Element to show wallet address/status.
     * @param {Function} [opts.onConnect] - Callback after successful connection (address, entry).
     * @param {Function} [opts.onDisconnect] - Callback after disconnection.
     * @param {string} [opts.storageKey] - localStorage key (default: 'alphacity_wallet').
     */
    function WalletConnector(opts) {
        this.connectBtn = opts.connectBtn;
        this.walletLabel = opts.walletLabel;
        this.onConnect = opts.onConnect || function () {};
        this.onDisconnect = opts.onDisconnect || function () {};
        this.storageKey = opts.storageKey || STORAGE_KEY;

        this.connectedAddress = null;
        this.connectedAccount = null;
        this.connectedWalletEntry = null;
        this.suiBalance = null;
    }

    WalletConnector.prototype.init = function () {
        var self = this;
        initWalletStandard();

        this.connectBtn.addEventListener('click', function () {
            if (self.connectedAddress) {
                self.showWalletOptions();
            } else {
                self.connect().catch(function (e) {
                    AC.toast('Wallet connection failed: ' + (e?.message || e), 'error');
                });
            }
        });

        this.tryAutoReconnect();
    };

    WalletConnector.prototype.connect = async function () {
        var wallets = discoverWallets();

        for (var i = 0; i < WALLET_DISCOVERY_DELAYS.length && !wallets.length; i++) {
            await new Promise(function (r) { setTimeout(r, WALLET_DISCOVERY_DELAYS[i]); });
            wallets = discoverWallets();
        }

        if (!wallets.length) {
            throw new Error('No Sui wallet found. Please install a Sui wallet extension (Slush, Sui Wallet, etc.).');
        }

        var entry = wallets.length === 1 ? wallets[0] : await this.pickWallet(wallets);
        if (!entry) return;

        this.walletLabel.textContent = 'Connecting…';
        this.connectBtn.disabled = true;

        try {
            var accounts = await this._getAccounts(entry, false);
            var suiAccounts = accounts.filter(function (a) { return !a.chains || a.chains.includes('sui:mainnet'); });
            var all = suiAccounts.length ? suiAccounts : accounts;
            if (!all.length) throw new Error('Wallet provided no accounts.');

            var account = all.length === 1 ? all[0] : await this.pickAccount(all);
            var address = String(account?.address || account || '').trim();
            if (!AC.isValidSuiAddress(address)) throw new Error('Wallet did not provide a valid Sui address.');

            this.connectedAddress = address;
            this.connectedAccount = account;
            this.connectedWalletEntry = entry;
            this.suiBalance = await fetchSuiBalance(address);

            this.walletLabel.textContent = AC.shortAddr(address);
            this.connectBtn.classList.remove('bg-brand-primary', 'hover:bg-brand-primary-hover');
            this.connectBtn.classList.add('bg-green-600', 'hover:bg-green-500');

            AC.storageSet(this.storageKey, { walletName: entry.name, address: address });
            this.onConnect(address, entry);
        } finally {
            this.connectBtn.disabled = false;
            if (!this.connectedAddress) this.walletLabel.textContent = 'Connect Wallet';
        }
    };

    WalletConnector.prototype._getAccounts = async function (entry, silent) {
        if (entry.source === 'standard') {
            if (!silent) {
                try {
                    var disc = entry.wallet.features?.['standard:disconnect'];
                    if (disc?.disconnect) await disc.disconnect();
                } catch (e) { console.warn('[AlphaCity:wallet] Pre-connect disconnect failed:', e); }
            }
            var connectOpts = silent ? { silent: true } : undefined;
            var r = await entry.wallet.features['standard:connect'].connect(connectOpts);
            return r?.accounts || entry.wallet.accounts || [];
        } else {
            var p = entry.provider;
            if (typeof p.connect === 'function') await p.connect();
            var addrs = [];
            if (typeof p.getAccounts === 'function') {
                var ac = await p.getAccounts();
                addrs = (ac || []).map(function (a) { return a?.address || a; }).filter(Boolean);
            }
            if (!addrs.length && Array.isArray(p.accounts)) {
                addrs = p.accounts.map(function (a) { return a?.address || a; }).filter(Boolean);
            }
            if (!addrs.length && typeof p.account === 'string') addrs = [p.account];
            return addrs.map(function (addr) { return { address: addr }; });
        }
    };

    WalletConnector.prototype.disconnect = async function () {
        if (this.connectedWalletEntry?.source === 'standard') {
            try {
                var disc = this.connectedWalletEntry.wallet.features?.['standard:disconnect'];
                if (disc?.disconnect) await disc.disconnect();
            } catch (e) { console.warn('[AlphaCity:wallet] Standard disconnect failed:', e); }
        } else if (this.connectedWalletEntry?.source === 'legacy') {
            try {
                if (typeof this.connectedWalletEntry.provider?.disconnect === 'function') {
                    await this.connectedWalletEntry.provider.disconnect();
                }
            } catch (e) { console.warn('[AlphaCity:wallet] Legacy disconnect failed:', e); }
        }

        this.connectedAddress = null;
        this.connectedAccount = null;
        this.connectedWalletEntry = null;
        this.suiBalance = null;

        AC.storageRemove(this.storageKey);
        this.walletLabel.textContent = 'Connect Wallet';
        this.connectBtn.classList.remove('bg-green-600', 'hover:bg-green-500');
        this.connectBtn.classList.add('bg-brand-primary', 'hover:bg-brand-primary-hover');
        this.onDisconnect();
    };

    WalletConnector.prototype.tryAutoReconnect = async function () {
        try {
            var saved = AC.storageGet(this.storageKey);
            if (!saved?.walletName || !AC.isValidSuiAddress(saved.address)) return;

            await new Promise(function (r) { setTimeout(r, RECONNECT_DELAY); });

            var wallets = discoverWallets();
            var entry = wallets.find(function (w) { return w.name === saved.walletName; });
            if (!entry) return;

            this.walletLabel.textContent = 'Connecting…';

            var accounts = await this._getAccounts(entry, true);
            var suiAccounts = accounts.filter(function (a) { return !a.chains || a.chains.includes('sui:mainnet'); });
            var all = suiAccounts.length ? suiAccounts : accounts;
            if (!all.length) { this.walletLabel.textContent = 'Connect Wallet'; return; }

            var account = all.find(function (a) { return String(a?.address || a).trim() === saved.address; }) || all[0];
            var address = String(account?.address || account || '').trim();
            if (!AC.isValidSuiAddress(address)) { this.walletLabel.textContent = 'Connect Wallet'; return; }

            this.connectedAddress = address;
            this.connectedAccount = account;
            this.connectedWalletEntry = entry;
            this.suiBalance = await fetchSuiBalance(address);

            this.walletLabel.textContent = AC.shortAddr(address);
            this.connectBtn.classList.remove('bg-brand-primary', 'hover:bg-brand-primary-hover');
            this.connectBtn.classList.add('bg-green-600', 'hover:bg-green-500');

            AC.storageSet(this.storageKey, { walletName: saved.walletName, address: address });
            this.onConnect(address, entry);
        } catch (e) {
            console.warn('[AlphaCity:wallet] Auto-reconnect failed:', e);
            this.walletLabel.textContent = 'Connect Wallet';
        }
    };

    WalletConnector.prototype.showWalletOptions = function () {
        var self = this;
        var overlay = makeOverlay();
        overlay.setAttribute('aria-labelledby', '_ac_wallet_opts_title');
        overlay.innerHTML =
            '<div class="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">' +
                '<h3 id="_ac_wallet_opts_title" class="text-white font-bold text-lg mb-4">Wallet Options</h3>' +
                '<div class="space-y-2">' +
                    '<button id="_ac_wo_switch" class="w-full text-left px-4 py-3 bg-gray-900 border border-gray-700 hover:border-blue-500 text-white rounded-lg transition-colors font-medium text-sm">Switch Wallet</button>' +
                    '<button id="_ac_wo_disconnect" class="w-full text-left px-4 py-3 bg-gray-900 border border-gray-700 hover:border-red-400 text-red-300 rounded-lg transition-colors font-medium text-sm">Disconnect</button>' +
                '</div>' +
                '<button id="_ac_wo_cancel" class="mt-4 w-full py-2 text-gray-400 text-sm hover:text-white transition-colors">Cancel</button>' +
            '</div>';

        document.body.appendChild(overlay);

        document.getElementById('_ac_wo_switch').addEventListener('click', async function () {
            document.body.removeChild(overlay);
            await self.disconnect();
            self.connect().catch(function (e) {
                AC.toast('Wallet connection failed: ' + (e?.message || e), 'error');
            });
        });
        document.getElementById('_ac_wo_disconnect').addEventListener('click', async function () {
            document.body.removeChild(overlay);
            await self.disconnect();
        });
        document.getElementById('_ac_wo_cancel').addEventListener('click', function () {
            document.body.removeChild(overlay);
        });
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) document.body.removeChild(overlay);
        });
    };

    WalletConnector.prototype.pickWallet = function (wallets) {
        return new Promise(function (resolve) {
            var overlay = makeOverlay();
            overlay.setAttribute('aria-labelledby', '_ac_pick_wallet_title');
            overlay.innerHTML =
                '<div class="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">' +
                    '<h3 id="_ac_pick_wallet_title" class="text-white font-bold text-lg mb-4">Select Wallet</h3>' +
                    '<div id="_ac_wallet_list" class="space-y-2"></div>' +
                    '<button id="_ac_wp_cancel" class="mt-4 w-full py-2 text-gray-400 text-sm hover:text-white transition-colors">Cancel</button>' +
                '</div>';
            document.body.appendChild(overlay);

            var list = document.getElementById('_ac_wallet_list');
            wallets.forEach(function (entry) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'w-full text-left px-4 py-3 bg-gray-900 border border-gray-700 hover:border-blue-500 text-white rounded-lg transition-colors font-medium text-sm';
                btn.textContent = entry.name;
                btn.setAttribute('aria-label', 'Connect ' + entry.name + ' wallet');
                btn.addEventListener('click', function () { document.body.removeChild(overlay); resolve(entry); });
                list.appendChild(btn);
            });
            document.getElementById('_ac_wp_cancel').addEventListener('click', function () {
                document.body.removeChild(overlay); resolve(null);
            });
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); }
            });
        });
    };

    WalletConnector.prototype.pickAccount = function (accounts) {
        return new Promise(function (resolve) {
            var overlay = makeOverlay();
            overlay.setAttribute('aria-labelledby', '_ac_pick_account_title');
            overlay.innerHTML =
                '<div class="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">' +
                    '<h3 id="_ac_pick_account_title" class="text-white font-bold text-lg mb-4">Select Account</h3>' +
                    '<div id="_ac_account_list" class="space-y-2"></div>' +
                '</div>';
            document.body.appendChild(overlay);

            var list = document.getElementById('_ac_account_list');
            accounts.forEach(function (account) {
                var addr = account?.address || account;
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'w-full text-left px-4 py-3 bg-gray-900 border border-gray-700 hover:border-blue-500 rounded-lg transition-colors font-mono text-sm text-blue-400';
                btn.textContent = AC.shortAddr(addr);
                btn.title = addr;
                btn.setAttribute('aria-label', 'Select account ' + AC.shortAddr(addr));
                btn.addEventListener('click', function () { document.body.removeChild(overlay); resolve(account); });
                list.appendChild(btn);
            });
        });
    };

    /**
     * Get the current SUI balance (raw string in MIST).
     * @returns {string|null}
     */
    WalletConnector.prototype.getBalance = function () {
        return this.suiBalance;
    };

    /**
     * Refresh the SUI balance for the connected address.
     * @returns {Promise<string|null>}
     */
    WalletConnector.prototype.refreshBalance = async function () {
        if (!this.connectedAddress) return null;
        this.suiBalance = await fetchSuiBalance(this.connectedAddress);
        return this.suiBalance;
    };

    /**
     * Sign and execute a transaction block.
     * @param {Object} txb - The transaction block to sign.
     * @returns {Promise<Object>} The transaction result.
     */
    WalletConnector.prototype.signAndExecute = async function (txb) {
        if (!this.connectedWalletEntry) throw new Error('No wallet connected.');

        var entry = this.connectedWalletEntry;
        var signFeature;

        if (entry.source === 'standard') {
            signFeature = entry.wallet.features['sui:signAndExecuteTransactionBlock'] ||
                          entry.wallet.features['sui:signAndExecuteTransaction'];
            if (!signFeature) throw new Error('Wallet does not support transaction signing.');
        }

        var promise;
        if (entry.source === 'standard' && signFeature.signAndExecuteTransactionBlock) {
            promise = signFeature.signAndExecuteTransactionBlock({
                transactionBlock: txb,
                account: this.connectedAccount,
                chain: 'sui:mainnet'
            });
        } else if (entry.source === 'standard' && signFeature.signAndExecuteTransaction) {
            promise = signFeature.signAndExecuteTransaction({
                transaction: txb,
                account: this.connectedAccount,
                chain: 'sui:mainnet'
            });
        } else if (entry.source === 'legacy') {
            promise = entry.provider.signAndExecuteTransactionBlock({ transactionBlock: txb });
        } else {
            throw new Error('Unable to sign transaction with connected wallet.');
        }

        return AC.withTimeout(promise, TRANSACTION_TIMEOUT, 'Transaction');
    };

    // ================================================================
    // STATIC HELPERS (exposed for pages that need them directly)
    // ================================================================

    AC.WalletConnector = WalletConnector;
    AC.discoverWallets = discoverWallets;
    AC.fetchSuiBalance = fetchSuiBalance;
    AC.initWalletStandard = initWalletStandard;
    AC.makeOverlay = makeOverlay;
    AC.SUI_MAINNET_RPC = SUI_MAINNET_RPC;
    AC.TRANSACTION_TIMEOUT = TRANSACTION_TIMEOUT;

})(window.AlphaCity);
