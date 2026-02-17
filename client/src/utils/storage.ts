/**
 * localStorage wrapper for search history and favorites
 * Handles serialization, quota management, and error handling
 */

import type { SearchHistoryEntry } from './types'

const STORAGE_KEYS = {
  RECENT_SEARCHES: 'nav_recent_searches',
  FAVORITES: 'nav_favorites',
  SEARCH_ANALYTICS: 'nav_search_analytics'
} as const

const MAX_RECENT_SEARCHES = 10
const MAX_ANALYTICS_ENTRIES = 100

/**
 * Check if localStorage is available
 * May be blocked in private browsing mode
 */
function isStorageAvailable(): boolean {
  try {
    const test = '__storage_test__'
    localStorage.setItem(test, test)
    localStorage.removeItem(test)
    return true
  } catch (e) {
    return false
  }
}

/**
 * Safely get item from localStorage
 */
function getItem<T>(key: string, defaultValue: T): T {
  if (!isStorageAvailable()) return defaultValue

  try {
    const item = localStorage.getItem(key)
    if (!item) return defaultValue
    return JSON.parse(item) as T
  } catch (e) {
    console.warn(`Failed to read from localStorage: ${key}`, e)
    return defaultValue
  }
}

/**
 * Safely set item in localStorage
 */
function setItem(key: string, value: any): boolean {
  if (!isStorageAvailable()) return false

  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    // Handle quota exceeded error
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded')
      // Try to free space by clearing analytics
      localStorage.removeItem(STORAGE_KEYS.SEARCH_ANALYTICS)
      
      // Retry once
      try {
        localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (retryError) {
        console.error('Failed to save after clearing analytics', retryError)
      }
    } else {
      console.warn(`Failed to write to localStorage: ${key}`, e)
    }
    return false
  }
}

// ========== Recent Searches ==========

/**
 * Get recent searches
 * Returns up to MAX_RECENT_SEARCHES entries, newest first
 */
export function getRecentSearches(): SearchHistoryEntry[] {
  return getItem<SearchHistoryEntry[]>(STORAGE_KEYS.RECENT_SEARCHES, [])
}

/**
 * Add a search to history
 * Deduplicates and maintains max limit
 */
export function addRecentSearch(from: string, to: string): void {
  const entry: SearchHistoryEntry = {
    from,
    to,
    timestamp: Date.now()
  }

  let recent = getRecentSearches()

  // Remove duplicate (same from/to combination)
  recent = recent.filter(r => 
    !(r.from.toLowerCase() === from.toLowerCase() && 
      r.to.toLowerCase() === to.toLowerCase())
  )

  // Add to front
  recent.unshift(entry)

  // Limit size
  if (recent.length > MAX_RECENT_SEARCHES) {
    recent = recent.slice(0, MAX_RECENT_SEARCHES)
  }

  setItem(STORAGE_KEYS.RECENT_SEARCHES, recent)
}

/**
 * Clear all recent searches
 */
export function clearRecentSearches(): void {
  setItem(STORAGE_KEYS.RECENT_SEARCHES, [])
}

/**
 * Remove a specific recent search
 */
export function removeRecentSearch(from: string, to: string): void {
  const recent = getRecentSearches().filter(r =>
    !(r.from.toLowerCase() === from.toLowerCase() && 
      r.to.toLowerCase() === to.toLowerCase())
  )
  setItem(STORAGE_KEYS.RECENT_SEARCHES, recent)
}

// ========== Favorites ==========

/**
 * Get favorite room UIDs
 */
export function getFavorites(): string[] {
  return getItem<string[]>(STORAGE_KEYS.FAVORITES, [])
}

/**
 * Add a room to favorites
 */
export function addFavorite(uid: string): void {
  const favorites = getFavorites()
  
  if (!favorites.includes(uid)) {
    favorites.push(uid)
    setItem(STORAGE_KEYS.FAVORITES, favorites)
  }
}

/**
 * Remove a room from favorites
 */
export function removeFavorite(uid: string): void {
  const favorites = getFavorites().filter(id => id !== uid)
  setItem(STORAGE_KEYS.FAVORITES, favorites)
}

/**
 * Check if a room is favorited
 */
export function isFavorite(uid: string): boolean {
  return getFavorites().includes(uid)
}

/**
 * Toggle favorite status
 */
export function toggleFavorite(uid: string): boolean {
  const isCurrentlyFavorite = isFavorite(uid)
  
  if (isCurrentlyFavorite) {
    removeFavorite(uid)
  } else {
    addFavorite(uid)
  }
  
  return !isCurrentlyFavorite  // Return new state
}

/**
 * Clear all favorites
 */
export function clearFavorites(): void {
  setItem(STORAGE_KEYS.FAVORITES, [])
}

// ========== Search Analytics (Optional) ==========

interface SearchAnalyticsEntry {
  query: string
  timestamp: number
  resultCount: number
}

/**
 * Track a search query for analytics
 * Used to improve search ranking
 */
export function trackSearch(query: string, resultCount: number): void {
  const analytics = getItem<SearchAnalyticsEntry[]>(STORAGE_KEYS.SEARCH_ANALYTICS, [])
  
  analytics.push({
    query: query.toLowerCase().trim(),
    timestamp: Date.now(),
    resultCount
  })

  // Limit size
  if (analytics.length > MAX_ANALYTICS_ENTRIES) {
    analytics.splice(0, analytics.length - MAX_ANALYTICS_ENTRIES)
  }

  setItem(STORAGE_KEYS.SEARCH_ANALYTICS, analytics)
}

/**
 * Get popular search queries
 * Returns queries sorted by frequency
 */
export function getPopularSearches(limit: number = 5): string[] {
  const analytics = getItem<SearchAnalyticsEntry[]>(STORAGE_KEYS.SEARCH_ANALYTICS, [])
  
  // Count frequency
  const frequency = new Map<string, number>()
  
  for (const entry of analytics) {
    const count = frequency.get(entry.query) ?? 0
    frequency.set(entry.query, count + 1)
  }

  // Sort by frequency and return top queries
  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])  // Descending by count
    .slice(0, limit)
    .map(([query]) => query)
}

/**
 * Get frequently accessed rooms (for recency boost)
 */
export function getFrequentRooms(): { room: string, timestamp: number }[] {
  const recent = getRecentSearches()
  
  // Flatten to all rooms (from and to)
  const allRooms: { room: string, timestamp: number }[] = []
  
  for (const entry of recent) {
    allRooms.push({ room: entry.from, timestamp: entry.timestamp })
    allRooms.push({ room: entry.to, timestamp: entry.timestamp })
  }

  // Sort by most recent
  return allRooms.sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Clear all storage (for debugging/reset)
 */
export function clearAllStorage(): void {
  clearRecentSearches()
  clearFavorites()
  setItem(STORAGE_KEYS.SEARCH_ANALYTICS, [])
  console.log('All navigation storage cleared')
}

/**
 * Export storage data (for debugging)
 */
export function exportStorageData(): string {
  return JSON.stringify({
    recentSearches: getRecentSearches(),
    favorites: getFavorites(),
    analytics: getItem(STORAGE_KEYS.SEARCH_ANALYTICS, [])
  }, null, 2)
}
