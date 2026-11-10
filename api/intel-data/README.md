# Intel data and feed operations

The Intel page uses this public, read-only Worker to avoid downloading DefiLlama's entire yield dataset in each browser. It is independent of the OpenAI proxy and requires no OpenAI key.

## Deployment

The existing Pages workflow runs `scripts/deploy-intel-data.mjs` after installing Wrangler 4. It uses the existing `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets (Workers Scripts edit and account subdomain read access, already used by the Climb deployment). It deploys `alphacity-intel-data`, checks `/health`, then writes the public URL to `intel/data-config.json`. A failed deployment or health check stops Pages publication.

The checked-in config has an empty endpoint. Local development can run `wrangler dev --config api/intel-data/wrangler.json` and point that config at the local HTTP origin. The page only allows HTTP endpoints when both the page and endpoint are on loopback hosts. Do not commit a local endpoint. No production deployment is performed by the tests or by opening a PR.

## API and caching

- `GET /v1/yields` returns `{ version: 1, source: "DefiLlama", fetchedAt, stale, pools }`. `fetchedAt` is the original successful fetch time in epoch milliseconds. At most five Sui pools are returned, ordered by positive APY, with at least $20,000 TVL. Fields are limited to pool ID, symbol, project, TVL, APY and underlying coin types.
- Fresh data lasts 15 minutes. Cloudflare's Cache API and an isolate-local snapshot retain the last successful response for up to six hours. Upstream failures return that snapshot with `stale: true`; older data is discarded and the API returns 503. Retries are limited to once a minute per isolate after failure, and concurrent requests in an isolate coalesce. Cache storage is regional and best-effort, not a globally coordinated rate limiter.
- Query parameters cannot change the upstream or force a refresh. The upstream request has a 10-second timeout. GET and OPTIONS have public CORS; other methods are rejected.
- `GET /health` confirms the service is running; it does not require DefiLlama to be available.

## News, X and safety behavior

`shared/intel-feeds.js` combines SuiWire's public JSON feed with Google News in the Sui tab. Syndication permission was confirmed by the site owner on November 5, 2026. The page displays linked headlines, publisher attribution, publication times, and SuiWire's sponsored labels; it does not republish article bodies. SuiWire can be removed from `SOURCES.sui` if permission changes. Other categories continue using their existing RSS sources through RSS2JSON.

News caches expire after ten minutes, with a bounded 24-hour fallback and independent status for each source. Refresh bypasses the client freshness check, overlapping requests coalesce, and late category responses cannot replace the current tab. Cached data retains its original timestamps; missing publication times remain unknown.

The X section now links directly to the existing ecosystem accounts and clearly states that live posts are unavailable. The client no longer calls Nitter mirrors. The OpenAI proxy's `/nitter` route returns 410 in this source revision; pre-provisioned proxy deployments need their usual separate redeploy to apply that server change.

`shared/token-safety.js` requires an exact full coin type. It distinguishes reported active/inactive capabilities, unknown fields, unavailable providers, and missing coverage. GoPlus Sui capability values 1 and 2 are treated as active unless the reported owner is Immutable. The UI shows check coverage rather than a safety score, keeps absent numbers unknown, and labels liquidity as the largest indexed pool rather than total market liquidity.

## Validation

Run `npm test`, `npm run test:climb`, `npm run build`, `npm audit --audit-level=high`, and `npm --prefix climb/game audit --audit-level=high`. The Intel tests cover normalization, category races, provider failures, bounded stale data, malformed/unsafe inputs, exact coin matching, capability values, and the compact Worker response.
