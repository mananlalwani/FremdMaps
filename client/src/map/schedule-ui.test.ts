// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { setupScheduleModal } from './schedule-ui'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('setupScheduleModal', () => {
  it('makes the background inert and restores focus when Escape closes it', () => {
    document.body.innerHTML = `
      <main id="map"></main><section id="floor-switcher"></section><aside id="multi-floor-banner"></aside><section id="nav-panel"></section>
      <button id="schedule-btn">Schedule</button>
      <section id="schedule-modal" style="display:none"><button id="schedule-close-btn">Close</button></section>
      <section id="schedule-view-paths"></section><section id="schedule-view-edit"></section>
      <button id="schedule-edit-close-btn"></button><button id="schedule-edit-btn"></button>
      <button id="schedule-back-btn"></button><button id="schedule-save-btn"></button>
      <div id="schedule-periods-list"></div><div id="schedule-paths-list"></div>
    `
    setupScheduleModal(() => null)
    const trigger = document.getElementById('schedule-btn') as HTMLButtonElement
    const modal = document.getElementById('schedule-modal')!
    trigger.click()

    expect(modal.style.display).toBe('block')
    expect((document.getElementById('map') as HTMLElement).inert).toBe(true)
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(modal.style.display).toBe('none')
    expect((document.getElementById('map') as HTMLElement).inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })
})
