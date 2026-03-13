/**
 * A* pathfinding over the visibility graph (server-side copy).
 *
 * Exports:
 * - `findPath`             — A* shortest path between two node UIDs
 * - `findNearestBathroom`  — single Dijkstra sweep to find the nearest bathroom
 *
 * Must be kept in sync with `client/src/utils/pathfinding.ts`.
 * (The client copy additionally exports `findNodeByRoom`, `searchNodesByRoom`,
 * and `invalidatePathCache`; those are not needed server-side.)
 */

import type { Node, Graph, PathResult } from './types'
import { distance } from './geometry'

/**
 * Min-heap priority queue used by A* and Dijkstra.
 *
 * Items are dequeued in order of lowest priority value.
 * Time complexity: O(log N) for enqueue/dequeue, O(1) for isEmpty.
 */
class PriorityQueue<T> {
  private heap: Array<{ item: T; priority: number }> = []

  enqueue(item: T, priority: number): void {
    this.heap.push({ item, priority })
    this.bubbleUp(this.heap.length - 1)
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined
    if (this.heap.length === 1) return this.heap.pop()!.item

    const min = this.heap[0]
    this.heap[0] = this.heap.pop()!
    this.bubbleDown(0)
    return min.item
  }

  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /** Move a newly-inserted element up until the heap property is restored. */
  private bubbleUp(index: number): void {
    if (index === 0) return
    const parentIndex = Math.floor((index - 1) / 2)
    if (this.heap[index].priority < this.heap[parentIndex].priority) {
      ;[this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      this.bubbleUp(parentIndex)
    }
  }

  /** Move the root element down after a dequeue until the heap property is restored. */
  private bubbleDown(index: number): void {
    const left = 2 * index + 1
    const right = 2 * index + 2
    let smallest = index

    if (left < this.heap.length && this.heap[left].priority < this.heap[smallest].priority) {
      smallest = left
    }
    if (right < this.heap.length && this.heap[right].priority < this.heap[smallest].priority) {
      smallest = right
    }
    if (smallest !== index) {
      ;[this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
      this.bubbleDown(smallest)
    }
  }
}

/**
 * A* pathfinding algorithm.
 *
 * Finds the optimal path from start to goal using:
 * - g(n): actual cost from start to node n (sum of edge costs along the path)
 * - h(n): admissible heuristic — straight-line Euclidean distance to goal
 * - f(n) = g(n) + h(n): total estimated cost used for priority ordering
 *
 * Path reconstruction uses `push + reverse` (O(P)) rather than `unshift` (O(P²)).
 *
 * Time complexity: O((V + E) log V)
 *
 * @param startUid  UID of starting node
 * @param goalUid   UID of goal node
 * @param nodes     Array of all nodes (used for heuristic lookup)
 * @param graph     Visibility graph (adjacency list)
 * @returns PathResult with path, distance, and success flag
 */
export function findPath(
  startUid: string,
  goalUid: string,
  nodes: Node[],
  graph: Graph
): PathResult {
  const nodeMap = new Map(nodes.map(n => [n.uid, n]))
  const startNode = nodeMap.get(startUid)
  const goalNode = nodeMap.get(goalUid)

  if (!startNode || !goalNode) {
    console.error('[pathfinding] Start or goal node not found')
    return { path: [], distance: 0, found: false }
  }

  if (startUid === goalUid) {
    return { path: [startNode], distance: 0, found: true }
  }

  const heuristic = (uid: string): number => {
    const node = nodeMap.get(uid)!
    return distance(
      { lat: node.lat, lng: node.lng },
      { lat: goalNode.lat, lng: goalNode.lng }
    )
  }

  const openSet = new PriorityQueue<string>()
  openSet.enqueue(startUid, 0)

  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>()
  const fScore = new Map<string, number>()

  for (const n of nodes) {
    gScore.set(n.uid, Infinity)
    fScore.set(n.uid, Infinity)
  }

  gScore.set(startUid, 0)
  fScore.set(startUid, heuristic(startUid))

  const visited = new Set<string>()

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!

    if (current === goalUid) {
      // Reconstruct path using push+reverse (O(P), not O(P²))
      const path: Node[] = []
      let uid: string | undefined = goalUid
      while (uid) {
        path.push(nodeMap.get(uid)!)
        uid = cameFrom.get(uid)
      }
      path.reverse()

      const totalDistance = gScore.get(goalUid)!
      console.log(`[pathfinding] Path found: ${path.length} nodes, distance: ${Math.round(totalDistance)}`)
      return { path, distance: totalDistance, found: true }
    }

    if (visited.has(current)) continue
    visited.add(current)

    const neighbors = graph.get(current) ?? []
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue

      const tentativeG = gScore.get(current)! + edge.cost
      if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
        cameFrom.set(edge.to, current)
        gScore.set(edge.to, tentativeG)
        fScore.set(edge.to, tentativeG + heuristic(edge.to))
        openSet.enqueue(edge.to, fScore.get(edge.to)!)
      }
    }
  }

  console.warn(`[pathfinding] No path found from ${startUid} to ${goalUid}`)
  return { path: [], distance: 0, found: false }
}

/**
 * Find the nearest bathroom node from a starting node using a single
 * Dijkstra sweep.
 *
 * A single pass from `startNode` computes shortest distances to every reachable
 * node in O((V + E) log V).  This is more efficient than running a separate
 * A* for each bathroom — O(B × (V + E) log V) for B bathrooms.
 *
 * Time complexity: O((V + E) log V)
 *
 * @param startNode  Starting node
 * @param allNodes   All nodes across all floors
 * @param graph      Navigation graph
 * @returns The nearest reachable bathroom node, or undefined if none found
 */
export function findNearestBathroom(
  startNode: Node,
  allNodes: Node[],
  graph: Graph
): Node | undefined {
  const bathrooms = allNodes.filter(n => n.type === 'bathroom')

  if (bathrooms.length === 0) {
    console.warn('[pathfinding] No bathrooms found')
    return undefined
  }

  const dist = new Map<string, number>()
  const open = new PriorityQueue<string>()
  const visited = new Set<string>()

  dist.set(startNode.uid, 0)
  open.enqueue(startNode.uid, 0)

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
    console.log(`[pathfinding] Nearest bathroom: ${nearest.rooms[0]} at distance ${Math.round(minDistance)}`)
  } else {
    console.warn('[pathfinding] No reachable bathrooms found')
  }

  return nearest
}
