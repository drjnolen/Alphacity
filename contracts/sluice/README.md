# Sluice V2

Sluice V2 adds a new `sluice_v2` module without removing the deployed V1 module. Existing V1 shared objects therefore remain claimable after the upgrade.

## Contract guarantees

- Time schedules and explicit market-cap, FDV, price, liquidity, 24-hour volume, holder-count, and custom trigger identifiers.
- `>=` and `<=` trigger comparisons.
- Domain-separated, schedule-bound Ed25519 observation messages.
- Configurable threshold signatures with unique, indexed oracle keys.
- Fresh, monotonic observations and an on-chain continuous-validation window that resets after a failed observation or excessive gap.
- An immutable trigger deadline that rejects later observations and resolves to creator-refund or activation fallback.
- Permissionless claiming that always pays the current beneficiary.
- Cancellation that pays all already vested entitlement before returning only unvested tokens to the creator.
- Direct beneficiary reassignment and bounded bearer-link reassignment signatures.

## Local verification

Use a current mainnet Sui CLI:

```powershell
sui move test --path contracts/sluice
```

The mainnet upgrade can be verified without spending gas:

```powershell
sui client upgrade contracts/sluice `
  --upgrade-capability 0x5be9024298c5ec6af3d128550c3c858f2188b19e7875a6cfbd239ffe966250c7 `
  --dry-run `
  --json
```

The final July 20, 2026 dry-run succeeded on mainnet with Sui CLI 1.75.2. It estimated a net balance change of `0.075371540 SUI`.

V2 was published as package `0xa95f0f0860baab092b26a8f19190ccd0c11f07d76513a8c32a5dcc0fd7f47b91` on July 21, 2026. Upgrade transaction `BtLrmTMmuuSRHDZC5rowaYKEtXPHoqnqYdSuoKpBRbuk` succeeded and charged `0.074393420 SUI`.

## Mainnet rollout

1. Generate an oracle key and a separate relayer gas key locally:

   ```powershell
   node scripts/sluice-keygen.js 1
   ```

   A one-key policy is the no-cost operational baseline. For a genuinely independent threshold policy, generate keys on separately operated systems and never colocate all private keys in one GitHub secret.

2. Upgrade package V1 with the recorded UpgradeCap. This was completed on July 21, 2026; retain the command below for auditing future upgrades:

   ```powershell
   sui client upgrade contracts/sluice `
     --upgrade-capability 0x5be9024298c5ec6af3d128550c3c858f2188b19e7875a6cfbd239ffe966250c7 `
     --json
   ```

3. Copy the newly published package ID from the successful upgrade output. Do not use the hypothetical package ID shown by an earlier dry-run.

4. Add these public GitHub Actions repository variables:

   - `SLUICE_V2_PACKAGE_ADDRESS`: the newly published V2 package ID.
   - `SLUICE_LEGACY_PACKAGE_ADDRESS`: `0x7c7ca3da6bad849a02d9f888b2f8cab40d507b2c01bbcab3f2d816334c17aa07`.
   - `SLUICE_ORACLE_PUBLIC_KEYS`: comma-separated raw 32-byte hex public keys from the key generator.
   - `SLUICE_ORACLE_THRESHOLD`: the on-chain signature threshold, initially `1` for the single-oracle baseline.
   - `SUI_GRAPHQL_URL` and `SUI_GRPC_URL` are optional; blank values use Mysten's public mainnet endpoints.

5. Add these GitHub Actions secrets:

   - `SLUICE_ORACLE_PRIVATE_KEYS`: comma-separated `suiprivkey...` oracle keys.
   - `SLUICE_RELAYER_PRIVATE_KEY`: the separate `suiprivkey...` transaction sponsor key.

6. Fund only the printed relayer gas address with a deliberately small SUI operating balance. It never needs custody of vested tokens.

7. Manually run **Sluice Vesting Relayer Bot**. A missing secret, unsupported schedule, unavailable true market cap, insufficient liquidity, signing-policy mismatch, or failed transaction makes the job red.

8. Run the Pages deployment after variables are configured. Its build generates `sluice/config.js`; the committed default intentionally disables V2 creation until then.

9. Create a small mainnet canary schedule with a short validation window, observe at least two direct observation transactions, wait for on-chain activation, claim, and test cancellation before enabling larger schedules.

## Trigger data policy

The included no-cost relayer services trigger kinds 1–5 through DexScreener. It requires the schedule coin to exactly match the primary pair's base token and selects the matching pair with the highest reported USD liquidity. It never estimates market cap from liquidity and never substitutes FDV for an unavailable market cap. The Create flow performs this same exact feed/metric/liquidity check before asking the wallet to commit funds, while the relayer rechecks every observation.

Holder-count and custom triggers are implemented at contract level but require a separately defined and operated observation provider. The canonical config hash prevents this relayer from silently servicing a schedule with different feed rules.

## Operational limits

GitHub scheduled workflows are not guaranteed to start exactly on time. The contract's maximum sample gap makes delays fail safe by restarting continuity, but delays can postpone activation. A continuously scheduled Cloudflare Worker or other funded keeper is the recommended production reliability upgrade after the canary phase.

## Relayer reliability and upgrades

The relayer resolves `VestingScheduleV2`'s defining package from the configured implementation's on-chain type-origin table before scanning objects. Sui preserves that type identity across package upgrades. Discovery uses the defining ID; transaction calls use `SLUICE_V2_PACKAGE_ADDRESS`. An absent type-origin entry or incomplete indexer response fails the run instead of silently reporting an empty scan. Pagination rejects missing/repeated cursors and deduplicates overlapping pages.

GraphQL and market-feed reads have a 15-second deadline covering both headers and the JSON body. Network errors, timeouts, HTTP 429, and server errors receive at most three attempts with bounded backoff. Signed transactions are not automatically retried. Same-token market data is shared for at most 30 seconds, retains its original acquisition timestamp, and is evicted after a failed request. Before signing, the relayer checks the schedule's freshness limit, replay boundary, and deadline again. A malformed schedule is reported without preventing later valid schedules from being serviced.

The workflow installs only locked runtime dependencies and skips installation scripts. These relayer changes require no new repository variables, contract publication, or frontend changes.

### Production review: September 11, 2026 (America/Denver)

- Read-only mainnet discovery returned two V2 canaries, one completed and one cancelled; there were no pending schedules. A green empty scan verifies discovery/configuration, not sustained-trigger timing under load.
- The three reviewed successful workflow starts were `2026-09-11T21:14:17Z`, `2026-09-11T23:21:38Z`, and `2026-09-12T01:18:01Z`. Those roughly two-hour gaps exceed the Create form's 20-minute default maximum sample gap despite the configured 15-minute cron. Use a keeper with reliably shorter gaps before depending on continuous market-trigger activation. Widening the allowed gap changes the validation policy and is not a substitute for frequent observations.
- The configured implementation remains the July package `0xa95f0f0860baab092b26a8f19190ccd0c11f07d76513a8c32a5dcc0fd7f47b91`. The contract deadline protection merged in PR #132 is not made active merely by merging source code. Complete the package upgrade and deployment configuration rollout before relying on that protection. Old published implementations remain callable under Sui's upgrade model; stronger migration enforcement would need a separate contract design review.

No mainnet transaction or key rotation was performed during this backend review.
