# School Navigation App

An interactive indoor navigation system for a multi-floor school building. Features include:

- Clickable map with A\* pathfinding between rooms
- Turn-by-turn directions with floor-change prompts at stairways
- Optional admin/debug mode (enabled only in development by default)
- Nearest-bathroom routing
- Room search with fuzzy matching and recency-boosted results
- Offline-first PWA behavior with service worker precaching

## Prerequisites

- **Node.js** 18+ and **pnpm** 8+
- Port **4321** (Astro dev server) must be free

## Running locally

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # start Astro client on port 4321
```

Open `http://localhost:4321` in a browser.  
To enable admin/debug mode outside development, set `PUBLIC_ENABLE_ADMIN=true` in `client/.env`.

## Building for production

```bash
pnpm run build
```

This runs data validation first, then builds the Astro client.

## Deployment

```bash
pnpm run deploy
```

Deploys `client/dist` as static assets via Cloudflare Worker (`worker/index.ts`) + Assets binding.

## Project layout

```
client/   Astro frontend — map UI, client-side pathfinding, search
worker/   Cloudflare Worker entry that serves static assets
scripts/  tooling (e.g. node snapping, data validation)
```

Navigation data is served as static JSON files from `client/public/data/floor*/`.
There is no runtime backend API in this branch.

## Further reading

- **`AGENTS.md`** — full developer reference: architecture, code style, commands, domain concepts
- **`docs/audit2.md`** — security and safety audit notes
- **`scripts/snap-nodes.py`** — helper script to align node coordinates after manual edits
