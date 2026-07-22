#[test_only]
module managed_drop_template::managed_drop_tests {
    use std::string;
    use managed_drop_template::managed_drop;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario;

    const ADMIN: address = @0xA11CE;
    const CREATOR: address = @0xC0FFEE;
    const PLATFORM: address = @0xA1FA;
    const BUYER: address = @0xB0B;

    #[test]
    fun public_mint_splits_payment_and_delivers_metadata() {
        let mut scenario = test_scenario::begin(ADMIN);
        {
            let ctx = test_scenario::ctx(&mut scenario);
            managed_drop::create_drop(
                string::utf8(b"Test Drop"),
                string::utf8(b"A managed test collection"),
                CREATOR,
                PLATFORM,
                1_000,
                500,
                2,
                1,
                ctx,
            );
            let clock = clock::create_for_testing(ctx);
            clock::share_for_testing(clock);
        };

        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let cap = test_scenario::take_from_sender<managed_drop::AdminCap>(&scenario);
            let mut drop = test_scenario::take_shared<managed_drop::Drop>(&scenario);
            managed_drop::add_stage(
                &cap,
                &mut drop,
                string::utf8(b"Public"),
                1_000,
                0,
                0,
                2,
                2,
                false,
            );
            add_item(&cap, &mut drop, false, b"One", b"one.png");
            add_item(&cap, &mut drop, false, b"Two", b"two.png");
            add_item(&cap, &mut drop, true, b"Team", b"team.png");
            managed_drop::publish_drop(&cap, &mut drop);
            assert!(managed_drop::is_published(&drop), 0);
            test_scenario::return_to_sender(&scenario, cap);
            test_scenario::return_shared(drop);
        };

        test_scenario::next_tx(&mut scenario, BUYER);
        {
            let mut drop = test_scenario::take_shared<managed_drop::Drop>(&scenario);
            let clock = test_scenario::take_shared<Clock>(&scenario);
            let payment = coin::mint_for_testing<SUI>(2_000, test_scenario::ctx(&mut scenario));
            managed_drop::mint(
                &mut drop,
                &clock,
                payment,
                0,
                2,
                test_scenario::ctx(&mut scenario),
            );
            assert!(managed_drop::minted_public(&drop) == 2, 1);
            assert!(managed_drop::stage_minted(&drop, 0) == 2, 2);
            test_scenario::return_shared(drop);
            test_scenario::return_shared(clock);
        };

        test_scenario::next_tx(&mut scenario, BUYER);
        {
            managed_drop::burn(test_scenario::take_from_sender<managed_drop::NFT>(&scenario));
            managed_drop::burn(test_scenario::take_from_sender<managed_drop::NFT>(&scenario));
        };

        test_scenario::next_tx(&mut scenario, CREATOR);
        {
            let proceeds = test_scenario::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::burn_for_testing(proceeds) == 1_800, 3);
        };

        test_scenario::next_tx(&mut scenario, PLATFORM);
        {
            let fee = test_scenario::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::burn_for_testing(fee) == 200, 4);
        };
        test_scenario::end(scenario);
    }

    #[test]
    fun admin_can_mint_reserved_inventory_without_payment() {
        let mut scenario = test_scenario::begin(ADMIN);
        {
            let ctx = test_scenario::ctx(&mut scenario);
            managed_drop::create_drop(
                string::utf8(b"Reserved"), string::utf8(b"Reserved test"),
                CREATOR, PLATFORM, 500, 0, 1, 1, ctx,
            );
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let cap = test_scenario::take_from_sender<managed_drop::AdminCap>(&scenario);
            let mut drop = test_scenario::take_shared<managed_drop::Drop>(&scenario);
            managed_drop::add_stage(&cap, &mut drop, string::utf8(b"Public"), 0, 0, 0, 1, 0, false);
            add_item(&cap, &mut drop, false, b"Public", b"public.png");
            add_item(&cap, &mut drop, true, b"Team", b"team.png");
            managed_drop::publish_drop(&cap, &mut drop);
            managed_drop::mint_reserved(&cap, &mut drop, CREATOR, 1, test_scenario::ctx(&mut scenario));
            assert!(managed_drop::minted_reserved(&drop) == 1, 0);
            test_scenario::return_to_sender(&scenario, cap);
            test_scenario::return_shared(drop);
        };
        test_scenario::next_tx(&mut scenario, CREATOR);
        { managed_drop::burn(test_scenario::take_from_sender<managed_drop::NFT>(&scenario)); };
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = 9)]
    fun allowlist_stage_rejects_an_unlisted_wallet() {
        let mut scenario = test_scenario::begin(ADMIN);
        {
            let ctx = test_scenario::ctx(&mut scenario);
            managed_drop::create_drop(
                string::utf8(b"Allowlist"), string::utf8(b"Private stage"),
                CREATOR, PLATFORM, 500, 0, 1, 0, ctx,
            );
            let clock = clock::create_for_testing(ctx);
            clock::share_for_testing(clock);
        };
        test_scenario::next_tx(&mut scenario, ADMIN);
        {
            let cap = test_scenario::take_from_sender<managed_drop::AdminCap>(&scenario);
            let mut drop = test_scenario::take_shared<managed_drop::Drop>(&scenario);
            managed_drop::add_stage(&cap, &mut drop, string::utf8(b"Allowlist"), 1_000, 0, 0, 1, 1, true);
            managed_drop::add_allowlist(&cap, &mut drop, 0, CREATOR, 1);
            add_item(&cap, &mut drop, false, b"Only", b"only.png");
            managed_drop::publish_drop(&cap, &mut drop);
            test_scenario::return_to_sender(&scenario, cap);
            test_scenario::return_shared(drop);
        };
        test_scenario::next_tx(&mut scenario, BUYER);
        {
            let mut drop = test_scenario::take_shared<managed_drop::Drop>(&scenario);
            let clock = test_scenario::take_shared<Clock>(&scenario);
            let payment = coin::mint_for_testing<SUI>(1_000, test_scenario::ctx(&mut scenario));
            managed_drop::mint(&mut drop, &clock, payment, 0, 1, test_scenario::ctx(&mut scenario));
            test_scenario::return_shared(drop);
            test_scenario::return_shared(clock);
        };
        test_scenario::end(scenario);
    }

    fun add_item(
        cap: &managed_drop::AdminCap,
        drop: &mut managed_drop::Drop,
        reserved: bool,
        name: vector<u8>,
        image: vector<u8>,
    ) {
        managed_drop::add_item(
            cap,
            drop,
            reserved,
            string::utf8(name),
            string::utf8(b"Description"),
            string::utf8(image),
            vector[],
            vector[],
        );
    }
}
