/**
 * Shared type definitions for the navigation system.
 *
 * Both the client (`client/src/`) and server (`server/src/utils/`) maintain
 * copies of this file that must be kept manually in sync.
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
 * Produced by: admin-editor placement, server `nodes.json`.
 * Consumed by: `buildVisibilityGraph`, `findPath`, `searchNodes`,
 *   `addMarker`, route-display rendering.
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
  /** Node type — controls marker appearance, search visibility, and routing. */
  type?: "room" | "waypoint" | "bathroom" | "stairway"
  
  /** Future use: subdivide bathrooms by accessibility or gender. */
  bathroomType?: "all-gender" | "mens" | "womens" | "accessible"
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
  | "classroom" 
  | "office" 
  | "lab" 
  | "bathroom" 
  | "cafeteria" 
  | "gymnasium" 
  | "library"
  | "auditorium"
  | "stairway"
  | "entrance"
  | "other"

/**
 * A single fuzzy-search result from `searchNodes`.
 *
 * Produced by: `search.ts` → `searchNodes`.
 * Consumed by: `Map.astro` search dropdown, `rankWithRecency`.
 */
export interface SearchResult {
  node: Node
  /** Fuse.js match score — lower is a better match (0 = perfect, 1 = no match). */
  score: number
  /** The specific `rooms` values that matched the query. */
  matches: string[]
}

/**
 * One entry in the navigation search history stored in localStorage.
 *
 * Produced by: `addRecentSearch` in `storage.ts`.
 * Consumed by: `getFrequentRooms` → `rankWithRecency` for recency boosting.
 */
export interface SearchHistoryEntry {
  from: string
  to: string
  timestamp: number
}

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
 * A single step in the turn-by-turn directions list.
 *
 * Produced by: `generateDirections` in `route-display.ts`.
 * Consumed by: the `#directions-list` DOM rendering loop.
 */
export interface DirectionStep {
  type: 'start' | 'walk' | 'stair' | 'end'
  /** Human-readable instruction shown in the UI. */
  label: string
  /** Floor this step takes place on. */
  floor: string
  /** For `'stair'` steps: the destination floor. */
  targetFloor?: string
  /** For `'walk'` steps: accumulated segment distance in Leaflet CRS units. */
  distance?: number
}

/**
 * One period-to-room mapping in a user's class schedule.
 *
 * Produced and consumed by: `storage.ts` schedule helpers.
 */
export interface ScheduleEntry {
  /** Period label, e.g. `'1'`, `'2'`, `'Lunch'`, `'Homeroom'`. */
  period: string
  /** Room name/number as entered by the user (empty string = unset). */
  room: string
}

/**
 * A rectangular region on a floor plan that increases routing cost through it.
 *
 * Stored in `zones.json`; loaded by `loadData` in `map-init.ts`.
 * Applied by `applyZoneCost` in `graph.ts` during graph construction.
 */
export interface TrafficZone {
  uid: string
  floor: string
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  /** Cost multiplier applied to edges inside this zone. Range: 1.0 (no penalty) – 10.0 (heavily avoided). */
  intensity: number
}
