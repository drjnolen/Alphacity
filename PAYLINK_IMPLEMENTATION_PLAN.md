# Alpha City Paylink — Implementation Plan

Status: implementation-ready proposal
Prepared: July 14, 2026
Target network: Sui Mainnet
Working product name: **Alpha City Paylink**
Route: `/pay/`

## 1. Executive decision

Build a CITY-gated creator console that lets an authorized user generate a standards-based Sui payment request, render it as a QR code, share it as a Slush universal link, and monitor whether it has been paid.

The Alpha City application remains gated exactly like Analyze, Sluice, and Airdrop. The payment link itself is not an Alpha City page: it points directly to the public `https://my.slush.app/pay?...` flow. This preserves the requested CITY gate for tool access without requiring every customer who pays an invoice to hold 5,000,000 CITY.

The MVP will use a dedicated Payment Kit registry with registry-managed funds disabled:

- Payments go directly from the payer to the invoice receiver.
- Alpha City never takes custody of payment funds.
- The registry creates an onchain `PaymentRecord` for reliable status checks.
- The composite payment key prevents the same invoice from being paid twice while its record exists.
- The registry ID is included in every generated payment URI.
- The registry admin capability is held by an Alpha City operations wallet and later transferred to a project multisig.

No custom Move package and no application backend are required for the MVP.

## 2. Product goals

### Primary goals

1. Let a gated user create a correct payment request in under one minute.
2. Eliminate manual copying of wallet addresses, coin types, and amounts for the payer.
3. Make each request uniquely identifiable through a nonce.
4. Give the creator a reliable pending/paid state tied to an onchain payment record.
5. Work on desktop and mobile through a Slush universal link and QR code.
6. Fit the existing Alpha City visual system, wallet session, CITY gate, build process, and tests.
7. Keep the architecture noncustodial and static-hosting compatible.

### Secondary goals

1. Support SUI, USDC, CITY, and validated custom Sui coin types.
2. Allow payment to the connected wallet or another explicitly verified receiver, such as a treasury multisig.
3. Preserve invoice history locally per creator wallet.
4. Export invoice history as CSV.
5. Make the core data and URI logic reusable by future checkout, donation, and point-of-sale surfaces.

### Success indicators

- At least 95% of users who submit a valid form receive a QR code and universal link without an RPC call.
- A completed registry payment is detected within one polling interval under normal endpoint conditions.
- A second attempt to pay the same registry invoice is rejected by Payment Kit.
- No private key, seed phrase, invoice customer database, or payment funds pass through Alpha City.
- All automated tests and the existing project test suite pass.

## 3. Explicit non-goals for the MVP

The first release will not provide:

- A public Alpha City-hosted payer page.
- In-page payment execution from the Alpha City page.
- Escrow, disputes, chargebacks, or buyer protection.
- Recurring authorizations or automatic subscriptions.
- Fiat-denominated invoices or exchange-rate locking.
- Partial payments, tips added to a fixed invoice, or installment plans.
- Refund automation.
- Customer accounts, address books, or cloud synchronization.
- Webhooks, APIs, or merchant integrations.
- SuiNS resolution.
- Uploaded or remotely fetched merchant logos.
- Enforced invoice due dates or cancellation.
- A custom Move contract.

These exclusions must be reflected in the UI. In particular, “Archive” only hides an invoice locally; it does not invalidate an already shared payment link. Payment-record expiration controls record retention and duplicate protection, not the due date of an invoice.

## 4. Access and gating model

### Creator access

`/pay/` loads the existing scripts in this order:

1. `/shared/wallet-sync.js`
2. `/shared/sui-client.js`
3. `/shared/tools-gate.js`
4. `/shared/paylink-config.js`
5. `/shared/paylink-core.js`
6. `/shared/paylink-client.js`

The gate loads immediately after the Sui client so it can hide the page before Paylink-specific bundles initialize. This preserves the existing no-content-flash behavior for unauthorized users.

`tools-gate.js` remains the source of truth for the 5,000,000 CITY threshold, including liquid and staked CITY. The Paylink page must not implement a second balance check or duplicate the threshold.

Expected behavior:

- No saved wallet: redirect to `/tools/?redirect=/pay/&reason=no_wallet`.
- Connected wallet under threshold: redirect to `/tools/?redirect=/pay/&locked=true`.
- Connected wallet at or above threshold: remove the gate style and reveal Paylink.
- RPC error: redirect through the existing tools error path.
- Wallet changed in another tab: `wallet-sync.js` and `tools-gate.js` re-evaluate access.

The Paylink header displays the connected creator address and provides a “Switch Wallet” link to `/tools/?redirect=/pay/`. It does not initially duplicate the full wallet-discovery implementation found in Airdrop and Tools.

### Payer access

Generated links use:

```text
https://my.slush.app/pay?receiver=...&amount=...&coinType=...&nonce=...&registry=...&label=...&message=...
```

The QR code encodes the same HTTPS universal link. The payer never visits `/pay/`, so the CITY gate does not apply to the payer.

Also expose a “Copy `sui:pay` URI” action for wallets that support the standard URI directly.

## 5. User journeys

### Journey A — create and share an invoice

1. User opens `/pay/`.
2. The existing gate verifies their connected wallet.
3. Receiver defaults to the connected address.
4. User selects a token, enters an amount, label, and optional memo.
5. User selects **Create Paylink**.
6. The client validates and converts the display amount to an exact atomic `bigint`.
7. The client generates a UUIDv4 nonce, capped at the Payment Kit maximum of 36 characters.
8. The client builds and parses the Payment Kit URI as a round-trip validation.
9. The client derives the Slush universal URL.
10. The invoice is stored locally with status `pending`.
11. The UI displays the QR code, full payment summary, copy buttons, and **Open in Slush**.
12. The creator shares the link or QR code.

### Journey B — pay an invoice

1. Payer opens the universal link or scans the QR code.
2. Slush displays the receiver, coin, amount, label, and message.
3. Payer reviews and confirms the transaction.
4. Payment Kit transfers funds directly to the receiver.
5. Payment Kit writes a registry `PaymentRecord` and emits a receipt.
6. Reopening and paying the identical registered request is rejected while the record exists.

### Journey C — detect payment

1. Creator returns to `/pay/` or leaves it open.
2. Pending invoices are checked through `getPaymentRecord`.
3. The lookup uses the exact registry ID, nonce, receiver, coin type, and atomic amount stored when the invoice was created.
4. A returned record changes status from `pending` to `paid`.
5. The transaction digest and detection timestamp are persisted locally.
6. The UI links the digest to the Sui explorer.
7. A paid invoice never reverts to pending if a later lookup fails or the record is eventually deleted.

### Journey D — use a treasury receiver

1. Creator edits the default receiver.
2. The tool validates the new address.
3. The UI shows the full destination and warns that it differs from the connected wallet.
4. Creator must check “I verified this receiving address” before creation.
5. The invoice remains associated locally with the connected creator wallet, while payment goes to the entered treasury address.

### Journey E — manage local history

1. Creator filters invoices by pending, paid, or archived.
2. Creator can refresh a single invoice or all visible pending invoices.
3. Creator can reopen the QR/share panel, duplicate an invoice into the form with a new nonce, archive it locally, or export history to CSV.

## 6. Functional requirements

### 6.1 Invoice form

Required fields:

- Receiver address.
- Coin type/preset.
- Positive amount.
- Label.

Optional field:

- Message/memo.

MVP validation limits:

- Receiver: canonical valid Sui address.
- Nonce: generated UUIDv4, no user editing, maximum 36 characters.
- Label: 1–64 visible characters.
- Message: 0–180 visible characters.
- Amount: plain decimal notation only; no commas, signs, or exponent notation.
- Amount precision: no more fractional digits than the token decimals.
- Atomic amount: greater than zero and within `u64` range.
- Coin type: canonical Move type; custom types require successful metadata lookup.

The submit button remains disabled until every requirement is satisfied.

### 6.2 Token selection

Initial presets:

| Symbol | Coin type | Decimals |
|---|---|---:|
| SUI | `0x2::sui::SUI` | 9 |
| USDC | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` | 6 |
| CITY | Existing canonical CITY type from `tools-gate.js` | 9 |

Implementation rules:

- Keep preset configuration in one Paylink config object rather than duplicating it in HTML handlers.
- Validate preset metadata against the network during the technical spike.
- For a custom coin, call the shared metadata path and display symbol/decimals before enabling creation.
- Cache metadata by canonical coin type for the browser session.
- Never infer decimals from user input.
- Do not promise that every token is gasless. The payer’s wallet is the authority on fees and available balances.

### 6.3 Link and QR generation

- Use `createPaymentTransactionUri` from `@mysten/payment-kit`.
- Include `receiverAddress`, atomic `amount`, canonical `coinType`, generated `nonce`, registry ID, label, and optional message.
- Immediately parse the generated URI with `parsePaymentTransactionUri` and compare all required fields before saving it.
- Create the universal URL by retaining the Payment Kit query string and changing only the scheme/base to `https://my.slush.app/pay`.
- QR code contains the HTTPS universal URL, not the custom scheme.
- QR rendering is local; no invoice data is sent to a QR service.
- Actions: Copy Paylink, Copy `sui:pay` URI, Open in Slush, Download QR PNG.

### 6.4 Invoice history

History columns/cards:

- Status.
- Label.
- Amount and symbol.
- Short receiver.
- Created timestamp.
- Paid/detected timestamp when available.
- Transaction digest link when paid.
- Action menu.

Actions:

- View/share.
- Refresh status.
- Duplicate with new nonce.
- Archive locally.
- Export CSV.

Search/filter:

- Search label, receiver, nonce, or digest.
- Filter pending, paid, and archived.
- Default sort: newest first.

### 6.5 Payment status

- Use registry record lookup, not balance-delta inference.
- Verify using all composite-key fields.
- Poll only invoices with local status `pending`.
- Poll interval: 60 seconds while the page is visible and online.
- Maximum concurrent record lookups: 3.
- Maximum automatic lookups per cycle: 20 newest pending invoices.
- Pause when `document.hidden` or offline.
- Manual refresh bypasses the interval but not concurrency controls.
- Exponential backoff after endpoint errors; do not mark unpaid on an error.
- Once paid, status is monotonic and cannot regress.
- Persist the payment transaction digest returned by the record.
- Optionally query the transaction digest once for a chain timestamp; if unavailable, label the local value “Detected at,” not “Paid at.”

### 6.6 CSV export

Columns:

```text
status,label,message,amount_display,amount_atomic,symbol,coin_type,receiver,nonce,registry_id,created_at,detected_at,transaction_digest,paylink
```

CSV rules:

- RFC 4180-compatible escaping.
- Atomic amounts remain strings.
- Prevent spreadsheet formula execution by prefixing cells beginning with `=`, `+`, `-`, or `@`.
- Filename includes the creator’s short address and ISO date.

## 7. UI specification

### Page structure

1. Existing Alpha City header and back link to Ecosystem Tools.
2. Hero: “Alpha City Paylink” and one-sentence noncustodial explanation.
3. Safety notice: payments are irreversible; verify receiver, token, and amount.
4. Two-column desktop layout:
   - Left: invoice form.
   - Right: live request preview and QR/result state.
5. Full-width invoice history below.
6. Footer consistent with other tools.

Mobile stacks form, preview, then history.

### Form sections

1. **Receive at** — connected address default, editable.
2. **Request** — token and amount.
3. **Invoice details** — label and memo.
4. **Review** — full untruncated receiver, atomic token context, and registry protection badge.
5. **Create Paylink**.

### Preview states

- Empty: explains what will appear.
- Valid form preview: human-readable request, no QR yet.
- Generating: short local spinner.
- Created: QR, universal link, URI, and share actions.
- Error: actionable validation/build message; no partially saved invoice.

### History states

- Empty: “Create your first Paylink.”
- Loading payment status.
- Pending.
- Paid.
- Endpoint unavailable: preserve current state and show last successful check.
- Archived.

### Required disclosures

- “Alpha City does not custody or route these funds.”
- “Your invoice history is stored only in this browser.”
- “Archiving does not disable a shared payment link.”
- “Payment Kit is evolving; verify payment details in your wallet before signing.”

## 8. Technical architecture

### Runtime components

```text
tools-gate.js
    -> authorizes creator wallet

pay/index.html
    -> form, preview, history, controller, UI state

paylink-core.js
    -> pure validation, amount conversion, invoice model, storage, CSV, state transitions

paylink-client.js
    -> bundled Payment Kit + QR adapter
    -> extends AlphaCitySui.grpcClient
    -> creates/parses URIs
    -> looks up PaymentRecords
    -> renders QR data locally

Alpha City PaymentRegistry (shared Sui object)
    -> duplicate prevention and queryable records

Slush universal link
    -> public payer interface and wallet confirmation
```

### Why separate core and client modules

- `paylink-core.js` remains dependency-free and testable through the repository’s existing Node `vm` test pattern.
- `paylink-client-source.js` owns experimental SDK integration and can be upgraded without rewriting invoice-state logic.
- Payment Kit and QR dependencies do not inflate `shared/sui-client.js` for every existing page.
- `pay/index.html` remains focused on DOM and user interaction.

### Global browser APIs

`shared/paylink-core.js` exposes:

```text
globalThis.AlphaCityPaylinkCore
```

Expected methods:

- `canonicalizeAddress`
- `validateCoinType`
- `parseDisplayAmount`
- `formatAtomicAmount`
- `validateInvoiceDraft`
- `createInvoiceRecord`
- `createStorageKey`
- `loadInvoices`
- `saveInvoices`
- `transitionInvoiceStatus`
- `escapeCsvCell`
- `buildCsv`

`shared/paylink-client.js` exposes:

```text
window.AlphaCityPaylinkClient
```

Expected methods:

- `initialize({ suiClient, network, registryId })`
- `createPaymentUri(invoice)`
- `parsePaymentUri(uri)`
- `createSlushUniversalUrl(uri)`
- `getPaymentRecord(invoice)`
- `getCoinMetadata(coinType)`
- `renderQr(canvas, value)`
- `downloadQr(canvas, filename)`

## 9. File-level implementation map

### New files

#### `pay/index.html`

- Complete gated Paylink UI.
- Loads shared scripts in the specified order.
- Contains only DOM/controller logic specific to this page.
- Uses `textContent` for all user-provided values.

#### `shared/paylink-core.js`

- Dependency-free IIFE following existing shared module conventions.
- Exact `bigint` amount handling.
- Versioned local-storage serialization.
- Status state machine and CSV generation.

#### `shared/paylink-client-source.js`

- Imports Payment Kit URI utilities and `paymentKit()`.
- Imports the selected QR library.
- Extends the existing `window.AlphaCitySui.grpcClient` instead of creating a second transport.
- Provides normalized errors to the page.

#### `shared/paylink-client.js`

- Generated IIFE bundle.
- Global name: `AlphaCityPaylinkBundle` or equivalent.
- Committed in the same manner as `shared/sui-client.js` so static hosting can serve it.

#### `shared/paylink-config.js`

- Mainnet/testnet registry IDs.
- Network names.
- Token presets.
- Explorer transaction URL base.
- Poll interval and storage limits.
- Contains public identifiers only.

#### `tests/paylink-core.test.cjs`

- Pure validation, amount, storage, state, and CSV tests.

#### `tests/paylink-client.test.cjs`

- URI/universal-link round trips and mocked Payment Kit record responses.
- Static checks for required SDK integration and absence of secret material.

#### `tests/paylink-page.test.cjs`

- Verifies gate scripts and their ordering.
- Verifies portal link, required disclosures, form elements, and integration globals.

### Modified files

#### `package.json`

- Add a pinned compatible `@mysten/payment-kit` dependency.
- Add a pinned QR-generation dependency.
- Add `build:paylink`.
- Update `build` to run Sui client, Paylink client, and CSS builds.

Proposed scripts:

```json
{
  "build:paylink": "esbuild shared/paylink-client-source.js --bundle --minify --format=iife --global-name=AlphaCityPaylinkBundle --platform=browser --target=es2022 --outfile=shared/paylink-client.js",
  "build": "npm run build:sui && npm run build:paylink && npm run build:css"
}
```

#### `package-lock.json`

- Updated through normal dependency installation.

#### `tools/index.html`

- Add a fourth unlocked card for Alpha City Paylink.
- Description: create protected Sui payment requests, QR codes, and payment receipts.
- Link to `/pay/`.
- Preserve the existing CITY gate and card layout.

#### `shared/sui-client-source.js` only if needed

- Prefer no Paylink-specific changes.
- If production endpoints are supplied, use the existing `window.ALPHA_CITY_SUI_CONFIG` seam rather than hardcoding provider credentials.
- Never place a provider secret in a browser bundle.

## 10. Invoice data model

All `bigint` values are serialized as decimal strings.

```js
{
  schemaVersion: 1,
  network: 'mainnet',
  id: 'local-ui-id',
  nonce: 'uuid-v4-max-36-chars',
  creatorAddress: '0x...',
  receiverAddress: '0x...',
  coinType: '0x...::module::TYPE',
  symbol: 'USDC',
  decimals: 6,
  amountAtomic: '250000000',
  amountDisplay: '250',
  label: 'Invoice #1042',
  message: 'Landing page development',
  registryId: '0x...',
  paymentUri: 'sui:pay?...',
  universalUrl: 'https://my.slush.app/pay?...',
  status: 'pending',
  createdAt: '2026-07-14T18:00:00.000Z',
  lastCheckedAt: null,
  detectedAt: null,
  chainTimestamp: null,
  transactionDigest: null,
  archivedAt: null,
  lastError: null
}
```

### Local-storage key

```text
alphacity_paylink_invoices_v1:mainnet:<creator-address>
```

Rules:

- Histories are isolated by creator wallet and network.
- Maximum 500 records per wallet in MVP.
- Refuse a new save with an explicit export/archive prompt if storage quota is exceeded.
- Never silently delete paid records.
- Corrupt entries are quarantined/skipped and surfaced as a recoverable warning.
- Future migrations branch on `schemaVersion`.

## 11. Invoice state machine

Allowed states:

```text
pending -> paid
pending -> archived
paid    -> archived
archived -> pending  (restore only if previously pending)
archived -> paid     (restore only if previously paid)
```

Implementation should retain an underlying `paymentStatus` (`pending` or `paid`) separately from the presentation flag `archivedAt`. This avoids losing payment truth when archiving.

Forbidden transitions:

- `paid -> pending`
- Any state change based solely on an RPC error.
- Any local “cancelled” state that implies the onchain payment request has been invalidated.

## 12. Payment registry plan

### Technical-spike registry

Before UI implementation, create a Testnet Payment Kit registry and prove the complete flow:

1. Create a uniquely named registry.
2. Confirm the registry ID and `RegistryAdminCap` creation.
3. Leave registry-managed funds disabled.
4. Configure a long record expiration for testing.
5. Generate a registry-bearing payment URI.
6. Open the link in Slush.
7. Complete a small test payment.
8. Retrieve the record by exact composite key.
9. Confirm the transaction digest.
10. Attempt the identical payment again and confirm rejection.
11. Confirm a second nonce with identical amount/receiver succeeds.

This spike is a release gate because Payment Kit is explicitly experimental.

### Mainnet registry

After the spike passes:

1. Create a uniquely named Alpha City Mainnet registry.
2. Keep registry-managed funds disabled so funds go directly to invoice receivers.
3. Configure record expiration to 365 epochs. If the deployed package rejects that value, use the highest supported value of at least 180 epochs and document the final value; do not release with less than 180 epochs without explicit product approval.
4. Store the `RegistryAdminCap` in an operations wallet; transfer it to a multisig when Treasury Safe exists.
5. Commit only the public registry ID/name and creation digest to the Paylink configuration or deployment record.
6. Do not store a key, mnemonic, keystore, or signing token in the repository.

The 365-epoch setting is record retention, not an invoice due date. If a record is later deleted, a locally detected paid invoice remains paid. The UI must not imply permanent onchain archival.

## 13. Error handling

### Form errors

- Invalid receiver: identify the receiver field.
- Unsupported or unverified coin type: prevent creation.
- Excess decimals: state the token precision.
- Zero/negative/overflow amount: reject before URI creation.
- Oversized label/message: show remaining characters.

### SDK/link errors

- URI creation failure: do not save invoice.
- Parse round-trip mismatch: treat as a hard internal error and do not expose a link.
- QR failure: keep copy/open link actions available.
- Payment Kit initialization failure: creation may remain available only if URI utilities loaded, but status monitoring shows unavailable.

### Network/status errors

- Preserve current invoice status.
- Record a sanitized local error and last-attempt timestamp.
- Display “Status temporarily unavailable” rather than “Unpaid.”
- Retry with backoff.
- Avoid dumping raw provider responses or wallet data into the UI.

### Storage errors

- Provide immediate CSV export.
- Do not pretend a record was saved if `localStorage.setItem` fails.
- Keep the newly created link visible so the creator can copy it before leaving.

## 14. Security and trust requirements

### Noncustody

- Alpha City never signs payer transactions.
- Alpha City never receives funds unless explicitly entered as the receiver.
- Registry-managed funds remain disabled.
- No private key operations occur in browser code.

### Input and rendering safety

- Render label/message/receiver through `textContent`, not interpolated `innerHTML`.
- Apply length limits before storage and URL generation.
- Do not fetch user-supplied `iconUrl` values in the MVP.
- Canonicalize addresses and coin types before comparison.
- Compare atomic amounts as `bigint`, never floating-point numbers.
- Encode URL parameters through the official SDK.
- Sanitize CSV cells against formula injection.

### Payment verification

- Never infer “paid” only from an equal balance change.
- Require a registry record matching nonce, amount, coin type, receiver, and registry.
- Treat the transaction digest returned by the record as the audit anchor.
- Never downgrade a confirmed local record after a lookup failure.

### Receiver protection

- Display the full receiver on final review.
- If receiver differs from creator, require an explicit verification checkbox.
- Make “connected wallet” and “payment receiver” visually distinct.
- Do not silently replace receiver after wallet/account changes; invalidate the draft and require review.

### Dependency safety

- Pin exact Payment Kit and QR dependency versions.
- Commit the lockfile.
- Bundle locally; do not load either dependency from a runtime CDN.
- Run build and tests after dependency updates.
- Keep Payment Kit integration behind the dedicated adapter.

## 15. Reliability and performance

- Reuse the existing gRPC client instead of creating a client per invoice.
- Initialize the Payment Kit extension once per page.
- Generate URIs and QR codes locally.
- Poll only pending invoices, with visibility/offline pausing.
- Use bounded concurrency and exponential backoff.
- Cache custom token metadata in memory and optionally session storage.
- Do not scan global payment events to determine status.
- Use direct registry-record lookup by composite key.

The existing default Sui endpoints are public and rate-limited. Before significant production traffic, configure a dedicated gRPC provider through the existing `window.ALPHA_CITY_SUI_CONFIG` seam. Provider credentials must not be embedded in browser-delivered JavaScript; use an origin-restricted public endpoint or a server-side proxy if authentication is required.

## 16. Testing strategy

### Unit tests — `paylink-core`

Cover:

- Valid integer and decimal amounts.
- Exact conversion at 6 and 9 decimals.
- Rejection of exponent notation, signs, commas, excess precision, zero, and overflow.
- Formatting atomic amounts without floating-point conversion.
- Receiver and coin-type validation.
- Label/message limits.
- UUID/nonce length.
- Storage key isolation by wallet/network.
- Serialization and migration behavior.
- Monotonic paid state.
- Archive/restore behavior.
- CSV escaping and spreadsheet-injection protection.

### Adapter tests — `paylink-client`

Cover:

- Payment URI creation and parsing round trip.
- Registry ID inclusion.
- Universal URL conversion without double encoding.
- Unicode label/message encoding.
- Mock record absent -> pending.
- Mock exact record present -> paid with digest.
- Endpoint rejection -> no status regression.
- QR generation receives the HTTPS universal URL.

### Static integration tests

Verify:

- `/pay/index.html` loads wallet sync, Sui client, and tools gate before the Paylink config/core/client modules.
- Tools portal links to `/pay/` only from the unlocked view.
- Required warning/disclosure text is present.
- User strings are not interpolated into unsafe HTML templates.
- The page includes no secret/key literals.
- Build script produces `shared/paylink-client.js`.

### Testnet integration checks

Use two low-value Testnet wallets:

- Creator/receiver wallet.
- Payer wallet.

Validate:

- Link opens on mobile and desktop Slush.
- Correct receiver, amount, coin, label, and memo appear.
- Payment succeeds.
- Record lookup returns the expected digest.
- Duplicate payment fails.
- Different nonce succeeds.
- Invalid/insufficient balance fails without a false paid state.

### Mainnet smoke checks

After Mainnet registry creation:

- Create and pay one minimal SUI invoice.
- Create and pay one minimal USDC invoice if available.
- Confirm both record lookups and explorer links.
- Confirm the connected creator wallet can differ from the receiver.
- Confirm an under-gated wallet cannot open `/pay/`.
- Confirm a payer without CITY can use the external Slush link.

### Browser/device matrix

- Chrome desktop with Slush extension/web flow.
- Edge desktop.
- Safari iOS with Slush installed and without it.
- Chrome Android with Slush installed and without it.
- Narrow mobile layout at 320px.
- Clipboard denied.
- Local storage disabled/quota exceeded.
- Offline status refresh.

### Regression commands

```text
npm run build
npm test
git diff --check
```

## 17. Implementation phases

### Phase 0 — Payment Kit proof and registry decision

Deliverables:

- Pin a Payment Kit version compatible with `@mysten/sui` 2.20.3.
- Run the complete Testnet registry/link/payment/query/duplicate spike.
- Document actual result shapes and error behavior.
- Select and pin the QR library.
- Confirm whether the SDK can extend the existing shared gRPC client cleanly.

Exit criteria:

- Payment record is deterministically queryable from stored invoice fields.
- Duplicate attempt is rejected.
- Slush universal link supports the registry parameter.
- No blocking SDK incompatibility exists.

If this phase fails, do not silently substitute balance inference. Re-scope to an explicitly “ephemeral payment request” MVP with no reliable paid badge, or pause until Payment Kit stabilizes.

### Phase 1 — Core model and automated tests

Deliverables:

- `paylink-core.js`.
- Amount/address/coin validation.
- Invoice schema and versioned storage.
- State transitions.
- CSV generation.
- Unit tests.

Exit criteria:

- Pure tests cover boundary conditions.
- No floating-point amount conversion.
- Paid state cannot regress.

### Phase 2 — Payment/QR adapter

Deliverables:

- `paylink-client-source.js` and built bundle.
- Payment Kit client extension.
- URI creation/parsing.
- Universal URL conversion.
- Record lookup normalization.
- QR rendering/download.
- Adapter tests.

Exit criteria:

- Build is deterministic.
- Link round-trip tests pass.
- Mock status checks behave correctly.

### Phase 3 — Gated Paylink UI

Deliverables:

- `/pay/index.html`.
- Form, review, result QR, and copy/open actions.
- Invoice history, filtering, refresh, archive, duplicate, and CSV export.
- Required disclosures and responsive states.

Exit criteria:

- A gated user can create and recover a Paylink after reload.
- No wallet transaction is triggered by creating a link.
- No user-provided content is inserted as HTML.

### Phase 4 — Portal integration and production registry

Deliverables:

- Tools portal card.
- Dedicated Mainnet Payment Registry.
- Public registry configuration.
- Operations record of registry/admin-cap ownership and creation digest.

Exit criteria:

- Registry-managed funds are confirmed disabled.
- Mainnet ID is included in generated links.
- Admin capability is controlled by the designated operations wallet.

### Phase 5 — End-to-end verification and release

Deliverables:

- Testnet integration evidence.
- Mainnet low-value smoke evidence.
- Browser/device checks.
- Full build/test run.
- Final copy and safety review.

Exit criteria:

- All Definition of Done items pass.
- No high-severity open issue remains.
- Rollback can remove the portal card without affecting other tools.

## 18. Acceptance criteria

### Access

- [ ] `/pay/` is hidden until `tools-gate.js` authorizes the connected wallet.
- [ ] Unauthorized users follow the existing Tools redirect/locked flow.
- [ ] The creator can switch wallet through the Tools page and return to Paylink.
- [ ] The external payer link does not route through the Alpha City gate.

### Creation

- [ ] Receiver defaults to the connected creator wallet.
- [ ] Alternate receiver requires explicit verification.
- [ ] SUI, USDC, and CITY presets use validated types and decimals.
- [ ] Custom coin creation is blocked until metadata resolves.
- [ ] Amount conversion is exact and rejects invalid precision.
- [ ] Every invoice receives a unique valid nonce.
- [ ] Every created URI passes parse round-trip validation.
- [ ] Invoice is saved only after successful validation and URI creation.

### Sharing

- [ ] QR contains the Slush HTTPS universal link.
- [ ] Copy link and copy URI actions work independently.
- [ ] Open in Slush uses the HTTPS universal URL.
- [ ] Downloaded QR has a safe deterministic filename.
- [ ] Label and message are correctly encoded.

### Payment tracking

- [ ] Pending invoice lookup uses the exact registry composite key.
- [ ] Successful payment changes status to paid and stores a digest.
- [ ] Duplicate payment is rejected by the registry.
- [ ] Network failure never changes paid to pending.
- [ ] Paid digest opens the configured explorer.
- [ ] Polling pauses while hidden/offline and uses bounded concurrency.

### History

- [ ] History is isolated by network and creator wallet.
- [ ] Reload restores invoice state.
- [ ] Duplicate creates a new nonce.
- [ ] Archive is explicitly local-only.
- [ ] CSV export is safe and complete.

### Security and quality

- [ ] No private keys, secrets, or authenticated provider credentials are shipped.
- [ ] Payments go directly to receiver; registry-managed funds are disabled.
- [ ] User input is never injected as HTML.
- [ ] All dependencies are pinned and bundled locally.
- [ ] `npm run build`, `npm test`, and `git diff --check` pass.
- [ ] Existing tools continue to load and pass their tests.

## 19. Rollout and rollback

### Rollout

1. Deploy code with the portal card hidden or marked beta.
2. Complete low-value Mainnet smoke tests against the production registry.
3. Enable the card for gated users.
4. Show a beta badge and Payment Kit warning for the initial release.
5. Monitor client errors, provider rate limits, and support reports.
6. Revalidate behavior whenever Payment Kit is upgraded.

### Rollback

- Remove or hide the Paylink card from `/tools/`.
- Leave the registry untouched; existing shared links and onchain records remain valid.
- Do not delete the registry or payment records as part of an application rollback.
- Preserve the registry admin capability.
- Restore the previous dependency lockfile only if no other feature uses the added dependencies.

## 20. Post-MVP roadmap

Recommended order:

1. SuiNS receiver resolution and display.
2. Optional public Alpha City payer page with the gate intentionally separated from creator access.
3. Hosted invoice metadata and cross-device history.
4. Webhooks and payment-status API.
5. Branded merchant profiles and donation pages.
6. Point-of-sale mode with rapid sequential invoices.
7. Refund helper that creates a new, explicit outbound transaction.
8. Treasury Safe integration for payment approvals and treasury receivers.
9. Walrus/Seal digital-download fulfillment.
10. Checkout widget and e-commerce integrations.

Recurring billing, escrow, fiat conversion, and enforced expiry should be treated as separate products requiring their own contracts, threat models, and legal review.

## 21. External technical references

- Payment Kit overview and experimental-status notice: <https://sdk.mystenlabs.com/payment-kit>
- Payment Kit SDK, records, receipts, and URI utilities: <https://sdk.mystenlabs.com/payment-kit/payment-kit-sdk>
- Registry management and default behavior: <https://sdk.mystenlabs.com/payment-kit/registry-management>
- Slush Payment Kit deep links: <https://sdk.mystenlabs.com/slush-wallet/deep-linking>
- Sui gRPC/GraphQL migration and production endpoint guidance: <https://docs.sui.io/develop/accessing-data/json-rpc-migration>

## 22. Definition of Done

Paylink is complete when a CITY-authorized creator can generate a registry-protected Sui payment request, share it as a Slush universal link or local QR code, reload the page and recover its history, observe an exact onchain registry match as paid, export the record, and do all of this without Alpha City holding funds, handling private keys, requiring a backend, or exposing the payer to the CITY gate.
