/**
 * Tests for map-state module.
 * Verifies the shared mutable state object initialises with correct defaults
 * and that mutations propagate correctly.
 */

import { describe, it, expect } from 'vitest'
import { state } from './map-state'

describe('map-state initial state', () => {
  it('starts with empty currentFloor', () => {
    expect(state.currentFloor).toBe('')
  })

  it('starts with empty loadedFloorImages set', () => {
    expect(state.loadedFloorImages.size).toBe(0)
  })

  it('starts with empty collectedNodes', () => {
    expect(state.collectedNodes).toEqual([])
  })

  it('starts with empty collectedWalls', () => {
    expect(state.collectedWalls).toEqual([])
  })

  it('starts with empty allNodesAllFloors', () => {
    expect(state.allNodesAllFloors).toEqual([])
  })

  it('starts with hasLoadedGlobalNavigationData false', () => {
    expect(state.hasLoadedGlobalNavigationData).toBe(false)
  })

  it('starts with null map', () => {
    expect(state.map).toBeNull()
  })

  it('starts with null currentImageOverlay', () => {
    expect(state.currentImageOverlay).toBeNull()
  })

  it('starts with empty wallObjects', () => {
    expect(state.wallObjects).toEqual([])
  })

  it('starts with null currentRoute', () => {
    expect(state.currentRoute).toBeNull()
  })

  it('starts with empty currentRouteFullPath', () => {
    expect(state.currentRouteFullPath).toEqual([])
  })

  it('starts with empty trafficZones', () => {
    expect(state.trafficZones).toEqual([])
  })

  it('starts with empty trafficZoneRects', () => {
    expect(state.trafficZoneRects).toEqual([])
  })

  it('starts with null activeDropdown', () => {
    expect(state.activeDropdown).toBeNull()
  })

  it('starts with null selectedStartNode', () => {
    expect(state.selectedStartNode).toBeNull()
  })

  it('starts with null selectedEndNode', () => {
    expect(state.selectedEndNode).toBeNull()
  })
})

describe('map-state mutations', () => {
  it('propagates string mutations', () => {
    state.currentFloor = '2'
    expect(state.currentFloor).toBe('2')
    state.currentFloor = '1'
    expect(state.currentFloor).toBe('1')
  })

  it('propagates boolean mutations', () => {
    state.hasLoadedGlobalNavigationData = true
    expect(state.hasLoadedGlobalNavigationData).toBe(true)
    state.hasLoadedGlobalNavigationData = false
    expect(state.hasLoadedGlobalNavigationData).toBe(false)
  })

  it('propagates array mutations by reference', () => {
    const nodes = [{ uid: 'a', lat: 0, lng: 0, rooms: ['R'], floor: '1' }]
    state.collectedNodes = nodes
    expect(state.collectedNodes).toBe(nodes)
    expect(state.collectedNodes).toHaveLength(1)
  })

  it('propagates null assignments', () => {
    state.map = {} as unknown as L.Map
    expect(state.map).not.toBeNull()
    state.map = null
    expect(state.map).toBeNull()
  })

  it('allows Set mutations', () => {
    state.loadedFloorImages.add('2')
    expect(state.loadedFloorImages.has('2')).toBe(true)
    state.loadedFloorImages.delete('2')
    expect(state.loadedFloorImages.has('2')).toBe(false)
  })

  it('allows multiple independent fields to be mutated', () => {
    state.currentFloor = '3'
    state.hasLoadedGlobalNavigationData = true
    state.collectedNodes = [{ uid: 'x', lat: 0, lng: 0, rooms: ['X'], floor: '3' }]
    expect(state.currentFloor).toBe('3')
    expect(state.hasLoadedGlobalNavigationData).toBe(true)
    expect(state.collectedNodes).toHaveLength(1)
  })
})
