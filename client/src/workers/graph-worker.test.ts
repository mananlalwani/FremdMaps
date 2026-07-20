import { describe, it, expect, vi, beforeAll } from 'vitest'

describe('graph-worker', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'self',
      Object.assign(globalThis, {
        onmessage: null,
        postMessage: vi.fn(),
      })
    )
  })

  it('loads the worker module without error', async () => {
    await expect(import('./graph-worker')).resolves.toBeDefined()
  })

  it('sets self.onmessage to a function', async () => {
    await import('./graph-worker')
    expect(typeof (self as unknown as { onmessage: unknown }).onmessage).toBe('function')
  })
})
