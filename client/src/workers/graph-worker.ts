/**
 * Web Worker for building the visibility graph off the main thread.
 *
 * Receives:
 *   { nodes, walls, maxDistance, zones, cacheKey }
 * Posts back:
 *   { graph, cacheKey }
 *
 * The worker imports the same graph-building module as the main thread so
 * there is no code duplication. The result `Graph` (a `Map`) is copied across
 * the worker boundary with structured clone, which modern browsers support.
 */

import { buildVisibilityGraph } from '../utils/graph'
import type { Node, Wall, TrafficZone, Graph } from '../utils/types'

interface WorkerMessage {
  nodes: Node[]
  walls: Wall[]
  maxDistance: number
  zones: TrafficZone[]
  cacheKey: string
}

interface WorkerResponse {
  graph: Graph
  cacheKey: string
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  try {
    const { nodes, walls, maxDistance, zones, cacheKey } = e.data

    const graph = buildVisibilityGraph(nodes, walls, maxDistance, zones)

    const response: WorkerResponse = { graph, cacheKey }
    self.postMessage(response)
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      cacheKey: e.data.cacheKey,
    })
  }
}
