// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupRouteActions } from './route-actions'
import { state } from './map-state'
import type { ActiveRoute } from '../navigation/activeRoute'
import type { RoutePlanner } from '../navigation/routePlanner'

const plan = vi.fn<RoutePlanner['plan']>()
const planToNearestBathroom = vi.fn<RoutePlanner['planToNearestBathroom']>()
const planner: RoutePlanner = {
  getStatus: () => ({ state: 'ready', revision: 1 }),
  subscribe: () => () => undefined,
  search: () => [],
  findExact: () => [],
  getDestinations: () => [],
  plan,
  planToNearestBathroom,
  getDebugView: () => ({ revision: 1, stats: null, connections: [] }),
  setMaximumHallwayDistance: () => Promise.resolve(),
  dispose: () => undefined,
}
const activeRoute: ActiveRoute = {
  show: vi.fn(),
  clear: vi.fn(),
  floorChanged: vi.fn(),
  dispose: vi.fn(),
}

beforeEach(() => {
  document.body.innerHTML = '<input id="start-input" value="101"><input id="end-input" value="102">'
  state.selectedStartNode = null
  state.selectedEndNode = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('route actions', () => {
  it('explains that route planning is not ready', () => {
    plan.mockReturnValue({ status: 'not-ready' })
    const showStatus = vi.fn()
    const actions = setupRouteActions({
      planner,
      activeRoute,
      collapsePanel: vi.fn(),
      refreshRecent: vi.fn(),
      showStatus,
      translate: (key) => key,
    })

    actions.findRoute()

    expect(showStatus).toHaveBeenCalledWith('route.mapLoading', 'warning')
  })

  it('shows a no-path error for disconnected locations', () => {
    plan.mockReturnValue({ status: 'no-route' })
    const showStatus = vi.fn()
    const actions = setupRouteActions({
      planner,
      activeRoute,
      collapsePanel: vi.fn(),
      refreshRecent: vi.fn(),
      showStatus,
      translate: (key) => key,
    })

    actions.findRoute()

    expect(showStatus).toHaveBeenCalledWith('route.noPath', 'error')
  })
})
