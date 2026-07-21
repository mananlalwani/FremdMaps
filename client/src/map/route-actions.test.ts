// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupRouteActions } from './route-actions'
import { state } from './map-state'
import { findPath } from '../utils/pathfinding'

vi.mock('../utils/i18n', () => ({ t: (key: string) => key }))
vi.mock('../utils/pathfinding', () => ({ findNearestBathroom: vi.fn(), findPath: vi.fn() }))
vi.mock('../utils/search', () => ({ searchNodes: vi.fn(() => []) }))
vi.mock('../utils/storage', () => ({ addRecentSearch: vi.fn() }))
vi.mock('./route-display', () => ({ displayRoute: vi.fn() }))

const findPathMock = vi.mocked(findPath)

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
    })

    actions.findRoute()

    expect(showStatus).toHaveBeenCalledWith('route.noPath', 'error')
  })
})
