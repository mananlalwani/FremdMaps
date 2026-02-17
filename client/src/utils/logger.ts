/**
 * Logging utility with development/production modes
 * In production, reduces console noise by filtering log levels
 */

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

interface LoggerConfig {
  isDevelopment: boolean;
  enabledLevels: LogLevel[];
  prefix?: string;
}

class Logger {
  private config: LoggerConfig;

  constructor(config?: Partial<LoggerConfig>) {
    const isDev = import.meta.env.DEV ?? true;
    
    this.config = {
      isDevelopment: isDev,
      enabledLevels: isDev 
        ? ['log', 'info', 'warn', 'error', 'debug'] // All levels in dev
        : ['warn', 'error'], // Only warnings and errors in production
      prefix: config?.prefix,
      ...config
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return this.config.enabledLevels.includes(level);
  }

  private formatMessage(message: string): string {
    return this.config.prefix ? `[${this.config.prefix}] ${message}` : message;
  }

  log(message: string, ...args: any[]): void {
    if (this.shouldLog('log')) {
      console.log(this.formatMessage(message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage(message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage(message), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage(message), ...args);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage(message), ...args);
    }
  }

  /**
   * Log performance metric (only in development)
   */
  perf(label: string, startTime: number): void {
    if (this.config.isDevelopment) {
      const duration = performance.now() - startTime;
      console.log(this.formatMessage(`⚡ ${label}: ${duration.toFixed(2)}ms`));
    }
  }

  /**
   * Create a scoped logger with a prefix
   */
  scope(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix
    });
  }
}

// Default logger instance
export const logger = new Logger();

// Specialized loggers for different modules
export const graphLogger = logger.scope('Graph');
export const searchLogger = logger.scope('Search');
export const routeLogger = logger.scope('Route');
export const workerLogger = logger.scope('Worker');

// Export Logger class for custom instances
export { Logger };
