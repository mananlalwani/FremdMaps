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
import type { Node, Wall, Graph, TrafficZone } from './types'
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
  const itemsByFloor = new Map<string, WallBBox[]>()

  for (const wall of walls) {
    const floor = wall.floor ?? '__none__'
    let list = itemsByFloor.get(floor)
    if (!list) {
      list = []
      itemsByFloor.set(floor, list)
    }

    list.push({
      minX: Math.min(wall.start.lng, wall.end.lng),
      minY: Math.min(wall.start.lat, wall.end.lat),
      maxX: Math.max(wall.start.lng, wall.end.lng),
      maxY: Math.max(wall.start.lat, wall.end.lat),
      wall,
    })
  }

  const indices = new Map<string, RBush<WallBBox>>()
  for (const [floor, items] of itemsByFloor) {
    const index = new RBush<WallBBox>()
    index.load(items)
    indices.set(floor, index)
  }

  return indices
}

/**
 * Return only the walls whose bounding box overlaps the node-pair segment.
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

  return index.search({ minX, minY, maxX, maxY }).map((item) => item.wall)
}

// ---------------------------------------------------------------------------
// Traffic zone helpers
// ---------------------------------------------------------------------------

/**
 * Return the highest cost multiplier for an edge based on whether either
 * endpoint falls inside any traffic zone on the same floor.
 */
function applyZoneCost(baseCost: number, n1: Node, n2: Node, zones: TrafficZone[]): number {
  if (zones.length === 0) return baseCost

  let multiplier = 1.0

  for (const zone of zones) {
    const nodeFloor = n1.floor ?? n2.floor
    if (nodeFloor && zone.floor !== nodeFloor) continue

    const b = zone.bounds
    const n1Inside =
      n1.lat >= b.minLat && n1.lat <= b.maxLat && n1.lng >= b.minLng && n1.lng <= b.maxLng
    const n2Inside =
      n2.lat >= b.minLat && n2.lat <= b.maxLat && n2.lng >= b.minLng && n2.lng <= b.maxLng

    if (n1Inside || n2Inside) {
      if (zone.intensity > multiplier) multiplier = zone.intensity
    }
  }

  return baseCost * multiplier
}

/**
 * Prefer the orthogonal hallway segments used by the floor plans.
 *
 * Any diagonal edge receives a 10% cost increase; a horizontal or vertical
 * edge receives none. This makes a small coordinate drift meaningfully less
 * desirable when an orthogonal alternative is available.
 */
function applyAxisAlignmentPreference(baseCost: number, n1: Node, n2: Node): number {
  const latDelta = Math.abs(n2.lat - n1.lat)
  const lngDelta = Math.abs(n2.lng - n1.lng)

  if (latDelta < 1 || lngDelta < 1) return baseCost

  return baseCost * (1 + MAP_CONFIG.AXIS_ALIGNMENT_PENALTY)
}

/**
 * Build a visibility graph from nodes and walls
 *
 * A visibility graph connects two nodes if:
 * - There is a direct line of sight between them (no walls blocking)
 * - They are within a maximum distance threshold (prevents long shortcuts)
 * - The edge weight is the Euclidean distance, adjusted for diagonal segments
 *   to favor axis-aligned hallway routes when an orthogonal alternative exists
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
  nodes.forEach((node) => {
    graph.set(node.uid, [])
  })

  graphLogger.log(
    `Building visibility graph for ${nodes.length} nodes and ${walls.length} walls...`
  )
  graphLogger.log(`Max connection distance: ${maxDistance} pixels`)

  // Build per-floor spatial indices for fast candidate wall lookup
  const wallIndices = buildWallIndices(walls)

  graphLogger.log(
    `Walls indexed by floor:`,
    Array.from(wallIndices.entries()).map(([f, idx]) => `Floor ${f}: ${idx.all().length} walls`)
  )

  // Partition nodes by floor for 2x faster candidate pairing
  const nodesByFloor = new Map<string, Node[]>()
  const unassignedNodes: Node[] = []

  for (const node of nodes) {
    if (node.floor) {
      let floorList = nodesByFloor.get(node.floor)
      if (!floorList) {
        floorList = []
        nodesByFloor.set(node.floor, floorList)
      }
      floorList.push(node)
    } else {
      unassignedNodes.push(node)
    }
  }

  // Only floorless-to-floorless pairs need a combined wall index. Runtime-loaded
  // nodes are floor-tagged, so avoid building and retaining a duplicate index in
  // the normal path.
  let allWallsIndex: RBush<WallBBox> | undefined
  if (unassignedNodes.length > 1) {
    allWallsIndex = new RBush<WallBBox>()
    allWallsIndex.load(
      walls.map((wall) => ({
        minX: Math.min(wall.start.lng, wall.end.lng),
        minY: Math.min(wall.start.lat, wall.end.lat),
        maxX: Math.max(wall.start.lng, wall.end.lng),
        maxY: Math.max(wall.start.lat, wall.end.lat),
        wall,
      }))
    )
  }

  let edgesAdded = 0
  let edgesSkippedDistance = 0
  let edgesSkippedWalls = 0

  const evaluatePair = (n1: Node, n2: Node, idx: RBush<WallBBox> | undefined): void => {
    const dist = distance(n1, n2)
    if (dist > maxDistance) {
      edgesSkippedDistance++
      return
    }

    const candidateWalls = idx ? queryCandidateWalls(n1, n2, idx) : []
    if (hasLineOfSight(n1, n2, candidateWalls)) {
      const alignedCost = applyAxisAlignmentPreference(dist, n1, n2)
      const cost = applyZoneCost(alignedCost, n1, n2, zones)
      graph.get(n1.uid)!.push({ to: n2.uid, cost })
      graph.get(n2.uid)!.push({ to: n1.uid, cost })
      edgesAdded++
    } else {
      edgesSkippedWalls++
    }
  }

  // Check same-floor pairs
  for (const [floor, floorNodes] of nodesByFloor) {
    const idx = wallIndices.get(floor)
    for (let i = 0; i < floorNodes.length; i++) {
      for (let j = i + 1; j < floorNodes.length; j++) {
        evaluatePair(floorNodes[i], floorNodes[j], idx)
      }
    }
  }

  // Fallback for unassigned floor nodes (if any)
  if (unassignedNodes.length > 0) {
    for (let i = 0; i < unassignedNodes.length; i++) {
      const n1 = unassignedNodes[i]
      for (let j = i + 1; j < unassignedNodes.length; j++) {
        evaluatePair(n1, unassignedNodes[j], allWallsIndex)
      }
      for (const node of nodes) {
        if (node.floor) {
          evaluatePair(n1, node, wallIndices.get(node.floor))
        }
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
    .map(([uid]) => uid)

  if (isolated.length > 0) {
    graphLogger.warn(`Warning: ${isolated.length} isolated nodes (no connections)`)
    const nodesByUid = new Map(nodes.map((node) => [node.uid, node]))
    for (const uid of isolated) {
      const node = nodesByUid.get(uid)
      if (node) {
        graphLogger.warn(`  - ${node.rooms.join(', ')} at (${node.lat}, ${node.lng})`)
      }
    }
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
  const stairways = nodes.filter((n) => n.type === 'stairway')

  if (stairways.length === 0) {
    graphLogger.log('No stairways found - single floor navigation only')
    return
  }

  graphLogger.log(`Adding stairway connections for ${stairways.length} stairways...`)
  graphLogger.log(
    'Stairways:',
    stairways.map((s) => ({
      name: s.rooms[0],
      floor: s.floor,
      uid: s.uid,
      connectsTo: s.connectsTo,
    }))
  )

  let connectionsAdded = 0
  const connectedPairs = new Set<string>()

  for (const stairway of stairways) {
    graphLogger.log(`Processing stairway: ${stairway.rooms[0]} (Floor ${stairway.floor})`)

    if (!stairway.connectsTo || stairway.connectsTo.length === 0) {
      graphLogger.log(`  -> No connections defined`)
      continue
    }

    graphLogger.log(`  -> Looking for connections: ${stairway.connectsTo.join(', ')}`)

    // Connect this stairway to each connected floor's stairway
    for (const targetIdentifier of stairway.connectsTo) {
      graphLogger.log(`  -> Searching for: "${targetIdentifier}"`)

      // Try to find target by UID first
      let targetNode = nodes.find((n) => n.uid === targetIdentifier)

      if (targetNode) {
        graphLogger.log(`  -> Found by UID: ${targetNode.rooms[0]} (Floor ${targetNode.floor})`)
      }

      // If not found by UID, try to find by stairway name
      if (!targetNode) {
        graphLogger.log(`  -> Not found by UID, searching by name on different floors...`)
        targetNode = nodes.find(
          (n) =>
            n.type === 'stairway' &&
            n.rooms.some((room) => room === targetIdentifier) &&
            n.floor !== stairway.floor // Must be on different floor
        )
        if (targetNode) {
          graphLogger.log(
            `  -> Found by name: ${targetNode.rooms[0]} (Floor ${targetNode.floor}, UID: ${targetNode.uid})`
          )
        }
      }

      if (!targetNode) {
        graphLogger.warn(
          `  -> [NOT FOUND] Stairway connection not found: "${targetIdentifier}" (referenced by ${stairway.rooms[0]})`
        )
        continue
      }

      // Skip if trying to connect to itself
      if (targetNode.uid === stairway.uid) {
        graphLogger.warn(
          `  -> Stairway ${stairway.rooms[0]} trying to connect to itself - skipping`
        )
        continue
      }

      // Deduplicate: skip if this directed pair has already been connected
      // (both stairways may declare each other in their `connectsTo` arrays,
      // which would otherwise add bidirectional edges twice).
      const pairKey =
        stairway.uid < targetNode.uid
          ? `${stairway.uid}:${targetNode.uid}`
          : `${targetNode.uid}:${stairway.uid}`
      if (connectedPairs.has(pairKey)) {
        graphLogger.log(`  -> [SKIP] Already connected pair ${pairKey}`)
        continue
      }
      connectedPairs.add(pairKey)

      graphLogger.log(`  -> [OK] Creating connection between ${stairway.uid} and ${targetNode.uid}`)

      // Add bidirectional connection with stair cost from MAP_CONFIG
      const stairCost = MAP_CONFIG.STAIR_COST

      // From current floor to target floor
      if (!graph.has(stairway.uid)) {
        graph.set(stairway.uid, [])
      }
      graph.get(stairway.uid)!.push({
        to: targetNode.uid,
        cost: stairCost,
      })

      // From target floor to current floor
      if (!graph.has(targetNode.uid)) {
        graph.set(targetNode.uid, [])
      }
      graph.get(targetNode.uid)!.push({
        to: stairway.uid,
        cost: stairCost,
      })

      graphLogger.log(
        `  -> Connected: ${stairway.rooms[0]} (Floor ${stairway.floor}) ↔ ${targetNode.rooms[0]} (Floor ${targetNode.floor})`
      )
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
export interface GraphStats {
  nodes: number
  edges: number
  avgDegree: number
  maxDegree: number
  minDegree: number
}

export function getGraphStats(graph: Graph): GraphStats {
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
    minDegree: minDegree === Infinity ? 0 : minDegree,
  }
}
