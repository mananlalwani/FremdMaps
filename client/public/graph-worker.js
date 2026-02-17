/**
 * Web Worker for building visibility graph
 * Runs heavy computation in background thread to prevent UI freeze
 * 
 * NOTE: This file contains duplicate implementations of geometry functions
 * from client/src/utils/geometry.ts. This duplication is intentional because:
 * 1. Web Workers cannot easily import ES modules in all browsers
 * 2. Bundling would complicate the build process
 * 3. These are pure functions that rarely change
 * 
 * If you modify geometry logic, update BOTH files:
 * - client/src/utils/geometry.ts (TypeScript source)
 * - client/public/graph-worker.js (Worker version)
 */

// Type definitions (JSDoc)

/**
 * @typedef {Object} Point
 * @property {number} lat - Latitude coordinate
 * @property {number} lng - Longitude coordinate
 */

/**
 * @typedef {Object} Node
 * @property {string} uid - Unique identifier
 * @property {string[]} rooms - Room names/numbers
 * @property {number} lat - Latitude coordinate
 * @property {number} lng - Longitude coordinate
 * @property {string} [type] - Optional node type (waypoint, bathroom, stairway)
 */

/**
 * @typedef {Object} Wall
 * @property {Point} start - Start point of wall
 * @property {Point} end - End point of wall
 */

/**
 * @typedef {Object} Edge
 * @property {string} to - Target node UID
 * @property {number} cost - Distance/weight to target node
 */

// Helper functions (copied from geometry.ts)

/**
 * Calculate Euclidean distance between two points
 * @param {Point} p1 - First point
 * @param {Point} p2 - Second point
 * @returns {number} Distance in coordinate units
 */
function distance(p1, p2) {
  const dx = p1.lng - p2.lng
  const dy = p1.lat - p2.lat
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Check if two line segments intersect
 * @param {Point} p1 - First point of first segment
 * @param {Point} q1 - Second point of first segment
 * @param {Point} p2 - First point of second segment
 * @param {Point} q2 - Second point of second segment
 * @returns {boolean} True if segments intersect
 */
function segmentsIntersect(p1, q1, p2, q2) {
  const x1 = p1.lng, y1 = p1.lat
  const x2 = q1.lng, y2 = q1.lat
  const x3 = p2.lng, y3 = p2.lat
  const x4 = q2.lng, y4 = q2.lat

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  
  if (Math.abs(denom) < 1e-10) {
    return false
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

  const epsilon = 1e-6
  return t >= epsilon && t <= (1 - epsilon) && u >= epsilon && u <= (1 - epsilon)
}

/**
 * Check if there's a clear line of sight between two points
 * @param {Point} p1 - Start point
 * @param {Point} p2 - End point
 * @param {Wall[]} walls - Array of wall segments
 * @returns {boolean} True if no walls block the line of sight
 */
function hasLineOfSight(p1, p2, walls) {
  for (const wall of walls) {
    if (segmentsIntersect(p1, p2, wall.start, wall.end)) {
      return false
    }
  }
  return true
}

// Main graph building function

/**
 * Build visibility graph for pathfinding
 * @param {Node[]} nodes - Array of navigation nodes
 * @param {Wall[]} walls - Array of wall segments
 * @param {number} [maxDistance=600] - Maximum connection distance
 * @returns {Map<string, Edge[]>} Adjacency list graph
 */
function buildVisibilityGraph(nodes, walls, maxDistance = 600) {
  const graph = new Map()

  // Initialize empty adjacency lists
  for (const node of nodes) {
    graph.set(node.uid, [])
  }

  // Check all pairs of nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i]
      const nodeB = nodes[j]

      const p1 = { lat: nodeA.lat, lng: nodeA.lng }
      const p2 = { lat: nodeB.lat, lng: nodeB.lng }

      const dist = distance(p1, p2)

      // Skip if too far apart (optimization)
      if (maxDistance && dist > maxDistance) {
        continue
      }

      // Check line of sight
      if (hasLineOfSight(p1, p2, walls)) {
        // Add bidirectional edge (using 'cost' to match Edge type definition)
        graph.get(nodeA.uid).push({ to: nodeB.uid, cost: dist })
        graph.get(nodeB.uid).push({ to: nodeA.uid, cost: dist })
      }
    }
  }

  // Add stairway connections for cross-floor navigation
  addStairwayConnections(nodes, graph)

  return graph
}

/**
 * Add cross-floor connections via stairways
 * Stairways act as "portals" between floors
 * @param {Node[]} nodes - Array of all nodes
 * @param {Map<string, Edge[]>} graph - Graph to add connections to
 */
function addStairwayConnections(nodes, graph) {
  // Find all stairway nodes
  const stairways = nodes.filter(n => n.type === "stairway")
  
  if (stairways.length === 0) {
    self.postMessage({ type: 'log', message: 'No stairways found - single floor navigation only' })
    return
  }
  
  self.postMessage({ type: 'log', message: `Adding stairway connections for ${stairways.length} stairways...` })
  
  let connectionsAdded = 0
  
  for (const stairway of stairways) {
    if (!stairway.connectsTo || stairway.connectsTo.length === 0) {
      continue
    }
    
    // Connect this stairway to each connected floor's stairway
    for (const targetIdentifier of stairway.connectsTo) {
      // Try to find target by UID first
      let targetNode = nodes.find(n => n.uid === targetIdentifier)
      
      // If not found by UID, try to find by stairway name
      if (!targetNode) {
        targetNode = nodes.find(n => 
          n.type === "stairway" && 
          n.rooms.some(room => room === targetIdentifier) &&
          n.floor !== stairway.floor  // Must be on different floor
        )
      }
      
      if (!targetNode) {
        self.postMessage({ 
          type: 'log', 
          message: `⚠️ Stairway connection not found: "${targetIdentifier}" (referenced by ${stairway.rooms[0]})` 
        })
        continue
      }
      
      // Skip if trying to connect to itself
      if (targetNode.uid === stairway.uid) {
        self.postMessage({ 
          type: 'log', 
          message: `⚠️ Stairway ${stairway.rooms[0]} trying to connect to itself - skipping` 
        })
        continue
      }
      
      // Add bidirectional connection with small cost
      // Cost is small (50) to represent stairs are quick to use
      const stairCost = 50
      
      // From current floor to target floor
      if (!graph.has(stairway.uid)) {
        graph.set(stairway.uid, [])
      }
      graph.get(stairway.uid).push({
        to: targetNode.uid,
        cost: stairCost
      })
      
      // From target floor to current floor
      if (!graph.has(targetNode.uid)) {
        graph.set(targetNode.uid, [])
      }
      graph.get(targetNode.uid).push({
        to: stairway.uid,
        cost: stairCost
      })
      
      self.postMessage({ 
        type: 'log', 
        message: `  ✅ Connected: ${stairway.rooms[0]} (Floor ${stairway.floor}) ↔ ${targetNode.rooms[0]} (Floor ${targetNode.floor})` 
      })
      connectionsAdded++
    }
  }
  
  if (connectionsAdded > 0) {
    self.postMessage({ type: 'log', message: `✅ Added ${connectionsAdded} stairway connections` })
  } else {
    self.postMessage({ type: 'log', message: '⚠️ No stairway connections were added!' })
  }
}

// Worker message handler
/**
 * @param {MessageEvent} e - Worker message event
 */
self.onmessage = function(e) {
  const { nodes, walls, maxDistance } = e.data
  
  // Only log in development (check if performance timing is detailed enough to indicate dev mode)
  const isDev = true; // Workers don't have access to import.meta.env
  
  if (isDev) {
    self.postMessage({ type: 'log', message: `Building graph for ${nodes.length} nodes, ${walls.length} walls...` })
  }
  
  const startTime = performance.now()
  const graph = buildVisibilityGraph(nodes, walls, maxDistance)
  const endTime = performance.now()
  
  if (isDev) {
    self.postMessage({ type: 'log', message: `Graph built in ${(endTime - startTime).toFixed(0)}ms` })
  }
  
  // Convert Map to plain object for transfer
  const graphObj = {}
  for (const [key, value] of graph.entries()) {
    graphObj[key] = value
  }
  
  self.postMessage({ type: 'result', graph: graphObj })
}
