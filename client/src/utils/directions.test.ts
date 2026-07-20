import { describe, it, expect } from 'vitest'
import {
  bearingBetween,
  signedTurnDegrees,
  relativeWalkLabel,
  relativeWalkInstruction,
  mergeBearings,
  buildDirectionSteps,
  preparePathForDirections,
  COLLINEAR_THRESHOLD,
} from './directions'
import { simplifyPath } from './geometry'
import { MAP_CONFIG } from './constants'
import type { Node } from './types'

function makeNode(
  uid: string,
  lat: number,
  lng: number,
  rooms: string[],
  opts: Partial<Node> = {}
): Node {
  return { uid, lat, lng, rooms, floor: '2', ...opts }
}

describe('bearingBetween', () => {
  it('returns 0 for map-up (+lat)', () => {
    const a = makeNode('a', 0, 0, ['a'])
    const b = makeNode('b', 10, 0, ['b'])
    expect(bearingBetween(a, b)).toBeCloseTo(0, 5)
  })

  it('returns 90 for map-right (+lng)', () => {
    const a = makeNode('a', 0, 0, ['a'])
    const b = makeNode('b', 0, 10, ['b'])
    expect(bearingBetween(a, b)).toBeCloseTo(90, 5)
  })
})

describe('signedTurnDegrees', () => {
  it('reports a right turn as positive', () => {
    expect(signedTurnDegrees(0, 90)).toBeCloseTo(90, 5)
  })

  it('reports a left turn as negative', () => {
    expect(signedTurnDegrees(0, 270)).toBeCloseTo(-90, 5)
  })
})

describe('mergeBearings', () => {
  it('keeps near-wrap bearings near 0° instead of averaging toward 180°', () => {
    const merged = mergeBearings(350, 1, 10, 1)
    expect(merged).toBeCloseTo(0, 5)
  })
})

describe('relativeWalkLabel', () => {
  it('says continue straight when no prior bearing', () => {
    expect(relativeWalkLabel(null, 0)).toBe('Continue straight')
  })

  it('says continue straight for near-collinear turns', () => {
    expect(relativeWalkLabel(0, COLLINEAR_THRESHOLD)).toBe('Continue straight')
  })

  it('says turn right / left for ~90° turns', () => {
    expect(relativeWalkLabel(0, 90)).toBe('Turn right')
    expect(relativeWalkLabel(0, 270)).toBe('Turn left')
  })

  it('says bear for shallow turns beyond collinear threshold', () => {
    expect(relativeWalkLabel(0, 40)).toBe('Bear right')
    expect(relativeWalkLabel(0, 320)).toBe('Bear left')
  })

  it('says turn around for near-180° turns', () => {
    expect(relativeWalkLabel(0, 180)).toBe('Turn around')
  })

  it('says exit stairs and continue when afterStairs with no approach', () => {
    expect(relativeWalkLabel(null, 0, true)).toBe('Exit the stairs and continue')
  })

  it('says exit stairs and turn when approach differs', () => {
    expect(relativeWalkLabel(0, 90, true)).toBe('Exit the stairs and turn right')
    expect(relativeWalkLabel(0, 270, true)).toBe('Exit the stairs and turn left')
  })
})

describe('relativeWalkInstruction', () => {
  it('includes turn metadata', () => {
    expect(relativeWalkInstruction(0, 90).turn).toBe('right')
    expect(relativeWalkInstruction(0, 270).turn).toBe('left')
    expect(relativeWalkInstruction(0, 40).turn).toBe('bear-right')
    expect(relativeWalkInstruction(0, 180).turn).toBe('u-turn')
  })
})

describe('preparePathForDirections', () => {
  it('matches single-floor simplifyPath used for route drawing', () => {
    const start = makeNode('s', 0, 0, ['201'], { type: 'room' })
    const mid = makeNode('m', 50, 0, ['waypoint'], { type: 'waypoint' })
    const end = makeNode('e', 100, 0, ['202'], { type: 'room' })
    const path = [start, mid, end]

    expect(preparePathForDirections(path).map((n) => n.uid)).toEqual(
      simplifyPath(path, MAP_CONFIG.PATH_SIMPLIFICATION_ANGLE).map((n) => n.uid)
    )
  })

  it('preserves both stair portals across floors', () => {
    const start = makeNode('s', 0, 0, ['101'], { floor: '1', type: 'room' })
    const stair1 = makeNode('st1', 100, 0, ['A'], {
      type: 'stairway',
      floor: '1',
      connectsTo: ['A'],
    })
    const stair2 = makeNode('st2', 100, 0, ['A'], {
      type: 'stairway',
      floor: '2',
      connectsTo: ['A'],
    })
    const end = makeNode('e', 200, 0, ['201'], { floor: '2', type: 'room' })

    const prepared = preparePathForDirections([start, stair1, stair2, end])
    expect(prepared.map((n) => n.uid)).toEqual(['s', 'st1', 'st2', 'e'])
  })
})

describe('buildDirectionSteps', () => {
  it('returns empty for empty path', () => {
    expect(buildDirectionSteps([])).toEqual([])
  })

  it('emits start, relative walk, and end for an L-shaped path', () => {
    const start = makeNode('s', 0, 0, ['201'], { type: 'room' })
    const north1 = makeNode('n1', 50, 0, ['waypoint'], { type: 'waypoint' })
    const north2 = makeNode('n2', 100, 0, ['waypoint'], { type: 'waypoint' })
    const east1 = makeNode('e1', 100, 50, ['waypoint'], { type: 'waypoint' })
    const east2 = makeNode('e2', 100, 100, ['waypoint'], { type: 'waypoint' })
    const end = makeNode('e', 100, 200, ['202'], { type: 'room' })

    const steps = buildDirectionSteps([start, north1, north2, east1, east2, end])

    expect(steps[0]).toMatchObject({ type: 'start', label: 'Start at 201' })
    expect(steps[steps.length - 1]).toMatchObject({ type: 'end', label: 'Arrive at 202' })

    const walkSteps = steps.filter((s) => s.type === 'walk')
    expect(walkSteps.length).toBeGreaterThanOrEqual(2)
    expect(walkSteps[0].label).toBe('Continue straight')
    expect(walkSteps[0].turn).toBe('straight')
    expect(walkSteps[1].label).toBe('Turn right')
    expect(walkSteps[1].turn).toBe('right')
  })

  it('mentions a landmark room at the turn corner', () => {
    const start = makeNode('s', 0, 0, ['201'], { type: 'room' })
    const corner = makeNode('c', 100, 0, ['214'], { type: 'room' })
    const end = makeNode('e', 100, 100, ['202'], { type: 'room' })

    const steps = buildDirectionSteps([start, corner, end])
    const turn = steps.find((s) => s.turn === 'right')
    expect(turn?.label).toBe('Turn right toward 214')
  })

  it('emits a walk step with full distance for a 2-node path', () => {
    const start = makeNode('a', 0, 0, ['A'], { type: 'room' })
    const end = makeNode('b', 0, 100, ['B'], { type: 'room' })
    const steps = buildDirectionSteps([start, end])

    const walks = steps.filter((s) => s.type === 'walk')
    expect(walks).toHaveLength(1)
    expect(walks[0].distance).toBeCloseTo(100)
    expect(walks[0].label).toBe('Continue straight')
  })

  it('includes the final segment in a 3-node straight path', () => {
    const a = makeNode('a', 0, 0, ['A'], { type: 'room' })
    const m = makeNode('m', 50, 0, ['waypoint'], { type: 'waypoint' })
    const b = makeNode('b', 100, 0, ['B'], { type: 'room' })
    const steps = buildDirectionSteps([a, m, b])

    const walks = steps.filter((s) => s.type === 'walk')
    expect(walks).toHaveLength(1)
    expect(walks[0].distance).toBeCloseTo(100)
  })

  it('merges near-wrap collinear segments into one straight walk', () => {
    const a = makeNode('a', 0, 0, ['A'], { type: 'room' })
    const b = makeNode('b', 10, -0.875, ['waypoint'], { type: 'waypoint' })
    const c = makeNode('c', 20, 0, ['B'], { type: 'room' })

    const steps = buildDirectionSteps([a, b, c])
    const walks = steps.filter((s) => s.type === 'walk')
    expect(walks).toHaveLength(1)
    expect(walks[0].label).toBe('Continue straight')
    expect(walks[0].distance).toBeGreaterThan(19)
  })

  it('emits exactly one named stair step on a two-portal multi-floor path', () => {
    const start = makeNode('s', 0, 0, ['101'], { floor: '1', type: 'room' })
    const w1 = makeNode('w1', 50, 0, ['waypoint'], { type: 'waypoint', floor: '1' })
    const stair1 = makeNode('st1', 100, 0, ['A'], {
      type: 'stairway',
      floor: '1',
      connectsTo: ['A'],
    })
    const stair2 = makeNode('st2', 100, 0, ['A'], {
      type: 'stairway',
      floor: '2',
      connectsTo: ['A'],
    })
    const w2 = makeNode('w2', 150, 0, ['waypoint'], { type: 'waypoint', floor: '2' })
    const end = makeNode('e', 200, 0, ['201'], { floor: '2', type: 'room' })

    const steps = buildDirectionSteps([start, w1, stair1, stair2, w2, end])

    const stairs = steps.filter((s) => s.type === 'stair')
    expect(stairs).toHaveLength(1)
    expect(stairs[0].targetFloor).toBe('2')
    expect(stairs[0].label).toBe('Take Stairs A to Floor 2')
  })

  it('uses exit-stairs continue then relative turns when leaving straight', () => {
    const start = makeNode('s', 0, 0, ['101'], { floor: '1', type: 'room' })
    const w1 = makeNode('w1', 50, 0, ['waypoint'], { type: 'waypoint', floor: '1' })
    const stair1 = makeNode('st1', 100, 0, ['A'], {
      type: 'stairway',
      floor: '1',
      connectsTo: ['A'],
    })
    const stair2 = makeNode('st2', 100, 0, ['A'], {
      type: 'stairway',
      floor: '2',
      connectsTo: ['A'],
    })
    const w2 = makeNode('w2', 200, 0, ['waypoint'], { type: 'waypoint', floor: '2' })
    const w3 = makeNode('w3', 200, 100, ['waypoint'], { type: 'waypoint', floor: '2' })
    const end = makeNode('e', 200, 200, ['201'], { floor: '2', type: 'room' })

    const steps = buildDirectionSteps([start, w1, stair1, stair2, w2, w3, end])
    const walks = steps.filter((s) => s.type === 'walk')

    expect(walks[0].label).toBe('Continue straight')
    const postStairWalks = walks.filter((w) => w.floor === '2')
    expect(postStairWalks[0].label).toBe('Exit the stairs and continue')
    expect(postStairWalks[1].label).toBe('Turn right')
  })

  it('uses exit-stairs turn when the first post-stair leg bends from approach', () => {
    const start = makeNode('s', 0, 0, ['101'], { floor: '1', type: 'room' })
    const stair1 = makeNode('st1', 100, 0, ['A'], {
      type: 'stairway',
      floor: '1',
      connectsTo: ['A'],
    })
    const stair2 = makeNode('st2', 100, 0, ['A'], {
      type: 'stairway',
      floor: '2',
      connectsTo: ['A'],
    })
    // Leave stairs to the east — 90° from approach (north)
    const end = makeNode('e', 100, 100, ['201'], { floor: '2', type: 'room' })

    const steps = buildDirectionSteps([start, stair1, stair2, end])
    const post = steps.filter((s) => s.type === 'walk' && s.floor === '2')
    expect(post[0].label).toBe('Exit the stairs and turn right')
    expect(post[0].turn).toBe('right')
  })

  it('does not turn non-coincident stair portals into a walk segment', () => {
    const start = makeNode('s', 0, 0, ['101'], { floor: '1', type: 'room' })
    const stair1 = makeNode('st1', 100, 0, ['A'], {
      type: 'stairway',
      floor: '1',
      connectsTo: ['A'],
    })
    const stair2 = makeNode('st2', 500, 500, ['A'], {
      type: 'stairway',
      floor: '2',
      connectsTo: ['A'],
    })
    const end = makeNode('e', 500, 600, ['201'], { floor: '2', type: 'room' })

    const steps = buildDirectionSteps([start, stair1, stair2, end])
    const floorTwoWalks = steps.filter((step) => step.type === 'walk' && step.floor === '2')

    expect(steps.filter((step) => step.type === 'stair')).toHaveLength(1)
    expect(floorTwoWalks).toHaveLength(1)
    expect(floorTwoWalks[0]).toMatchObject({
      label: 'Exit the stairs and turn right',
      distance: 100,
    })
  })
})
