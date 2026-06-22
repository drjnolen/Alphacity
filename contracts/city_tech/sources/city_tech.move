module city_tech::city_tech {
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::transfer;
    use std::string::{Self, String};
    use sui::package;
    use sui::display;
    use sui::vec_map::{Self, VecMap};
    use std::vector;

    /// One-Time-Witness to claim Publisher capability.
    public struct CITY_TECH has drop {}

    /// Capability required to mint NFTs in this collection.
    public struct MintCap has key, store {
        id: UID,
    }

    /// The NFT struct representing a City Tech item.
    public struct CityTech has key, store {
        id: UID,
        name: String,
        description: String,
        image_url: String,
        attributes: VecMap<String, String>, // Using VecMap for standard wallet/explorer traits support
    }

    fun init(otw: CITY_TECH, ctx: &mut TxContext) {
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"link"),
            string::utf8(b"image_url"),
            string::utf8(b"description"),
            string::utf8(b"project_url"),
            string::utf8(b"creator"),
            string::utf8(b"attributes"),
            string::utf8(b"collection_name"),
            string::utf8(b"collection_description"),
            string::utf8(b"collection_image_url"),
        ];

        let values = vector[
            string::utf8(b"{name}"),
            string::utf8(b"https://alphacity.tech/gear/{id}"),
            string::utf8(b"{image_url}"),
            string::utf8(b"{description}"),
            string::utf8(b"https://alphacity.tech"),
            string::utf8(b"Alpha City"),
            string::utf8(b"{attributes}"),
            string::utf8(b"City Tech"),
            string::utf8(b"A collection of mysterious items. Something tells you they're important."),
            string::utf8(b"https://alphacity.tech/assets/city-tech/Peerless.png"),
        ];

        let publisher = package::claim(otw, ctx);
        let mut display = display::new_with_fields<CityTech>(
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
        attribute_keys: vector<String>,
        attribute_values: vector<String>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let mut attributes = vec_map::empty<String, String>();
        let len = vector::length(&attribute_keys);
        let mut i = 0;
        while (i < len) {
            let key = *vector::borrow(&attribute_keys, i);
            let value = *vector::borrow(&attribute_values, i);
            vec_map::insert(&mut attributes, key, value);
            i = i + 1;
        };

        let nft = CityTech {
            id: object::new(ctx),
            name,
            description,
            image_url,
            attributes,
        };
        transfer::public_transfer(nft, recipient);
    }

    /// Batch mint multiple NFTs in a single transaction. Only the holder of the MintCap can do this.
    public fun mint_batch(
        _cap: &MintCap,
        names: vector<String>,
        descriptions: vector<String>,
        image_urls: vector<String>,
        attribute_keys_flat: vector<String>,
        attribute_values_flat: vector<String>,
        attributes_sizes: vector<u64>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let len = vector::length(&names);
        let mut i = 0;
        let mut flat_index = 0;
        while (i < len) {
            let name = *vector::borrow(&names, i);
            let description = *vector::borrow(&descriptions, i);
            let image_url = *vector::borrow(&image_urls, i);
            let size = *vector::borrow(&attributes_sizes, i);
            
            let mut attributes = vec_map::empty<String, String>();
            let mut j = 0;
            while (j < size) {
                let key = *vector::borrow(&attribute_keys_flat, flat_index);
                let value = *vector::borrow(&attribute_values_flat, flat_index);
                vec_map::insert(&mut attributes, key, value);
                flat_index = flat_index + 1;
                j = j + 1;
            };

            let nft = CityTech {
                id: object::new(ctx),
                name,
                description,
                image_url,
                attributes,
            };
            transfer::public_transfer(nft, recipient);
            i = i + 1;
        }
    }

    /// Burn a City Tech NFT. Anyone who owns their NFT can burn it.
    public fun burn(nft: CityTech) {
        let CityTech { id, name: _, description: _, image_url: _, attributes: _ } = nft;
        object::delete(id);
    }
}
