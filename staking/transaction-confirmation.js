(function (global) {
    'use strict';

    const ACTION_SELECTOR = '#stake-btn, #claim-btn, #unstake-btn, .unstake-position-btn';

    function formatDisplayAmount(value) {
        const raw = String(value ?? '').trim().replace(/[,_\s]/g, '');
        if (!/^\d+(?:\.\d+)?$/.test(raw)) return String(value ?? '').trim() || '0';
        const [wholeValue, fractionValue = ''] = raw.split('.');
        const whole = (wholeValue.replace(/^0+/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const fraction = fractionValue.replace(/0+$/, '');
        return fraction ? `${whole}.${fraction}` : whole;
    }

    function text(element) {
        return String(element?.textContent || '').trim();
    }

    function amountFromText(value) {
        return value.match(/([\d,.]+)\s+(?:\$?CITY|Citizen Credits)/i)?.[1] || '';
    }

    function getActionSummary(button, root = global.document) {
        if (!button || !root) return null;

        if (button.id === 'stake-btn') {
            const amount = formatDisplayAmount(root.getElementById('stake-input')?.value);
            const selectedLock = root.querySelector('.lock-option.border-brand-primary');
            const lockDays = selectedLock?.dataset?.days || 'selected';
            return {
                title: `Stake ${amount} CITY`,
                description: `You are asking Alpha City to stake ${amount} CITY for ${lockDays} days.`,
            };
        }

        if (button.id === 'claim-btn') {
            const amount = formatDisplayAmount(text(root.getElementById('citizen-credits-display')));
            return {
                title: `Claim approximately ${amount} Citizen Credits`,
                description: `You are asking Alpha City to claim the roughly ${amount} Citizen Credits currently shown as pending.`,
            };
        }

        if (button.id === 'unstake-btn') {
            const amount = formatDisplayAmount(amountFromText(text(button)) || amountFromText(text(root.getElementById('staked-display'))));
            return {
                title: `Unstake ${amount} CITY`,
                description: `You are asking Alpha City to unstake ${amount} CITY from all currently unlocked positions.`,
            };
        }

        if (button.classList?.contains('unstake-position-btn')) {
            const card = button.closest('.rounded-lg');
            const amount = formatDisplayAmount(amountFromText(text(card?.querySelector('p'))));
            return {
                title: `Unstake ${amount} CITY`,
                description: `You are asking Alpha City to unstake this ${amount} CITY position.`,
            };
        }

        return null;
    }

    function install(root = global.document) {
        if (!root || root.__alphaCityStakingConfirmationInstalled) return;
        root.__alphaCityStakingConfirmationInstalled = true;

        const modal = root.getElementById('staking-transaction-confirmation');
        const dialog = modal?.querySelector('[role="dialog"]');
        const title = root.getElementById('staking-confirm-title');
        const description = root.getElementById('staking-confirm-description');
        const continueButton = modal?.querySelector('[data-confirm-continue]');
        const cancelButton = modal?.querySelector('[data-confirm-cancel]');
        const backdrop = modal?.querySelector('[data-confirm-backdrop]');
        if (!modal || !dialog || !title || !description || !continueButton || !cancelButton || !backdrop) return;

        const bypass = new WeakSet();
        let resolveConfirmation = null;
        let trigger = null;

        function close(confirmed) {
            if (!resolveConfirmation) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            modal.setAttribute('aria-hidden', 'true');
            global.document.body.classList.remove('overflow-hidden');
            const resolve = resolveConfirmation;
            const previousTrigger = trigger;
            resolveConfirmation = null;
            trigger = null;
            resolve(confirmed);
            previousTrigger?.focus?.();
        }

        function open(summary, source) {
            title.textContent = summary.title;
            description.textContent = summary.description;
            trigger = source;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            modal.setAttribute('aria-hidden', 'false');
            global.document.body.classList.add('overflow-hidden');
            continueButton.focus();
            return new Promise(resolve => {
                resolveConfirmation = resolve;
            });
        }

        continueButton.addEventListener('click', () => close(true));
        cancelButton.addEventListener('click', () => close(false));
        backdrop.addEventListener('click', () => close(false));

        root.addEventListener('keydown', event => {
            if (!resolveConfirmation) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [cancelButton, continueButton];
            const currentIndex = focusable.indexOf(root.activeElement);
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
            event.preventDefault();
            focusable[nextIndex].focus();
        });

        root.addEventListener('click', async event => {
            const button = event.target?.closest?.(ACTION_SELECTOR);
            if (!button || button.disabled) return;
            if (bypass.has(button)) {
                bypass.delete(button);
                return;
            }

            const summary = getActionSummary(button, root);
            if (!summary) return;
            event.preventDefault();
            event.stopImmediatePropagation();

            const confirmed = await open(summary, button);
            if (!confirmed || !button.isConnected || button.disabled) return;
            bypass.add(button);
            button.click();
        }, true);
    }

    const api = { formatDisplayAmount, getActionSummary, install };
    global.AlphaCityStakingConfirmation = api;

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => install());
        } else {
            install();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
