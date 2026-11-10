# Independent website and backend deployments

`Deploy to GitHub Pages` builds, tests, configures public URLs locally, and publishes the website on pushes to main or manual dispatch. It never installs Wrangler, calls Cloudflare, or checks backend health. Build, regression, and security failures still block publication.

Each backend has its own workflow: `Deploy Climb leaderboard`, `Deploy Intel data`, and `Deploy OpenAI proxy`. They run on changes to their service directory, deployment script, or workflow, or manually from Actions. They deploy main only, serialize deployments per service, and fail visibly without blocking Pages or the other services. Cloudflare credentials are needed only for these workflows. A website-only update does not run them.

## Public endpoint configuration

The Pages workflow accepts repository **variables** `CLIMB_LEADERBOARD_URL`, `INTEL_DATA_URL`, and `OPENAI_PROXY_URL`. For compatibility, the existing `OPENAI_PROXY_URL` secret is also accepted. These are public HTTPS service origins, not API tokens. An absent variable preserves the checked-in endpoint; invalid URLs fail configuration before publication. No credentials or service-health requests are required.

The existing published AI URL is preserved in `config/services.json`. Climb and Intel retain their checked-in configs; currently these are empty because no public deployed configs were available during migration. Their widgets show their existing unconfigured/unavailable states until URLs are supplied. This does not prevent the rest of the site from publishing.

After the first successful Climb or Intel deployment, download its `public-endpoint` artifact and put the origin into the corresponding repository variable, or commit the generated public config. Then run the Pages workflow once. Subsequent backend deployments keep the same URL and need no website update. Moving a service to a new origin requires updating its variable/config. The OpenAI workflow retains its existing encrypted API key; it updates that key only when an `OPENAI_API_KEY` repository secret is supplied.

An expired Cloudflare deployment token does not itself shut down already deployed Workers. Backend outages remain visible in the affected widgets. Splitting publication does not repair unavailable services or deploy services that have never been provisioned.

To publish the changes from PR #159, merge this workflow fix and let Pages run. The failed Cloudflare deployment does not need to be rerun first.
