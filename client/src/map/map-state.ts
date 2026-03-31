/**
 * Shared mutable state for the map components.
 *
 * All modules (map-init, route-display, admin-editor) import from this file so
 * they operate on the same references. Primitive values that modules need to
 * mutate are wrapped in the single exported `state` object so callers can write
 * `state.currentFloor = '2'` and every other module reading `state.currentFloor`
 * immediately sees the update.
 */

import type L from 'leaflet'
import type { Wall, Node, SearchResult, TrafficZone } from '../utils/types'

/**
 * Union type for entries in `routeMarkers`.
 *
 * Route rendering produces two kinds of Leaflet layers:
 * - `L.Marker` — start/end/stairway pin markers (the common case).
 * - `{ __isOutline: true; layer: L.Polyline }` — the black outline drawn
 *   behind the amber route line to improve contrast.
 *
 * Both are stored in the same `routeMarkers` array so `clearRoute` and
 * `redrawRouteForCurrentFloor` can remove them all in one pass. The `in`
 * operator on `__isOutline` is the cheapest runtime discriminant.
 */
export type RouteLayer = L.Marker | { __isOutline: true; layer: L.Polyline }

export interface MapState {
  // Floor

  /**
   * ID of the floor currently displayed (e.g. `'1'`, `'2'`).
   * Initialised to `''`; set to `FLOORS.DEFAULT` by `initMap` before any
   * other code runs. Reading this before `initMap()` yields an empty string.
   */
  currentFloor: string
  /** Set of floor IDs whose images have been fully loaded into the browser. */
  loadedFloorImages: Set<string>

  // Data

  /** Nodes for the currently displayed floor, fetched from the server. */
  collectedNodes: Node[]
  /**
   * Walls for the currently displayed floor as raw `[lat, lng][]` arrays,
   * as stored on disk by the server (`walls.json`).
   */
  collectedWalls: number[][][]
  /**
   * All nodes across every available floor, populated by `loadAllNodesAllFloors`.
   * Used by the visibility-graph builder and cross-floor pathfinding.
   * Distinct from `collectedNodes`, which only holds the current floor's nodes.
   */
  allNodesAllFloors: Node[]
  /** All traffic zones across every floor, used for graph edge-cost inflation. */
  allTrafficZones: TrafficZone[]
  /** `true` after cross-floor navigation data has been loaded at least once. */
  hasLoadedGlobalNavigationData: boolean

  // Leaflet objects

  /** Map from node UID to its `L.Marker` on the Leaflet map. */
  nodeMarkers: Record<string, L.Marker>
  /**
   * Polylines representing walls on the current floor.
   * INVARIANT: kept in the same insertion order as `collectedWalls` so that
   * `deleteWall` can splice both arrays at the same index.
   */
  wallPolylines: L.Polyline[]
  /** The in-progress wall being drawn (single-click accumulation), or `null`. */
  currentWallPolyline: L.Polyline | null
  /** The Leaflet map instance, `null` before `initMap` is called. */
  map: L.Map | null
  /** The current floor image overlay, `null` before `initMap` is called. */
  currentImageOverlay: L.ImageOverlay | null

  // Navigation

  /**
   * All walls across every floor, converted to `Wall` objects.
   * Populated by `loadAllFloorsWalls` and passed to `buildVisibilityGraph`.
   */
  wallObjects: Wall[]
  /**
   * The most recently drawn route segment polyline (the last one for the
   * current floor). Used as a quick handle in `clearRoute` and
   * `redrawRouteForCurrentFloor`; the full set is tracked in `routeMarkers`.
   */
  currentRoute: L.Polyline | null
  /** Complete A* path across all floors. Preserved across floor switches so
   *  `redrawRouteForCurrentFloor` can re-render the correct segment. */
  currentRouteFullPath: Node[]
  /**
   * All Leaflet layers belonging to the currently displayed route — polylines
   * (including outline wrappers) and markers.  Cleared atomically in
   * `clearRoute` and `redrawRouteForCurrentFloor`.
   */
  routeMarkers: RouteLayer[]

  // Search

  /**
   * Handle returned by `setTimeout` for the search debounce timer, or `null`
   * when no debounce is pending. Cleared and reset on each keystroke.
   */
  searchDebounceTimer: number | null
  /** Which search input has an open suggestion dropdown, or `null`. */
  activeDropdown: 'start' | 'end' | null
  /** Latest set of `SearchResult` objects from the most recent search query. */
  currentSearchResults: SearchResult[]
  /** Node selected as the route start, `null` if none. */
  selectedStartNode: Node | null
  /** Node selected as the route destination, `null` if none. */
  selectedEndNode: Node | null

  /**
   * Traffic zones for the current floor.
   * INVARIANT: kept in the same insertion order as `trafficZoneRects` so that
   * `setupDebugToggle` can detect undrawn zones by index comparison.
   */
  trafficZones: TrafficZone[]
  /**
   * Leaflet `Rectangle` overlays for each traffic zone.
   * INVARIANT: kept in the same insertion order as `trafficZones`.
   */
  trafficZoneRects: L.Rectangle[]

}

export const state: MapState = {
  currentFloor: '',         // set by map-init after importing FLOORS.DEFAULT
  loadedFloorImages: new Set(),

  collectedNodes: [],
  collectedWalls: [],
  allNodesAllFloors: [],
  allTrafficZones: [],
  hasLoadedGlobalNavigationData: false,

  nodeMarkers: {},
  wallPolylines: [],
  currentWallPolyline: null,
  map: null,
  currentImageOverlay: null,

  wallObjects: [],
  currentRoute: null,
  currentRouteFullPath: [],
  routeMarkers: [],

  searchDebounceTimer: null,
  activeDropdown: null,
  currentSearchResults: [],
  selectedStartNode: null,
  selectedEndNode: null,

  trafficZones: [],
  trafficZoneRects: [],
}
