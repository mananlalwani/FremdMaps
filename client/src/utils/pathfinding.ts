/**
 * A* Pathfinding Algorithm
 * Finds the shortest path between two nodes in a graph
 */

import type { Node, Graph, PathResult } from './types'
import { distance } from './geometry'

/**
 * Priority Queue implementation using binary min-heap for A*
 * Items are dequeued in order of lowest priority value
 * Time complexity: O(log N) for enqueue/dequeue vs O(N log N) for array sort
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
  
  size(): number {
    return this.heap.length
  }
  
  // Helper: Move element up to maintain heap property
  private bubbleUp(index: number): void {
    if (index === 0) return
    
    const parentIndex = Math.floor((index - 1) / 2)
    if (this.heap[index].priority < this.heap[parentIndex].priority) {
      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      this.bubbleUp(parentIndex)
    }
  }
  
  // Helper: Move element down to maintain heap property
  private bubbleDown(index: number): void {
    const leftChild = 2 * index + 1
    const rightChild = 2 * index + 2
    let smallest = index
    
    if (leftChild < this.heap.length && 
        this.heap[leftChild].priority < this.heap[smallest].priority) {
      smallest = leftChild
    }
    
    if (rightChild < this.heap.length && 
        this.heap[rightChild].priority < this.heap[smallest].priority) {
      smallest = rightChild
    }
    
    if (smallest !== index) {
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]]
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
  // Create map for quick node lookup
  const nodeMap = new Map(nodes.map(n => [n.uid, n]))
  const startNode = nodeMap.get(startUid)
  const goalNode = nodeMap.get(goalUid)
  
  // Validate inputs
  if (!startNode || !goalNode) {
    console.error('Start or goal node not found')
    return { path: [], distance: 0, found: false }
  }
  
  if (startUid === goalUid) {
    return { path: [startNode], distance: 0, found: true }
  }
  
  // Heuristic function: straight-line distance to goal
  const heuristic = (uid: string): number => {
    const node = nodeMap.get(uid)!
    return distance(
      { lat: node.lat, lng: node.lng },
      { lat: goalNode.lat, lng: goalNode.lng }
    )
  }
  
  // Initialize data structures
  const openSet = new PriorityQueue<string>()
  openSet.enqueue(startUid, 0)
  
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>()
  const fScore = new Map<string, number>()
  
  // Initialize all scores to infinity
  nodes.forEach(n => {
    gScore.set(n.uid, Infinity)
    fScore.set(n.uid, Infinity)
  })
  
  // Start node has g-score of 0
  gScore.set(startUid, 0)
  fScore.set(startUid, heuristic(startUid))
  
  const visited = new Set<string>()
  
  // A* main loop
  while (!openSet.isEmpty()) {
    const current = openSet.dequeue()!
    
    // Goal reached - reconstruct path
    if (current === goalUid) {
      const path: Node[] = []
      let uid: string | undefined = goalUid
      
      while (uid) {
        path.unshift(nodeMap.get(uid)!)
        uid = cameFrom.get(uid)
      }
      
      const totalDistance = gScore.get(goalUid)!
      
      console.log(`Path found: ${path.length} nodes, distance: ${Math.round(totalDistance)}`)
      
      return {
        path,
        distance: totalDistance,
        found: true
      }
    }
    
    // Skip if already visited
    if (visited.has(current)) {
      continue
    }
    visited.add(current)
    
    // Check all neighbors
    const neighbors = graph.get(current) || []
    
    for (const edge of neighbors) {
      const neighborUid = edge.to
      
      // Skip if already visited
      if (visited.has(neighborUid)) {
        continue
      }
      
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
  console.warn(`No path found from ${startUid} to ${goalUid}`)
  return { path: [], distance: 0, found: false }
}

/**
 * Find the nearest node to a given room number
 * Useful for searching by room name
 */
export function findNodeByRoom(roomNumber: string, nodes: Node[]): Node | undefined {
  return nodes.find(node => 
    node.rooms.some(room => 
      room.toLowerCase() === roomNumber.toLowerCase()
    )
  )
}

/**
 * Find all nodes that match a room search query
 * Supports partial matching
 */
export function searchNodesByRoom(query: string, nodes: Node[]): Node[] {
  const lowerQuery = query.toLowerCase().trim()
  
  return nodes.filter(node =>
    node.rooms.some(room =>
      room.toLowerCase().includes(lowerQuery)
    )
  )
}

/**
 * Find the nearest bathroom to a given node
 * Uses actual pathfinding distance (not straight-line) to account for walls and floor changes
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
  const bathrooms = allNodes.filter(n => n.type === "bathroom")
  
  if (bathrooms.length === 0) {
    console.warn('No bathrooms found')
    return undefined
  }
  
  // If no graph provided, use straight-line distance as fallback
  if (!graph) {
    console.log('No graph provided, using straight-line distance')
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
    
    console.log(`Found nearest bathroom: ${nearest?.rooms[0]} at ${Math.round(minDistance)} units away (straight-line)`)
    return nearest
  }
  
  // Use actual pathfinding distance to find truly nearest bathroom
  let nearest: Node | undefined
  let minDistance = Infinity
  
  for (const bathroom of bathrooms) {
    const result = findPath(startNode.uid, bathroom.uid, allNodes, graph)
    
    if (result.found && result.distance < minDistance) {
      minDistance = result.distance
      nearest = bathroom
    }
  }
  
  if (nearest) {
    console.log(`Found nearest bathroom: ${nearest.rooms[0]} at ${Math.round(minDistance)} units away (actual path${nearest.floor !== startNode.floor ? ', cross-floor' : ''})`)
  } else {
    console.warn('No reachable bathrooms found')
  }
  
  return nearest
}
