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
 * It deliberately does NOT import route-display directly to avoid
 * circular dependencies. Instead it receives the functions it needs to call
 * back as injectable callbacks passed to `initMap`.
 */

import L from 'leaflet'
import { convertWallData } from '../utils/geometry'
import type { Node, Wall, TrafficZone } from '../utils/types'
import { MAP_CONFIG, FLOORS } from '../utils/constants'
import { graphLogger, logger } from '../utils/logger'
import { state } from './map-state'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNodeType(value: unknown): value is NonNullable<Node['type']> {
  return value === 'room' || value === 'waypoint' || value === 'bathroom' || value === 'stairway'
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function assertCoordinateBounds(lat: number, lng: number, label: string): void {
  if (lat < -MAP_CONFIG.IMAGE_HEIGHT || lat > 0) {
    throw new Error(`${label}.lat is outside map bounds`)
  }
  if (lng < 0 || lng > MAP_CONFIG.IMAGE_WIDTH) {
    throw new Error(`${label}.lng is outside map bounds`)
  }
}

function parseNodes(value: unknown, floorId: string, contextLabel: string): Node[] {
  if (!Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an array`)
  }

  const nodes: Node[] = []

  for (let index = 0; index < value.length; index += 1) {
    const rawNode = value[index]
    const label = `${contextLabel}[${index}]`
    if (!isObject(rawNode)) {
      throw new Error(`${label} must be an object`)
    }

    const uid = assertNonEmptyString(rawNode.uid, `${label}.uid`)
    const lat = assertFiniteNumber(rawNode.lat, `${label}.lat`)
    const lng = assertFiniteNumber(rawNode.lng, `${label}.lng`)
    assertCoordinateBounds(lat, lng, label)

    if (!Array.isArray(rawNode.rooms) || rawNode.rooms.length === 0) {
      throw new Error(`${label}.rooms must be a non-empty array`)
    }
    const rooms = rawNode.rooms.map((room, roomIndex) =>
      assertNonEmptyString(room, `${label}.rooms[${roomIndex}]`)
    )

    const type = rawNode.type
    if (type !== undefined && !isNodeType(type)) {
      throw new Error(`${label}.type is invalid`)
    }

    const node: Node = { uid, lat, lng, rooms, floor: floorId }

    if (type !== undefined) node.type = type

    if (rawNode.connectsTo !== undefined) {
      if (!Array.isArray(rawNode.connectsTo)) {
        throw new Error(`${label}.connectsTo must be an array when present`)
      }
      node.connectsTo = rawNode.connectsTo.map((target, targetIndex) =>
        assertNonEmptyString(target, `${label}.connectsTo[${targetIndex}]`)
      )
    }

    if (rawNode.bathroomType !== undefined) {
      const bathroomType = assertNonEmptyString(rawNode.bathroomType, `${label}.bathroomType`)
      node.bathroomType = bathroomType as Node['bathroomType']
    }

    if (rawNode.category !== undefined) {
      const category = assertNonEmptyString(rawNode.category, `${label}.category`)
      node.category = category as Node['category']
    }

    nodes.push(node)
  }

  return nodes
}

function parseWalls(value: unknown, contextLabel: string): number[][][] {
  if (!Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an array`)
  }

  const walls: number[][][] = []

  for (let index = 0; index < value.length; index += 1) {
    const segment = value[index]
    const label = `${contextLabel}[${index}]`
    if (!Array.isArray(segment) || segment.length !== 2) {
      throw new Error(`${label} must be a 2-point segment`)
    }

    const parsedSegment: number[][] = []
    for (let pointIndex = 0; pointIndex < 2; pointIndex += 1) {
      const point = segment[pointIndex]
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error(`${label}[${pointIndex}] must be [lat, lng]`)
      }

      const lat = assertFiniteNumber(point[0], `${label}[${pointIndex}][0]`)
      const lng = assertFiniteNumber(point[1], `${label}[${pointIndex}][1]`)
      assertCoordinateBounds(lat, lng, `${label}[${pointIndex}]`)
      parsedSegment.push([lat, lng])
    }

    walls.push(parsedSegment)
  }

  return walls
}

function parseZones(value: unknown, floorId: string, contextLabel: string): TrafficZone[] {
  if (!Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an array`)
  }

  const zones: TrafficZone[] = []

  for (let index = 0; index < value.length; index += 1) {
    const rawZone = value[index]
    const label = `${contextLabel}[${index}]`
    if (!isObject(rawZone)) {
      throw new Error(`${label} must be an object`)
    }

    const uid = assertNonEmptyString(rawZone.uid, `${label}.uid`)
    const rawFloor = assertNonEmptyString(rawZone.floor, `${label}.floor`)
    if (rawFloor !== floorId) {
      throw new Error(`${label}.floor must equal "${floorId}"`)
    }

    if (!isObject(rawZone.bounds)) {
      throw new Error(`${label}.bounds must be an object`)
    }

    const minLat = assertFiniteNumber(rawZone.bounds.minLat, `${label}.bounds.minLat`)
    const minLng = assertFiniteNumber(rawZone.bounds.minLng, `${label}.bounds.minLng`)
    const maxLat = assertFiniteNumber(rawZone.bounds.maxLat, `${label}.bounds.maxLat`)
    const maxLng = assertFiniteNumber(rawZone.bounds.maxLng, `${label}.bounds.maxLng`)

    if (minLat > maxLat || minLng > maxLng) {
      throw new Error(`${label}.bounds must satisfy min <= max`)
    }

    assertCoordinateBounds(minLat, minLng, `${label}.bounds.min`)
    assertCoordinateBounds(maxLat, maxLng, `${label}.bounds.max`)

    let intensity: number
    if (typeof rawZone.intensity === 'number' && Number.isFinite(rawZone.intensity)) {
      intensity = rawZone.intensity
    } else {
      throw new Error(`${label}.intensity must be a finite number`)
    }

    if (intensity < 1 || intensity > 10) {
      throw new Error(`${label}.intensity must be in range [1, 10]`)
    }

    zones.push({
      uid,
      floor: floorId,
      intensity,
      bounds: { minLat, minLng, maxLat, maxLng },
    })
  }

  return zones
}

async function loadAllFloorsZones(): Promise<TrafficZone[]> {
  try {
    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async floor => {
        const res = await fetch(`/data/floor${floor.id}/zones.json`)
        if (!res.ok) return []
        const rawZones: unknown = await res.json()
        const floorZones = parseZones(rawZones, floor.id, `floor${floor.id}/zones.json`)
        graphLogger.log(`Loaded ${floorZones.length} traffic zones from Floor ${floor.id}`)
        return floorZones
      })
    )

    const allZones = perFloor.flat()
    graphLogger.log(`Total traffic zones across all floors: ${allZones.length}`)
    return allZones
  } catch (err) {
    logger.error('Failed to load zones from all floors:', err)
    return []
  }
}

async function loadAllFloorsNavigationData(): Promise<void> {
  const [allNodes, allWalls, allZones] = await Promise.all([
    loadAllNodesAllFloors(),
    loadAllFloorsWalls(),
    loadAllFloorsZones(),
  ])

  if (allNodes.length === 0) {
    logger.warn('Global navigation data is incomplete; keeping per-floor fallback only')
    return
  }

  state.allNodesAllFloors = allNodes
  state.wallObjects = allWalls
  state.allTrafficZones = allZones
  state.hasLoadedGlobalNavigationData = true
  graphLogger.info('Cached global navigation data for all floors')
}

// Callbacks injected from the orchestrator (Map.astro)
/**
 * Callbacks injected by Map.astro to break circular imports between `map-init`
 * and `route-display`.
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
  /** Rebuild the visibility graph and A* cache after data changes. */
  initializeNavigation: () => Promise<void>
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
 * Fetch nodes, walls, and traffic zones for the current floor from static
 * JSON files in `/public/data/`, then trigger navigation initialisation.
 *
 * Sequence:
 * 1. `clearMapData` — remove current markers and polylines from the Leaflet map.
 * 2. Fetch `/data/floor<N>/nodes.json` and `/data/floor<N>/walls.json`.
 * 3. Fetch `/data/floor<N>/zones.json`.
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
    clearMapData()

    const nodesRes = await fetch(`/data/floor${state.currentFloor}/nodes.json`)
    if (!nodesRes.ok) {
      throw new Error(`Failed to load nodes: ${nodesRes.status} ${nodesRes.statusText}`)
    }
    const rawNodes: unknown = await nodesRes.json()
    state.collectedNodes = parseNodes(rawNodes, state.currentFloor, `floor${state.currentFloor}/nodes.json`)

    const wallsRes = await fetch(`/data/floor${state.currentFloor}/walls.json`)
    if (!wallsRes.ok) {
      throw new Error(`Failed to load walls: ${wallsRes.status} ${wallsRes.statusText}`)
    }
    const rawWalls: unknown = await wallsRes.json()
    state.collectedWalls = parseWalls(rawWalls, `floor${state.currentFloor}/walls.json`)

    // Remove old traffic zone rects from the map before reloading
    for (const rect of state.trafficZoneRects) {
      state.map?.removeLayer(rect)
    }
    state.trafficZoneRects = []
    state.trafficZones = []

    const zonesRes = await fetch(`/data/floor${state.currentFloor}/zones.json`)
    if (zonesRes.ok) {
      const rawZones: unknown = await zonesRes.json()
      const zones = parseZones(rawZones, state.currentFloor, `floor${state.currentFloor}/zones.json`)
      state.trafficZones = zones
      graphLogger.log(`Loaded ${zones.length} traffic zones for floor ${state.currentFloor}`)
    } else {
      logger.warn(`Failed to load zones for floor ${state.currentFloor}: ${zonesRes.status}`)
    }

    renderMapData()

    if (!state.hasLoadedGlobalNavigationData) {
      await loadAllFloorsNavigationData()
    }

    if (!state.hasLoadedGlobalNavigationData) {
      state.allNodesAllFloors = state.collectedNodes
      const fallbackWalls = convertWallData(state.collectedWalls)
      fallbackWalls.forEach(wall => {
        wall.floor = state.currentFloor
      })
      state.wallObjects = fallbackWalls
      state.allTrafficZones = state.trafficZones
    }

    await _cb.initializeNavigation()
  } catch (err) {
    logger.error('Failed to load data:', err)
    const emptyState = document.getElementById('empty-state')
    if (emptyState) {
      emptyState.textContent = ''
      emptyState.appendChild(
        _cb.createTextParagraph(
          'Unable to load navigation data.',
          'color: #ff6b6b;'
        )
      )
    }
  }
}

/**
 * Fetch nodes for every available floor from static JSON files and populate
 * `state.allNodesAllFloors`.
 */
export async function loadAllNodesAllFloors(): Promise<Node[]> {
  try {
    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async floor => {
        const res = await fetch(`/data/floor${floor.id}/nodes.json`)
        if (!res.ok) return []
         const rawNodes: unknown = await res.json()
         const floorNodes = parseNodes(rawNodes, floor.id, `floor${floor.id}/nodes.json`)
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
 * Fetch walls for every available floor from static JSON files, convert them,
 * and return the full array (tagged with `floor` property).
 */
export async function loadAllFloorsWalls(): Promise<Wall[]> {
  try {
    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async floor => {
        const res = await fetch(`/data/floor${floor.id}/walls.json`)
        if (!res.ok) return []
        const rawWalls: unknown = await res.json()
        const floorWallsRaw = parseWalls(rawWalls, `floor${floor.id}/walls.json`)
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
