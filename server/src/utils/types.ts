/**
 * Shared type definitions for the navigation system (server-side copy).
 *
 * Both the client (`client/src/utils/types.ts`) and this file maintain the
 * same type definitions and must be kept manually in sync when either changes.
 *
 * The following client-only types are intentionally absent from this file
 * because they are not needed by any server-side code:
 *   - `SearchResult`    — Fuse.js result wrapper used by the search UI
 *   - `DirectionStep`   — turn-by-turn step for the directions panel
 *   - `ScheduleEntry`   — localStorage schedule entry
 *   - `SearchHistoryEntry` — localStorage search-history entry
 */

/**
 * A 2-D coordinate in Leaflet Simple CRS.
 *
 * Note: `lat` is the **Y-axis** (vertical, positive = up) and `lng` is the
 * **X-axis** (horizontal, positive = right).  These are NOT real GPS
 * coordinates — the map uses a flat pixel coordinate system derived from the
 * floor image dimensions.
 */
export interface Point {
  lat: number  // Y coordinate in Leaflet Simple CRS
  lng: number  // X coordinate in Leaflet Simple CRS
}

/**
 * A navigable location on a floor plan.
 *
 * Produced by: admin-editor placement, `nodes.json` files on disk.
 * Consumed by: `buildVisibilityGraph`, `findPath`, `findNearestBathroom`,
 *   route-display rendering, and the `/api/route` endpoints.
 */
export interface Node {
  /** Globally unique identifier (UUID v4). */
  uid: string
  /**
   * One or more human-readable names for this location (e.g. `['201', '201A']`).
   * Waypoints use `['waypoint']`; bathrooms use `['bathroom']`; stairways use
   * the stairway name (e.g. `['A']`).
   */
  rooms: string[]
  /** Y coordinate (Leaflet Simple CRS). */
  lat: number
  /** X coordinate (Leaflet Simple CRS). */
  lng: number
  /** Node type — controls routing behaviour and search visibility. */
  type?: 'room' | 'waypoint' | 'bathroom' | 'stairway'
  /** Future use: subdivide bathrooms by accessibility or gender. */
  bathroomType?: 'all-gender' | 'mens' | 'womens' | 'accessible'
  /** Floor identifier (e.g. `'1'`, `'2'`). */
  floor?: string
  /**
   * For stairway nodes: names of connected stairways on other floors.
   * Values are room-name references (e.g. `['A']`) resolved by
   * `addStairwayConnections` in `graph.ts`.  Legacy data may contain UIDs.
   */
  connectsTo?: string[]
  /** Optional explicit category for search/filtering (overrides `inferCategory`). */
  category?: RoomCategory
}

/**
 * Classification of a room/node for category-filtered search and display.
 */
export type RoomCategory =
  | 'classroom'
  | 'office'
  | 'lab'
  | 'bathroom'
  | 'cafeteria'
  | 'gymnasium'
  | 'library'
  | 'auditorium'
  | 'stairway'
  | 'entrance'
  | 'other'

/**
 * A wall segment that blocks line-of-sight in the visibility graph.
 *
 * On disk (`walls.json`) walls are stored as `[lat, lng][]` arrays and
 * converted to `Wall` objects by `convertWallData` in `geometry.ts`.
 */
export interface Wall {
  start: Point
  end: Point
  /** Floor identifier — set when loading walls across floors. */
  floor?: string
}

/**
 * A directed edge in the navigation graph.
 *
 * Produced by: `buildVisibilityGraph` in `graph.ts`.
 * Consumed by: `findPath` A* algorithm.
 */
export interface Edge {
  /** UID of the target node. */
  to: string
  /** Edge weight — Euclidean distance multiplied by any traffic-zone multiplier. */
  cost: number
}

/**
 * The navigation graph: an adjacency list mapping each node UID to its outgoing
 * edges.  The graph is bidirectional — both directions are stored explicitly.
 */
export type Graph = Map<string, Edge[]>

/**
 * Return value of `findPath` in `pathfinding.ts`.
 */
export interface PathResult {
  /** Ordered node sequence from start to goal (empty if no path found). */
  path: Node[]
  /** Sum of edge costs along the path (Euclidean pixel distance). */
  distance: number
  /** `true` when a valid path was found. */
  found: boolean
}

/**
 * A rectangular region on a floor plan that increases routing cost through it.
 *
 * Stored in `zones.json`; loaded by `initGraphCache` in `graphCache.ts`.
 * Applied by `applyZoneCost` in `graph.ts` during graph construction.
 */
export interface TrafficZone {
  uid: string
  floor: string
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  /** Cost multiplier applied to edges inside this zone. Range: 1.0 (no penalty) – 10.0 (heavily avoided). */
  intensity: number
}
