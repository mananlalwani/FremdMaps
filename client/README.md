# client

Astro frontend for the School Navigation App. Serves the interactive floor-plan map, search, and routing UI on **port 4321**.

## Commands

Run from the `client/` directory (or prefix with `pnpm --filter client` from the repo root):

| Command           | Action                                              |
| :---------------- | :-------------------------------------------------- |
| `pnpm dev`        | Start Astro dev server at `localhost:4321`          |
| `pnpm build`      | Type-check and build to `dist/`                     |
| `pnpm preview`    | Serve the production build locally                  |
| `pnpm lint`       | ESLint                                              |
| `pnpm format`     | Prettier                                            |
| `pnpm test`       | Vitest (single run)                                 |
| `pnpm test:watch` | Vitest watch mode                                   |

## Structure

```
src/
  components/     Map.astro (orchestrator), NavigationPanel.astro, OnboardingOverlay.astro
  pages/          index.astro — single page; all CSS custom properties defined here
  map/            map-state.ts, map-init.ts, route-display.ts
  utils/          types.ts, constants.ts, geometry.ts, graph.ts, pathfinding.ts,
                  search.ts, storage.ts, logger.ts
  config/         featured.ts — featured rooms and search config

public/           floor1.png, floor2.png — floor-plan images
                data/floor*/nodes.json, walls.json, zones.json — static navigation data
```

## Key concepts

- **Admin mode**: append `?admin` to the URL to enable map editing tools.
- **Coordinate system**: Leaflet Simple CRS — `lat` = Y-axis, `lng` = X-axis (not real GPS).
- **Graph**: built inline on the main thread via `buildVisibilityGraph` in `utils/graph.ts`; routing runs entirely client-side.
- **Logging**: use named loggers from `utils/logger.ts` (`logger`, `graphLogger`, `routeLogger`, `searchLogger`) rather than raw `console.*`.
