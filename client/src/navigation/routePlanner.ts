import { SEARCH_CONFIG } from '../config/featured'
import { MAP_CONFIG } from '../utils/constants'
import { createGraphController } from './graphController'
import { getGraphStats } from '../utils/graph'
import { findNearestBathroom, findPath } from '../utils/pathfinding'
import { findExactMatches, rankWithRecency, searchNodes } from '../utils/search'
import { getFavorites, getFrequentRooms } from '../utils/storage'
import type { GraphStats } from '../utils/graph'
import type { Graph, Node, RoomCategory, SearchResult } from '../utils/types'
import type { NavigationData, NavigationSnapshot } from './navigationData'

export interface PlaceInput {
  text: string
  selectedUid?: string | null
}

export interface RoutePlan {
  path: Node[]
  cost: number
  origin: Node
  destination: Node
  revision: number
}

export type RoutePlanOutcome =
  | { status: 'ok'; plan: RoutePlan }
  | { status: 'not-ready' }
  | { status: 'origin-not-found' }
  | { status: 'destination-not-found' }
  | { status: 'no-bathroom' }
  | { status: 'no-route' }

export interface RoutePlannerDebugView {
  revision: number | null
  stats: GraphStats | null
  connections: ReadonlyArray<{
    floor: string | null
    start: { lat: number; lng: number }
    end: { lat: number; lng: number }
  }>
}

export type RoutePlannerStatus =
  | { state: 'empty' }
  | { state: 'compiling'; revision: number }
  | { state: 'ready'; revision: number }
  | { state: 'failed'; revision: number; error: Error }

export interface RoutePlanner {
  getStatus(): RoutePlannerStatus
  subscribe(listener: (status: RoutePlannerStatus) => void): () => void
  search(
    query: string,
    options?: { limit?: number; categoryFilter?: RoomCategory[]; preferredFloor?: string }
  ): SearchResult[]
  findExact(query: string): Node[]
  getDestinations(): readonly Node[]
  plan(origin: PlaceInput, destination: PlaceInput): RoutePlanOutcome
  planToNearestBathroom(origin: PlaceInput): RoutePlanOutcome
  getDebugView(): RoutePlannerDebugView
  setMaximumHallwayDistance(distance: number): Promise<void>
  dispose(): void
}

interface CompiledRevision {
  snapshot: NavigationSnapshot
  graph: Graph
}

function candidatesFor(place: PlaceInput, snapshot: NavigationSnapshot): Node[] {
  if (place.selectedUid) {
    const selected = snapshot.nodes.find((node) => node.uid === place.selectedUid)
    return selected ? [selected] : []
  }
  const exact = findExactMatches(place.text, snapshot.nodes)
  if (exact.length > 0) return exact
  const fuzzyResults = searchNodes(place.text, snapshot.nodes, { limit: 1 })
  if (fuzzyResults.length === 0) return []
  const fuzzy = fuzzyResults[0]
  return fuzzy.score < SEARCH_CONFIG.FUZZY_THRESHOLD ? [fuzzy.node] : []
}

function bestRoute(
  origins: Node[],
  destinations: Node[],
  snapshot: NavigationSnapshot,
  graph: Graph
): RoutePlan | null {
  const pairs = origins.flatMap((origin) =>
    destinations.map((destination) => ({ origin, destination }))
  )
  const sameFloor = pairs.filter(({ origin, destination }) => origin.floor === destination.floor)
  const crossFloor = pairs.filter(({ origin, destination }) => origin.floor !== destination.floor)

  const shortest = (candidatePairs: typeof pairs): RoutePlan | null => {
    let best: RoutePlan | null = null
    for (const { origin, destination } of candidatePairs) {
      if (snapshot.scope === 'limited' && origin.floor !== destination.floor) continue
      const result = findPath(origin.uid, destination.uid, [...snapshot.nodes], graph, {
        allowFloorTransitions: origin.floor !== destination.floor,
      })
      if (result.found && (!best || result.distance < best.cost)) {
        best = {
          path: result.path,
          cost: result.distance,
          origin,
          destination,
          revision: snapshot.revision,
        }
      }
    }
    return best
  }

  return shortest(sameFloor) ?? shortest(crossFloor)
}

export function createRoutePlanner(navigationData: NavigationData): RoutePlanner {
  const graphController = createGraphController()
  const listeners = new Set<(status: RoutePlannerStatus) => void>()
  const preparedEdits = new Map<number, CompiledRevision>()
  let compiled: CompiledRevision | null = null
  let status: RoutePlannerStatus = { state: 'empty' }
  let buildRequest = 0

  const setStatus = (next: RoutePlannerStatus): void => {
    status = next
    for (const listener of listeners) listener(next)
  }

  const compile = async (snapshot: NavigationSnapshot): Promise<CompiledRevision> => {
    const graph = await graphController.ensureGraph(
      [...snapshot.nodes],
      [...snapshot.walls],
      [...snapshot.zones],
      `${snapshot.revision}:${MAP_CONFIG.MAX_HALLWAY_DISTANCE}`
    )
    return { snapshot, graph }
  }

  const compilePublished = async (snapshot: NavigationSnapshot): Promise<void> => {
    const request = ++buildRequest
    setStatus({ state: 'compiling', revision: snapshot.revision })
    try {
      const next = preparedEdits.get(snapshot.revision) ?? (await compile(snapshot))
      preparedEdits.delete(snapshot.revision)
      if (request !== buildRequest || navigationData.getSnapshot()?.revision !== snapshot.revision)
        return
      compiled = next
      setStatus({ state: 'ready', revision: snapshot.revision })
    } catch (caught) {
      if (request !== buildRequest) return
      const error = caught instanceof Error ? caught : new Error('Navigation compilation failed')
      compiled = null
      setStatus({ state: 'failed', revision: snapshot.revision, error })
    }
  }

  const removeGuard = navigationData.addEditGuard(async (candidate) => {
    preparedEdits.set(candidate.revision, await compile(candidate))
  })
  const removeDataListener = navigationData.subscribe((snapshot) => {
    void compilePublished(snapshot)
  })
  const existing = navigationData.getSnapshot()
  if (existing) void compilePublished(existing)

  const plan = (origin: PlaceInput, destination: PlaceInput): RoutePlanOutcome => {
    const current = navigationData.getSnapshot()
    if (!current || compiled?.snapshot.revision !== current.revision) {
      return { status: 'not-ready' }
    }
    const origins = candidatesFor(origin, current)
    if (origins.length === 0) return { status: 'origin-not-found' }
    const destinations = candidatesFor(destination, current)
    if (destinations.length === 0) return { status: 'destination-not-found' }
    const route = bestRoute(origins, destinations, current, compiled.graph)
    return route ? { status: 'ok', plan: route } : { status: 'no-route' }
  }

  const getDebugView = (): RoutePlannerDebugView => {
    if (!compiled) return { revision: null, stats: null, connections: [] }
    const nodesByUid = new Map(compiled.snapshot.nodes.map((node) => [node.uid, node]))
    const seen = new Set<string>()
    const connections: RoutePlannerDebugView['connections'][number][] = []
    for (const [sourceUid, edges] of compiled.graph) {
      const source = nodesByUid.get(sourceUid)
      if (!source) continue
      for (const edge of edges) {
        const target = nodesByUid.get(edge.to)
        if (!target) continue
        const key = [sourceUid, target.uid].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)
        connections.push({
          floor: source.floor === target.floor ? (source.floor ?? null) : null,
          start: { lat: source.lat, lng: source.lng },
          end: { lat: target.lat, lng: target.lng },
        })
      }
    }
    return {
      revision: compiled.snapshot.revision,
      stats: getGraphStats(compiled.graph),
      connections,
    }
  }

  return {
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    search(query, options = {}) {
      const snapshot = navigationData.getSnapshot()
      if (!snapshot) return []
      const recent = rankWithRecency(
        searchNodes(query, snapshot.nodes, {
          limit: options.limit,
          categoryFilter: options.categoryFilter,
        }),
        getFrequentRooms()
      )
      const favorites = new Set(getFavorites())
      return recent.sort((left, right) => {
        const leftFavorite = favorites.has(left.node.uid)
        const rightFavorite = favorites.has(right.node.uid)
        if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1
        if (options.preferredFloor) {
          const leftPreferred = left.node.floor === options.preferredFloor
          const rightPreferred = right.node.floor === options.preferredFloor
          if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1
        }
        return left.score - right.score
      })
    },
    findExact(query) {
      const snapshot = navigationData.getSnapshot()
      return snapshot ? findExactMatches(query, snapshot.nodes) : []
    },
    getDestinations() {
      return navigationData.getSnapshot()?.nodes ?? []
    },
    plan,
    planToNearestBathroom(origin): RoutePlanOutcome {
      const current = navigationData.getSnapshot()
      if (!current || compiled?.snapshot.revision !== current.revision) {
        return { status: 'not-ready' }
      }
      const origins = candidatesFor(origin, current)
      if (origins.length === 0) return { status: 'origin-not-found' }
      if (!current.nodes.some((node) => node.type === 'bathroom')) {
        return { status: 'no-bathroom' }
      }
      let best: RoutePlan | null = null
      for (const start of origins) {
        const bathroom = findNearestBathroom(start, [...current.nodes], compiled.graph)
        if (!bathroom) continue
        const route = bestRoute([start], [bathroom], current, compiled.graph)
        if (route && (!best || route.cost < best.cost)) best = route
      }
      return best ? { status: 'ok', plan: best } : { status: 'no-route' }
    },
    getDebugView,
    async setMaximumHallwayDistance(distance): Promise<void> {
      if (!Number.isFinite(distance) || distance <= 0) {
        throw new Error('Maximum hallway distance must be a positive finite number')
      }
      const snapshot = navigationData.getSnapshot()
      if (!snapshot) return
      // SAFETY: this developer-only operation owns the session setting and rolls it back on failure.
      const mutableMapConfig = MAP_CONFIG as { MAX_HALLWAY_DISTANCE: number }
      const previousDistance = mutableMapConfig.MAX_HALLWAY_DISTANCE
      const previousCompiled = compiled
      const request = ++buildRequest
      mutableMapConfig.MAX_HALLWAY_DISTANCE = distance
      setStatus({ state: 'compiling', revision: snapshot.revision })
      try {
        const next = await compile(snapshot)
        if (
          request !== buildRequest ||
          navigationData.getSnapshot()?.revision !== snapshot.revision
        )
          return
        compiled = next
        setStatus({ state: 'ready', revision: snapshot.revision })
      } catch (caught) {
        mutableMapConfig.MAX_HALLWAY_DISTANCE = previousDistance
        compiled = previousCompiled
        const error = caught instanceof Error ? caught : new Error('Navigation compilation failed')
        setStatus(
          previousCompiled
            ? { state: 'ready', revision: previousCompiled.snapshot.revision }
            : { state: 'failed', revision: snapshot.revision, error }
        )
        throw error
      }
    },
    dispose() {
      buildRequest += 1
      removeGuard()
      removeDataListener()
      graphController.terminate()
      listeners.clear()
      preparedEdits.clear()
      compiled = null
    },
  }
}
