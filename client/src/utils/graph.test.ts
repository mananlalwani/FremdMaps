/**
 * Tests for graph construction utilities
 * Covers buildVisibilityGraph, stairway connections, and getGraphStats
 */

import { describe, it, expect } from 'vitest'
import { buildVisibilityGraph, getGraphStats } from './graph'
import type { Node, Wall } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(uid: string, lat: number, lng: number, opts: Partial<Node> = {}): Node {
  return { uid, lat, lng, rooms: [uid], type: 'room', ...opts }
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
})
