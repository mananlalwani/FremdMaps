/**
 * Geometry utility functions for navigation
 * Handles distance calculations and line intersection (ray casting)
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
 * Check if two line segments intersect
 * Uses parametric line intersection formula
 * 
 * @param p1 Start of line segment 1
 * @param p2 End of line segment 1
 * @param w1 Start of line segment 2 (wall)
 * @param w2 End of line segment 2 (wall)
 * @returns true if segments intersect
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
  return t >= GEOMETRY.EPSILON && t <= (1 - GEOMETRY.EPSILON) && 
         u >= GEOMETRY.EPSILON && u <= (1 - GEOMETRY.EPSILON)
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
 * Convert raw wall data from API to Wall objects
 * API format: [[[lat1, lng1], [lat2, lng2]], ...]
 */
export function convertWallData(wallData: number[][][]): Wall[] {
  return wallData.map(wall => ({
    start: { lat: wall[0][0], lng: wall[0][1] },
    end: { lat: wall[1][0], lng: wall[1][1] }
  }))
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
export function perpendicularDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const dx = lineEnd.lng - lineStart.lng
  const dy = lineEnd.lat - lineStart.lat
  
  // Line segment length squared
  const lengthSquared = dx * dx + dy * dy
  
  // Handle degenerate case (line segment is a point)
  if (lengthSquared === 0) {
    return distance(point, lineStart)
  }
  
  // Calculate projection parameter t
  const t = Math.max(0, Math.min(1, (
    (point.lng - lineStart.lng) * dx + 
    (point.lat - lineStart.lat) * dy
  ) / lengthSquared))
  
  // Find closest point on line segment
  const projection: Point = {
    lng: lineStart.lng + t * dx,
    lat: lineStart.lat + t * dy
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
function rdpSimplify(points: Point[], epsilon: number): Point[] {
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
function calculateAngleBetween(p1: Point, p2: Point, p3: Point): number {
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
  
  return angleRad * 180 / Math.PI
}

/**
 * Simplify a navigation path by removing unnecessary waypoints
 * Uses hybrid approach: angle-based filtering + RDP algorithm
 * 
 * Algorithm:
 * 1. Always keep start, end, and room nodes
 * 2. For waypoint sequences, remove points with small angle changes
 * 3. If still too many points, apply RDP for further simplification
 * 
 * @param path Full path including all waypoints
 * @param angleThreshold Minimum angle change in degrees to keep waypoint (default 30)
 * @param rdpEpsilon Distance threshold for RDP algorithm (default 50 pixels)
 * @returns Simplified path with only significant nodes
 */
export function simplifyPath(
  path: any[], 
  angleThreshold: number = 30, 
  rdpEpsilon: number = 50
): any[] {
  // Need at least 3 points to simplify
  if (path.length <= 2) {
    return path
  }
  
  console.log(`Simplifying path: ${path.length} nodes → `, { angleThreshold, rdpEpsilon })
  
  const simplified: any[] = []
  simplified.push(path[0]) // Always keep start
  
  // Pass 1: Filter by angle and room type
  for (let i = 1; i < path.length - 1; i++) {
    const node = path[i]
    
    // Always keep room nodes (important landmarks)
    const isRoom = node.type === "room" || 
                   (node.rooms && !node.rooms.includes("waypoint"))
    
    if (isRoom) {
      simplified.push(node)
      console.log(`  Keeping room node: ${node.rooms?.join(', ')}`)
      continue
    }
    
    // For waypoints, check if angle change is significant
    const angle = calculateAngleBetween(
      { lat: path[i-1].lat, lng: path[i-1].lng },
      { lat: node.lat, lng: node.lng },
      { lat: path[i+1].lat, lng: path[i+1].lng }
    )
    
    // Keep waypoints with significant turns
    if (angle >= angleThreshold) {
      simplified.push(node)
      console.log(`  Keeping waypoint with ${Math.round(angle)}° turn`)
    } else {
      console.log(`  Removing waypoint with ${Math.round(angle)}° turn (< ${angleThreshold}°)`)
    }
  }
  
  simplified.push(path[path.length - 1]) // Always keep end
  
  console.log(`After angle filtering: ${simplified.length} nodes`)
  
  // Pass 2: Apply RDP if still too many points
  if (simplified.length > 10) {
    console.log(`Applying RDP (epsilon=${rdpEpsilon}) to further simplify...`)
    
    // Convert to Points for RDP
    const points: Point[] = simplified.map(n => ({ lat: n.lat, lng: n.lng }))
    const rdpPoints = rdpSimplify(points, rdpEpsilon)
    
    console.log(`After RDP: ${rdpPoints.length} points`)
    
    // Map RDP points back to original nodes
    // Keep nodes whose coordinates match RDP output
    const rdpSimplified = rdpPoints.map(pt => {
      const node = simplified.find(n => 
        Math.abs(n.lat - pt.lat) < 0.001 && 
        Math.abs(n.lng - pt.lng) < 0.001
      )
      return node!
    }).filter(n => n !== undefined)
    
    return rdpSimplified
  }
  
  console.log(`Final simplified path: ${simplified.length} nodes`)
  return simplified
}
