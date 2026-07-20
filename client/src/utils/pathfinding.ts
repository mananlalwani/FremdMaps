/**
 * A* pathfinding over the visibility graph.
 *
 * Exports:
 * - `findPath`           — A* shortest path between two node UIDs
 * - `findNearestBathroom` — single Dijkstra sweep to find the nearest bathroom
 * - `invalidatePathCache` — clear the LRU result cache after graph changes
 */

import type { Node, Graph, PathResult } from './types'
import { distance } from './geometry'
import { routeLogger } from './logger'

// ---------------------------------------------------------------------------
// LRU Path Cache
// ---------------------------------------------------------------------------

/**
 * Maximum number of path results to keep in the LRU cache.
 * 20 entries covers typical session usage (repeated same-pair queries,
 * multi-floor re-renders) without unbounded memory growth.
 */
const PATH_CACHE_MAX = 20

/**
 * Module-level LRU cache for computed paths.
 * Key: "<graph identity>::<startUid>::<goalUid>"
 * Eviction policy: when size > PATH_CACHE_MAX, the oldest entry is removed.
 * JavaScript Maps preserve insertion order, so `map.keys().next()` always
 * yields the least-recently-inserted key.
 */
const pathCache = new Map<string, PathResult>()
const graphCacheIds = new WeakMap<Graph, number>()
let nextGraphCacheId = 1

function getGraphCacheId(graph: Graph): number {
  const existingId = graphCacheIds.get(graph)
  if (existingId !== undefined) return existingId

  const graphId = nextGraphCacheId++
  graphCacheIds.set(graph, graphId)
  return graphId
}

/**
 * Invalidate the entire path cache.
 * Call this whenever the node/wall data changes (for example, session editor changes)
 * so stale cached paths are not returned.
 */
export function invalidatePathCache(): void {
  pathCache.clear()
}

/**
 * Priority Queue implementation using binary min-heap for A*
 * Items are dequeued in order of lowest priority value
 * Time complexity: O(log N) for enqueue/dequeue vs O(N log N) for array sort
 */
class PriorityQueue<T> {
  private heap: Array<{ item: T; priority: number }> = []

  /**
   * Insert `item` with the given `priority`.
   * Lower priority values are dequeued first (min-heap).
   * Time complexity: O(log N).
   */
  enqueue(item: T, priority: number): void {
    this.heap.push({ item, priority })
    this.bubbleUp(this.heap.length - 1)
  }

  /**
   * Remove and return the item with the lowest priority value.
   * Returns `undefined` when the queue is empty.
   * Time complexity: O(log N).
   */
  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined
    if (this.heap.length === 1) {
      const entry = this.heap.pop()
      return (entry as { item: T }).item
    }

    const min = this.heap[0]
    this.heap[0] = this.heap.pop()!
    this.bubbleDown(0)

    return min.item
  }

  /** `true` when the queue contains no items. */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /** Number of items currently in the queue. */
  size(): number {
    return this.heap.length
  }

  // Helper: Move element up to maintain heap property
  private bubbleUp(index: number): void {
    if (index === 0) return

    const parentIndex = Math.floor((index - 1) / 2)
    if (this.heap[index].priority < this.heap[parentIndex].priority) {
      ;[this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      this.bubbleUp(parentIndex)
    }
  }

  // Helper: Move element down to maintain heap property
  private bubbleDown(index: number): void {
    const leftChild = 2 * index + 1
    const rightChild = 2 * index + 2
    let smallest = index

    if (
      leftChild < this.heap.length &&
      this.heap[leftChild].priority < this.heap[smallest].priority
    ) {
      smallest = leftChild
    }

    if (
      rightChild < this.heap.length &&
      this.heap[rightChild].priority < this.heap[smallest].priority
    ) {
      smallest = rightChild
    }

    if (smallest !== index) {
      ;[this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
      this.bubbleDown(smallest)
    }
  }
}

/**
 * A* pathfinding algorithm
 *
 * Finds the optimal path from start to goal using:
 * - g(n): actual cost from start to node n
 * - h(n): heuristic estimated cost from n to goal (straight-line distance)
 * - f(n) = g(n) + h(n): total estimated cost
 *
 * @param startUid UID of starting node
 * @param goalUid UID of goal node
 * @param nodes Array of all nodes
 * @param graph Visibility graph (adjacency list)
 * @returns PathResult with path, distance, and success flag
 */
export function findPath(
  startUid: string,
  goalUid: string,
  nodes: Node[],
  graph: Graph
): PathResult {
  // Check cache first (LRU refresh on hit)
  const cacheKey = `${getGraphCacheId(graph)}::${startUid}::${goalUid}`
  const cached = pathCache.get(cacheKey)
  if (cached) {
    // Refresh recency — delete and re-insert so this entry moves to the end
    pathCache.delete(cacheKey)
    pathCache.set(cacheKey, cached)
    return cached
  }

  // Create map for quick node lookup
  const nodeMap = new Map(nodes.map((n) => [n.uid, n]))
  const startNode = nodeMap.get(startUid)
  const goalNode = nodeMap.get(goalUid)

  // Validate inputs
  if (!startNode || !goalNode) {
    routeLogger.error('Start or goal node not found')
    return { path: [], distance: 0, found: false }
  }

  if (startUid === goalUid) {
    return { path: [startNode], distance: 0, found: true }
  }

  // Heuristic function: straight-line distance to goal when both nodes are on
  // the same floor; 0 when the node is on a different floor than the goal.
  // A cross-floor path must pass through a stairway (cost >= STAIR_COST), so
  // same-floor euclidean distance is admissible and 0 is trivially admissible.
  // Returning 0 for cross-floor nodes makes the heuristic *inconsistent* — it
  // can increase when moving through a stair portal.  We therefore omit a
  // permanently-closed visited set below and rely on the g-score check.
  const heuristic = (uid: string): number => {
    const node = nodeMap.get(uid)
    if (!node) return Infinity
    if (node.floor !== undefined && goalNode.floor !== undefined && node.floor !== goalNode.floor) {
      return 0
    }
    return distance({ lat: node.lat, lng: node.lng }, { lat: goalNode.lat, lng: goalNode.lng })
  }

  // Initialize data structures
  const openSet = new PriorityQueue<string>()
  openSet.enqueue(startUid, 0)

  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>()
  const fScore = new Map<string, number>()

  // Initialize all scores to infinity
  nodes.forEach((n) => {
    gScore.set(n.uid, Infinity)
    fScore.set(n.uid, Infinity)
  })

  // Start node has g-score of 0
  gScore.set(startUid, 0)
  fScore.set(startUid, heuristic(startUid))

  // A* main loop
  // No permanently-closed visited set: the heuristic is inconsistent across
  // floor transitions (returns 0 for cross-floor nodes), so a node may need
  // to be re-opened when a better g-score is found.  The g-score check below
  // prevents unbounded re-queuing.
  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!

    // Goal reached - reconstruct path
    if (current === goalUid) {
      const path: Node[] = []
      let uid: string | undefined = goalUid

      while (uid) {
        const n = nodeMap.get(uid)
        if (n) path.unshift(n)
        uid = cameFrom.get(uid)
      }

      const totalDistance = gScore.get(goalUid) ?? 0

      routeLogger.log(`Path found: ${path.length} nodes, distance: ${Math.round(totalDistance)}`)

      const result: PathResult = {
        path,
        distance: totalDistance,
        found: true,
      }

      // Store in LRU cache, evicting oldest entry when full
      if (pathCache.size >= PATH_CACHE_MAX) {
        const oldestKey = pathCache.keys().next().value
        if (oldestKey !== undefined) pathCache.delete(oldestKey)
      }
      pathCache.set(cacheKey, result)

      return result
    }

    // Check all neighbors
    const neighbors = graph.get(current) ?? []

    for (const edge of neighbors) {
      const neighborUid = edge.to

      // Calculate tentative g-score
      const tentativeGScore = gScore.get(current)! + edge.cost

      // Update if this path is better
      if (tentativeGScore < gScore.get(neighborUid)!) {
        cameFrom.set(neighborUid, current)
        gScore.set(neighborUid, tentativeGScore)
        fScore.set(neighborUid, tentativeGScore + heuristic(neighborUid))
        openSet.enqueue(neighborUid, fScore.get(neighborUid)!)
      }
    }
  }

  // No path found
  routeLogger.warn(`No path found from ${startUid} to ${goalUid}`)
  return { path: [], distance: 0, found: false }
}

/**
 * Find the nearest bathroom to a given node.
 * Uses a single Dijkstra pass from the start node to find all reachable
 * distances in one sweep — O((V + E) log V) instead of O(B * (V + E) log V)
 * for B bathrooms.
 *
 * Falls back to straight-line distance when no graph is provided.
 *
 * @param startNode Starting point
 * @param allNodes Array of all nodes
 * @param graph Navigation graph for pathfinding
 * @returns Nearest bathroom node or undefined
 */
export function findNearestBathroom(
  startNode: Node,
  allNodes: Node[],
  graph?: Graph
): Node | undefined {
  // Filter to bathroom nodes (across all floors)
  const bathrooms = allNodes.filter((n) => n.type === 'bathroom')

  if (bathrooms.length === 0) {
    routeLogger.warn('No bathrooms found')
    return undefined
  }

  // If no graph provided, use straight-line distance as fallback
  if (!graph) {
    routeLogger.log('No graph provided, using straight-line distance')
    let nearest: Node | undefined
    let minDistance = Infinity

    for (const bathroom of bathrooms) {
      const dist = distance(
        { lat: startNode.lat, lng: startNode.lng },
        { lat: bathroom.lat, lng: bathroom.lng }
      )

      if (dist < minDistance) {
        minDistance = dist
        nearest = bathroom
      }
    }

    routeLogger.log(
      `Found nearest bathroom: ${nearest?.rooms[0]} at ${Math.round(minDistance)} units away (straight-line)`
    )
    return nearest
  }

  // Single Dijkstra pass from startNode — visits each node at most once.
  // Time complexity: O((V + E) log V)
  const dist = new Map<string, number>()
  const open = new PriorityQueue<string>()

  dist.set(startNode.uid, 0)
  open.enqueue(startNode.uid, 0)

  const visited = new Set<string>()

  while (!open.isEmpty()) {
    const current = open.dequeue()!
    if (visited.has(current)) continue
    visited.add(current)

    const currentDist = dist.get(current) ?? Infinity
    const neighbors = graph.get(current) ?? []
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue
      const newDist = currentDist + edge.cost
      if (newDist < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, newDist)
        open.enqueue(edge.to, newDist)
      }
    }
  }

  // Pick the reachable bathroom with minimum path distance
  let nearest: Node | undefined
  let minDistance = Infinity

  for (const bathroom of bathrooms) {
    const d = dist.get(bathroom.uid)
    if (d !== undefined && d < minDistance) {
      minDistance = d
      nearest = bathroom
    }
  }

  if (nearest) {
    routeLogger.log(
      `Found nearest bathroom: ${nearest.rooms[0]} at ${Math.round(minDistance)} units away (actual path${nearest.floor !== startNode.floor ? ', cross-floor' : ''})`
    )
  } else {
    routeLogger.warn('No reachable bathrooms found')
  }

  return nearest
}
