/**
 * Alpha City — Toast Notification System
 * Provides non-intrusive feedback for errors, warnings, success, and info messages.
 */

/* global window, document */

window.AlphaCity = window.AlphaCity || {};

(function (AC) {
    'use strict';

    var container = null;
    var TOAST_DURATION = 5000;

    function getContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.id = 'ac-toast-container';
        container.className = 'fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none max-w-sm w-full';
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
        return container;
    }

    var ICONS = {
        success: '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>',
        error: '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>',
        warning: '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
        info: '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    };

    var COLORS = {
        success: 'border-green-500/40 bg-green-900/80 text-green-200',
        error: 'border-red-500/40 bg-red-900/80 text-red-200',
        warning: 'border-yellow-500/40 bg-yellow-900/80 text-yellow-200',
        info: 'border-blue-500/40 bg-blue-900/80 text-blue-200'
    };

    /**
     * Shows a toast notification.
     * @param {string} message - The message to display.
     * @param {string} [type='info'] - One of 'success', 'error', 'warning', 'info'.
     * @param {number} [duration] - Duration in ms before auto-dismiss.
     */
    function toast(message, type, duration) {
        type = type || 'info';
        duration = duration || (type === 'error' ? 8000 : TOAST_DURATION);

        var wrapper = getContainer();
        var el = document.createElement('div');
        el.className = 'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg transition-all duration-300 opacity-0 translate-x-4 ' + (COLORS[type] || COLORS.info);
        el.setAttribute('role', 'alert');
        el.innerHTML =
            (ICONS[type] || ICONS.info) +
            '<span class="text-sm font-medium leading-snug flex-1">' + AC.escapeHtml(message) + '</span>' +
            '<button class="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors" aria-label="Dismiss notification">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
            '</button>';

        wrapper.appendChild(el);

        // Animate in
        requestAnimationFrame(function () {
            el.classList.remove('opacity-0', 'translate-x-4');
            el.classList.add('opacity-100', 'translate-x-0');
        });

        function dismiss() {
            el.classList.remove('opacity-100', 'translate-x-0');
            el.classList.add('opacity-0', 'translate-x-4');
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 300);
        }

        el.querySelector('button').addEventListener('click', dismiss);

        var timer = setTimeout(dismiss, duration);
        el.addEventListener('mouseenter', function () { clearTimeout(timer); });
        el.addEventListener('mouseleave', function () { timer = setTimeout(dismiss, 2000); });
    }

    AC.toast = toast;

})(window.AlphaCity);
