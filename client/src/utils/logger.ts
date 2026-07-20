/**
 * Structured logger with development/production level filtering.
 *
 * In development (`import.meta.env.DEV === true`) all five levels are enabled.
 * In production only `warn` and `error` reach the console, keeping output clean.
 *
 * Usage:
 * ```ts
 * import { logger, graphLogger } from '../utils/logger'
 * logger.log('hello')
 * graphLogger.warn('isolated node', node)
 * const t = performance.now(); ...; logger.perf('build graph', t)
 * ```
 */

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * Configuration for a `Logger` instance.
 *
 * - `isDevelopment`: when `true`, `perf()` timings are printed and all levels
 *   are active (unless `enabledLevels` is overridden). Defaults to
 *   `import.meta.env.DEV ?? false` — the `?? false` fallback ensures production
 *   mode is assumed in non-Astro contexts (e.g. Vitest without a full env shim),
 *   preventing verbose debug output from leaking outside the dev build.
 * - `enabledLevels`: explicit allow-list of log levels. Defaults to all five
 *   in dev, `['warn', 'error']` in production.
 * - `prefix`: optional string prepended to every message as `[prefix] …`.
 */
interface LoggerConfig {
  isDevelopment: boolean
  enabledLevels: LogLevel[]
  prefix?: string
}

/**
 * Lightweight structured logger that wraps the browser console.
 *
 * Instantiate directly for custom loggers, or use the pre-built module-level
 * instances (`logger`, `graphLogger`, `searchLogger`, `routeLogger`).
 * Create sub-scopes with `.scope(prefix)` to add a namespacing prefix without
 * creating a fully independent config.
 */
class Logger {
  private config: LoggerConfig

  constructor(config?: Partial<LoggerConfig>) {
    const envIsDevelopment = Boolean((import.meta as { env: Record<string, string> }).env.DEV)
    const isDevelopment = config?.isDevelopment ?? envIsDevelopment

    this.config = {
      isDevelopment,
      enabledLevels:
        config?.enabledLevels ??
        (isDevelopment
          ? ['log', 'info', 'warn', 'error', 'debug'] // All levels in dev
          : ['warn', 'error']), // Only warnings and errors in production
      prefix: config?.prefix,
    }
  }

  /** Returns `true` if `level` is in `enabledLevels`. */
  private shouldLog(level: LogLevel): boolean {
    return this.config.enabledLevels.includes(level)
  }

  /** Prepend `[prefix]` when a prefix is configured. */
  private formatMessage(message: string): string {
    return this.config.prefix ? `[${this.config.prefix}] ${message}` : message
  }

  /** `console.log` — filtered out in production. */
  log(message: string, ...args: unknown[]): void {
    if (this.shouldLog('log')) {
      console.log(this.formatMessage(message), ...args)
    }
  }

  /** `console.info` — filtered out in production. */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage(message), ...args)
    }
  }

  /** `console.warn` — active in both dev and production. */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage(message), ...args)
    }
  }

  /** `console.error` — active in both dev and production. */
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage(message), ...args)
    }
  }

  /** `console.debug` — filtered out in production. */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage(message), ...args)
    }
  }

  /**
   * Log a performance timing (development only).
   *
   * Requires a runtime that provides the global `performance` API. The client
   * calls it only in browser code.
   *
   * @param label  Human-readable label for the timed operation.
   * @param startTime  Value returned by `performance.now()` before the operation.
   */
  perf(label: string, startTime: number): void {
    if (this.config.isDevelopment) {
      const duration = performance.now() - startTime
      console.log(this.formatMessage(`[perf] ${label}: ${duration.toFixed(2)}ms`))
    }
  }

  /**
   * Create a child logger that inherits this instance's config but prepends
   * an additional `prefix` segment (`parentPrefix:childPrefix`).
   *
   * @example
   * const graphLogger = logger.scope('Graph')
   * // logs as "[Graph] …"
   * const subLogger = graphLogger.scope('Build')
   * // logs as "[Graph:Build] …"
   */
  scope(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix,
    })
  }
}

/** Default general-purpose logger. */
export const logger = new Logger()

/** Scoped logger for visibility-graph and routing graph operations. */
export const graphLogger = logger.scope('Graph')
/** Scoped logger for search/autocomplete operations. */
export const searchLogger = logger.scope('Search')
/** Scoped logger for A* pathfinding and route display operations. */
export const routeLogger = logger.scope('Route')

// Export Logger class for custom instances
export { Logger }
