# Agent Development Guidelines

**Tech Stack**: TypeScript — Astro static SPA (port 4321)  
**Purpose**: School indoor navigation with A* pathfinding  
**Package Manager**: pnpm with a single workspace (`client/`)  
**Coordinate System**: Leaflet Simple CRS — `lat` = Y-axis, `lng` = X-axis (NOT real GPS)

## Commands

```bash
pnpm dev                      # Astro dev server → localhost:4321
pnpm run validate:data        # validate floor data JSON shape and required fields
pnpm run build                # validate data, then build the production client
pnpm --filter client preview  # preview the Astro production build locally
pnpm run preview              # build, then preview through Wrangler
pnpm run deploy               # build and deploy client/dist through Cloudflare Workers

# Tests (run from repo root)
pnpm test                                                        # Vitest, runs once
pnpm --filter client test:watch                                  # Vitest watch mode
pnpm --filter client test -- run src/utils/pathfinding.test.ts   # single file
pnpm --filter client test -- run --coverage

# Quality checks (run from repo root)
pnpm --filter client lint
pnpm --filter client typecheck
pnpm --filter client format     # writes formatting changes
pnpm audit --audit-level high   # security audit
```

## Architecture

```
client/src/
  components/     Map.astro (orchestrator), NavigationPanel.astro, OnboardingOverlay.astro
  pages/          index.astro — single page, global design tokens and PWA registration
  map/            map-state.ts, map-init.ts, route-display.ts, graph-controller.ts,
                  panel-behavior.ts, favorites-ui.ts, search-ui.ts, route-actions.ts,
                  schedule-ui.ts, dev-tools.ts
  workers/        graph-worker.ts — builds the visibility graph off the main thread
  utils/          types.ts, constants.ts, geometry.ts, graph.ts, pathfinding.ts,
                  directions.ts, search.ts, storage.ts, logger.ts
  config/         featured.ts

client/public/
  data/floor{1,2}/  nodes.json, walls.json, zones.json  ← static navigation data
  floor{1,2}.png     floor-plan images used by Leaflet image overlays
  icons/             PWA icons

worker/
  index.ts          Cloudflare Worker that serves client/dist via the ASSETS binding

scripts/
  validate-data.mjs  build-time validation for static floor data
  snap-nodes.py      destructive node-alignment helper
```

There is **no backend API or persistence layer**. All navigation data is served as static JSON from `client/public/data/`. Routing and pathfinding run client-side; visibility-graph construction is delegated to a browser Web Worker. The top-level Cloudflare Worker only serves static assets and adds response headers.

The app is an offline-first PWA. Workbox precaches the application shell, floor data, and floor images; be mindful of cache invalidation and total precache size when adding large assets.

**Developer tools**: `?dev` requires `PUBLIC_ENABLE_DEV=true` in production. In dev mode (`import.meta.env.DEV`) it is always available. The dev-tools module is lazy-loaded via dynamic `import()` to exclude it from the production entry chunk. Its editor changes are session-only — there is no persistence mechanism without a backend. Floor 2 is default.

**Security headers** (`worker/index.ts`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restricting geolocation/camera/microphone, `Strict-Transport-Security` (1 year), and a `Content-Security-Policy` allowing self-hosted assets and Google Fonts.

## Data Files

- `client/public/data/floor{1,2}/nodes.json` — array of `Node` objects (see `types.ts`)
- `client/public/data/floor{1,2}/walls.json` — array of `[lat, lng][]` wall polylines (two points is one segment)
- `client/public/data/floor{1,2}/zones.json` — array of `TrafficZone` objects

Edit these files directly to update the floor plan, then run `pnpm run validate:data`. `scripts/snap-nodes.py` rewrites node files in place and is currently hardcoded to floors 1 and 2; review or back up the data before running `python3 scripts/snap-nodes.py`.

## Code Style

**Prettier** (`.prettierrc`): `semi: false`, `singleQuote: true`, `trailingComma: 'es5'`, `printWidth: 100`, `tabWidth: 2`.

**Imports** — three groups, in order:
```typescript
import L from 'leaflet'                                      // 1. external
import { buildVisibilityGraph } from '../utils/graph'        // 2. internal (no .ts extension)
import type { Node, Graph } from '../utils/types'            // 3. type-only (always `import type`)
// inline type import also OK: import RBush, { type BBox } from 'rbush'
```

**TypeScript**:
- Strict mode on — no implicit `any`, use `unknown` when type is truly unknown
- Explicit return types on exported functions (convention; ESLint rule is `off`)
- `const` over `let`; no mutation where avoidable
- No `.ts` extensions in import paths
- Don't `return` inside `forEach` (ESLint flags it) — use `for...of` with `continue`
- Prefix unused args with `_` to silence `no-unused-vars` warning
- Cast `import.meta.env` in plain `.ts` files: `(import.meta as { env: Record<string, string> }).env`

**Naming**:

| Thing | Convention |
|-------|-----------|
| Utility files | `camelCase.ts` |
| Astro components | `PascalCase.astro` |
| Variables/functions | `camelCase`, verb-noun: `findPath()`, `buildVisibilityGraph()` |
| Constants/config | `SCREAMING_SNAKE_CASE`: `MAP_CONFIG`, `FLOORS` |
| CSS ids/classes | `kebab-case` |

**Logging** — use named loggers from `utils/logger.ts` in client code:
```typescript
import { logger, graphLogger, routeLogger, searchLogger } from '../utils/logger'
// levels: .log() .info() .warn() .error() .perf()
// new subsystem: logger.scope('MyModule')
```

**Error handling**:
- Client: early return with structured result — never throw across module boundaries
- localStorage: guard with `try/catch`, handle `QuotaExceededError`

**Astro components**: `<style is:global>` when styling elements created via `innerHTML`/JS — scoped styles don't reach dynamic DOM.

**Callback injection**: `map/` modules expose `set*Callbacks()` to avoid circular imports; the `Map.astro` script injects dependencies at startup. Do not call callback-dependent exports before initialization.

**Web Worker boundary**: graph-worker messages must use structured-cloneable data. `Map` instances are serialized as adjacency-list entries and reconstructed on the main thread. Keep a main-thread fallback for worker creation or execution failures.

**Type checking**: `astro build` transpiles TypeScript but does not replace `astro check`/`tsc --noEmit`. Run the dedicated typecheck before considering a change complete.

**CSS**: never hardcode colors/spacing — use custom properties from `index.astro`. Mobile-first; 44px min touch targets; `:active { transform: scale(0.97) }`.

## Domain Concepts

- **Visibility graph**: same-floor nodes connect when line-of-sight is clear and distance ≤ 800 px (`MAP_CONFIG.MAX_HALLWAY_DISTANCE`); per-floor RBush indexes reduce wall candidates, while node pairing remains O(N²)
- **Graph lifecycle**: `graph-controller.ts` sends all-floor nodes, walls, and zones to `graph-worker.ts`; invalidate both graph and path caches whenever navigation data changes
- **Pathfinding**: `findPath()` uses A* with a binary min-heap; `findNearestBathroom()` uses one Dijkstra traversal when a graph is available
- **Traffic zones**: `TrafficZone.intensity` multiplies edge cost when an edge endpoint is inside a zone; stored in `zones.json`
- **Stairways**: cross-floor portal nodes; `connectsTo` links floors by stairway room name (for example `["A"]`) with legacy UID support
- **Directions**: route rendering lives in `map/route-display.ts`; pure direction helpers live in `utils/directions.ts`. Keep `DirectionStep` in `types.ts` synchronized with both
- **Node types**: `room` | `waypoint` | `bathroom` | `stairway` — waypoints are invisible and not searchable
- **Walls on disk**: arrays of `[lat, lng][]` polylines; `convertWallData()` expands consecutive points into `Wall` segments `{start, end}`
- **Route cost**: graph edge costs may include traffic and stair penalties, so `PathResult.distance` is a weighted route cost rather than guaranteed physical distance
