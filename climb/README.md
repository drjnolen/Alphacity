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

All game art is local to game/public/art and built beneath /climb/assets/art. Bosses and elite types use seventeen individually isolated PNGs with measured SVG framing. No Sites URL, authentication bypass, or image-generation service is needed at runtime.
