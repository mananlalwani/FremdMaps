// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { setupScheduleModal } from './schedule-ui'
import { state } from './map-state'

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  state.allNodesAllFloors = []
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

  it('suggests matching rooms and selects the active suggestion from the keyboard', () => {
    document.body.innerHTML = `
      <main id="map"></main><section id="floor-switcher"></section><aside id="multi-floor-banner"></aside><section id="nav-panel"></section>
      <button id="schedule-btn">Schedule</button>
      <section id="schedule-modal" style="display:none"><button id="schedule-close-btn">Close</button></section>
      <section id="schedule-view-paths"></section><section id="schedule-view-edit"></section>
      <button id="schedule-edit-close-btn"></button><button id="schedule-edit-btn">Edit</button>
      <button id="schedule-back-btn"></button><button id="schedule-save-btn"></button>
      <div id="schedule-periods-list"></div><div id="schedule-paths-list"></div>
    `
    state.allNodesAllFloors = [
      {
        uid: 'room-129',
        rooms: ['129'],
        lat: 0,
        lng: 0,
        floor: '1',
        type: 'room',
      },
    ]
    setupScheduleModal(() => null)
    ;(document.getElementById('schedule-btn') as HTMLButtonElement).click()
    ;(document.getElementById('schedule-edit-btn') as HTMLButtonElement).click()

    const input = document.querySelector<HTMLInputElement>('.schedule-period-input')!
    input.value = '12'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="option"]')?.textContent).toBe('129')

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(input.value).toBe('129')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })
})
