/**
 * Floor-plan images and navigation JSON in client/public/data/ are served as
 * public static assets with no access restriction. This is an explicit
 * operational decision: the school floor plans are considered non-sensitive
 * and the navigation feature requires unauthenticated access for visitors.
 * Revisit this decision if the school's physical-security posture changes.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)

    if (!headers.has('X-Content-Type-Options')) {
      headers.set('X-Content-Type-Options', 'nosniff')
    }
    if (!headers.has('X-Frame-Options')) {
      headers.set('X-Frame-Options', 'DENY')
    }
    if (!headers.has('Referrer-Policy')) {
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    }
    if (!headers.has('Permissions-Policy')) {
      headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
    }
    if (request.url.startsWith('https://') && !headers.has('Strict-Transport-Security')) {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    if (!headers.has('Content-Security-Policy')) {
      headers.set(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data:",
          "connect-src 'self'",
          "manifest-src 'self'",
        ].join('; ')
      )
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
}

interface Env {
  ASSETS: Fetcher
}
