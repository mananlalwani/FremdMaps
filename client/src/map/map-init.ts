/** Leaflet map creation, floor switching, and current-floor projection. */

import L from 'leaflet'
import { t } from '../utils/i18n'
import { FLOORS, MAP_CONFIG } from '../utils/constants'
import { graphLogger, logger } from '../utils/logger'
import { getSelectedFloor, saveSelectedFloor } from '../utils/storage'
import { state } from './map-state'
import type { NavigationData } from '../navigation/navigationData'

export interface MapInitCallbacks {
  navigationData: NavigationData
  activeRouteFloorChanged: () => void
}

let callbacks: MapInitCallbacks | null = null
let loadRequestId = 0
let activeLoadController: AbortController | null = null

function syncFloor(floorId: string): void {
  if (!callbacks) return
  const floor = callbacks.navigationData.getFloor(floorId)
  state.collectedNodes = floor.nodes
  state.collectedWalls = floor.walls.map((wall) => [
    [wall.start.lat, wall.start.lng],
    [wall.end.lat, wall.end.lng],
  ])
  state.trafficZones = floor.zones
}

function updateFloorUi(floorId: string): void {
  const floorLabel = document.querySelector('.floor-label')
  if (floorLabel) floorLabel.textContent = t('floor.label', { floor: floorId })
  for (const button of document.querySelectorAll<HTMLElement>('.floor-btn')) {
    const active = button.getAttribute('data-floor') === floorId
    button.classList.toggle('active', active)
    button.toggleAttribute('aria-current', active)
  }
}

async function loadCurrentFloor(): Promise<void> {
  if (!callbacks) return
  const floorId = state.currentFloor
  const requestId = ++loadRequestId
  activeLoadController?.abort()
  const controller = new AbortController()
  activeLoadController = controller
  const isCurrent = (): boolean =>
    requestId === loadRequestId && state.currentFloor === floorId && !controller.signal.aborted
  const emptyState = document.getElementById('empty-state')
  if (emptyState) {
    emptyState.textContent = ''
    emptyState.hidden = true
  }

  try {
    clearMapData()
    await callbacks.navigationData.load(floorId, controller.signal)
    if (!isCurrent()) return
    syncFloor(floorId)
    window.dispatchEvent(
      new CustomEvent('schoolwayfinder:floor-data-loaded', { detail: { floorId } })
    )
  } catch (caught) {
    if (controller.signal.aborted || !isCurrent()) return
    logger.error(`[${requestId}] Failed to load navigation data:`, caught)
    if (emptyState) {
      emptyState.textContent = 'Unable to load navigation data.'
      emptyState.hidden = false
    }
  } finally {
    if (activeLoadController === controller) activeLoadController = null
  }
}

function updateFloorImage(floorId: string): void {
  const floor = FLOORS.AVAILABLE.find((candidate) => candidate.id === floorId)
  if (!floor || !state.currentImageOverlay) return
  if (state.loadedFloorImages.has(floorId)) {
    state.currentImageOverlay.setUrl(floor.image)
    return
  }
  state.currentImageOverlay.setOpacity(0.3)
  const image = new Image()
  image.src = floor.image
  const finish = (): void => {
    state.loadedFloorImages.add(floorId)
    state.currentImageOverlay?.setUrl(floor.image)
    state.currentImageOverlay?.setOpacity(1)
  }
  image.onload = finish
  image.onerror = finish
}

function prefetchFloorImages(): void {
  for (const floor of FLOORS.AVAILABLE) {
    if (floor.id === state.currentFloor) continue
    const image = new Image()
    image.src = floor.image
    image.onload = () => {
      state.loadedFloorImages.add(floor.id)
      graphLogger.info(`Prefetched floor ${floor.id} image`)
    }
  }
}

/** Initialise the Leaflet map and begin loading the first navigation-data revision. */
export function initMap(nextCallbacks: MapInitCallbacks): void {
  callbacks = nextCallbacks
  const { IMAGE_WIDTH, IMAGE_HEIGHT, MIN_ZOOM, MAX_ZOOM } = MAP_CONFIG
  const bounds: [[number, number], [number, number]] = [
    [-IMAGE_HEIGHT, 0],
    [0, IMAGE_WIDTH],
  ]
  const savedFloor = getSelectedFloor()
  state.currentFloor =
    savedFloor && FLOORS.AVAILABLE.some((floor) => floor.id === savedFloor)
      ? savedFloor
      : FLOORS.DEFAULT

  const mapOptions: L.MapOptions & { tap?: boolean } = {
    crs: L.CRS.Simple,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomControl: false,
    preferCanvas: true,
    tap: false,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    inertia: false,
    maxBoundsViscosity: 0.7,
    doubleClickZoom: false,
  }
  const map = L.map('map', mapOptions)
  state.map = map
  map.setMaxBounds(bounds)
  updateFloorUi(state.currentFloor)

  const initialFloor = FLOORS.AVAILABLE.find((floor) => floor.id === state.currentFloor)
  if (initialFloor) {
    state.currentImageOverlay = L.imageOverlay(initialFloor.image, bounds).addTo(map)
    state.loadedFloorImages.add(state.currentFloor)
  }
  map.fitBounds(bounds)
  window.visualViewport?.addEventListener('resize', () => map.invalidateSize())
  void loadCurrentFloor()
  window.setTimeout(prefetchFloorImages, 1500)
}

/** Change the visible floor without changing the active route plan. */
export function switchFloor(floorId: string): void {
  if (
    !callbacks ||
    floorId === state.currentFloor ||
    !FLOORS.AVAILABLE.some((floor) => floor.id === floorId)
  ) {
    return
  }
  state.currentFloor = floorId
  saveSelectedFloor(floorId)
  updateFloorImage(floorId)
  updateFloorUi(floorId)
  syncFloor(floorId)
  void loadCurrentFloor()
  callbacks.activeRouteFloorChanged()
}

/** Stop in-flight navigation-data work during application teardown. */
export function cancelPendingDataLoad(): void {
  activeLoadController?.abort()
  activeLoadController = null
  loadRequestId += 1
  callbacks = null
}

/** Remove current-floor traffic-zone artifacts from Leaflet. */
export function clearMapData(): void {
  for (const rectangle of state.trafficZoneRects) state.map?.removeLayer(rectangle)
  state.trafficZoneRects = []
  state.trafficZones = []
}
