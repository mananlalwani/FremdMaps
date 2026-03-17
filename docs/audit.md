# Security & Safety Audit — SchoolNavigationApp

**Date:** 2026-03-16  
**Scope:** Full static analysis — `server/src/`, `client/src/`, configuration files, data files  
**Methodology:** Manual static analysis of all source files  
**Deployment assumption:** Rated for eventual public internet deployment. A serverless migration is in progress; findings marked **[serverless-relevant]** change in exploitability or character under that architecture.

---

## Summary

| Severity | Count |
|---|---|
| Critical | 3 |
| High | 5 |
| Medium | 7 |
| Low | 6 |
| Informational | 4 |
| **Total** | **25** |

---

## Critical

---

### C1 — Path Traversal via Unsanitized `floor` Query Parameter

**Files:** `server/src/index.ts:145–148`, `server/src/graphCache.ts:59–61`

The `floor` query parameter is taken directly from the HTTP request and embedded into a filesystem path with no allowlist validation.

```typescript
// server/src/index.ts:145-148
function getFloorDataPath(floor: string, filename: string): string {
  const floorDir = path.join(DATA_DIR, `floor${floor}`)
  return path.join(floorDir, filename)
}
```

`path.join` does not neutralize `..` components. An attacker can supply:

- `GET /api/nodes?floor=../../etc/passwd` → reads `/etc/passwd`
- `GET /api/walls?floor=../../../home/manan/.ssh/id_rsa` → reads SSH private key
- `POST /api/nodes?floor=../../server/src/` → overwrites application source files on disk

The `filename` argument (`'nodes.json'`, `'walls.json'`, etc.) is hard-coded, but the `floor` segment is fully attacker-controlled and traverses outside `DATA_DIR` when it contains `..` sequences. Every GET and POST endpoint that calls `getFloorDataPath` is affected.

**[serverless-relevant]:** Under a serverless/cloud storage architecture (e.g. S3-backed data), path traversal of the local filesystem is eliminated. However, the same unsanitized parameter could enable object-key manipulation or bucket enumeration if the storage key is constructed similarly.

---

### C2 — No Authentication or Authorization on Any Write Endpoint

**Files:** `server/src/index.ts:172`, `server/src/index.ts:197`, `server/src/index.ts:296`

All three POST endpoints (`/api/nodes`, `/api/walls`, `/api/zones`) that persist data to disk and trigger a full graph rebuild carry zero authentication. Any unauthenticated party can:

1. **Destroy all navigation data** by POSTing `[]` to all three endpoints.
2. **Inject malicious content** into room names or labels — data the client later renders via `innerHTML` inside Leaflet marker templates (see H3).
3. **Trigger repeated expensive graph rebuilds** as a denial-of-service vector (see H2).

The GET endpoints are also unauthenticated, exposing the complete school floor topology (all room numbers, coordinates, and connectivity graph) to any requester.

**[serverless-relevant]:** This finding is equally critical in a serverless deployment; the API surface and mutation risk are identical regardless of runtime host.

---

### C3 — No Rate Limiting on Any Endpoint

**Files:** `server/src/index.ts:172`, `server/src/index.ts:197`, `server/src/index.ts:296`, `server/src/index.ts:332`, `server/src/index.ts:370`

No rate limiting is applied to any endpoint. The POST endpoints are especially dangerous because each one invokes `invalidateAndRebuild()`, which runs synchronously on the Node.js main thread (see H2). A single unauthenticated attacker can send a sustained flood of POST requests that continuously saturates the CPU, making the server unresponsive to all users indefinitely.

**[serverless-relevant]:** Serverless platforms impose per-invocation concurrency limits which partially mitigate unbounded throughput amplification, but without rate limiting a low-cost flood can still exhaust invocation budgets or trigger significant scaling costs.

---

## High

---

### H1 — Wildcard CORS — All Origins Accepted

**File:** `server/src/index.ts:30`

```typescript
app.use(cors())
```

`cors()` with no options defaults to `Access-Control-Allow-Origin: *`. This allows any website on the internet to issue requests to the API from a visitor's browser. Combined with the unauthenticated POST endpoints (C2), a malicious page visited by any school user on the same network can silently overwrite or wipe all navigation data via cross-origin fetch.

---

### H2 — Synchronous Blocking I/O on the Main Thread

**Files:** `server/src/index.ts:182`, `server/src/index.ts:207`, `server/src/index.ts:306`, `server/src/graphCache.ts` (all `readFileSync`/`writeFileSync` calls)

All file reads and writes use synchronous Node.js `fs` APIs (`readFileSync`, `writeFileSync`, `mkdirSync`). These block the entire event loop for the duration of each I/O operation. The graph rebuild path in `graphCache.ts` — which reads multiple JSON files, parses them, and runs an O(N² × log W) visibility-graph algorithm — can block the event loop for hundreds of milliseconds, making the server unable to respond to any concurrent request during that window.

This compounds with C3: a flood of POST requests triggers repeated blocking rebuilds, achieving a reliable denial-of-service with very low attacker effort.

---

### H3 — XSS via Server-Sourced Data in Leaflet `divIcon` HTML Templates

**Files:** `client/src/map/route-display.ts:246`, `client/src/map/admin-editor.ts` (multiple locations)

Leaflet `divIcon` objects are created using template literals that embed server-fetched node data. Leaflet renders the `html:` property via `innerHTML` internally. If an attacker with write access to the server (C2) stores a room name or label containing HTML or script tags, it will execute in the victim's browser:

```typescript
// route-display.ts:246
html: `...${ label ? ' &rarr; ' + label : '' }`
```

Here `label` originates from server-supplied node data and is not HTML-escaped before interpolation. The same pattern appears throughout `admin-editor.ts` where `room.label`, `room.uid`, and other node fields are templated into `html:` strings used to construct `divIcon` markup.

---

### H4 — No CSRF Protection on State-Mutating POST Endpoints

**Files:** `server/src/index.ts:172`, `server/src/index.ts:197`, `server/src/index.ts:296`

The server accepts `Content-Type: application/json` POST requests with no CSRF token and no `SameSite` cookie enforcement (there are no cookies at all). In conjunction with wildcard CORS (H1), any page an admin visits can forge requests to mutate or destroy navigation data. Once authentication is added, the absence of CSRF protection will become the primary bypass.

---

### H5 — No Security Headers

**File:** `server/src/index.ts`

The Express server sets no security-related HTTP response headers. The following are entirely absent:

| Header | Risk of Absence |
|---|---|
| `Content-Security-Policy` | Escalates XSS impact (H3) — no restrictions on script sources |
| `X-Frame-Options` | Clickjacking — the map UI can be embedded in a malicious iframe |
| `X-Content-Type-Options` | MIME-type sniffing on served JSON or assets |
| `Strict-Transport-Security` | SSL-stripping attacks when deployed over HTTPS |
| `Referrer-Policy` | Navigation URLs (including `?admin`) leaked in `Referer` headers to third parties |

---

## Medium

---

### M1 — Admin Panel Gated Solely by Client-Side URL Parameter

**Files:** `client/src/pages/index.astro:212–213`, `client/src/map/admin-editor.ts`

Admin/editor mode is enabled by checking `urlParams.has('admin')` in client-side JavaScript. There is no server-side enforcement whatsoever.

```typescript
// index.astro:212-213
const urlParams = new URLSearchParams(window.location.search)
const isAdmin = urlParams.has('admin')
```

The "Admin Mode" button in the top-right corner of the UI makes the `?admin` URL trivially discoverable. Because the server POST endpoints require no authentication (C2), gaining "admin mode" requires only appending `?admin` to the URL — no credentials needed. The client-side check provides zero security value on its own.

---

### M2 — Complete Floor Topology Committed to Git Repository

**Files:** `server/data/floor1/nodes.json`, `server/data/floor1/walls.json`, `server/data/floor2/nodes.json`, `server/data/floor2/walls.json`, `server/data/backup_old/` (all files)

The complete school floor plan — all room numbers, coordinates, wall geometry, and navigation graph — is committed to the git repository and persists permanently in git history. The `backup_old/` directory contains an older version of this data, also tracked. If the repository is ever made public or leaked, this data cannot be revoked.

---

### M3 — `floor` Parameter Never Validated Against Known-Good Allowlist

**Files:** `server/src/index.ts:177`, `server/src/index.ts:202`, `server/src/index.ts:260`, `server/src/index.ts:279`, `server/src/index.ts:300`

Even setting aside the path traversal (C1), the `floor` parameter is never checked against the known valid set of floors (`['1', '2']`) defined in `constants.ts`. Consequences include:

- `?floor=3` silently creates a new `data/floor3/` directory on the first write.
- `?floor=` (empty string) creates a `data/floor/` directory.
- `?floor=backup_old` reads from the backup data directory, exposing historical topology that may differ from the current floor plan.

---

### M4 — Data Files Read from Disk Without Schema Validation

**Files:** `server/src/graphCache.ts` (all `JSON.parse(readFileSync(...))` calls), `server/src/index.ts:236`, `server/src/index.ts:264`, `server/src/index.ts:283`

On GET endpoints and at server startup, JSON files are read from disk and cast directly with no Zod validation:

```typescript
const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8')) as Node[]
```

Zod validation is only applied to incoming POST bodies. If a data file is manually edited with invalid structure, partially written due to a crash mid-write, or if the schema evolves without a migration, the server will either crash with an unhandled exception or silently return malformed data to clients. The GET endpoints relay whatever is on disk directly to clients as authoritative data.

---

### M5 — Attacker-Controlled Input Reflected in Error Response Body

**File:** `server/src/index.ts:384`

The `/api/route/bathroom` endpoint reflects the caller-supplied `fromUid` query parameter directly into a JSON error response:

```typescript
res.status(400).json({ error: `Node not found: "${fromUid}"` })
```

`fromUid` is taken from the request with no sanitization before reflection. While JSON API responses are not directly rendered as HTML, this pattern can contribute to reflected-injection chains in contexts where the response body is later processed unsafely (e.g. an intermediary that logs or renders the `error` field without escaping).

---

### M6 — API Base URL Hardcoded to `localhost:5173`

**Files:** `client/src/utils/constants.ts:62`, `client/.env`

```typescript
export const API_CONFIG = {
  DEFAULT_URL: 'http://localhost:5173',
  ...
}
```

The `.env` file sets `PUBLIC_API_URL=http://localhost:5173`. If the application is deployed without explicitly overriding this environment variable, the client silently targets `localhost:5173` on each visitor's own machine. This will fail for every user except those running the server locally, with no visible error to the end user. In a school deployment this results in navigation data being silently unavailable for all users.

---

### M7 — Server Port 5173 Collides with Vite Dev Server Default

**File:** `server/src/index.ts:28`

```typescript
const PORT = 5173
```

Port 5173 is Vite's default dev server port. Starting both the client (`pnpm dev` in `client/`) and the server in the same environment will cause a port conflict. The Express server and the Vite dev server may race for the port, and whichever loses will fail silently or emit a non-obvious error. This also means `PUBLIC_API_URL` pointing to `localhost:5173` may inadvertently route API requests to Vite rather than Express during development, producing confusing failures.

---

## Low

---

### L1 — No Global Express Error Handler — Stack Traces May Leak in Unhandled Cases

**File:** `server/src/index.ts`

The existing `try/catch` blocks correctly return generic error messages and log details only to `console.error`. However, if an unhandled exception escapes all `try/catch` blocks — from middleware, Zod internals, or future code additions — Express's default error handler will render a stack trace in the response body in development mode. No final-catch error handler middleware is registered.

---

### L2 — Logger Defaults to Development Mode in Non-Astro Contexts

**File:** `client/src/utils/logger.ts:48`

```typescript
const isDev = import.meta.env.DEV ?? true
```

The `?? true` fallback means that in any context where `import.meta.env` is not properly shimmed (e.g. certain Vitest configurations, or if the module is ever imported outside an Astro build), the logger defaults to development mode. This enables `console.log` and `console.debug` output — including internal graph topology details, node UIDs, and edge counts — in what may be a production or test context.

---

### L3 — `walls_optimized.json` Files Committed but Never Referenced

**Files:** `server/data/floor1/walls_optimized.json`, `server/data/floor2/walls_optimized.json`

These files are committed to git and present on disk but are not referenced by any server or client code. They appear to be stale pre-processing artifacts. Their presence creates ambiguity about which file is the authoritative wall data source and unnecessarily increases repository and deployment size.

---

### L4 — `backup_old/` Data Directory Committed to Repository

**File:** `server/data/backup_old/`

A `backup_old/` directory containing `nodes.json`, `walls.json`, and `walls_optimized.json` is committed to the repository. No code references this path at runtime. It represents historical floor plan data that serves no production purpose, increases repository size, and permanently exposes older topology in git history.

---

### L5 — Student Schedule and Search History Stored in Plaintext `localStorage`

**File:** `client/src/utils/storage.ts`

User search history (room-name pairs with timestamps) and class schedule entries (period → room number) are stored in `localStorage` in plaintext. For a school application, a student's class schedule reveals their physical location throughout the school day. Any JavaScript running on the same origin can read this data, and `localStorage` is not encrypted at rest by browsers.

This is acceptable for typical web app usage but warrants acknowledgment in a school context where student location data may be subject to privacy regulations (FERPA, COPPA, or equivalent).

---

### L6 — Admin Editor Uses Blocking Browser Dialogs for Data Entry

**File:** `client/src/map/admin-editor.ts`

The admin editor uses `prompt()` and `confirm()` for node name entry, deletion confirmation, and stairway connection management. These are synchronous, blocking, and suppressed entirely by many browser extensions and some managed browser policies common in school IT environments. Data entered via `prompt()` is not sanitized before being sent to the server — if the server were to reflect this data unsafely, there is a stored-XSS path through admin input (see H3).

---

## Informational

---

### I1 — TypeScript Strict Mode Enabled in Both Workspaces

**Files:** `server/tsconfig.json:6`, `client/tsconfig.json` (via `astro/tsconfigs/strict`)

Both workspaces correctly enable TypeScript strict mode. The server uses `"strict": true` explicitly; the client extends Astro's strict preset. This meaningfully reduces the surface area for type-confusion bugs and implicit `any` coercions.

---

### I2 — Zod Validation Applied to All POST Request Bodies

**File:** `server/src/index.ts:66–130`

All three POST endpoints validate request bodies against well-defined Zod schemas. The `intensity` field on traffic zones is numerically clamped to `[1.0, 10.0]`. Field-level error messages are returned on validation failure. This is a positive control, though it does not mitigate the unauthenticated access (C2) or path traversal (C1) findings.

---

### I3 — Logger Correctly Suppresses Verbose Output in Production Builds

**File:** `client/src/utils/logger.ts:52–54`

The client logger suppresses `log`, `info`, `debug`, and `perf` calls when `import.meta.env.DEV` is `false`, passing only `warn` and `error` through. This prevents internal graph topology details (node UIDs, edge counts, stairway connections) from being exposed in the browser console of production builds. See L2 for the one edge case where this protection is bypassed.

---

### I4 — `Map.astro.backup` Is a Stale File in the Active Source Tree

**File:** `client/src/components/Map.astro.backup`

A `.backup` file with the same name as the active `Map.astro` component exists in the source tree. It is acknowledged in `AGENTS.md` as stale and not part of the active codebase. However, depending on build tooling configuration, stale files with near-matching names could be accidentally resolved as imports. The file should be removed or moved outside the `src/` directory.

---

## Full Findings Index

| ID | Severity | Title | Primary File |
|---|---|---|---|
| C1 | Critical | Path traversal via `floor` query parameter | `server/src/index.ts:145` |
| C2 | Critical | No authentication on write endpoints | `server/src/index.ts:172,197,296` |
| C3 | Critical | No rate limiting on any endpoint | `server/src/index.ts` |
| H1 | High | Wildcard CORS | `server/src/index.ts:30` |
| H2 | High | Synchronous blocking I/O on main thread | `server/src/index.ts`, `graphCache.ts` |
| H3 | High | XSS via node data in Leaflet `divIcon` templates | `route-display.ts:246`, `admin-editor.ts` |
| H4 | High | No CSRF protection on POST endpoints | `server/src/index.ts:172,197,296` |
| H5 | High | No security headers | `server/src/index.ts` |
| M1 | Medium | Admin panel gated by client-side URL param only | `index.astro:212` |
| M2 | Medium | Floor topology committed to git | `server/data/` |
| M3 | Medium | `floor` param not validated against allowlist | `server/src/index.ts:177` |
| M4 | Medium | Disk reads bypass Zod schema validation | `graphCache.ts`, `index.ts:236,264,283` |
| M5 | Medium | Attacker input reflected in error response | `server/src/index.ts:384` |
| M6 | Medium | API URL hardcoded to `localhost:5173` | `constants.ts:62`, `client/.env` |
| M7 | Medium | Server port collides with Vite default (5173) | `server/src/index.ts:28` |
| L1 | Low | No global Express error handler | `server/src/index.ts` |
| L2 | Low | Logger defaults to dev mode outside Astro | `logger.ts:48` |
| L3 | Low | `walls_optimized.json` tracked but unused | `server/data/floor*/walls_optimized.json` |
| L4 | Low | `backup_old/` data directory tracked in git | `server/data/backup_old/` |
| L5 | Low | Student schedule in plaintext localStorage | `storage.ts` |
| L6 | Low | Admin editor uses blocking `prompt()`/`confirm()` | `admin-editor.ts` |
| I1 | Info | TypeScript strict mode enabled in both workspaces | `tsconfig.json` (both) |
| I2 | Info | Zod validation on all POST bodies | `server/src/index.ts:66–130` |
| I3 | Info | Logger suppresses verbose output in production | `logger.ts:52` |
| I4 | Info | `Map.astro.backup` stale file in source tree | `client/src/components/Map.astro.backup` |
