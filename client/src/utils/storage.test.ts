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
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    get length() {
      return Object.keys(store).length
    },
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
  trackSearch,
  getFrequentRooms,
  getSchedule,
  saveSchedule,
  updateSchedulePeriod,
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

// ---------------------------------------------------------------------------
// Search Analytics
// ---------------------------------------------------------------------------

describe('trackSearch', () => {
  it('stores a search analytics entry in localStorage', () => {
    trackSearch('library', 3)
    trackSearch('room 201', 5)
    const raw = localStorageMock.getItem('nav_search_analytics')
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw) as Array<{ query: string; resultCount: number }>
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ query: 'library', resultCount: 3 })
    expect(data[1]).toMatchObject({ query: 'room 201', resultCount: 5 })
  })

  it('does not interfere with other storage keys', () => {
    trackSearch('test', 1)
    addRecentSearch('A', 'B')
    expect(getRecentSearches()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Frequent Rooms (recency list)
// ---------------------------------------------------------------------------

describe('getFrequentRooms', () => {
  it('returns empty array when no searches exist', () => {
    expect(getFrequentRooms()).toEqual([])
  })

  it('flattens from and to into a flat list', () => {
    addRecentSearch('Lobby', 'Library')
    addRecentSearch('Room 101', 'Cafeteria')
    const rooms = getFrequentRooms()
    // 2 searches × 2 rooms each = 4 entries
    expect(rooms).toHaveLength(4)
    const names = rooms.map((r) => r.room)
    expect(names).toContain('Lobby')
    expect(names).toContain('Library')
    expect(names).toContain('Room 101')
    expect(names).toContain('Cafeteria')
  })

  it('sorts by most recent first', () => {
    addRecentSearch('Old', 'Room')
    const before = Date.now()
    addRecentSearch('New', 'Place')
    const rooms = getFrequentRooms()
    // The newest entry should be first
    expect(rooms[0].timestamp).toBeGreaterThanOrEqual(before)
  })

  it('each entry has a timestamp', () => {
    addRecentSearch('X', 'Y')
    const rooms = getFrequentRooms()
    rooms.forEach((r) => {
      expect(r.timestamp).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

describe('getSchedule', () => {
  it('returns default 8 empty periods when nothing is stored', () => {
    const schedule = getSchedule()
    expect(schedule).toHaveLength(8)
    expect(schedule[0]).toEqual({ period: '1', room: '' })
    expect(schedule[7]).toEqual({ period: '8', room: '' })
  })
})

describe('saveSchedule', () => {
  it('persists a schedule', () => {
    const entries = [
      { period: '1', room: '201' },
      { period: '2', room: '105' },
    ]
    saveSchedule(entries)
    const loaded = getSchedule()
    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toEqual({ period: '1', room: '201' })
  })

  it('replaces any existing schedule', () => {
    saveSchedule([{ period: '1', room: '101' }])
    saveSchedule([{ period: '2', room: '202' }])
    const loaded = getSchedule()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].period).toBe('2')
  })
})

describe('updateSchedulePeriod', () => {
  it('updates an existing period', () => {
    updateSchedulePeriod('1', '301')
    const schedule = getSchedule()
    const p1 = schedule.find((e) => e.period === '1')
    expect(p1?.room).toBe('301')
  })

  it('appends a new period that does not exist yet', () => {
    updateSchedulePeriod('Lunch', 'Cafeteria')
    const schedule = getSchedule()
    const lunch = schedule.find((e) => e.period === 'Lunch')
    expect(lunch?.room).toBe('Cafeteria')
    // Default 8 periods should still be there
    expect(schedule.find((e) => e.period === '1')).toBeDefined()
  })

  it('persists across calls', () => {
    updateSchedulePeriod('1', '101')
    updateSchedulePeriod('2', '102')
    const schedule = getSchedule()
    expect(schedule.find((e) => e.period === '1')?.room).toBe('101')
    expect(schedule.find((e) => e.period === '2')?.room).toBe('102')
  })
})
