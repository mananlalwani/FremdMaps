# School Navigation App

An interactive indoor navigation system for a multi-floor school building. Features include:

- Clickable map with A\* pathfinding between rooms
- Turn-by-turn directions with floor-change prompts at stairways
- Admin mode for editing nodes, walls, and traffic zones directly on the map
- Nearest-bathroom routing
- Room search with fuzzy matching and recency-boosted results

## Prerequisites

- **Node.js** 18+ and **pnpm** 8+
- Ports **4321** (Astro client) and **5173** (Express server) must be free

## Running locally

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # start client (port 4321) + server (port 5173) concurrently
```

Open `http://localhost:4321` in a browser.  
Append `?admin` to the URL to enter admin/editor mode.

## Building for production

```bash
pnpm --filter server build && pnpm --filter client build
```

Both commands must complete with zero TypeScript errors.

## Project layout

```
client/   Astro frontend — map UI, pathfinding, search
server/   Express backend — data persistence, server-side A* routing
data/     JSON data files per floor (nodes, walls, zones)
```

## Further reading

- **`AGENTS.md`** — full developer reference: architecture, code style, commands, domain concepts
- **`server/scripts/README.md`** — Python wall-extraction scripts for generating `walls.json` from floor-plan images
