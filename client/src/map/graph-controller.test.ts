import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGraphController } from './graph-controller'
import type { Graph, Node } from '../utils/types'

vi.mock('../utils/logger', () => ({
  graphLogger: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), perf: vi.fn() },
}))

class FakeWorker {
  static instances: FakeWorker[] = []
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  messages: Array<{ cacheKey: string }> = []

  constructor(_url: URL, _options: WorkerOptions) {
    FakeWorker.instances.push(this)
  }

  postMessage(message: { cacheKey: string }): void {
    this.messages.push(message)
  }

  terminate(): void {}

  respond(cacheKey: string, graph?: Graph, error?: string): void {
    this.onmessage?.({ data: { cacheKey, graph, error } } as MessageEvent)
  }
}

const NODES: Node[] = [
  { uid: 'a', lat: 0, lng: 0, rooms: ['A'], floor: '1', type: 'room' },
  { uid: 'b', lat: 0, lng: 10, rooms: ['B'], floor: '1', type: 'room' },
]

afterEach(() => {
  FakeWorker.instances = []
  vi.unstubAllGlobals()
})

describe('createGraphController', () => {
  it('routes concurrent worker responses to their matching build requests', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = createGraphController()
    const graphOne: Graph = new Map([['a', []]])
    const graphTwo: Graph = new Map([['b', []]])

    const first = controller.ensureGraph(NODES, [], [], 'revision-1')
    const second = controller.ensureGraph(NODES, [], [], 'revision-2')
    const worker = FakeWorker.instances[0]

    worker.respond('revision-1', graphOne)
    worker.respond('revision-2', graphTwo)

    await expect(first).resolves.toBe(graphOne)
    await expect(second).resolves.toBe(graphTwo)
    expect(controller.getGraph()).toBe(graphTwo)
  })

  it('does not let a stale build replace the newest successful graph', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = createGraphController()
    const graphOne: Graph = new Map([['a', []]])
    const graphTwo: Graph = new Map([['b', []]])

    const first = controller.ensureGraph(NODES, [], [], 'revision-1')
    const second = controller.ensureGraph(NODES, [], [], 'revision-2')
    const worker = FakeWorker.instances[0]

    worker.respond('revision-2', graphTwo)
    await expect(second).resolves.toBe(graphTwo)
    worker.respond('revision-1', graphOne)
    await expect(first).resolves.toBe(graphOne)

    expect(controller.getGraph()).toBe(graphTwo)
  })

  it('falls back to the main thread when the worker reports an error', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = createGraphController()
    const build = controller.ensureGraph(NODES, [], [], 'revision-1')

    FakeWorker.instances[0].respond('revision-1', undefined, 'worker failed')

    await expect(build).resolves.toSatisfy((graph: Graph) => graph.size === NODES.length)
  })
})
