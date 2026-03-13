/**
 * Visibility graph construction for A* pathfinding.
 *
 * Two nodes are connected when:
 *   1. Their Euclidean distance is ≤ `maxDistance` (default: 800 px).
 *   2. No wall segment intersects the straight line between them
 *      (line-of-sight check via `hasLineOfSight` in `geometry.ts`).
 *
 * Per-floor RBush spatial indices (`buildWallIndices`) narrow candidate walls
 * from O(W) to O(log W + k) per node pair.
 *
 * Traffic zones inflate edge costs via `applyZoneCost` — they do NOT block
 * edges, they only discourage routing through congested areas.
 *
 * Cross-floor connections are handled after the main loop by `addStairwayConnections`,
 * which links stairway node pairs by name (or UID for legacy data).
 */

import RBush, { type BBox } from 'rbush'
import type { Node, Wall, Graph, Edge, TrafficZone } from './types'
import { hasLineOfSight, distance } from './geometry'
import { MAP_CONFIG } from './constants'
import { graphLogger } from './logger'

// ---------------------------------------------------------------------------
// Spatial index helpers
// ---------------------------------------------------------------------------

interface WallBBox extends BBox {
  wall: Wall
}

/**
 * Build a per-floor map of RBush spatial indices for walls.
 * Querying the index for the bounding box of a node-pair segment reduces the
 * number of walls checked by hasLineOfSight from O(W) to O(log W + k).
 */
function buildWallIndices(walls: Wall[]): Map<string, RBush<WallBBox>> {
  const indices = new Map<string, RBush<WallBBox>>()

  for (const wall of walls) {
    const floor = wall.floor ?? '__none__'
    if (!indices.has(floor)) {
      indices.set(floor, new RBush<WallBBox>())
    }

    const item: WallBBox = {
      minX: Math.min(wall.start.lng, wall.end.lng),
      minY: Math.min(wall.start.lat, wall.end.lat),
      maxX: Math.max(wall.start.lng, wall.end.lng),
      maxY: Math.max(wall.start.lat, wall.end.lat),
      wall,
    }
    indices.get(floor)!.insert(item)
  }

  return indices
}

/**
 * Return only the walls whose bounding box overlaps the bounding box of the
 * segment from p1 to p2 (expanded by a tiny epsilon to catch touching walls).
 */
function queryCandidateWalls(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number },
  index: RBush<WallBBox>
): Wall[] {
  const minX = Math.min(p1.lng, p2.lng)
  const minY = Math.min(p1.lat, p2.lat)
  const maxX = Math.max(p1.lng, p2.lng)
  const maxY = Math.max(p1.lat, p2.lat)

  return index.search({ minX, minY, maxX, maxY }).map(item => item.wall)
}

// ---------------------------------------------------------------------------
// Traffic zone helpers
// ---------------------------------------------------------------------------

/**
 * Return the highest cost multiplier for an edge based on whether either
 * endpoint falls inside any traffic zone on the same floor.
 */
function applyZoneCost(
  baseCost: number,
  n1: Node,
  n2: Node,
  zones: TrafficZone[]
): number {
  if (zones.length === 0) return baseCost

  let multiplier = 1.0

  for (const zone of zones) {
    const nodeFloor = n1.floor ?? n2.floor
    if (nodeFloor && zone.floor !== nodeFloor) continue

    const b = zone.bounds
    const n1Inside =
      n1.lat >= b.minLat && n1.lat <= b.maxLat &&
      n1.lng >= b.minLng && n1.lng <= b.maxLng
    const n2Inside =
      n2.lat >= b.minLat && n2.lat <= b.maxLat &&
      n2.lng >= b.minLng && n2.lng <= b.maxLng

    if (n1Inside || n2Inside) {
      if (zone.intensity > multiplier) multiplier = zone.intensity
    }
  }

  return baseCost * multiplier
}

/**
 * Build a visibility graph from nodes and walls
 * 
 * A visibility graph connects two nodes if:
 * - There is a direct line of sight between them (no walls blocking)
 * - They are within a maximum distance threshold (prevents long shortcuts)
 * - The edge weight is the Euclidean distance between nodes
 *
 * If traffic zones are provided, edges whose endpoints fall inside a zone have
 * their cost inflated by the highest applicable multiplier.
 * 
 * @param nodes Array of navigation nodes
 * @param walls Array of wall segments
 * @param maxDistance Maximum distance for connections (default: 800 pixels, ~hallway length)
 * @param zones Optional traffic zones; inflates edge costs for congested areas
 * @returns Graph as an adjacency list (Map of node UID to edges)
 */
export function buildVisibilityGraph(
  nodes: Node[], 
  walls: Wall[],
  maxDistance: number = 800,
  zones: TrafficZone[] = []
): Graph {
  const graph: Graph = new Map()
  
  // Initialize empty adjacency list for each node
  nodes.forEach(node => {
    graph.set(node.uid, [])
  })
  
  graphLogger.log(`Building visibility graph for ${nodes.length} nodes and ${walls.length} walls...`)
  graphLogger.log(`Max connection distance: ${maxDistance} pixels`)
  
  // Build per-floor spatial indices for fast candidate wall lookup
  const wallIndices = buildWallIndices(walls)
  // Fallback index containing all walls (for nodes without floor info)
  const allWallsIndex = new RBush<WallBBox>()
  for (const wall of walls) {
    allWallsIndex.insert({
      minX: Math.min(wall.start.lng, wall.end.lng),
      minY: Math.min(wall.start.lat, wall.end.lat),
      maxX: Math.max(wall.start.lng, wall.end.lng),
      maxY: Math.max(wall.start.lat, wall.end.lat),
      wall,
    })
  }

  graphLogger.log(`Walls indexed by floor:`, Array.from(wallIndices.entries()).map(([f, idx]) => `Floor ${f}: ${idx.all().length} walls`))
  
  // Check each pair of nodes
  let edgesAdded = 0
  let edgesSkippedDistance = 0
  let edgesSkippedWalls = 0
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i]
      const n2 = nodes[j]
      
      const p1 = { lat: n1.lat, lng: n1.lng }
      const p2 = { lat: n2.lat, lng: n2.lng }
      
      const dist = distance(p1, p2)
      
      // Skip if too far apart (prevents long shortcuts)
      if (dist > maxDistance) {
        edgesSkippedDistance++
        continue
      }
      
      // Resolve the spatial index and query candidate walls for this segment
      let candidateWalls: Wall[]
      
      if (n1.floor && n2.floor) {
        if (n1.floor === n2.floor) {
          const idx = wallIndices.get(n1.floor)
          candidateWalls = idx ? queryCandidateWalls(p1, p2, idx) : []
        } else {
          // Different floors — stairways handle cross-floor connections
          edgesSkippedDistance++
          continue
        }
      } else if (n1.floor) {
        const idx = wallIndices.get(n1.floor)
        candidateWalls = idx ? queryCandidateWalls(p1, p2, idx) : []
      } else if (n2.floor) {
        const idx = wallIndices.get(n2.floor)
        candidateWalls = idx ? queryCandidateWalls(p1, p2, idx) : []
      } else {
        // No floor info — query the all-walls index
        candidateWalls = queryCandidateWalls(p1, p2, allWallsIndex)
      }
      
      // Check if there's a clear line of sight (only against candidate walls)
      if (hasLineOfSight(p1, p2, candidateWalls)) {
        const cost = applyZoneCost(dist, n1, n2, zones)
        graph.get(n1.uid)!.push({ to: n2.uid, cost })
        graph.get(n2.uid)!.push({ to: n1.uid, cost })
        edgesAdded++
      } else {
        edgesSkippedWalls++
      }
    }
  }
  
  graphLogger.log(`Visibility graph built:`)
  graphLogger.log(`  - ${edgesAdded} edges added`)
  graphLogger.log(`  - ${edgesSkippedDistance} skipped (too far / different floors)`)
  graphLogger.log(`  - ${edgesSkippedWalls} skipped (walls blocking)`)
  
  // Add stairway connections (cross-floor portals)
  addStairwayConnections(nodes, graph)
  
  // Log nodes with no connections (isolated)
  const isolated = Array.from(graph.entries())
    .filter(([_, edges]) => edges.length === 0)
    .map(([uid, _]) => uid)
  
  if (isolated.length > 0) {
    graphLogger.warn(`Warning: ${isolated.length} isolated nodes (no connections)`)
    isolated.forEach(uid => {
      const node = nodes.find(n => n.uid === uid)
      if (node) {
        graphLogger.warn(`  - ${node.rooms.join(', ')} at (${node.lat}, ${node.lng})`)
      }
    })
  }
  
  return graph
}

/**
 * Add cross-floor connections via stairways
 * Stairways act as "portals" between floors
 * 
 * Connections can be specified by either:
 * - UID (legacy support)
 * - Stairway name (user-friendly, recommended)
 * 
 * @param nodes Array of all nodes
 * @param graph Graph to add connections to
 */
function addStairwayConnections(nodes: Node[], graph: Graph): void {
  // Find all stairway nodes
  const stairways = nodes.filter(n => n.type === "stairway")
  
  if (stairways.length === 0) {
    graphLogger.log('No stairways found - single floor navigation only')
    return
  }
  
  graphLogger.log(`Adding stairway connections for ${stairways.length} stairways...`)
  graphLogger.log('Stairways:', stairways.map(s => ({ name: s.rooms[0], floor: s.floor, uid: s.uid, connectsTo: s.connectsTo })))
  
  let connectionsAdded = 0
  
  for (const stairway of stairways) {
    graphLogger.log(`Processing stairway: ${stairway.rooms[0]} (Floor ${stairway.floor})`)
    
    if (!stairway.connectsTo || stairway.connectsTo.length === 0) {
      graphLogger.log(`  -> No connections defined`)
      continue
    }
    
    graphLogger.log(`  -> Looking for connections: ${stairway.connectsTo}`)
    
    // Connect this stairway to each connected floor's stairway
    for (const targetIdentifier of stairway.connectsTo) {
      graphLogger.log(`  -> Searching for: "${targetIdentifier}"`)
      
      // Try to find target by UID first
      let targetNode = nodes.find(n => n.uid === targetIdentifier)
      
      if (targetNode) {
        graphLogger.log(`  -> Found by UID: ${targetNode.rooms[0]} (Floor ${targetNode.floor})`)
      }
      
      // If not found by UID, try to find by stairway name
      if (!targetNode) {
        graphLogger.log(`  -> Not found by UID, searching by name on different floors...`)
        targetNode = nodes.find(n => 
          n.type === "stairway" && 
          n.rooms.some(room => room === targetIdentifier) &&
          n.floor !== stairway.floor  // Must be on different floor
        )
        if (targetNode) {
          graphLogger.log(`  -> Found by name: ${targetNode.rooms[0]} (Floor ${targetNode.floor}, UID: ${targetNode.uid})`)
        }
      }
      
      if (!targetNode) {
        graphLogger.warn(`  -> [NOT FOUND] Stairway connection not found: "${targetIdentifier}" (referenced by ${stairway.rooms[0]})`)
        continue
      }
      
      // Skip if trying to connect to itself
      if (targetNode.uid === stairway.uid) {
        graphLogger.warn(`  -> Stairway ${stairway.rooms[0]} trying to connect to itself - skipping`)
        continue
      }
      
      graphLogger.log(`  -> [OK] Creating connection between ${stairway.uid} and ${targetNode.uid}`)
      
      // Add bidirectional connection with stair cost from MAP_CONFIG
      const stairCost = MAP_CONFIG.STAIR_COST
      
      // From current floor to target floor
      if (!graph.has(stairway.uid)) {
        graph.set(stairway.uid, [])
      }
      graph.get(stairway.uid)!.push({
        to: targetNode.uid,
        cost: stairCost
      })
      
      // From target floor to current floor
      if (!graph.has(targetNode.uid)) {
        graph.set(targetNode.uid, [])
      }
      graph.get(targetNode.uid)!.push({
        to: stairway.uid,
        cost: stairCost
      })
      
      graphLogger.log(`  -> Connected: ${stairway.rooms[0]} (Floor ${stairway.floor}) ↔ ${targetNode.rooms[0]} (Floor ${targetNode.floor})`)
      connectionsAdded++
    }
  }
  
  if (connectionsAdded > 0) {
    graphLogger.log(`[OK] Added ${connectionsAdded} stairway connections`)
  } else {
    graphLogger.warn('[WARN] No stairway connections were added!')
  }
}

/**
 * Get statistics about the graph.
 *
 * Edges are deduplicated using a canonical key (`minUid:maxUid`) before
 * counting.  This is necessary because `buildVisibilityGraph` stores both
 * directions of each edge, so the raw adjacency list double-counts every edge.
 *
 * @param graph The graph to analyse.
 * @returns Object with node count, unique edge count, and degree statistics.
 */
export function getGraphStats(graph: Graph): {
  nodes: number
  edges: number
  avgDegree: number
  maxDegree: number
  minDegree: number
} {
  const nodes = graph.size
  let totalDegree = 0
  let maxDegree = 0
  let minDegree = Infinity
  const edgeKeys = new Set<string>()

  for (const [uid, edges] of graph.entries()) {
    const degree = edges.length
    totalDegree += degree
    maxDegree = Math.max(maxDegree, degree)
    minDegree = Math.min(minDegree, degree)

    for (const edge of edges) {
      // Canonical key: smaller UID first — deduplicates both directions and re-run duplicates
      const key = uid < edge.to ? `${uid}:${edge.to}` : `${edge.to}:${uid}`
      edgeKeys.add(key)
    }
  }

  return {
    nodes,
    edges: edgeKeys.size,
    avgDegree: nodes > 0 ? totalDegree / nodes : 0,
    maxDegree,
    minDegree: minDegree === Infinity ? 0 : minDegree
  }
}
