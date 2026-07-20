# Fremd Maps

**An offline-first indoor navigation PWA for a multi-floor school.** Search for a room, build a
route across floors, and follow clear turn-by-turn directions—entirely in the browser.

[Open the live demo](https://maps.mananlalwani.com) · [Architecture](docs/architecture.md) ·
[Contributing](CONTRIBUTING.md)

## Highlights

- Searchable rooms with fuzzy matching, recent searches, and favorites
- Client-side A* routing with wall-aware visibility graphs and traffic-aware edge costs
- Cross-floor routing through stairway portals, with explicit floor-change guidance
- Quick nearest-bathroom routes and a schedule helper for repeated trips
- Installable PWA that precaches the application shell, floor plans, and navigation data
- Optional session-only developer tools for diagnosing and editing map data locally

## Built with

Astro, TypeScript, Leaflet Simple CRS, Fuse.js, RBush, Web Workers, Workbox, Vitest, Playwright,
and Cloudflare Workers.

## Run locally

Requires Node.js 22.12+ and pnpm 10.x. CI runs on Node.js 24. With Corepack, enable the pinned
package-manager version first.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:4321](http://localhost:4321). Developer tools are always available in local
development; set `PUBLIC_ENABLE_DEV=true` in `client/.env` to enable them in a production build,
then append `?dev` to the URL.

## Verify and build

```bash
pnpm --filter client lint
pnpm run format:check
pnpm --filter client typecheck
pnpm test
pnpm run test:data
pnpm run validate:data
pnpm run build
pnpm run test:e2e
```

`pnpm run build` validates navigation data before producing `client/dist`. See the
[development guide](docs/development.md) for what each check covers and how to troubleshoot it.

## Deploy

The Cloudflare Worker in `worker/index.ts` serves the static Astro build through its Assets binding.
After authenticating Wrangler for the target account, deploy with:

```bash
pnpm run deploy
```

See [deployment and releases](docs/deployment.md) for cache behavior and post-deploy checks.

## Project layout

```text
client/   Astro PWA: map UI, search, routing, and browser worker
worker/   Cloudflare Worker that serves static assets and security headers
scripts/  Navigation-data validation and maintenance helpers
docs/     Architecture, contribution, data, development, and release guides
```

Navigation data lives in `client/public/data/floor*/`; there is no runtime backend or database.

## Documentation map

- [Architecture](docs/architecture.md) — application flow, routing, offline behavior, and hosting
- [Navigation-data workflow](docs/data-contributor-workflow.md) — edit floor data safely
- [Development and verification](docs/development.md) — local checks, tests, and troubleshooting
- [Deployment and releases](docs/deployment.md) — Cloudflare deployment and release validation
- [Release checklist](docs/release-checklist.md) — copyable pre-release checklist

## License

This project, including the checked-in floor-plan images and navigation data, is available under the
[MIT License](LICENSE).
