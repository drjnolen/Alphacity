module city_tech::city_tech {
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::transfer;
    use std::string::{Self, String};
    use sui::package;
    use sui::display;

    /// One-Time-Witness to claim Publisher capability.
    public struct CITY_TECH has drop {}

    /// Capability required to mint NFTs in this collection.
    public struct MintCap has key, store {
        id: UID,
    }

    /// The NFT struct representing a Biologic Upgrade.
    public struct BiologicUpgrade has key, store {
        id: UID,
        name: String,
        description: String,
        image_url: String,
        rarity: String,
        amp: u64,
    }

    fun init(otw: CITY_TECH, ctx: &mut TxContext) {
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"link"),
            string::utf8(b"image_url"),
            string::utf8(b"description"),
            string::utf8(b"project_url"),
            string::utf8(b"creator"),
            string::utf8(b"rarity"),
            string::utf8(b"amp"),
        ];

        let values = vector[
            string::utf8(b"{name}"),
            string::utf8(b"https://alphacity.io/tech/{id}"),
            string::utf8(b"{image_url}"),
            string::utf8(b"{description}"),
            string::utf8(b"https://alphacity.io"),
            string::utf8(b"Alpha City Tech Lab"),
            string::utf8(b"{rarity}"),
            string::utf8(b"{amp}"),
        ];

        let publisher = package::claim(otw, ctx);
        let mut display = display::new_with_fields<BiologicUpgrade>(
            &publisher, keys, values, ctx
        );

        // Commit first version of display to apply rules
        display::update_version(&mut display);

        let deployer = tx_context::sender(ctx);
        transfer::public_transfer(publisher, deployer);
        transfer::public_transfer(display, deployer);

        // Create and transfer MintCap to the deployer
        let mint_cap = MintCap {
            id: object::new(ctx),
        };
        transfer::public_transfer(mint_cap, deployer);
    }

    /// Mint a single NFT to a recipient. Only the holder of the MintCap can do this.
    public fun mint_to(
        _cap: &MintCap,
        name: String,
        description: String,
        image_url: String,
        rarity: String,
        amp: u64,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let nft = BiologicUpgrade {
            id: object::new(ctx),
            name,
            description,
            image_url,
            rarity,
            amp,
        };
        transfer::public_transfer(nft, recipient);
    }

    /// Batch mint multiple NFTs in a single transaction. Only the holder of the MintCap can do this.
    public fun mint_batch(
        _cap: &MintCap,
        names: vector<String>,
        descriptions: vector<String>,
        image_urls: vector<String>,
        rarities: vector<String>,
        amps: vector<u64>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let len = vector::length(&names);
        let mut i = 0;
        while (i < len) {
            let name = *vector::borrow(&names, i);
            let description = *vector::borrow(&descriptions, i);
            let image_url = *vector::borrow(&image_urls, i);
            let rarity = *vector::borrow(&rarities, i);
            let amp = *vector::borrow(&amps, i);
            
            let nft = BiologicUpgrade {
                id: object::new(ctx),
                name,
                description,
                image_url,
                rarity,
                amp,
            };
            transfer::public_transfer(nft, recipient);
            i = i + 1;
        }
    }
}
