# AlphaCity managed drop template

Each curated project receives a fresh publication of this package, producing a unique NFT type. The package implements fixed-price SUI mint stages, per-wallet limits, optional on-chain allowlists, creator-reserved inventory, a disclosed primary-sale fee split, pausing, and Sui Object Display V2 metadata.

The package is intentionally non-custodial for primary proceeds: every mint transaction transfers the creator share directly to the configured creator address and the platform share directly to the configured AlphaCity treasury.

`royalty_bps` is embedded as collection/NFT metadata for marketplaces to read. This template does not claim to enforce royalties on unrestricted peer-to-peer transfers.

Use `node scripts/launchpad-project.cjs prepare <project-directory> --treasury <address>` to validate assets and generate a project-specific package plus initialization plan. Publishing remains an explicit multisig or hardware-wallet operation.
