# Agent Development Guidelines

**Tech Stack**: TypeScript monorepo — Astro (frontend, port 4321) + Express (backend, port 5173)  
**Purpose**: School indoor navigation with interactive map editing and A* pathfinding  
**Package Manager**: pnpm with workspaces (`client/`, `server/`)  
**Coordinate System**: Leaflet Simple CRS — `lat` = Y-axis, `lng` = X-axis (NOT real GPS)

## Commands

```bash
pnpm dev                                              # run client + server concurrently
pnpm --filter server build && pnpm --filter client build  # verify — must be zero errors

# client/ (Astro → localhost:4321)
pnpm dev / build / preview / lint / format
pnpm test                   # Vitest, runs once
pnpm run test:watch         # Vitest watch mode
pnpm --filter client test -- run src/utils/pathfinding.test.ts  # single file (from root)
pnpm vitest run src/utils/pathfinding.test.ts                   # single file (from client/)
pnpm --filter client test -- run --coverage

# server/ (Express → localhost:5173, no auto-reload)
pnpm dev / build / start / lint / format
```

## Architecture

```
client/src/
  components/     Map.astro (orchestrator), NavigationPanel.astro, OnboardingOverlay.astro
  pages/          index.astro — single page, all CSS custom properties defined here
  map/            map-state.ts, map-init.ts, route-display.ts, admin-editor.ts
  workers/        EMPTY — graph builds inline on main thread
  utils/          types.ts, constants.ts, geometry.ts, graph.ts, pathfinding.ts,
                  search.ts, storage.ts, logger.ts, kalman.ts
  config/         featured.ts

server/src/
  index.ts        Express app, all endpoints, Zod request validation
  graphCache.ts   In-memory graph; initGraphCache(), getGraph(), invalidateAndRebuild()
  utils/          Server-side copies of client utils — kept in sync manually

data/floor{1,2}/  nodes.json, walls.json, walls_optimized.json, zones.json
```

**Admin mode**: `?admin` in URL (`urlParams.has('admin')`). Floor 2 is default.  
**`Map.astro.backup`** is stale — not part of the active codebase.

## API Endpoints

All accept `?floor=1|2` (default `'2'`). POST bodies validated with Zod.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/nodes` | Load/save nodes |
| GET/POST | `/api/walls` | Load/save walls |
| GET/POST | `/api/zones` | Load/save traffic zones |
| GET | `/api/route?from=<uid>&to=<uid>` | Server-side A* route |
| GET | `/api/route/bathroom?from=<uid>` | Nearest bathroom route |

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
- Strict mode on in both workspaces — no implicit `any`, use `unknown` when type is truly unknown
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
Server uses `console.error` directly.

**Error handling**:
- Server: `try/catch` → `res.status(500).json({ error: '...' })`
- Client: early return with structured result — never throw across module boundaries
- localStorage: guard with `try/catch`, handle `QuotaExceededError`

**Astro components**: `<style is:global>` when styling elements created via `innerHTML`/JS — scoped styles don't reach dynamic DOM.

**Callback injection**: `map/` modules expose `set*Callbacks()` to avoid circular imports; the `Map.astro` script injects dependencies at startup.

**CSS**: never hardcode colors/spacing — use custom properties from `index.astro`. Mobile-first; 44px min touch targets; `:active { transform: scale(0.97) }`.

## Domain Concepts

- **Visibility graph**: nodes connect when line-of-sight is clear and distance ≤ 800 px (`MAP_CONFIG.MAX_HALLWAY_DISTANCE`); RBush spatial index for O(log W) wall queries
- **Traffic zones**: `TrafficZone.intensity` multiplies edge cost through congested areas; stored in `zones.json`
- **Stairways**: cross-floor portal nodes; `connectsTo` array links floors by UID or name
- **Node types**: `room` | `waypoint` | `bathroom` | `stairway` — waypoints are invisible, not searchable
- **Walls on disk**: `[lat, lng][]` arrays; `convertWallData()` converts to `Wall` objects `{start, end}`
- **`PUBLIC_API_URL`**: set in `client/.env`; read via `import.meta.env.PUBLIC_API_URL`

## Adding a New Floor

1. Add to `FLOORS.AVAILABLE` in `client/src/utils/constants.ts` (mirror to `server/src/utils/constants.ts`)
2. Add floor image to `client/public/`
3. Create `server/data/floor<N>/nodes.json`, `walls.json`, `zones.json` (all `[]`)
