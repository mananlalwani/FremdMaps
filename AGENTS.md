# Agent Development Guidelines

**Tech Stack**: TypeScript — Astro static SPA (port 4321)  
**Purpose**: School indoor navigation with A* pathfinding  
**Package Manager**: pnpm with a single workspace (`client/`)  
**Coordinate System**: Leaflet Simple CRS — `lat` = Y-axis, `lng` = X-axis (NOT real GPS)

## Commands

```bash
pnpm --filter client dev      # dev server → localhost:4321
pnpm --filter client build    # production build — must produce zero errors
pnpm --filter client preview  # preview production build locally

# Tests (run from repo root or client/)
pnpm --filter client test                                            # Vitest, runs once
pnpm run test:watch                                                  # Vitest watch mode (from client/)
pnpm --filter client test -- run src/utils/pathfinding.test.ts      # single file
pnpm --filter client test -- run --coverage

# Lint / format (from client/)
pnpm lint
pnpm format
```

## Architecture

```
client/src/
  components/     Map.astro (orchestrator), NavigationPanel.astro, OnboardingOverlay.astro
  pages/          index.astro — single page, all CSS custom properties defined here
  map/            map-state.ts, map-init.ts, route-display.ts
  workers/        EMPTY — graph builds inline on main thread
  utils/          types.ts, constants.ts, geometry.ts, graph.ts, pathfinding.ts,
                  search.ts, storage.ts, logger.ts
  config/         featured.ts

client/public/
  data/floor{1,2}/  nodes.json, walls.json, zones.json  ← static navigation data
  tiles/            map tile images
```

There is **no backend server**. All navigation data is served as static JSON from `client/public/data/`. Routing and pathfinding run entirely client-side.

**Admin mode**: `?admin` in URL (`urlParams.has('admin')`). Admin edits are session-only — there is no persistence mechanism without a server. Floor 2 is default.

## Data Files

- `client/public/data/floor{1,2}/nodes.json` — array of `Node` objects (see `types.ts`)
- `client/public/data/floor{1,2}/walls.json` — array of `[lat, lng][]` wall segments
- `client/public/data/floor{1,2}/zones.json` — array of `TrafficZone` objects

Edit these files directly to update the floor plan. Run `python3 scripts/snap-nodes.py` after editing node positions to straighten rows/columns.

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

**Callback injection**: `map/` modules expose `set*Callbacks()` to avoid circular imports; the `Map.astro` script injects dependencies at startup.

**CSS**: never hardcode colors/spacing — use custom properties from `index.astro`. Mobile-first; 44px min touch targets; `:active { transform: scale(0.97) }`.

## Domain Concepts

- **Visibility graph**: nodes connect when line-of-sight is clear and distance ≤ 800 px (`MAP_CONFIG.MAX_HALLWAY_DISTANCE`); RBush spatial index for O(log W) wall queries
- **Traffic zones**: `TrafficZone.intensity` multiplies edge cost through congested areas; stored in `zones.json`
- **Stairways**: cross-floor portal nodes; `connectsTo` array links floors by name (e.g. `["A"]`)
- **Node types**: `room` | `waypoint` | `bathroom` | `stairway` — waypoints are invisible, not searchable
- **Walls on disk**: `[lat, lng][]` arrays; `convertWallData()` converts to `Wall` objects `{start, end}`

## Adding a New Floor

1. Add an entry to `FLOORS.AVAILABLE` in `client/src/utils/constants.ts`.
2. Add the floor image to `client/public/`.
3. Create `client/public/data/floor<N>/nodes.json`, `walls.json`, `zones.json` (all `[]`).
