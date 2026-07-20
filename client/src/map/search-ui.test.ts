// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { state } from './map-state'
import { setupSearchUI } from './search-ui'

afterEach(() => {
  document.body.innerHTML = ''
  state.allNodesAllFloors = []
  state.selectedStartNode = null
})

describe('setupSearchUI', () => {
  it('selects the keyboard-active autocomplete option', () => {
    state.allNodesAllFloors = [
      { uid: 'room-1', lat: -10, lng: 10, rooms: ['101'], type: 'room', floor: '1' },
    ]
    document.body.innerHTML = `
      <div id="start-dropdown-wrapper"><input id="start-input"><div data-dropdown-container><div id="start-results" data-results-list></div></div></div>
      <div id="end-dropdown-wrapper"><input id="end-input"><div data-dropdown-container><div id="end-results" data-results-list></div></div></div>
      <button id="recent-toggle-btn"></button><div id="recent-dropdown"></div><div id="recent-list"></div><button id="clear-recent-btn"></button>
    `
    setupSearchUI(() => undefined)
    const input = document.getElementById('start-input') as HTMLInputElement
    HTMLElement.prototype.scrollIntoView = () => undefined
    input.value = '101'
    input.dispatchEvent(new FocusEvent('focus'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(state.selectedStartNode?.uid).toBe('room-1')
    expect(input.value).toBe('101')
  })
})
