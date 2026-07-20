# Contributing to SchoolWayfinder

Thanks for helping improve SchoolWayfinder. Small, focused pull requests are easiest to review.

## Before you start

- Read the root [README](README.md), [architecture guide](docs/architecture.md), and relevant guide in
  `docs/`.
- Keep changes compatible with Node.js 22.12+ and pnpm 10.x.
- Do not add a backend, telemetry, or persistent data store without an explicit design decision.
- Treat changes to public floor plans and navigation data as operational changes, not cosmetic edits.

## Development workflow

1. Install dependencies with `pnpm install --frozen-lockfile` and run `pnpm dev`.
2. Keep TypeScript strict, use the project's Prettier configuration, and use named client loggers rather
   than raw `console.*` calls.
3. Add or update tests with behavior changes. Keep Web Worker messages structured-cloneable and retain
   the main-thread graph fallback.
4. Run the checks in [development and verification](docs/development.md) before requesting review.

## Map-data contributions

Follow the [navigation-data workflow](docs/data-contributor-workflow.md). In particular, preserve
stable node IDs, validate stairway links across floors, and document the approved source and routing
effect of wall changes. Developer-tool edits are session-only and are not a substitute for validated
JSON changes.

## Pull requests

Describe the user-facing effect, tests run, and any data source used. Include screenshots for visible
UI changes and call out changes that affect offline caching, routes, or the public map assets.
