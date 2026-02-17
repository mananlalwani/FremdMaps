/**
 * Advanced search utilities with fuzzy matching
 * Uses Fuse.js for intelligent search with typo tolerance
 */

import Fuse from 'fuse.js'
import type { Node, SearchResult, RoomCategory } from './types'

/**
 * Infer room category from room name/number
 * Uses pattern matching and keywords
 */
export function inferCategory(node: Node): RoomCategory {
  // If category is explicitly set, use it
  if (node.category) return node.category

  // Check node type first
  if (node.type === "bathroom") return "bathroom"
  if (node.type === "stairway") return "stairway"
  if (node.type === "waypoint") return "other"

  // Check room names for keywords
  const roomNames = node.rooms.join(' ').toLowerCase()

  if (roomNames.includes('cafeteria') || roomNames.includes('cafe') || roomNames.includes('dining')) {
    return "cafeteria"
  }
  if (roomNames.includes('gym') || roomNames.includes('gymnasium')) {
    return "gymnasium"
  }
  if (roomNames.includes('library') || roomNames.includes('media center')) {
    return "library"
  }
  if (roomNames.includes('auditorium') || roomNames.includes('theater') || roomNames.includes('theatre')) {
    return "auditorium"
  }
  if (roomNames.includes('lab') || roomNames.includes('computer') || roomNames.includes('science')) {
    return "lab"
  }
  if (roomNames.includes('office') || roomNames.includes('admin') || roomNames.includes('main office')) {
    return "office"
  }
  if (roomNames.includes('entrance') || roomNames.includes('lobby') || roomNames.includes('reception')) {
    return "entrance"
  }

  // If it's a pure number, likely a classroom
  if (node.rooms.some(r => /^\d+$/.test(r))) {
    return "classroom"
  }

  return "other"
}

/**
 * Get display name for a category
 */
export function getCategoryLabel(category: RoomCategory): string {
  const labels: Record<RoomCategory, string> = {
    classroom: "Classroom",
    office: "Office",
    lab: "Lab",
    bathroom: "Bathroom",
    cafeteria: "Cafeteria",
    gymnasium: "Gymnasium",
    library: "Library",
    auditorium: "Auditorium",
    stairway: "Stairway",
    entrance: "Entrance",
    other: "Other"
  }
  return labels[category] || "Unknown"
}

/**
 * Get icon for category (simple text/symbol based)
 */
export function getCategoryIcon(category: RoomCategory): string {
  const icons: Record<RoomCategory, string> = {
    classroom: "▪",
    office: "●",
    lab: "◆",
    bathroom: "■",
    cafeteria: "▸",
    gymnasium: "◇",
    library: "▫",
    auditorium: "◉",
    stairway: "▴",
    entrance: "▾",
    other: "○"
  }
  return icons[category] || "○"
}

/**
 * Search index cache
 * Prevents rebuilding Fuse.js index on every keystroke
 */
let searchIndexCache: {
  nodes: Node[]
  fuse: Fuse<Node>
} | null = null

/**
 * Create Fuse.js search index
 * Configured for optimal fuzzy matching
 */
export function createSearchIndex(nodes: Node[]): Fuse<Node> {
  // Filter out waypoints (not searchable)
  const searchableNodes = nodes.filter(n => 
    n.type !== "waypoint" && !n.rooms.includes("waypoint")
  )

  return new Fuse(searchableNodes, {
    keys: [
      { name: 'rooms', weight: 0.9 },  // Primary search field
      { name: 'type', weight: 0.1 }    // Secondary
    ],
    threshold: 0.4,  // 0 = exact match, 1 = match anything
    distance: 100,   // Max distance for fuzzy match
    minMatchCharLength: 1,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,  // Search anywhere in string
    useExtendedSearch: false
  })
}

/**
 * Get or create cached search index
 * Only rebuilds if nodes array has changed
 */
function getCachedSearchIndex(nodes: Node[]): Fuse<Node> {
  // Check if cache exists and nodes haven't changed
  if (searchIndexCache && searchIndexCache.nodes === nodes) {
    return searchIndexCache.fuse
  }
  
  // Create new index and cache it
  const fuse = createSearchIndex(nodes)
  searchIndexCache = { nodes, fuse }
  
  return fuse
}

/**
 * Invalidate search cache (call when nodes are modified in admin mode)
 */
export function invalidateSearchCache(): void {
  searchIndexCache = null
}

/**
 * Search nodes with fuzzy matching
 * Returns results sorted by relevance
 */
export function searchNodes(
  query: string, 
  nodes: Node[], 
  options?: {
    limit?: number
    categoryFilter?: RoomCategory[]
  }
): SearchResult[] {
  if (!query || query.trim().length === 0) {
    return []
  }

  const limit = options?.limit ?? 10
  const categoryFilter = options?.categoryFilter

  // Filter by category first if specified
  let searchableNodes = nodes.filter(n => 
    n.type !== "waypoint" && !n.rooms.includes("waypoint")
  )

  if (categoryFilter && categoryFilter.length > 0) {
    searchableNodes = searchableNodes.filter(n => {
      const category = inferCategory(n)
      return categoryFilter.includes(category)
    })
  }

  // Get cached index (much faster than recreating)
  // Note: If category filter is used, we still need a new index for filtered nodes
  const fuse = categoryFilter && categoryFilter.length > 0
    ? createSearchIndex(searchableNodes)
    : getCachedSearchIndex(nodes)
  
  const results = fuse.search(query.trim(), { limit })

  // Transform to SearchResult
  return results.map(result => ({
    node: result.item,
    score: result.score ?? 1,
    matches: result.matches?.map(m => String(m.value)) ?? []
  }))
}

/**
 * Find exact match for a room (backwards compatibility)
 */
export function findExactMatch(query: string, nodes: Node[]): Node | undefined {
  const normalized = query.toLowerCase().trim()
  
  return nodes.find(node =>
    node.rooms.some(room => 
      room.toLowerCase() === normalized
    )
  )
}

/**
 * Get popular/featured destinations
 * Used for empty search suggestions
 */
export function getFeaturedRooms(nodes: Node[], featuredNames: string[]): Node[] {
  const featured: Node[] = []

  for (const name of featuredNames) {
    const node = nodes.find(n => 
      n.rooms.some(r => 
        r.toLowerCase().includes(name.toLowerCase())
      )
    )
    if (node) {
      featured.push(node)
    }
  }

  return featured
}

/**
 * Search by category/room type
 * Natural language queries like "computer lab" or "office"
 */
export function searchByCategory(query: string, nodes: Node[]): Node[] {
  const normalized = query.toLowerCase().trim()

  // Map natural language to categories
  const categoryMappings: Record<string, RoomCategory[]> = {
    'classroom': ['classroom'],
    'class': ['classroom'],
    'office': ['office'],
    'lab': ['lab'],
    'computer': ['lab'],
    'science': ['lab'],
    'bathroom': ['bathroom'],
    'restroom': ['bathroom'],
    'cafeteria': ['cafeteria'],
    'cafe': ['cafeteria'],
    'lunch': ['cafeteria'],
    'gym': ['gymnasium'],
    'gymnasium': ['gymnasium'],
    'library': ['library'],
    'auditorium': ['auditorium'],
    'theater': ['auditorium'],
    'stairs': ['stairway'],
    'stairway': ['stairway'],
    'entrance': ['entrance'],
    'exit': ['entrance'],
    'door': ['entrance']
  }

  // Find matching categories
  let matchedCategories: RoomCategory[] = []
  
  for (const [keyword, categories] of Object.entries(categoryMappings)) {
    if (normalized.includes(keyword)) {
      matchedCategories = [...matchedCategories, ...categories]
    }
  }

  if (matchedCategories.length === 0) {
    return []
  }

  // Filter nodes by matched categories
  return nodes.filter(n => {
    const category = inferCategory(n)
    return matchedCategories.includes(category)
  })
}

/**
 * Rank search results with recency boost
 * More recently searched items rank higher
 */
export function rankWithRecency(
  results: SearchResult[],
  recentSearches: { room: string, timestamp: number }[]
): SearchResult[] {
  return results.map(result => {
    // Check if this room was searched recently
    const roomNames = result.node.rooms
    const recentEntry = recentSearches.find(r => 
      roomNames.some(name => name.toLowerCase() === r.room.toLowerCase())
    )

    if (recentEntry) {
      // Boost recent searches (reduce score = higher relevance)
      const recencyBoost = 0.2  // 20% boost
      const timeSinceSearch = Date.now() - recentEntry.timestamp
      const daysSince = timeSinceSearch / (1000 * 60 * 60 * 24)
      
      // Exponential decay: recent searches get bigger boost
      const boost = recencyBoost * Math.exp(-daysSince / 7)  // 7-day half-life
      
      return {
        ...result,
        score: Math.max(0, result.score - boost)
      }
    }

    return result
  }).sort((a, b) => a.score - b.score)  // Lower score = better match
}
