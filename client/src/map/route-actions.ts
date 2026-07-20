/** Route and bathroom actions wired to the navigation panel buttons. */

import { findNearestBathroom, findPath } from '../utils/pathfinding'
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

function resolveRoomCandidates(value: string, selectedUid: string | null): Node[] {
  const selected = selectedUid
    ? state.allNodesAllFloors.find((node) => node.uid === selectedUid)
    : undefined
  if (selected) return [selected]

  const normalizedValue = value.trim().toLowerCase()
  const exactMatches = state.allNodesAllFloors.filter((node) =>
    node.rooms.some((room) => room.trim().toLowerCase() === normalizedValue)
  )
  if (exactMatches.length > 0) return exactMatches

  const fuzzyResults = searchNodes(value, state.allNodesAllFloors, { limit: 1 })
  if (fuzzyResults.length === 0) return []
  const fuzzy = fuzzyResults[0]
  return fuzzy.score < SEARCH_CONFIG.FUZZY_THRESHOLD ? [fuzzy.node] : []
}

function resolveRoom(value: string, selectedUid: string | null): Node | undefined {
  return resolveRoomCandidates(value, selectedUid)[0]
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
    if (!startText || !endText)
      return options.showStatus('Enter both a starting point and a destination', 'warning')
    const graph = options.getGraph()
    if (!graph) return options.showStatus('Map not ready yet — please wait a moment', 'warning')
    const start = resolveRoom(startText, state.selectedStartNode?.uid ?? null)
    const endCandidates = resolveRoomCandidates(endText, state.selectedEndNode?.uid ?? null)
    if (!start || endCandidates.length === 0)
      return options.showStatus('One or both locations could not be found.', 'error')

    // A destination name can exist on more than one floor (for example,
    // Auditorium). Prefer a reachable endpoint on the starting floor; only
    // fall back to another floor when no same-floor destination is reachable.
    // An explicit autocomplete selection remains a one-item candidate list.
    const sameFloorCandidates = endCandidates.filter((end) => end.floor === start.floor)
    const findShortestReachable = (candidates: Node[]): ReturnType<typeof findPath> | null => {
      let bestResult: ReturnType<typeof findPath> | null = null
      for (const end of candidates) {
        const result = findPath(start.uid, end.uid, state.allNodesAllFloors, graph)
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
      return options.showStatus('No path found between these locations.', 'error')
    addRecentSearch(startText, endText)
    options.refreshRecent()
    displayRoute(bestResult.path, bestResult.distance)
    options.collapsePanel()
  }

  const findBathroom = (): void => {
    const startInput = document.getElementById('start-input') as HTMLInputElement | null
    const startText = startInput?.value.trim() ?? ''
    if (!startText) return options.showStatus('Enter your starting location first', 'warning')
    const graph = options.getGraph()
    if (!graph) return options.showStatus('Map not ready yet — please wait a moment', 'warning')
    const start = resolveRoom(startText, state.selectedStartNode?.uid ?? null)
    if (!start) return options.showStatus(`Room "${startText}" not found`, 'error')
    const bathroom = findNearestBathroom(start, state.allNodesAllFloors, graph)
    if (!bathroom) return options.showStatus('No reachable bathrooms found', 'error')
    const result = findPath(start.uid, bathroom.uid, state.allNodesAllFloors, graph)
    if (!result.found)
      return options.showStatus('Could not find a path to the nearest bathroom.', 'error')
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
