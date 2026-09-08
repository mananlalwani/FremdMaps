// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import L from 'leaflet'
import { createActiveRoute, type ActiveRoute } from './activeRoute'
import { state } from '../map/map-state'
import type { Node } from '../utils/types'

function node(uid: string, room: string, lng: number, floor = '2'): Node {
  return { uid, rooms: [room], lat: -100, lng, floor, type: 'room' }
}

let activeRoute: ActiveRoute
let switchFloor: (floorId: string) => void

beforeEach(() => {
  document.body.innerHTML = `
    <div id="map" style="height: 600px"></div>
    <div id="route-status" style="display: none"><span id="route-status-details"></span></div>
    <ol id="directions-list"></ol>
    <input id="start-input"><input id="end-input">
    <div id="multi-floor-banner" style="display: none"><span id="banner-floor"></span><button id="banner-switch-btn"></button></div>
  `
  state.currentFloor = '2'
  state.map = L.map(document.getElementById('map')!)
  state.map.setView([-100, 100], 0)
  switchFloor = vi.fn()
  activeRoute = createActiveRoute({ switchFloor, getWalls: () => [] })
})

afterEach(() => {
  activeRoute.dispose()
  state.map?.remove()
  state.map = null
  document.body.innerHTML = ''
})

describe('active route', () => {
  it('shows a route and its directions through one interface', () => {
    const path = [node('a', 'Room 201', 0), node('b', 'Room 202', 100)]

    activeRoute.show({ path, cost: 100, origin: path[0], destination: path[1], revision: 1 })

    expect(document.querySelectorAll('.direction-step')).toHaveLength(3)
    expect(document.getElementById('route-status')?.style.display).toBe('block')
    expect(document.getElementById('directions-list')?.textContent).toContain('Arrive at')
  })

  it('clears every visible part of the route', () => {
    const path = [node('a', 'Room 201', 0), node('b', 'Room 202', 100)]
    activeRoute.show({ path, cost: 100, origin: path[0], destination: path[1], revision: 1 })

    activeRoute.clear()

    expect(document.getElementById('directions-list')?.children).toHaveLength(0)
    expect(document.getElementById('route-status')?.classList).toContain('hiding')
  })

  it('reprojects a multi-floor route after a floor change', () => {
    const path = [node('a', 'Room 101', 0, '1'), node('b', 'Room 201', 100, '2')]
    activeRoute.show({ path, cost: 100, origin: path[0], destination: path[1], revision: 1 })
    state.currentFloor = '1'

    activeRoute.floorChanged()

    expect(document.querySelector('.direction-step.active')?.textContent).toContain('Room 101')
  })

  it('keeps each instance bound to its own floor-switch dependency', () => {
    const secondSwitchFloor = vi.fn()
    const secondRoute = createActiveRoute({ switchFloor: secondSwitchFloor, getWalls: () => [] })
    const path = [node('a', 'Room 101', 0, '1'), node('b', 'Room 102', 100, '1')]

    activeRoute.show({ path, cost: 100, origin: path[0], destination: path[1], revision: 1 })

    expect(switchFloor).toHaveBeenCalledWith('1')
    expect(secondSwitchFloor).not.toHaveBeenCalled()
    secondRoute.dispose()
  })
})
