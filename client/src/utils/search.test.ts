/**
 * Tests for search utilities
 * Covers category inference, fuzzy search, recency ranking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  inferCategory,
  searchNodes,
  rankWithRecency,
  invalidateSearchCache,
  findExactMatch,
  getCategoryLabel,
  getCategoryIcon,
  createSearchIndex,
  getFeaturedRooms,
} from './search'
import type { Node, SearchResult } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(uid: string, rooms: string[], opts: Partial<Node> = {}): Node {
  return { uid, lat: 0, lng: 0, rooms, type: 'room', ...opts }
}

// ---------------------------------------------------------------------------
// inferCategory
// ---------------------------------------------------------------------------

describe('inferCategory', () => {
  it('returns the explicitly set category when present', () => {
    const n = makeNode('1', ['101'], { category: 'library' })
    expect(inferCategory(n)).toBe('library')
  })

  it('infers "bathroom" from node type', () => {
    const n = makeNode('1', ['restroom'], { type: 'bathroom' })
    expect(inferCategory(n)).toBe('bathroom')
  })

  it('infers "stairway" from node type', () => {
    const n = makeNode('1', ['Stair A'], { type: 'stairway' })
    expect(inferCategory(n)).toBe('stairway')
  })

  it('infers "other" from waypoint type', () => {
    const n = makeNode('1', ['waypoint'], { type: 'waypoint' })
    expect(inferCategory(n)).toBe('other')
  })

  it('infers "cafeteria" from room name keyword', () => {
    expect(inferCategory(makeNode('1', ['Main Cafeteria']))).toBe('cafeteria')
    expect(inferCategory(makeNode('2', ['cafe corner']))).toBe('cafeteria')
  })

  it('infers "gymnasium" from room name keyword', () => {
    expect(inferCategory(makeNode('1', ['Main Gym']))).toBe('gymnasium')
    expect(inferCategory(makeNode('2', ['Gymnasium']))).toBe('gymnasium')
  })

  it('infers "library" from room name keyword', () => {
    expect(inferCategory(makeNode('1', ['School Library']))).toBe('library')
  })

  it('infers "lab" from room name keyword', () => {
    expect(inferCategory(makeNode('1', ['Computer Lab']))).toBe('lab')
    expect(inferCategory(makeNode('2', ['Science Room']))).toBe('lab')
  })

  it('infers "office" from room name keyword', () => {
    expect(inferCategory(makeNode('1', ['Main Office']))).toBe('office')
  })

  it('infers "entrance" from room name keyword', () => {
    expect(inferCategory(makeNode('1', ['Main Entrance']))).toBe('entrance')
    expect(inferCategory(makeNode('2', ['Lobby']))).toBe('entrance')
  })

  it('infers "classroom" when room name is a pure number', () => {
    expect(inferCategory(makeNode('1', ['201']))).toBe('classroom')
  })

  it('returns "other" when no keyword matches', () => {
    expect(inferCategory(makeNode('1', ['Unknown Space']))).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// searchNodes
// ---------------------------------------------------------------------------

describe('searchNodes', () => {
  beforeEach(() => {
    invalidateSearchCache()
  })

  const nodes: Node[] = [
    makeNode('1', ['Room 101']),
    makeNode('2', ['Room 102']),
    makeNode('3', ['Library']),
    makeNode('4', ['Main Office']),
    makeNode('wp', ['waypoint'], { type: 'waypoint' }),
  ]

  it('returns empty array for empty query', () => {
    expect(searchNodes('', nodes)).toHaveLength(0)
    expect(searchNodes('   ', nodes)).toHaveLength(0)
  })

  it('excludes waypoint nodes from results', () => {
    const results = searchNodes('waypoint', nodes)
    expect(results.every((r) => r.node.uid !== 'wp')).toBe(true)
  })

  it('finds a node by exact room name', () => {
    const results = searchNodes('Library', nodes)
    expect(results.some((r) => r.node.uid === '3')).toBe(true)
  })

  it('finds nodes with fuzzy / partial match', () => {
    const results = searchNodes('Room', nodes)
    const uids = results.map((r) => r.node.uid)
    expect(uids).toContain('1')
    expect(uids).toContain('2')
  })

  it('offers single-digit room numbers, with an exact room first', () => {
    const numericRooms = [
      makeNode('101', ['101']),
      makeNode('one', ['1']),
      makeNode('201', ['201']),
    ]

    const results = searchNodes('1', numericRooms)

    expect(results.map((result) => result.node.uid)).toEqual(['one', '101'])
  })

  it('respects the limit option', () => {
    const results = searchNodes('Room', nodes, { limit: 1 })
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('applies a category filter', () => {
    const results = searchNodes('Room', nodes, { categoryFilter: ['classroom'] })
    // All results should be classrooms (pure numeric rooms → classroom)
    results.forEach((r) => {
      const cat = r.node.rooms.some((room) => /^\d+$/.test(room)) ? 'classroom' : 'other'
      expect(cat).toBe('classroom')
    })
  })
})

// ---------------------------------------------------------------------------
// findExactMatch
// ---------------------------------------------------------------------------

describe('findExactMatch', () => {
  const nodes: Node[] = [makeNode('1', ['Main Office', 'Room 100']), makeNode('2', ['Library'])]

  it('finds by exact case-insensitive match', () => {
    expect(findExactMatch('library', nodes)?.uid).toBe('2')
    expect(findExactMatch('LIBRARY', nodes)?.uid).toBe('2')
  })

  it('matches against any alias in the rooms array', () => {
    expect(findExactMatch('Room 100', nodes)?.uid).toBe('1')
  })

  it('returns undefined when no exact match exists', () => {
    expect(findExactMatch('Gymnasium', nodes)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// rankWithRecency
// ---------------------------------------------------------------------------

describe('rankWithRecency', () => {
  const now = Date.now()

  function makeResult(uid: string, rooms: string[], score: number): SearchResult {
    return {
      node: makeNode(uid, rooms),
      score,
      matches: [],
    }
  }

  it('returns results sorted by score (lower is better)', () => {
    const results = [makeResult('a', ['Room A'], 0.8), makeResult('b', ['Room B'], 0.2)]
    const ranked = rankWithRecency(results, [])
    expect(ranked[0].node.uid).toBe('b')
  })

  it('boosts recently searched rooms (reduces their score)', () => {
    // Room A has score 0.5; Room B has score 0.4 — without boost, B wins.
    // With recency boost of 0.2 applied to A: A becomes 0.3 < 0.4 → A wins.
    const results = [makeResult('a', ['Room A'], 0.5), makeResult('b', ['Room B'], 0.4)]
    // Room A was searched very recently (boost = 0.2 * exp(0) = 0.2)
    const recent = [{ room: 'Room A', timestamp: now }]
    const ranked = rankWithRecency(results, recent)
    // After boost, Room A's score (0.3) should be below Room B's score (0.4) → ranked first
    expect(ranked[0].node.uid).toBe('a')
  })

  it('does not modify scores when recentSearches is empty', () => {
    const results = [makeResult('a', ['Room A'], 0.4), makeResult('b', ['Room B'], 0.2)]
    const ranked = rankWithRecency(results, [])
    expect(ranked[0].score).toBeCloseTo(0.2)
    expect(ranked[1].score).toBeCloseTo(0.4)
  })

  it('score does not go below 0 due to recency boost', () => {
    const results = [makeResult('a', ['Room A'], 0.05)]
    const recent = [{ room: 'Room A', timestamp: now }]
    const ranked = rankWithRecency(results, recent)
    expect(ranked[0].score).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// getCategoryLabel
// ---------------------------------------------------------------------------

describe('getCategoryLabel', () => {
  it('returns "Classroom" for classroom category', () => {
    expect(getCategoryLabel('classroom')).toBe('Classroom')
  })

  it('returns "Office" for office category', () => {
    expect(getCategoryLabel('office')).toBe('Office')
  })

  it('returns "Lab" for lab category', () => {
    expect(getCategoryLabel('lab')).toBe('Lab')
  })

  it('returns "Bathroom" for bathroom category', () => {
    expect(getCategoryLabel('bathroom')).toBe('Bathroom')
  })

  it('returns "Cafeteria" for cafeteria category', () => {
    expect(getCategoryLabel('cafeteria')).toBe('Cafeteria')
  })

  it('returns "Gymnasium" for gymnasium category', () => {
    expect(getCategoryLabel('gymnasium')).toBe('Gymnasium')
  })

  it('returns "Library" for library category', () => {
    expect(getCategoryLabel('library')).toBe('Library')
  })

  it('returns "Auditorium" for auditorium category', () => {
    expect(getCategoryLabel('auditorium')).toBe('Auditorium')
  })

  it('returns "Stairway" for stairway category', () => {
    expect(getCategoryLabel('stairway')).toBe('Stairway')
  })

  it('returns "Entrance" for entrance category', () => {
    expect(getCategoryLabel('entrance')).toBe('Entrance')
  })

  it('returns "Other" for other category', () => {
    expect(getCategoryLabel('other')).toBe('Other')
  })

  it('returns "Unknown" for unrecognised category', () => {
    expect(getCategoryLabel('nonexistent' as never)).toBe('Unknown')
  })
})

// ---------------------------------------------------------------------------
// getCategoryIcon
// ---------------------------------------------------------------------------

describe('getCategoryIcon', () => {
  it('returns "▪" for classroom', () => {
    expect(getCategoryIcon('classroom')).toBe('▪')
  })

  it('returns "●" for office', () => {
    expect(getCategoryIcon('office')).toBe('●')
  })

  it('returns "◇" for gymnasium', () => {
    expect(getCategoryIcon('gymnasium')).toBe('◇')
  })

  it('returns "○" for other', () => {
    expect(getCategoryIcon('other')).toBe('○')
  })

  it('returns "○" as fallback for unrecognised category', () => {
    expect(getCategoryIcon('nonexistent' as never)).toBe('○')
  })
})

// ---------------------------------------------------------------------------
// getFeaturedRooms
// ---------------------------------------------------------------------------

describe('getFeaturedRooms', () => {
  function makeNode(uid: string, rooms: string[]): import('../utils/types').Node {
    return { uid, lat: 0, lng: 0, rooms, type: 'room' }
  }

  it('returns rooms in the order of featuredNames', () => {
    const nodes = [
      makeNode('1', ['Library']),
      makeNode('2', ['Cafeteria']),
      makeNode('3', ['Main Office']),
    ]
    const featured = getFeaturedRooms(nodes, ['Main Office', 'Library', 'Cafeteria'])
    expect(featured.map((n) => n.uid)).toEqual(['3', '1', '2'])
  })

  it('is case-insensitive', () => {
    const nodes = [makeNode('1', ['library'])]
    const featured = getFeaturedRooms(nodes, ['Library'])
    expect(featured).toHaveLength(1)
    expect(featured[0].uid).toBe('1')
  })

  it('skips names that do not match any node', () => {
    const nodes = [makeNode('1', ['Library'])]
    const featured = getFeaturedRooms(nodes, ['Library', 'NonExistent', 'Gymnasium'])
    expect(featured).toHaveLength(1)
    expect(featured[0].uid).toBe('1')
  })

  it('returns empty array when no nodes match', () => {
    const nodes = [makeNode('1', ['Library'])]
    const featured = getFeaturedRooms(nodes, ['Gymnasium'])
    expect(featured).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// createSearchIndex
// ---------------------------------------------------------------------------

describe('createSearchIndex', () => {
  function makeNode(
    uid: string,
    rooms: string[],
    opts: Partial<import('../utils/types').Node> = {}
  ): import('../utils/types').Node {
    return { uid, lat: 0, lng: 0, rooms, type: 'room', ...opts }
  }

  it('excludes waypoint nodes', () => {
    const nodes = [makeNode('1', ['Room 101']), makeNode('2', ['waypoint'], { type: 'waypoint' })]
    const idx = createSearchIndex(nodes)
    const results = idx.search('Room')
    expect(results.some((r) => r.item.uid === '2')).toBe(false)
    expect(results.some((r) => r.item.uid === '1')).toBe(true)
  })

  it('returns a searchable Fuse instance', () => {
    const nodes = [makeNode('1', ['Library'])]
    const idx = createSearchIndex(nodes)
    const results = idx.search('Library')
    expect(results).toHaveLength(1)
    expect(results[0].item.uid).toBe('1')
  })
})
