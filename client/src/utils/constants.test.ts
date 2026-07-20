import { describe, it, expect } from 'vitest'
import { MAP_CONFIG, FLOORS, UI_CONFIG, GEOMETRY, getDataUrl } from './constants'

describe('MAP_CONFIG', () => {
  it('has IMAGE_WIDTH > 0', () => {
    expect(MAP_CONFIG.IMAGE_WIDTH).toBeGreaterThan(0)
  })

  it('has IMAGE_HEIGHT > 0', () => {
    expect(MAP_CONFIG.IMAGE_HEIGHT).toBeGreaterThan(0)
  })

  it('has MIN_ZOOM less than MAX_ZOOM', () => {
    expect(MAP_CONFIG.MIN_ZOOM).toBeLessThan(MAP_CONFIG.MAX_ZOOM)
  })

  it('has MAX_HALLWAY_DISTANCE > 0', () => {
    expect(MAP_CONFIG.MAX_HALLWAY_DISTANCE).toBeGreaterThan(0)
  })

  it('has STAIR_COST > 0', () => {
    expect(MAP_CONFIG.STAIR_COST).toBeGreaterThan(0)
  })

  it('has RDP_EPSILON > 0', () => {
    expect(MAP_CONFIG.RDP_EPSILON).toBeGreaterThan(0)
  })

  it('has RDP_MIN_POINTS > 0', () => {
    expect(MAP_CONFIG.RDP_MIN_POINTS).toBeGreaterThan(0)
  })
})

describe('FLOORS', () => {
  it('has a DEFAULT floor that exists in AVAILABLE', () => {
    const ids = FLOORS.AVAILABLE.map((f) => f.id)
    expect(ids).toContain(FLOORS.DEFAULT)
  })

  it('each floor has id, name, and image', () => {
    for (const floor of FLOORS.AVAILABLE) {
      expect(floor.id).toBeTruthy()
      expect(floor.name).toBeTruthy()
      expect(floor.image).toBeTruthy()
    }
  })

  it('has at least one floor', () => {
    expect(FLOORS.AVAILABLE.length).toBeGreaterThanOrEqual(1)
  })
})

describe('UI_CONFIG', () => {
  it('has STATUS_MESSAGE_TIMEOUT_MS > 0', () => {
    expect(UI_CONFIG.STATUS_MESSAGE_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('has a valid ROUTE_PATH_COLOR', () => {
    expect(UI_CONFIG.ROUTE_PATH_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('has ROUTE_PATH_WEIGHT > 0', () => {
    expect(UI_CONFIG.ROUTE_PATH_WEIGHT).toBeGreaterThan(0)
  })
})

describe('GEOMETRY', () => {
  it('has EPSILON > 0', () => {
    expect(GEOMETRY.EPSILON).toBeGreaterThan(0)
  })

  it('has INTERSECTION_EPSILON > 0', () => {
    expect(GEOMETRY.INTERSECTION_EPSILON).toBeGreaterThan(0)
  })
})

describe('getDataUrl', () => {
  it('returns correct URL for nodes', () => {
    expect(getDataUrl('1', 'nodes')).toBe('/data/floor1/nodes.json')
  })

  it('returns correct URL for walls', () => {
    expect(getDataUrl('2', 'walls')).toBe('/data/floor2/walls.json')
  })

  it('returns correct URL for zones', () => {
    expect(getDataUrl('3', 'zones')).toBe('/data/floor3/zones.json')
  })
})
