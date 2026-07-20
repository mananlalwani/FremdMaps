/**
 * Tests for graph construction utilities
 * Covers buildVisibilityGraph, stairway connections, traffic zones, and getGraphStats
 */

import { describe, it, expect } from 'vitest'
import { buildVisibilityGraph, getGraphStats } from './graph'
import type { Node, Wall, TrafficZone } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(uid: string, lat: number, lng: number, opts: Partial<Node> = {}): Node {
  return { uid, lat, lng, rooms: [uid], type: 'room', ...opts }
}

function makeWall(lat1: number, lng1: number, lat2: number, lng2: number, floor?: string): Wall {
  return { start: { lat: lat1, lng: lng1 }, end: { lat: lat2, lng: lng2 }, floor }
}

function makeZone(
  uid: string,
  floor: string,
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  intensity: number
): TrafficZone {
  return { uid, floor, bounds: { minLat, minLng, maxLat, maxLng }, intensity }
}

// ── buildVisibilityGraph ──────────────────────────────────────────────────────

describe('buildVisibilityGraph', () => {
  it('returns a graph with an entry for every node', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    const graph = buildVisibilityGraph(nodes, [])
    expect(graph.has('A')).toBe(true)
    expect(graph.has('B')).toBe(true)
  })

  it('connects two nearby nodes with no walls between them', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    const graph = buildVisibilityGraph(nodes, [], 800)
    const edgesA = graph.get('A')!
    expect(edgesA.some((e) => e.to === 'B')).toBe(true)
  })

  it('does NOT connect nodes beyond maxDistance', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 1000)]
    const graph = buildVisibilityGraph(nodes, [], 800) // 1000 > 800
    const edgesA = graph.get('A')!
    expect(edgesA.some((e) => e.to === 'B')).toBe(false)
  })

  it('does NOT connect nodes when a wall blocks line of sight', () => {
    const A = makeNode('A', 0, 0)
    const B = makeNode('B', 0, 200)
    // Wall at x=100 (lng=100), vertical span covering the path
    const wall: Wall = {
      start: { lat: -10, lng: 100 },
      end: { lat: 10, lng: 100 },
    }
    const graph = buildVisibilityGraph([A, B], [wall], 800)
    const edgesA = graph.get('A')!
    expect(edgesA.some((e) => e.to === 'B')).toBe(false)
  })

  it('adds bidirectional edges', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    const graph = buildVisibilityGraph(nodes, [], 800)
    expect(graph.get('A')!.some((e) => e.to === 'B')).toBe(true)
    expect(graph.get('B')!.some((e) => e.to === 'A')).toBe(true)
  })

  it('keeps nodes on different floors isolated from each other', () => {
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 100, { floor: '2' })
    const graph = buildVisibilityGraph([A, B], [], 800)
    expect(graph.get('A')!.some((e) => e.to === 'B')).toBe(false)
  })

  it('connects stairway nodes on different floors via connectsTo', () => {
    const S1 = makeNode('S1', 0, 100, { type: 'stairway', floor: '1', connectsTo: ['S2'] })
    const S2 = makeNode('S2', 0, 100, { type: 'stairway', floor: '2', connectsTo: ['S1'] })
    const nodes = [S1, S2]
    const graph = buildVisibilityGraph(nodes, [], 800)
    expect(graph.get('S1')!.some((e) => e.to === 'S2')).toBe(true)
    expect(graph.get('S2')!.some((e) => e.to === 'S1')).toBe(true)
  })

  it('connects stairways by name when connectsTo contains a name, not a UID', () => {
    const S1 = makeNode('uid-s1', 0, 100, {
      rooms: ['Stair A'],
      type: 'stairway',
      floor: '1',
      connectsTo: ['Stair A'], // name reference, not UID
    })
    const S2 = makeNode('uid-s2', 0, 100, {
      rooms: ['Stair A'],
      type: 'stairway',
      floor: '2',
      connectsTo: ['Stair A'],
    })
    const nodes = [S1, S2]
    const graph = buildVisibilityGraph(nodes, [], 800)
    expect(graph.get('uid-s1')!.some((e) => e.to === 'uid-s2')).toBe(true)
  })

  it('handles empty nodes array', () => {
    const graph = buildVisibilityGraph([], [], 800)
    expect(graph.size).toBe(0)
  })

  it('computes raw distance cost when walls array is empty', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    const graph = buildVisibilityGraph(nodes, [], 800)
    const edge = graph.get('A')!.find((e) => e.to === 'B')!
    expect(edge.cost).toBeCloseTo(100)
  })

  it('applies the full alignment penalty to even a shallow diagonal edge', () => {
    const horizontalStart = makeNode('A', 0, 0)
    const horizontalEnd = makeNode('B', 0, 100)
    const diagonalStart = makeNode('C', 0, 200)
    const diagonalEnd = makeNode('D', 10, 300)
    const graph = buildVisibilityGraph(
      [horizontalStart, horizontalEnd, diagonalStart, diagonalEnd],
      [],
      150
    )

    const horizontalCost = graph.get('A')!.find((edge) => edge.to === 'B')!.cost
    const diagonalCost = graph.get('C')!.find((edge) => edge.to === 'D')!.cost

    expect(horizontalCost).toBeCloseTo(100)
    expect(diagonalCost).toBeCloseTo(Math.sqrt(10_100) * 1.1)
  })

  it('inflates edge costs inside traffic zones', () => {
    // A and B are inside a zone with intensity 2.0
    // Zone covers lat [-10, 10], lng [-10, 110]
    const zone = makeZone('z1', '1', -10, -10, 10, 110, 2.0)
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 100, { floor: '1' })
    const graph = buildVisibilityGraph([A, B], [], 800, [zone])
    const edge = graph.get('A')!.find((e) => e.to === 'B')!
    // Base distance = 100, multiplied by intensity 2.0 = 200
    expect(edge.cost).toBeCloseTo(200)
  })

  it('applies highest zone intensity when zones overlap', () => {
    const zone1 = makeZone('z1', '1', -10, -10, 10, 110, 1.5)
    const zone2 = makeZone('z2', '1', -10, -10, 10, 110, 3.0)
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 100, { floor: '1' })
    const graph = buildVisibilityGraph([A, B], [], 800, [zone1, zone2])
    const edge = graph.get('A')!.find((e) => e.to === 'B')!
    // Base distance = 100, highest intensity 3.0 = 300
    expect(edge.cost).toBeCloseTo(300)
  })

  it('ignores zones on a different floor', () => {
    const zone = makeZone('z1', '2', -10, -10, 10, 110, 5.0)
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 100, { floor: '1' })
    const graph = buildVisibilityGraph([A, B], [], 800, [zone])
    const edge = graph.get('A')!.find((e) => e.to === 'B')!
    // Zone is on floor 2, nodes are on floor 1, no inflation
    expect(edge.cost).toBeCloseTo(100)
  })

  it('does not inflate cost when neither node is inside the zone', () => {
    // Zone covers lat [100, 200], lng [100, 200]; nodes are at 0,0 and 0,100
    const zone = makeZone('z1', '1', 100, 100, 200, 200, 2.0)
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 100, { floor: '1' })
    const graph = buildVisibilityGraph([A, B], [], 800, [zone])
    const edge = graph.get('A')!.find((e) => e.to === 'B')!
    expect(edge.cost).toBeCloseTo(100)
  })

  it('handles nodes without floor info using all-walls fallback index', () => {
    const A = makeNode('A', 0, 0)
    const B = makeNode('B', 0, 200)
    const wall = makeWall(-10, 100, 10, 100) // no floor on wall either
    const graph = buildVisibilityGraph([A, B], [wall], 800)
    // Wall blocks the path
    expect(graph.get('A')!.some((e) => e.to === 'B')).toBe(false)
  })

  it('filters walls by floor when nodes have floor info', () => {
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 200, { floor: '1' })
    // Wall on floor 2 should not block nodes on floor 1
    const wall = makeWall(-10, 100, 10, 100, '2')
    const graph = buildVisibilityGraph([A, B], [wall], 800)
    expect(graph.get('A')!.some((e) => e.to === 'B')).toBe(true)
  })
})

// ── Stairway edge cases ──────────────────────────────────────────────────────

describe('stairway connections', () => {
  it('connects stairways by legacy UID reference', () => {
    const S1 = makeNode('stair-uid-1', 0, 100, {
      type: 'stairway',
      floor: '1',
      connectsTo: ['stair-uid-2'],
    })
    const S2 = makeNode('stair-uid-2', 0, 100, {
      type: 'stairway',
      floor: '2',
      connectsTo: ['stair-uid-1'],
    })
    const graph = buildVisibilityGraph([S1, S2], [], 800)
    expect(graph.get('stair-uid-1')!.some((e) => e.to === 'stair-uid-2')).toBe(true)
  })

  it('skips self-referencing stairway connections', () => {
    const S = makeNode('S1', 0, 100, {
      type: 'stairway',
      floor: '1',
      connectsTo: ['S1'],
    })
    const graph = buildVisibilityGraph([S], [], 800)
    // Should not connect to itself
    expect(graph.get('S1')!.length).toBe(0)
  })

  it('warns when a stairway target is not found', () => {
    const S1 = makeNode('S1', 0, 100, {
      type: 'stairway',
      floor: '1',
      connectsTo: ['NonExistent'],
    })
    const graph = buildVisibilityGraph([S1], [], 800)
    expect(graph.get('S1')!.length).toBe(0)
  })

  it('works with no stairways present', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    const graph = buildVisibilityGraph(nodes, [], 800)
    expect(graph.get('A')!.some((e) => e.to === 'B')).toBe(true)
  })

  it('does not create duplicate edges when both stairways declare each other', () => {
    const S1 = makeNode('S1', 0, 100, {
      type: 'stairway',
      floor: '1',
      connectsTo: ['S2'],
    })
    const S2 = makeNode('S2', 0, 100, {
      type: 'stairway',
      floor: '2',
      connectsTo: ['S1'],
    })
    const graph = buildVisibilityGraph([S1, S2], [], 800)
    const edgesFromS1 = graph.get('S1')!.filter((e) => e.to === 'S2')
    const edgesFromS2 = graph.get('S2')!.filter((e) => e.to === 'S1')
    expect(edgesFromS1).toHaveLength(1)
    expect(edgesFromS2).toHaveLength(1)
  })

  it('uses STAIR_COST for cross-floor connections', () => {
    const S1 = makeNode('S1', 0, 100, {
      type: 'stairway',
      floor: '1',
      connectsTo: ['S2'],
    })
    const S2 = makeNode('S2', 0, 100, {
      type: 'stairway',
      floor: '2',
      connectsTo: ['S1'],
    })
    const graph = buildVisibilityGraph([S1, S2], [], 800)
    const edge = graph.get('S1')!.find((e) => e.to === 'S2')!
    expect(edge.cost).toBe(250) // MAP_CONFIG.STAIR_COST
  })
})

// ── getGraphStats ─────────────────────────────────────────────────────────────

describe('getGraphStats', () => {
  it('counts nodes correctly', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100), makeNode('C', 0, 50)]
    const graph = buildVisibilityGraph(nodes, [], 800)
    const stats = getGraphStats(graph)
    expect(stats.nodes).toBe(3)
  })

  it('reports zero edges for a fully isolated graph', () => {
    const A = makeNode('A', 0, 0, { floor: '1' })
    const B = makeNode('B', 0, 100, { floor: '2' })
    // Different floors, no stairway — no edges
    const graph = buildVisibilityGraph([A, B], [], 800)
    const stats = getGraphStats(graph)
    expect(stats.edges).toBe(0)
  })

  it('computes correct edge count for a connected graph', () => {
    const nodes = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    const graph = buildVisibilityGraph(nodes, [], 800)
    const stats = getGraphStats(graph)
    expect(stats.edges).toBe(1) // One undirected edge
  })

  it('computes degree statistics', () => {
    const A = makeNode('A', 0, 0)
    const B = makeNode('B', 0, 100)
    const C = makeNode('C', 0, 200)
    const graph = buildVisibilityGraph([A, B, C], [], 800)
    const stats = getGraphStats(graph)
    expect(stats.minDegree).toBeGreaterThanOrEqual(0)
    expect(stats.avgDegree).toBeGreaterThan(0)
    expect(stats.maxDegree).toBeGreaterThan(0)
  })

  it('reports zero stats for an empty graph', () => {
    const graph = buildVisibilityGraph([], [])
    const stats = getGraphStats(graph)
    expect(stats.nodes).toBe(0)
    expect(stats.edges).toBe(0)
    expect(stats.avgDegree).toBe(0)
    expect(stats.minDegree).toBe(0)
    expect(stats.maxDegree).toBe(0)
  })
})
