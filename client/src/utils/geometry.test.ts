/**
 * Tests for geometry utilities
 * Covers distance, segment intersection, line-of-sight, and path simplification
 */

import { describe, it, expect } from 'vitest'
import {
  distance,
  segmentsIntersect,
  hasLineOfSight,
  convertWallData,
  simplifyPath,
} from './geometry'
import type { Wall, Point } from './types'

// ── distance ──────────────────────────────────────────────────────────────────

describe('distance', () => {
  it('computes Euclidean distance in lat/lng space', () => {
    expect(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 3 })).toBeCloseTo(3)
    expect(distance({ lat: 0, lng: 0 }, { lat: 4, lng: 3 })).toBeCloseTo(5)
  })

  it('returns 0 for identical points', () => {
    expect(distance({ lat: 5, lng: 10 }, { lat: 5, lng: 10 })).toBe(0)
  })
})

// ── segmentsIntersect ─────────────────────────────────────────────────────────

describe('segmentsIntersect', () => {
  it('detects a clean crossing (X-pattern)', () => {
    // Horizontal: (0,0)→(0,4); Vertical: (-2,2)→(2,2)
    const p1: Point = { lat: 0, lng: 0 }
    const p2: Point = { lat: 0, lng: 4 }
    const w1: Point = { lat: -2, lng: 2 }
    const w2: Point = { lat: 2, lng: 2 }
    expect(segmentsIntersect(p1, p2, w1, w2)).toBe(true)
  })

  it('returns false for parallel horizontal segments', () => {
    const p1: Point = { lat: 0, lng: 0 }
    const p2: Point = { lat: 0, lng: 10 }
    const w1: Point = { lat: 5, lng: 0 }
    const w2: Point = { lat: 5, lng: 10 }
    expect(segmentsIntersect(p1, p2, w1, w2)).toBe(false)
  })

  it('returns false when segments are collinear but not overlapping', () => {
    const p1: Point = { lat: 0, lng: 0 }
    const p2: Point = { lat: 0, lng: 5 }
    const w1: Point = { lat: 0, lng: 6 }
    const w2: Point = { lat: 0, lng: 10 }
    expect(segmentsIntersect(p1, p2, w1, w2)).toBe(false)
  })

  it('returns false for T-junction (endpoints touching but not crossing)', () => {
    // Uses epsilon exclusion — endpoints should NOT count as intersections
    const p1: Point = { lat: 0, lng: 0 }
    const p2: Point = { lat: 0, lng: 5 }
    const w1: Point = { lat: 0, lng: 5 }
    const w2: Point = { lat: 0, lng: 10 }
    expect(segmentsIntersect(p1, p2, w1, w2)).toBe(false)
  })

  it('returns false for clearly non-intersecting segments', () => {
    const p1: Point = { lat: 0, lng: 0 }
    const p2: Point = { lat: 0, lng: 1 }
    const w1: Point = { lat: 10, lng: 10 }
    const w2: Point = { lat: 10, lng: 20 }
    expect(segmentsIntersect(p1, p2, w1, w2)).toBe(false)
  })
})

// ── hasLineOfSight ────────────────────────────────────────────────────────────

describe('hasLineOfSight', () => {
  // Wall blocking the path horizontally
  const blockingWall: Wall = {
    start: { lat: -1, lng: 5 },
    end: { lat: 1, lng: 5 },
  }
  const p1: Point = { lat: 0, lng: 0 }
  const p2: Point = { lat: 0, lng: 10 }

  it('returns false when a wall blocks the line of sight', () => {
    expect(hasLineOfSight(p1, p2, [blockingWall])).toBe(false)
  })

  it('returns true when no walls block the path', () => {
    const sideWall: Wall = {
      start: { lat: 5, lng: 0 },
      end: { lat: 5, lng: 10 },
    }
    expect(hasLineOfSight(p1, p2, [sideWall])).toBe(true)
  })

  it('returns true with an empty walls array', () => {
    expect(hasLineOfSight(p1, p2, [])).toBe(true)
  })

  it('returns false when the first of multiple walls blocks the path', () => {
    const safeWall: Wall = { start: { lat: 5, lng: 0 }, end: { lat: 5, lng: 10 } }
    expect(hasLineOfSight(p1, p2, [safeWall, blockingWall])).toBe(false)
  })
})

// ── convertWallData ───────────────────────────────────────────────────────────

describe('convertWallData', () => {
  it('converts raw API array format to Wall objects', () => {
    const raw = [
      [[1, 2], [3, 4]],
      [[5, 6], [7, 8]],
    ]
    const walls = convertWallData(raw)
    expect(walls).toHaveLength(2)
    expect(walls[0]).toEqual({ start: { lat: 1, lng: 2 }, end: { lat: 3, lng: 4 } })
    expect(walls[1]).toEqual({ start: { lat: 5, lng: 6 }, end: { lat: 7, lng: 8 } })
  })

  it('returns an empty array for empty input', () => {
    expect(convertWallData([])).toHaveLength(0)
  })
})

// ── simplifyPath ──────────────────────────────────────────────────────────────

describe('simplifyPath', () => {
  function makeNode(uid: string, lat: number, lng: number, type = 'waypoint') {
    return { uid, lat, lng, rooms: [uid], type }
  }

  it('returns the path unchanged when it has only 2 nodes', () => {
    const path = [makeNode('A', 0, 0), makeNode('B', 0, 100)]
    expect(simplifyPath(path)).toHaveLength(2)
  })

  it('always keeps start and end nodes', () => {
    const path = [
      makeNode('A', 0, 0),
      makeNode('mid1', 0, 50),
      makeNode('mid2', 0, 100),
      makeNode('B', 0, 150),
    ]
    const simplified = simplifyPath(path, 90) // high threshold → most waypoints removed
    expect(simplified[0].uid).toBe('A')
    expect(simplified[simplified.length - 1].uid).toBe('B')
  })

  it('keeps room nodes even when turn angle is below threshold', () => {
    // Straight line — all waypoints would be removed, but room nodes must stay
    const path = [
      makeNode('A', 0, 0, 'room'),
      makeNode('B', 0, 50, 'room'), // room type: must be kept
      makeNode('C', 0, 100, 'room'),
    ]
    const simplified = simplifyPath(path, 180) // 180° threshold removes all turns
    expect(simplified.map((n) => n.uid)).toContain('B')
  })

  it('removes a sharp-angle waypoint (near-180° turn) when threshold is high', () => {
    // simplifyPath(path, angleThreshold): keeps waypoints with angle >= threshold
    // angle is measured as 0=hairpin turn, 180=straight line
    // A threshold of 181 means "keep nothing" → straight-line waypoints are removed
    const path = [
      { uid: 'start', lat: 0, lng: 0, rooms: ['start'], type: 'room' },
      { uid: 'mid', lat: 0, lng: 50, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'end', lat: 0, lng: 100, rooms: ['end'], type: 'room' },
    ]
    // With a threshold above 180, no angle can satisfy >= threshold → mid is removed
    const simplified = simplifyPath(path, 181)
    expect(simplified.map((n) => n.uid)).not.toContain('mid')
  })
})
