#[test_only]
module sluice::sluice_tests {
    use sluice::sluice;
    use pyth::price;
    use sui::test_utils;

    #[test]
    fun test_linear_vesting_calculations() {
        let total_amount: u64 = 100000;
        let start_time_ms: u64 = 1000;
        let end_time_ms: u64 = 11000; // 10 seconds duration
        let interval_ms: u64 = 1000;   // 1 second interval

        // 1. Current time before start
        let vested = sluice::calculate_vested_amount(total_amount, start_time_ms, end_time_ms, interval_ms, 500);
        assert!(vested == 0, 0);

        // 2. Current time exactly at start
        let vested = sluice::calculate_vested_amount(total_amount, start_time_ms, end_time_ms, interval_ms, 1000);
        assert!(vested == 0, 1);

        // 3. Current time midway, exact interval step (5 seconds elapsed, which is 5 intervals)
        // Expected: 100,000 * 5,000 / 10,000 = 50,000
        let vested = sluice::calculate_vested_amount(total_amount, start_time_ms, end_time_ms, interval_ms, 6000);
        assert!(vested == 50000, 2);

        // 4. Current time midway, between interval steps (5.5 seconds elapsed)
        // Expected: should round down to 5 seconds step (50,000)
        let vested = sluice::calculate_vested_amount(total_amount, start_time_ms, end_time_ms, interval_ms, 6500);
        assert!(vested == 50000, 3);

        // 5. Current time exactly at end
        let vested = sluice::calculate_vested_amount(total_amount, start_time_ms, end_time_ms, interval_ms, 11000);
        assert!(vested == 100000, 4);

        // 6. Current time after end
        let vested = sluice::calculate_vested_amount(total_amount, start_time_ms, end_time_ms, interval_ms, 15000);
        assert!(vested == 100000, 5);
    }

    #[test]
    fun test_marketcap_threshold_math() {
        // Price value = 250000, exponent = -6 (representing $0.25)
        let price_struct = price::new_price__test_only(250000, -6, 0);
        
        let target_marketcap: u64 = 200000; // $200k target
        let total_supply: u64 = 1000000;     // 1M tokens supply
        // Implied market cap = $0.25 * 1,000,000 = $250k
        // Expected: target met ($250k >= $200k)
        let met = sluice::is_target_marketcap_met(price_struct, target_marketcap, total_supply);
        assert!(met == true, 0);

        // Price value = 150000, exponent = -6 (representing $0.15)
        let price_struct = price::new_price__test_only(150000, -6, 0);
        // Implied market cap = $0.15 * 1,000,000 = $150k
        // Expected: target NOT met ($150k < $200k)
        let met = sluice::is_target_marketcap_met(price_struct, target_marketcap, total_supply);
        assert!(met == false, 1);
    }
}
