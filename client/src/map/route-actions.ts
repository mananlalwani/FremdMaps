/** Route and bathroom actions wired to the navigation panel buttons. */

import { findNearestBathroom, findPath } from '../utils/pathfinding'
import { t } from '../utils/i18n'
import { searchNodes } from '../utils/search'
import { SEARCH_CONFIG } from '../config/featured'
import { addRecentSearch } from '../utils/storage'
import type { Graph, Node } from '../utils/types'
import { state } from './map-state'
import { displayRoute } from './route-display'

export interface RouteActionOptions {
  getGraph: () => Graph | null
  collapsePanel: () => void
  refreshRecent: () => void
  showStatus: (message: string, type?: 'info' | 'warning' | 'error') => void
  dependencies?: RouteActionDependencies
}

export interface RouteActionDependencies {
  translate: typeof t
  findPath: typeof findPath
  findNearestBathroom: typeof findNearestBathroom
  searchNodes: typeof searchNodes
  addRecentSearch: typeof addRecentSearch
  displayRoute: typeof displayRoute
}

const DEFAULT_DEPENDENCIES: RouteActionDependencies = {
  translate: t,
  findPath,
  findNearestBathroom,
  searchNodes,
  addRecentSearch,
  displayRoute,
}

interface RouteActions {
  findRoute: () => void
  cleanup: () => void
}

function resolveRoomCandidates(
  value: string,
  selectedUid: string | null,
  search: typeof searchNodes,
  preserveSelected = false
): Node[] {
  const selected = selectedUid
    ? state.allNodesAllFloors.find((node) => node.uid === selectedUid)
    : undefined

  const normalizedValue = value.trim().toLowerCase()
  const exactMatches = state.allNodesAllFloors.filter((node) =>
    node.rooms.some((room) => room.trim().toLowerCase() === normalizedValue)
  )

  // A selected end result can be an alias on a different-floor node (for
  // example, Floor 2 stair G also matches “Auditorium”). Resolve all exact
  // matches so the route can still prefer a same-floor destination. Starts
  // retain their explicit selection because that identifies the origin.
  if (selected && !preserveSelected && exactMatches.length > 0) return exactMatches
  if (selected) return [selected]

  if (exactMatches.length > 0) return exactMatches

  const fuzzyResults = search(value, state.allNodesAllFloors, { limit: 1 })
  if (fuzzyResults.length === 0) return []
  const fuzzy = fuzzyResults[0]
  return fuzzy.score < SEARCH_CONFIG.FUZZY_THRESHOLD ? [fuzzy.node] : []
}

function resolveRoom(
  value: string,
  selectedUid: string | null,
  search: typeof searchNodes
): Node | undefined {
  return resolveRoomCandidates(value, selectedUid, search, true)[0]
}

/** Attach route and bathroom actions after the panel is rendered. */
export function setupRouteActions(options: RouteActionOptions): RouteActions {
  const dependencies = options.dependencies ?? DEFAULT_DEPENDENCIES
  const findRoute = (): void => {
    const startInput = document.querySelector<HTMLInputElement>('#start-input')
    const endInput = document.querySelector<HTMLInputElement>('#end-input')
    if (!startInput || !endInput) return
    const startText = startInput.value.trim()
    const endText = endInput.value.trim()
    if (!startText || !endText)
      return options.showStatus(dependencies.translate('route.missingLocations'), 'warning')
    const graph = options.getGraph()
    if (!graph) return options.showStatus(dependencies.translate('route.mapLoading'), 'warning')
    const start = resolveRoom(
      startText,
      state.selectedStartNode?.uid ?? null,
      dependencies.searchNodes
    )
    const endCandidates = resolveRoomCandidates(
      endText,
      state.selectedEndNode?.uid ?? null,
      dependencies.searchNodes
    )
    if (!start || endCandidates.length === 0)
      return options.showStatus(dependencies.translate('route.locationsNotFound'), 'error')

    // A destination name can exist on more than one floor (for example,
    // Auditorium). Prefer a reachable endpoint on the starting floor; only
    // fall back to another floor when no same-floor destination is reachable.
    // Destination autocomplete selections are expanded to their exact aliases
    // above; starts retain their explicit selection as the route origin.
    const sameFloorCandidates = endCandidates.filter((end) => end.floor === start.floor)
    const findShortestReachable = (candidates: Node[]): ReturnType<typeof findPath> | null => {
      let bestResult: ReturnType<typeof findPath> | null = null
      for (const end of candidates) {
        const result = dependencies.findPath(start.uid, end.uid, state.allNodesAllFloors, graph, {
          allowFloorTransitions: start.floor !== end.floor,
        })
        if (result.found && (bestResult === null || result.distance < bestResult.distance)) {
          bestResult = result
        }
      }
      return bestResult
    }
    const otherFloorCandidates = endCandidates.filter((end) => end.floor !== start.floor)
    const bestResult =
      findShortestReachable(sameFloorCandidates) ?? findShortestReachable(otherFloorCandidates)
    if (bestResult === null)
      return options.showStatus(dependencies.translate('route.noPath'), 'error')
    dependencies.addRecentSearch(startText, endText)
    options.refreshRecent()
    dependencies.displayRoute(bestResult.path, bestResult.distance)
    options.collapsePanel()
  }

  const findBathroom = (): void => {
    const startInput = document.querySelector<HTMLInputElement>('#start-input')
    const startText = startInput?.value.trim() ?? ''
    if (!startText)
      return options.showStatus(dependencies.translate('route.missingStart'), 'warning')
    const graph = options.getGraph()
    if (!graph) return options.showStatus(dependencies.translate('route.mapLoading'), 'warning')
    const start = resolveRoom(
      startText,
      state.selectedStartNode?.uid ?? null,
      dependencies.searchNodes
    )
    if (!start)
      return options.showStatus(
        dependencies.translate('route.roomNotFound', { room: startText }),
        'error'
      )
    const bathroom = dependencies.findNearestBathroom(start, state.allNodesAllFloors, graph)
    if (!bathroom) return options.showStatus(dependencies.translate('route.noBathrooms'), 'error')
    const result = dependencies.findPath(start.uid, bathroom.uid, state.allNodesAllFloors, graph)
    if (!result.found)
      return options.showStatus(dependencies.translate('route.noBathroomPath'), 'error')
    dependencies.displayRoute(result.path, result.distance)
    options.collapsePanel()
  }

  const controller = new AbortController()
  document
    .getElementById('find-route-btn')
    ?.addEventListener('click', () => void findRoute(), { signal: controller.signal })
  document
    .getElementById('find-bathroom-btn')
    ?.addEventListener('click', findBathroom, { signal: controller.signal })
  return { findRoute, cleanup: () => controller.abort() }
}
