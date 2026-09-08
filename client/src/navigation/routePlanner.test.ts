import { afterEach, describe, expect, it } from 'vitest'
import { createNavigationData } from './navigationData'
import { createRoutePlanner } from './routePlanner'
import type { NavigationFetch } from './navigationData'
import type { RoutePlanner } from './routePlanner'

type JsonFixture = string | number | boolean | null | JsonFixture[] | { [key: string]: JsonFixture }

const nodesByFloor = {
  '1': [
    { uid: 'start-1', lat: -100, lng: 100, rooms: ['Start'], type: 'room' },
    { uid: 'auditorium-1', lat: -100, lng: 300, rooms: ['Auditorium'], type: 'room' },
  ],
  '2': [
    { uid: 'start-2', lat: -200, lng: 100, rooms: ['Start'], type: 'room' },
    { uid: 'auditorium-2', lat: -200, lng: 150, rooms: ['G', 'Auditorium'], type: 'stairway' },
    { uid: 'bathroom-2', lat: -200, lng: 180, rooms: ['Bathroom'], type: 'bathroom' },
  ],
}

function response(data: JsonFixture): Response {
  return new Response(JSON.stringify(data))
}

const fetchData: NavigationFetch = (url) => {
  const floor = url.includes('floor1') ? '1' : '2'
  if (url.endsWith('nodes.json')) return Promise.resolve(response(nodesByFloor[floor]))
  return Promise.resolve(response([]))
}

function waitUntilReady(planner: RoutePlanner): Promise<void> {
  if (planner.getStatus().state === 'ready') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const unsubscribe = planner.subscribe((status) => {
      if (status.state === 'ready') {
        unsubscribe()
        resolve()
      } else if (status.state === 'failed') {
        unsubscribe()
        reject(status.error)
      }
    })
  })
}

const planners: RoutePlanner[] = []

afterEach(() => {
  for (const planner of planners) planner.dispose()
  planners.length = 0
})

describe('route planner', () => {
  it('keeps search available while graph compilation is independent', async () => {
    const data = createNavigationData({ fetch: fetchData })
    const planner = createRoutePlanner(data)
    planners.push(planner)
    await data.load('2')

    expect(planner.search('Auditorium').map((result) => result.node.uid)).toContain('auditorium-1')
  })

  it('preserves an explicit origin and prefers its same-floor destination', async () => {
    const data = createNavigationData({ fetch: fetchData })
    const planner = createRoutePlanner(data)
    planners.push(planner)
    await data.load('2')
    await waitUntilReady(planner)

    const outcome = planner.plan({ text: 'Start', selectedUid: 'start-1' }, { text: 'Auditorium' })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.plan.origin.uid).toBe('start-1')
      expect(outcome.plan.destination.uid).toBe('auditorium-1')
    }
  })

  it('chooses the shortest reachable same-floor pair for text-only places', async () => {
    const data = createNavigationData({ fetch: fetchData })
    const planner = createRoutePlanner(data)
    planners.push(planner)
    await data.load('2')
    await waitUntilReady(planner)

    const outcome = planner.plan({ text: 'Start' }, { text: 'Auditorium' })

    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.plan.origin.uid).toBe('start-2')
      expect(outcome.plan.destination.uid).toBe('auditorium-2')
    }
  })

  it('exposes render-ready debug connections without leaking the graph', async () => {
    const data = createNavigationData({ fetch: fetchData })
    const planner = createRoutePlanner(data)
    planners.push(planner)
    await data.load('2')
    await waitUntilReady(planner)

    const debugView = planner.getDebugView()

    expect(debugView.revision).toBe(data.getSnapshot()?.revision)
    expect(debugView.stats?.nodes).toBe(5)
    expect(debugView.connections.length).toBeGreaterThan(0)
    expect(debugView.connections[0]).toMatchObject({ floor: '1' })
    expect(Number.isFinite(debugView.connections[0].start.lat)).toBe(true)
    expect(Number.isFinite(debugView.connections[0].start.lng)).toBe(true)
    expect(Number.isFinite(debugView.connections[0].end.lat)).toBe(true)
    expect(Number.isFinite(debugView.connections[0].end.lng)).toBe(true)
    expect(debugView).not.toHaveProperty('edges')
  })

  it('rejects invalid hallway-distance settings', async () => {
    const data = createNavigationData({ fetch: fetchData })
    const planner = createRoutePlanner(data)
    planners.push(planner)

    await expect(planner.setMaximumHallwayDistance(0)).rejects.toThrow(
      'Maximum hallway distance must be a positive finite number'
    )
  })

  it('returns structured outcomes for expected failures', () => {
    const data = createNavigationData({ fetch: fetchData })
    const planner = createRoutePlanner(data)
    planners.push(planner)

    expect(planner.plan({ text: '101' }, { text: '102' })).toEqual({ status: 'not-ready' })
  })
})
