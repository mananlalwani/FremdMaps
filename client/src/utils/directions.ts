/**
 * Pure turn-by-turn direction generation from a path of nodes.
 *
 * Labels use relative turns (left / right / straight) rather than compass
 * bearings — floor plans are not georeferenced to true north.
 *
 * Paths are simplified per floor before instructions are generated. The
 * instruction classifier suppresses shallow bends caused by graph-node
 * placement, even when a point remains in the directions-only path.
 */

import { simplifyPath, distance } from './geometry'
import { MAP_CONFIG } from './constants'
import { t } from './i18n'
import type { DirectionStep, Node, WalkTurn, Wall } from './types'

/**
 * Small bends are usually graph-node drift rather than an actual decision point.
 * Keep written directions focused on corridor corners, which are typically near
 * 90°. The displayed amber route retains its more precise simplification.
 */
export const COLLINEAR_THRESHOLD = 60

/**
 * Compute bearing in degrees (0 = map-up, clockwise) from node A to node B.
 * Leaflet Simple CRS: lat = Y (up), lng = X (right).
 */
export function bearingBetween(a: Node, b: Node): number {
  const dlng = b.lng - a.lng
  const dlat = b.lat - a.lat
  const radians = Math.atan2(dlng, dlat)
  return ((radians * 180) / Math.PI + 360) % 360
}

/**
 * Angle difference between two bearings, in [0, 180].
 */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Signed turn from `fromBearing` to `toBearing` in (-180, 180].
 * Positive = turn right (clockwise on the map), negative = turn left.
 */
export function signedTurnDegrees(fromBearing: number, toBearing: number): number {
  return ((toBearing - fromBearing + 540) % 360) - 180
}

/**
 * Distance-weighted circular mean of two bearings (handles 0°/360° wrap).
 * Compass convention: 0 = map-up, clockwise → unit vector (sin θ, cos θ).
 */
export function mergeBearings(b1: number, d1: number, b2: number, d2: number): number {
  const r1 = (b1 * Math.PI) / 180
  const r2 = (b2 * Math.PI) / 180
  const x = Math.sin(r1) * d1 + Math.sin(r2) * d2
  const y = Math.cos(r1) * d1 + Math.cos(r2) * d2
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

export interface WalkInstruction {
  label: string
  turn: WalkTurn
}

function turnPhrase(turnDeg: number): WalkInstruction {
  const abs = Math.abs(turnDeg)

  if (abs <= COLLINEAR_THRESHOLD) {
    return { label: t('direction.continue'), turn: 'straight' }
  }
  if (abs <= 135) {
    return turnDeg > 0
      ? { label: t('direction.right'), turn: 'right' }
      : { label: t('direction.left'), turn: 'left' }
  }
  return { label: t('direction.around'), turn: 'u-turn' }
}

/**
 * Human-readable walk instruction relative to the previous walk bearing.
 * When `afterStairs` is set, prefix with exit-stairs wording and use
 * `fromBearing` as the pre-stair approach (may be null).
 */
export function relativeWalkInstruction(
  fromBearing: number | null,
  toBearing: number,
  afterStairs = false
): WalkInstruction {
  if (afterStairs) {
    if (fromBearing === null) {
      return { label: t('direction.exitStairs'), turn: 'straight' }
    }
    const base = turnPhrase(signedTurnDegrees(fromBearing, toBearing))
    if (base.turn === 'straight') {
      return { label: t('direction.exitStairs'), turn: 'straight' }
    }
    const rest = base.label.charAt(0).toLowerCase() + base.label.slice(1)
    return { label: t('direction.exitStairsTurn', { direction: rest }), turn: base.turn }
  }

  if (fromBearing === null) {
    return { label: t('direction.continue'), turn: 'straight' }
  }

  return turnPhrase(signedTurnDegrees(fromBearing, toBearing))
}

/** Label-only helper wrapping `relativeWalkInstruction`. */
export function relativeWalkLabel(
  fromBearing: number | null,
  toBearing: number,
  afterStairs = false
): string {
  return relativeWalkInstruction(fromBearing, toBearing, afterStairs).label
}

/** Visible room/place name for a node, if any. */
export function landmarkName(node: Node): string | null {
  if (node.type === 'waypoint') return null
  for (const room of node.rooms) {
    const name = room.trim()
    if (name && name.toLowerCase() !== 'waypoint') return name
  }
  return null
}

function stairDisplayName(node: Node): string | null {
  const fromRooms = landmarkName(node)
  if (fromRooms) return `Stairs ${fromRooms}`
  const portal = node.connectsTo?.find((c) => c.trim())
  if (portal) return `Stairs ${portal.trim()}`
  return null
}

function withLandmark(label: string, turn: WalkTurn, atNode: Node | null): string {
  if (!atNode || atNode.type === 'stairway' || turn === 'straight') return label
  const name = landmarkName(atNode)
  if (!name) return label
  return t('direction.toward', { direction: label, place: name })
}

function isNumberedRoom(node: Node): boolean {
  const labels = node.rooms.map((room) => room.trim()).filter(Boolean)
  return labels.length > 0 && labels.every((label) => /^\d+[a-z]?$/i.test(label))
}

/**
 * Intermediate numbered rooms are graph anchors, not useful navigation landmarks.
 * Reclassifying them for the directions-only simplifier keeps meaningful corridor
 * turns while allowing wall-safe shortcuts to remove noisy room-to-room zig-zags.
 */
function directionNode(node: Node, isEndpoint: boolean): Node {
  if (isEndpoint || node.type !== 'room' || !isNumberedRoom(node)) return node
  return { ...node, type: 'waypoint', rooms: ['waypoint'] }
}

/**
 * Simplify each contiguous same-floor run using the directions-specific
 * threshold, then stitch the runs while preserving stair portals.
 */
export function preparePathForDirections(path: Node[], walls: readonly Wall[] = []): Node[] {
  if (path.length <= 2) return path

  const out: Node[] = []
  let i = 0
  while (i < path.length) {
    const floor = path[i].floor
    const segment: Node[] = []
    while (i < path.length && path[i].floor === floor) {
      segment.push(path[i])
      i++
    }
    const segmentWalls = walls.filter((wall) => wall.floor === undefined || wall.floor === floor)
    const directionSegment = segment.map((node, index) =>
      directionNode(node, index === 0 || index === segment.length - 1)
    )
    const simplified = simplifyPath(
      directionSegment,
      MAP_CONFIG.PATH_SIMPLIFICATION_ANGLE,
      MAP_CONFIG.RDP_EPSILON,
      segmentWalls
    )
    if (out.length > 0 && simplified.length > 0 && out[out.length - 1].uid === simplified[0].uid) {
      out.push(...simplified.slice(1))
    } else {
      out.push(...simplified)
    }
  }
  return out
}

/**
 * Build ordered direction steps from a full multi-floor path.
 * Does not touch the DOM — callers render the returned steps.
 */
export function buildDirectionSteps(path: Node[], walls: readonly Wall[] = []): DirectionStep[] {
  if (path.length === 0) return []

  const route = preparePathForDirections(path, walls)
  const steps: DirectionStep[] = []

  const startNode = route[0]
  const startLabel = landmarkName(startNode) ?? t('direction.startingPoint')
  steps.push({
    type: 'start',
    label: t('direction.start', { place: startLabel }),
    floor: startNode.floor ?? '',
  })

  if (route.length === 1) {
    steps.push({
      type: 'end',
      label: t('direction.arrive', {
        place: landmarkName(startNode) ?? t('direction.destination'),
      }),
      floor: startNode.floor ?? '',
    })
    return steps
  }

  let walkStartNode: Node | null = null
  let walkBearing: number | null = null
  let walkDistance = 0
  /** Bearing of the last flushed walk group; reset after stairs. */
  let previousWalkBearing: number | null = null
  /** Approach bearing into stairs — kept across both portal nodes. */
  let stairApproachBearing: number | null = null
  let afterStairs = false

  function flushWalk(): number | null {
    if (walkStartNode === null || walkBearing === null || walkDistance === 0) return null
    const fromBearing = afterStairs ? stairApproachBearing : previousWalkBearing
    const { label: baseLabel, turn } = relativeWalkInstruction(
      fromBearing,
      walkBearing,
      afterStairs
    )
    const label = withLandmark(baseLabel, turn, afterStairs ? null : walkStartNode)
    steps.push({
      type: 'walk',
      label,
      floor: walkStartNode.floor ?? '',
      distance: walkDistance,
      turn,
    })
    const flushedBearing = walkBearing
    previousWalkBearing = flushedBearing
    if (afterStairs) {
      stairApproachBearing = null
      afterStairs = false
    }
    walkStartNode = null
    walkBearing = null
    walkDistance = 0
    return flushedBearing
  }

  for (let i = 1; i < route.length; i++) {
    const prev = route[i - 1]
    const node = route[i]

    // A cross-floor edge represents a portal transition, never a physical walk
    // between the two floor-plan coordinate systems.
    if (prev.floor !== node.floor) continue

    const segBearing = bearingBetween(prev, node)
    const segDist = distance({ lat: prev.lat, lng: prev.lng }, { lat: node.lat, lng: node.lng })

    function accumulateSegment(): void {
      if (segDist === 0) return
      if (walkBearing === null) {
        walkStartNode = prev
        walkBearing = segBearing
        walkDistance = segDist
      } else if (angleDiff(segBearing, walkBearing) <= COLLINEAR_THRESHOLD) {
        walkBearing = mergeBearings(walkBearing, walkDistance, segBearing, segDist)
        walkDistance += segDist
      } else {
        flushWalk()
        walkStartNode = prev
        walkBearing = segBearing
        walkDistance = segDist
      }
    }

    const nextNode = route.at(i + 1)
    const leavesFloorThroughStairs =
      node.type === 'stairway' && nextNode !== undefined && nextNode.floor !== node.floor

    if (leavesFloorThroughStairs) {
      // Fold the approach into the stair so walk distance/bearing are correct.
      accumulateSegment()
      const approachBearing = flushWalk()
      if (approachBearing !== null) {
        stairApproachBearing = approachBearing
      }
      previousWalkBearing = null
      afterStairs = true

      const stairName = stairDisplayName(node)
      steps.push({
        type: 'stair',
        label: stairName
          ? t('direction.takeNamedStairs', { stairs: stairName, floor: nextNode.floor ?? '' })
          : t('direction.takeStairs', { floor: nextNode.floor ?? '' }),
        floor: node.floor ?? '',
        targetFloor: nextNode.floor,
      })
      continue
    }

    accumulateSegment()
  }

  flushWalk()

  const endNode = route[route.length - 1]
  steps.push({
    type: 'end',
    label: t('direction.arrive', { place: landmarkName(endNode) ?? t('direction.destination') }),
    floor: endNode.floor ?? '',
  })

  return steps
}
