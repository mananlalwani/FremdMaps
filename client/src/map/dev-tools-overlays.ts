import L from 'leaflet'
import { state } from './map-state'
import type { Graph } from '../utils/types'

export interface DevOverlayControls {
  element: HTMLElement
  refresh(): void
  dispose(): void
}

interface RouteControls {
  clearRoute(): void
  redrawRouteForCurrentFloor(): void
}

interface GraphControls extends RouteControls {
  getGraph(): Graph | null
}

const NODE_COLORS: Record<string, string> = {
  room: '#4ade80',
  waypoint: '#6b7280',
  bathroom: '#60a5fa',
  stairway: '#a78bfa',
}

/** Create independent Leaflet overlay controls for the lazy-loaded developer menu. */
export function createDevOverlayControls(routeControls: GraphControls): DevOverlayControls {
  let zoneLayerGroup: L.LayerGroup | null = null
  let wallLayerGroup: L.LayerGroup | null = null
  let nodeLayerGroup: L.LayerGroup | null = null
  let graphLayerGroup: L.LayerGroup | null = null
  let zonesVisible = false
  let wallsVisible = false
  let nodesVisible = false
  let graphVisible = false

  const removeLayers = (layerGroup: L.LayerGroup | null): null => {
    if (layerGroup && state.map) state.map.removeLayer(layerGroup)
    return null
  }

  const renderZones = (): void => {
    if (!state.map) return
    zoneLayerGroup = removeLayers(zoneLayerGroup)
    zoneLayerGroup = L.layerGroup().addTo(state.map)
    for (const zone of state.allTrafficZones) {
      if (zone.floor !== state.currentFloor) continue
      const { minLat, minLng, maxLat, maxLng } = zone.bounds
      const rectangle = L.rectangle(
        [
          [minLat, minLng],
          [maxLat, maxLng],
        ],
        {
          color: '#60a5fa',
          weight: 2,
          fillOpacity: 0.12 + zone.intensity * 0.03,
          opacity: 0.5,
        }
      )
      rectangle.bindTooltip(`×${zone.intensity} congestion`, {
        direction: 'center',
        permanent: false,
      })
      zoneLayerGroup.addLayer(rectangle)
    }
  }

  const renderWalls = (): void => {
    if (!state.map) return
    wallLayerGroup = removeLayers(wallLayerGroup)
    wallLayerGroup = L.layerGroup().addTo(state.map)
    for (const wall of state.wallObjects) {
      if (wall.floor && wall.floor !== state.currentFloor) continue
      wallLayerGroup.addLayer(
        L.polyline(
          [
            [wall.start.lat, wall.start.lng],
            [wall.end.lat, wall.end.lng],
          ],
          { color: '#f87171', weight: 5, opacity: 0.55 }
        )
      )
    }
  }

  const renderNodes = (): void => {
    if (!state.map) return
    nodeLayerGroup = removeLayers(nodeLayerGroup)
    nodeLayerGroup = L.layerGroup().addTo(state.map)
    for (const node of state.collectedNodes) {
      const color = NODE_COLORS[node.type ?? 'room'] ?? NODE_COLORS.room
      const marker = L.circleMarker([node.lat, node.lng], {
        radius: node.type === 'waypoint' ? 2 : 4,
        color,
        fillColor: color,
        fillOpacity: 0.7,
        weight: 1,
      })
      marker.bindTooltip(
        `<b>${escapeHtml(node.rooms.join(', '))}</b><br>${node.type ?? 'room'} | ${node.lat.toFixed(1)}, ${node.lng.toFixed(1)}`,
        { direction: 'top', offset: [0, -4], permanent: false }
      )
      nodeLayerGroup.addLayer(marker)
    }
  }

  /** Draw same-floor graph edges as one multi-polyline to keep large graphs inspectable. */
  const renderGraph = (): void => {
    if (!state.map) return
    graphLayerGroup = removeLayers(graphLayerGroup)
    const graph = routeControls.getGraph()
    if (!graph?.size) return

    const nodes =
      state.allNodesAllFloors.length > 0 ? state.allNodesAllFloors : state.collectedNodes
    const nodesByUid = new Map(nodes.map((node) => [node.uid, node]))
    const edges: L.LatLngExpression[][] = []
    const seen = new Set<string>()

    for (const source of nodes) {
      if (source.floor !== state.currentFloor) continue
      for (const edge of graph.get(source.uid) ?? []) {
        const target = nodesByUid.get(edge.to)
        if (target?.floor !== state.currentFloor) continue
        const edgeKey = [source.uid, target.uid].sort().join(':')
        if (seen.has(edgeKey)) continue
        seen.add(edgeKey)
        edges.push([
          [source.lat, source.lng],
          [target.lat, target.lng],
        ])
      }
    }

    graphLayerGroup = L.layerGroup().addTo(state.map)
    if (edges.length > 0) {
      graphLayerGroup.addLayer(
        L.polyline(edges, {
          color: '#22d3ee',
          weight: 1,
          opacity: 0.38,
          interactive: false,
        })
      )
    }
  }

  const control = document.createElement('div')
  Object.assign(control.style, { display: 'flex', flexDirection: 'column', gap: '3px' })
  control.appendChild(
    toggle('Zones', false, (enabled) => {
      zonesVisible = enabled
      zoneLayerGroup = enabled ? zoneLayerGroup : removeLayers(zoneLayerGroup)
      if (enabled) renderZones()
    })
  )
  control.appendChild(
    toggle('Walls', false, (enabled) => {
      wallsVisible = enabled
      wallLayerGroup = enabled ? wallLayerGroup : removeLayers(wallLayerGroup)
      if (enabled) renderWalls()
    })
  )
  control.appendChild(
    toggle('Nodes', false, (enabled) => {
      nodesVisible = enabled
      nodeLayerGroup = enabled ? nodeLayerGroup : removeLayers(nodeLayerGroup)
      if (enabled) renderNodes()
    })
  )
  control.appendChild(
    toggle('Graph edges', false, (enabled) => {
      graphVisible = enabled
      graphLayerGroup = enabled ? graphLayerGroup : removeLayers(graphLayerGroup)
      if (enabled) renderGraph()
    })
  )
  control.appendChild(
    toggle('Route', state.currentRoute !== null, (enabled) => {
      if (enabled && state.currentRouteFullPath.length > 0)
        routeControls.redrawRouteForCurrentFloor()
      else routeControls.clearRoute()
    })
  )

  return {
    element: control,
    refresh(): void {
      if (zonesVisible) renderZones()
      if (wallsVisible) renderWalls()
      if (nodesVisible) renderNodes()
      if (graphVisible) renderGraph()
    },
    dispose(): void {
      zoneLayerGroup = removeLayers(zoneLayerGroup)
      wallLayerGroup = removeLayers(wallLayerGroup)
      nodeLayerGroup = removeLayers(nodeLayerGroup)
      graphLayerGroup = removeLayers(graphLayerGroup)
      zonesVisible = false
      wallsVisible = false
      nodesVisible = false
      graphVisible = false
    },
  }
}

function toggle(
  label: string,
  initial: boolean,
  onChange: (enabled: boolean) => void
): HTMLElement {
  const wrapper = document.createElement('label')
  Object.assign(wrapper.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
    fontSize: '11px',
  })
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = initial
  checkbox.style.accentColor = '#f0a500'
  checkbox.addEventListener('change', () => onChange(checkbox.checked))
  wrapper.append(checkbox, document.createTextNode(label))
  return wrapper
}

function escapeHtml(value: string): string {
  const element = document.createElement('div')
  element.textContent = value
  return element.innerHTML
}
