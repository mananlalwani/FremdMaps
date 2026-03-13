/**
 * Application constants (server-side copy).
 *
 * Must be kept in sync with `client/src/utils/constants.ts`.
 * Only the constants used server-side are included here.
 */

/**
 * Map and pathfinding configuration.
 *
 * These values are derived from the floor-plan image dimensions and define
 * the coordinate space used by Leaflet Simple CRS.
 */
export const MAP_CONFIG = {
  /** Pixel width of the floor-plan image (used by Leaflet to set map bounds). */
  IMAGE_WIDTH: 6050,
  /** Pixel height of the floor-plan image (used by Leaflet to set map bounds). */
  IMAGE_HEIGHT: 4675,
  /** Minimum Leaflet zoom level (most zoomed-out). */
  MIN_ZOOM: -5,
  /** Maximum Leaflet zoom level (most zoomed-in). */
  MAX_ZOOM: 2,
  /**
   * Maximum edge length (in map pixels) for the visibility graph.
   * Node pairs further apart than this are never connected, preventing
   * long cross-corridor shortcuts that would skip waypoints.
   */
  MAX_HALLWAY_DISTANCE: 800,
  /**
   * Minimum bearing change (degrees) required to emit a new turn instruction.
   * Collinear segments below this threshold are merged into a single "walk" step.
   */
  PATH_SIMPLIFICATION_ANGLE: 30,
  /**
   * Edge cost assigned to a stairway cross-floor transition.
   * Must be significantly larger than a typical same-floor corridor segment
   * so A* avoids unnecessary floor changes.  Current value (~250 px equivalent)
   * corresponds to roughly one corridor length.
   */
  STAIR_COST: 250,
} as const

/**
 * Floor registry.
 *
 * `AVAILABLE` drives the floor-switcher UI and determines which
 * `data/floor<id>/` directories the server reads from.  To add a floor:
 *   1. Add an entry here and in the client copy.
 *   2. Create `server/data/floor<id>/nodes.json`, `walls.json`, `zones.json`.
 */
export const FLOORS = {
  /** Floor shown by default on first page load. */
  DEFAULT: '2',
  /** All floors available in the application. */
  AVAILABLE: [
    { id: '1', name: 'Floor 1', image: '/floor1.png' },
    { id: '2', name: 'Floor 2', image: '/floor2.png' },
  ],
} as const

/**
 * Numeric tolerances for floating-point geometry operations.
 */
export const GEOMETRY = {
  /**
   * General floating-point comparison tolerance.
   * Used by `segmentsIntersect` to treat near-parallel lines as non-intersecting.
   */
  EPSILON: 1e-6,
  /**
   * Denominator threshold for the segment-intersection parametric formula.
   * Values below this are treated as parallel/collinear (no intersection).
   */
  INTERSECTION_EPSILON: 1e-10,
} as const
