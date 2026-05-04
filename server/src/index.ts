/**
 * @file School Navigation API — Express entry point.
 *
 * Listens on port 5173. All data is stored under `server/data/floor<N>/` as
 * plain JSON files (`nodes.json`, `walls.json`, `zones.json`). An in-memory
 * visibility graph (`graphCache.ts`) is built once at startup and rebuilt
 * whenever any POST endpoint mutates the data files.
 *
 * JSON body size limit is set to 10 MB because wall data for a full floor
 * plan can be several hundred kilobytes once the coordinate arrays are
 * serialised.
 *
 * Static floor-plan tiles are served from
 * `client/public/tiles` under the `/tiles` path so the client can request
 * map images without a separate file server.
 *
 * All endpoints accept a `?floor=<N>` query param (default `'2'`).
 */
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { z, ZodError } from 'zod';
import { initGraphCache, getGraph, getAllNodes, invalidateAndRebuild } from './graphCache';
import { findPath, findNearestBathroom } from './utils/pathfinding';

const app = express();
const PORT = 5173;

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase payload limit for wall data

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Build graph cache at startup (runs once; subsequent route queries are O(1))
initGraphCache();

// Serve floor-plan images to the client (Astro dev server does not proxy /tiles)
app.use("/tiles", express.static(path.join(__dirname, "../../client/public/tiles")));

app.get('/', (req, res) => {
    res.send('School Navigation API Running');
});

// ── Zod schemas ────────────────────────────────────────────────────────────────

/**
 * Valid room-category labels.  Must stay in sync with the `RoomCategory` type
 * in `client/src/utils/types.ts`.
 */
const RoomCategorySchema = z.enum([
    'classroom', 'office', 'lab', 'bathroom', 'cafeteria',
    'gymnasium', 'library', 'auditorium', 'stairway', 'entrance', 'other',
]);

/**
 * Single navigation node as persisted to disk.
 * Mirrors the `Node` interface in `client/src/utils/types.ts`; optional fields
 * are omitted when not applicable (e.g. `bathroomType` only for bathroom nodes,
 * `connectsTo` only for stairway nodes).
 */
const NodeSchema = z.object({
    uid: z.string().min(1),
    rooms: z.array(z.string()),
    lat: z.number(),
    lng: z.number(),
    type: z.enum(['room', 'waypoint', 'bathroom', 'stairway']).optional(),
    bathroomType: z.enum(['all-gender', 'mens', 'womens', 'accessible']).optional(),
    floor: z.string().optional(),
    connectsTo: z.array(z.string()).optional(),
    category: RoomCategorySchema.optional(),
});

/** Full nodes payload — an array of zero or more nodes. */
const NodesPayloadSchema = z.array(NodeSchema);

/** Wall on disk: array of [lat, lng] coordinate pairs (≥2 points) */
const WallSchema = z.array(z.tuple([z.number(), z.number()])).min(2);
/** Full walls payload — an array of zero or more walls. */
const WallsPayloadSchema = z.array(WallSchema);

/** Traffic zone Zod schema */
const TrafficZoneSchema = z.object({
    uid: z.string().min(1),
    floor: z.string().min(1),
    bounds: z.object({
        minLat: z.number(),
        minLng: z.number(),
        maxLat: z.number(),
        maxLng: z.number(),
    }),
    /** Cost multiplier applied to edges crossing this zone; clamped to [1.0, 10.0]. */
    intensity: z.number().min(1.0).max(10.0),
});
/** Full zones payload — an array of zero or more traffic zones. */
const ZonesPayloadSchema = z.array(TrafficZoneSchema);

/**
 * Parse and validate a request body against a Zod schema.
 *
 * On success, returns the typed validated data.
 * On failure, writes a `400` JSON response with field-level error details and
 * returns `null` — the caller must return immediately after receiving `null`
 * because the response has already been committed.
 *
 * @param schema - Zod schema to validate against.
 * @param body   - Raw `req.body` value.
 * @param res    - Express response (used to send the 400 on failure).
 * @returns Validated `T` on success, or `null` if validation failed (response sent).
 */
function parseBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    res: express.Response,
): T | null {
    const result = schema.safeParse(body);
    if (!result.success) {
        const formatted = (result.error as ZodError).issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
        }));
        res.status(400).json({ success: false, errors: formatted });
        return null;
    }
    return result.data;
}

// ── Helper ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to a floor-specific data file.
 *
 * NOTE: An identical copy of this function exists in `server/src/graphCache.ts`.
 * The duplication is intentional — keeping each module self-contained avoids a
 * circular dependency between `index.ts` and `graphCache.ts`.
 *
 * @param floor    - Floor identifier (e.g. `'1'` or `'2'`).
 * @param filename - File name within the floor directory (e.g. `'nodes.json'`).
 * @returns Absolute path: `<DATA_DIR>/floor<floor>/<filename>`.
 */
function getFloorDataPath(floor: string, filename: string): string {
    const floorDir = path.join(DATA_DIR, `floor${floor}`);
    return path.join(floorDir, filename);
}

/**
 * Ensure the floor-specific directory exists before writing.
 * Safe to call repeatedly — mkdirSync with recursive:true is a no-op when it
 * already exists.
 */
function ensureFloorDir(floor: string): void {
    const floorDir = path.join(DATA_DIR, `floor${floor}`);
    fs.mkdirSync(floorDir, { recursive: true });
}

/**
 * Narrow Express query param to a plain string with a fallback.
 * Prevents `string | ParsedQs | string[] | ParsedQs[] | undefined` from
 * silently becoming the string "undefined" or an array.
 */
function queryString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

// ── POST /api/nodes ────────────────────────────────────────────────────────────

// Save nodes endpoint (floor-aware)
app.post('/api/nodes', (req, res) => {
    try {
        const nodes = parseBody(NodesPayloadSchema, req.body, res);
        if (nodes === null) return;

        const floor = queryString(req.query.floor, '2');
        console.log(`Received ${nodes.length} nodes to save for floor ${floor}.`);

        const nodesPath = getFloorDataPath(floor, 'nodes.json');
        ensureFloorDir(floor);
        fs.writeFileSync(nodesPath, JSON.stringify(nodes, null, 2));

        // Rebuild the in-memory graph so route queries immediately reflect new data
        invalidateAndRebuild();

        res.json({ success: true, message: 'Nodes saved successfully' });
    } catch (error) {
        console.error('Error saving nodes:', error);
        res.status(500).json({ success: false, message: 'Failed to save nodes' });
    }
});

// ── POST /api/walls ────────────────────────────────────────────────────────────

// Save walls endpoint (floor-aware)
app.post('/api/walls', (req, res) => {
    try {
        const walls = parseBody(WallsPayloadSchema, req.body, res);
        if (walls === null) return;

        const floor = queryString(req.query.floor, '2');
        console.log(`Received ${walls.length} walls to save for floor ${floor}.`);

        const wallsPath = getFloorDataPath(floor, 'walls.json');
        ensureFloorDir(floor);
        fs.writeFileSync(wallsPath, JSON.stringify(walls, null, 2));

        // Rebuild the in-memory graph so route queries immediately reflect new walls
        invalidateAndRebuild();

        res.json({ success: true, message: 'Walls saved successfully' });
    } catch (error) {
        console.error('Error saving walls:', error);
        res.status(500).json({ success: false, message: 'Failed to save walls' });
    }
});

// ── GET /api/nodes ─────────────────────────────────────────────────────────────

/**
 * Return the saved nodes for a floor.
 *
 * Query params:
 *   floor – floor identifier (default `'2'`)
 *
 * Response 200: `Node[]`  (empty array when no file exists yet)
 * Response 500: `{ error: string }`
 */
app.get('/api/nodes', (req, res) => {
    try {
        const floor = queryString(req.query.floor, '2');
        const nodesPath = getFloorDataPath(floor, 'nodes.json');

        if (fs.existsSync(nodesPath)) {
            const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));
            res.json(nodes);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error loading nodes:', error);
        res.status(500).json({ error: 'Failed to load nodes' });
    }
});

// ── GET /api/walls ─────────────────────────────────────────────────────────────

/**
 * Return the saved walls for a floor.
 *
 * Query params:
 *   floor – floor identifier (default `'2'`)
 *
 * Response 200: `number[][][]`  (array of `[lat, lng][]` wall polylines; empty array when none)
 * Response 500: `{ error: string }`
 */
app.get('/api/walls', (req, res) => {
    try {
        const floor = queryString(req.query.floor, '2');
        const wallsPath = getFloorDataPath(floor, 'walls.json');

        if (fs.existsSync(wallsPath)) {
            const walls = JSON.parse(fs.readFileSync(wallsPath, 'utf8'));
            res.json(walls);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error loading walls:', error);
        res.status(500).json({ error: 'Failed to load walls' });
    }
});

// ── GET /api/zones ─────────────────────────────────────────────────────────────

app.get('/api/zones', (req, res) => {
    try {
        const floor = queryString(req.query.floor, '2');
        const zonesPath = getFloorDataPath(floor, 'zones.json');

        if (fs.existsSync(zonesPath)) {
            const zones = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
            res.json(zones);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error loading zones:', error);
        res.status(500).json({ error: 'Failed to load zones' });
    }
});

// ── POST /api/zones ────────────────────────────────────────────────────────────

app.post('/api/zones', (req, res) => {
    try {
        const zones = parseBody(ZonesPayloadSchema, req.body, res);
        if (zones === null) return;

        const floor = queryString(req.query.floor, '2');
        console.log(`Received ${zones.length} zones to save for floor ${floor}.`);

        const zonesPath = getFloorDataPath(floor, 'zones.json');
        ensureFloorDir(floor);
        fs.writeFileSync(zonesPath, JSON.stringify(zones, null, 2));

        // Rebuild the in-memory graph so route queries immediately reflect new zones
        invalidateAndRebuild();

        res.json({ success: true, message: 'Zones saved successfully' });
    } catch (error) {
        console.error('Error saving zones:', error);
        res.status(500).json({ success: false, message: 'Failed to save zones' });
    }
});


// ── GET /api/route ─────────────────────────────────────────────────────────────

/**
 * Find the shortest path between two nodes.
 *
 * Query params:
 *   from  – UID of the start node (required)
 *   to    – UID of the goal node  (required)
 *
 * Response 200: { path: Node[], distance: number, found: boolean }
 * Response 400: { error: string }
 * Response 503: { error: string }  (graph not ready)
 */
app.get('/api/route', (req, res) => {
    try {
        const fromUid = (req.query.from as string | undefined)?.trim();
        const toUid   = (req.query.to   as string | undefined)?.trim();

        if (!fromUid || !toUid) {
            res.status(400).json({ error: 'Query params "from" and "to" are required' });
            return;
        }

        const graph = getGraph();
        const nodes = getAllNodes();

        const result = findPath(fromUid, toUid, nodes, graph);
        res.json(result);
    } catch (error) {
        if (error instanceof Error && error.message.includes('not initialised')) {
            res.status(503).json({ error: 'Navigation graph not ready — try again shortly' });
        } else {
            console.error('Error finding route:', error);
            res.status(500).json({ error: 'Failed to find route' });
        }
    }
});

// ── GET /api/route/bathroom ────────────────────────────────────────────────────

/**
 * Find the nearest reachable bathroom and return a full path to it.
 *
 * Query params:
 *   from  – UID of the start node (required)
 *
 * Response 200: { path: Node[], distance: number, found: boolean }
 * Response 400: { error: string }
 * Response 404: { error: string }  (no reachable bathroom)
 * Response 503: { error: string }  (graph not ready)
 */
app.get('/api/route/bathroom', (req, res) => {
    try {
        const fromUid = (req.query.from as string | undefined)?.trim();

        if (!fromUid) {
            res.status(400).json({ error: 'Query param "from" is required' });
            return;
        }

        const graph = getGraph();
        const nodes = getAllNodes();

        const startNode = nodes.find(n => n.uid === fromUid);
        if (!startNode) {
            res.status(400).json({ error: `Node not found: "${fromUid}"` });
            return;
        }

        const bathroom = findNearestBathroom(startNode, nodes, graph);
        if (!bathroom) {
            res.status(404).json({ error: 'No reachable bathrooms found' });
            return;
        }

        const result = findPath(fromUid, bathroom.uid, nodes, graph);
        res.json(result);
    } catch (error) {
        if (error instanceof Error && error.message.includes('not initialised')) {
            res.status(503).json({ error: 'Navigation graph not ready — try again shortly' });
        } else {
            console.error('Error finding nearest bathroom:', error);
            res.status(500).json({ error: 'Failed to find nearest bathroom' });
        }
    }
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
