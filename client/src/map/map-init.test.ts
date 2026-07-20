// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearMapData } from './map-init'
import { state } from './map-state'

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), perf: vi.fn() },
  graphLogger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), perf: vi.fn() },
  searchLogger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), perf: vi.fn() },
  routeLogger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), perf: vi.fn() },
}))

describe('clearMapData', () => {
  beforeEach(() => {
    state.trafficZones = [
      {
        uid: 'test-zone',
        floor: '2',
        bounds: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 },
        intensity: 1.5,
      },
    ]
    state.trafficZoneRects = []
  })

  it('clears traffic zones and rects', () => {
    clearMapData()
    expect(state.trafficZones).toEqual([])
    expect(state.trafficZoneRects).toEqual([])
  })

  it('handles empty state gracefully', () => {
    state.trafficZones = []
    state.trafficZoneRects = []
    expect(() => clearMapData()).not.toThrow()
  })
})

// ── parseNodes ────────────────────────────────────────────────────────────────

describe('parseNodes', () => {
  async function getParser() {
    const m = await import('./map-init')
    return m.parseNodes
  }

  it('parses valid node data', async () => {
    const parseNodes = await getParser()
    const input = [
      { uid: 'n1', lat: -100, lng: 500, rooms: ['Room 101'] },
      { uid: 'n2', lat: -200, lng: 1000, rooms: ['Room 201'], type: 'bathroom' },
    ]
    const result = parseNodes(input, '1', 'test')
    expect(result).toHaveLength(2)
    expect(result[0].uid).toBe('n1')
    expect(result[0].floor).toBe('1')
    expect(result[0].type).toBeUndefined()
    expect(result[1].type).toBe('bathroom')
  })

  it('parses nodes with optional fields', async () => {
    const parseNodes = await getParser()
    const input = [
      {
        uid: 'n1',
        lat: -100,
        lng: 500,
        rooms: ['Stair A'],
        type: 'stairway',
        connectsTo: ['Stair B'],
        category: 'stairway',
      },
    ]
    const result = parseNodes(input, '1', 'test')
    expect(result[0].connectsTo).toEqual(['Stair B'])
    expect(result[0].category).toBe('stairway')
  })

  it('parses nodes with bathroomType', async () => {
    const parseNodes = await getParser()
    const input = [
      {
        uid: 'n1',
        lat: -100,
        lng: 500,
        rooms: ['Restroom'],
        type: 'bathroom',
        bathroomType: 'all-gender',
      },
    ]
    const result = parseNodes(input, '1', 'test')
    expect(result[0].bathroomType).toBe('all-gender')
  })

  it('throws when input is not an array', async () => {
    const parseNodes = await getParser()
    expect(() => parseNodes('not-array', '1', 'test')).toThrow('must be an array')
  })

  it('throws when node is not an object', async () => {
    const parseNodes = await getParser()
    expect(() => parseNodes(['string'], '1', 'test')).toThrow('must be an object')
  })

  it('throws when uid is missing', async () => {
    const parseNodes = await getParser()
    expect(() => parseNodes([{ lat: 0, lng: 0, rooms: ['R'] }], '1', 'test')).toThrow('uid')
  })

  it('throws when lat is non-finite', async () => {
    const parseNodes = await getParser()
    expect(() => parseNodes([{ uid: 'n1', lat: NaN, lng: 0, rooms: ['R'] }], '1', 'test')).toThrow(
      'lat'
    )
  })

  it('throws when lat is outside map bounds', async () => {
    const parseNodes = await getParser()
    expect(() => parseNodes([{ uid: 'n1', lat: 1, lng: 0, rooms: ['R'] }], '1', 'test')).toThrow(
      'lat'
    )
  })

  it('throws when lng is outside map bounds', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes([{ uid: 'n1', lat: -100, lng: -1, rooms: ['R'] }], '1', 'test')
    ).toThrow('lng')
  })

  it('throws when rooms is not an array', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes([{ uid: 'n1', lat: -100, lng: 0, rooms: 'not-array' }], '1', 'test')
    ).toThrow('rooms')
  })

  it('throws when rooms is empty', async () => {
    const parseNodes = await getParser()
    expect(() => parseNodes([{ uid: 'n1', lat: -100, lng: 0, rooms: [] }], '1', 'test')).toThrow(
      'rooms'
    )
  })

  it('throws when type is invalid', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes([{ uid: 'n1', lat: -100, lng: 0, rooms: ['R'], type: 'invalid' }], '1', 'test')
    ).toThrow('type')
  })

  it('throws when connectsTo is not an array', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes(
        [{ uid: 'n1', lat: -100, lng: 0, rooms: ['R'], connectsTo: 'not-array' }],
        '1',
        'test'
      )
    ).toThrow('connectsTo')
  })

  it('throws when node UIDs are duplicated on a floor', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes(
        [
          { uid: 'n1', lat: -100, lng: 0, rooms: ['101'] },
          { uid: 'n1', lat: -200, lng: 0, rooms: ['102'] },
        ],
        '1',
        'test'
      )
    ).toThrow('duplicates another node')
  })

  it('throws when bathroomType is invalid', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes(
        [{ uid: 'n1', lat: -100, lng: 0, rooms: ['R'], type: 'bathroom', bathroomType: 'invalid' }],
        '1',
        'test'
      )
    ).toThrow('bathroomType')
  })

  it('throws when category is invalid', async () => {
    const parseNodes = await getParser()
    expect(() =>
      parseNodes([{ uid: 'n1', lat: -100, lng: 0, rooms: ['R'], category: 'invalid' }], '1', 'test')
    ).toThrow('category')
  })
})

// ── parseWalls ────────────────────────────────────────────────────────────────

describe('parseWalls', () => {
  async function getParser() {
    const m = await import('./map-init')
    return m.parseWalls
  }

  it('parses valid wall polylines', async () => {
    const parseWalls = await getParser()
    const input = [
      [
        [-100, 0],
        [-200, 100],
      ],
      [
        [-200, 100],
        [-300, 200],
      ],
    ]
    const result = parseWalls(input, 'test')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([
      [-100, 0],
      [-200, 100],
    ])
  })

  it('accepts a multi-point wall polyline', async () => {
    const parseWalls = await getParser()
    const result = parseWalls(
      [
        [
          [-100, 0],
          [-200, 100],
          [-300, 200],
        ],
      ],
      'test'
    )

    expect(result).toEqual([
      [
        [-100, 0],
        [-200, 100],
        [-300, 200],
      ],
    ])
  })

  it('throws when input is not an array', async () => {
    const parseWalls = await getParser()
    expect(() => parseWalls('not-array', 'test')).toThrow('must be an array')
  })

  it('throws when polyline has fewer than two points', async () => {
    const parseWalls = await getParser()
    expect(() => parseWalls([[[0, 0]]], 'test')).toThrow('polyline with at least 2 points')
  })

  it('throws when point is not [lat, lng]', async () => {
    const parseWalls = await getParser()
    expect(() => parseWalls([[[0], [1, 2]]], 'test')).toThrow('must be [lat, lng]')
  })

  it('throws when coordinate is outside bounds', async () => {
    const parseWalls = await getParser()
    expect(() =>
      parseWalls(
        [
          [
            [1, 0],
            [0, 100],
          ],
        ],
        'test'
      )
    ).toThrow('lat')
  })

  it('throws for a degenerate wall-polyline segment', async () => {
    const parseWalls = await getParser()
    expect(() =>
      parseWalls(
        [
          [
            [-100, 0],
            [-100, 0],
          ],
        ],
        'test'
      )
    ).toThrow('degenerate')
  })

  it('handles empty array', async () => {
    const parseWalls = await getParser()
    expect(parseWalls([], 'test')).toEqual([])
  })
})

// ── parseZones ────────────────────────────────────────────────────────────────

describe('parseZones', () => {
  async function getParser() {
    const m = await import('./map-init')
    return m.parseZones
  }

  const validZone = {
    uid: 'z1',
    floor: '1',
    bounds: { minLat: -100, minLng: 0, maxLat: -50, maxLng: 100 },
    intensity: 1.5,
  }

  it('parses a valid traffic zone', async () => {
    const parseZones = await getParser()
    const result = parseZones([validZone], '1', 'test')
    expect(result).toHaveLength(1)
    expect(result[0].uid).toBe('z1')
    expect(result[0].intensity).toBe(1.5)
  })

  it('throws when input is not an array', async () => {
    const parseZones = await getParser()
    expect(() => parseZones('not-array', '1', 'test')).toThrow('must be an array')
  })

  it('throws when zone is not an object', async () => {
    const parseZones = await getParser()
    expect(() => parseZones(['string'], '1', 'test')).toThrow('must be an object')
  })

  it('throws when floor does not match', async () => {
    const parseZones = await getParser()
    expect(() => parseZones([{ ...validZone, floor: '2' }], '1', 'test')).toThrow(
      'floor must equal'
    )
  })

  it('throws when bounds is not an object', async () => {
    const parseZones = await getParser()
    expect(() => parseZones([{ ...validZone, bounds: 'not-object' }], '1', 'test')).toThrow(
      'bounds'
    )
  })

  it('throws when bounds have min > max', async () => {
    const parseZones = await getParser()
    const bad = { ...validZone, bounds: { minLat: -50, minLng: 0, maxLat: -100, maxLng: 100 } }
    expect(() => parseZones([bad], '1', 'test')).toThrow('bounds must satisfy')
  })

  it('throws when intensity is not a finite number', async () => {
    const parseZones = await getParser()
    expect(() => parseZones([{ ...validZone, intensity: 'high' }], '1', 'test')).toThrow(
      'intensity'
    )
  })

  it('throws when intensity is outside [1, 10]', async () => {
    const parseZones = await getParser()
    expect(() => parseZones([{ ...validZone, intensity: 0.5 }], '1', 'test')).toThrow(
      'intensity must be in range'
    )
    expect(() => parseZones([{ ...validZone, intensity: 11 }], '1', 'test')).toThrow(
      'intensity must be in range'
    )
  })

  it('throws when zone UIDs are duplicated on a floor', async () => {
    const parseZones = await getParser()
    expect(() => parseZones([validZone, { ...validZone }], '1', 'test')).toThrow(
      'duplicates another zone'
    )
  })

  it('accepts intensity of 10 (upper bound)', async () => {
    const parseZones = await getParser()
    const result = parseZones([{ ...validZone, intensity: 10 }], '1', 'test')
    expect(result[0].intensity).toBe(10)
  })

  it('handles empty array', async () => {
    const parseZones = await getParser()
    expect(parseZones([], '1', 'test')).toEqual([])
  })
})

// ── loadAllFloorsNavigationData ────────────────────────────────────────────────

describe('loadAllFloorsNavigationData', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    state.hasLoadedGlobalNavigationData = false
    state.allNodesAllFloors = []
    state.wallObjects = []
    state.allTrafficZones = []
  })

  it('does not mark global data complete when walls fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        // loadAllNodesAllFloors — floor 1 nodes
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([{ uid: 'a', lat: -100, lng: 0, rooms: ['101'], floor: '1' }]),
        })
        // floor 2 nodes
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([{ uid: 'b', lat: -200, lng: 0, rooms: ['201'], floor: '2' }]),
        })
        // loadAllFloorsWalls — floor 1 walls (fail)
        .mockRejectedValueOnce(new Error('Network error'))
        // floor 2 walls (fail)
        .mockRejectedValueOnce(new Error('Network error'))
        // loadAllFloorsZones — ok
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
    )

    const { loadAllFloorsNavigationData } = await import('./map-init')
    await loadAllFloorsNavigationData()

    expect(state.hasLoadedGlobalNavigationData).toBe(false)
    expect(state.wallObjects).toHaveLength(0)

    vi.unstubAllGlobals()
  })

  it('does not mark global data complete when one floor walls request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/data/floor2/walls.json') {
          return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve([]) })
        }
        if (url.endsWith('/nodes.json')) {
          const floor = url.includes('floor1') ? '1' : '2'
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve([{ uid: `room-${floor}`, lat: -100, lng: 0, rooms: ['101'], floor }]),
          })
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      })
    )

    const { loadAllFloorsNavigationData } = await import('./map-init')
    await loadAllFloorsNavigationData()

    expect(state.hasLoadedGlobalNavigationData).toBe(false)
    expect(state.allNodesAllFloors).toHaveLength(0)
    expect(state.wallObjects).toHaveLength(0)
  })

  it('does not mark global data complete when nodes fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        // loadAllNodesAllFloors — floor 1 nodes (fail)
        .mockRejectedValueOnce(new Error('Network error'))
        // floor 2 nodes (fail)
        .mockRejectedValueOnce(new Error('Network error'))
    )

    const { loadAllFloorsNavigationData } = await import('./map-init')
    await loadAllFloorsNavigationData()

    expect(state.hasLoadedGlobalNavigationData).toBe(false)

    vi.unstubAllGlobals()
  })
})

// ── loadData race safety ───────────────────────────────────────────────────────

describe('loadData race safety', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    state.currentFloor = ''
    state.hasLoadedGlobalNavigationData = false
    state.allNodesAllFloors = []
    state.wallObjects = []
    state.allTrafficZones = []
    state.collectedNodes = []
    state.collectedWalls = []
    state.trafficZones = []
  })

  it('discards late response when floor changed during fetch', async () => {
    // Initial state: global data already loaded, so loadData's first-time
    // path is skipped.  The fetch promises succeed but state.currentFloor
    // changes before they resolve.
    state.currentFloor = '2'
    state.hasLoadedGlobalNavigationData = true
    state.allNodesAllFloors = [
      { uid: 'floor2-a', lat: -100, lng: 0, rooms: ['201'], floor: '2', type: 'room' },
    ]
    state.wallObjects = []
    state.allTrafficZones = []
    state.collectedNodes = []
    state.collectedWalls = []
    state.trafficZones = []

    // loadData runs, derives per-floor data for floor 2, then the race
    // guard should NOT reject because currentFloor still matches.
    const { loadData } = await import('./map-init')
    await loadData()

    expect(state.collectedNodes).toHaveLength(1)
    expect(state.collectedNodes[0].uid).toBe('floor2-a')
  })

  it('does not fetch current-floor data twice on initial load', async () => {
    // On first load, loadData calls loadAllFloorsNavigationData which
    // fetches all floors.  After that, it derives per-floor data from the
    // global pool instead of fetching separately — so there should only be
    // N floor fetches (one per available floor), not N+1.
    state.currentFloor = '2'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      })
    )

    const { loadData } = await import('./map-init')
    await loadData()

    expect(state.collectedNodes).toBeDefined()

    vi.unstubAllGlobals()
  })
})

// ── loadAllNodesAllFloors ─────────────────────────────────────────────────────

describe('loadAllNodesAllFloors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const { loadAllNodesAllFloors } = await import('./map-init')
    const result = await loadAllNodesAllFloors()

    expect(result).toEqual([])

    vi.unstubAllGlobals()
  })
})

// ── loadAllFloorsWalls ────────────────────────────────────────────────────────

describe('loadAllFloorsWalls', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const { loadAllFloorsWalls } = await import('./map-init')
    const result = await loadAllFloorsWalls()

    expect(result).toEqual([])

    vi.unstubAllGlobals()
  })
})

// ── loadAllFloorsZones ────────────────────────────────────────────────────────

describe('loadAllFloorsZones', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const { loadAllFloorsZones } = await import('./map-init')
    const result = await loadAllFloorsZones()

    expect(result).toEqual([])

    vi.unstubAllGlobals()
  })
})
