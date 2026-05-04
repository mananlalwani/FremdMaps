/**
 * localStorage wrapper for search history, favorites, analytics, and schedule.
 *
 * All public functions degrade gracefully when localStorage is unavailable
 * (e.g. private browsing mode) — reads return default values, writes silently
 * no-op.
 *
 * Storage key namespacing:
 * - `RECENT_SEARCHES` — ordered ring buffer of route searches; read by
 *   `getFrequentRooms` → `rankWithRecency` to boost recently-visited rooms.
 * - `FAVORITES`       — flat array of favorited node UIDs.
 * - `SEARCH_ANALYTICS` — write-only telemetry (query + result count); not
 *   surfaced in the UI but useful for future ranking improvements.  Cleared
 *   automatically when a `QuotaExceededError` occurs.
 * - `SCHEDULE`        — user's class schedule (period → room assignments).
 */

import type { SearchHistoryEntry, ScheduleEntry } from './types'
import { logger } from './logger'

const STORAGE_KEYS = {
  RECENT_SEARCHES: 'nav_recent_searches',
  FAVORITES: 'nav_favorites',
  SEARCH_ANALYTICS: 'nav_search_analytics',
  SCHEDULE: 'nav_schedule'
} as const

/**
 * Maximum number of recent route searches to retain.
 * 10 covers a full school day of navigation without excessive localStorage use.
 */
const MAX_RECENT_SEARCHES = 10

/**
 * Maximum number of analytics entries to retain.
 * 100 entries is sufficient for trend analysis while keeping the payload small.
 * When the limit is reached, the oldest entries are trimmed (FIFO).
 */
const MAX_ANALYTICS_ENTRIES = 100

/**
 * Cached localStorage availability check — tested once at module load time.
 * May be blocked in private browsing mode.
 */
const _storageAvailable: boolean = (() => {
  try {
    localStorage.setItem('__t', '1')
    localStorage.removeItem('__t')
    return true
  } catch {
    return false
  }
})()

function isStorageAvailable(): boolean {
  return _storageAvailable
}

/**
 * Safely deserialise a value from localStorage.
 *
 * Returns `defaultValue` when storage is unavailable, the key is missing, or
 * JSON parsing fails (logging a warning in the latter case).
 *
 * @param key          localStorage key to read.
 * @param defaultValue Fallback returned on any failure or missing key.
 * @returns The parsed value, or `defaultValue`.
 */
function getItem<T>(key: string, defaultValue: T): T {
  if (!isStorageAvailable()) return defaultValue

  try {
    const item = localStorage.getItem(key)
    if (!item) return defaultValue
    return JSON.parse(item) as T
  } catch (e) {
    logger.warn(`Failed to read from localStorage: ${key}`, e)
    return defaultValue
  }
}

/**
 * Safely serialise and write a value to localStorage.
 *
 * On `QuotaExceededError`, automatically clears the analytics key to free
 * space and retries once.  Returns `false` when storage is unavailable or
 * every write attempt fails.
 *
 * @param key   localStorage key to write.
 * @param value Value to serialise as JSON.
 * @returns `true` on success, `false` on failure.
 */
function setItem(key: string, value: unknown): boolean {
  if (!isStorageAvailable()) return false

  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    // Handle quota exceeded error
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      logger.error('localStorage quota exceeded')
      // Try to free space by clearing analytics
      localStorage.removeItem(STORAGE_KEYS.SEARCH_ANALYTICS)
      
      // Retry once
      try {
        localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (retryError) {
        logger.error('Failed to save after clearing analytics', retryError)
      }
    } else {
      logger.warn(`Failed to write to localStorage: ${key}`, e)
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
 * Flatten recent search history into a per-room recency list.
 *
 * Each `SearchHistoryEntry` contributes two entries (one for `from`, one for
 * `to`) so that any room that appeared in a recent route gets a recency boost
 * when it is used by `rankWithRecency` in `search.ts`.
 *
 * @returns Flat list of `{ room, timestamp }` objects, sorted newest-first.
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

// ========== Schedule ==========

/**
 * Hardcoded default period labels used when no schedule has been saved yet.
 * Eight periods covers the most common US high-school block-schedule formats.
 */
const DEFAULT_PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8']

/**
 * Get the full class schedule (ordered list of period->room entries)
 */
export function getSchedule(): ScheduleEntry[] {
  const stored = getItem<ScheduleEntry[]>(STORAGE_KEYS.SCHEDULE, [])
  if (stored.length > 0) return stored
  // Return default empty periods on first use
  return DEFAULT_PERIODS.map(p => ({ period: p, room: '' }))
}

/**
 * Save the full schedule, replacing any existing entries
 */
export function saveSchedule(entries: ScheduleEntry[]): void {
  setItem(STORAGE_KEYS.SCHEDULE, entries)
}

/**
 * Update a single period's room assignment
 */
export function updateSchedulePeriod(period: string, room: string): void {
  const schedule = getSchedule()
  const idx = schedule.findIndex(e => e.period === period)
  if (idx !== -1) {
    schedule[idx].room = room
  } else {
    schedule.push({ period, room })
  }
  setItem(STORAGE_KEYS.SCHEDULE, schedule)
}

/**
 * Clear all room assignments (keep period slots, reset rooms to empty)
 */
export function clearSchedule(): void {
  const schedule = getSchedule().map(e => ({ ...e, room: '' }))
  setItem(STORAGE_KEYS.SCHEDULE, schedule)
}
