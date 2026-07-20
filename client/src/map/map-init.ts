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
import { t } from '../utils/i18n'
import type { Node, Wall, TrafficZone } from '../utils/types'
import { MAP_CONFIG, FLOORS, getDataUrl } from '../utils/constants'
import { graphLogger, logger } from '../utils/logger'
import { state } from './map-state'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNodeType(value: unknown): value is NonNullable<Node['type']> {
  return value === 'room' || value === 'waypoint' || value === 'bathroom' || value === 'stairway'
}

const VALID_BATHROOM_TYPES = new Set<string>(['all-gender', 'mens', 'womens', 'accessible'])

const VALID_CATEGORIES = new Set<string>([
  'classroom',
  'office',
  'lab',
  'bathroom',
  'cafeteria',
  'gymnasium',
  'library',
  'auditorium',
  'stairway',
  'entrance',
  'other',
])

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

export function parseNodes(value: unknown, floorId: string, contextLabel: string): Node[] {
  if (!Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an array`)
  }
  const data: unknown[] = value

  const nodes: Node[] = []
  const seenUids = new Set<string>()

  for (let index = 0; index < data.length; index += 1) {
    const rawNode = data[index]
    const label = `${contextLabel}[${index}]`
    if (!isObject(rawNode)) {
      throw new Error(`${label} must be an object`)
    }

    const uid = assertNonEmptyString(rawNode.uid, `${label}.uid`)
    if (seenUids.has(uid)) {
      throw new Error(`${label}.uid duplicates another node on floor ${floorId}: ${uid}`)
    }
    seenUids.add(uid)
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

    if (rawNode.searchAliases !== undefined) {
      if (!Array.isArray(rawNode.searchAliases)) {
        throw new Error(`${label}.searchAliases must be an array when present`)
      }
      node.searchAliases = rawNode.searchAliases.map((alias, aliasIndex) =>
        assertNonEmptyString(alias, `${label}.searchAliases[${aliasIndex}]`)
      )
    }

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
      if (!VALID_BATHROOM_TYPES.has(bathroomType)) {
        throw new Error(
          `${label}.bathroomType must be one of: ${Array.from(VALID_BATHROOM_TYPES).join(', ')}`
        )
      }
      node.bathroomType = bathroomType as Node['bathroomType']
    }

    if (rawNode.category !== undefined) {
      const category = assertNonEmptyString(rawNode.category, `${label}.category`)
      if (!VALID_CATEGORIES.has(category)) {
        throw new Error(
          `${label}.category must be one of: ${Array.from(VALID_CATEGORIES).join(', ')}`
        )
      }
      node.category = category as Node['category']
    }

    nodes.push(node)
  }

  return nodes
}

export function parseWalls(value: unknown, contextLabel: string): number[][][] {
  if (!Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an array`)
  }
  const data: unknown[] = value

  const walls: number[][][] = []

  for (let index = 0; index < data.length; index += 1) {
    const polyline = data[index]
    const label = `${contextLabel}[${index}]`
    if (!Array.isArray(polyline) || polyline.length < 2) {
      throw new Error(`${label} must be a polyline with at least 2 points`)
    }

    const parsedPolyline: number[][] = []
    for (let pointIndex = 0; pointIndex < polyline.length; pointIndex += 1) {
      const pt = (polyline as unknown[])[pointIndex]
      if (!Array.isArray(pt) || pt.length !== 2) {
        throw new Error(`${label}[${pointIndex}] must be [lat, lng]`)
      }

      const lat = assertFiniteNumber(pt[0], `${label}[${pointIndex}][0]`)
      const lng = assertFiniteNumber(pt[1], `${label}[${pointIndex}][1]`)
      assertCoordinateBounds(lat, lng, `${label}[${pointIndex}]`)
      parsedPolyline.push([lat, lng])
    }

    for (let pointIndex = 1; pointIndex < parsedPolyline.length; pointIndex += 1) {
      const start = parsedPolyline[pointIndex - 1]
      const end = parsedPolyline[pointIndex]
      if (start[0] === end[0] && start[1] === end[1]) {
        throw new Error(
          `${label}[${pointIndex - 1}..${pointIndex}] is degenerate (consecutive points are identical)`
        )
      }
    }

    walls.push(parsedPolyline)
  }

  return walls
}

export function parseZones(value: unknown, floorId: string, contextLabel: string): TrafficZone[] {
  if (!Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an array`)
  }
  const data: unknown[] = value

  const zones: TrafficZone[] = []
  const seenUids = new Set<string>()

  for (let index = 0; index < data.length; index += 1) {
    const rawZone = data[index]
    const label = `${contextLabel}[${index}]`
    if (!isObject(rawZone)) {
      throw new Error(`${label} must be an object`)
    }

    const uid = assertNonEmptyString(rawZone.uid, `${label}.uid`)
    if (seenUids.has(uid)) {
      throw new Error(`${label}.uid duplicates another zone on floor ${floorId}: ${uid}`)
    }
    seenUids.add(uid)
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

export async function loadAllFloorsZones(): Promise<TrafficZone[]> {
  try {
    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async (floor) => {
        const res = await fetch(getDataUrl(floor.id, 'zones'))
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

export async function loadAllFloorsNavigationData(signal?: AbortSignal): Promise<void> {
  const results = await Promise.allSettled(
    FLOORS.AVAILABLE.map(async (floor) => {
      const [nodesRes, wallsRes, zonesRes] = await Promise.all([
        fetch(getDataUrl(floor.id, 'nodes'), { signal }),
        fetch(getDataUrl(floor.id, 'walls'), { signal }),
        fetch(getDataUrl(floor.id, 'zones'), { signal }),
      ])

      if (!nodesRes.ok) {
        throw new Error(`Failed to load floor ${floor.id} nodes: ${nodesRes.status}`)
      }
      if (!wallsRes.ok) {
        throw new Error(`Failed to load floor ${floor.id} walls: ${wallsRes.status}`)
      }

      const rawNodes: unknown = await nodesRes.json()
      const rawWalls: unknown = await wallsRes.json()
      const nodes = parseNodes(rawNodes, floor.id, `floor${floor.id}/nodes.json`)
      const walls = convertWallData(parseWalls(rawWalls, `floor${floor.id}/walls.json`))
      walls.forEach((wall) => {
        wall.floor = floor.id
      })

      let zones: TrafficZone[] = []
      if (zonesRes.ok) {
        const rawZones: unknown = await zonesRes.json()
        zones = parseZones(rawZones, floor.id, `floor${floor.id}/zones.json`)
      } else {
        logger.warn(`Failed to load zones for floor ${floor.id}: ${zonesRes.status}`)
      }

      return { nodes, walls, zones }
    })
  )

  const floorData: Array<{ nodes: Node[]; walls: Wall[]; zones: TrafficZone[] }> = []
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn(
        'Global navigation data is incomplete; keeping per-floor fallback only',
        result.reason
      )
      return
    }
    floorData.push(result.value)
  }

  state.allNodesAllFloors = floorData.flatMap((data) => data.nodes)
  state.wallObjects = floorData.flatMap((data) => data.walls)
  state.allTrafficZones = floorData.flatMap((data) => data.zones)
  state.hasLoadedGlobalNavigationData = true
  state.graphDataRevision += 1
  graphLogger.info('Cached global navigation data for all floors')
}

// Callbacks injected from the orchestrator (Map.astro)
/**
 * Callbacks injected by Map.astro to break circular imports between `map-init`
 * and `route-display`.
 */
export interface MapInitCallbacks {
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
let navigationInitRequestId = 0

function scheduleNavigationInitialization(requestId: number): void {
  const run = async () => {
    if (requestId !== navigationInitRequestId) return
    try {
      await _cb.initializeNavigation()
    } catch (err) {
      logger.error('Navigation initialization failed:', err)
    }
  }

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    ;(
      window as Window & {
        requestIdleCallback: (cb: () => void, options?: { timeout: number }) => number
      }
    ).requestIdleCallback(
      () => {
        void run()
      },
      { timeout: 250 }
    )
    return
  }

  setTimeout(() => {
    void run()
  }, 0)
}

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

  const mapOptions: L.MapOptions & { tap?: boolean } = {
    crs: L.CRS.Simple,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    preferCanvas: true,
    // tap: false — use Leaflet's pointer-events path instead of the legacy tap
    // handler, which conflicts with iOS Safari's touch processing and causes
    // ghost clicks on first interaction. The Leaflet type declarations omit it.
    tap: false,
    // Keep panning responsive on lower-end mobile devices by reducing runtime
    // animation/transform work during drag/zoom.
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    maxBoundsViscosity: 0.7,
    doubleClickZoom: false,
  }
  const leafletMap = L.map('map', mapOptions)
  state.map = leafletMap

  leafletMap.setMaxBounds(bounds)

  // Load initial floor image
  const initialFloor = FLOORS.AVAILABLE.find((f) => f.id === state.currentFloor)
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

  loadData().catch((err) => {
    logger.error('Failed to load initial floor data:', err)
  })

  // Prefetch other floor images in the background after the initial floor loads
  // so that switching floors feels instantaneous.  The delay is a conservative
  // buffer; it is not tied to any load-event completion and is intentionally
  // loose to avoid competing with the critical initial data fetch.
  setTimeout(prefetchFloorImages, FLOOR_PREFETCH_DELAY_MS)
}

const FLOOR_PREFETCH_DELAY_MS = 1500

function prefetchFloorImages(): void {
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
}

/**
 * Switch to a different floor: update the image overlay, reload data, and
 * redraw any active multi-floor route for the new floor.
 */
export function switchFloor(floorId: string): void {
  if (floorId === state.currentFloor) return

  graphLogger.info(`Switching to floor ${floorId}`)
  state.currentFloor = floorId
  document.title = `Fremd Maps - Floor ${floorId}`

  const floor = FLOORS.AVAILABLE.find((f) => f.id === floorId)
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
  if (floorLabel) floorLabel.textContent = t('floor.label', { floor: floorId })

  void loadData()

  if (hasMultiFloorRoute) {
    _cb.redrawRouteForCurrentFloor()
  }

  document.querySelectorAll('.floor-btn').forEach((btn) => {
    const htmlBtn = btn as HTMLElement
    if (htmlBtn.getAttribute('data-floor') === floorId) {
      htmlBtn.classList.add('active')
      htmlBtn.setAttribute('aria-current', 'true')
    } else {
      htmlBtn.classList.remove('active')
      htmlBtn.removeAttribute('aria-current')
    }
  })
}

/**
 * Convert Wall[] back to the raw number[][][] format stored in collectedWalls.
 * Each Wall segment becomes its own 2-point polyline, matching the on-disk
 * walls.json structure.
 */
function wallsToRawFormat(walls: Wall[], floorId: string): number[][][] {
  return walls
    .filter((w) => w.floor === floorId)
    .map((w) => [
      [w.start.lat, w.start.lng],
      [w.end.lat, w.end.lng],
    ])
}

let loadDataRequestId = 0
let activeLoadController: AbortController | null = null

/** Stop an in-flight navigation-data request during app teardown. */
export function cancelPendingDataLoad(): void {
  activeLoadController?.abort()
  activeLoadController = null
  navigationInitRequestId += 1
}

/**
 * Remove all traffic zone overlays from the map.
 */
export function clearMapData(): void {
  for (const rect of state.trafficZoneRects) {
    state.map?.removeLayer(rect)
  }
  state.trafficZoneRects = []
  state.trafficZones = []

  graphLogger.info('Cleared floor overlays')
}

/**
 * Fetch nodes, walls, and traffic zones for the current floor from static
 * JSON files in `/public/data/`, then trigger navigation initialisation.
 *
 * Sequence:
 * 1. Capture the targeted `floorId` and increment a per-call request ID for
 *    race-safety — responses that arrive after a newer floor switch are
 *    discarded before mutating shared state.
 * 2. Fetch nodes, walls, and zones for the target floor in parallel.
 * 3. On the very first call (no global data yet), load ALL floors once via
 *    `loadAllFloorsNavigationData`, then derive per-floor data from the
 *    global pool — avoids the redundant double-fetch of the initial floor.
 * 4. When global data is unavailable, fall back to per-floor data only.
 * 5. Schedule `initializeNavigation` via the existing request-ID pattern.
 *
 * On any network or parse error, logs to `logger.error` and displays a
 * human-readable message in the `#empty-state` panel.
 */
export async function loadData(): Promise<void> {
  const floorId = state.currentFloor
  const requestId = ++loadDataRequestId
  activeLoadController?.abort()
  const controller = new AbortController()
  activeLoadController = controller
  const isCurrentRequest = (): boolean =>
    requestId === loadDataRequestId && state.currentFloor === floorId && !controller.signal.aborted

  try {
    clearMapData()

    if (!state.hasLoadedGlobalNavigationData) {
      // First load — fetch every floor once, then derive per-floor state.
      await loadAllFloorsNavigationData(controller.signal)
      // Race guard: a newer request can target the same floor after a rapid
      // 1→2→1 switch, so floor identity alone is not sufficient.
      if (!isCurrentRequest()) {
        graphLogger.log(`[${requestId}] Request superseded during global load; discarding`)
        return
      }
    }

    if (state.hasLoadedGlobalNavigationData) {
      // Derive per-floor data from the global pool (avoids re-fetching).
      state.collectedNodes = state.allNodesAllFloors.filter((n: Node) => n.floor === floorId)
      state.collectedWalls = wallsToRawFormat(state.wallObjects, floorId)
      state.trafficZones = state.allTrafficZones.filter((z: TrafficZone) => z.floor === floorId)
      graphLogger.log(`[${requestId}] Derived per-floor data for floor ${floorId} from global pool`)
    } else {
      // Fallback: global data never loaded — fetch per-floor directly.
      graphLogger.log(
        `[${requestId}] Global data unavailable; fetching per-floor data for ${floorId}`
      )
      const [nodesRes, wallsRes, zonesRes] = await Promise.all([
        fetch(getDataUrl(floorId, 'nodes'), { signal: controller.signal }),
        fetch(getDataUrl(floorId, 'walls'), { signal: controller.signal }),
        fetch(getDataUrl(floorId, 'zones'), { signal: controller.signal }),
      ])

      // Race guard — discarding a late or superseded response.
      if (!isCurrentRequest()) {
        graphLogger.log(`[${requestId}] Request superseded during fetch; discarding`)
        return
      }

      if (!nodesRes.ok) {
        throw new Error(`Failed to load nodes: ${nodesRes.status} ${nodesRes.statusText}`)
      }
      const rawNodes: unknown = await nodesRes.json()
      state.collectedNodes = parseNodes(rawNodes, floorId, `floor${floorId}/nodes.json`)

      if (!wallsRes.ok) {
        throw new Error(`Failed to load walls: ${wallsRes.status} ${wallsRes.statusText}`)
      }
      const rawWalls: unknown = await wallsRes.json()
      state.collectedWalls = parseWalls(rawWalls, `floor${floorId}/walls.json`)

      if (zonesRes.ok) {
        const rawZones: unknown = await zonesRes.json()
        state.trafficZones = parseZones(rawZones, floorId, `floor${floorId}/zones.json`)
        graphLogger.log(
          `[${requestId}] Loaded ${state.trafficZones.length} zones for floor ${floorId}`
        )
      } else {
        logger.warn(`Failed to load zones for floor ${floorId}: ${zonesRes.status}`)
      }

      state.allNodesAllFloors = state.collectedNodes
      const fallbackWalls = convertWallData(state.collectedWalls)
      fallbackWalls.forEach((wall) => {
        wall.floor = floorId
      })
      state.wallObjects = fallbackWalls
      state.allTrafficZones = state.trafficZones
      state.graphDataRevision += 1
    }

    navigationInitRequestId += 1
    scheduleNavigationInitialization(navigationInitRequestId)
    if (isCurrentRequest()) {
      window.dispatchEvent(
        new CustomEvent('schoolwayfinder:floor-data-loaded', { detail: { floorId } })
      )
    }
  } catch (err) {
    if (controller.signal.aborted) {
      graphLogger.log(`[${requestId}] Navigation-data request cancelled`)
      return
    }
    if (!isCurrentRequest()) return
    logger.error(`[${requestId}] Failed to load data:`, err)
    const emptyState = document.getElementById('empty-state')
    if (emptyState) {
      emptyState.textContent = ''
      emptyState.appendChild(
        _cb.createTextParagraph('Unable to load navigation data.', 'color: #ff6b6b;')
      )
    }
  } finally {
    if (activeLoadController === controller) activeLoadController = null
  }
}

/**
 * Fetch nodes for every available floor from static JSON files and populate
 * `state.allNodesAllFloors`.
 */
export async function loadAllNodesAllFloors(): Promise<Node[]> {
  try {
    const perFloor = await Promise.all(
      FLOORS.AVAILABLE.map(async (floor) => {
        const res = await fetch(getDataUrl(floor.id, 'nodes'))
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
      FLOORS.AVAILABLE.map(async (floor) => {
        const res = await fetch(getDataUrl(floor.id, 'walls'))
        if (!res.ok) return []
        const rawWalls: unknown = await res.json()
        const floorWallsRaw = parseWalls(rawWalls, `floor${floor.id}/walls.json`)
        const floorWalls = convertWallData(floorWallsRaw)
        floorWalls.forEach((wall) => {
          wall.floor = floor.id
        })
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
