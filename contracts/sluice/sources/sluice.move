module sluice::sluice {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};
    use pyth::pyth;
    use pyth::price::{Self, Price};

    // --- Error Codes ---
    const ENotAuthorized: u64 = 0;
    const EInvalidTimeline: u64 = 1;
    const EMilestoneNotMet: u64 = 2;
    const EValidationTimeNotMet: u64 = 3;
    const ENoTokensVested: u64 = 4;
    const EAlreadyActive: u64 = 5;
    const EInvalidMilestoneState: u64 = 6;
    const EWrongPriceFeed: u64 = 7;

    // --- Milestone States ---
    const STATE_ACTIVE: u8 = 0;        // Vesting is active (either no milestone, or milestone fully cleared)
    const STATE_LOCKED: u8 = 1;        // Milestone set but threshold has not been crossed
    const STATE_VERIFYING: u8 = 2;     // Threshold crossed; 30-minute validation window is active

    // --- Safeguard Constants ---
    const VALIDATION_WINDOW_MS: u64 = 1800000; // 30 minutes in milliseconds

    /// Represents an individual token vesting stream.
    struct VestingSchedule<phantom T> has key, store {
        id: UID,
        creator: address,
        beneficiary: address,
        balance: Balance<T>,
        total_amount: u64,
        released_amount: u64,
        
        // Timeline fields (timestamps in milliseconds)
        start_time_ms: u64,
        end_time_ms: u64,
        interval_ms: u64,              // Release frequency (e.g. 1000 for per-second, or 604800000 for weekly)

        // Marketcap Milestone fields (optional)
        target_marketcap: Option<u64>,  // Target market cap in USD (absolute value, e.g. 200000 for $200k)
        total_supply: Option<u64>,      // Token's total supply to compute price threshold
        price_feed_id: Option<address>, // Pyth price feed ID object address to verify price

        // Safeguard state machine
        milestone_status: u8,
        milestone_started_at: u64,      // Timestamp when the threshold was first verified
        revocable: bool,               // Whether the creator can cancel and reclaim remaining tokens
    }

    // --- Events ---
    struct ScheduleCreated has copy, drop {
        schedule_id: address,
        creator: address,
        beneficiary: address,
        total_amount: u64,
        target_marketcap: Option<u64>,
    }

    struct MilestoneTriggered has copy, drop {
        schedule_id: address,
        triggered_at: u64,
        price_value: u64,
    }

    struct VestingActivated has copy, drop {
        schedule_id: address,
        activated_at: u64,
    }

    struct TokensClaimed has copy, drop {
        schedule_id: address,
        beneficiary: address,
        amount: u64,
    }

    struct ScheduleCancelled has copy, drop {
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
        total_supply: Option<u64>,
        price_feed_id: Option<address>,
        revocable: bool,
        ctx: &mut TxContext
    ) {
        assert!(end_time_ms > start_time_ms, EInvalidTimeline);
        assert!(interval_ms > 0, EInvalidTimeline);

        let total_amount = coin::value(&coins);
        let balance = coin::into_balance(coins);

        let milestone_status = if (option::is_some(&target_marketcap)) {
            assert!(option::is_some(&total_supply), EInvalidMilestoneState);
            assert!(option::is_some(&price_feed_id), EInvalidMilestoneState);
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
            total_supply,
            price_feed_id,
            milestone_status,
            milestone_started_at: 0,
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

    /// Step 1 of Safeguard: Called when the target price/marketcap is first crossed.
    /// Initiates the 30-minute validation window.
    public entry fun trigger_milestone_check<T>(
        schedule: &mut VestingSchedule<T>,
        pyth_price_info: &pyth::PriceInfoObject,
        clock: &Clock
    ) {
        assert!(schedule.milestone_status == STATE_LOCKED, EInvalidMilestoneState);
        
        // Verify price feed matches the configured feed ID
        let expected_feed = *option::borrow(&schedule.price_feed_id);
        assert!(object::uid_to_address(object::borrow_uid(pyth_price_info)) == expected_feed, EWrongPriceFeed);

        // Fetch price from Pyth Network
        let price_struct = pyth::get_price(pyth_price_info, clock);
        assert!(is_target_marketcap_met(price_struct, *option::borrow(&schedule.target_marketcap), *option::borrow(&schedule.total_supply)), EMilestoneNotMet);

        let now = clock::timestamp_ms(clock);
        schedule.milestone_status = STATE_VERIFYING;
        schedule.milestone_started_at = now;

        sui::event::emit(MilestoneTriggered {
            schedule_id: object::uid_to_address(&schedule.id),
            triggered_at: now,
            price_value: (price::get_price(&price_struct) as u64),
        });
    }

    /// Step 2 of Safeguard: Called after >= 30 minutes have passed since `trigger_milestone_check`.
    /// Verifies that the price remains above the threshold and activates vesting.
    /// Shifts the start and end vesting dates forward to begin linear vesting from this moment.
    public entry fun activate_vesting<T>(
        schedule: &mut VestingSchedule<T>,
        pyth_price_info: &pyth::PriceInfoObject,
        clock: &Clock
    ) {
        assert!(schedule.milestone_status == STATE_VERIFYING, EInvalidMilestoneState);
        
        let now = clock::timestamp_ms(clock);
        assert!(now >= schedule.milestone_started_at + VALIDATION_WINDOW_MS, EValidationTimeNotMet);

        // Verify price feed matches the configured feed ID
        let expected_feed = *option::borrow(&schedule.price_feed_id);
        assert!(object::uid_to_address(object::borrow_uid(pyth_price_info)) == expected_feed, EWrongPriceFeed);

        // Verify that the price is STILL meeting the target (fails if it dipped during the 30m window)
        let price_struct = pyth::get_price(pyth_price_info, clock);
        assert!(is_target_marketcap_met(price_struct, *option::borrow(&schedule.target_marketcap), *option::borrow(&schedule.total_supply)), EMilestoneNotMet);

        // Activate schedule and shift start/end timestamps so vesting begins now
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
        assert!(schedule.milestone_status == STATE_ACTIVE, EMilestoneNotMet);
        
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

    /// Helper to evaluate if the marketcap target is met using the Pyth price object.
    /// Uses integer math to evaluate: ImpliedMarketcap = Price * TotalSupply >= TargetMarketcap
    /// Formula: price_value * TotalSupply >= TargetMarketcap * 10^abs(price_expo)
    public fun is_target_marketcap_met(
        price_struct: Price,
        target_marketcap: u64,
        total_supply: u64
    ): bool {
        let price_val = price::get_price(&price_struct);
        if (price_val <= 0) {
            return false
        };

        let price_value = (price_val as u128);
        let supply = (total_supply as u128);
        let target_mcap = (target_marketcap as u128);

        // Get exponent (it is typically negative, representing decimal places)
        let expo = price::get_expo(&price_struct);
        let abs_expo = if (expo < 0) {
            (-expo as u32)
        } else {
            0
        };

        let scale = pow(10, abs_expo);
        
        // Implied marketcap math: PriceValue * TotalSupply >= TargetMarketcap * 10^abs_expo
        price_value * supply >= target_mcap * scale
    }

    /// Fast exponentiation helper for u128
    fun pow(base: u128, exp: u32): u128 {
        let res = 1;
        while (exp > 0) {
            if (exp % 2 == 1) {
                res = res * base;
            };
            base = base * base;
            exp = exp / 2;
        };
        res
    }
}
