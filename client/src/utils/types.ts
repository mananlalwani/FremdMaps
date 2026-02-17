/**
 * Type definitions for navigation system
 */

export interface Point {
  lat: number  // Y coordinate in Leaflet Simple CRS
  lng: number  // X coordinate in Leaflet Simple CRS
}

export interface Node {
  uid: string
  rooms: string[]
  lat: number
  lng: number
  type?: "room" | "waypoint" | "bathroom" | "stairway"
  
  // Optional fields for special node types
  bathroomType?: "all-gender" | "mens" | "womens" | "accessible"  // Future use
  floor?: string  // Current floor (e.g., "1", "2", "3")
  connectsTo?: string[]  // For stairways: UIDs of nodes on other floors
  category?: RoomCategory  // Room categorization for search/filtering
}

export type RoomCategory = 
  | "classroom" 
  | "office" 
  | "lab" 
  | "bathroom" 
  | "cafeteria" 
  | "gymnasium" 
  | "library"
  | "auditorium"
  | "stairway"
  | "entrance"
  | "other"

// Search result with relevance score
export interface SearchResult {
  node: Node
  score: number  // Fuzzy match score (lower is better)
  matches: string[]  // Which room names matched
}

// Search history entry
export interface SearchHistoryEntry {
  from: string
  to: string
  timestamp: number
}

export interface Wall {
  start: Point
  end: Point
}

export interface Edge {
  to: string       // Target node UID
  cost: number     // Distance/weight
}

export type Graph = Map<string, Edge[]>

export interface PathResult {
  path: Node[]       // Ordered list of nodes from start to goal
  distance: number   // Total path distance
  found: boolean     // Whether a path exists
}

export interface Direction {
  text: string           // "Head northeast toward Room 205"
  distance: number       // Distance in pixels
  fromNode: string
  toNode: string
}
