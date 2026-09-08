import { describe, expect, it } from 'vitest'
import { state } from './map-state'

describe('map state', () => {
  it('starts without Leaflet or selected-place state', () => {
    expect(state.map).toBeNull()
    expect(state.currentImageOverlay).toBeNull()
    expect(state.selectedStartNode).toBeNull()
    expect(state.selectedEndNode).toBeNull()
  })

  it('keeps only the visible floor projection', () => {
    expect(state.collectedNodes).toEqual([])
    expect(state.collectedWalls).toEqual([])
    expect(state.trafficZones).toEqual([])
  })
})
