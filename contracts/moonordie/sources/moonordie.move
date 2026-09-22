/// Publish as a separate, immutable package. No administrator or cancellation
/// capability exists. Success must be recorded before the immutable deadline.
module moonordie::moonordie {
    use std::option::{Self, Option};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    const E_POLICY: u64 = 0;
    const E_STATE: u64 = 1;
    const E_DEADLINE: u64 = 2;
    const E_OBSERVATION: u64 = 3;
    const E_SIGNATURE: u64 = 4;
    const PENDING: u8 = 0;
    const SUCCESS: u8 = 1;
    const CLAIMED: u8 = 2;
    const DISPOSED: u8 = 3;
    const MAX_OBSERVATION_AGE_MS: u64 = 120_000;

    public struct Commitment<phantom T> has key {
        id: UID,
        creator: address,
        beneficiary: address,
        balance: Balance<T>,
        total_amount: u64,
        created_at_ms: u64,
        deadline_ms: u64,
        target_market_cap: u64,
        min_liquidity_usd: u64,
        config_hash: vector<u8>,
        oracle_pubkeys: vector<vector<u8>>,
        oracle_threshold: u8,
        client_reference: vector<u8>,
        status: u8,
        success_observed_at_ms: Option<u64>,
        success_market_cap: Option<u64>,
        disposed_coin: Option<address>,
    }

    public struct Observation has copy, drop, store {
        domain: vector<u8>,
        commitment_id: address,
        config_hash: vector<u8>,
        market_cap: u64,
        observed_at_ms: u64,
    }
    public struct Created has copy, drop {
        commitment_id: address, creator: address, beneficiary: address,
        amount: u64, target_market_cap: u64, deadline_ms: u64,
        client_reference: vector<u8>,
    }
    public struct Succeeded has copy, drop {
        commitment_id: address, market_cap: u64, observed_at_ms: u64,
    }
    public struct Claimed has copy, drop {
        commitment_id: address, beneficiary: address, amount: u64,
    }
    public struct Disposed has copy, drop {
        commitment_id: address, frozen_coin_id: address, amount: u64,
    }

    public fun create<T>(
        coins: Coin<T>, beneficiary: address, target_market_cap: u64,
        deadline_ms: u64, min_liquidity_usd: u64, config_hash: vector<u8>,
        oracle_pubkeys: vector<vector<u8>>, oracle_threshold: u8,
        client_reference: vector<u8>, clock: &Clock, ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(coin::value(&coins) > 0 && beneficiary != @0x0, E_POLICY);
        assert!(target_market_cap > 0 && deadline_ms > now, E_POLICY);
        assert!(config_hash.length() == 32, E_POLICY);
        assert!(!client_reference.is_empty() && client_reference.length() <= 64, E_POLICY);
        let count = oracle_pubkeys.length();
        assert!(count > 0 && count <= 10 && oracle_threshold > 0
            && (oracle_threshold as u64) <= count, E_POLICY);
        let mut i = 0;
        while (i < count) {
            assert!(oracle_pubkeys[i].length() == 32, E_POLICY);
            let mut j = i + 1;
            while (j < count) {
                assert!(oracle_pubkeys[i] != oracle_pubkeys[j], E_POLICY);
                j = j + 1;
            };
            i = i + 1;
        };
        let commitment = Commitment {
            id: object::new(ctx), creator: tx_context::sender(ctx), beneficiary,
            total_amount: coin::value(&coins), balance: coin::into_balance(coins),
            created_at_ms: now, deadline_ms, target_market_cap, min_liquidity_usd,
            config_hash, oracle_pubkeys, oracle_threshold, client_reference,
            status: PENDING, success_observed_at_ms: option::none(),
            success_market_cap: option::none(), disposed_coin: option::none(),
        };
        sui::event::emit(Created {
            commitment_id: object::id_address(&commitment), creator: commitment.creator,
            beneficiary, amount: commitment.total_amount, target_market_cap,
            deadline_ms, client_reference: commitment.client_reference,
        });
        transfer::share_object(commitment);
    }

    public fun submit_success<T>(
        commitment: &mut Commitment<T>, market_cap: u64, observed_at_ms: u64,
        signer_indices: vector<u8>, signatures: vector<vector<u8>>, clock: &Clock,
    ) {
        validate_observation(commitment, market_cap, observed_at_ms, clock::timestamp_ms(clock));
        let message = observation_bytes(commitment, market_cap, observed_at_ms);
        let count = signatures.length();
        assert!(count == signer_indices.length()
            && count >= (commitment.oracle_threshold as u64)
            && count <= commitment.oracle_pubkeys.length(), E_SIGNATURE);
        let mut i = 0;
        while (i < count) {
            let index = signer_indices[i] as u64;
            assert!(index < commitment.oracle_pubkeys.length(), E_SIGNATURE);
            if (i > 0) assert!(signer_indices[i] > signer_indices[i - 1], E_SIGNATURE);
            assert!(signatures[i].length() == 64, E_SIGNATURE);
            assert!(sui::ed25519::ed25519_verify(
                &signatures[i], &commitment.oracle_pubkeys[index], &message,
            ), E_SIGNATURE);
            i = i + 1;
        };
        succeed(commitment, market_cap, observed_at_ms);
    }

    fun validate_observation<T>(c: &Commitment<T>, cap: u64, observed: u64, now: u64) {
        assert!(c.status == PENDING, E_STATE);
        // No late attestations: at the boundary only disposal is permitted.
        assert!(now < c.deadline_ms, E_DEADLINE);
        assert!(cap >= c.target_market_cap && observed >= c.created_at_ms
            && observed <= now && now - observed <= MAX_OBSERVATION_AGE_MS, E_OBSERVATION);
    }

    fun succeed<T>(c: &mut Commitment<T>, cap: u64, observed: u64) {
        c.status = SUCCESS;
        c.success_observed_at_ms = option::some(observed);
        c.success_market_cap = option::some(cap);
        sui::event::emit(Succeeded { commitment_id: object::id_address(c), market_cap: cap, observed_at_ms: observed });
    }

    /// Permissionless sponsorship; the immutable beneficiary always receives all tokens.
    public fun claim<T>(c: &mut Commitment<T>, ctx: &mut TxContext) {
        assert!(c.status == SUCCESS, E_STATE);
        c.status = CLAIMED;
        let coins = coin::from_balance(balance::withdraw_all(&mut c.balance), ctx);
        transfer::public_transfer(coins, c.beneficiary);
        sui::event::emit(Claimed { commitment_id: object::id_address(c), beneficiary: c.beneficiary, amount: c.total_amount });
    }

    /// Permanently freezes the coin itself. Immutable Sui objects can never be
    /// consumed or mutated, including by a later version of the creating module.
    /// This removes spendability, not the coin's recorded total supply.
    public fun dispose<T>(c: &mut Commitment<T>, clock: &Clock, ctx: &mut TxContext) {
        assert!(c.status == PENDING, E_STATE);
        assert!(clock::timestamp_ms(clock) >= c.deadline_ms, E_DEADLINE);
        let coins = coin::from_balance(balance::withdraw_all(&mut c.balance), ctx);
        let frozen_coin_id = object::id_address(&coins);
        transfer::public_freeze_object(coins);
        c.disposed_coin = option::some(frozen_coin_id);
        c.status = DISPOSED;
        sui::event::emit(Disposed { commitment_id: object::id_address(c), frozen_coin_id, amount: c.total_amount });
    }

    public fun observation_bytes<T>(c: &Commitment<T>, market_cap: u64, observed_at_ms: u64): vector<u8> {
        sui::bcs::to_bytes(&Observation {
            domain: b"alphacity.sluice.moonordie.v1.observation",
            commitment_id: object::id_address(c), config_hash: c.config_hash,
            market_cap, observed_at_ms,
        })
    }
    public fun status<T>(c: &Commitment<T>): u8 { c.status }
    public fun balance_value<T>(c: &Commitment<T>): u64 { balance::value(&c.balance) }
    public fun disposed_coin<T>(c: &Commitment<T>): Option<address> { c.disposed_coin }

    #[test_only]
    public fun succeed_for_testing<T>(c: &mut Commitment<T>, cap: u64, observed: u64, now: u64) {
        validate_observation(c, cap, observed, now);
        succeed(c, cap, observed);
    }
}
