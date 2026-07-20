# Development and verification

## Local setup

Use Node.js 22.12+ and pnpm 10.x. CI runs on Node.js 24. From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The Astro development server runs at `http://localhost:4321`. Use `?dev` to open developer tools;
their edits are only held for the current browser session.

## Quality checks

Run the checks below before opening a pull request. CI runs the equivalent suite, using the coverage
command in place of the non-coverage unit-test command.

```bash
pnpm --filter client lint
pnpm run format:check
pnpm --filter client typecheck
pnpm test
pnpm run test:coverage
pnpm run test:data
pnpm run validate:data
pnpm run build
pnpm run test:e2e
pnpm audit --audit-level high
```

`pnpm run validate:data` checks JSON structure, coordinate bounds, reachability, and canonical routes.
For a machine-readable diagnostic report, run:

```bash
node scripts/validate-data.mjs --report=json
```

The unit suite covers graph construction, geometry, A*, directions, search, storage, and map modules.
Playwright exercises same-floor routing, cross-floor transitions, route clearing, an offline reload
after the service worker is installed, and an axe accessibility scan of the initial navigation view.

## Troubleshooting

- **Port 4321 is already in use:** stop the other local server or choose an Astro port explicitly.
- **New floor data does not appear locally:** use `pnpm dev`; production service workers are deliberately
  disabled there. If testing a production build, clear the site data or accept the update prompt.
- **Data validation fails:** read the failing file and index in the error, then inspect the JSON and run
  the report command above. Do not bypass canonical-route or unreachable-node failures.
- **Browser tests cannot start:** install Chromium with
  `pnpm --filter client exec playwright install --with-deps chromium` and rerun `pnpm run test:e2e`.
- **A route looks stale after a session-only edit:** rebuild the graph through the developer tools; the
  application invalidates graph and path caches when its editing flow changes data.
