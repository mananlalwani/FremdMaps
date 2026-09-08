import { describe, expect, it, vi } from 'vitest'
import { createNavigationData } from './navigationData'
import type { NavigationEdit, NavigationFetch } from './navigationData'

type JsonFixture = string | number | boolean | null | JsonFixture[] | { [key: string]: JsonFixture }

const floorNodes = (floor: string) => [
  { uid: `room-${floor}`, lat: -100, lng: 100, rooms: [`Room ${floor}`], type: 'room' },
]
const floorWalls = () => [
  [
    [-100, 0],
    [-100, 200],
  ],
]

function response(data: JsonFixture, ok = true, status = 200): Response {
  return new Response(JSON.stringify(data), { status: ok ? status : Math.max(status, 400) })
}

function completeFetch(): NavigationFetch {
  const fetchData: NavigationFetch = vi.fn((url: string) => {
    const floor = url.includes('floor1') ? '1' : '2'
    if (url.endsWith('nodes.json')) return Promise.resolve(response(floorNodes(floor)))
    if (url.endsWith('walls.json')) return Promise.resolve(response(floorWalls()))
    return Promise.resolve(response([]))
  })
  return fetchData
}

describe('navigation data', () => {
  it('publishes one complete revision for all floor facts', async () => {
    const data = createNavigationData({ fetch: completeFetch() })

    const snapshot = await data.load('2')

    expect(snapshot.scope).toBe('complete')
    expect(snapshot.floors).toEqual(['1', '2'])
    expect(snapshot.nodes.map((node) => node.floor)).toEqual(['1', '2'])
    expect(snapshot.walls.map((wall) => wall.floor)).toEqual(['1', '2'])
    expect(snapshot.revision).toBe(1)
  })

  it('publishes a limited preferred-floor revision when the initial complete load fails', async () => {
    let floorOneWallAttempts = 0
    const fetchData: NavigationFetch = vi.fn((url: string) => {
      const floor = url.includes('floor1') ? '1' : '2'
      if (url.endsWith('nodes.json')) return Promise.resolve(response(floorNodes(floor)))
      if (url.endsWith('walls.json')) {
        if (floor === '1' && floorOneWallAttempts++ === 0) {
          return Promise.resolve(response({}, false, 500))
        }
        return Promise.resolve(response(floorWalls()))
      }
      return Promise.resolve(response([]))
    })
    const data = createNavigationData({ fetch: fetchData })

    const snapshot = await data.load('1')

    expect(snapshot.scope).toBe('limited')
    expect(snapshot.floors).toEqual(['1'])
    expect(snapshot.nodes).toHaveLength(1)
  })

  it('replaces a limited revision when another floor becomes current', async () => {
    let failFloorOne = true
    let failFloorTwo = false
    const fetchData: NavigationFetch = vi.fn((url: string) => {
      const floor = url.includes('floor1') ? '1' : '2'
      if (url.endsWith('nodes.json')) return Promise.resolve(response(floorNodes(floor)))
      if (url.endsWith('walls.json')) {
        const shouldFail = (floor === '1' && failFloorOne) || (floor === '2' && failFloorTwo)
        if (shouldFail) return Promise.resolve(response({}, false, 500))
        return Promise.resolve(response(floorWalls()))
      }
      return Promise.resolve(response([]))
    })
    const data = createNavigationData({ fetch: fetchData })
    const floorTwo = await data.load('2')
    failFloorOne = false
    failFloorTwo = true

    const floorOne = await data.load('1')

    expect(floorTwo.scope).toBe('limited')
    expect(floorTwo.floors).toEqual(['2'])
    expect(floorOne.scope).toBe('limited')
    expect(floorOne.floors).toEqual(['1'])
    expect(floorOne.revision).toBeGreaterThan(floorTwo.revision)
  })

  it('keeps the last coherent revision when a reload fails', async () => {
    const fetchData = completeFetch()
    const data = createNavigationData({ fetch: fetchData })
    const first = await data.load('2')
    vi.mocked(fetchData).mockResolvedValue(response({}, false, 500))

    const afterFailure = await data.reload('2')

    expect(afterFailure).toBe(first)
    expect(data.getSnapshot()).toBe(first)
  })

  it('rejects malformed navigation data before publishing a revision', async () => {
    const fetchData = completeFetch()
    vi.mocked(fetchData).mockImplementation((url: string) => {
      const floor = url.includes('floor1') ? '1' : '2'
      if (url.endsWith('nodes.json')) {
        return Promise.resolve(
          response(
            floor === '1'
              ? [{ uid: 'broken', lat: 'not-a-number', lng: 100, rooms: ['Broken'] }]
              : floorNodes(floor)
          )
        )
      }
      if (url.endsWith('walls.json')) return Promise.resolve(response(floorWalls()))
      return Promise.resolve(response([]))
    })
    const data = createNavigationData({ fetch: fetchData })

    await expect(data.load('1')).rejects.toThrow('lat must be a finite number')

    expect(data.getSnapshot()).toBeNull()
  })

  it('publishes an edit only after every guard accepts the candidate', async () => {
    const data = createNavigationData({ fetch: completeFetch() })
    const original = await data.load('2')
    const guard = vi.fn(() => Promise.reject(new Error('compile failed')))
    data.addEditGuard(guard)

    await expect(
      data.applyEdit({
        type: 'add-node',
        node: { uid: 'new', lat: -100, lng: 300, rooms: ['New'], floor: '2', type: 'room' },
      })
    ).rejects.toThrow('compile failed')

    expect(data.getSnapshot()).toBe(original)
    expect(data.getSnapshot()?.nodes.some((node) => node.uid === 'new')).toBe(false)
  })

  it('applies node, wall, and zone operations through coherent revisions', async () => {
    const data = createNavigationData({ fetch: completeFetch() })
    await data.load('2')
    const wall = {
      start: { lat: -200, lng: 200 },
      end: { lat: -200, lng: 300 },
      floor: '2',
    }
    const replacement = { ...wall, end: { lat: -200, lng: 350 } }
    const zone = {
      uid: 'zone-new',
      floor: '2',
      bounds: { minLat: -300, minLng: 200, maxLat: -200, maxLng: 300 },
      intensity: 2,
    }

    await data.applyEdit({
      type: 'add-node',
      node: { uid: 'node-new', rooms: ['New'], lat: -200, lng: 200, floor: '2' },
    })
    await data.applyEdit({ type: 'update-node', uid: 'node-new', changes: { rooms: ['Updated'] } })
    await data.applyEdit({ type: 'add-wall', wall })
    await data.applyEdit({ type: 'update-wall', wall, replacement })
    await data.applyEdit({ type: 'add-zone', zone })
    await data.applyEdit({ type: 'update-zone', uid: zone.uid, changes: { intensity: 3 } })

    expect(data.getSnapshot()?.nodes.find((node) => node.uid === 'node-new')?.rooms).toEqual([
      'Updated',
    ])
    expect(data.getSnapshot()?.walls).toContainEqual(replacement)
    expect(
      data.getSnapshot()?.zones.find((candidate) => candidate.uid === zone.uid)?.intensity
    ).toBe(3)

    await data.applyEdit({ type: 'remove-node', uid: 'node-new' })
    await data.applyEdit({ type: 'remove-wall', wall: replacement })
    await data.applyEdit({ type: 'remove-zone', uid: zone.uid })

    expect(data.getSnapshot()?.nodes.some((node) => node.uid === 'node-new')).toBe(false)
    expect(data.getSnapshot()?.walls).not.toContainEqual(replacement)
    expect(data.getSnapshot()?.zones.some((candidate) => candidate.uid === zone.uid)).toBe(false)
  })

  it.each<NavigationEdit>([
    {
      type: 'add-node',
      node: { uid: 'room-2', rooms: ['Duplicate'], lat: -100, lng: 200, floor: '2' },
    },
    {
      type: 'add-node',
      node: { uid: 'outside', rooms: ['Outside'], lat: 1, lng: 200, floor: '2' },
    },
    {
      type: 'remove-node',
      uid: 'missing',
    },
    {
      type: 'add-wall',
      wall: { start: { lat: -100, lng: 100 }, end: { lat: -100, lng: 100 }, floor: '2' },
    },
    {
      type: 'add-zone',
      zone: {
        uid: 'invalid-zone',
        floor: '2',
        bounds: { minLat: -200, minLng: 100, maxLat: -100, maxLng: 200 },
        intensity: 11,
      },
    },
  ])('rejects an invalid $type edit without publishing it', async (edit) => {
    const data = createNavigationData({ fetch: completeFetch() })
    const previous = await data.load('2')

    await expect(data.applyEdit(edit)).rejects.toThrow()

    expect(data.getSnapshot()).toBe(previous)
  })
})
