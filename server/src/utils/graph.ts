/**
 * Graph construction for pathfinding (server-side copy).
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
 * Cross-floor connections are handled after the main loop by
 * `addStairwayConnections`, which links stairway node pairs by name
 * (or UID for legacy data).
 *
 * Must be kept in sync with `client/src/utils/graph.ts`.
 */

import RBush, { type BBox } from 'rbush'
import type { Node, Wall, Graph, Edge, TrafficZone } from './types'
import { hasLineOfSight, distance } from './geometry'
import { MAP_CONFIG } from './constants'

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
    indices.get(floor)!.insert({
      minX: Math.min(wall.start.lng, wall.end.lng),
      minY: Math.min(wall.start.lat, wall.end.lat),
      maxX: Math.max(wall.start.lng, wall.end.lng),
      maxY: Math.max(wall.start.lat, wall.end.lat),
      wall,
    })
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
  return index
    .search({
      minX: Math.min(p1.lng, p2.lng),
      minY: Math.min(p1.lat, p2.lat),
      maxX: Math.max(p1.lng, p2.lng),
      maxY: Math.max(p1.lat, p2.lat),
    })
    .map(item => item.wall)
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
 * Build a visibility graph from nodes and walls.
 *
 * Two nodes are connected when:
 * - They are on the same floor (or both lack floor info)
 * - Their Euclidean distance is ≤ maxDistance
 * - No wall segment blocks the straight-line path between them
 *
 * If traffic zones are provided, edges whose endpoints fall inside a zone have
 * their cost inflated by the highest applicable multiplier, causing A* to
 * prefer routing around congested areas.
 *
 * Cross-floor connections are added separately via addStairwayConnections.
 *
 * Time complexity: O(N² × (log W + k)) where N = nodes, W = walls,
 * k = average candidate walls per segment bounding-box query.
 *
 * @param nodes  All nodes across all floors
 * @param walls  All wall segments across all floors (with .floor set)
 * @param maxDistance  Maximum allowed edge length in map pixels (default 800)
 * @param zones  Optional traffic zones; inflates edge costs for congested areas
 */
export function buildVisibilityGraph(
  nodes: Node[],
  walls: Wall[],
  maxDistance: number = 800,
  zones: TrafficZone[] = []
): Graph {
  const graph: Graph = new Map()

  for (const node of nodes) {
    graph.set(node.uid, [])
  }

  console.log(
    `[graph] Building visibility graph: ${nodes.length} nodes, ${walls.length} walls, maxDist=${maxDistance}`
  )

  const wallIndices = buildWallIndices(walls)

  // Fallback index: all walls together (for nodes without floor info)
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

  let edgesAdded = 0
  let edgesSkipped = 0

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i]
      const n2 = nodes[j]

      const p1 = { lat: n1.lat, lng: n1.lng }
      const p2 = { lat: n2.lat, lng: n2.lng }

      const dist = distance(p1, p2)
      if (dist > maxDistance) {
        edgesSkipped++
        continue
      }

      // Different floors: skip (stairways handle cross-floor links)
      if (n1.floor && n2.floor && n1.floor !== n2.floor) {
        edgesSkipped++
        continue
      }

      let candidateWalls: Wall[]

      if (n1.floor && n2.floor && n1.floor === n2.floor) {
        const idx = wallIndices.get(n1.floor)
        candidateWalls = idx ? queryCandidateWalls(p1, p2, idx) : []
      } else if (n1.floor) {
        const idx = wallIndices.get(n1.floor)
        candidateWalls = idx ? queryCandidateWalls(p1, p2, idx) : []
      } else if (n2.floor) {
        const idx = wallIndices.get(n2.floor)
        candidateWalls = idx ? queryCandidateWalls(p1, p2, idx) : []
      } else {
        candidateWalls = queryCandidateWalls(p1, p2, allWallsIndex)
      }

      if (hasLineOfSight(p1, p2, candidateWalls)) {
        const cost = applyZoneCost(dist, n1, n2, zones)
        graph.get(n1.uid)!.push({ to: n2.uid, cost })
        graph.get(n2.uid)!.push({ to: n1.uid, cost })
        edgesAdded++
      } else {
        edgesSkipped++
      }
    }
  }

  console.log(`[graph] Built: ${edgesAdded} edges added, ${edgesSkipped} skipped`)

  addStairwayConnections(nodes, graph)

  // Warn about isolated nodes
  const isolated = Array.from(graph.entries())
    .filter(([, edges]) => edges.length === 0)
    .map(([uid]) => uid)

  if (isolated.length > 0) {
    console.warn(`[graph] ${isolated.length} isolated nodes (no connections)`)
  }

  return graph
}

/**
 * Add cross-floor stairway connections to an existing graph.
 *
 * Stairways act as "portals" between floors.  Each stairway node's
 * `connectsTo` array lists the counterpart(s) on other floors either by:
 *   - UID (legacy support — exact match on `node.uid`)
 *   - Stairway name (recommended — matches a `rooms` entry on a stairway node
 *     that is on a different floor)
 *
 * Bidirectional edges are added with a fixed cost of `MAP_CONFIG.STAIR_COST`
 * (higher than a typical corridor segment to avoid spurious cross-floor
 * detours when a same-floor route exists).
 *
 * @param nodes  All nodes across all floors
 * @param graph  Graph to mutate — stairway edges are pushed into the adjacency lists
 */
function addStairwayConnections(nodes: Node[], graph: Graph): void {
  const stairways = nodes.filter(n => n.type === 'stairway')

  if (stairways.length === 0) {
    console.log('[graph] No stairways — single-floor navigation only')
    return
  }

  let connectionsAdded = 0

  for (const stairway of stairways) {
    if (!stairway.connectsTo || stairway.connectsTo.length === 0) continue

    for (const targetIdentifier of stairway.connectsTo) {
      // Try UID first, then name match on a different floor
      let targetNode = nodes.find(n => n.uid === targetIdentifier)

      if (!targetNode) {
        targetNode = nodes.find(
          n =>
            n.type === 'stairway' &&
            n.rooms.some(room => room === targetIdentifier) &&
            n.floor !== stairway.floor
        )
      }

      if (!targetNode) {
        console.warn(`[graph] Stairway connection not found: "${targetIdentifier}" (from ${stairway.rooms[0]})`)
        continue
      }

      if (targetNode.uid === stairway.uid) continue

      const stairCost = MAP_CONFIG.STAIR_COST

      if (!graph.has(stairway.uid)) graph.set(stairway.uid, [])
      if (!graph.has(targetNode.uid)) graph.set(targetNode.uid, [])

      graph.get(stairway.uid)!.push({ to: targetNode.uid, cost: stairCost })
      graph.get(targetNode.uid)!.push({ to: stairway.uid, cost: stairCost })
      connectionsAdded++
    }
  }

  if (connectionsAdded > 0) {
    console.log(`[graph] Added ${connectionsAdded} stairway connections`)
  } else {
    console.warn('[graph] No stairway connections were added')
  }
}

/**
 * Get basic statistics about a built graph.
 *
 * Edges are deduplicated using a canonical key (`minUid:maxUid`) before
 * counting.  This is necessary because `buildVisibilityGraph` stores both
 * directions of each edge, so the raw adjacency list double-counts every edge.
 *
 * @param graph  The graph to analyse.
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
      // Canonical key: smaller UID first — deduplicates both directions
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
