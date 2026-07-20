# Architecture

Fremd Maps is a static, client-rendered Astro application. It has no application API, server
database, or user accounts: floor plans and navigation data are public static assets, while search
and routing run in the visitor's browser.

## Request and data flow

```text
Browser
  └─ Cloudflare Worker → Astro assets, floor-plan PNGs, and JSON floor data
       └─ Map.astro → map initialization + focused map modules
            ├─ Web Worker → wall-aware visibility graph
            └─ A* + directions helpers → route, floor-transition prompts, and UI
```

At startup, the client attempts to load every configured floor's `nodes.json`, `walls.json`, and
`zones.json` from `client/public/data/`. It renders the selected floor using a Leaflet image overlay
and builds a full multi-floor graph when that global load succeeds. If a floor's required navigation
data cannot load, the client falls back to the selected floor only, so cross-floor routing is
unavailable until a complete load succeeds.

## Routing

- A visibility graph connects same-floor nodes that have clear line of sight through the floor plan.
  Wall candidates are indexed with RBush; node pairing is bounded by the configured hallway distance.
- `src/workers/graph-worker.ts` performs graph construction away from the UI thread. The main thread
  falls back to local construction if the worker cannot be created or fails.
- A* finds the weighted route. Traffic zones increase edge cost; stairway portal nodes connect floors
  by their matching `connectsTo` names. A route's reported distance is therefore a weighted cost,
  not necessarily physical distance.
- Pure direction helpers convert a route into display steps, while map modules draw the route and
  coordinate floor switching.

## Client modules and state

`src/components/Map.astro` is the composition root. It initializes the map and injects callbacks
between focused modules for routing, search, favorites, schedules, responsive panel behavior, and
developer tools. This callback setup avoids circular dependencies. Shared state and graph revision
tracking live in `src/map/map-state.ts`. Navigation-data reloads advance the graph revision, which
prevents stale graph and path results from being reused; developer-tool edits also explicitly clear
the graph-related search and path caches.

## Offline behavior and hosting

The PWA uses Workbox to precache the app shell, navigation JSON, floor-plan images, icons, and other
build assets. Service workers are disabled in development to avoid masking local data edits. In
production, the app prompts visitors when a new service worker is ready so they can reload into a
new map-data release.

`worker/index.ts` serves `client/dist` using Cloudflare's Assets binding and applies security headers
for every response. It does not implement business logic or persistence.
