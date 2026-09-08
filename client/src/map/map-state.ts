/** Mutable state that belongs to the Leaflet map and navigation-panel controls. */

import type L from 'leaflet'
import type { Node, TrafficZone } from '../utils/types'

export interface MapState {
  currentFloor: string
  loadedFloorImages: Set<string>
  collectedNodes: Node[]
  collectedWalls: number[][][]
  map: L.Map | null
  currentImageOverlay: L.ImageOverlay | null
  selectedStartNode: Node | null
  selectedEndNode: Node | null
  trafficZones: TrafficZone[]
  trafficZoneRects: L.Rectangle[]
}

export const state: MapState = {
  currentFloor: '',
  loadedFloorImages: new Set(),
  collectedNodes: [],
  collectedWalls: [],
  map: null,
  currentImageOverlay: null,
  selectedStartNode: null,
  selectedEndNode: null,
  trafficZones: [],
  trafficZoneRects: [],
}
