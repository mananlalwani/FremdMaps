// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupRouteActions, type RouteActionDependencies } from './route-actions'
import { state } from './map-state'

const findPathMock = vi.fn()
const dependencies: RouteActionDependencies = {
  translate: (key) => key,
  findPath: findPathMock,
  findNearestBathroom: vi.fn(),
  searchNodes: vi.fn(() => []),
  addRecentSearch: vi.fn(),
  displayRoute: vi.fn(),
}

beforeEach(() => {
  document.body.innerHTML = '<input id="start-input" value="101"><input id="end-input" value="102">'
  state.allNodesAllFloors = [
    { uid: 'start', lat: -100, lng: 0, rooms: ['101'], floor: '1', type: 'room' },
    { uid: 'end', lat: -100, lng: 100, rooms: ['102'], floor: '1', type: 'room' },
  ]
  state.selectedStartNode = null
  state.selectedEndNode = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('route action failure states', () => {
  it('explains that the map is still loading when no graph is available', () => {
    const showStatus = vi.fn()
    const actions = setupRouteActions({
      getGraph: () => null,
      collapsePanel: vi.fn(),
      refreshRecent: vi.fn(),
      showStatus,
      dependencies,
    })

    actions.findRoute()

    expect(showStatus).toHaveBeenCalledWith('route.mapLoading', 'warning')
  })

  it('shows a no-path error for disconnected locations', () => {
    findPathMock.mockReturnValue({ path: [], distance: 0, found: false })
    const showStatus = vi.fn()
    const actions = setupRouteActions({
      getGraph: () => new Map(),
      collapsePanel: vi.fn(),
      refreshRecent: vi.fn(),
      showStatus,
      dependencies,
    })

    actions.findRoute()

    expect(showStatus).toHaveBeenCalledWith('route.noPath', 'error')
  })
})
