/**
 * Geometry utility functions for navigation
 * Handles distance calculations and line intersection (ray casting)
 */

import type { Point, Wall, Node } from './types'
import { GEOMETRY, MAP_CONFIG } from './constants'

/**
 * Calculate Euclidean distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p1.lng - p2.lng
  const dy = p1.lat - p2.lat
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Check if two line segments intersect
 * Uses parametric line intersection formula
 *
 * @param p1 Start of line segment 1
 * @param p2 End of line segment 1
 * @param w1 Start of line segment 2 (wall)
 * @param w2 End of line segment 2 (wall)
 * @returns true if segments intersect
 */
export function segmentsIntersect(p1: Point, p2: Point, w1: Point, w2: Point): boolean {
  const x1 = p1.lng,
    y1 = p1.lat
  const x2 = p2.lng,
    y2 = p2.lat
  const x3 = w1.lng,
    y3 = w1.lat
  const x4 = w2.lng,
    y4 = w2.lat

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)

  // Lines are parallel (or coincident)
  if (Math.abs(denom) < GEOMETRY.INTERSECTION_EPSILON) {
    return false
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom

  // Segments intersect if both parameters are between epsilon and 1-epsilon
  // (excludes exact endpoints to prevent false positives at node positions)
  return (
    t >= GEOMETRY.EPSILON &&
    t <= 1 - GEOMETRY.EPSILON &&
    u >= GEOMETRY.EPSILON &&
    u <= 1 - GEOMETRY.EPSILON
  )
}

/**
 * Check if a line of sight exists between two points
 * Returns false if any wall blocks the path
 *
 * @param p1 Start point
 * @param p2 End point
 * @param walls Array of wall segments
 * @returns true if no walls block the line of sight
 */
export function hasLineOfSight(p1: Point, p2: Point, walls: Wall[]): boolean {
  for (const wall of walls) {
    if (segmentsIntersect(p1, p2, wall.start, wall.end)) {
      return false
    }
  }
  return true
}

/**
 * Convert raw wall data from static JSON to Wall objects.
 * On-disk format: an array of polylines, each an array of [lat, lng] pairs.
 * A polyline with N points yields N-1 Wall segments (consecutive pairs).
 */
export function convertWallData(wallData: number[][][]): Wall[] {
  const walls: Wall[] = []
  for (const polyline of wallData) {
    for (let i = 0; i < polyline.length - 1; i++) {
      walls.push({
        start: { lat: polyline[i][0], lng: polyline[i][1] },
        end: { lat: polyline[i + 1][0], lng: polyline[i + 1][1] },
      })
    }
  }
  return walls
}

/**
 * Calculate perpendicular distance from a point to a line segment
 * Used in Ramer-Douglas-Peucker algorithm
 *
 * @param point Point to measure distance from
 * @param lineStart Start of line segment
 * @param lineEnd End of line segment
 * @returns Perpendicular distance in pixels
 */
export function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.lng - lineStart.lng
  const dy = lineEnd.lat - lineStart.lat

  // Line segment length squared
  const lengthSquared = dx * dx + dy * dy

  // Handle degenerate case (line segment is a point)
  if (lengthSquared === 0) {
    return distance(point, lineStart)
  }

  // Calculate projection parameter t
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / lengthSquared
    )
  )

  // Find closest point on line segment
  const projection: Point = {
    lng: lineStart.lng + t * dx,
    lat: lineStart.lat + t * dy,
  }

  return distance(point, projection)
}

/**
 * Ramer-Douglas-Peucker path simplification algorithm
 * Recursively removes points that don't significantly affect path shape
 *
 * @param points Array of points to simplify
 * @param epsilon Distance threshold (pixels) - points closer than this may be removed
 * @returns Simplified array of points
 */
export function rdpSimplify(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) {
    return points
  }

  // Find point with maximum distance from line between first and last
  let maxDistance = 0
  let maxIndex = 0
  const start = points[0]
  const end = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end)
    if (dist > maxDistance) {
      maxDistance = dist
      maxIndex = i
    }
  }

  // If max distance exceeds epsilon, recursively simplify
  if (maxDistance > epsilon) {
    // Recursively simplify both halves
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon)
    const right = rdpSimplify(points.slice(maxIndex), epsilon)

    // Combine results (remove duplicate middle point)
    return left.slice(0, -1).concat(right)
  } else {
    // All points between start and end can be removed
    return [start, end]
  }
}

/**
 * Calculate angle (in degrees) between three consecutive points
 * Returns the angle at the middle point (p2)
 *
 * @param p1 First point
 * @param p2 Middle point (vertex)
 * @param p3 Third point
 * @returns Angle in degrees (0-180)
 */
export function calculateAngleBetween(p1: Point, p2: Point, p3: Point): number {
  // Vectors from p2 to p1 and p2 to p3
  const v1x = p1.lng - p2.lng
  const v1y = p1.lat - p2.lat
  const v2x = p3.lng - p2.lng
  const v2y = p3.lat - p2.lat

  // Calculate dot product and magnitudes
  const dot = v1x * v2x + v1y * v2y
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)

  // Avoid division by zero
  if (mag1 === 0 || mag2 === 0) {
    return 180
  }

  // Calculate angle using dot product formula
  const cosAngle = dot / (mag1 * mag2)
  // Clamp to [-1, 1] to handle floating point errors
  const clampedCos = Math.max(-1, Math.min(1, cosAngle))
  const angleRad = Math.acos(clampedCos)

  return (angleRad * 180) / Math.PI
}

/**
 * Calculate the change in travel direction at the middle point.
 * Straight travel is 0°, a right-angle turn is 90°, and a U-turn is 180°.
 */
export function calculateTurnAngle(p1: Point, p2: Point, p3: Point): number {
  return 180 - calculateAngleBetween(p1, p2, p3)
}

function isRequiredRouteNode(node: Node): boolean {
  if (node.type !== undefined) return node.type !== 'waypoint'

  // Untyped legacy nodes with a meaningful room label are landmarks.
  return node.rooms.some((room) => room.trim().toLowerCase() !== 'waypoint')
}

function simplifyRun(
  path: readonly Node[],
  startIndex: number,
  endIndex: number,
  epsilon: number,
  walls: readonly Wall[]
): Node[] {
  if (endIndex <= startIndex + 1) return [path[startIndex], path[endIndex]]

  let maxDistance = -1
  let splitIndex = startIndex + 1
  for (let index = startIndex + 1; index < endIndex; index++) {
    const deviation = perpendicularDistance(path[index], path[startIndex], path[endIndex])
    if (deviation > maxDistance) {
      maxDistance = deviation
      splitIndex = index
    }
  }

  const hasSafeShortcut = hasLineOfSight(path[startIndex], path[endIndex], [...walls])
  if (maxDistance <= epsilon && hasSafeShortcut) {
    return [path[startIndex], path[endIndex]]
  }

  // A blocked collinear shortcut has no greatest-deviation point. Split at a
  // deterministic midpoint so recursion reaches original graph edges.
  if (maxDistance === 0) {
    splitIndex = Math.floor((startIndex + endIndex) / 2)
  }

  const left = simplifyRun(path, startIndex, splitIndex, epsilon, walls)
  const right = simplifyRun(path, splitIndex, endIndex, epsilon, walls)
  return left.slice(0, -1).concat(right)
}

/**
 * Simplify a route while preserving navigation landmarks and every meaningful
 * turn. Every replacement segment is checked against the provided walls, so
 * the rendered route cannot shortcut through an obstacle.
 *
 * @param path Full path including all waypoints.
 * @param angleThreshold Minimum travel-direction change in degrees to keep an optional waypoint.
 * @param rdpEpsilon Maximum perpendicular deviation for a safe RDP shortcut.
 * @param walls Walls for this path's floor. Callers rendering a floor should pass its wall segments.
 */
export function simplifyPath(
  path: readonly Node[],
  angleThreshold: number = MAP_CONFIG.PATH_SIMPLIFICATION_ANGLE,
  rdpEpsilon: number = MAP_CONFIG.RDP_EPSILON,
  walls: readonly Wall[] = []
): Node[] {
  if (path.length <= 2) return [...path]

  const anchors = [0]
  for (let index = 1; index < path.length - 1; index++) {
    const node = path[index]
    const turnAngle = calculateTurnAngle(path[index - 1], node, path[index + 1])
    if (isRequiredRouteNode(node) || turnAngle >= angleThreshold) {
      anchors.push(index)
    }
  }
  anchors.push(path.length - 1)

  const simplified: Node[] = []
  for (let index = 1; index < anchors.length; index++) {
    const run = simplifyRun(path, anchors[index - 1], anchors[index], rdpEpsilon, walls)
    if (simplified.length === 0) {
      simplified.push(...run)
    } else {
      simplified.push(...run.slice(1))
    }
  }

  return simplified
}
