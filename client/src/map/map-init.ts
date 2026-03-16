/**
 * Map initialisation, floor switching, and data-loading logic.
 *
 * This module owns:
 *   - Leaflet map creation (`initMap`)
 *   - Floor image loading / switching (`switchFloor`)
 *   - Node + wall data fetching (`loadData`, `loadAllNodesAllFloors`,
 *     `loadAllFloorsWalls`)
 *   - Clearing and re-rendering map data (`clearMapData`, `renderMapData`)
 *
 * It deliberately does NOT import route-display or admin-editor to avoid
 * circular dependencies. Instead it receives the functions it needs to call
 * back as injectable callbacks passed to `initMap`.
 */

import L from 'leaflet'
import { convertWallData } from '../utils/geometry'
import type { Node, Wall, TrafficZone } from '../utils/types'
import { MAP_CONFIG, API_CONFIG, FLOORS } from '../utils/constants'
import { graphLogger, logger } from '../utils/logger'
import { state } from './map-state'
import { drawTrafficZoneRect } from './admin-editor'

// Callbacks injected from the orchestrator (Map.astro)
/**
 * Callbacks injected by Map.astro to break circular imports between `map-init`,
 * `admin-editor`, and `route-display`.
 */
export interface MapInitCallbacks {
  /** Place (or replace) a Leaflet marker for a node on the current floor. */
  addMarker: (node: Node) => void
  /** Render a wall as a Leaflet polyline and register its click handler. */
  addWallPolyline: (wallPts: number[][]) => L.Polyline
  /** Remove all route visuals and reset route state. */
  clearRoute: () => void
  /** Re-render the stored multi-floor route for the newly active floor. */
  redrawRouteForCurrentFloor: () => void
  /** Toggle the debug graph-edge overlay on/off. */
  toggleGraphVisualization: () => void
  /** Rebuild the visibility graph and A* cache after data changes. */
  initializeNavigation: () => Promise<void>
  /** Refresh UI elements that reflect current node/wall counts. */
  updateUI: () => void
  /** Create a styled `<p>` element (used for error messages in the empty-state panel). */
  createTextParagraph: (text: string, style?: string) => HTMLParagraphElement
}

let _cb: MapInitCallbacks

/**
 * Initialise the Leaflet map and start loading data.
 * Must be called once at page load.
 */
export function initMap(callbacks: MapInitCallbacks): void {
  _cb = callbacks

  const { IMAGE_WIDTH, IMAGE_HEIGHT, MIN_ZOOM, MAX_ZOOM } = MAP_CONFIG

  const bounds: [[number, number], [number, number]] = [
    [-IMAGE_HEIGHT, 0],
    [0, IMAGE_WIDTH],
  ]

  state.currentFloor = FLOORS.DEFAULT

  const leafletMap = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // tap: false — use Leaflet's pointer-events path instead of the legacy tap
    // handler, which conflicts with iOS Safari's touch processing and causes
    // ghost clicks on first interaction.
    tap: false,
    // inertia: true (default) — restores kinetic map panning on mobile so the
    // map feels natural rather than rigid.
    maxBoundsViscosity: 1.0,
    doubleClickZoom: false,
  })
  state.map = leafletMap

  leafletMap.setMaxBounds(bounds)

  // Load initial floor image
  const initialFloor = FLOORS.AVAILABLE.find(f => f.id === state.currentFloor)
  if (initialFloor) {
    state.currentImageOverlay = L.imageOverlay(initialFloor.image, bounds).addTo(leafletMap)
    state.loadedFloorImages.add(state.currentFloor)
  }

  leafletMap.fitBounds(bounds)

  // On iOS Safari the visual viewport shrinks when the soft keyboard opens,
  // but window.innerHeight does not update synchronously.  Calling
  // invalidateSize() on visualViewport resize ensures the map fills the
  // correct area after the keyboard shows or hides (e.g. when the user taps
  // a search input directly above the map).
  if (typeof window !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      leafletMap.invalidateSize()
    })
  }

  loadData()

  // Prefetch other floor images in the background after the initial floor loads
  // so that switching floors feels instantaneous.  The 1500 ms delay is a
  // conservative buffer; it is not tied to any load-event completion and is
  // intentionally loose to avoid competing with the critical initial data fetch.
  setTimeout(() => {
    for (const floor of FLOORS.AVAILABLE) {
      if (floor.id !== state.currentFloor) {
        const img = new Image()
        img.src = floor.image
        img.onload = () => {
          state.loadedFloorImages.add(floor.id)
          graphLogger.info(`Prefetched floor ${floor.id} image`)
        }
      }
    }
  }, 1500)
}

/**
 * Switch to a different floor: update the image overlay, reload data, and
 * redraw any active multi-floor route for the new floor.
 */
export function switchFloor(floorId: string): void {
  if (floorId === state.currentFloor) return

  graphLogger.info(`Switching to floor ${floorId}`)
  state.currentFloor = floorId
  document.title = `Wayfinder - Floor ${floorId}`

  const floor = FLOORS.AVAILABLE.find(f => f.id === floorId)
  if (floor && state.currentImageOverlay) {
    if (state.loadedFloorImages.has(floorId)) {
      state.currentImageOverlay.setUrl(floor.image)
    } else {
      state.currentImageOverlay.setOpacity(0.3)
      const img = new Image()
      img.src = floor.image
      img.onload = () => {
        state.loadedFloorImages.add(floorId)
        state.currentImageOverlay?.setUrl(floor.image)
        state.currentImageOverlay?.setOpacity(1)
      }
      img.onerror = () => {
        // Floor image failed to load (e.g. missing tile file).  Still set the
        // URL and restore full opacity so the overlay doesn't stay dimmed, and
        // mark the floor as "loaded" to prevent repeated retries on re-entry.
        state.loadedFloorImages.add(floorId)
        state.currentImageOverlay?.setUrl(floor.image)
        state.currentImageOverlay?.setOpacity(1)
      }
    }
  }

  const hasMultiFloorRoute = state.currentRouteFullPath.length > 0

  if (!hasMultiFloorRoute) {
    _cb.clearRoute()
  }

  if (state.showingGraph) {
    _cb.toggleGraphVisualization()
  }

  const floorLabel = document.querySelector('.floor-label')
  if (floorLabel) floorLabel.textContent = `Floor ${floorId}`

  loadData()

  if (hasMultiFloorRoute) {
    _cb.redrawRouteForCurrentFloor()
  }

  document.querySelectorAll('.floor-btn').forEach(btn => {
    if (btn.getAttribute('data-floor') === floorId) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })
}

/**
 * Remove all node markers and wall polylines from the map.
 */
export function clearMapData(): void {
  Object.values(state.nodeMarkers).forEach(marker => {
    state.map?.removeLayer(marker)
  })
  state.nodeMarkers = {}

  state.wallPolylines.forEach(polyline => {
    state.map?.removeLayer(polyline)
  })
  state.wallPolylines = []

  if (state.currentWallPolyline) {
    state.map?.removeLayer(state.currentWallPolyline)
    state.currentWallPolyline = null
  }

  graphLogger.info('Cleared all map data (nodes and walls)')
}

/**
 * (Re-)render the currently loaded nodes and walls on the map.
 */
export function renderMapData(): void {
  for (const node of state.collectedNodes) { _cb.addMarker(node) }
  for (const wallPts of state.collectedWalls) { _cb.addWallPolyline(wallPts) }
  graphLogger.info(`Rendered ${state.collectedNodes.length} nodes and ${state.collectedWalls.length} walls`)
}

/**
 * Fetch nodes, walls, and traffic zones for the current floor, then trigger
 * navigation initialisation.
 *
 * Sequence:
 * 1. `clearMapData` — remove current markers and polylines from the Leaflet map.
 * 2. Fetch `/api/nodes` and `/api/walls` for `state.currentFloor`.
 * 3. Fetch `/api/zones`; coerce any legacy `severity` string fields to numeric
 *    `intensity` values; draw zone rects when in debug mode.
 * 4. `renderMapData` — add markers and wall polylines for the new floor.
 * 5. `loadAllNodesAllFloors` + `loadAllFloorsWalls` — refresh the cross-floor
 *    node/wall pools used by the visibility-graph builder.
 * 6. `initializeNavigation` — rebuild the graph and A* cache.
 *
 * On any network or parse error, logs to `logger.error` and displays a
 * human-readable message in the `#empty-state` panel.
 */
export async function loadData(): Promise<void> {
  try {
    // `import.meta.env` is typed as `ImportMeta` in Astro but plain `.ts` files
    // don't have the Astro type shim — cast to a generic Record to silence TS.
    const apiUrl = (import.meta as { env: Record<string, string> }).env.PUBLIC_API_URL || API_CONFIG.DEFAULT_URL

    clearMapData()

    const nodesRes = await fetch(`${apiUrl}${API_CONFIG.ENDPOINTS.NODES}?floor=${state.currentFloor}`)
    if (!nodesRes.ok) {
      throw new Error(`Failed to load nodes: ${nodesRes.status} ${nodesRes.statusText}`)
    }
    state.collectedNodes = await nodesRes.json()

    const wallsRes = await fetch(`${apiUrl}${API_CONFIG.ENDPOINTS.WALLS}?floor=${state.currentFloor}`)
    if (!wallsRes.ok) {
      throw new Error(`Failed to load walls: ${wallsRes.status} ${wallsRes.statusText}`)
    }
    state.collectedWalls = await wallsRes.json()

    // Remove old traffic zone rects from the map before reloading
    for (const rect of state.trafficZoneRects) {
      state.map?.removeLayer(rect)
    }
    state.trafficZoneRects = []
    state.trafficZones = []

    const zonesRes = await fetch(`${apiUrl}${API_CONFIG.ENDPOINTS.ZONES}?floor=${state.currentFloor}`)
    if (zonesRes.ok) {
      const raw: unknown[] = await zonesRes.json()
      const zones: TrafficZone[] = raw.map((z: unknown) => {
        const zone = z as Record<string, unknown>
        // Legacy zone data (before the intensity redesign) stored congestion as a
        // string `severity` field (`'low'`, `'medium'`, `'high'`) rather than the
        // numeric `intensity` multiplier.  Coerce on read so old data files keep
        // working without a migration step.
        if (typeof zone.intensity !== 'number' && typeof zone.severity === 'string') {
          const legacyMap: Record<string, number> = { low: 1.5, medium: 3.0, high: 8.0 }
          zone.intensity = legacyMap[zone.severity as string] ?? 1.5
          delete zone.severity
        }
        return zone as unknown as TrafficZone
      })
      state.trafficZones = zones
      if (state.isDebugMode) {
        for (const zone of zones) {
          drawTrafficZoneRect(zone)
        }
      }
      graphLogger.log(`Loaded ${zones.length} traffic zones for floor ${state.currentFloor}`)
    } else {
      logger.warn(`Failed to load zones for floor ${state.currentFloor}: ${zonesRes.status}`)
    }

    renderMapData()
    _cb.updateUI()

    await loadAllNodesAllFloors()
    const allWalls = await loadAllFloorsWalls()
    state.wallObjects = allWalls
    await _cb.initializeNavigation()
  } catch (err) {
    logger.error('Failed to load data:', err)
    const emptyState = document.getElementById('empty-state')
    if (emptyState) {
      emptyState.textContent = ''
      emptyState.appendChild(
        _cb.createTextParagraph(
          'Unable to load navigation data. Please check if the server is running.',
          'color: #ff6b6b;'
        )
      )
    }
  }
}

/**
 * Fetch nodes for every available floor and populate `state.allNodesAllFloors`.
 */
export async function loadAllNodesAllFloors(): Promise<Node[]> {
  try {
    // Same import.meta cast as loadData — required in plain .ts files.
    const apiUrl = (import.meta as { env: Record<string, string> }).env.PUBLIC_API_URL || API_CONFIG.DEFAULT_URL

    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async floor => {
        const res = await fetch(`${apiUrl}${API_CONFIG.ENDPOINTS.NODES}?floor=${floor.id}`)
        if (!res.ok) return []
        const floorNodes: Node[] = await res.json()
        for (const node of floorNodes) { node.floor = floor.id }
        graphLogger.log(`Loaded ${floorNodes.length} nodes from Floor ${floor.id}`)
        return floorNodes
      })
    )

    const allNodes = perFloor.flat()
    state.allNodesAllFloors = allNodes
    graphLogger.log(`Total nodes across all floors: ${allNodes.length}`)
    return allNodes
  } catch (err) {
    logger.error('Failed to load nodes from all floors:', err)
    return []
  }
}

/**
 * Fetch walls for every available floor, convert them, and return the full
 * array (tagged with `floor` property).
 */
export async function loadAllFloorsWalls(): Promise<Wall[]> {
  try {
    // Same import.meta cast as loadData — required in plain .ts files.
    const apiUrl = (import.meta as { env: Record<string, string> }).env.PUBLIC_API_URL || API_CONFIG.DEFAULT_URL

    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async floor => {
        const res = await fetch(`${apiUrl}${API_CONFIG.ENDPOINTS.WALLS}?floor=${floor.id}`)
        if (!res.ok) return []
        const floorWallsRaw: number[][][] = await res.json()
        const floorWalls = convertWallData(floorWallsRaw)
        floorWalls.forEach(wall => { wall.floor = floor.id })
        graphLogger.log(`Loaded ${floorWalls.length} walls from Floor ${floor.id}`)
        return floorWalls
      })
    )

    const allWalls = perFloor.flat()
    graphLogger.log(`Total walls across all floors: ${allWalls.length}`)
    return allWalls
  } catch (err) {
    logger.error('Failed to load walls from all floors:', err)
    return []
  }
}
