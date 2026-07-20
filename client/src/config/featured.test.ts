import { describe, it, expect } from 'vitest'
import { FEATURED_ROOMS, SEARCH_CONFIG, CATEGORY_FILTERS } from './featured'

describe('FEATURED_ROOMS', () => {
  it('is a non-empty array', () => {
    expect(FEATURED_ROOMS.length).toBeGreaterThan(0)
  })

  it('each entry is a non-empty string', () => {
    for (const room of FEATURED_ROOMS) {
      expect(room.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate entries', () => {
    expect(new Set(FEATURED_ROOMS).size).toBe(FEATURED_ROOMS.length)
  })
})

describe('SEARCH_CONFIG', () => {
  it('MAX_RESULTS > 0', () => {
    expect(SEARCH_CONFIG.MAX_RESULTS).toBeGreaterThan(0)
  })

  it('MIN_QUERY_LENGTH >= 0', () => {
    expect(SEARCH_CONFIG.MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(0)
  })

  it('DEBOUNCE_MS > 0', () => {
    expect(SEARCH_CONFIG.DEBOUNCE_MS).toBeGreaterThan(0)
  })

  it('FUZZY_THRESHOLD is between 0 and 1', () => {
    expect(SEARCH_CONFIG.FUZZY_THRESHOLD).toBeGreaterThanOrEqual(0)
    expect(SEARCH_CONFIG.FUZZY_THRESHOLD).toBeLessThanOrEqual(1)
  })

  it('RECENCY_BOOST > 0', () => {
    expect(SEARCH_CONFIG.RECENCY_BOOST).toBeGreaterThan(0)
  })

  it('RECENCY_HALF_LIFE_DAYS > 0', () => {
    expect(SEARCH_CONFIG.RECENCY_HALF_LIFE_DAYS).toBeGreaterThan(0)
  })
})

describe('CATEGORY_FILTERS', () => {
  it('is a non-empty array', () => {
    expect(CATEGORY_FILTERS.length).toBeGreaterThan(0)
  })

  it('each entry has value, label, and icon', () => {
    for (const filter of CATEGORY_FILTERS) {
      expect(filter.value).toBeTruthy()
      expect(filter.label).toBeTruthy()
      expect(filter.icon).toBeTruthy()
    }
  })

  it('has unique values', () => {
    const values = CATEGORY_FILTERS.map((f) => f.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
