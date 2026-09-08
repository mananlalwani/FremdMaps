// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { cancelPendingDataLoad, clearMapData } from './map-init'
import { state } from './map-state'

beforeEach(() => {
  state.map = null
  state.trafficZoneRects = []
  state.trafficZones = []
})

describe('map lifecycle', () => {
  it('clears current-floor traffic-zone artifacts without a map', () => {
    state.trafficZones = [
      {
        uid: 'zone',
        floor: '2',
        bounds: { minLat: -10, minLng: 0, maxLat: 0, maxLng: 10 },
        intensity: 2,
      },
    ]

    clearMapData()

    expect(state.trafficZones).toEqual([])
    expect(state.trafficZoneRects).toEqual([])
  })

  it('can cancel teardown before initialization', () => {
    expect(() => cancelPendingDataLoad()).not.toThrow()
  })
})
