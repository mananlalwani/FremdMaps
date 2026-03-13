/**
 * Tests for localStorage storage utilities
 *
 * Uses vi.stubGlobal to provide a real in-memory localStorage mock before
 * importing storage.ts, because storage.ts caches localStorage availability
 * at module load time (IIFE), and Node 25's built-in localStorage stub does
 * not support the full Storage API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory localStorage mock
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  }
}

// Stub the global localStorage BEFORE importing storage.ts so that the
// module-level _storageAvailable IIFE sees a functional implementation.
const localStorageMock = createLocalStorageMock()
vi.stubGlobal('localStorage', localStorageMock)

// Dynamic import after the global is stubbed
const {
  getRecentSearches,
  addRecentSearch,
  clearRecentSearches,
  removeRecentSearch,
  getFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  toggleFavorite,
  clearFavorites,
} = await import('./storage')

// ---------------------------------------------------------------------------
// Reset storage before each test for isolation
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear()
})

// ---------------------------------------------------------------------------
// Recent Searches
// ---------------------------------------------------------------------------

describe('getRecentSearches', () => {
  it('returns empty array when nothing is stored', () => {
    expect(getRecentSearches()).toEqual([])
  })
})

describe('addRecentSearch', () => {
  it('stores a search entry', () => {
    addRecentSearch('Lobby', 'Library')
    const recent = getRecentSearches()
    expect(recent).toHaveLength(1)
    expect(recent[0].from).toBe('Lobby')
    expect(recent[0].to).toBe('Library')
  })

  it('places newest entry at the front', () => {
    addRecentSearch('A', 'B')
    addRecentSearch('C', 'D')
    const recent = getRecentSearches()
    expect(recent[0].from).toBe('C')
    expect(recent[1].from).toBe('A')
  })

  it('deduplicates identical from/to pairs (case-insensitive)', () => {
    addRecentSearch('A', 'B')
    addRecentSearch('a', 'b') // same, different case
    expect(getRecentSearches()).toHaveLength(1)
  })

  it('moves a duplicate to the front when re-added', () => {
    addRecentSearch('A', 'B')
    addRecentSearch('C', 'D')
    addRecentSearch('A', 'B') // re-add first entry
    const recent = getRecentSearches()
    expect(recent[0].from).toBe('A')
    expect(recent).toHaveLength(2) // still 2, not 3
  })

  it('does not exceed MAX_RECENT_SEARCHES (10)', () => {
    for (let i = 0; i < 15; i++) {
      addRecentSearch(`From${i}`, `To${i}`)
    }
    expect(getRecentSearches().length).toBeLessThanOrEqual(10)
  })

  it('stores a timestamp', () => {
    const before = Date.now()
    addRecentSearch('X', 'Y')
    const after = Date.now()
    const ts = getRecentSearches()[0].timestamp
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
})

describe('clearRecentSearches', () => {
  it('removes all stored recent searches', () => {
    addRecentSearch('A', 'B')
    addRecentSearch('C', 'D')
    clearRecentSearches()
    expect(getRecentSearches()).toHaveLength(0)
  })
})

describe('removeRecentSearch', () => {
  it('removes only the matching entry', () => {
    addRecentSearch('A', 'B')
    addRecentSearch('C', 'D')
    removeRecentSearch('A', 'B')
    const recent = getRecentSearches()
    expect(recent).toHaveLength(1)
    expect(recent[0].from).toBe('C')
  })

  it('is a no-op when the entry does not exist', () => {
    addRecentSearch('A', 'B')
    removeRecentSearch('X', 'Y')
    expect(getRecentSearches()).toHaveLength(1)
  })

  it('is case-insensitive', () => {
    addRecentSearch('A', 'B')
    removeRecentSearch('a', 'b')
    expect(getRecentSearches()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

describe('getFavorites', () => {
  it('returns empty array when nothing is stored', () => {
    expect(getFavorites()).toEqual([])
  })
})

describe('addFavorite', () => {
  it('adds a UID to favorites', () => {
    addFavorite('uid-1')
    expect(getFavorites()).toContain('uid-1')
  })

  it('does not add duplicate UIDs', () => {
    addFavorite('uid-1')
    addFavorite('uid-1')
    expect(getFavorites()).toHaveLength(1)
  })
})

describe('removeFavorite', () => {
  it('removes a UID from favorites', () => {
    addFavorite('uid-1')
    addFavorite('uid-2')
    removeFavorite('uid-1')
    expect(getFavorites()).not.toContain('uid-1')
    expect(getFavorites()).toContain('uid-2')
  })

  it('is a no-op when UID is not in favorites', () => {
    addFavorite('uid-1')
    removeFavorite('uid-99')
    expect(getFavorites()).toHaveLength(1)
  })
})

describe('isFavorite', () => {
  it('returns true when UID is a favorite', () => {
    addFavorite('uid-1')
    expect(isFavorite('uid-1')).toBe(true)
  })

  it('returns false when UID is not a favorite', () => {
    expect(isFavorite('uid-missing')).toBe(false)
  })
})

describe('toggleFavorite', () => {
  it('adds a UID and returns true when not yet a favorite', () => {
    const result = toggleFavorite('uid-1')
    expect(result).toBe(true)
    expect(isFavorite('uid-1')).toBe(true)
  })

  it('removes a UID and returns false when already a favorite', () => {
    addFavorite('uid-1')
    const result = toggleFavorite('uid-1')
    expect(result).toBe(false)
    expect(isFavorite('uid-1')).toBe(false)
  })
})

describe('clearFavorites', () => {
  it('removes all favorites', () => {
    addFavorite('uid-1')
    addFavorite('uid-2')
    clearFavorites()
    expect(getFavorites()).toHaveLength(0)
  })
})
