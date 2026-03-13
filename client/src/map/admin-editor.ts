/**
 * Admin / debug-mode editor logic.
 *
 * This module owns:
 *   - Map click / double-click dispatch (`onMapClick`, `onMapDoubleClick`)
 *   - Node creation handlers (room, waypoint, bathroom, stairway)
 *   - Stairway connection flow
 *   - Marker management (`addMarker`, `updateMarker`, `deleteNode`)
 *   - Wall drawing (`addWallPolyline`, `handleWallClick`, `finishCurrentWall`,
 *     `deleteWall`)
 *   - Graph-overlay toggle (`toggleGraphVisualization`)
 *   - Mode switching (`setMode`)
 *   - The debug-mode enable/disable toggle listener
 */

import L from 'leaflet'
import type { Node, RoomCategory, TrafficZone } from '../utils/types'
import { logger, graphLogger } from '../utils/logger'
import { state } from './map-state'
import { buildVisibilityGraph } from '../utils/graph'
import { MAP_CONFIG } from '../utils/constants'

/**
 * Callbacks injected by Map.astro to avoid circular imports between this module
 * and the orchestrator.
 */
export interface AdminEditorCallbacks {
  /** Re-build the navigation graph and update route state after data changes. */
  initializeNavigation: () => Promise<void>
  /** Toggle the debug graph-edge overlay on/off. */
  toggleGraphVisualization: () => void
  /** Refresh any UI elements that reflect the current node/wall counts. */
  updateUI: () => void
  /** Display a transient status banner to the user. */
  showStatusMessage: (message: string, type?: 'info' | 'warning' | 'error') => void
}

let _cb: AdminEditorCallbacks

/**
 * Inject the callbacks from the Map.astro orchestrator.
 * Must be called once before any other function in this module.
 */
export function setAdminEditorCallbacks(callbacks: AdminEditorCallbacks): void {
  _cb = callbacks
}

// ========== MAP EVENT DISPATCH ==========

/**
 * Main map click handler — dispatches to the handler for whichever edit mode
 * is currently active. No-ops when `state.isDebugMode` is false.
 */
export function onMapClick(e: L.LeafletMouseEvent): void {
  graphLogger.log(`Map clicked. Debug mode: ${state.isDebugMode}, Current mode: ${state.currentMode}`)

  if (!state.isDebugMode) return

  if (state.currentMode === 'room') {
    handleRoomNodeClick(e)
  } else if (state.currentMode === 'waypoint') {
    handleWaypointClick(e)
  } else if (state.currentMode === 'bathroom') {
    handleBathroomNodeClick(e)
  } else if (state.currentMode === 'stairway') {
    handleStairwayNodeClick(e)
  } else if (state.currentMode === 'connect-stairway') {
    graphLogger.log('Calling handleStairwayConnectionClick')
    handleStairwayConnectionClick(e)
  } else if (state.currentMode === 'wall') {
    handleWallClick(e)
  } else if (state.currentMode === 'special') {
    handleSpecialPlaceClick(e)
  } else if (state.currentMode === 'traffic-zone') {
    handleTrafficZoneClick(e)
  }
}

/**
 * Double-click handler — finalises the current wall polyline when in wall mode.
 * No-ops in all other modes.
 */
export function onMapDoubleClick(e: L.LeafletMouseEvent): void {
  if (!state.isDebugMode || state.currentMode !== 'wall') return
  finishCurrentWall()
}

// ========== NODE CREATION ==========

/**
 * Prompt for one or more comma-separated room IDs and place a `room` node at
 * the clicked location.
 */
async function handleRoomNodeClick(e: L.LeafletMouseEvent): Promise<void> {
  const input = prompt("Enter Room IDs (comma separated, e.g. '201, 202'):")
  if (!input) return

  const rooms = input.split(',').map(s => s.trim()).filter(s => s.length > 0)
  if (rooms.length === 0) return

  const node: Node = {
    uid: crypto.randomUUID(),
    rooms,
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    type: 'room',
    floor: state.currentFloor,
  }

  state.collectedNodes.push(node)
  addMarker(node)
  _cb.updateUI()

  await _cb.initializeNavigation()
}

/**
 * Place an invisible `waypoint` node at the clicked location.
 * Waypoints are used to guide the visibility graph through corridors but are
 * not shown in search results.
 */
async function handleWaypointClick(e: L.LeafletMouseEvent): Promise<void> {
  const node: Node = {
    uid: crypto.randomUUID(),
    rooms: ['waypoint'],
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    type: 'waypoint',
    floor: state.currentFloor,
  }

  state.collectedNodes.push(node)
  addMarker(node)
  _cb.updateUI()

  await _cb.initializeNavigation()
}

/**
 * Place a `bathroom` node at the clicked location.
 */
async function handleBathroomNodeClick(e: L.LeafletMouseEvent): Promise<void> {
  const node: Node = {
    uid: crypto.randomUUID(),
    rooms: ['bathroom'],
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    type: 'bathroom',
    floor: state.currentFloor,
  }

  state.collectedNodes.push(node)
  addMarker(node)
  _cb.updateUI()

  await _cb.initializeNavigation()
}

/**
 * Prompt for a stairway name and place a `stairway` node at the clicked location.
 *
 * `connectsTo` is initialised to `[stairName]` (the node's own room name).
 * This is intentional: `addStairwayConnections` in graph.ts resolves connections
 * by name across floors, so any stairway on another floor with the same name
 * will automatically be linked without requiring a separate connect-stairway step.
 */
async function handleStairwayNodeClick(e: L.LeafletMouseEvent): Promise<void> {
  const stairName = prompt(
    "Enter stairway name (e.g., 'A', 'B'):\nStairways with the same name on different floors will connect automatically."
  )
  if (!stairName) return

  const node: Node = {
    uid: crypto.randomUUID(),
    rooms: [stairName],
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    type: 'stairway',
    floor: state.currentFloor,
    connectsTo: [stairName],
  }

  state.collectedNodes.push(node)
  addMarker(node)
  _cb.updateUI()

  await _cb.initializeNavigation()
}

/**
 * Available category choices shown in the special-place prompt.
 * `'classroom'` and `'bathroom'` are intentionally excluded: classrooms are
 * added via the regular room mode, and bathrooms have their own dedicated mode
 * with a type-aware marker.
 */
const SPECIAL_CATEGORIES: RoomCategory[] = [
  'cafeteria',
  'gymnasium',
  'library',
  'auditorium',
  'entrance',
  'office',
  'lab',
  'other',
]

/**
 * Prompt for a place name and category, then place a named `room` node with a
 * `category` field set (e.g. `'gymnasium'`, `'library'`). This allows rooms to
 * appear in category-filtered searches.
 */
async function handleSpecialPlaceClick(e: L.LeafletMouseEvent): Promise<void> {
  const name = prompt('Enter place name (e.g. "Gym", "Library", "Cafeteria"):')
  if (!name || name.trim() === '') return

  const categoryList = SPECIAL_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')
  const choice = prompt(`Select category:\n${categoryList}\n\nEnter number (1–${SPECIAL_CATEGORIES.length}):`)
  if (!choice) return

  const idx = parseInt(choice, 10) - 1
  const category: RoomCategory = (idx >= 0 && idx < SPECIAL_CATEGORIES.length)
    ? SPECIAL_CATEGORIES[idx]
    : 'other'

  const node: Node = {
    uid: crypto.randomUUID(),
    rooms: [name.trim()],
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    type: 'room',
    floor: state.currentFloor,
    category,
  }

  state.collectedNodes.push(node)
  addMarker(node)
  _cb.updateUI()

  graphLogger.log(`Special place added: "${name.trim()}" (${category}) on Floor ${state.currentFloor}`)
  await _cb.initializeNavigation()
}

// ========== TRAFFIC ZONE DRAWING ==========

/**
 * Map an intensity value (1.0–10.0) to a colour that transitions
 * amber (low) → orange (medium) → red (high).
 */
function intensityToColor(intensity: number): string {
  const t = Math.max(0, Math.min(1, (intensity - 1) / 9)) // normalise to [0, 1]
  if (t < 0.5) {
    // amber → orange
    return t < 0.25 ? '#f0a500' : '#ff6600'
  }
  // orange → red
  return '#e53935'
}

/**
 * Build and bind the popup content for a traffic zone rect.
 *
 * Extracted so it can be called both on first creation (`drawTrafficZoneRect`)
 * and again after the user edits the intensity value, so the popup label and
 * rect colour are always in sync with `zone.intensity`.
 *
 * The popup contains:
 *   - A coloured label showing the current intensity multiplier.
 *   - An "Edit Intensity" button (prompts for a new value, clamps to [1.0, 10.0],
 *     then re-calls `bindTrafficZonePopup` to refresh the popup).
 *   - A "Delete" button (delegates to `deleteTrafficZone`).
 */
function bindTrafficZonePopup(rect: L.Rectangle, zone: TrafficZone): void {
  const color = intensityToColor(zone.intensity)

  const container = document.createElement('div')
  const label = document.createElement('b')
  label.style.color = color
  label.textContent = `Traffic Zone — intensity ${zone.intensity.toFixed(1)}x`
  container.appendChild(label)
  container.appendChild(document.createElement('br'))

  const editBtn = document.createElement('button')
  editBtn.textContent = 'Edit Intensity'
  editBtn.style.cssText =
    'background: #1976d2; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px; margin-top: 5px; margin-right: 4px; font-size: 12px;'

  L.DomEvent.on(editBtn, 'click', ev => {
    L.DomEvent.stopPropagation(ev)
    L.DomEvent.preventDefault(ev)
    rect.closePopup()

    const input = prompt(
      `Current intensity: ${zone.intensity.toFixed(1)}x\n\nEnter new intensity (1.0 – 10.0):`,
      zone.intensity.toFixed(1)
    )
    if (!input) return

    const parsed = parseFloat(input.trim())
    if (isNaN(parsed)) return

    zone.intensity = Math.max(1.0, Math.min(10.0, parsed))

    const newColor = intensityToColor(zone.intensity)
    rect.setStyle({ color: newColor, fillColor: newColor })
    bindTrafficZonePopup(rect, zone)

    _cb.updateUI()
    _cb.showStatusMessage(
      `Intensity updated to ${zone.intensity.toFixed(1)}x. Save data to apply.`,
      'info'
    )
  })

  const deleteBtn = document.createElement('button')
  deleteBtn.textContent = 'Delete'
  deleteBtn.style.cssText =
    'background: #ff4444; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px; margin-top: 5px; font-size: 12px;'

  L.DomEvent.on(deleteBtn, 'click', ev => {
    L.DomEvent.stopPropagation(ev)
    L.DomEvent.preventDefault(ev)
    deleteTrafficZone(zone.uid, rect)
  })

  container.appendChild(editBtn)
  container.appendChild(deleteBtn)
  rect.unbindPopup()
  rect.bindPopup(container)
}

/**
 * Draw a traffic zone rectangle on the map and bind a popup with edit/delete buttons.
 * Only visible in debug mode.
 */
export function drawTrafficZoneRect(zone: TrafficZone): L.Rectangle {
  if (!state.map) throw new Error('Map not initialised')

  const { minLat, minLng, maxLat, maxLng } = zone.bounds
  const color = intensityToColor(zone.intensity)

  const rect = L.rectangle(
    [[minLat, minLng], [maxLat, maxLng]],
    {
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: state.isDebugMode ? 0.25 : 0,
      opacity: state.isDebugMode ? 1 : 0,
    } as L.PathOptions
  ).addTo(state.map)

  bindTrafficZonePopup(rect, zone)

  state.trafficZoneRects.push(rect)
  return rect
}

/**
 * Remove a traffic zone rect from the map, from `state.trafficZoneRects`, and
 * from `state.trafficZones`. Prompts for confirmation before deleting.
 */
function deleteTrafficZone(uid: string, rect: L.Rectangle): void {
  if (!confirm('Delete this traffic zone?')) return

  state.map?.removeLayer(rect)
  const rectIdx = state.trafficZoneRects.indexOf(rect)
  if (rectIdx !== -1) state.trafficZoneRects.splice(rectIdx, 1)
  state.trafficZones = state.trafficZones.filter(z => z.uid !== uid)
  _cb.updateUI()
}

/**
 * Two-click state machine for drawing a traffic zone rectangle.
 *
 * First click: records `state.trafficZoneFirstCorner` and prompts the user.
 * Second click: completes the bounding box, prompts for intensity, creates the
 * `TrafficZone` object, draws the rect, and resets `trafficZoneFirstCorner`.
 *
 * Resetting on mode switch (in `setMode`) ensures a stale first corner can
 * never leak into a subsequent zone-draw session.
 */
function handleTrafficZoneClick(e: L.LeafletMouseEvent): void {
  if (!state.trafficZoneFirstCorner) {
    state.trafficZoneFirstCorner = { lat: e.latlng.lat, lng: e.latlng.lng }
    _cb.showStatusMessage('First corner set. Click a second point to complete the zone.', 'info')
    return
  }

  const corner1 = state.trafficZoneFirstCorner
  const corner2 = { lat: e.latlng.lat, lng: e.latlng.lng }
  state.trafficZoneFirstCorner = null

  const intensityInput = prompt(
    'Enter traffic intensity (1.0 = no penalty, 10.0 = heavily avoided):\nExample: 2.5'
  )
  if (!intensityInput) return

  const parsed = parseFloat(intensityInput.trim())
  const intensity = isNaN(parsed) ? 1.0 : Math.max(1.0, Math.min(10.0, parsed))

  const zone: TrafficZone = {
    uid: crypto.randomUUID(),
    floor: state.currentFloor,
    bounds: {
      minLat: Math.min(corner1.lat, corner2.lat),
      minLng: Math.min(corner1.lng, corner2.lng),
      maxLat: Math.max(corner1.lat, corner2.lat),
      maxLng: Math.max(corner1.lng, corner2.lng),
    },
    intensity,
  }

  state.trafficZones.push(zone)
  drawTrafficZoneRect(zone)
  _cb.updateUI()
  _cb.showStatusMessage(
    `Traffic zone (${intensity.toFixed(1)}x) added. Save data to apply to routing.`,
    'info'
  )
}

/**
 * Two-click state machine for manually connecting two stairway nodes.
 *
 * First click: validates that a stairway node was clicked, stores it in
 * `state.firstStairwayForConnection`, and highlights its marker.
 * Second click: validates the second node, guards against same-node and
 * same-floor connections (with confirmation), then calls `connectStairways`.
 * State is reset via `resetStairwayConnection` after each completed or
 * cancelled flow.
 *
 * Note: name-based stairways added via `handleStairwayNodeClick` connect
 * automatically and rarely need this manual flow.
 */
function handleStairwayConnectionClick(e: L.LeafletMouseEvent): void {

  const clickedNode = findNodeAtLocation(e.latlng.lat, e.latlng.lng)
  graphLogger.log('Found node:', clickedNode)

  if (!clickedNode || clickedNode.type !== 'stairway') {
    _cb.showStatusMessage(
      "Please click on a stairway node to connect. Add stairways first using 'Add Stairway' mode.",
      'warning'
    )
    return
  }

  if (!state.firstStairwayForConnection) {
    state.firstStairwayForConnection = clickedNode

    const marker = state.nodeMarkers[clickedNode.uid]
    if (marker && state.map) {
      marker.setIcon(
        L.divIcon({
          className: 'stairway-marker-selected',
          html: '<div style="background: #FFD700; color: #000; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 3px solid #FF4500; box-shadow: 0 0 12px rgba(255,69,0,0.8); animation: pulse 1s infinite;">🪜</div>',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })
      )
    }

    graphLogger.log(`First stairway selected: ${clickedNode.rooms[0]} on Floor ${clickedNode.floor}`)
    _cb.showStatusMessage(
      `Selected: ${clickedNode.rooms[0]} (Floor ${clickedNode.floor}) — now click a second stairway to connect.`,
      'info'
    )
    return
  }

  const secondStairway = clickedNode

  if (state.firstStairwayForConnection.uid === secondStairway.uid) {
    _cb.showStatusMessage('Cannot connect a stairway to itself. Please select a different stairway.', 'warning')
    return
  }

  if (state.firstStairwayForConnection.floor === secondStairway.floor) {
    const confirmSameFloor = confirm(
      `Warning: Both stairways are on Floor ${state.firstStairwayForConnection.floor}.\n\n` +
      `Stairway connections are typically used for cross-floor navigation.\n\n` +
      `Do you still want to connect them?`
    )
    if (!confirmSameFloor) {
      resetStairwayConnection()
      return
    }
  }

  void connectStairways(state.firstStairwayForConnection, secondStairway)

  const firstName = state.firstStairwayForConnection.rooms[0]
  const firstFloor = state.firstStairwayForConnection.floor
  resetStairwayConnection()

  graphLogger.log(`Connected: ${firstName} (Floor ${firstFloor}) <-> ${secondStairway.rooms[0]} (Floor ${secondStairway.floor})`)
  _cb.showStatusMessage(
    `Stairways connected: ${firstName} (Floor ${firstFloor}) <-> ${secondStairway.rooms[0]} (Floor ${secondStairway.floor}). Don't forget to save!`,
    'info'
  )
}

/**
 * Find the node closest to `(lat, lng)` within `tolerance` coordinate units.
 *
 * `tolerance` defaults to 20, which corresponds to ~20 px at native image
 * resolution in Leaflet Simple CRS — a comfortable click target without
 * accidentally hitting distant nodes.
 *
 * @returns The nearest node within tolerance, or `null` if none.
 */
function findNodeAtLocation(lat: number, lng: number, tolerance: number = 20): Node | null {
  for (const node of state.collectedNodes) {
    const dist = Math.sqrt(Math.pow(node.lat - lat, 2) + Math.pow(node.lng - lng, 2))
    if (dist < tolerance) return node
  }
  return null
}

/**
 * Bidirectionally link two stairway nodes by appending each other's room name
 * to their `connectsTo` arrays, then rebuild the navigation graph.
 *
 * Uses room-name references (not UIDs) so that `addStairwayConnections` in
 * graph.ts can resolve them by name lookup across floors.
 */
async function connectStairways(stairway1: Node, stairway2: Node): Promise<void> {
  if (!stairway1.connectsTo) stairway1.connectsTo = []
  if (!stairway2.connectsTo) stairway2.connectsTo = []

  const name1 = stairway1.rooms[0]
  const name2 = stairway2.rooms[0]

  if (!stairway1.connectsTo.includes(name2)) stairway1.connectsTo.push(name2)
  if (!stairway2.connectsTo.includes(name1)) stairway2.connectsTo.push(name1)

  updateMarker(stairway1)
  updateMarker(stairway2)

  await _cb.initializeNavigation()

  _cb.updateUI()
}

/**
 * Cancel the in-progress stairway-connection flow: restore the first node's
 * marker to its normal icon and clear `state.firstStairwayForConnection`.
 */
function resetStairwayConnection(): void {
  if (state.firstStairwayForConnection) {
    updateMarker(state.firstStairwayForConnection)
    state.firstStairwayForConnection = null
  }
}

// ========== MARKER MANAGEMENT ==========

/**
 * Replace the existing Leaflet marker for `node` with a freshly created one.
 * Used after stairway-connection edits to update the popup connection count.
 */
function updateMarker(node: Node): void {
  if (state.nodeMarkers[node.uid]) {
    state.map?.removeLayer(state.nodeMarkers[node.uid])
    delete state.nodeMarkers[node.uid]
  }
  addMarker(node)
}

/**
 * Add a Leaflet marker for the given node.
 *
 * Marker visibility and icon depend on `state.isDebugMode`:
 *   - User mode: zero-size invisible marker (preserves click-to-popup for admin
 *     use, but is hidden from regular users).
 *   - Debug mode: type-specific icon (bathroom = cyan, stairway = purple,
 *     waypoint = small orange dot, room = default blue).
 *
 * The popup always contains a "Delete" button that calls `deleteNode`.
 * In user mode the popup is immediately closed on click to keep the UI clean.
 *
 * @param node The node to place on the map.
 */
export function addMarker(node: Node): void {
  if (!state.map) return

  const isBathroom = node.type === 'bathroom'
  const isStairway = node.type === 'stairway'
  const isWaypoint = node.type === 'waypoint' || node.rooms.includes('waypoint')

  const container = document.createElement('div')

  if (isBathroom) {
    const title = document.createElement('b')
    title.style.color = '#00BCD4'
    title.textContent = `🚻 ${node.rooms.join(', ')}`
    container.appendChild(title)
    container.appendChild(document.createElement('br'))
    if (node.floor) {
      const floor = document.createElement('small')
      floor.textContent = `Floor ${node.floor}`
      container.appendChild(floor)
      container.appendChild(document.createElement('br'))
    }
  } else if (isStairway) {
    const connections = node.connectsTo?.length ?? 0
    const title = document.createElement('b')
    title.style.color = '#9C27B0'
    title.textContent = `🪜 ${node.rooms.join(', ')}`
    container.appendChild(title)
    container.appendChild(document.createElement('br'))
    const info = document.createElement('small')
    info.textContent = `Floor ${node.floor ?? '?'} • Connects to ${connections} floor(s)`
    container.appendChild(info)
    container.appendChild(document.createElement('br'))
  } else if (isWaypoint) {
    const title = document.createElement('b')
    title.style.color = '#FF9800'
    title.textContent = '⚡ Waypoint'
    container.appendChild(title)
    container.appendChild(document.createElement('br'))
  } else {
    const title = document.createElement('b')
    title.textContent = node.rooms.join(', ')
    container.appendChild(title)
    container.appendChild(document.createElement('br'))
  }

  const deleteBtn = document.createElement('button')
  deleteBtn.textContent = 'Delete'
  deleteBtn.style.cssText =
    'background: #ff4444; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px; margin-top: 5px; font-size: 12px;'

  L.DomEvent.on(deleteBtn, 'click', e => {
    L.DomEvent.stopPropagation(e)
    L.DomEvent.preventDefault(e)
    void deleteNode(node.uid)
  })

  container.appendChild(deleteBtn)

  const markerOptions: L.MarkerOptions = {}

  if (!state.isDebugMode) {
    markerOptions.opacity = 0
    markerOptions.icon = L.divIcon({ className: 'hidden-marker', html: '', iconSize: [0, 0] })
  } else if (isBathroom) {
    markerOptions.icon = L.divIcon({
      className: 'bathroom-marker',
      html: '<div style="background: #00BCD4; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4);">🚻</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
  } else if (isStairway) {
    markerOptions.icon = L.divIcon({
      className: 'stairway-marker',
      html: '<div style="background: #9C27B0; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4);">🪜</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
  } else if (isWaypoint) {
    markerOptions.icon = L.divIcon({
      className: 'waypoint-marker',
      html: '<div style="background: #FF9800; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    })
  }

  const marker = L.marker([node.lat, node.lng], markerOptions)
    .addTo(state.map)
    .bindPopup(container)

  marker.on('click', () => {
    if (!state.isDebugMode) marker.closePopup()
  })

  state.nodeMarkers[node.uid] = marker

  if (state.isDebugMode) {
    marker.openPopup()
  }
}

/**
 * Remove a node from the map and from `state.collectedNodes`, then rebuild the
 * navigation graph. Prompts for confirmation before deleting.
 *
 * WARNING: only `state.collectedNodes` (current floor) is updated.
 * `state.allNodesAllFloors` is NOT mutated here — it is refreshed on the next
 * `loadData` / `loadAllNodesAllFloors` call triggered by `initializeNavigation`.
 * Any code that reads `state.allNodesAllFloors` immediately after `deleteNode`
 * may still see the old entry until that refresh completes.
 */
async function deleteNode(uid: string): Promise<void> {
  if (!confirm('Delete node?')) return

  if (state.nodeMarkers[uid]) {
    state.map?.removeLayer(state.nodeMarkers[uid])
    delete state.nodeMarkers[uid]
  }
  state.collectedNodes = state.collectedNodes.filter(n => n.uid !== uid)
  _cb.updateUI()

  await _cb.initializeNavigation()
}

// ========== WALL DRAWING ==========

/**
 * Render an existing wall as a Leaflet polyline and register a click handler
 * that offers to delete it when in debug mode.
 *
 * INVARIANT: `state.wallPolylines` and `state.collectedWalls` are always kept
 * in the same insertion order so that `deleteWall` can splice both arrays at
 * the same index. Never insert into one without inserting into the other.
 *
 * @param wallPts Array of `[lat, lng]` pairs representing the wall vertices.
 * @returns The created `L.Polyline` instance (also pushed onto `state.wallPolylines`).
 */
export function addWallPolyline(wallPts: number[][]): L.Polyline {
  if (!state.map) throw new Error('Map not initialised')

  const polyline = L.polyline(wallPts as [number, number][], {
    color: 'red',
    weight: 4,
    opacity: state.isDebugMode ? 1 : 0,
  }).addTo(state.map)

  polyline.on('click', e => {
    if (!state.isDebugMode) return
    L.DomEvent.stopPropagation(e)
    if (confirm('Delete this wall segment?')) {
      deleteWall(polyline)
    }
  })

  state.wallPolylines.push(polyline)
  return polyline
}

/**
 * Remove a wall polyline from the map and keep `state.wallPolylines` and
 * `state.collectedWalls` in sync by splicing both at the same index.
 */
function deleteWall(polyline: L.Polyline): void {
  const idx = state.wallPolylines.indexOf(polyline)
  if (idx !== -1) {
    state.map?.removeLayer(polyline)
    // INVARIANT: state.wallPolylines and state.collectedWalls are always kept
    // in sync (same length, same insertion order) so that splice(idx, 1) on
    // both arrays removes the matching pair.  Never insert into one without
    // inserting into the other — see addWallPolyline() and finishCurrentWall().
    state.wallPolylines.splice(idx, 1)
    state.collectedWalls.splice(idx, 1)
    _cb.updateUI()
  }
}

/**
 * Accumulate wall vertices on each click; creates a new in-progress polyline
 * on the first click of a sequence and extends it on subsequent clicks.
 * Call `finishCurrentWall` (or double-click) to commit.
 */
function handleWallClick(e: L.LeafletMouseEvent): void {
  if (!state.map) return

  const point: [number, number] = [e.latlng.lat, e.latlng.lng]

  if (!state.currentWallPolyline) {
    state.currentWallPolyline = L.polyline([point], { color: 'red', weight: 4 }).addTo(state.map)
  } else {
    state.currentWallPolyline.addLatLng(point)
  }
}

/**
 * Commit the in-progress wall polyline to permanent storage.
 *
 * If the accumulated polyline has ≥ 2 vertices, converts it to a plain
 * `[lat, lng][]` array, pushes it onto `state.collectedWalls`, removes the
 * temporary in-progress layer, and re-adds it via `addWallPolyline` (which
 * registers the click-to-delete handler and maintains the
 * `wallPolylines`/`collectedWalls` INVARIANT).
 *
 * Single-vertex walls are silently discarded (removes the temporary polyline
 * without recording anything).
 *
 * Called automatically on double-click and on mode switch (`setMode`).
 */
export function finishCurrentWall(): void {
  if (!state.currentWallPolyline) return

  const latlngs = state.currentWallPolyline.getLatLngs() as L.LatLng[]
  if (latlngs.length > 1) {
    const wallPoints = latlngs.map(ll => [ll.lat, ll.lng])
    state.collectedWalls.push(wallPoints)
    state.map?.removeLayer(state.currentWallPolyline)
    addWallPolyline(wallPoints)
  } else {
    state.map?.removeLayer(state.currentWallPolyline)
  }

  state.currentWallPolyline = null
  _cb.updateUI()
}

// ========== GRAPH OVERLAY ==========

/**
 * Toggle the debug graph-edge overlay for the current floor.
 *
 * When turning ON: builds the visibility graph from current state and draws
 * each unique edge as a dashed green polyline. Edges are deduplicated by
 * canonical key (`minUid:maxUid`) so bidirectional entries appear only once.
 *
 * When turning OFF: removes all edge polylines and clears `state.graphEdges`.
 */
export function toggleGraphVisualization(): void {
  if (!state.map) return

  const toggleGraphBtn = document.getElementById('toggle-graph')

  if (state.showingGraph) {
    for (const edge of state.graphEdges) {
      state.map!.removeLayer(edge)
    }
    state.graphEdges = []
    state.showingGraph = false
    if (toggleGraphBtn) toggleGraphBtn.textContent = 'Show Graph'
  } else {
    const graph = buildVisibilityGraph(
      state.allNodesAllFloors,
      state.wallObjects,
      MAP_CONFIG.MAX_HALLWAY_DISTANCE,
      state.trafficZones,
    )

    const drawn = new Set<string>()

    for (const [fromUid, edges] of graph) {
      const fromNode = state.allNodesAllFloors.find((n) => n.uid === fromUid)
      if (!fromNode || fromNode.floor !== state.currentFloor) continue

      for (const edge of edges) {
        const toNode = state.allNodesAllFloors.find((n) => n.uid === edge.to)
        if (!toNode || toNode.floor !== state.currentFloor) continue

        const key =
          fromUid < edge.to ? `${fromUid}:${edge.to}` : `${edge.to}:${fromUid}`
        if (drawn.has(key)) continue
        drawn.add(key)

        const polyline = L.polyline(
          [
            [fromNode.lat, fromNode.lng],
            [toNode.lat, toNode.lng],
          ],
          { color: '#00ff00', weight: 2, opacity: 0.4, dashArray: '5, 5' },
        ).addTo(state.map!)

        state.graphEdges.push(polyline)
      }
    }

    graphLogger.log('Graph overlay drawn', {
      edgeCount: state.graphEdges.length,
      floor: state.currentFloor,
    })

    state.showingGraph = true
    if (toggleGraphBtn) toggleGraphBtn.textContent = 'Hide Graph'
  }
}

// ========== MODE SWITCHING ==========

/**
 * Switch the active edit mode and update button highlight states.
 *
 * Side effects:
 *   - Calls `finishCurrentWall()` to commit any in-progress wall segment.
 *   - Calls `resetStairwayConnection()` when leaving `connect-stairway` mode.
 *   - Clears `state.trafficZoneFirstCorner` when leaving `traffic-zone` mode.
 *
 * @param mode One of: `'room'`, `'waypoint'`, `'bathroom'`, `'stairway'`,
 *   `'connect-stairway'`, `'wall'`, `'special'`, `'traffic-zone'`.
 */
export function setMode(mode: string): void {
  graphLogger.log(`Setting mode to: ${mode}`)
  state.currentMode = mode
  finishCurrentWall()

  if (mode !== 'connect-stairway') {
    resetStairwayConnection()
  }

  if (mode !== 'traffic-zone') {
    state.trafficZoneFirstCorner = null
  }

  const modeRoomBtn = document.getElementById('mode-room')
  const modeWaypointBtn = document.getElementById('mode-waypoint')
  const modeBathroomBtn = document.getElementById('mode-bathroom')
  const modeStairwayBtn = document.getElementById('mode-stairway')
  const modeConnectStairwayBtn = document.getElementById('mode-connect-stairway')
  const modeWallBtn = document.getElementById('mode-wall')
  const modeSpecialBtn = document.getElementById('mode-special')
  const modeTrafficZoneBtn = document.getElementById('mode-traffic-zone')

  if (modeRoomBtn) modeRoomBtn.style.backgroundColor = mode === 'room' ? '#2196F3' : '#ddd'
  if (modeWaypointBtn) modeWaypointBtn.style.backgroundColor = mode === 'waypoint' ? '#FF9800' : '#ddd'
  if (modeBathroomBtn) modeBathroomBtn.style.backgroundColor = mode === 'bathroom' ? '#00BCD4' : '#ddd'
  if (modeStairwayBtn) modeStairwayBtn.style.backgroundColor = mode === 'stairway' ? '#9C27B0' : '#ddd'
  if (modeConnectStairwayBtn) modeConnectStairwayBtn.style.backgroundColor = mode === 'connect-stairway' ? '#FFD700' : '#ddd'
  if (modeWallBtn) modeWallBtn.style.backgroundColor = mode === 'wall' ? '#f44336' : '#ddd'
  if (modeSpecialBtn) modeSpecialBtn.style.backgroundColor = mode === 'special' ? '#4CAF50' : '#ddd'
  if (modeTrafficZoneBtn) modeTrafficZoneBtn.style.backgroundColor = mode === 'traffic-zone' ? '#e53935' : '#ddd'

  graphLogger.log(`Mode set. Current mode is now: ${state.currentMode}`)
}

// ========== DEBUG MODE TOGGLE ==========

/**
 * Wire up the "Enable Debug Mode" toggle button.
 * Called once during setup in Map.astro.
 *
 * Entering debug mode:
 *   - Sets `state.isDebugMode = true` and activates `'room'` edit mode.
 *   - Makes all node markers visible with type-specific icons. Existing markers
 *     already in `state.nodeMarkers` have their icon swapped in-place; nodes
 *     that have no marker yet (e.g. loaded before first debug enable) get a new
 *     one via `addMarker`.
 *   - Makes wall polylines visible.
 *   - Draws traffic zone rectangles. Zones loaded before debug mode was on have
 *     no rect yet; `state.trafficZoneRects` and `state.trafficZones` are kept in
 *     the same insertion order, so any zone beyond the current rect count is
 *     newly drawn via `drawTrafficZoneRect`.
 *
 * Leaving debug mode:
 *   - Hides all markers, walls, and traffic-zone rectangles.
 *   - Turns off the graph overlay if it is active.
 */
export function setupDebugToggle(): void {
  const toggleBtn = document.getElementById('toggle-debug')
  const controlsDiv = document.getElementById('debug-controls')
  if (!toggleBtn || !controlsDiv) return

  toggleBtn.addEventListener('click', () => {
    state.isDebugMode = !state.isDebugMode
    toggleBtn.textContent = state.isDebugMode ? 'Disable Debug Mode' : 'Enable Debug Mode'
    ;(toggleBtn as HTMLElement).style.backgroundColor = state.isDebugMode ? '#ff4444' : '#4CAF50'
    controlsDiv.style.display = state.isDebugMode ? 'flex' : 'none'

    if (state.isDebugMode) {
      setMode('room')

      state.collectedNodes.forEach(node => {
        if (!state.nodeMarkers[node.uid]) {
          addMarker(node)
        } else {
          const marker = state.nodeMarkers[node.uid]
          const isBathroom = node.type === 'bathroom'
          const isStairway = node.type === 'stairway'
          const isWaypoint = node.type === 'waypoint' || node.rooms.includes('waypoint')

          if (isBathroom) {
            marker.setIcon(L.divIcon({
              className: 'bathroom-marker',
              html: '<div style="background: #00BCD4; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4);">🚻</div>',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }))
          } else if (isStairway) {
            marker.setIcon(L.divIcon({
              className: 'stairway-marker',
              html: '<div style="background: #9C27B0; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4);">🪜</div>',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }))
          } else if (isWaypoint) {
            marker.setIcon(L.divIcon({
              className: 'waypoint-marker',
              html: '<div style="background: #FF9800; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>',
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            }))
          } else {
            marker.setIcon(L.divIcon({
              className: 'room-marker',
              html: '<div style="background: #2196F3; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>',
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            }))
          }
          marker.setOpacity(1)
        }
      })

      for (const polyline of state.wallPolylines) {
        polyline.setStyle({ opacity: 1 })
      }

      // Show traffic zone rectangles when entering debug mode.
      // Zones loaded before debug mode was on have no rect yet — draw them now.
      // state.trafficZoneRects is kept in the same insertion order as state.trafficZones
      // so any zone beyond the current rect count has not been drawn yet.
      for (let i = 0; i < state.trafficZones.length; i++) {
        if (i < state.trafficZoneRects.length) {
          state.trafficZoneRects[i].setStyle({ opacity: 1, fillOpacity: 0.25 })
        } else {
          drawTrafficZoneRect(state.trafficZones[i])
        }
      }

      state.collectedWalls.forEach(wallPts => {
        const exists = state.wallPolylines.some(poly => {
          const latlngs = poly.getLatLngs() as L.LatLng[]
          if (latlngs.length !== wallPts.length) return false
          return latlngs.every(
            (ll, idx) => ll.lat === wallPts[idx][0] && ll.lng === wallPts[idx][1]
          )
        })
        if (!exists) addWallPolyline(wallPts)
      })
    } else {
      finishCurrentWall()

      Object.values(state.nodeMarkers).forEach((marker: L.Marker) => {
        marker.closePopup()
        marker.setIcon(L.divIcon({ className: 'hidden-marker', html: '', iconSize: [0, 0] }))
      })

      for (const polyline of state.wallPolylines) {
        polyline.setStyle({ opacity: 0 })
      }

      // Hide traffic zone rectangles when leaving debug mode
      for (const rect of state.trafficZoneRects) {
        rect.setStyle({ opacity: 0, fillOpacity: 0 })
      }

      if (state.showingGraph) {
        _cb.toggleGraphVisualization()
      }
    }
  })
}
