# Client application

This workspace contains the Astro PWA for SchoolWayfinder. The root [README](../README.md) covers
setup, verification, deployment, and the public project overview.

## Commands

Run these from `client/`, or prefix them with `pnpm --filter client` from the repository root.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Astro at `http://localhost:4321`. |
| `pnpm build` | Build the production client into `dist/`; it does not type-check. |
| `pnpm preview` | Serve the built client locally. |
| `pnpm lint` | Run ESLint over TypeScript and Astro source. |
| `pnpm format` | Rewrite `src/` with Prettier. |
| `pnpm typecheck` | Run `astro check`. |
| `pnpm test` | Run unit tests once with Vitest. |
| `pnpm test:coverage` | Run Vitest with the routing-critical coverage configuration. |
| `pnpm test:watch` | Run Vitest in watch mode. |
| `pnpm test:e2e` | Build and run Playwright browser tests. |

## Structure

```text
src/components/  Astro UI components; Map.astro wires the map modules together
src/map/         Map initialization, graph control, routes, search, favorites, schedules, dev tools
src/utils/       Geometry, graph, A*, directions, storage, search, and shared types
src/workers/     Visibility-graph worker
src/config/      Featured rooms and search configuration
public/data/     Floor nodes, walls, and traffic zones
```

## Key concepts

- Coordinates use Leaflet Simple CRS: `lat` is the image Y-axis and `lng` is the image X-axis.
- The visibility graph is built off the main thread; route finding remains fully client-side.
- Walls are polylines in JSON. Consecutive points are expanded into graph-blocking segments.
- Use the named loggers in `src/utils/logger.ts` instead of `console.*`.
- Developer-tool edits are session-only. Persistent navigation-data changes belong in `public/data/`
  and must pass the repository data validator.

For implementation details, see the [architecture guide](../docs/architecture.md) and
[development guide](../docs/development.md).
