(function () {
    'use strict';

    async function signAndExecute({ transaction, wallet, account, chain = 'sui:mainnet' }) {
        const prepared = await window.AlphaCitySui.prepareTransaction(transaction);
        const features = wallet.features;
        const modern = features ? features['sui:signAndExecuteTransaction'] : wallet;
        const legacy = features ? features['sui:signAndExecuteTransactionBlock'] : wallet;
        let result;
        // Select the advertised API once. Never retry an execution after a
        // rejection or transport error: it may already have been submitted.
        if (modern?.signAndExecuteTransaction) {
            result = await modern.signAndExecuteTransaction({
                transaction: prepared.transaction, account, chain,
            });
        } else if (legacy?.signAndExecuteTransactionBlock) {
            result = await legacy.signAndExecuteTransactionBlock({
                transactionBlock: prepared.bytes, account, chain,
                options: { showEffects: true },
            });
        } else {
            throw new Error('This wallet does not support signing Sui transactions.');
        }
        return Array.isArray(result) ? result[0] : result;
    }

    window.AlphaCityStakingTransactions = { signAndExecute };
})();
