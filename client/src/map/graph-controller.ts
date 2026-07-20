/** Visibility-graph worker lifecycle with a safe main-thread fallback. */

import { MAP_CONFIG } from '../utils/constants'
import { graphLogger } from '../utils/logger'
import type { Graph, Node, TrafficZone, Wall } from '../utils/types'

interface WorkerResponse {
  cacheKey: string
  graph?: Graph
  error?: string
}

interface PendingBuild {
  resolve: (graph: Graph) => void
  reject: (error: Error) => void
}

export interface GraphController {
  ensureGraph: (
    nodes: Node[],
    walls: Wall[],
    zones: TrafficZone[],
    cacheKey: string
  ) => Promise<Graph>
  getGraph: () => Graph | null
  terminate: () => void
}

/** Create an isolated graph builder for one map instance. */
export function createGraphController(): GraphController {
  let graph: Graph | null = null
  let cacheKey = ''
  let worker: Worker | null = null
  let latestBuildRequestId = 0
  const pendingBuilds = new Map<string, PendingBuild>()
  const inFlightBuilds = new Map<string, Promise<Graph>>()

  const rejectPendingBuilds = (error: Error): void => {
    for (const { reject } of pendingBuilds.values()) reject(error)
    pendingBuilds.clear()
  }

  const ensureWorker = (): Worker => {
    if (worker) return worker

    worker = new Worker(new URL('../workers/graph-worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onerror = (event) => {
      const error = event.error instanceof Error ? event.error : new Error('Graph worker failed')
      graphLogger.error('Graph worker error:', error)
      rejectPendingBuilds(error)
      worker?.terminate()
      worker = null
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { cacheKey: responseKey, graph: responseGraph, error: responseError } = event.data
      const pending = pendingBuilds.get(responseKey)
      if (!pending) return
      pendingBuilds.delete(responseKey)

      if (responseError || !responseGraph) {
        pending.reject(new Error(responseError ?? 'Graph worker returned no graph'))
        return
      }
      pending.resolve(responseGraph)
    }
    return worker
  }

  const buildInWorker = (
    nodes: Node[],
    walls: Wall[],
    zones: TrafficZone[],
    nextCacheKey: string
  ): Promise<Graph> => {
    const existing = inFlightBuilds.get(nextCacheKey)
    if (existing) return existing

    const build = new Promise<Graph>((resolve, reject) => {
      const activeWorker = ensureWorker()
      pendingBuilds.set(nextCacheKey, { resolve, reject })
      activeWorker.postMessage({
        nodes,
        walls,
        maxDistance: MAP_CONFIG.MAX_HALLWAY_DISTANCE,
        zones,
        cacheKey: nextCacheKey,
      })
    }).finally(() => {
      inFlightBuilds.delete(nextCacheKey)
    })
    inFlightBuilds.set(nextCacheKey, build)
    return build
  }

  return {
    async ensureGraph(nodes, walls, zones, nextCacheKey): Promise<Graph> {
      if (graph && cacheKey === nextCacheKey) {
        graphLogger.log('Reusing cached visibility graph.')
        return graph
      }
      const requestId = ++latestBuildRequestId
      graphLogger.log('Building visibility graph...')
      const startedAt = performance.now()
      let nextGraph: Graph
      try {
        nextGraph = await buildInWorker(nodes, walls, zones, nextCacheKey)
      } catch (error) {
        graphLogger.warn('Worker build failed, falling back to main thread:', error)
        const { buildVisibilityGraph } = await import('../utils/graph')
        nextGraph = buildVisibilityGraph(nodes, walls, MAP_CONFIG.MAX_HALLWAY_DISTANCE, zones)
      }

      // A slower, superseded build may still resolve successfully. Keep the
      // last known-good graph until the newest request has completed, and
      // never let an older response replace it.
      if (requestId === latestBuildRequestId) {
        graph = nextGraph
        cacheKey = nextCacheKey
      }

      const directedEdges = Array.from(nextGraph.values()).reduce(
        (total, edges) => total + edges.length,
        0
      )
      graphLogger.perf('visibility graph build', startedAt)
      graphLogger.info(
        `Visibility graph metrics: ${nextGraph.size} nodes, ${directedEdges} directed edges`
      )
      graphLogger.log('Visibility graph built.')
      return nextGraph
    },
    getGraph: (): Graph | null => graph,
    terminate: (): void => {
      rejectPendingBuilds(new Error('Graph worker terminated'))
      worker?.terminate()
      worker = null
      inFlightBuilds.clear()
    },
  }
}
