// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../utils/i18n'
import { setupPanelBehavior } from './panel-behavior'

afterEach(() => {
  setLocale('en')
  document.body.innerHTML = ''
})

describe('setupPanelBehavior', () => {
  it('expands from the handle and collapses when a route is displayed on mobile', () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    document.body.innerHTML = `
      <section id="nav-panel"><div class="panel-header"></div></section>
      <button id="panel-handle" aria-expanded="false"><span id="panel-handle-label"></span></button>
    `

    const { collapseForRoute } = setupPanelBehavior()
    const panel = document.getElementById('nav-panel')!
    const handle = document.getElementById('panel-handle')!

    handle.click()
    expect(panel.classList.contains('panel-expanded')).toBe(true)
    expect(handle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('panel-handle-label')?.textContent).toBe('Tap to collapse')

    collapseForRoute()
    expect(panel.classList.contains('panel-minimized')).toBe(true)
    expect(handle.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById('panel-handle-label')?.textContent).toBe('Tap to open')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  it('removes its click handlers during cleanup', () => {
    document.body.innerHTML = `
      <section id="nav-panel"><div class="panel-header"></div></section>
      <button id="panel-handle" aria-expanded="false"></button>
    `
    const behavior = setupPanelBehavior()
    const panel = document.getElementById('nav-panel')!
    const handle = document.getElementById('panel-handle')!
    behavior.cleanup()
    handle.click()
    expect(panel.classList.contains('panel-expanded')).toBe(false)
  })

  it('updates the handle copy when the language changes', () => {
    document.body.innerHTML = `
      <section id="nav-panel"><div class="panel-header"></div></section>
      <button id="panel-handle" aria-expanded="false"><span id="panel-handle-label"></span></button>
    `
    setupPanelBehavior()
    setLocale('es')

    expect(document.getElementById('panel-handle-label')?.textContent).toBe('Toca para expandir')
  })
})
