/**
 * In-memory graph cache for the navigation server.
 *
 * The visibility graph is expensive to build (O(N² × W)) so it is built
 * once at startup and held in memory.  The cache is invalidated — and the
 * graph synchronously rebuilt — whenever nodes or walls are saved via the
 * admin API.  All `/api/route` requests read from the cached graph and
 * therefore never pay the build cost at query time.
 *
 * Public API:
 *   initGraphCache()   – call once at server startup
 *   getGraph()         – returns the current Graph (Map<uid, Edge[]>)
 *   getAllNodes()       – returns all nodes across all floors
 *   invalidateAndRebuild() – rebuild after an admin save
 */

import fs from 'fs'
import path from 'path'
import { buildVisibilityGraph } from './utils/graph'
import { convertWallData } from './utils/geometry'
import { FLOORS, MAP_CONFIG } from './utils/constants'
import type { Node, Wall, Graph, TrafficZone } from './utils/types'

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Cached visibility graph. `null` means the cache has not been built yet —
 *  NOT the same as an empty graph (which would be `new Map()`). */
let _graph: Graph | null = null

/** All nodes across every floor, with `node.floor` set by `loadNodesForFloor`.
 *  Reset to `[]` at the start of a rebuild and atomically replaced at the end. */
let _allNodes: Node[] = []

/** Guard flag that prevents concurrent rebuild calls.  Rebuilding is
 *  synchronous but `invalidateAndRebuild` may be called from concurrent
 *  POST handlers, so we gate on this flag rather than relying on single-
 *  threaded semantics alone. */
let _isBuilding = false

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, '../data')

/**
 * Resolve the absolute path to a floor-specific data file.
 *
 * NOTE: An identical copy of this function exists in `server/src/index.ts`.
 * The duplication is intentional — keeping `graphCache.ts` self-contained
 * avoids a circular dependency between the two modules.
 *
 * @param floorId  Floor identifier (e.g. `'1'` or `'2'`).
 * @param filename File name within the floor directory (e.g. `'nodes.json'`).
 * @returns Absolute path: `<DATA_DIR>/floor<floorId>/<filename>`.
 */
function getFloorDataPath(floorId: string, filename: string): string {
  return path.join(DATA_DIR, `floor${floorId}`, filename)
}

/**
 * Load all nodes for a floor from disk and tag each one with its floor ID.
 *
 * The `node.floor` property is set in-place on every node returned — this
 * mutation is load-bearing: the graph builder uses `node.floor` to partition
 * nodes into per-floor spatial indices and to skip cross-floor edges.
 *
 * Returns `[]` if the file does not exist yet (new floor with no data).
 */
function loadNodesForFloor(floorId: string): Node[] {
  const filePath = getFloorDataPath(floorId, 'nodes.json')
  if (!fs.existsSync(filePath)) return []
  try {
    const nodes: Node[] = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    // Tag each node with its floor so the graph builder can partition by floor
    for (const node of nodes) {
      node.floor = floorId
    }
    return nodes
  } catch (err) {
    console.error(`[graphCache] Failed to load nodes for floor ${floorId}:`, err)
    return []
  }
}

/**
 * Load all walls for a floor from disk, convert from the raw `number[][][]`
 * polyline format, and tag each resulting `Wall` with its floor ID.
 *
 * The `wall.floor` property is set in-place on every wall — required so the
 * graph builder can query only the walls on the same floor as a node pair.
 *
 * Returns `[]` if the file does not exist yet.
 */
function loadWallsForFloor(floorId: string): Wall[] {
  const filePath = getFloorDataPath(floorId, 'walls.json')
  if (!fs.existsSync(filePath)) return []
  try {
    const raw: number[][][] = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const walls = convertWallData(raw)
    for (const wall of walls) {
      wall.floor = floorId
    }
    return walls
  } catch (err) {
    console.error(`[graphCache] Failed to load walls for floor ${floorId}:`, err)
    return []
  }
}

/**
 * Load traffic zones for a floor from disk.
 * Returns `[]` if the file does not exist yet.
 */
function loadZonesForFloor(floorId: string): TrafficZone[] {
  const filePath = getFloorDataPath(floorId, 'zones.json')
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TrafficZone[]
  } catch (err) {
    console.error(`[graphCache] Failed to load zones for floor ${floorId}:`, err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Core build routine — reads all floor data from disk and constructs the
 * visibility graph synchronously.
 *
 * Steps:
 *   1. For each floor in `FLOORS.AVAILABLE`, load nodes, walls, and zones.
 *   2. Call `buildVisibilityGraph` with the combined data.
 *   3. Atomically assign `_allNodes` and `_graph` at the end so no caller
 *      ever observes a partially-built state.
 *
 * This function blocks the Node.js event loop for the duration of the build
 * (~tens of ms at current data sizes).  It should only be called from
 * `initGraphCache` (at startup) or from within `invalidateAndRebuild`
 * (which holds the `_isBuilding` guard).
 */
function buildCache(): void {
  const startTime = Date.now()

  const allNodes: Node[] = []
  const allWalls: Wall[] = []
  const allZones: TrafficZone[] = []

  for (const floor of FLOORS.AVAILABLE) {
    const nodes = loadNodesForFloor(floor.id)
    const walls = loadWallsForFloor(floor.id)
    const zones = loadZonesForFloor(floor.id)
    allNodes.push(...nodes)
    allWalls.push(...walls)
    allZones.push(...zones)
    console.log(`[graphCache] Floor ${floor.id}: ${nodes.length} nodes, ${walls.length} walls, ${zones.length} zones`)
  }

  console.log(`[graphCache] Building graph for ${allNodes.length} nodes, ${allWalls.length} walls, ${allZones.length} zones...`)

  const graph = buildVisibilityGraph(allNodes, allWalls, MAP_CONFIG.MAX_HALLWAY_DISTANCE, allZones)

  _allNodes = allNodes
  _graph = graph

  const elapsed = Date.now() - startTime
  console.log(`[graphCache] Graph ready in ${elapsed}ms`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the graph cache at server startup.
 * Subsequent calls are no-ops unless invalidateAndRebuild() is called first.
 */
export function initGraphCache(): void {
  if (_graph !== null) return
  buildCache()
}

/**
 * Returns the current cached graph.
 * Throws if the cache has not been initialised yet.
 */
export function getGraph(): Graph {
  if (_graph === null) {
    throw new Error('[graphCache] Graph cache not initialised — call initGraphCache() first')
  }
  return _graph
}

/**
 * Returns all nodes across all floors (with .floor property set).
 */
export function getAllNodes(): Node[] {
  return _allNodes
}

/**
 * Invalidate the current cache and synchronously rebuild the graph.
 * Called after a successful POST /api/nodes or POST /api/walls.
 *
 * Rebuilding is synchronous and blocks the Node.js event loop for the
 * duration of the build (~tens of ms at current data sizes), which is
 * acceptable because admin saves are infrequent.
 */
export function invalidateAndRebuild(): void {
  if (_isBuilding) {
    console.warn('[graphCache] Rebuild already in progress — skipping')
    return
  }
  _isBuilding = true
  // Snapshot the current state so we can restore it if the rebuild fails.
  // This prevents the cache from being permanently stuck in an uninitialised
  // state when buildCache() throws (e.g. corrupt data file on disk).
  const previousGraph = _graph
  const previousNodes = _allNodes
  try {
    console.log('[graphCache] Invalidating and rebuilding graph...')
    _graph = null
    _allNodes = []
    buildCache()
  } catch (err) {
    console.error('[graphCache] Rebuild failed — restoring previous graph', err)
    _graph = previousGraph
    _allNodes = previousNodes
  } finally {
    _isBuilding = false
  }
}
