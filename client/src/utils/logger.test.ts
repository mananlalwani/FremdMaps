import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub import.meta.env before importing Logger
vi.stubGlobal('import.meta', { env: { DEV: true } })

const { Logger, logger } = await import('./logger')

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs at all levels in dev mode by default', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})

    const devLogger = new Logger({ isDevelopment: true })
    devLogger.log('test log')
    devLogger.info('test info')
    devLogger.warn('test warn')
    devLogger.error('test error')
    devLogger.debug('test debug')

    expect(console.log).toHaveBeenCalledWith('test log')
    expect(console.info).toHaveBeenCalledWith('test info')
    expect(console.warn).toHaveBeenCalledWith('test warn')
    expect(console.error).toHaveBeenCalledWith('test error')
    expect(console.debug).toHaveBeenCalledWith('test debug')
  })

  it('filters out log/info/debug in production mode', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})

    const prodLogger = new Logger({ isDevelopment: false, enabledLevels: ['warn', 'error'] })
    prodLogger.log('test log')
    prodLogger.info('test info')
    prodLogger.warn('test warn')
    prodLogger.error('test error')
    prodLogger.debug('test debug')

    expect(console.log).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
    expect(console.debug).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('test warn')
    expect(console.error).toHaveBeenCalledWith('test error')
  })

  it('respects custom enabledLevels override', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const custom = new Logger({ isDevelopment: false, enabledLevels: ['warn'] })
    custom.error('should not appear')
    custom.warn('should appear')

    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('should appear')
  })

  it('prepends [prefix] when prefix is set', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const prefixed = new Logger({ isDevelopment: true, prefix: 'Test' })
    prefixed.log('hello')
    expect(console.log).toHaveBeenCalledWith('[Test] hello')
  })

  it('perf logs timing in dev mode', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const devLogger = new Logger({ isDevelopment: true })
    devLogger.perf('build', performance.now())

    expect(console.log).toHaveBeenCalled()
    const mockLog = console.log as ReturnType<typeof vi.fn>
    const call: unknown = mockLog.mock.calls[0][0]
    expect(call).toMatch(/\[perf\] build: \d+\.\d{2}ms/)
  })

  it('perf is silent in production mode', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const prodLogger = new Logger({ isDevelopment: false })
    prodLogger.perf('build', performance.now())

    expect(console.log).not.toHaveBeenCalled()
  })

  it('scope creates a child with nested prefix', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const parent = new Logger({ isDevelopment: true, prefix: 'Graph' })
    const child = parent.scope('Build')
    child.log('started')

    expect(console.log).toHaveBeenCalledWith('[Graph:Build] started')
  })

  it('scope inherits enabledLevels from parent', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const parent = new Logger({ isDevelopment: false, enabledLevels: ['log'] })
    const child = parent.scope('Sub')
    child.log('visible')
    expect(console.log).toHaveBeenCalledWith('[Sub] visible')
  })

  it('formatMessage includes prefix when configured', () => {
    const l = new Logger({ isDevelopment: true, prefix: 'Test' })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    l.log('msg')
    expect(console.log).toHaveBeenCalledWith('[Test] msg')
  })

  it('formatMessage omits prefix when not configured', () => {
    const l = new Logger({ isDevelopment: true })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    l.log('msg')
    expect(console.log).toHaveBeenCalledWith('msg')
  })

  it('shouldLog returns false for disabled levels', () => {
    const l = new Logger({ enabledLevels: ['warn'] })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    l.info('should be silent')
    expect(console.info).not.toHaveBeenCalled()
  })
})

describe('module-level logger instances', () => {
  it('logger is an instance of Logger', () => {
    expect(logger).toBeInstanceOf(Logger)
  })
})
