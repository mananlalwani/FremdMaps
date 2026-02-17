/**
 * Direction generation for navigation
 * Converts a path into human-readable turn-by-turn directions
 * 
 * Enhanced version with:
 * - Waypoint filtering (only shows significant landmarks)
 * - Landmark-based navigation (mentions nearby rooms)
 * - Intersection detection (T-junction, 4-way, etc.)
 * - Relative positioning (left/right/ahead)
 * - Distance consolidation (cumulative for straight segments)
 */

import type { Node, Direction, Graph } from './types'
import { distance } from './geometry'

/**
 * Convert angle to cardinal direction
 * @param lat1 Starting latitude
 * @param lng1 Starting longitude
 * @param lat2 Ending latitude
 * @param lng2 Ending longitude
 * @returns Cardinal direction string (e.g., "north", "northeast")
 */
function getCardinalDirection(
  lat1: number, 
  lng1: number, 
  lat2: number, 
  lng2: number
): string {
  const dx = lng2 - lng1
  const dy = lat2 - lat1
  
  // Calculate angle in degrees (0° = north, 90° = east)
  // Note: -dy because in Leaflet Simple CRS, negative lat is down
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI
  
  // Normalize to 0-360
  const normalized = (angle + 360) % 360
  
  // Map to cardinal directions (8 directions)
  if (normalized < 22.5 || normalized >= 337.5) return "north"
  if (normalized < 67.5) return "northeast"
  if (normalized < 112.5) return "east"
  if (normalized < 157.5) return "southeast"
  if (normalized < 202.5) return "south"
  if (normalized < 247.5) return "southwest"
  if (normalized < 292.5) return "west"
  return "northwest"
}

/**
 * Calculate angle (in degrees) between three consecutive points
 * Returns the angle at the middle point
 * 
 * @returns Angle in degrees (0-180)
 */
function calculateAngle(prev: Node, current: Node, next: Node): number {
  // Vectors from current to prev and current to next
  const v1x = prev.lng - current.lng
  const v1y = prev.lat - current.lat
  const v2x = next.lng - current.lng
  const v2y = next.lat - current.lat
  
  // Calculate dot product and magnitudes
  const dot = v1x * v2x + v1y * v2y
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y)
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y)
  
  if (mag1 === 0 || mag2 === 0) return 180
  
  const cosAngle = dot / (mag1 * mag2)
  const clampedCos = Math.max(-1, Math.min(1, cosAngle))
  const angleRad = Math.acos(clampedCos)
  
  return angleRad * 180 / Math.PI
}

/**
 * Calculate turn direction between three consecutive points
 * @returns "left", "right", or "straight"
 */
function getTurnDirection(prev: Node, current: Node, next: Node): string {
  // Vectors
  const v1x = current.lng - prev.lng
  const v1y = current.lat - prev.lat
  const v2x = next.lng - current.lng
  const v2y = next.lat - current.lat
  
  // Cross product (determines left/right turn)
  const cross = v1x * v2y - v1y * v2x
  
  // Check angle magnitude
  const angle = calculateAngle(prev, current, next)
  
  // If angle is small (mostly straight), return "straight"
  if (angle < 30) {
    return "straight"
  }
  
  // Determine turn direction from cross product
  if (cross > 0) {
    return "right"
  } else if (cross < 0) {
    return "left"
  } else {
    return "straight"
  }
}

/**
 * Check if a node is significant for directions
 * Significant nodes: rooms, or waypoints with sharp turns
 */
function isSignificantNode(
  prev: Node | null, 
  current: Node, 
  next: Node | null,
  angleThreshold: number = 30
): boolean {
  // Start and end are always significant
  if (!prev || !next) return true
  
  // Room nodes are always significant (landmarks)
  const isRoom = current.type === "room" || 
                 !current.rooms.includes("waypoint")
  if (isRoom) return true
  
  // Waypoints are significant if they have a sharp turn
  const angle = calculateAngle(prev, current, next)
  return angle >= angleThreshold
}

/**
 * Filter path to only nodes that need directions
 * - Start and end (always)
 * - Room nodes (landmarks)
 * - Waypoints with significant turns (>30 degrees)
 */
function filterSignificantNodes(path: Node[]): Node[] {
  if (path.length <= 2) return path
  
  const significant: Node[] = []
  
  // Always include first node
  significant.push(path[0])
  
  // Check middle nodes
  for (let i = 1; i < path.length - 1; i++) {
    if (isSignificantNode(path[i-1], path[i], path[i+1])) {
      significant.push(path[i])
    }
  }
  
  // Always include last node
  significant.push(path[path.length - 1])
  
  console.log(`Filtered path for directions: ${path.length} → ${significant.length} nodes`)
  return significant
}

/**
 * Calculate cumulative distance along path between two nodes
 * Sums up all segment distances for "Continue for X units" instructions
 */
function calculateCumulativeDistance(
  fromNode: Node,
  toNode: Node,
  fullPath: Node[]
): number {
  const fromIndex = fullPath.findIndex(n => n.uid === fromNode.uid)
  const toIndex = fullPath.findIndex(n => n.uid === toNode.uid)
  
  if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) {
    // Fallback to direct distance
    return distance(
      { lat: fromNode.lat, lng: fromNode.lng },
      { lat: toNode.lat, lng: toNode.lng }
    )
  }
  
  // Sum distances for all segments
  let total = 0
  for (let i = fromIndex; i < toIndex; i++) {
    total += distance(
      { lat: fullPath[i].lat, lng: fullPath[i].lng },
      { lat: fullPath[i+1].lat, lng: fullPath[i+1].lng }
    )
  }
  
  return total
}

/**
 * Detect intersection type based on graph connections
 * Useful for contextual directions like "at the T-junction"
 */
function detectIntersectionType(node: Node, graph?: Graph): string {
  if (!graph) return ""
  
  const connections = graph.get(node.uid)
  if (!connections) return ""
  
  const numConnections = connections.length
  
  // Simple heuristic based on number of connections
  if (numConnections === 2) return "" // Just a point on a path
  if (numConnections === 3) return "T-intersection"
  if (numConnections >= 4) return "4-way intersection"
  
  return ""
}

/**
 * Find nearby room nodes along a path segment
 * Used for landmark-based directions like "Pass Room 240 on your right"
 */
function findNearbyRooms(
  fromNode: Node,
  toNode: Node,
  allNodes: Node[],
  maxDistance: number = 100
): Node[] {
  const nearby: Node[] = []
  
  for (const node of allNodes) {
    // Skip waypoints
    if (node.type === "waypoint" || node.rooms.includes("waypoint")) {
      continue
    }
    
    // Skip the from/to nodes themselves
    if (node.uid === fromNode.uid || node.uid === toNode.uid) {
      continue
    }
    
    // Calculate perpendicular distance to segment
    // Simplified: just check distance to midpoint
    const midLat = (fromNode.lat + toNode.lat) / 2
    const midLng = (fromNode.lng + toNode.lng) / 2
    
    const dist = distance(
      { lat: node.lat, lng: node.lng },
      { lat: midLat, lng: midLng }
    )
    
    if (dist <= maxDistance) {
      nearby.push(node)
    }
  }
  
  return nearby
}

/**
 * Determine if a destination is on the left or right of the approach vector
 * Uses cross product to determine relative position
 */
function getRelativePosition(prev: Node, dest: Node): "left" | "right" | "ahead" {
  // Vector from prev to dest
  const dx = dest.lng - prev.lng
  const dy = dest.lat - prev.lat
  
  // If almost collinear, it's ahead
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    return "ahead"
  }
  
  // Use cross product with "forward" direction
  // In Leaflet CRS, north is negative lat
  const cross = dx * (-1) - dy * 1 // Forward is roughly "up" (-lat direction)
  
  // Simple heuristic: check if dest is more left or right
  if (Math.abs(dx) > Math.abs(dy)) {
    // More horizontal movement
    return dx > 0 ? "right" : "left"
  } else {
    // More vertical movement - use cross product sign
    return cross > 0 ? "right" : "left"
  }
}

/**
 * Get room names from a node, excluding waypoint markers
 */
function getRoomNames(node: Node): string {
  if (!node.rooms || node.rooms.length === 0) return ""
  
  const rooms = node.rooms.filter(r => r !== "waypoint")
  if (rooms.length === 0) return ""
  
  return rooms.join(", ")
}

/**
 * Create starting instruction
 * Enhanced with context about initial direction and first landmark
 */
function createStartInstruction(path: Node[]): Direction {
  const start = path[0]
  const next = path.length > 1 ? path[1] : start
  
  const dir = getCardinalDirection(start.lat, start.lng, next.lat, next.lng)
  const dist = distance(
    { lat: start.lat, lng: start.lng },
    { lat: next.lat, lng: next.lng }
  )
  
  let text = ""
  const startRooms = getRoomNames(start)
  
  if (startRooms) {
    text = `Start at ${startRooms} and head ${dir}`
  } else {
    text = `Start by heading ${dir}`
  }
  
  // Add destination context if next node is a room
  const nextRooms = getRoomNames(next)
  if (nextRooms && next.uid !== start.uid) {
    text += ` toward ${nextRooms}`
  }
  
  return {
    text,
    distance: Math.round(dist),
    fromNode: start.uid,
    toNode: next.uid
  }
}

/**
 * Create turn instruction with rich context
 * Includes landmarks, intersection types, and relative positioning
 */
function createTurnInstruction(
  prev: Node,
  current: Node,
  next: Node,
  allNodes: Node[],
  fullPath: Node[],
  graph?: Graph
): Direction {
  // Check if current node is a stairway (floor transition)
  if (current.type === "stairway") {
    const currentFloor = current.floor || "?"
    const nextFloor = next.floor || "?"
    
    // If floors are different, this is a floor transition
    if (nextFloor !== currentFloor) {
      const stairwayName = getRoomNames(current) || "the stairway"
      const dist = calculateCumulativeDistance(current, next, fullPath)
      
      return {
        text: `Take ${stairwayName} to Floor ${nextFloor}`,
        distance: Math.round(dist),
        fromNode: current.uid,
        toNode: next.uid
      }
    }
  }
  
  const turn = getTurnDirection(prev, current, next)
  const dir = getCardinalDirection(current.lat, current.lng, next.lat, next.lng)
  const dist = calculateCumulativeDistance(current, next, fullPath)
  
  let text = ""
  
  // Check if current node is a landmark (room)
  const currentRooms = getRoomNames(current)
  const nextRooms = getRoomNames(next)
  
  // Detect intersection type
  const intersection = detectIntersectionType(current, graph)
  
  // Build instruction based on turn type
  if (turn === "straight") {
    text = `Continue ${dir}`
    
    if (currentRooms) {
      text += ` past ${currentRooms}`
    } else if (intersection) {
      text += ` through the ${intersection}`
    }
  } else {
    // Left or right turn
    text = `Turn ${turn}`
    
    // Add context about where to turn
    if (intersection) {
      text += ` at the ${intersection}`
    } else if (currentRooms) {
      text += ` at ${currentRooms}`
    }
    
    // Add heading direction
    text += ` and head ${dir}`
  }
  
  // Add destination context
  if (nextRooms) {
    text += ` toward ${nextRooms}`
  } else {
    // Check for nearby landmarks
    const nearby = findNearbyRooms(current, next, allNodes, 80)
    if (nearby.length > 0) {
      const landmarkRooms = getRoomNames(nearby[0])
      if (landmarkRooms) {
        const position = getRelativePosition(current, nearby[0])
        text += ` (${landmarkRooms} will be on your ${position})`
      }
    }
  }
  
  return {
    text,
    distance: Math.round(dist),
    fromNode: current.uid,
    toNode: next.uid
  }
}

/**
 * Create arrival instruction with positioning
 * Provides context like "will be on your left"
 */
function createArrivalInstruction(path: Node[]): Direction {
  const dest = path[path.length - 1]
  const prev = path.length > 1 ? path[path.length - 2] : dest
  
  let text = "Arrive at your destination"
  
  const destRooms = getRoomNames(dest)
  if (destRooms) {
    text = `Arrive at ${destRooms}`
    
    // Add relative position if we have a previous node
    if (prev.uid !== dest.uid) {
      const position = getRelativePosition(prev, dest)
      if (position !== "ahead") {
        text += ` (on your ${position})`
      }
    }
  } else if (dest.type === "bathroom") {
    // Handle bathroom arrival
    text = "Arrive at the bathroom"
  } else if (dest.type === "stairway") {
    // Handle stairway arrival (if destination is a stairway)
    text = "Arrive at the stairway"
    if (dest.floor) {
      text += ` on Floor ${dest.floor}`
    }
  }
  
  return {
    text,
    distance: 0,
    fromNode: prev.uid,
    toNode: dest.uid
  }
}

/**
 * Generate turn-by-turn directions from a path
 * Enhanced with landmark detection, intersection awareness, and smart filtering
 * 
 * @param path Array of nodes representing the route (including all waypoints)
 * @param allNodes Array of all nodes (for landmark detection)
 * @param graph Navigation graph (for intersection detection)
 * @returns Array of Direction objects with human-readable instructions
 */
export function generateDirections(
  path: Node[],
  allNodes: Node[] = [],
  graph?: Graph
): Direction[] {
  if (path.length < 2) {
    return []
  }
  
  console.log('Generating directions for path with', path.length, 'nodes')
  
  // Filter to significant nodes only (removes most waypoints)
  const significant = filterSignificantNodes(path)
  console.log('Using', significant.length, 'significant nodes for directions')
  
  const directions: Direction[] = []
  
  // Start instruction
  directions.push(createStartInstruction(significant))
  
  // Turn instructions for middle segments
  for (let i = 1; i < significant.length - 1; i++) {
    const instruction = createTurnInstruction(
      significant[i-1],
      significant[i],
      significant[i+1],
      allNodes,
      path, // Pass full path for accurate distance calculation
      graph
    )
    directions.push(instruction)
  }
  
  // Arrival instruction
  if (significant.length > 1) {
    directions.push(createArrivalInstruction(significant))
  }
  
  console.log(`Generated ${directions.length} direction steps`)
  return directions
}

/**
 * Format distance for display
 * @param pixels Distance in pixels
 * @returns Formatted string (e.g., "42 units" or "~50 units")
 */
export function formatDistance(pixels: number): string {
  if (pixels < 10) {
    return `${Math.round(pixels)} units`
  } else if (pixels < 100) {
    return `~${Math.round(pixels / 10) * 10} units`
  } else {
    return `~${Math.round(pixels / 50) * 50} units`
  }
}
