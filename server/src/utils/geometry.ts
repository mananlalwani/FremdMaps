/**
 * Geometry utility functions for navigation (server-side copy).
 * Handles distance calculations and line intersection (parametric formula).
 *
 * Must be kept in sync with `client/src/utils/geometry.ts`.
 * (The client copy additionally exports `perpendicularDistance` and
 * `simplifyPath` which are not needed server-side.)
 */

import type { Point, Wall } from './types'
import { GEOMETRY } from './constants'

/**
 * Calculate Euclidean distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p1.lng - p2.lng
  const dy = p1.lat - p2.lat
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Check if two line segments intersect.
 * Uses parametric line intersection formula.
 *
 * @param p1 Start of line segment 1 (navigation path)
 * @param p2 End of line segment 1 (navigation path)
 * @param w1 Start of line segment 2 (wall)
 * @param w2 End of line segment 2 (wall)
 * @returns true if segments intersect (excluding exact endpoints)
 */
export function segmentsIntersect(
  p1: Point,
  p2: Point,
  w1: Point,
  w2: Point
): boolean {
  const x1 = p1.lng, y1 = p1.lat
  const x2 = p2.lng, y2 = p2.lat
  const x3 = w1.lng, y3 = w1.lat
  const x4 = w2.lng, y4 = w2.lat

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
 * Check if a line of sight exists between two points.
 * Returns false if any wall segment blocks the straight-line path.
 *
 * @param p1    Start point
 * @param p2    End point
 * @param walls Array of wall segments to test against
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
 * Convert raw wall data from disk/API to Wall objects.
 * Disk format: array of polylines, each polyline is an array of [lat, lng] pairs.
 * A polyline with N points yields N-1 Wall segments (consecutive pairs).
 */
export function convertWallData(wallData: number[][][]): Wall[] {
  const walls: Wall[] = []
  for (const polyline of wallData) {
    for (let i = 0; i < polyline.length - 1; i++) {
      walls.push({
        start: { lat: polyline[i][0], lng: polyline[i][1] },
        end:   { lat: polyline[i + 1][0], lng: polyline[i + 1][1] },
      })
    }
  }
  return walls
}
