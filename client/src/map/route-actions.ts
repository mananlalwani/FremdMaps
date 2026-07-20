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
}

function resolveRoomCandidates(
  value: string,
  selectedUid: string | null,
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

  const fuzzyResults = searchNodes(value, state.allNodesAllFloors, { limit: 1 })
  if (fuzzyResults.length === 0) return []
  const fuzzy = fuzzyResults[0]
  return fuzzy.score < SEARCH_CONFIG.FUZZY_THRESHOLD ? [fuzzy.node] : []
}

function resolveRoom(value: string, selectedUid: string | null): Node | undefined {
  return resolveRoomCandidates(value, selectedUid, true)[0]
}

/** Attach route and bathroom actions after the panel is rendered. */
export function setupRouteActions(options: RouteActionOptions): {
  findRoute: () => void
  cleanup: () => void
} {
  const findRoute = (): void => {
    const startInput = document.getElementById('start-input') as HTMLInputElement | null
    const endInput = document.getElementById('end-input') as HTMLInputElement | null
    if (!startInput || !endInput) return
    const startText = startInput.value.trim()
    const endText = endInput.value.trim()
    if (!startText || !endText) return options.showStatus(t('route.missingLocations'), 'warning')
    const graph = options.getGraph()
    if (!graph) return options.showStatus(t('route.mapLoading'), 'warning')
    const start = resolveRoom(startText, state.selectedStartNode?.uid ?? null)
    const endCandidates = resolveRoomCandidates(endText, state.selectedEndNode?.uid ?? null)
    if (!start || endCandidates.length === 0)
      return options.showStatus(t('route.locationsNotFound'), 'error')

    // A destination name can exist on more than one floor (for example,
    // Auditorium). Prefer a reachable endpoint on the starting floor; only
    // fall back to another floor when no same-floor destination is reachable.
    // Destination autocomplete selections are expanded to their exact aliases
    // above; starts retain their explicit selection as the route origin.
    const sameFloorCandidates = endCandidates.filter((end) => end.floor === start.floor)
    const findShortestReachable = (candidates: Node[]): ReturnType<typeof findPath> | null => {
      let bestResult: ReturnType<typeof findPath> | null = null
      for (const end of candidates) {
        const result = findPath(start.uid, end.uid, state.allNodesAllFloors, graph, {
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
    if (bestResult === null) return options.showStatus(t('route.noPath'), 'error')
    addRecentSearch(startText, endText)
    options.refreshRecent()
    displayRoute(bestResult.path, bestResult.distance)
    options.collapsePanel()
  }

  const findBathroom = (): void => {
    const startInput = document.getElementById('start-input') as HTMLInputElement | null
    const startText = startInput?.value.trim() ?? ''
    if (!startText) return options.showStatus(t('route.missingStart'), 'warning')
    const graph = options.getGraph()
    if (!graph) return options.showStatus(t('route.mapLoading'), 'warning')
    const start = resolveRoom(startText, state.selectedStartNode?.uid ?? null)
    if (!start) return options.showStatus(t('route.roomNotFound', { room: startText }), 'error')
    const bathroom = findNearestBathroom(start, state.allNodesAllFloors, graph)
    if (!bathroom) return options.showStatus(t('route.noBathrooms'), 'error')
    const result = findPath(start.uid, bathroom.uid, state.allNodesAllFloors, graph)
    if (!result.found) return options.showStatus(t('route.noBathroomPath'), 'error')
    displayRoute(result.path, result.distance)
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
