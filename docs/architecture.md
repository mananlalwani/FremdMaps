# Architecture

Fremd Maps is a static, client-rendered Astro application. It has no application API, server
database, or user accounts: floor plans and navigation data are public static assets, while search
and routing run in the visitor's browser.

## Request and data flow

```text
Browser
  └─ Cloudflare Worker → Astro assets, floor-plan PNGs, and JSON floor data
       └─ Map.astro → navigation modules + map and UI modules
            ├─ Navigation data → coherent complete or limited revision
            ├─ Route planner → Web Worker graph + A*
            └─ Active route → map layers, floor-transition prompts, and directions
```

At startup, the client attempts to load every configured floor's `nodes.json`, `walls.json`, and
`zones.json` from `client/public/data/`. It renders the selected floor using a Leaflet image overlay
and builds a full multi-floor graph when that global load succeeds. Nodes and walls are required for
that graph; traffic zones are optional and default to no cost adjustment when unavailable. If nodes
or walls cannot load for a floor, the client falls back to the selected floor only, so cross-floor
routing is unavailable until a complete load succeeds.

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

`src/components/Map.astro` is the composition root. It creates three navigation modules and passes
their interfaces to the map and UI modules:

- `src/navigation/navigationData.ts` loads, validates, and publishes navigation-data revisions.
  A limited revision always matches the requested current floor. Reload failures keep the last
  coherent revision.
- `src/navigation/routePlanner.ts` owns graph compilation, search, endpoint resolution, and route
  planning. It plans only when its compiled graph matches the current navigation-data revision.
- `src/navigation/activeRoute.ts` owns the route layers, floor projection, transition prompt, and
  turn-by-turn directions for one map instance.

Developer-tool edits use the same navigation-data lifecycle as loaded JSON. An edit is visible only
after navigation-data validation and graph compilation both succeed. The developer tools receive
render-ready graph connections for diagnostics rather than the graph itself.

`src/map/map-state.ts` contains only Leaflet and current-floor UI state. Graphs, cache keys, compiled
revisions, and active-route layers remain private to the navigation modules.

## Offline behavior and hosting

The PWA uses Workbox to precache the app shell, navigation JSON, floor-plan images, icons, and other
build assets. Service workers are disabled in development to avoid masking local data edits. In
production, the app prompts visitors when a new service worker is ready so they can reload into a
new map-data release.

`worker/index.ts` serves `client/dist` using Cloudflare's Assets binding and applies security headers
for every response. It does not implement business logic or persistence.
