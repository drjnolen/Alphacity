module sluice::sluice {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};

    // --- Error Codes ---
    const ENotAuthorized: u64 = 0;
    const EInvalidTimeline: u64 = 1;
    const ENoTokensVested: u64 = 2;
    const EInvalidMilestoneState: u64 = 4;
    const EInvalidSignature: u64 = 5;

    // --- Milestone States ---
    const STATE_ACTIVE: u8 = 0;        // Vesting is active (either no milestone, or milestone fully unlocked)
    const STATE_LOCKED: u8 = 1;        // Milestone set but validation is pending

    /// Represents an individual token vesting stream.
    public struct VestingSchedule<phantom T> has key, store {
        id: UID,
        creator: address,
        beneficiary: address,
        balance: Balance<T>,
        total_amount: u64,
        released_amount: u64,
        
        // Timeline fields (timestamps in milliseconds)
        start_time_ms: u64,
        end_time_ms: u64,
        interval_ms: u64,              // Release frequency (e.g. 1000 for per-second, or weekly)

        // Marketcap Milestone fields (optional)
        target_marketcap: Option<u64>,  // Target market cap in USD (absolute value, e.g. 200000 for $200k)
        
        // Oracle Attestation fields
        oracle_pubkey: vector<u8>,     // 32-byte Ed25519 public key of the verification bot
        milestone_status: u8,
        revocable: bool,               // Whether the creator can cancel and reclaim remaining tokens
    }

    // --- Events ---
    public struct ScheduleCreated has copy, drop {
        schedule_id: address,
        creator: address,
        beneficiary: address,
        total_amount: u64,
        target_marketcap: Option<u64>,
    }

    public struct VestingActivated has copy, drop {
        schedule_id: address,
        activated_at: u64,
    }

    public struct TokensClaimed has copy, drop {
        schedule_id: address,
        beneficiary: address,
        amount: u64,
    }

    public struct ScheduleCancelled has copy, drop {
        schedule_id: address,
        returned_amount: u64,
    }

    // =========================================================================
    // Core Functions
    // =========================================================================

    /// Creates and shares a new vesting schedule.
    public entry fun create_schedule<T>(
        coins: Coin<T>,
        beneficiary: address,
        start_time_ms: u64,
        end_time_ms: u64,
        interval_ms: u64,
        target_marketcap: Option<u64>,
        oracle_pubkey: vector<u8>,
        revocable: bool,
        ctx: &mut TxContext
    ) {
        assert!(end_time_ms > start_time_ms, EInvalidTimeline);
        assert!(interval_ms > 0, EInvalidTimeline);

        let total_amount = coin::value(&coins);
        let balance = coin::into_balance(coins);

        let milestone_status = if (option::is_some(&target_marketcap)) {
            STATE_LOCKED
        } else {
            STATE_ACTIVE
        };

        let schedule = VestingSchedule {
            id: object::new(ctx),
            creator: tx_context::sender(ctx),
            beneficiary,
            balance,
            total_amount,
            released_amount: 0,
            start_time_ms,
            end_time_ms,
            interval_ms,
            target_marketcap,
            oracle_pubkey,
            milestone_status,
            revocable,
        };

        let schedule_id = object::uid_to_address(&schedule.id);

        sui::event::emit(ScheduleCreated {
            schedule_id,
            creator: schedule.creator,
            beneficiary,
            total_amount,
            target_marketcap,
        });

        transfer::share_object(schedule);
    }

    /// Verifies the cryptographic attestation signed by the serverless GitHub Actions bot.
    /// Unlocks the vesting schedule and shifts start/end dates so vesting begins immediately.
    public entry fun activate_vesting<T>(
        schedule: &mut VestingSchedule<T>,
        signature: vector<u8>,
        clock: &Clock
    ) {
        assert!(schedule.milestone_status == STATE_LOCKED, EInvalidMilestoneState);
        
        // Reconstruct signed message: schedule ID bytes
        let msg = object::uid_to_bytes(&schedule.id);

        // Verify Ed25519 signature against the configured oracle public key
        assert!(sui::ed25519::ed25519_verify(&signature, &schedule.oracle_pubkey, &msg), EInvalidSignature);

        // Activate schedule and shift start/end timestamps so vesting begins now
        let now = clock::timestamp_ms(clock);
        let duration = schedule.end_time_ms - schedule.start_time_ms;
        schedule.start_time_ms = now;
        schedule.end_time_ms = now + duration;
        schedule.milestone_status = STATE_ACTIVE;

        sui::event::emit(VestingActivated {
            schedule_id: object::uid_to_address(&schedule.id),
            activated_at: now,
        });
    }

    /// Calculates and transfers the currently vested portion of tokens to the beneficiary.
    public entry fun claim_vested<T>(
        schedule: &mut VestingSchedule<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(schedule.milestone_status == STATE_ACTIVE, EInvalidMilestoneState);
        
        let now = clock::timestamp_ms(clock);
        let total_vested = calculate_vested_amount(
            schedule.total_amount,
            schedule.start_time_ms,
            schedule.end_time_ms,
            schedule.interval_ms,
            now
        );

        let claimable = total_vested - schedule.released_amount;
        assert!(claimable > 0, ENoTokensVested);

        schedule.released_amount = schedule.released_amount + claimable;
        
        let claim_balance = balance::split(&mut schedule.balance, claimable);
        let claim_coin = coin::from_balance(claim_balance, ctx);
        transfer::public_transfer(claim_coin, schedule.beneficiary);

        sui::event::emit(TokensClaimed {
            schedule_id: object::uid_to_address(&schedule.id),
            beneficiary: schedule.beneficiary,
            amount: claimable,
        });
    }

    /// Cancels the vesting schedule if it is configured as revocable.
    /// Returns all remaining unreleased tokens to the creator.
    public entry fun cancel_schedule<T>(
        schedule: &mut VestingSchedule<T>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(sender == schedule.creator, ENotAuthorized);
        assert!(schedule.revocable, ENotAuthorized);

        let remaining = balance::value(&schedule.balance);
        let returned_balance = balance::withdraw_all(&mut schedule.balance);
        let returned_coin = coin::from_balance(returned_balance, ctx);
        transfer::public_transfer(returned_coin, schedule.creator);

        sui::event::emit(ScheduleCancelled {
            schedule_id: object::uid_to_address(&schedule.id),
            returned_amount: remaining,
        });
    }

    /// Allows the current beneficiary (e.g. an ephemeral key) to transfer the vesting schedule
    /// ownership to a new recipient address (e.g. their permanent zkLogin address).
    public entry fun reassign_beneficiary<T>(
        schedule: &mut VestingSchedule<T>,
        pubkey: vector<u8>,
        signature: vector<u8>,
        new_beneficiary: address,
        _ctx: &mut TxContext
    ) {
        // Derive address from public key: Blake2b256(0x00 || pubkey)
        let mut addr_bytes = vector[0x00];
        std::vector::append(&mut addr_bytes, pubkey);
        let hashed = sui::hash::blake2b256(&addr_bytes);
        let derived_addr = sui::address::from_bytes(hashed);
        assert!(derived_addr == schedule.beneficiary, ENotAuthorized);

        // Reconstruct signed message: schedule ID + new beneficiary address
        let mut msg = object::uid_to_bytes(&schedule.id);
        std::vector::append(&mut msg, sui::address::to_bytes(new_beneficiary));

        // Verify ED25519 signature
        assert!(sui::ed25519::ed25519_verify(&signature, &pubkey, &msg), EInvalidSignature);

        // Update the beneficiary address
        schedule.beneficiary = new_beneficiary;
    }

    // =========================================================================
    // Public Getters & Helpers
    // =========================================================================

    /// Computes the total amount vested based on linear distribution over time steps.
    public fun calculate_vested_amount(
        total_amount: u64,
        start_time_ms: u64,
        end_time_ms: u64,
        interval_ms: u64,
        current_time_ms: u64
    ): u64 {
        if (current_time_ms < start_time_ms) {
            return 0
        };
        if (current_time_ms >= end_time_ms) {
            return total_amount
        };

        let total_duration = end_time_ms - start_time_ms;
        let elapsed = current_time_ms - start_time_ms;
        
        // Round elapsed time down to the nearest interval
        let elapsed_intervals = elapsed / interval_ms;
        let elapsed_rounded = elapsed_intervals * interval_ms;

        // Linear interpolation
        let vested = ( (total_amount as u128) * (elapsed_rounded as u128) ) / (total_duration as u128);
        (vested as u64)
    }
}
