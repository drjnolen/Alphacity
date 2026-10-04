# Hall of Resistance

The game menu opens the leaderboard. Death, manually ending a campaign, or securing the ninth district also opens it with the completed expedition and a username form. Intermediate district results do not interrupt the climb. Historical scores and pending submissions live separately from campaign progression, so resetting a campaign cannot erase them.

## Ranking and clock

- One best expedition per wallet, ordered by highest district boss defeated, then lowest elapsed time to that boss clear. Exact ties use the first achievement timestamp, then wallet address for stable ordering.
- The top 50 and the connected wallet's rank are returned. Class filters filter those personal bests; they do not introduce multiple entries per wallet.
- Timing begins when the server registers a new campaign. Boss checkpoints are timestamped on receipt by the server. Breaks, safehouse visits, offline periods and delayed checkpoint uploads count toward time. Time after the last cleared boss does not worsen the score.
- Each boss clear updates the personal best. A username opts the wallet into public display. Users without a boss clear can reserve a username but do not get a ranked entry.
- Names are case-insensitively unique, 3–20 ASCII letters, digits, spaces, underscores or hyphens. Updating a name changes its display on the existing record. The public API associates wallet, callsign and result.
- A run already in progress before this feature cannot be ranked retroactively. Its end summary still appears, without an invented start time. New ranked runs must start in district 1. Runs expire after 30 days; personal bests persist.

## Authentication and availability

The site's existing wallet connector signs a purpose-specific challenge when ranked play first starts. The API checks the signature and combined 5M CITY liquid/staked balance, then issues a wallet/origin-bound 24-hour session. It cannot trust the site's browser-only holdings cache. Existing game access verification is unchanged; leaderboard authentication does not send a transaction. Supported signature verification uses the same installed Sui SDK as the site, including the mainnet client for zkLogin.

Challenges are single-use and expire after five minutes. Session tokens are stored only as SHA-256 hashes in D1 and in sessionStorage on the client. No secrets are embedded in the game. An expired session never opens a surprise wallet prompt during combat: it waits for explicit submission in the leaderboard. Wallet changes invalidate in-flight client responses.

If registration fails or signing is declined, the player can retry or choose **Play this run unranked**. Missing service configuration permits unranked play. Boss and finish requests are queued in wallet-scoped localStorage, retried on reconnect, and sent in order. The submission form can authenticate and drain that queue. Closing the dialog does not discard results; unseen end summaries reopen after refresh. No polling or network requests are added to combat turns.

This is a casual community leaderboard, **not an authoritative game server**. Sequential checkpoints, server timing, ownership, holdings verification, minimum-time sanity checks, CORS, bounded requests and rate limiting reduce common abuse; they cannot prove that browser combat was honestly played. Do not attach valuable prizes without server-side action/replay validation and authoritative randomness.

## Deployment

The website remains on GitHub Pages. `api/climb-leaderboard/worker.mjs` runs on Cloudflare Workers with a D1 binding. The existing Pages deployment workflow now runs `scripts/deploy-climb-leaderboard.mjs` before publishing:

1. Reuse or create the `alphacity-climb-leaderboard` D1 database in the existing Cloudflare account.
2. Apply the idempotent initial schema without dropping records.
3. Deploy the Worker with D1 and per-IP rate-limit bindings, plus a daily expired-session/run cleanup.
4. Check the live read endpoint and write its URL into `climb/leaderboard-config.json` for the Pages artifact.

The repository already has `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets. The token must include **D1: Edit** and **Workers Scripts: Edit**, plus access to read the account's workers.dev subdomain. Enable that subdomain in Cloudflare if not already present. Secret contents and permissions cannot be verified from their names. Missing permission or a failed health check stops publication with an actionable error; the already-deployed site is unaffected. The script never upgrades the Cloudflare plan or adds paid products.

The checked-in Wrangler database ID is a local-development placeholder, replaced in a temporary config during deployment. The checked-in public endpoint is null, so undeployed checkouts clearly show the unavailable state rather than a fabricated local leaderboard. Do not manually deploy the placeholder as production.

For a local API preview, use Wrangler with the schema applied to local D1 and an explicit localhost `ALLOWED_ORIGINS` override. Set the local `climb/leaderboard-config.json` endpoint to the local Worker URL; restore it to null before committing. Production signature and holdings checks still apply. Automated tests use real SQLite plus injected clock/holdings fixtures and real Ed25519 signatures.

Free-tier limits still apply. Rate limits are approximate per Cloudflare location, not a global billing cap. Monitor account usage. Basic score records are small; older detailed run journals are deleted after 31 days while best records remain. For future balance changes, increment the server's season identifier and the matching UI label to keep different rule sets separate.
