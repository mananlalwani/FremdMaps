/**
 * Tests for pathfinding utilities
 * Covers A* algorithm correctness, edge cases, and PriorityQueue behavior
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { findPath, findNearestBathroom, invalidatePathCache } from './pathfinding'
import type { Node, Graph } from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(
  uid: string,
  lat: number,
  lng: number,
  rooms: string[],
  opts: Partial<Node> = {}
): Node {
  return { uid, lat, lng, rooms, type: 'room', ...opts }
}

/**
 * Build a simple graph: A─B─C (linear chain, cost = distance)
 */
function makeLinearGraph(): { nodes: Node[]; graph: Graph } {
  const A = makeNode('A', 0, 0, ['Room A'])
  const B = makeNode('B', 0, 100, ['Room B'])
  const C = makeNode('C', 0, 200, ['Room C'])
  const nodes = [A, B, C]
  const graph: Graph = new Map([
    ['A', [{ to: 'B', cost: 100 }]],
    [
      'B',
      [
        { to: 'A', cost: 100 },
        { to: 'C', cost: 100 },
      ],
    ],
    ['C', [{ to: 'B', cost: 100 }]],
  ])
  return { nodes, graph }
}

// ── findPath ─────────────────────────────────────────────────────────────────

describe('findPath', () => {
  // Clear the LRU cache before each test so results from one test
  // cannot bleed into another that reuses the same node UIDs.
  beforeEach(() => {
    invalidatePathCache()
  })
  it('returns a direct path when A→B are connected', () => {
    const { nodes, graph } = makeLinearGraph()
    const result = findPath('A', 'B', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['A', 'B'])
    expect(result.distance).toBeCloseTo(100)
  })

  it('returns a two-hop path when A→C requires passing through B', () => {
    const { nodes, graph } = makeLinearGraph()
    const result = findPath('A', 'C', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['A', 'B', 'C'])
    expect(result.distance).toBeCloseTo(200)
  })

  it('returns { found: false } when start node does not exist', () => {
    const { nodes, graph } = makeLinearGraph()
    const result = findPath('MISSING', 'B', nodes, graph)
    expect(result.found).toBe(false)
    expect(result.path).toHaveLength(0)
  })

  it('returns { found: false } when goal node does not exist', () => {
    const { nodes, graph } = makeLinearGraph()
    const result = findPath('A', 'MISSING', nodes, graph)
    expect(result.found).toBe(false)
  })

  it('returns single-node path when start === goal', () => {
    const { nodes, graph } = makeLinearGraph()
    const result = findPath('B', 'B', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path).toHaveLength(1)
    expect(result.distance).toBe(0)
  })

  it('returns { found: false } when no path exists (disconnected graph)', () => {
    const A = makeNode('A', 0, 0, ['Room A'])
    const B = makeNode('B', 0, 100, ['Room B'])
    const nodes = [A, B]
    const graph: Graph = new Map([
      ['A', []],
      ['B', []],
    ])
    const result = findPath('A', 'B', nodes, graph)
    expect(result.found).toBe(false)
  })

  it('prefers the shorter path when two routes exist', () => {
    // A connects to B (cost 50) and to C (cost 1000)
    // B connects to C (cost 50) — optimal: A→B→C = 100
    const A = makeNode('A', 0, 0, ['A'])
    const B = makeNode('B', 0, 50, ['B'])
    const C = makeNode('C', 0, 100, ['C'])
    const nodes = [A, B, C]
    const graph: Graph = new Map([
      [
        'A',
        [
          { to: 'B', cost: 50 },
          { to: 'C', cost: 1000 },
        ],
      ],
      [
        'B',
        [
          { to: 'A', cost: 50 },
          { to: 'C', cost: 50 },
        ],
      ],
      [
        'C',
        [
          { to: 'A', cost: 1000 },
          { to: 'B', cost: 50 },
        ],
      ],
    ])
    const result = findPath('A', 'C', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['A', 'B', 'C'])
    expect(result.distance).toBeCloseTo(100)
  })

  it('finds optimal cross-floor path despite planar overestimate', () => {
    // Start on floor 1, goal on floor 2.  The straight-line distance between
    // start and goal is small (50 px), but the actual path must go through a
    // stairway (cost 250 + 200 hallway) = 450.  The heuristic returns 0 for
    // cross-floor nodes, so A* must explore via stairs rather than being
    // misled by a low straight-line heuristic.
    const start = makeNode('R1', 0, 0, ['Room 101'], { floor: '1' })
    const stairF1 = makeNode('S1', 0, 100, ['Stair A'], {
      type: 'stairway',
      floor: '1',
      connectsTo: ['Stair A'],
    })
    const stairF2 = makeNode('S2', 0, 100, ['Stair A'], {
      type: 'stairway',
      floor: '2',
      connectsTo: ['Stair A'],
    })
    const goal = makeNode('R2', 0, 50, ['Room 201'], { floor: '2' })
    const nodes = [start, stairF1, stairF2, goal]
    const graph: Graph = new Map([
      ['R1', [{ to: 'S1', cost: 100 }]],
      [
        'S1',
        [
          { to: 'R1', cost: 100 },
          { to: 'S2', cost: 250 },
        ],
      ],
      [
        'S2',
        [
          { to: 'S1', cost: 250 },
          { to: 'R2', cost: 100 },
        ],
      ],
      ['R2', [{ to: 'S2', cost: 100 }]],
    ])
    const result = findPath('R1', 'R2', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['R1', 'S1', 'S2', 'R2'])
    expect(result.distance).toBeCloseTo(450)
  })

  it('handles a cross-floor stairway path', () => {
    const roomF1 = makeNode('R1', 0, 0, ['Room 101'], { floor: '1' })
    const stairF1 = makeNode('S1', 0, 100, ['Stair A'], { type: 'stairway', floor: '1' })
    const stairF2 = makeNode('S2', 0, 100, ['Stair A'], { type: 'stairway', floor: '2' })
    const roomF2 = makeNode('R2', 0, 200, ['Room 201'], { floor: '2' })
    const nodes = [roomF1, stairF1, stairF2, roomF2]
    const graph: Graph = new Map([
      ['R1', [{ to: 'S1', cost: 100 }]],
      [
        'S1',
        [
          { to: 'R1', cost: 100 },
          { to: 'S2', cost: 50 },
        ],
      ],
      [
        'S2',
        [
          { to: 'S1', cost: 50 },
          { to: 'R2', cost: 100 },
        ],
      ],
      ['R2', [{ to: 'S2', cost: 100 }]],
    ])
    const result = findPath('R1', 'R2', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['R1', 'S1', 'S2', 'R2'])
    expect(result.distance).toBeCloseTo(250)
  })
})

// ── findNearestBathroom ───────────────────────────────────────────────────────

describe('findNearestBathroom', () => {
  beforeEach(() => {
    invalidatePathCache()
  })
  const start = makeNode('start', 0, 0, ['Entrance'])
  const farBathroom = makeNode('bath-far', 0, 500, ['Bathroom Far'], { type: 'bathroom' })
  const nearBathroom = makeNode('bath-near', 0, 100, ['Bathroom Near'], { type: 'bathroom' })
  const allNodes = [start, nearBathroom, farBathroom]

  it('returns nearest bathroom by straight-line when no graph is given', () => {
    const result = findNearestBathroom(start, allNodes)
    expect(result?.uid).toBe('bath-near')
  })

  it('returns undefined when there are no bathrooms', () => {
    const result = findNearestBathroom(start, [start])
    expect(result).toBeUndefined()
  })

  it('returns nearest bathroom by actual path distance when graph is given', () => {
    // near bathroom is blocked; far bathroom is reachable
    const graph: Graph = new Map([
      ['start', [{ to: 'bath-far', cost: 500 }]],
      ['bath-far', [{ to: 'start', cost: 500 }]],
      ['bath-near', []],
    ])
    const result = findNearestBathroom(start, allNodes, graph)
    expect(result?.uid).toBe('bath-far')
  })

  it('returns undefined when all bathrooms are unreachable via graph', () => {
    const graph: Graph = new Map([
      ['start', []],
      ['bath-near', []],
      ['bath-far', []],
    ])
    const result = findNearestBathroom(start, allNodes, graph)
    expect(result).toBeUndefined()
  })
})

// ── LRU Cache ─────────────────────────────────────────────────────────────────

describe('LRU path cache', () => {
  beforeEach(() => {
    invalidatePathCache()
  })

  it('caches and returns the same result for repeated queries', () => {
    const { nodes, graph } = makeLinearGraph()
    const r1 = findPath('A', 'C', nodes, graph)
    const r2 = findPath('A', 'C', nodes, graph)
    expect(r1).toEqual(r2)
    expect(r1.found).toBe(true)
  })

  it('does not reuse a route cached for a different graph instance', () => {
    const { nodes, graph } = makeLinearGraph()
    const first = findPath('A', 'C', nodes, graph)
    expect(first.distance).toBe(200)

    const updatedGraph: Graph = new Map([
      ['A', [{ to: 'C', cost: 25 }]],
      ['B', []],
      ['C', [{ to: 'A', cost: 25 }]],
    ])
    const updated = findPath('A', 'C', nodes, updatedGraph)
    expect(updated.path.map((node) => node.uid)).toEqual(['A', 'C'])
    expect(updated.distance).toBe(25)
  })

  it('refreshes recency on cache hit (LRU promotion)', () => {
    const { nodes, graph } = makeLinearGraph()
    invalidatePathCache()
    const r1 = findPath('A', 'C', nodes, graph)
    const r2 = findPath('A', 'C', nodes, graph)
    expect(r1).toEqual(r2)
    const r3 = findPath('A', 'C', nodes, graph)
    expect(r3).toEqual(r1)
  })

  it('evicts oldest entries when cache exceeds PATH_CACHE_MAX', () => {
    const allNodes: Node[] = []
    const fullGraph = new Map<string, Array<{ to: string; cost: number }>>()
    for (let i = 0; i < 25; i++) {
      const uid = `N${i}`
      allNodes.push(makeNode(uid, 0, i * 100, [uid]))
      fullGraph.set(uid, [])
    }
    for (let i = 0; i < 24; i++) {
      const a = `N${i}`
      const b = `N${i + 1}`
      fullGraph.get(a)!.push({ to: b, cost: 100 })
      fullGraph.get(b)!.push({ to: a, cost: 100 })
    }

    for (let i = 0; i < 24; i++) {
      const result = findPath(`N${i}`, `N${i + 1}`, allNodes, fullGraph)
      expect(result.found).toBe(true)
    }

    const recent = findPath('N23', 'N22', allNodes, fullGraph)
    expect(recent.found).toBe(true)
    expect(recent.path).toHaveLength(2)

    const evicted = findPath('N0', 'N1', allNodes, fullGraph)
    expect(evicted.found).toBe(true)
    expect(evicted.path).toHaveLength(2)

    const mid = findPath('N10', 'N11', allNodes, fullGraph)
    expect(mid.found).toBe(true)
    expect(mid.path).toHaveLength(2)
  })
})
