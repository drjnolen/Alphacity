#[test_only]
module sluice::sluice_tests {
    use sluice::sluice;
    use sui::test_scenario;
    use sui::coin;
    use sui::clock;
    use std::option;

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
    #[expected_failure(abort_code = 5)] // EInvalidSignature (abort code 5)
    fun test_reassign_beneficiary_fails_on_invalid_sig() {
        let creator = @0xAAAA;
        let new_beneficiary = @0xCCCC;

        // 1. Create a dummy public key (32 bytes of 0x01)
        let mut pubkey = vector[];
        let mut i: u64 = 0;
        while (i < 32) {
            vector::push_back(&mut pubkey, 1);
            i = i + 1;
        };

        // 2. Derive address from public key: Blake2b256(0x00 || pubkey)
        let mut addr_bytes = vector[0x00];
        vector::append(&mut addr_bytes, pubkey);
        let hashed = sui::hash::blake2b256(&addr_bytes);
        let derived_beneficiary = sui::address::from_bytes(hashed);

        // 3. Setup test scenario
        let mut scenario = test_scenario::begin(creator);
        
        // Deploy a schedule using the derived address as beneficiary
        {
            let ctx = test_scenario::ctx(&mut scenario);
            let dummy_coin = coin::mint_for_testing<sui::sui::SUI>(10000, ctx);
            let oracle_pubkey = vector[];
            
            sluice::create_schedule(
                dummy_coin,
                derived_beneficiary,
                1000,
                5000,
                1000,
                option::none(),
                oracle_pubkey,
                true,
                ctx
            );
        };

        // 4. Try to reassign beneficiary with invalid dummy signature
        test_scenario::next_tx(&mut scenario, creator);
        {
            // Fetch the created VestingSchedule
            let mut schedule = test_scenario::take_shared<sluice::VestingSchedule<sui::sui::SUI>>(&scenario);
            let ctx = test_scenario::ctx(&mut scenario);

            // Create a dummy signature (64 bytes of 0x02)
            let mut dummy_signature = vector[];
            let mut j: u64 = 0;
            while (j < 64) {
                vector::push_back(&mut dummy_signature, 2);
                j = j + 1;
            };

            // Call reassign_beneficiary — should abort with EInvalidSignature (5)
            sluice::reassign_beneficiary(
                &mut schedule,
                pubkey,
                dummy_signature,
                new_beneficiary,
                ctx
            );

            test_scenario::return_shared(schedule);
        };
        
        test_scenario::end(scenario);
    }
}
