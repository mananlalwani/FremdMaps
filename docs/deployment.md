# Deployment and releases

## Cloudflare deployment

The project deploys a static Astro build through the Cloudflare Worker declared in `wrangler.toml`.
The Worker serves `client/dist` via its `ASSETS` binding and sets the project's security headers.

Cloudflare’s connected Git integration deploys production from `main`. GitHub Actions verifies the
same commit but does not publish it. Confirm the Cloudflare production branch remains `main` before
releasing.

For an intentional local deployment, authenticate Wrangler for the intended Cloudflare account, then
deploy from the repository root:

```bash
pnpm run deploy
```

This command validates the navigation data, builds the client, and runs `wrangler deploy`. Confirm the
worker name and target account before deploying; deployment is an external state change.

For a local Worker-backed production preview, use:

```bash
pnpm run preview
```

## Cache updates

The production service worker precaches the app shell and navigation assets. A visitor with an older
release can keep using it offline until they choose the visible update control, which reloads the app
into the new version. Test an updated deployment with both a fresh browser session and a previously
loaded session.

## Release procedure

1. Run every command in the [release checklist](release-checklist.md), including the browser suite.
2. Review `node scripts/validate-data.mjs --report=json`, especially canonical routes and unreachable
   nodes.
3. Push the approved commit to `main`; Cloudflare deploys it automatically. Use `pnpm run deploy`
   only when a local, intentional deployment is required.
4. Verify the live site: same-floor and cross-floor routes, service-worker update behavior, offline
   reload, floor-plan and data availability, and Worker security headers.
5. Confirm public floor-plan exposure is still approved for the release.
