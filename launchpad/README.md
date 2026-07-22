# AlphaCity managed launchpad

The launchpad is deliberately a concierge workflow. Projects send AlphaCity a project manifest, metadata CSV, and media directory; AlphaCity validates the package, publishes one managed-drop package for that project, and registers the resulting collection on `/launchpad`.

## Components

- `/launchpad/` is the public multi-collection mint page. Collections in `coming-soon` mode remain non-transactional. Collections in `managed-drop` mode read their shared `Drop` object and build the Sui mint transaction through the universal wallet connector.
- `/launchpad/operator/` is a browser-based intake and review workspace. It validates locally and exports JSON; it does not upload, publish, or sign.
- `shared/launchpad-core.js` is the common deterministic parser, validator, SUI/MIST converter, and bundle generator used by both browser and Node workflows.
- `scripts/launchpad-project.cjs` validates an intake directory and generates a project-specific Move package, public collection config, and ordered transaction plan.
- `contracts/managed_drop_template/` is the audited starting point for each unique collection package.

## Intake directory

```text
project-directory/
├── project.json
├── metadata.csv
└── media/
    ├── hero.png
    ├── 001.png
    └── 002.png
```

The CSV requires `Name`, `Description`, `File Name`, and `Reserve For Creator`. Trait columns use `attributes[Trait name]`. Filenames are case-insensitively matched to media; duplicates, missing files, unsupported formats, invalid addresses, invalid stage windows, excessive fees, and supply/allocation mismatches fail validation.

```powershell
npm run launchpad:validate -- C:\path\to\project
npm run launchpad:prepare -- C:\path\to\project --treasury 0x... --media-base-url https://permanent.example/collection
```

Preparation refuses to overwrite a non-empty output directory. It never reads a private key and never signs or publishes.

## Publication checklist

1. Review project rights, payout address, disclosures, hosted assets, and metadata.
2. Prefer content-addressed permanent media; verify every generated URL.
3. Build and test the generated Move package using the repository-pinned Sui framework.
4. Publish with an AlphaCity multisig or hardware wallet. Do not paste a private key into the site, CLI arguments, source tree, or support chat.
5. Create Object Display V2 metadata, the shared Drop, stages, allowlists, and inventory using the generated transaction plan.
6. Dry-run representative public and allowlist mints. Verify direct creator/platform proceeds, wallet limits, reserved minting, pause behavior, and explorer display.
7. Run `publish_drop` only after final review; it permanently locks stages and inventory.
8. Put the package and Drop IDs into `collection.json`, add it to `collections/index.json`, and run the full build and test suite.

## Contract boundaries

- Primary mint proceeds are non-custodial: the contract splits SUI directly to the creator and AlphaCity treasury.
- The AdminCap is bound to one Drop and controls setup, pause state, and reserved mints. Hold it in a multisig for production.
- Public metadata and mint rules lock at `publish_drop`.
- `royalty_bps` is NFT metadata. This template does not claim to enforce royalties on unrestricted peer-to-peer transfers.
- Delayed reveal, gas sponsorship, escrowed proceeds, arbitrary payment coins, and permissionless creator publishing are intentionally outside this first draft.
