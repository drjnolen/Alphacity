# Alpha City Climb

The nine-district tactical game lives at /climb/. The existing GitHub Pages workflow builds it on merge to main; no new hosting service is required.

## Build and test

Run npm ci, then npm run build:climb. This installs the isolated game package from its lockfile, produces /climb/assets/game.js and game.css, copies the art, and bundles the wallet gate. Run npm test and npm run test:climb. Serve the repository root over HTTP to preview /climb/; opening the HTML file directly is not supported.

## Access

Uses /shared/wallet-connector.js and /shared/sui-client.js, the same Sui mainnet connector and data client used elsewhere on the site. A wallet must connect through the shared connector and hold at least 5,000,000 CITY total across its liquid balance and the existing city_staking UserStake objects. All stake pages are counted with BigInt arithmetic. Failed reads deny access. A recent site balance verification (five minutes, same wallet, actual combined balance of at least 5M) opens Climb automatically without another balance request or signature. The Tools portal’s 1M unlocked flag alone never grants Climb access. Missing, malformed, or expired snapshots use fresh verification with a personal-message signature; address-only localStorage never grants access. New verifications refresh the shared session cache. A timer and tab focus refresh holdings once the snapshot expires; wallet changes revoke access immediately. Verification does not submit a transaction.

This is a browser access gate for a static single-player game. The source/assets remain public, and a user who modifies the client can bypass it. It is not server-side authorization or anti-cheat. Before attaching token rewards, NFT minting, or authoritative progression, add a backend that verifies signatures and holdings and validates game actions. In-game minting currently spends only fictional banked credits.

## Saves and gameplay

Saves use alphacity-climb-v1:<wallet-address> in browser localStorage. They are separate per wallet and browser, not synced or stored on chain. Existing equipment in compatible saves is preserved; new inventories start with two choices per slot (Nullblades and Railbreaker for weapons). Other weapon types remain in the mint pool.

Direct player attacks, all damaging signature hits, and enemy hits have a 2% chance of double damage. Each hit rolls independently, after weapon armor reduction/enemy weakening and before player guard. Damage-over-time, hazards, healing, and guard do not critically strike. Combat feedback uses the recorded rolls, including lethal hits. Tests inject deterministic non-critical rolls except dedicated boundary tests.

## Assets

All game art is local to game/public/art and built beneath /climb/assets/art. Browser rendering uses high-quality WebP copies at the original dimensions, including seventeen individually isolated commander images with measured SVG framing. Original PNGs remain available for cached older clients and future exports. No Sites URL, authentication bypass, or image-generation service is needed at runtime.

## Expedition builds

Each class now has two four-node doctrine branches. Bosses grant insight and offer calibration, active, or passive overclock choices. Use Expedition doctrine to learn talents and equip up to three gear abilities alongside the signature. All choices reset at the end of the climb. See [EXPEDITION-BUILDS.md](./EXPEDITION-BUILDS.md) for mechanics, limits, and validation.

Campaigns now restart in district 1 with all operatives at level 1 after death, manual ending, or final completion. Only minted equipment survives, alongside the standard starter kit. Use **End campaign** during play or beside **Resume operation** in the safehouse; confirmation explains the reset. Active legacy saves continue until their campaign ends. See [EXPEDITION-BUILDS.md](./EXPEDITION-BUILDS.md) for the full persistence rules.

## Loading performance

The 33 runtime images total 10,911,798 bytes instead of 59,870,166 bytes (81.8% less). The seven artwork files requested by the initial operation screen total 2,309,106 bytes instead of 15,938,388 bytes (85.5% less). These are asset-transfer measurements, not end-to-end load-time guarantees: connection speed, wallet prompts and RPC availability still matter.

WebP exports use quality 90, preserve image dimensions and exact alpha channels, and keep existing sprite crop coordinates. Regenerate with `python climb/scripts/optimize-art.py` using Pillow with WebP support. The checked-in manifest records sizes, dimensions and hashes; CI needs no image encoder.

The entrance uses its own small stylesheet. Wallet scripts defer execution until HTML is parsed. Once holdings qualify, game JavaScript and CSS download together while a fresh session completes its ownership prompt. Mounting still waits for ownership verification and the final holdings check; cached eligible sessions still reuse the existing site verification. Failed stylesheet loads time out with a retryable message. Liquid and paginated staking reads run concurrently, still requiring both to succeed.

No combat rules, balances, progression, save format or access thresholds changed. Validation covers asset identity/dimensions, loader readiness and retry, cached-session entry, disconnect races, fresh-session authorization, stake pagination, original art framing, terrain movement and critical damage.
