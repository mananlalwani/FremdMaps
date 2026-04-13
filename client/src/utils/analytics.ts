import type { AnalyticsEvent, AnalyticsEventName, AnalyticsMetaValue } from './types'
import { logger } from './logger'

type AnalyticsEnv = Record<string, string | undefined>

type GtagCommand = 'js' | 'config' | 'event'
type Gtag = (command: GtagCommand, target: string | Date, params?: Record<string, AnalyticsMetaValue>) => void

interface AnalyticsWindow extends Window {
  dataLayer?: unknown[]
  gtag?: Gtag
}

let gaInitialized = false

function getEnv(): AnalyticsEnv {
  return (import.meta as { env: AnalyticsEnv }).env
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = getEnv()[name]
  if (raw === 'true') return true
  if (raw === 'false') return false
  return defaultValue
}

function getEndpoint(): string {
  return (getEnv().PUBLIC_ANALYTICS_ENDPOINT || '').trim()
}

function getGaMeasurementId(): string {
  return (getEnv().PUBLIC_GA_MEASUREMENT_ID || '').trim()
}

function isDoNotTrackEnabled(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.doNotTrack === '1'
}

function shouldTrackByDefault(): boolean {
  const measurementId = getGaMeasurementId()
  if (measurementId.length > 0) return true
  return readBooleanEnv('PUBLIC_ANALYTICS_ENABLED', false)
}

function resolveAppVersion(): string {
  const envVersion = (getEnv().PUBLIC_APP_VERSION || '').trim()
  return envVersion || 'unknown'
}

function buildEvent(
  event: AnalyticsEventName,
  meta?: Record<string, AnalyticsMetaValue>,
  floor?: number
): AnalyticsEvent {
  const payload: AnalyticsEvent = {
    event,
    ts: new Date().toISOString(),
    appVersion: resolveAppVersion(),
  }

  if (typeof floor === 'number' && Number.isFinite(floor)) {
    payload.floor = Math.round(floor)
  }

  if (meta && Object.keys(meta).length > 0) {
    payload.meta = meta
  }

  return payload
}

function postEvent(payload: AnalyticsEvent): void {
  const endpoint = getEndpoint()
  if (!endpoint) return

  const body = JSON.stringify(payload)

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon(endpoint, blob)) {
      return
    }
  }

  void fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(err => {
    logger.warn('Analytics delivery failed', err)
  })
}

function ensureGoogleAnalyticsInitialized(): boolean {
  const measurementId = getGaMeasurementId()
  if (!measurementId) return false
  if (typeof window === 'undefined' || typeof document === 'undefined') return false

  const analyticsWindow = window as AnalyticsWindow

  if (!gaInitialized) {
    analyticsWindow.dataLayer = analyticsWindow.dataLayer || []
    analyticsWindow.gtag = analyticsWindow.gtag || function gtagShim(...args: unknown[]): void {
      analyticsWindow.dataLayer?.push(args)
    }

    const scriptId = 'ga4-gtag-loader'
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script')
      script.id = scriptId
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
      document.head.appendChild(script)
    }

    analyticsWindow.gtag('js', new Date())
    analyticsWindow.gtag('config', measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      send_page_view: false,
    })

    if (import.meta.env.DEV) {
      logger.info(`Google Analytics initialized with ${measurementId}`)
    }

    gaInitialized = true
  }

  return typeof analyticsWindow.gtag === 'function'
}

function sendGoogleAnalyticsEvent(payload: AnalyticsEvent): void {
  if (!ensureGoogleAnalyticsInitialized()) return

  const analyticsWindow = window as AnalyticsWindow
  const params: Record<string, AnalyticsMetaValue> = {
    app_version: payload.appVersion,
  }

  if (typeof payload.floor === 'number') {
    params.floor = payload.floor
  }

  if (payload.meta) {
    for (const [key, value] of Object.entries(payload.meta)) {
      params[key] = value
    }
  }

  analyticsWindow.gtag?.('event', payload.event, params)
}

export function isAnalyticsEnabled(): boolean {
  const enabled = shouldTrackByDefault()
  if (!enabled) return false
  if (isDoNotTrackEnabled()) return false

  return true
}

export function setAnalyticsOptIn(enabled: boolean): void {
  logger.info(`Analytics preference API called with ${String(enabled)}; using automatic opt-in`) 
}

export function getAnalyticsOptIn(): boolean {
  return true
}

export function trackAnalyticsEvent(
  event: AnalyticsEventName,
  meta?: Record<string, AnalyticsMetaValue>,
  floor?: number
): void {
  if (!isAnalyticsEnabled()) return
  const payload = buildEvent(event, meta, floor)

  sendGoogleAnalyticsEvent(payload)
  postEvent(payload)
}
