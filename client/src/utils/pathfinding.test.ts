/**
 * Tests for pathfinding utilities
 * Covers A* algorithm correctness, edge cases, and PriorityQueue behavior
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { findPath, findNodeByRoom, searchNodesByRoom, findNearestBathroom, invalidatePathCache } from './pathfinding'
import type { Node, Graph } from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(uid: string, lat: number, lng: number, rooms: string[], opts: Partial<Node> = {}): Node {
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
    ['B', [{ to: 'A', cost: 100 }, { to: 'C', cost: 100 }]],
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
      ['A', [{ to: 'B', cost: 50 }, { to: 'C', cost: 1000 }]],
      ['B', [{ to: 'A', cost: 50 }, { to: 'C', cost: 50 }]],
      ['C', [{ to: 'A', cost: 1000 }, { to: 'B', cost: 50 }]],
    ])
    const result = findPath('A', 'C', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['A', 'B', 'C'])
    expect(result.distance).toBeCloseTo(100)
  })

  it('handles a cross-floor stairway path', () => {
    const roomF1 = makeNode('R1', 0, 0, ['Room 101'], { floor: '1' })
    const stairF1 = makeNode('S1', 0, 100, ['Stair A'], { type: 'stairway', floor: '1' })
    const stairF2 = makeNode('S2', 0, 100, ['Stair A'], { type: 'stairway', floor: '2' })
    const roomF2 = makeNode('R2', 0, 200, ['Room 201'], { floor: '2' })
    const nodes = [roomF1, stairF1, stairF2, roomF2]
    const graph: Graph = new Map([
      ['R1', [{ to: 'S1', cost: 100 }]],
      ['S1', [{ to: 'R1', cost: 100 }, { to: 'S2', cost: 50 }]],
      ['S2', [{ to: 'S1', cost: 50 }, { to: 'R2', cost: 100 }]],
      ['R2', [{ to: 'S2', cost: 100 }]],
    ])
    const result = findPath('R1', 'R2', nodes, graph)
    expect(result.found).toBe(true)
    expect(result.path.map((n) => n.uid)).toEqual(['R1', 'S1', 'S2', 'R2'])
    expect(result.distance).toBeCloseTo(250)
  })
})

// ── findNodeByRoom ────────────────────────────────────────────────────────────

describe('findNodeByRoom', () => {
  const nodes: Node[] = [
    makeNode('1', 0, 0, ['Main Office', 'Room 100']),
    makeNode('2', 0, 0, ['Library']),
    makeNode('3', 0, 0, ['Cafeteria']),
  ]

  it('finds by exact match (case-insensitive)', () => {
    expect(findNodeByRoom('library', nodes)?.uid).toBe('2')
    expect(findNodeByRoom('LIBRARY', nodes)?.uid).toBe('2')
  })

  it('finds node with multiple room aliases', () => {
    expect(findNodeByRoom('room 100', nodes)?.uid).toBe('1')
  })

  it('returns undefined when not found', () => {
    expect(findNodeByRoom('Gymnasium', nodes)).toBeUndefined()
  })
})

// ── searchNodesByRoom ─────────────────────────────────────────────────────────

describe('searchNodesByRoom', () => {
  const nodes: Node[] = [
    makeNode('1', 0, 0, ['Room 101']),
    makeNode('2', 0, 0, ['Room 102']),
    makeNode('3', 0, 0, ['Library']),
  ]

  it('returns all nodes with partial match', () => {
    const results = searchNodesByRoom('Room', nodes)
    expect(results).toHaveLength(2)
  })

  it('is case-insensitive', () => {
    expect(searchNodesByRoom('room 101', nodes)).toHaveLength(1)
  })

  it('returns empty array when nothing matches', () => {
    expect(searchNodesByRoom('Gymnasium', nodes)).toHaveLength(0)
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
})
