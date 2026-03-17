# Security & Safety Audit — SchoolNavigationApp (Serverless / Static)

**Date:** 2026-03-17  
**Scope:** Full static analysis — `client/src/`, `client/public/data/`, `scripts/`, configuration files  
**Architecture:** Static Astro SPA. All navigation data is served as unauthenticated static JSON files from `client/public/data/`. There is no backend server. The prior Express API (`server/`) has been removed.  
**Methodology:** Manual static analysis of all source files

---

## What Changed Since audit.md

The migration from Express to static eliminates all findings tied to the server process:

| Old finding | Status |
|---|---|
| C1 — Path traversal via `floor` param | **Resolved** — no server-side file I/O |
| C2 — No auth on write endpoints | **Resolved** — no write endpoints exist |
| C3 — No rate limiting | **Resolved** — no server to rate-limit |
| H2 — Synchronous blocking I/O | **Resolved** — no Node.js main thread |
| H4 — No CSRF protection | **Resolved** — no state-mutating endpoints |
| M3 — `floor` param not validated | **Resolved** — no server-side routing |
| M4 — Disk reads bypass Zod | **Resolved** — no server-side reads |
| M5 — Reflected input in error response | **Resolved** — no server-side error responses |
| M7 — Port collision with Vite | **Resolved** — single workspace, no server port |

The following old findings **persist or mutate** in the new architecture and are re-documented below with updated context:

| Old finding | New finding | Change |
|---|---|---|
| H1 — Wildcard CORS | N/A — CORS on static files is host-controlled | Hosting platform dependent |
| H3 — XSS via Leaflet divIcon | **M-4** below | Reduced severity — data now edited manually, not via unauthenticated API |
| H5 — No security headers | **M-1** below | Same issue, different remediation path |
| M1 — Client-side admin gate | **M-5** below | Same issue; admin writes are now inert |
| M2 — Floor topology in git | **H-2** below | Unchanged — data still committed |
| M6 — Hardcoded localhost URL | **L-1** below | Reduced severity — API config is now dead code |
| L2 — Logger dev-mode default | **I-1** below | Unchanged |

---

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 6 |
| Low | 5 |
| Informational | 4 |
| **Total** | **17** |

---

## High

---

### H-1 — Stale `AGENTS.md` Documents a Non-Existent Server Architecture

**File:** `AGENTS.md`

`AGENTS.md` describes a pnpm monorepo with a `server/` workspace containing an Express app, Zod-validated POST endpoints, a `graphCache.ts`, and server-side utility files. That server no longer exists. The actual `pnpm-workspace.yaml` contains only `'client'`, and navigation data has moved from `server/data/` to `client/public/data/`.

Security implications:

1. **Induced re-introduction of unauthenticated write endpoints.** A developer or automated agent following `AGENTS.md` line 123 ("Adding a New Floor") will attempt to create `server/data/floor<N>/` directories and restart an Express server. If that server is recreated without a security review — which is the natural consequence of following these docs — it reintroduces all Critical/High findings from `audit.md`: unauthenticated POST endpoints, no rate limiting, path traversal via the `floor` parameter, and wildcard CORS.

2. **Dead environment variable appears active.** `AGENTS.md` line 118 documents `PUBLIC_API_URL` as a meaningful configuration value. It is not — all data fetches use relative paths. A developer who sets `PUBLIC_API_URL` to an external host expecting it to redirect data fetches will find it has no effect, potentially leading to debugging workarounds that introduce real external dependencies.

3. **`kalman.ts` referenced but absent.** `AGENTS.md` lists `kalman.ts` as an existing utility file. The file does not exist in the codebase. Any agent that attempts to import it will produce a build error.

---

### H-2 — Complete School Floor Plan Committed to the Git Repository

**Files:** `client/public/data/floor1/nodes.json`, `client/public/data/floor1/walls.json`, `client/public/data/floor2/nodes.json`, `client/public/data/floor2/walls.json`, `client/public/data/floor2/zones.json`, `server/data/backup_old/` (still present in git history)

The complete internal layout of the school building is committed to the repository and served as world-readable static files. Content exposed includes:

- **Floor 1:** 72 nodes — all room numbers 112–179, stairway connector positions labeled A–G, bathroom locations (UIDs `016e1b24`, `a424e00d`, `d534d77e`, `b6893fba`), the Library and Main Gym, and ~750 wall segments defining precise internal geometry
- **Floor 2:** 82 nodes — rooms 200–264, stairway connectors A–G, 3 bathroom locations, ~750 wall segments, and one traffic zone with coordinate bounds

If the repository is made public or leaked, this data persists permanently in git history and cannot be revoked. For a school building, a detailed geometric floor plan including all room locations, corridor widths, stairway positions, and bathroom coordinates represents a physical security risk.

Additionally, `server/data/backup_old/` — containing an older version of this data — is still present in git history from before the serverless migration. Even if `client/public/data/` is removed from history, the `backup_old/` snapshot remains.

---

## Medium

---

### M-1 — No HTTP Security Headers Configured

**File:** `client/astro.config.mjs`

The Astro configuration is entirely empty (`defineConfig({})`). No security-related HTTP response headers are set for any route. The following headers are absent:

| Header | Risk of Absence |
|---|---|
| `Content-Security-Policy` | XSS escalation — no restriction on script/style/connect origins |
| `X-Frame-Options` / `frame-ancestors` | Clickjacking — map UI can be embedded in a malicious iframe |
| `X-Content-Type-Options: nosniff` | MIME-type sniffing on JSON data files |
| `Referrer-Policy` | `?admin` URL and room names leaked via `Referer` to Google Fonts CDN |
| `Permissions-Policy` | Unnecessary browser feature access |
| `Strict-Transport-Security` | Downgrade attacks when deployed over HTTPS |

For a static Astro site, these headers can be set via a `client/public/_headers` file (Netlify, Cloudflare Pages) or equivalent hosting-platform config. No such file exists.

---

### M-2 — Google Fonts Loaded Without Subresource Integrity

**File:** `client/src/pages/index.astro` (Google Fonts `<link>` tags in `<head>`)

The page loads external stylesheets and fonts from `fonts.googleapis.com` and `fonts.gstatic.com` without `integrity=` attributes. If the CDN is compromised, an MitM substitutes a different stylesheet, or the DNS is poisoned, the browser will apply the malicious stylesheet without any verification.

The absence of a `Content-Security-Policy` `style-src` directive (M-1) means there is no secondary control either. A compromised fonts stylesheet could inject CSS-based data exfiltration (e.g., CSS keylogger via `:visited` or `@font-face` unicode-range fingerprinting).

Note: Google Fonts responses are dynamically generated per-UA, making stable SRI hashes impractical without self-hosting.

---

### M-3 — `localStorage` Data Read Back Without Explicit Sanitization Boundary

**Files:** `client/src/utils/storage.ts`, `client/src/components/Map.astro`

Search history (`from`/`to` room name strings with timestamps), favorite node UIDs, and class schedule entries are read from `localStorage` and used in DOM operations with no sanitization at the storage boundary.

Current call paths:
- `getRecentSearches()` → `from`/`to` rendered via `textContent` helpers — **safe as written**
- `getFavorites()` → UID used to look up nodes from static JSON, result rendered via `textContent` — **safe as written**
- `getSchedule()` → `entry.period` set as `dataset.period` attribute — **safe as written**

The risk is architectural: there is no enforced contract that localStorage-derived strings must only be used via `textContent`. Any future code that passes a `from`, `to`, or `period` value into an `innerHTML` assignment — or into Leaflet's `html:` option — would immediately become a stored-XSS vector exploitable by any same-origin JavaScript (e.g., a future XSS elsewhere on the domain, or a browser extension compromise).

---

### M-4 — `innerHTML` Used with Data-Derived Values in Leaflet `divIcon` Templates

**File:** `client/src/map/route-display.ts:246`

Leaflet `divIcon` objects are created with a `html:` property using a template literal that embeds the `label` variable, which is derived from a node's `targetFloor` field loaded from static JSON:

```typescript
// route-display.ts:246
html: `<div class="route-marker-label">${label}</div>`
```

Leaflet renders `html:` via `innerHTML` internally. In the current data, `targetFloor` values are plain integer strings (`'1'`, `'2'`), making this safe in practice. However:

1. The JSON data files are now edited manually with no server-side Zod validation enforcing field types.
2. There is no schema validation when the files are fetched at runtime — the raw JSON is cast with `as Node[]`.
3. A data editor who accidentally or maliciously places `<img src=x onerror=alert(1)>` in a node's `floor` field would produce stored XSS executed in every user's browser on next load.

The same pattern appears in `admin-editor.ts` where `room.label` and other node fields are used in `html:` template literals for admin-mode markers.

---

### M-5 — Admin Mode Activated by Publicly Discoverable URL Parameter

**File:** `client/src/components/Map.astro` (admin mode check: `urlParams.has('admin')`)

Any user who navigates to `/?admin` activates the full admin map-editing interface. There is no password prompt, token check, or session requirement.

In the current static architecture, admin edits cannot be persisted (there is no server to receive POST requests), so the immediate damage radius is limited to the session. However:

1. The admin UI is exposed to any visitor — the "Admin Mode" indicator in the top-right corner of the production UI makes `?admin` trivially discoverable.
2. The admin editor still runs all client-side editing logic, including node placement, wall drawing, and stairway connection tools. Any bugs in that logic (e.g., uncaught exceptions, unhandled promise rejections) are exposed to the public.
3. If a backend is reintroduced (following the stale `AGENTS.md`), admin mode will regain write capabilities without any auth having been added, since nothing in the current code has been changed to enforce it.

---

### M-6 — Several Floor 2 Nodes Missing Required `type` Field

**File:** `client/public/data/floor2/nodes.json` (approximately the first 12 node objects)

Multiple nodes in `floor2/nodes.json` are missing the `"type"` field entirely. Example:

```json
{
  "uid": "c68d39b0-e46e-4af2-8479-d779c61eacc2",
  "rooms": ["253"],
  "lat": -2299,
  "lng": 1932,
  "floor": "2"
}
```

The TypeScript `Node` type in `types.ts` defines `type` as a required field (`'room' | 'waypoint' | 'bathroom' | 'stairway'`). At runtime, TypeScript type assertions do not validate actual JSON values — the `as Node[]` cast in the fetch handlers provides no enforcement. When client-side code accesses `node.type` on these objects it receives `undefined`, which silently breaks:

- `inferCategory()` in `search.ts` — wrong search categories returned for affected rooms
- `buildVisibilityGraph()` in `graph.ts` — stairway cross-floor connection logic fails the `type === 'stairway'` check
- `simplifyPath()` in `geometry.ts` — misclassifies nodes as non-waypoints
- `findNearestBathroom()` — may fail to find bathrooms if `type` is missing from bathroom nodes

This is a data integrity issue with direct impact on navigation correctness, affecting all users routing through floor 2 rooms with missing `type` values.

---

## Low

---

### L-1 — `PUBLIC_API_URL` and `API_CONFIG` Are Dead Code

**Files:** `client/.env:1`, `client/.env.example:1`, `client/src/utils/constants.ts` (`API_CONFIG` block)

`PUBLIC_API_URL=http://localhost:5173` remains in `.env` and `.env.example`. The `API_CONFIG` object in `constants.ts` still defines `DEFAULT_URL`, `ENDPOINTS`, and related config. Neither is consumed anywhere — all data fetches in `map-init.ts` use hardcoded relative paths (`/data/floor${N}/nodes.json`).

The risk is confusion: a developer who reads `.env` or `constants.ts` will believe the app communicates with a server at `localhost:5173`. If the dead `API_CONFIG` code is accidentally re-activated (e.g., during a backend re-introduction following `AGENTS.md`), it will target `localhost:5173` — a port that may be occupied by Vite — rather than the intended server.

---

### L-2 — `snap-nodes.py` Points to Removed `server/data/` Directory

**File:** `scripts/snap-nodes.py:21`

```python
DATA_ROOT = Path(__file__).parent.parent / "server" / "data"
```

`server/data/` no longer exists. If run today, the script iterates over an empty floors list, does nothing, and exits with code 0 — giving no indication that it processed zero files. If someone re-creates `server/data/` (following `AGENTS.md`), the script will modify data in the wrong location while `client/public/data/` remains stale.

---

### L-3 — `snap-nodes.py` Writes JSON Files Without Schema Validation

**File:** `scripts/snap-nodes.py:73–100`

The script loads `nodes.json`, modifies `lat`/`lng` values, and writes the file back with no schema validation. If the source file is malformed or missing required fields, the script will either crash mid-run (potentially writing a partially processed file with truncated JSON) or silently propagate malformed data. There is no atomic write (write to temp file + rename) — a crash during `json.dump` leaves the file in a corrupt state.

---

### L-4 — Floor 1 Has No Traffic Zones; Floor 2 Has One

**Files:** `client/public/data/floor1/zones.json` (empty array), `client/public/data/floor2/zones.json` (one zone)

Floor 1 traffic zones are empty. The A* pathfinding cost model applies no congestion penalty on floor 1, while floor 2 applies a penalty on one corridor (`intensity: 2`). This asymmetry means routes on floor 1 may direct users through crowded areas without any cost adjustment, producing suboptimal navigation during peak periods.

This is a data completeness issue rather than a security issue, but it has direct impact on the correctness of the app's core function.

---

### L-5 — No Global Unhandled Promise Rejection Handler in Client

**File:** `client/src/components/Map.astro` (initialization block)

The map initialization chain (`initMap()`, `loadFloorData()`, `buildGraph()`) involves multiple `async` functions and `fetch()` calls. If any of these throw an unhandled rejection (e.g., network failure fetching JSON, malformed JSON parse error, graph build exception), the error will appear in the browser console but the app will silently render a blank or partially initialized map with no user-visible error message. There is no `window.onerror` or `window.onunhandledrejection` handler to surface failures to the user.

---

## Informational

---

### I-1 — Logger Defaults to Development Mode Outside Astro Build Context

**File:** `client/src/utils/logger.ts:48`

```typescript
const isDev = import.meta.env.DEV ?? true
```

The `?? true` fallback means that in any environment where `import.meta.env` is not shimmed (Vitest with certain configs, direct Node.js import) the logger defaults to development mode, emitting `console.log` and `console.debug` output — including graph topology details, node UIDs, and edge counts — that should be suppressed in production. The correct production-safe default would be `false`.

---

### I-2 — `warn` and `error` Logs Reach the Console in Production

**File:** `client/src/utils/logger.ts:52–54`

The logger correctly suppresses `log`, `info`, `debug`, and `perf` in production. However, `warn` and `error` are passed through unconditionally. Pathfinding failures, graph build warnings, and storage errors are therefore visible in the browser console to any user with DevTools open. Current warning messages include internal node UIDs and graph structure details. This is not directly exploitable but reveals implementation internals to any curious user.

---

### I-3 — No Automated Dependency Vulnerability Scanning

**File:** `client/package.json`

Dependencies use `^` (caret) ranges. The `pnpm-lock.yaml` pins resolved versions, mitigating supply-chain drift between installs. However, no automated vulnerability scanning (`pnpm audit`, Dependabot, Snyk) is configured or documented. The primary risk surface is Leaflet (`^1.9.4`), a client-side library that performs DOM manipulation — a compromised or vulnerable version could introduce XSS vectors directly into the map rendering layer.

---

### I-4 — Stairway Cross-Floor Matching Uses Name Equality Without Uniqueness Enforcement

**File:** `client/src/utils/graph.ts` (stairway matching logic)

Stairway nodes use `connectsTo: ["A"]`-style name matching to link floors. The current data has exactly one stairway named `"A"`, `"B"`, etc. per floor, which works correctly. There is no uniqueness validation — if a data editor assigns the same name to two stairways on the same floor, the graph builder will silently create cross-floor connections between the wrong nodes, producing incorrect routes without any error or warning.

---

## Full Findings Index

| ID | Severity | Title | Primary File |
|---|---|---|---|
| H-1 | High | Stale `AGENTS.md` documents removed server architecture | `AGENTS.md` |
| H-2 | High | Complete floor plan committed to git and served publicly | `client/public/data/`, git history |
| M-1 | Medium | No HTTP security headers configured | `client/astro.config.mjs` |
| M-2 | Medium | Google Fonts loaded without Subresource Integrity | `index.astro` |
| M-3 | Medium | `localStorage` read-back without sanitization boundary | `storage.ts`, `Map.astro` |
| M-4 | Medium | `innerHTML` used with data-derived values in Leaflet `divIcon` | `route-display.ts:246` |
| M-5 | Medium | Admin mode activated by publicly discoverable URL parameter | `Map.astro` |
| M-6 | Medium | Floor 2 nodes missing required `type` field | `floor2/nodes.json` |
| L-1 | Low | `PUBLIC_API_URL` and `API_CONFIG` are dead code | `constants.ts`, `.env` |
| L-2 | Low | `snap-nodes.py` points to removed `server/data/` path | `scripts/snap-nodes.py:21` |
| L-3 | Low | `snap-nodes.py` writes JSON without schema validation or atomic write | `scripts/snap-nodes.py:73–100` |
| L-4 | Low | Floor 1 has no traffic zones; floor 2 has one | `floor1/zones.json`, `floor2/zones.json` |
| L-5 | Low | No unhandled promise rejection handler in client init | `Map.astro` |
| I-1 | Info | Logger defaults to dev mode outside Astro context | `logger.ts:48` |
| I-2 | Info | `warn`/`error` logs visible in production console | `logger.ts:52–54` |
| I-3 | Info | No automated dependency vulnerability scanning | `client/package.json` |
| I-4 | Info | Stairway name matching has no uniqueness enforcement | `graph.ts` |
