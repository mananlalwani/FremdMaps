/**
 * Application-wide constants.
 *
 * All values are `as const` to preserve literal types throughout the codebase.
 * Import individual constants rather than the whole module where possible.
 */

/**
 * Map and graph construction configuration.
 *
 * - `IMAGE_WIDTH` / `IMAGE_HEIGHT`: pixel dimensions of the floor-plan image;
 *   used to configure the Leaflet Simple CRS bounds.
 * - `MIN_ZOOM` / `MAX_ZOOM`: Leaflet zoom level limits.
 * - `MAX_HALLWAY_DISTANCE`: maximum edge length (px) in the visibility graph;
 *   nodes further apart than this are never connected, even with line-of-sight.
 * - `PATH_SIMPLIFICATION_ANGLE`: minimum turn angle (degrees) a waypoint must
 *   introduce to be kept after path simplification.
 * - `ROUTE_DISPLAY_SIMPLIFICATION_ANGLE` / `ROUTE_DISPLAY_RDP_EPSILON`:
 *   looser, wall-safe tolerances used only for the visible amber route. They
 *   smooth graph-node zig-zags without changing the pathfinding result.
 * - `AXIS_ALIGNMENT_PENALTY`: percentage cost increase applied to diagonal
 *   edges, favoring horizontal and vertical hallway segments.
 * - `STAIR_COST`: fixed cost assigned to cross-floor stairway edges; must be
 *   higher than a typical corridor segment so A* avoids spurious cross-floor
 *   detours when a same-floor route exists.
 */
export const MAP_CONFIG = {
  IMAGE_WIDTH: 6050,
  IMAGE_HEIGHT: 4675,
  MIN_ZOOM: -5,
  MAX_ZOOM: 2,
  MAX_HALLWAY_DISTANCE: 800,
  PATH_SIMPLIFICATION_ANGLE: 30,
  STAIR_COST: 250,
  RDP_EPSILON: 50,
  RDP_MIN_POINTS: 10,
  ROUTE_DISPLAY_SIMPLIFICATION_ANGLE: 60,
  ROUTE_DISPLAY_RDP_EPSILON: 100,
  AXIS_ALIGNMENT_PENALTY: 0.1,
} as const

/**
 * Floor configuration.
 *
 * - `DEFAULT`: floor shown on initial page load (before any user interaction).
 * - `AVAILABLE`: ordered list of all floors; each entry supplies the floor `id`
 *   in static data URLs, a human-readable `name`, and the path to the
 *   floor-plan `image` served from `client/public/`.
 */
export const FLOORS = {
  DEFAULT: '2',
  AVAILABLE: [
    { id: '1', name: 'Floor 1', image: '/floor1.webp' },
    { id: '2', name: 'Floor 2', image: '/floor2.webp' },
  ],
} as const

/**
 * UI timing and styling constants.
 *
 * - `STATUS_MESSAGE_TIMEOUT_MS`: how long (ms) a transient status message
 *   stays visible before auto-dismissal.
 * - `ROUTE_PATH_COLOR`: hex colour of the drawn route polyline.
 * - `ROUTE_PATH_WEIGHT`: stroke width (px) of the route polyline.
 */
export const UI_CONFIG = {
  STATUS_MESSAGE_TIMEOUT_MS: 5000,
  ROUTE_PATH_COLOR: '#f0a500',
  ROUTE_PATH_WEIGHT: 6,
  ROUTE_START_COLOR: '#4CAF50',
  ROUTE_END_COLOR: '#f44336',
  STAIR_COLOR: '#34343F',
  STAIR_GLOW: 'rgba(0, 0, 0, 0.32)',
} as const

/**
 * Floating-point tolerances used in geometry calculations.
 *
 * - `EPSILON`: general tolerance for near-zero comparisons in parametric
 *   intersection tests; excludes exact endpoints so nodes sitting on wall
 *   endpoints do not falsely block line-of-sight.
 * - `INTERSECTION_EPSILON`: tighter tolerance used for the denominator check
 *   in `segmentsIntersect`; treats near-parallel lines as non-intersecting.
 */
export const GEOMETRY = {
  EPSILON: 1e-6,
  INTERSECTION_EPSILON: 1e-10,
} as const

/**
 * Build the URL for a floor data file (nodes, walls, or zones).
 *
 * @param floorId Floor identifier (e.g. `'1'`, `'2'`).
 * @param type    Data file name without extension (e.g. `'nodes'`, `'walls'`, `'zones'`).
 * @returns Absolute path to the JSON data file.
 */
export function getDataUrl(floorId: string, type: 'nodes' | 'walls' | 'zones'): string {
  return `/data/floor${floorId}/${type}.json`
}
