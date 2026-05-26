/**
 * Alpha City — Shared Utilities
 * Common helpers for error handling, sanitization, validation, and debouncing.
 */

/* global window, document */

window.AlphaCity = window.AlphaCity || {};

(function (AC) {
    'use strict';

    // ================================================================
    // HTML SANITIZATION
    // ================================================================

    /**
     * Escapes HTML special characters to prevent XSS when inserting dynamic text.
     * @param {string} str - Untrusted string to escape.
     * @returns {string} Escaped string safe for insertion into HTML.
     */
    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ================================================================
    // ADDRESS VALIDATION
    // ================================================================

    /**
     * Validates a Sui address format (0x followed by 64 hex characters).
     * @param {string} addr - Address to validate.
     * @returns {boolean}
     */
    function isValidSuiAddress(addr) {
        return typeof addr === 'string' && /^0x[0-9a-fA-F]{64}$/.test(addr);
    }

    /**
     * Shortens a Sui address for display purposes.
     * @param {string} addr - Full address.
     * @returns {string} Shortened format: 0x1234…abcd
     */
    function shortAddr(addr) {
        if (!addr || addr.length < 12) return addr || '';
        return addr.slice(0, 6) + '…' + addr.slice(-4);
    }

    // ================================================================
    // DEBOUNCE / THROTTLE
    // ================================================================

    /**
     * Creates a debounced version of a function.
     * @param {Function} fn - Function to debounce.
     * @param {number} ms - Delay in milliseconds.
     * @returns {Function} Debounced function.
     */
    function debounce(fn, ms) {
        let timer;
        return function () {
            const args = arguments;
            const context = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(context, args); }, ms);
        };
    }

    // ================================================================
    // SAFE LOCALSTORAGE
    // ================================================================

    /**
     * Safely reads from localStorage with JSON parsing.
     * @param {string} key - Storage key.
     * @returns {*} Parsed value or null on failure.
     */
    function storageGet(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.warn('[AlphaCity] Failed to read localStorage key "' + key + '":', e);
            return null;
        }
    }

    /**
     * Safely writes to localStorage with JSON serialization.
     * @param {string} key - Storage key.
     * @param {*} value - Value to store.
     * @returns {boolean} True if successful.
     */
    function storageSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('[AlphaCity] Failed to write localStorage key "' + key + '":', e);
            AC.toast('Unable to save settings. Storage may be full.', 'warning');
            return false;
        }
    }

    /**
     * Safely removes a localStorage key.
     * @param {string} key - Storage key.
     */
    function storageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn('[AlphaCity] Failed to remove localStorage key "' + key + '":', e);
        }
    }

    // ================================================================
    // PROMISE TIMEOUT
    // ================================================================

    /**
     * Wraps a promise with a timeout. Rejects if the promise doesn't resolve in time.
     * @param {Promise} promise - The promise to wrap.
     * @param {number} ms - Timeout in milliseconds.
     * @param {string} [label] - Label for the timeout error message.
     * @returns {Promise}
     */
    function withTimeout(promise, ms, label) {
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () {
                reject(new Error((label || 'Operation') + ' timed out after ' + (ms / 1000) + 's'));
            }, ms);
            promise.then(
                function (val) { clearTimeout(timer); resolve(val); },
                function (err) { clearTimeout(timer); reject(err); }
            );
        });
    }

    // ================================================================
    // CONFIRMATION DIALOG
    // ================================================================

    /**
     * Shows a confirmation dialog before executing an irreversible action.
     * @param {Object} opts - Options.
     * @param {string} opts.title - Dialog title.
     * @param {string} opts.message - Dialog message (supports HTML).
     * @param {string} [opts.confirmText='Confirm'] - Confirm button text.
     * @param {string} [opts.cancelText='Cancel'] - Cancel button text.
     * @param {string} [opts.confirmClass] - Additional class for confirm button.
     * @returns {Promise<boolean>} True if confirmed, false if cancelled.
     */
    function confirm(opts) {
        return new Promise(function (resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', '_ac_confirm_title');

            var confirmBtnClass = opts.confirmClass || 'bg-brand-primary hover:bg-brand-primary-hover';

            overlay.innerHTML =
                '<div class="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">' +
                    '<h3 id="_ac_confirm_title" class="text-white font-bold text-lg mb-2">' + escapeHtml(opts.title || 'Confirm Action') + '</h3>' +
                    '<p class="text-gray-300 text-sm mb-6">' + (opts.message || '') + '</p>' +
                    '<div class="flex gap-3">' +
                        '<button id="_ac_confirm_cancel" class="flex-1 py-2.5 px-4 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 transition-colors text-sm font-medium">' +
                            escapeHtml(opts.cancelText || 'Cancel') +
                        '</button>' +
                        '<button id="_ac_confirm_ok" class="flex-1 py-2.5 px-4 rounded-lg text-white transition-colors text-sm font-medium ' + confirmBtnClass + '">' +
                            escapeHtml(opts.confirmText || 'Confirm') +
                        '</button>' +
                    '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            function cleanup(result) {
                document.body.removeChild(overlay);
                resolve(result);
            }

            document.getElementById('_ac_confirm_ok').addEventListener('click', function () { cleanup(true); });
            document.getElementById('_ac_confirm_cancel').addEventListener('click', function () { cleanup(false); });
            overlay.addEventListener('click', function (e) { if (e.target === overlay) cleanup(false); });

            // Focus the cancel button by default (safer for destructive actions)
            document.getElementById('_ac_confirm_cancel').focus();
        });
    }

    // ================================================================
    // EXPORTS
    // ================================================================

    AC.escapeHtml = escapeHtml;
    AC.isValidSuiAddress = isValidSuiAddress;
    AC.shortAddr = shortAddr;
    AC.debounce = debounce;
    AC.storageGet = storageGet;
    AC.storageSet = storageSet;
    AC.storageRemove = storageRemove;
    AC.withTimeout = withTimeout;
    AC.confirm = confirm;

})(window.AlphaCity);
