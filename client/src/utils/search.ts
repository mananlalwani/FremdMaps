/**
 * Search utilities for room/node lookup.
 *
 * Provides fuzzy full-text search (via Fuse.js), exact matching, category-based
 * filtering, and a recency-boost ranking pass.  A module-level Fuse.js index
 * cache avoids rebuilding the index on every keystroke.
 *
 * NOTE: When a `categoryFilter` is passed to `searchNodes`, the cache is
 * bypassed and a fresh index is built for the filtered node subset — category-
 * filtered searches are therefore slightly slower than unfiltered ones.
 */

import Fuse from 'fuse.js'
import type { Node, SearchResult, RoomCategory } from './types'

/**
 * Infer a `RoomCategory` for a node from its explicit `category` field, its
 * `type`, or keyword patterns in its room names.  Returns `'other'` when no
 * pattern matches.
 *
 * @param node Node to categorise.
 * @returns The most specific matching category.
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
 * Return the human-readable display label for a `RoomCategory`.
 *
 * @param category Category to look up.
 * @returns Capitalised label string, e.g. `'Classroom'`, `'Gymnasium'`.
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
 * Return a single-character symbol for a `RoomCategory` suitable for use as a
 * compact inline icon.
 *
 * @param category Category to look up.
 * @returns A Unicode symbol character, e.g. `'▪'` for classroom.
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
 * Module-level Fuse.js index cache.
 *
 * Stores the nodes array reference alongside the index so the cache can be
 * invalidated cheaply with a reference-equality check (`nodes === cache.nodes`).
 * Call `invalidateSearchCache()` after any admin-mode edit that modifies nodes.
 *
 * IMPORTANT: This cache is skipped entirely when `searchNodes` is called with a
 * `categoryFilter` — filtered searches always build a fresh index for the
 * filtered subset.
 */
let searchIndexCache: {
  nodes: Node[]
  fuse: Fuse<Node>
} | null = null

/**
 * Build a Fuse.js search index for the given nodes.
 *
 * Fuse.js configuration rationale:
 * - `threshold: 0.2` — tighter than the Fuse default (0.6); requires a closer
 *   match before a result is included, reducing noisy suggestions.
 * - `distance: 50` — only considers the first 50 characters of each field,
 *   which is sufficient for room numbers/names.
 * - `weight: 0.9 / 0.1` — `rooms` is the primary search field; `type` is a
 *   weak secondary signal (e.g. typing "bathroom" still finds bathroom nodes).
 * - `ignoreLocation: true` — matches anywhere in the string, not just near the
 *   start (important for multi-word names like "Main Office").
 *
 * Waypoint nodes are excluded — they are invisible to users and not searchable.
 *
 * @param nodes Full node array to index.
 * @returns Configured `Fuse` instance ready for `.search()` calls.
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
    threshold: 0.2,  // Tighter: requires a closer match before showing a result
    distance: 50,    // Characters from the start of the field to search within
    minMatchCharLength: 2,  // Require at least 2 characters to avoid noise
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,  // Search anywhere in string
    useExtendedSearch: false
  })
}

/**
 * Return the cached Fuse index, or build and cache a new one if `nodes` has
 * changed (detected by reference equality).
 *
 * @param nodes Node array — must be the same reference across calls to reuse
 *   the cache.
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
 * Perform a fuzzy search over `nodes` for the given `query`.
 *
 * Results are sorted by Fuse.js relevance score (lower = better match).
 * Waypoints are always excluded from results regardless of `categoryFilter`.
 *
 * When `categoryFilter` is provided a fresh Fuse index is built for the
 * filtered subset — the module-level cache is not used in this path.
 *
 * @param query      Search string; returns `[]` for empty/whitespace input.
 * @param nodes      Candidate node pool.
 * @param options.limit          Max results to return (default 10).
 * @param options.categoryFilter Restrict results to these categories.
 * @returns Sorted `SearchResult[]`, best match first.
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
    matches: result.matches?.flatMap(m => m.value !== undefined ? [m.value] : []) ?? []
  }))
}

/**
 * Find the first node whose `rooms` array contains an exact case-insensitive
 * match for `query`.
 *
 * Used for deterministic lookup by known room name (e.g. resolving a saved
 * schedule entry or a direct URL parameter).  Distinct from `searchNodes` which
 * performs fuzzy matching; prefer this function when an exact name is known.
 *
 * @param query  Room name to match (case-insensitive).
 * @param nodes  Node pool to search.
 * @returns The first matching node, or `undefined` if none.
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
 * Return nodes whose room names contain any of the `featuredNames` strings
 * (case-insensitive substring match).
 *
 * Used to populate the empty-state suggestions panel when the search box is
 * blank.  The order follows `featuredNames`, not the node array order.
 *
 * @param nodes         Node pool.
 * @param featuredNames Ordered list of room name substrings to look for.
 * @returns Array of matched nodes (at most one per featured name).
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
 * Return all nodes whose inferred category matches the category keywords in
 * `query` (e.g. `'computer lab'` → category `'lab'`, `'bathroom'` →
 * category `'bathroom'`).
 *
 * Returns an empty array when no keyword maps to a category; the caller
 * (`Map.astro`) falls through to the Fuse fuzzy search in that case.
 *
 * @param query  Natural-language query string.
 * @param nodes  Node pool.
 * @returns All matching nodes (unranked, unfiltered by waypoint status).
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
 * Re-rank search results by boosting nodes that appear in recent search history.
 *
 * The boost formula applies an exponential decay so very recent searches get
 * a larger score reduction (lower score = higher rank in Fuse results):
 *
 * ```
 * boost = 0.2 × exp(−daysSince / 7)
 * ```
 *
 * - Max boost: `0.2` (capped at 20% score reduction for a search from right now).
 * - Half-life: 7 days — a search from a week ago provides half the max boost.
 *
 * @param results       Fuse.js search results to re-rank.
 * @param recentSearches  Flat list of `{ room, timestamp }` from `getFrequentRooms()`.
 * @returns Re-ranked copy of `results`, sorted ascending by adjusted score.
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
