#[test_only]
module sluice::sluice_tests {
    use sluice::sluice;

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
}
