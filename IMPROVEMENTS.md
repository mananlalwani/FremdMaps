# Improvements

A comprehensive audit of the codebase for a **dev environment**. Production-only concerns (auth, rate limiting, CORS, image compression, path traversal hardening) are excluded. Issues are grouped by category and ordered roughly by severity within each group.

---

## Bugs (broken behavior)

### 1. `updateFavoritesUI` only checks `collectedNodes` (current floor)

**Status: DONE** — `updateFavoritesUI` now filters `state.allNodesAllFloors`.

---

### 2. `toggleGraphVisualization` uses `collectedNodes` (current floor only)

**Status: DONE** — `toggleGraphVisualization` in `admin-editor.ts` looks up both nodes from `state.allNodesAllFloors`.

---

### 3. The stair cost of 50 pixels is not configurable and ignores actual distance

**Status: DONE** — `MAP_CONFIG.STAIR_COST = 250` added to `constants.ts`; `graph.ts` reads it directly. The old `graph-worker.js` is deleted; the TS worker receives `stairCost` in its message payload.

---

### 4. `handleFindNearestBathroom` uses `alert()` for all feedback

**Status: DONE** — All feedback in `handleFindNearestBathroom` now goes through `showStatusMessage`.

---

## Dev Experience / Noise

### 5. `simplifyPath` fires 8–15 `console.log` calls on every route draw

**Status: DONE** — `simplifyPath` in `geometry.ts` has no `console.log` calls.

---

### 6. Graph-worker `isDev` is hardcoded to `true`

**Status: DONE** — `graph-worker.js` replaced by `client/src/workers/graph-worker.ts`. `isDev` is passed as part of the worker message payload from `Map.astro` and gates verbose log output.

---

### 7. Debug `console.log` statements left in hot paths

**Status: DONE** — All raw `console.log` calls replaced with `graphLogger.log` throughout `admin-editor.ts` and `Map.astro`. All log output now respects `import.meta.env.DEV`.

---

### 8. No visual feedback while the navigation graph is building

**Status: DONE** — `setNavButtonsDisabled(true)` is called immediately when graph building starts; `setNavButtonsDisabled(false)` is called on both success and worker-error fallback.

---

## Architecture / Maintainability

### 9. `Map.astro` is a 2400+ line monolith

**Status: DONE** — Split into `client/src/map/map-state.ts`, `map-init.ts`, `route-display.ts`, and `admin-editor.ts`. `Map.astro` is now a lean orchestrator that wires the modules together via callbacks.

---

### 10. Shared logic is duplicated between `graph.ts` and `graph-worker.js`

**Status: DONE** — `client/public/graph-worker.js` deleted; replaced by `client/src/workers/graph-worker.ts` which imports directly from `graph.ts` and `geometry.ts`.

---

### 11. Per-floor node and wall loading is sequential

**Status: DONE** — `loadAllNodesAllFloors` and `loadAllFloorsWalls` in `map-init.ts` both use `Promise.all(FLOORS.AVAILABLE.map(...))`.

---

### 12. `SearchDropdown`, `Favorites`, and `RecentSearches` are empty shell components

**Status: DONE** — All three shell component files deleted; their markup is inlined into `NavigationPanel.astro`.

---

## TypeScript / Type Safety

### 13. `simplifyPath` uses `any[]` throughout

**Status: DONE** — `simplifyPath` signature is `(path: Node[], ...): Node[]` with no `any`.

---

### 14. `collectedNodes`, `allNodesAllFloors`, and `collectedWalls` are untyped arrays

**Status: DONE** — All three are explicitly typed in `map-state.ts`: `Node[]`, `Node[]`, `number[][][]`.

---

### 15. `nodeMarkers` is an untyped object

**Status: DONE** — `nodeMarkers: Record<string, L.Marker>` is explicitly typed in `map-state.ts`.

---

### 16. `m.__isOutline` is a type hack via `as any`

**Status: DONE** — `RouteLayer = L.Marker | { __isOutline: true; layer: L.Polyline }` is exported from `map-state.ts`; `routeMarkers: RouteLayer[]` is properly typed; no `as any` cast remains.

---

### 17. `storage.ts` and `logger.ts` use `any` in public APIs

**Status: DONE** — `storage.ts` uses `value: unknown`; all logger methods use `...args: unknown[]`.

---

### 18. `DirectionStep` interface is defined inline inside a function body

**Status: DONE** — `DirectionStep` moved to `types.ts` and imported in `route-display.ts`.

---

## Performance

### 19. `findNearestBathroom` runs a full A* search per bathroom

**Status: DONE** — Replaced with a single Dijkstra pass from the start node. O((V + E) log V) regardless of bathroom count.

---

### 20. `simplifyPath` re-matches nodes via an O(N²) scan

**Status: DONE** — A coordinate-keyed `Map` is built before the RDP step; post-RDP node lookup is O(1).

---

### 21. Graph visualization deduplication is O(E²)

**Status: DONE** — `toggleGraphVisualization` in `admin-editor.ts` uses a `Set<string>` of canonical `uid1:uid2` keys.

---

### 22. `isStorageAvailable` runs 2 localStorage operations on every read/write

**Status: DONE** — A module-level IIFE caches the result once; `isStorageAvailable()` returns the cached boolean.

---

## Cleanup / Dead Code

### 23. `populateRoomList` is a dead function

**Status: DONE** — Function no longer exists in `Map.astro`.

---

### 24. Dead event listener for `.demo-btn` elements

**Status: DONE** — Listener no longer exists in `Map.astro`.

---

### 25. `WALLS_ORIGINAL` endpoint and constant are unused

**Status: DONE** — `WALLS_ORIGINAL` removed from `constants.ts`; `/api/walls/original` endpoint removed from `server/src/index.ts`.

---

### 26. Duplicate debounce constant

**Status: DONE** — `SEARCH_DEBOUNCE_MS` removed from `UI_CONFIG` in `constants.ts`; only `SEARCH_CONFIG.DEBOUNCE_MS` in `featured.ts` remains.

---

### 27. Emoji in log strings

**Status: DONE** — No emoji remain in log strings in `graph.ts` or `logger.ts`; replaced with plain-text equivalents (`[OK]`, `[ERROR]`, `[WARN]`, etc.).

---

### 28. `getGraphStats` edge count is only correct for simple graphs

**Status: DONE** — Edge count uses a `Set<string>` of canonical `uid1:uid2` keys; the `totalDegree / 2` formula is gone.

---

### 29. The page `<title>` is hardcoded to "Wayfinder - Floor 2"

**Status: DONE** — `document.title` is updated inside `switchFloor` in `map-init.ts`.

---

## Testing

### 30. No tests exist

**Status: DONE** — Vitest configured; test suites added for `geometry.ts`, `pathfinding.ts`, `search.ts`, and `storage.ts`. 91 tests passing.
