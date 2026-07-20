/**
 * Tests for geometry utilities
 * Covers distance, segment intersection, line-of-sight, path simplification,
 * Ramer-Douglas-Peucker, perpendicular distance, and angle calculation
 */

import { describe, it, expect } from 'vitest'
import {
  distance,
  segmentsIntersect,
  hasLineOfSight,
  convertWallData,
  simplifyPath,
  perpendicularDistance,
  rdpSimplify,
  calculateAngleBetween,
  calculateTurnAngle,
} from './geometry'
import type { Node, Wall, Point } from './types'

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
  it('converts raw static wall data to Wall objects', () => {
    const raw = [
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ]
    const walls = convertWallData(raw)
    expect(walls).toHaveLength(2)
    expect(walls[0]).toEqual({ start: { lat: 1, lng: 2 }, end: { lat: 3, lng: 4 } })
    expect(walls[1]).toEqual({ start: { lat: 5, lng: 6 }, end: { lat: 7, lng: 8 } })
  })

  it('expands a polyline into blocking consecutive segments', () => {
    const walls = convertWallData([
      [
        [-2, 5],
        [2, 5],
        [4, 5],
      ],
    ])

    expect(walls).toHaveLength(2)
    expect(hasLineOfSight({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, walls)).toBe(false)
  })

  it('returns an empty array for empty input', () => {
    expect(convertWallData([])).toHaveLength(0)
  })
})

// ── simplifyPath ──────────────────────────────────────────────────────────────

describe('simplifyPath', () => {
  function makeNode(uid: string, lat: number, lng: number, type: Node['type'] = 'waypoint'): Node {
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

  it('removes a straight optional waypoint at the default threshold', () => {
    const path: Node[] = [
      { uid: 'start', lat: 0, lng: 0, rooms: ['start'], type: 'room' },
      { uid: 'mid', lat: 0, lng: 50, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'end', lat: 0, lng: 100, rooms: ['end'], type: 'room' },
    ]

    expect(simplifyPath(path).map((node) => node.uid)).toEqual(['start', 'end'])
  })

  it('keeps optional waypoints at meaningful turns', () => {
    const path: Node[] = [
      { uid: 'start', lat: 0, lng: 0, rooms: ['start'], type: 'room' },
      { uid: 'corner', lat: 0, lng: 50, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'end', lat: 50, lng: 50, rooms: ['end'], type: 'room' },
    ]

    expect(simplifyPath(path).map((node) => node.uid)).toEqual(['start', 'corner', 'end'])
  })

  it('triggers RDP branch when path has > 10 waypoints', () => {
    // Build a path with 12 waypoints in a slight zig-zag
    const path: Node[] = [
      { uid: 'start', lat: 0, lng: 0, rooms: ['start'], type: 'room' },
      { uid: 'w1', lat: 0, lng: 10, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w2', lat: 1, lng: 20, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w3', lat: 0, lng: 30, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w4', lat: 1, lng: 40, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w5', lat: 0, lng: 50, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w6', lat: 1, lng: 60, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w7', lat: 0, lng: 70, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w8', lat: 1, lng: 80, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w9', lat: 0, lng: 90, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'w10', lat: 1, lng: 100, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'end', lat: 0, lng: 110, rooms: ['end'], type: 'room' },
    ]
    const simplified = simplifyPath(path, 30)
    // The small zig-zags are below the 30° turn threshold, so constrained RDP
    // can reduce the safe, unobstructed run to its endpoints.
    expect(simplified[0].uid).toBe('start')
    expect(simplified[simplified.length - 1].uid).toBe('end')
    expect(simplified.length).toBeLessThan(10)
  })

  it('does not replace a valid detour with a shortcut through a wall', () => {
    const path: Node[] = [
      { uid: 'start', lat: 0, lng: 0, rooms: ['start'], type: 'room' },
      { uid: 'detour-a', lat: 20, lng: 40, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'detour-b', lat: 20, lng: 60, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'end', lat: 0, lng: 100, rooms: ['end'], type: 'room' },
    ]
    const wall: Wall = { start: { lat: -10, lng: 50 }, end: { lat: 10, lng: 50 } }

    const simplified = simplifyPath(path, 181, 50, [wall])

    expect(simplified.map((node) => node.uid)).not.toEqual(['start', 'end'])
    for (let index = 1; index < simplified.length; index++) {
      expect(hasLineOfSight(simplified[index - 1], simplified[index], [wall])).toBe(true)
    }
  })

  it('preserves required landmark nodes during constrained RDP', () => {
    const path: Node[] = [
      { uid: 'start', lat: 0, lng: 0, rooms: ['start'], type: 'room' },
      { uid: 'w1', lat: 0, lng: 10, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'landmark', lat: 0, lng: 20, rooms: ['214'], type: 'room' },
      { uid: 'w2', lat: 0, lng: 30, rooms: ['waypoint'], type: 'waypoint' },
      { uid: 'stairs', lat: 0, lng: 40, rooms: ['A'], type: 'stairway' },
      { uid: 'end', lat: 0, lng: 50, rooms: ['end'], type: 'room' },
    ]

    expect(simplifyPath(path).map((node) => node.uid)).toEqual(
      expect.arrayContaining(['landmark', 'stairs'])
    )
  })
})

// ── perpendicularDistance ────────────────────────────────────────────────────

describe('perpendicularDistance', () => {
  it('returns 0 when point lies on the segment', () => {
    // Segment from (0,0) to (0,10); point at (0,5) is on the segment
    expect(
      perpendicularDistance({ lat: 0, lng: 5 }, { lat: 0, lng: 0 }, { lat: 0, lng: 10 })
    ).toBeCloseTo(0)
  })

  it('returns correct distance for point off the segment', () => {
    // Segment from (0,0) to (10,0); point at (5, 3)
    // Distance should be 3 (vertical offset)
    expect(
      perpendicularDistance({ lat: 3, lng: 5 }, { lat: 0, lng: 0 }, { lat: 0, lng: 10 })
    ).toBeCloseTo(3)
  })

  it('handles degenerate zero-length segment', () => {
    // Segment from (0,0) to (0,0); point at (3,4)
    // Fallback to distance()
    expect(
      perpendicularDistance({ lat: 3, lng: 4 }, { lat: 0, lng: 0 }, { lat: 0, lng: 0 })
    ).toBeCloseTo(5)
  })

  it('handles point at endpoint', () => {
    expect(
      perpendicularDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, { lat: 0, lng: 10 })
    ).toBeCloseTo(0)
  })
})

// ── rdpSimplify ───────────────────────────────────────────────────────────────

describe('rdpSimplify', () => {
  it('returns the input unchanged for 2 points', () => {
    const result = rdpSimplify(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 10 },
      ],
      5
    )
    expect(result).toHaveLength(2)
  })

  it('removes middle point when 3 collinear points are far apart', () => {
    // 3 collinear points: (0,0) → (0,5) → (0,10), epsilon=1
    const result = rdpSimplify(
      [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 5 },
        { lat: 0, lng: 10 },
      ],
      1
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ lat: 0, lng: 0 })
    expect(result[1]).toEqual({ lat: 0, lng: 10 })
  })

  it('keeps middle point when it forms a peak above epsilon', () => {
    // Triangle: (0,0) → (10,5) → (20,0), epsilon=3
    // Peak at (10,5) has distance 5 > 3 → kept
    const result = rdpSimplify(
      [
        { lat: 0, lng: 0 },
        { lat: 5, lng: 10 },
        { lat: 0, lng: 20 },
      ],
      3
    )
    expect(result).toHaveLength(3)
  })

  it('returns empty array when input is empty', () => {
    expect(rdpSimplify([], 5)).toEqual([])
  })

  it('returns single point array unchanged', () => {
    expect(rdpSimplify([{ lat: 5, lng: 10 }], 5)).toHaveLength(1)
  })
})

// ── calculateAngleBetween ─────────────────────────────────────────────────────

describe('calculateAngleBetween', () => {
  it('returns 180 for three collinear points (straight line)', () => {
    const angle = calculateAngleBetween(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 50 },
      { lat: 0, lng: 100 }
    )
    expect(angle).toBeCloseTo(180)
  })

  it('returns 90 for a right angle', () => {
    // (0,0) → (0,50) → (50,50) — right angle at (0,50)
    const angle = calculateAngleBetween(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 50 },
      { lat: 50, lng: 50 }
    )
    expect(angle).toBeCloseTo(90)
  })

  it('returns 0 for a hairpin turn', () => {
    // (0,0) → (0,50) → (0,0) — 180-degree turn, but since we measure the internal angle at p2...
    // Actually calculateAngleBetween measures the angle between vectors p2→p1 and p2→p3
    // p2→p1 = (0, -50), p2→p3 = (0, -50), dot = 2500, mags = 2500, cos = 1, angle = 0
    // Wait no: p1=(0,0), p2=(0,50), p3=(0,0)
    // v1 = p1 - p2 = (0, -50), v2 = p3 - p2 = (0, -50)
    // dot = 0*0 + (-50)*(-50) = 2500
    // mag1 = 50, mag2 = 50
    // cos = 2500/(50*50) = 1
    // angle = acos(1) = 0 degrees... hmm, that means the three points form a degenerate case
    // Actually going (0,0) -> (0,50) -> (0,0) means going forward then backward
    // v1 = (0, -50), v2 = (0, -50), so they point the same direction → 0 degree turn (going back the way you came)
    // That's a hairpin turn meaning angle = 0
    const angle = calculateAngleBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 50 }, { lat: 0, lng: 0 })
    expect(angle).toBeCloseTo(0)
  })

  it('handles degenerate case with zero-length vector', () => {
    // p1, p2, p3 where p1 === p2
    const angle = calculateAngleBetween(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 100 }
    )
    expect(angle).toBe(180)
  })
})

describe('calculateTurnAngle', () => {
  it('returns direction change rather than the interior angle', () => {
    expect(
      calculateTurnAngle({ lat: 0, lng: 0 }, { lat: 0, lng: 50 }, { lat: 0, lng: 100 })
    ).toBeCloseTo(0)
    expect(
      calculateTurnAngle({ lat: 0, lng: 0 }, { lat: 0, lng: 50 }, { lat: 50, lng: 50 })
    ).toBeCloseTo(90)
    expect(
      calculateTurnAngle({ lat: 0, lng: 0 }, { lat: 0, lng: 50 }, { lat: 0, lng: 0 })
    ).toBeCloseTo(180)
  })
})
