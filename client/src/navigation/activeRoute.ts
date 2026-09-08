/** Active-route presentation, clearing, floor projection, and turn-by-turn directions. */

import L from 'leaflet'
import { simplifyPath } from '../utils/geometry'
import { buildDirectionSteps } from '../utils/directions'
import { t } from '../utils/i18n'
import { MAP_CONFIG, UI_CONFIG } from '../utils/constants'
import { routeLogger } from '../utils/logger'
import { state } from '../map/map-state'
import type { Node, Wall } from '../utils/types'
import type { RoutePlan } from './routePlanner'

/** The complete interface for the route currently shown to the visitor. */
export interface ActiveRoute {
  show(plan: RoutePlan): void
  clear(): void
  floorChanged(): void
  dispose(): void
}

interface ActiveRouteOptions {
  switchFloor(floorId: string): void
  getWalls(): readonly Wall[]
}

interface ActiveRouteState {
  fullPath: Node[]
  currentRoute: L.Polyline | null
  markers: Array<L.Marker | L.Polyline | { __isOutline: true; layer: L.Polyline }>
}

interface ActiveRouteContext {
  route: ActiveRouteState
  options: ActiveRouteOptions
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function updateRouteStatus(path: Node[]): void {
  const statusDetails = document.getElementById('route-status-details')
  if (!statusDetails) return
  const floorCount = new Set(path.map((node) => node.floor).filter(Boolean)).size
  statusDetails.textContent =
    floorCount > 1 ? t('route.followMulti', { floors: floorCount }) : t('route.follow')
}

/**
 * Display a found route on the map.
 * Stores the full path for multi-floor redraws, then calls
 * `redrawRouteForCurrentFloor` to paint the visible portion.
 */
function displayRoute(context: ActiveRouteContext, path: Node[], _totalDistance: number): void {
  clearRoute(context)

  context.route.fullPath = path

  const floors = [...new Set(path.map((n) => n.floor).filter((f): f is string => Boolean(f)))]
  const isMultiFloor = floors.length > 1
  routeLogger.log(
    `Route: ${path.length} nodes, floors: ${floors.join(', ')}, multi-floor: ${isMultiFloor}`
  )

  const startFloor = path[0]?.floor
  if (startFloor && startFloor !== state.currentFloor) {
    routeLogger.log(`Switching to route start floor ${startFloor} from ${state.currentFloor}`)
    context.options.switchFloor(startFloor)
  }

  if (isMultiFloor) {
    routeLogger.log(`Multi-floor route detected: ${floors.join(', ')}`)
  }

  redrawRouteForCurrentFloor(context)

  const routeStatus = document.getElementById('route-status')
  if (routeStatus) {
    routeStatus.classList.remove('hiding')
    routeStatus.style.display = 'block'
  }
  updateRouteStatus(path)

  generateDirections(context, path, state.currentFloor)
}

/**
 * Re-render the stored route for whichever floor is currently active.
 * Splits the full path into contiguous per-floor segments and draws only the
 * ones that belong to `state.currentFloor`.
 */
function redrawRouteForCurrentFloor(context: ActiveRouteContext): void {
  if (!state.map) return

  // Clear visible artifacts while preserving the full route plan.
  if (context.route.currentRoute) {
    state.map.removeLayer(context.route.currentRoute)
    context.route.currentRoute = null
  }

  context.route.markers.forEach((m) => {
    // `__isOutline` distinguishes the outline-polyline wrapper objects from
    // plain `L.Marker` instances stored in the same array.  Using an `in`
    // check (rather than instanceof) works because the wrapper is a plain
    // object `{ __isOutline: true, layer: L.Polyline }`, not a class instance.
    if ('__isOutline' in m) {
      state.map!.removeLayer(m.layer)
    } else {
      state.map!.removeLayer(m)
    }
  })
  context.route.markers = []

  if (context.route.fullPath.length === 0) {
    const banner = document.getElementById('multi-floor-banner')
    if (banner && banner.style.display !== 'none') {
      banner.classList.add('hiding')
      banner.addEventListener(
        'animationend',
        () => {
          banner.style.display = 'none'
          banner.classList.remove('hiding')
        },
        { once: true }
      )
    }
    return
  }

  const path = context.route.fullPath

  const floorsInRoute = [
    ...new Set(path.map((n) => n.floor).filter((f): f is string => Boolean(f))),
  ]
  const isMultiFloor = floorsInRoute.length > 1

  const banner = document.getElementById('multi-floor-banner')
  const bannerFloor = document.getElementById('banner-floor')
  const bannerSwitchBtn = document.getElementById('banner-switch-btn')

  const destinationFloor = path[path.length - 1].floor
  const needsFloorSwitch = isMultiFloor && destinationFloor !== state.currentFloor

  if (banner && needsFloorSwitch) {
    const otherFloors = floorsInRoute.filter((f) => f !== state.currentFloor)
    if (otherFloors.length > 0) {
      if (bannerFloor) bannerFloor.textContent = otherFloors[0]
      banner.classList.remove('hiding')
      banner.style.display = 'flex'
      if (bannerSwitchBtn) {
        bannerSwitchBtn.onclick = () => context.options.switchFloor(otherFloors[0])
      }
    } else {
      banner.style.display = 'none'
    }
  } else if (banner && banner.style.display !== 'none') {
    banner.classList.add('hiding')
    banner.addEventListener(
      'animationend',
      () => {
        banner.style.display = 'none'
        banner.classList.remove('hiding')
      },
      { once: true }
    )
  }

  // Extract contiguous runs of nodes on the current floor
  const segments: Node[][] = []
  let currentSegment: Node[] = []
  for (const node of path) {
    if (node.floor === state.currentFloor) {
      currentSegment.push(node)
    } else {
      if (currentSegment.length > 0) {
        segments.push(currentSegment)
        currentSegment = []
      }
    }
  }
  if (currentSegment.length > 0) segments.push(currentSegment)

  routeLogger.log(
    `Filtering route: ${path.length} total nodes, ` +
      `${segments.reduce((a, s) => a + s.length, 0)} on floor ${state.currentFloor} ` +
      `across ${segments.length} segment(s)`
  )

  if (segments.length === 0) {
    routeLogger.warn(`No nodes on floor ${state.currentFloor} in this route`)
    return
  }

  const floorWalls = context.options.getWalls().filter((wall) => wall.floor === state.currentFloor)

  // Draw each contiguous segment
  for (const segment of segments) {
    // Room and stair nodes can act as graph anchors along a corridor. They are
    // important to routing but should not force a visible kink in the amber
    // line; only this segment's endpoints must remain display anchors. Every
    // resulting shortcut is still checked against the floor walls below.
    const displaySegment = segment.map((node, index) => {
      if (index === 0 || index === segment.length - 1) return node
      return { ...node, type: 'waypoint' as const, rooms: ['waypoint'] }
    })
    const simplified = simplifyPath(
      displaySegment,
      MAP_CONFIG.ROUTE_DISPLAY_SIMPLIFICATION_ANGLE,
      MAP_CONFIG.ROUTE_DISPLAY_RDP_EPSILON,
      floorWalls
    )
    routeLogger.log('Segment simplified length:', simplified.length)
    const coords: Array<[number, number]> = simplified.map((n) => [n.lat, n.lng])

    const routeOutline = L.polyline(coords, {
      color: '#000',
      weight: 10,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map)
    context.route.markers.push({ __isOutline: true, layer: routeOutline })

    const segPolyline = L.polyline(coords, {
      color: UI_CONFIG.ROUTE_PATH_COLOR,
      weight: 6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map)
    // Track every segment so floor changes and teardown remove every artifact.
    context.route.markers.push(segPolyline)
    context.route.currentRoute = segPolyline
  }

  // Start marker
  const startNode = path[0]
  if (startNode.floor === state.currentFloor) {
    const startIcon = L.divIcon({
      className: 'route-marker start',
      html: `<div style="background: ${UI_CONFIG.ROUTE_START_COLOR}; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; font-family: var(--font-body); border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3)">A</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    })
    const startMarker = L.marker([startNode.lat, startNode.lng], { icon: startIcon }).addTo(
      state.map
    )
    context.route.markers.push(startMarker)
  }

  // End marker
  const endNode = path[path.length - 1]
  if (endNode.floor === state.currentFloor) {
    const endIcon = L.divIcon({
      className: 'route-marker end',
      html: `<div style="background: ${UI_CONFIG.ROUTE_END_COLOR}; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; font-family: var(--font-body); border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3)">B</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    })
    const endMarker = L.marker([endNode.lat, endNode.lng], { icon: endIcon }).addTo(state.map)
    context.route.markers.push(endMarker)
  }

  // Stairway portal markers
  for (let i = 0; i < path.length; i++) {
    const node = path[i]
    if (node.type === 'stairway' && node.floor === state.currentFloor) {
      const prevNode = i > 0 ? path[i - 1] : null
      const nextNode = i < path.length - 1 ? path[i + 1] : null
      const neighbor =
        nextNode && nextNode.floor !== state.currentFloor
          ? nextNode
          : prevNode && prevNode.floor !== state.currentFloor
            ? prevNode
            : null
      const targetFloor = neighbor?.floor

      // A same-floor route can pass a stairway node as an ordinary waypoint.
      // Only show the floor-transition marker when the route actually changes floors.
      if (!targetFloor) continue

      const label = `Floor ${targetFloor}`
      const safeLabel = escapeHtml(label)
      const stairIcon = L.divIcon({
        className: 'route-marker stairway',
        html: `<div style="background: ${UI_CONFIG.STAIR_COLOR}; color: white; min-width: 28px; height: 28px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; font-family: 'Plus Jakarta Sans', sans-serif; border: 2px solid white; box-shadow: 0 0 12px ${UI_CONFIG.STAIR_GLOW}; padding: 0 8px; white-space: nowrap; cursor: pointer;">${safeLabel}</div>`,
        iconSize: [72, 28],
        iconAnchor: [36, 14],
      })

      const stairMarker = L.marker([node.lat, node.lng], { icon: stairIcon }).addTo(state.map)

      stairMarker.on('click', () => context.options.switchFloor(targetFloor))

      context.route.markers.push(stairMarker)
    }
  }

  // Fit map to visible route
  const allVisibleCoords: Array<[number, number]> = segments.flat().map((n) => [n.lat, n.lng])
  if (allVisibleCoords.length > 0) {
    state.map.fitBounds(L.latLngBounds(allVisibleCoords), { padding: [100, 100] })

    const routeStart = path[0]
    if (routeStart.floor === state.currentFloor) {
      const zoomedStart = Math.min(state.map.getZoom() + 0.6, MAP_CONFIG.MAX_ZOOM)
      state.map.flyTo([routeStart.lat, routeStart.lng], zoomedStart, {
        duration: 0.3,
      })
    }
  }

  generateDirections(context, context.route.fullPath, state.currentFloor)
}

/**
 * Remove all route visuals from the map and reset related state.
 */
function clearRoute(context: ActiveRouteContext): void {
  if (!state.map) return

  if (context.route.currentRoute) {
    state.map.removeLayer(context.route.currentRoute)
    context.route.currentRoute = null
  }

  context.route.fullPath = []

  context.route.markers.forEach((m) => {
    if ('__isOutline' in m) {
      state.map!.removeLayer(m.layer)
    } else {
      state.map!.removeLayer(m)
    }
  })
  context.route.markers = []

  const routeStatus = document.getElementById('route-status')
  const directionsList = document.getElementById('directions-list')

  if (routeStatus && routeStatus.style.display !== 'none') {
    routeStatus.classList.add('hiding')
    routeStatus.addEventListener(
      'animationend',
      () => {
        routeStatus.style.display = 'none'
        routeStatus.classList.remove('hiding')
      },
      { once: true }
    )
  }
  if (directionsList) directionsList.innerHTML = ''
}

/**
 * Generate and render turn-by-turn directions into #directions-list.
 *
 * Direction helpers produce start, walk, stair, and arrival steps. This
 * renderer marks steps on the active floor as `.active` and prior floors as
 * `.completed`.
 */
function generateDirections(context: ActiveRouteContext, path: Node[], activeFloor: string): void {
  const list = document.getElementById('directions-list')
  if (!list || path.length === 0) return

  const steps = buildDirectionSteps(path, context.options.getWalls())

  // Build an ordered list of unique floors as they appear in the path.
  // `floorOrder[0]` is the departure floor, `floorOrder[N-1]` is the arrival
  // floor.  A step is marked `.active` when it is on `activeFloor`; `.completed`
  // when it is on a floor that appears earlier in `floorOrder` (already walked).
  const floorOrder: string[] = []
  for (const node of path) {
    const f = node.floor ?? ''
    if (f && !floorOrder.includes(f)) floorOrder.push(f)
  }
  const activeFloorIndex = floorOrder.indexOf(activeFloor)

  list.textContent = '' // clear existing items safely

  const fragment = document.createDocumentFragment()

  for (const step of steps) {
    const stepFloorIndex = floorOrder.indexOf(step.floor)
    const isActive =
      step.floor === activeFloor || (step.type === 'stair' && step.floor === activeFloor)
    const isCompleted = stepFloorIndex < activeFloorIndex

    let iconClass = 'walk'
    let iconContent = '\u2192'
    if (step.type === 'start') {
      iconClass = 'start'
      iconContent = 'A'
    } else if (step.type === 'end') {
      iconClass = 'end'
      iconContent = 'B'
    } else if (step.type === 'stair') {
      iconClass = 'stair'
      iconContent = '\u{1FA9C}'
    }

    const stateClass = isActive ? 'active' : isCompleted ? 'completed' : ''

    const li = document.createElement('li')
    li.className = `direction-step ${stateClass}`.trim()

    const iconSpan = document.createElement('span')
    iconSpan.className = `direction-step-icon ${iconClass}`
    iconSpan.textContent = iconContent
    li.appendChild(iconSpan)

    const textSpan = document.createElement('span')
    textSpan.className = 'direction-step-text'
    textSpan.textContent = step.label
    li.appendChild(textSpan)

    if (step.floor) {
      const floorBadge = document.createElement('span')
      floorBadge.className = 'direction-step-floor'
      floorBadge.textContent = `F${step.floor}`
      li.appendChild(floorBadge)
    }

    fragment.appendChild(li)
  }

  list.appendChild(fragment)
}

/** Create the single active-route lifecycle for a map instance. */
export function createActiveRoute(options: ActiveRouteOptions): ActiveRoute {
  const context: ActiveRouteContext = {
    route: { fullPath: [], currentRoute: null, markers: [] },
    options,
  }
  const handleLocaleChange = (): void => {
    if (context.route.fullPath.length === 0) return
    updateRouteStatus(context.route.fullPath)
    generateDirections(context, context.route.fullPath, state.currentFloor)
  }
  window.addEventListener('fremdmaps:locale-change', handleLocaleChange)

  return {
    show(plan): void {
      displayRoute(context, plan.path, plan.cost)
    },
    clear(): void {
      clearRoute(context)
    },
    floorChanged(): void {
      redrawRouteForCurrentFloor(context)
    },
    dispose(): void {
      clearRoute(context)
      window.removeEventListener('fremdmaps:locale-change', handleLocaleChange)
    },
  }
}
