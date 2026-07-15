const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'staking', 'transaction-confirmation.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'staking', 'index.html'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'staking/transaction-confirmation.js' });
const confirmation = context.window.AlphaCityStakingConfirmation;

function fakeRoot(elements = {}, selectedDays = '30') {
    return {
        getElementById(id) { return elements[id] || null; },
        querySelector(selector) {
            if (selector === '.lock-option.border-brand-primary') return { dataset: { days: selectedDays } };
            return null;
        },
    };
}

test('formats exact CITY and credit amounts without floating point conversion', () => {
    assert.equal(confirmation.formatDisplayAmount('500000.2500'), '500,000.25');
    assert.equal(confirmation.formatDisplayAmount('6741'), '6,741');
    assert.equal(confirmation.formatDisplayAmount('9,000,001'), '9,000,001');
});

test('describes stake and claim intent from the live staking controls', () => {
    const rootDocument = fakeRoot({
        'stake-input': { value: '500' },
        'citizen-credits-display': { textContent: '6741.25' },
    });

    const stake = confirmation.getActionSummary({ id: 'stake-btn' }, rootDocument);
    assert.equal(stake.title, 'Stake 500 CITY');
    assert.match(stake.description, /30 days/);

    const claim = confirmation.getActionSummary({ id: 'claim-btn' }, rootDocument);
    assert.equal(claim.title, 'Claim approximately 6,741.25 Citizen Credits');
    assert.match(claim.description, /currently shown as pending/);
});

test('describes bulk and individual unstake amounts', () => {
    const rootDocument = fakeRoot({
        'staked-display': { textContent: '900,000 CITY' },
    });
    const bulk = confirmation.getActionSummary({ id: 'unstake-btn', textContent: 'Unstake 750000 CITY' }, rootDocument);
    assert.equal(bulk.title, 'Unstake 750,000 CITY');
    assert.match(bulk.description, /currently unlocked positions/);

    const position = confirmation.getActionSummary({
        id: '',
        classList: { contains: value => value === 'unstake-position-btn' },
        closest: () => ({ querySelector: () => ({ textContent: '125000.5 CITY' }) }),
    }, rootDocument);
    assert.equal(position.title, 'Unstake 125,000.5 CITY');
});

test('staking page loads an accessible confirmation before the compiled app', () => {
    assert.match(html, /id="staking-transaction-confirmation"/);
    assert.match(html, /role="dialog" aria-modal="true"/);
    assert.match(html, /Continue to wallet/);
    assert.doesNotMatch(html, /staking-confirm-detail|Sui Mainnet|authoritative signing screen/);
    assert.ok(html.indexOf('/staking/transaction-confirmation.js') < html.indexOf('/assets/index-BymD0MH7.js'));
    assert.match(source, /event\.stopImmediatePropagation\(\)/);
    assert.match(source, /button\.click\(\)/);
});
