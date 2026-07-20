// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { applyTranslations, getLocale, setLocale, t } from './i18n'

afterEach(() => {
  setLocale('en')
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('i18n', () => {
  it('uses English by default and interpolates values', () => {
    setLocale('en')

    expect(getLocale()).toBe('en')
    expect(t('direction.takeStairs', { floor: 2 })).toBe('Take the stairs to Floor 2')
  })

  it('updates text, placeholders, and accessible names in Spanish', () => {
    document.body.innerHTML = `
      <p data-i18n="route.follow">Follow the amber path on the map</p>
      <input data-i18n-placeholder="search.placeholder" data-i18n-aria-label="search.start">
      <button data-i18n-title="panel.recent"></button>
    `
    setLocale('es')
    applyTranslations()

    expect(document.documentElement.lang).toBe('es')
    expect(document.querySelector('p')?.textContent).toBe('Sigue la ruta ámbar en el mapa')
    const input = document.querySelector('input')
    expect(input?.placeholder).toBe('Número o nombre del salón')
    expect(input?.getAttribute('aria-label')).toBe('Origen')
    expect(document.querySelector('button')?.title).toBe('Búsquedas recientes')
  })
})
