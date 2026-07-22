module managed_drop_template::managed_drop {
    use std::string::{Self, String};
    use std::vector;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::display_registry::{Self, DisplayRegistry};
    use sui::dynamic_field;
    use sui::event;
    use sui::object::{Self, ID, UID};
    use sui::package::{Self, Publisher};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::vec_map::{Self, VecMap};

    const MAX_PLATFORM_FEE_BPS: u64 = 2_500;
    const BPS_DENOMINATOR: u64 = 10_000;
    const MAX_MINT_QUANTITY: u64 = 50;

    const E_NOT_AUTHORIZED: u64 = 0;
    const E_INVALID_CONFIG: u64 = 1;
    const E_ALREADY_PUBLISHED: u64 = 2;
    const E_NOT_PUBLISHED: u64 = 3;
    const E_PAUSED: u64 = 4;
    const E_STAGE_NOT_FOUND: u64 = 5;
    const E_STAGE_CLOSED: u64 = 6;
    const E_INVALID_PAYMENT: u64 = 7;
    const E_WALLET_LIMIT: u64 = 8;
    const E_NOT_ALLOWLISTED: u64 = 9;
    const E_SOLD_OUT: u64 = 10;
    const E_INVENTORY_INCOMPLETE: u64 = 11;
    const E_STAGE_ALLOCATION: u64 = 12;
    const E_INVALID_QUANTITY: u64 = 13;

    /// One-time witness used to claim the package Publisher capability.
    public struct MANAGED_DROP has drop {}

    /// Administrative authority for one shared Drop object.
    public struct AdminCap has key, store {
        id: UID,
        drop_id: ID,
    }

    /// A curated collection. Metadata inventory and per-wallet state are kept
    /// as dynamic fields so the shared object's base size remains bounded.
    public struct Drop has key {
        id: UID,
        name: String,
        description: String,
        creator: address,
        platform_treasury: address,
        platform_fee_bps: u64,
        royalty_bps: u64,
        total_supply: u64,
        public_supply: u64,
        reserved_supply: u64,
        loaded_public: u64,
        loaded_reserved: u64,
        minted_public: u64,
        minted_reserved: u64,
        paused: bool,
        published: bool,
        stages: vector<MintStage>,
    }

    public struct MintStage has store, drop {
        id: u64,
        name: String,
        price_mist: u64,
        start_time_ms: u64,
        end_time_ms: u64,
        wallet_limit: u64,
        allocation: u64,
        minted: u64,
        allowlist_only: bool,
    }

    public struct ItemData has store {
        name: String,
        description: String,
        image_url: String,
        attribute_keys: vector<String>,
        attribute_values: vector<String>,
    }

    public struct NFT has key, store {
        id: UID,
        collection_id: address,
        name: String,
        description: String,
        image_url: String,
        attributes: VecMap<String, String>,
        royalty_bps: u64,
    }

    public struct ItemKey has copy, drop, store {
        reserved: bool,
        index: u64,
    }

    public struct WalletMintKey has copy, drop, store {
        stage_id: u64,
        wallet: address,
    }

    public struct AllowlistKey has copy, drop, store {
        stage_id: u64,
        wallet: address,
    }

    public struct DropCreated has copy, drop {
        drop_id: address,
        creator: address,
        public_supply: u64,
        reserved_supply: u64,
        platform_fee_bps: u64,
    }

    public struct DropPublished has copy, drop {
        drop_id: address,
        stage_count: u64,
    }

    public struct Minted has copy, drop {
        drop_id: address,
        buyer: address,
        stage_id: u64,
        quantity: u64,
        total_paid_mist: u64,
        first_item_index: u64,
    }

    public struct ReservedMinted has copy, drop {
        drop_id: address,
        recipient: address,
        quantity: u64,
        first_item_index: u64,
    }

    fun init(otw: MANAGED_DROP, ctx: &mut TxContext) {
        package::claim_and_keep(otw, ctx);
    }

    /// Creates the on-chain collection shell and binds an AdminCap to it.
    #[allow(lint(self_transfer))]
    public fun create_drop(
        name: String,
        description: String,
        creator: address,
        platform_treasury: address,
        platform_fee_bps: u64,
        royalty_bps: u64,
        public_supply: u64,
        reserved_supply: u64,
        ctx: &mut TxContext,
    ) {
        assert!(creator != @0x0 && platform_treasury != @0x0, E_INVALID_CONFIG);
        assert!(public_supply > 0, E_INVALID_CONFIG);
        assert!(platform_fee_bps <= MAX_PLATFORM_FEE_BPS, E_INVALID_CONFIG);
        assert!(royalty_bps <= BPS_DENOMINATOR, E_INVALID_CONFIG);
        let drop = Drop {
            id: object::new(ctx),
            name,
            description,
            creator,
            platform_treasury,
            platform_fee_bps,
            royalty_bps,
            total_supply: public_supply + reserved_supply,
            public_supply,
            reserved_supply,
            loaded_public: 0,
            loaded_reserved: 0,
            minted_public: 0,
            minted_reserved: 0,
            paused: false,
            published: false,
            stages: vector[],
        };
        let drop_id = object::id(&drop);
        event::emit(DropCreated {
            drop_id: object::id_address(&drop),
            creator,
            public_supply,
            reserved_supply,
            platform_fee_bps,
        });
        transfer::public_transfer(AdminCap { id: object::new(ctx), drop_id }, ctx.sender());
        transfer::share_object(drop);
    }

    /// Creates Sui Object Display V2 metadata. Call once after publication,
    /// passing the package Publisher and the system DisplayRegistry at 0xd.
    #[allow(lint(self_transfer))]
    public fun create_display(
        publisher: &mut Publisher,
        registry: &mut DisplayRegistry,
        ctx: &mut TxContext,
    ) {
        let (mut display, cap) = display_registry::new_with_publisher<NFT>(registry, publisher, ctx);
        display_registry::set(&mut display, &cap, string::utf8(b"name"), string::utf8(b"{name}"));
        display_registry::set(&mut display, &cap, string::utf8(b"description"), string::utf8(b"{description}"));
        display_registry::set(&mut display, &cap, string::utf8(b"image_url"), string::utf8(b"{image_url}"));
        display_registry::set(&mut display, &cap, string::utf8(b"link"), string::utf8(b"https://alphacity.tech/launchpad"));
        display_registry::set(&mut display, &cap, string::utf8(b"attributes"), string::utf8(b"{attributes}"));
        display_registry::share(display);
        transfer::public_transfer(cap, ctx.sender());
    }

    public fun add_stage(
        cap: &AdminCap,
        drop: &mut Drop,
        name: String,
        price_mist: u64,
        start_time_ms: u64,
        end_time_ms: u64,
        wallet_limit: u64,
        allocation: u64,
        allowlist_only: bool,
    ) {
        authorize(cap, drop);
        assert!(!drop.published, E_ALREADY_PUBLISHED);
        assert!(wallet_limit > 0, E_INVALID_CONFIG);
        assert!(end_time_ms == 0 || end_time_ms > start_time_ms, E_INVALID_CONFIG);
        assert!(allocation == 0 || allocation <= drop.public_supply, E_INVALID_CONFIG);
        let id = vector::length(&drop.stages);
        vector::push_back(&mut drop.stages, MintStage {
            id,
            name,
            price_mist,
            start_time_ms,
            end_time_ms,
            wallet_limit,
            allocation,
            minted: 0,
            allowlist_only,
        });
    }

    public fun add_allowlist(
        cap: &AdminCap,
        drop: &mut Drop,
        stage_id: u64,
        wallet: address,
        limit: u64,
    ) {
        authorize(cap, drop);
        assert!(!drop.published, E_ALREADY_PUBLISHED);
        assert!(stage_id < vector::length(&drop.stages) && wallet != @0x0 && limit > 0, E_INVALID_CONFIG);
        let key = AllowlistKey { stage_id, wallet };
        if (dynamic_field::exists(&drop.id, key)) {
            *dynamic_field::borrow_mut<AllowlistKey, u64>(&mut drop.id, key) = limit;
        } else {
            dynamic_field::add(&mut drop.id, key, limit);
        };
    }

    /// Uploads one metadata record. The operator CLI batches many calls in a
    /// programmable transaction while preserving deterministic item order.
    public fun add_item(
        cap: &AdminCap,
        drop: &mut Drop,
        reserved: bool,
        name: String,
        description: String,
        image_url: String,
        attribute_keys: vector<String>,
        attribute_values: vector<String>,
    ) {
        authorize(cap, drop);
        assert!(!drop.published, E_ALREADY_PUBLISHED);
        assert!(vector::length(&attribute_keys) == vector::length(&attribute_values), E_INVALID_CONFIG);
        let index = if (reserved) {
            assert!(drop.loaded_reserved < drop.reserved_supply, E_INVALID_CONFIG);
            let index = drop.loaded_reserved;
            drop.loaded_reserved = index + 1;
            index
        } else {
            assert!(drop.loaded_public < drop.public_supply, E_INVALID_CONFIG);
            let index = drop.loaded_public;
            drop.loaded_public = index + 1;
            index
        };
        dynamic_field::add(&mut drop.id, ItemKey { reserved, index }, ItemData {
            name,
            description,
            image_url,
            attribute_keys,
            attribute_values,
        });
    }

    /// Permanently locks metadata inventory and mint rules for public minting.
    public fun publish_drop(cap: &AdminCap, drop: &mut Drop) {
        authorize(cap, drop);
        assert!(!drop.published, E_ALREADY_PUBLISHED);
        assert!(drop.loaded_public == drop.public_supply, E_INVENTORY_INCOMPLETE);
        assert!(drop.loaded_reserved == drop.reserved_supply, E_INVENTORY_INCOMPLETE);
        assert!(vector::length(&drop.stages) > 0, E_INVALID_CONFIG);
        drop.published = true;
        event::emit(DropPublished { drop_id: object::id_address(drop), stage_count: vector::length(&drop.stages) });
    }

    public fun set_paused(cap: &AdminCap, drop: &mut Drop, paused: bool) {
        authorize(cap, drop);
        drop.paused = paused;
    }

    /// Public fixed-price SUI mint. The supplied Coin must exactly match the
    /// stage price times quantity; proceeds split immediately in this call.
    public fun mint(
        drop: &mut Drop,
        clock: &Clock,
        payment: Coin<SUI>,
        stage_id: u64,
        quantity: u64,
        ctx: &mut TxContext,
    ) {
        assert!(drop.published, E_NOT_PUBLISHED);
        assert!(!drop.paused, E_PAUSED);
        assert!(quantity > 0 && quantity <= MAX_MINT_QUANTITY, E_INVALID_QUANTITY);
        assert!(stage_id < vector::length(&drop.stages), E_STAGE_NOT_FOUND);
        assert!(drop.minted_public + quantity <= drop.public_supply, E_SOLD_OUT);

        let now = clock::timestamp_ms(clock);
        let stage = vector::borrow(&drop.stages, stage_id);
        let price_mist = stage.price_mist;
        let start_time_ms = stage.start_time_ms;
        let end_time_ms = stage.end_time_ms;
        let wallet_limit = stage.wallet_limit;
        let allocation = stage.allocation;
        let stage_minted = stage.minted;
        let allowlist_only = stage.allowlist_only;
        assert!(now >= start_time_ms && (end_time_ms == 0 || now < end_time_ms), E_STAGE_CLOSED);
        assert!(allocation == 0 || stage_minted + quantity <= allocation, E_STAGE_ALLOCATION);

        let buyer = tx_context::sender(ctx);
        let wallet_key = WalletMintKey { stage_id, wallet: buyer };
        let prior = if (dynamic_field::exists(&drop.id, wallet_key)) {
            *dynamic_field::borrow<WalletMintKey, u64>(&drop.id, wallet_key)
        } else {
            0
        };
        let effective_limit = if (allowlist_only) {
            let allowlist_key = AllowlistKey { stage_id, wallet: buyer };
            assert!(dynamic_field::exists(&drop.id, allowlist_key), E_NOT_ALLOWLISTED);
            let allowlist_limit = *dynamic_field::borrow<AllowlistKey, u64>(&drop.id, allowlist_key);
            if (allowlist_limit < wallet_limit) allowlist_limit else wallet_limit
        } else {
            wallet_limit
        };
        assert!(prior + quantity <= effective_limit, E_WALLET_LIMIT);

        let total_paid = price_mist * quantity;
        assert!(coin::value(&payment) == total_paid, E_INVALID_PAYMENT);
        if (dynamic_field::exists(&drop.id, wallet_key)) {
            *dynamic_field::borrow_mut<WalletMintKey, u64>(&mut drop.id, wallet_key) = prior + quantity;
        } else {
            dynamic_field::add(&mut drop.id, wallet_key, quantity);
        };

        let first_item_index = drop.minted_public;
        vector::borrow_mut(&mut drop.stages, stage_id).minted = stage_minted + quantity;
        drop.minted_public = first_item_index + quantity;
        mint_items(drop, false, first_item_index, quantity, buyer, ctx);
        split_payment(drop, payment, total_paid, ctx);
        event::emit(Minted {
            drop_id: object::id_address(drop),
            buyer,
            stage_id,
            quantity,
            total_paid_mist: total_paid,
            first_item_index,
        });
    }

    public fun mint_reserved(
        cap: &AdminCap,
        drop: &mut Drop,
        recipient: address,
        quantity: u64,
        ctx: &mut TxContext,
    ) {
        authorize(cap, drop);
        assert!(drop.published, E_NOT_PUBLISHED);
        assert!(recipient != @0x0 && quantity > 0 && quantity <= MAX_MINT_QUANTITY, E_INVALID_QUANTITY);
        assert!(drop.minted_reserved + quantity <= drop.reserved_supply, E_SOLD_OUT);
        let first_item_index = drop.minted_reserved;
        drop.minted_reserved = first_item_index + quantity;
        mint_items(drop, true, first_item_index, quantity, recipient, ctx);
        event::emit(ReservedMinted { drop_id: object::id_address(drop), recipient, quantity, first_item_index });
    }

    public fun burn(nft: NFT) {
        let NFT { id, collection_id: _, name: _, description: _, image_url: _, attributes: _, royalty_bps: _ } = nft;
        object::delete(id);
    }

    fun authorize(cap: &AdminCap, drop: &Drop) {
        assert!(cap.drop_id == object::id(drop), E_NOT_AUTHORIZED);
    }

    fun mint_items(
        drop: &mut Drop,
        reserved: bool,
        first_index: u64,
        quantity: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        let mut offset = 0;
        while (offset < quantity) {
            let item = dynamic_field::remove<ItemKey, ItemData>(
                &mut drop.id,
                ItemKey { reserved, index: first_index + offset },
            );
            let ItemData { name, description, image_url, mut attribute_keys, mut attribute_values } = item;
            let mut attributes = vec_map::empty<String, String>();
            while (!vector::is_empty(&attribute_keys)) {
                vec_map::insert(
                    &mut attributes,
                    vector::pop_back(&mut attribute_keys),
                    vector::pop_back(&mut attribute_values),
                );
            };
            transfer::public_transfer(NFT {
                id: object::new(ctx),
                collection_id: object::id_address(drop),
                name,
                description,
                image_url,
                attributes,
                royalty_bps: drop.royalty_bps,
            }, recipient);
            offset = offset + 1;
        };
    }

    fun split_payment(drop: &Drop, payment: Coin<SUI>, total_paid: u64, ctx: &mut TxContext) {
        let mut creator_payment = payment;
        let platform_amount = total_paid * drop.platform_fee_bps / BPS_DENOMINATOR;
        if (platform_amount > 0) {
            let platform_payment = coin::split(&mut creator_payment, platform_amount, ctx);
            transfer::public_transfer(platform_payment, drop.platform_treasury);
        };
        transfer::public_transfer(creator_payment, drop.creator);
    }

    // Read helpers for tests and composability.
    public fun drop_id(drop: &Drop): ID { object::id(drop) }
    public fun is_published(drop: &Drop): bool { drop.published }
    public fun is_paused(drop: &Drop): bool { drop.paused }
    public fun minted_public(drop: &Drop): u64 { drop.minted_public }
    public fun minted_reserved(drop: &Drop): u64 { drop.minted_reserved }
    public fun public_supply(drop: &Drop): u64 { drop.public_supply }
    public fun reserved_supply(drop: &Drop): u64 { drop.reserved_supply }
    public fun stage_minted(drop: &Drop, stage_id: u64): u64 { vector::borrow(&drop.stages, stage_id).minted }
}
