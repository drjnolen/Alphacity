# LP Share

An unlinked `/lpshare/` configuration page plus a local Windows worker. GitHub Pages
serves static files only. The public page **is discoverable** (including through
this repository); it is not an authenticated server. It contains no recipient
data or private keys. Sensitive controls and records are available only from the
authenticated loopback dashboard.

No hosting/database subscription is required. Sui gas, pool swap fees, and price
impact still apply. Public RPC/aggregator availability and rate limits apply.

## Verified integration

Read-only inspection and claim simulation on October 11, 2026 established:

- Supplied object: `0xc05bc41f0f1113d5a949dfcdf1c69addeb7f4b9660475e43ed78e20233fcb8eb`
- Type: Cetus `lp_burn::CetusLPBurnProof`, handled by `@cetusprotocol/burn-sdk`.
- Embedded position: `0xbd0d71a63c04640f64c9a491561c9b3a1143989f4cd2d93327eca3ab43286117`
- Pool: `0x98636fafb720e06b908f1837f9573539cd949576dfa540b0bc518c15da571330`
- Owner: `0x6da4d96a61b069d1223bb4fa2d23b94ca2ea00db25b709fd9f04fa73656d15b2`
- Tokens: CITY / SUI; CITY has 9 decimals. A SUI → CITY quote was available.
- CITY type: `0x308fa16c7aead43e3a49a4ff2e76205ba2a12697234f4fe80a2da66515284060::city::CITY`

These facts are rechecked at runtime. No mainnet transactions were submitted
during development. No external farm/vesting claim adapters are included; this
position uses the burn-proof fee and pool-incentive collection interface. The
worker never burns, unstakes, closes, or removes liquidity from a position.

## Install and preview

Use Node **24.12 or newer** (the rest of the website can continue using Node 22).
From this directory:

```powershell
npm ci
npm run check
npm test
npm run preview
npm run cli -- simulate
npm start
```

Open `http://127.0.0.1:4318/lpshare/` and enter the local access token printed in
the terminal. It is not the wallet key. It stays in the tab's memory; reloading
requires unlocking again. The public `/lpshare/` page links to this dashboard
without sending it any credentials. Do not expose port 4318 to the internet.

Add wallets/weights, save configuration, and preview. CSV headers are
`label,address,weight` (percent, up to two decimal places); quoted labels are
supported. JSON configuration can also be imported/exported. The public page
downloads configuration; the local dashboard saves it to SQLite. Recipient
addresses cannot be the signing wallet itself: use a separate payout wallet.

Start with the schedule paused. No recipients or schedule dates are prefilled.

## Storage and signer

Default data directory: `%LOCALAPPDATA%\AlphaCity\LPShare`, outside the repository
and OneDrive. SQLite stores configuration versions, run snapshots, signed
transaction payloads/digests, confirmed results, and audit entries. Do not upload
this directory to GitHub or serve it as static content.

Run `./setup-signer.ps1` yourself in PowerShell. It accepts a hidden
`suiprivkey…` key and encrypts it with Windows DPAPI, restricted to the current
Windows user. Do not paste the key into chat, the browser, or a configuration
file. The signer must own the burn proof. The worker supports Ed25519,
Secp256k1, and Secp256r1 Sui keys. Hardware wallets and multisig require a separate
signer integration and are not unattended options in this release.

The signer is a full wallet key, not a scoped delegation. Anyone with access to
the running Windows user can potentially access it and other assets controlled
by that key. The application only builds claim/swap/payout transactions, but this
does not restrict the key on-chain. The burn proof does not allow withdrawing
the burned principal through this application.

For non-Windows deployment, a secret manager may inject `LPSHARE_PRIVATE_KEY` into
the process environment. Never store it in the repository or command history.
`LPSHARE_DATA_DIR` can point to another **local** private directory outside the
repository; DPAPI setup scripts use the default directory. `LPSHARE_RPC` selects
a compatible Sui mainnet gRPC endpoint (not legacy JSON-RPC).

## Activate only after reviewing a preview

Activation is a deliberate local command. Before doing this, confirm recipients,
gas funding, available routes, and your acceptance of unattended signing.

```powershell
npm run cli -- enable-live --accept-mainnet-risk --accept-unpriced-routes
npm start
```

Activation verifies ownership, routes, gas, and a read-only claim simulation.
The aggregator cannot supply an independently verified fair-value price for
this CITY route. **Slippage protection is not price-impact protection.** The
explicit unpriced-routes flag acknowledges that limitation. Default slippage is
0.5%, default gas budget is 0.1 SUI per transaction, and reserve is 1 SUI. Change
limits through configuration if simulations show that more gas is needed.
Routes requiring extra DEEP tokens are excluded. There are no referral fees.

Manual execution: use **Run now** in the local dashboard or `npm run cli -- run`.
The CLI command is itself authorization to execute. For a fixed one-time payout,
use the dashboard's CSV override (`label,address,amount`, decimal CITY), or pass
a JSON recipient array with `amount` strings to `npm run cli -- run fixed.json`.
Overrides replace percentage payouts for that run and never persist as recurring
defaults. Any remainder is recorded against the completed run and stays in the
wallet; it is **not automatically swept into a later run**.

## Biweekly Windows task

After testing a manual run, set the first local date/time and timezone in the
dashboard, then uncheck **Pause scheduled runs** and save. Run
`./install-task.ps1` to register the task. This does not enable live execution.

The task checks every 15 minutes while the Windows user is signed in. Keep the
computer awake and online. Calendar increments preserve the chosen local time
across DST. Ambiguous initial DST times are rejected. After downtime there is
one catch-up run, not one distribution for every missed period. An unfinished
run is resumed first. A manual run consumes the latest due slot if one exists.

Pause in the dashboard to stop future scheduled runs. Manual runs remain
available. To disable signing for both manual and scheduled operations:

```powershell
npm run cli -- disable-live
```

This is checked before each new transaction. Already submitted transactions can
still finish. Remove the task with
`Unregister-ScheduledTask -TaskName 'AlphaCity LP Share' -Confirm:$false`.

## Recovery and accounting

- One SQLite process lock prevents overlapping runs/config writes. A lock from
  a dead process is recovered; a reused live PID conservatively requires waiting
  or operator inspection. Do not use a network drive or run on multiple machines.
- Each run snapshots recipients, settings, and config version. Later edits do
  not change an in-progress run.
- Claims use confirmed balance changes, correcting SUI for net gas cost.
  Swaps spend exact tracked amounts; actual confirmed CITY determines payouts.
  Percentages use integer arithmetic and largest-remainder rounding.
- Signed bytes and digest are committed before broadcast. A timeout causes a
  lookup and only the same signed bytes can be rebroadcast. An unknown lookup
  failure stops processing rather than assuming the transaction did not happen.
- `npm run cli -- status` shows records; `npm run cli -- resume RUN_ID` resumes
  the active run. Confirmed claims, swaps, and payout batches are not replayed.
- Missing routes, gas shortages, and RPC outages retain proceeds and mark the
  run as needing attention. Resolve the cause, then resume. Never claim manually
  while the worker has an unfinished claim or spend its tracked proceeds.
- Fixed-payout shortfalls or the optional `minCity` threshold can hold a run for
  review. Do not delete the run/database to bypass it. Configuration is frozen;
  these cases require an explicit recovery plan after reviewing confirmed
  transactions. Percentage mode with `minCity: "0"` avoids these holds.
- A confirmed failed or expired transaction also needs operator reconciliation;
  this version intentionally does not invent a replacement transaction. Review
  the recorded digest before modifying state. Normal transport retries are
  automatic and bounded; prepared transaction payloads remain recoverable.

Back up the entire data directory **with the server stopped and scheduled task
disabled** so SQLite WAL files are consistent. Restore to the same Windows user
for DPAPI access. Never restore an old backup and resume without reconciling
transactions newer than that backup; old state can otherwise duplicate payments.

## Development and deployment

The website change consists only of `lpshare/index.html`, `style.css`, and
`app.js`. It has no navigation or sitemap links and requests no third-party
scripts or telemetry. Normal GitHub Pages deployment publishes it after merge.
No paid server, hosted database, smart contract deployment, or new domain is
needed. Backend activation remains local and separate from website deployment.

Worker dependencies are independently pinned and locked. Run `npm run check`,
`npm test`, and `npm audit --audit-level=high` here. CI performs these checks on
Node 24. The HTTP tests need loopback access. `src/inspect.ts` is a read-only
integration probe; it does not access a signer. Unit tests mock chain execution;
they do not submit real transactions. Current limitations include no notifications,
no independent price oracle, and no end-to-end mainnet transfer test before
owner setup and approval.
