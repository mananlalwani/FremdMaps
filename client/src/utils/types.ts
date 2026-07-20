/**
 * Shared type definitions for the navigation system.
 *
 * These types describe the static navigation data and the client-side routing
 * model. The Cloudflare Worker only serves built assets and does not duplicate
 * this module.
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
  lat: number // Y coordinate in Leaflet Simple CRS
  lng: number // X coordinate in Leaflet Simple CRS
}

/**
 * A navigable location on a floor plan.
 *
 * Produced by: the developer editor and static `nodes.json` files.
 * Consumed by: `buildVisibilityGraph`, `findPath`, `searchNodes`,
 *   `addMarker`, route-display rendering.
 */
export interface Node {
  /** Globally unique identifier (UUID v4). */
  uid: string
  /**
   * One or more human-readable labels for this location (for example,
   * `['201', '201A']` or `['A']` for a stairway).
   */
  rooms: string[]
  /** Optional alternate search terms; these do not replace the official room labels. */
  searchAliases?: string[]
  /** Y coordinate (Leaflet Simple CRS). */
  lat: number
  /** X coordinate (Leaflet Simple CRS). */
  lng: number
  /** Node type — controls marker appearance, search visibility, and routing. */
  type?: 'room' | 'waypoint' | 'bathroom' | 'stairway'

  /** Optional bathroom classification retained from navigation data. */
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
 * A single fuzzy-search result from `searchNodes`.
 *
 * Produced by: `search.ts` → `searchNodes`.
 * Consumed by: `Map.astro` search dropdown, `rankWithRecency`.
 */
export interface SearchResult {
  node: Node
  /** Fuse.js match score — lower is a better match (0 = perfect, 1 = no match). */
  score: number
  /** Values from indexed fields that matched the query. */
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
  /**
   * Weighted routing cost. Same-floor edges begin as Euclidean distance and
   * may be adjusted for diagonal alignment and traffic zones; stair portals
   * use the fixed stairway cost.
   */
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
  /**
   * Weighted route cost — sum of edge costs along the path.
   *
   * This is **not** guaranteed to be a physical distance.  Edge costs may be
   * inflated by traffic-zone multipliers, diagonal-alignment preference, and
   * stairway penalties (`MAP_CONFIG.STAIR_COST`). A separate physical-distance measurement
   * should be computed if literal walking distance is required.
   */
  distance: number
  /** `true` when a valid path was found. */
  found: boolean
}

/**
 * Relative turn classification for a walking direction step.
 */
export type WalkTurn = 'straight' | 'bear-left' | 'bear-right' | 'left' | 'right' | 'u-turn'

/**
 * A single step in the turn-by-turn directions list.
 *
 * Produced by: `buildDirectionSteps` in `directions.ts`.
 * Rendered by: `generateDirections` in `route-display.ts`.
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
  /** For `'walk'` steps: the relative direction to take. */
  turn?: WalkTurn
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
  /** Cost multiplier when either edge endpoint is in this zone; range 1–10. */
  intensity: number
}
