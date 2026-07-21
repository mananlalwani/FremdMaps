// @vitest-environment jsdom
/**
 * Tests for route-display module.
 * Covers generateDirections DOM output, direction step rendering,
 * escaping, bearing helpers, and angle calculations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Node } from '../utils/types'

// Import the module to test
import { generateDirections, clearRoute, escapeHtml } from './route-display'
import { state } from './map-state'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(uid: string, rooms: string[], opts: Partial<Node> = {}): Node {
  return { uid, lat: 0, lng: 0, rooms, type: 'room', floor: '2', ...opts }
}

// ---------------------------------------------------------------------------
// generateDirections
// ---------------------------------------------------------------------------

describe('generateDirections', () => {
  beforeEach(() => {
    // Set up the DOM element generateDirections writes into
    const list = document.createElement('ol')
    list.id = 'directions-list'
    document.body.appendChild(list)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders start and end steps for a two-node path', () => {
    const path = [
      makeNode('A', ['Room 201'], { floor: '2', lat: 0, lng: 0 }),
      makeNode('B', ['Room 202'], { floor: '2', lat: 0, lng: 100 }),
    ]
    generateDirections(path, '2')

    const list = document.getElementById('directions-list')
    expect(list).not.toBeNull()
    const steps = list!.querySelectorAll('.direction-step')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toContain('Start at')
    expect(steps[1].textContent).toContain('Continue straight')
    expect(steps[1].querySelector('.direction-step-icon.walk')).not.toBeNull()
    expect(steps[steps.length - 1].textContent).toContain('Arrive at')
  })

  it('renders a walk step between start and end for a three-node path', () => {
    const path = [
      makeNode('A', ['Start'], { floor: '2', lat: 0, lng: 0 }),
      makeNode('W1', ['waypoint'], { type: 'waypoint', floor: '2', lat: 0, lng: 100 }),
      makeNode('B', ['End'], { floor: '2', lat: 0, lng: 200 }),
    ]
    generateDirections(path, '2')

    const list = document.getElementById('directions-list')
    const walkSteps = list!.querySelectorAll('.direction-step-icon.walk')
    expect(walkSteps.length).toBeGreaterThanOrEqual(1)
  })

  it('renders a stair step when path contains a stairway node', () => {
    const path = [
      makeNode('A', ['Room 201'], { floor: '1' }),
      makeNode('S', ['Stair A'], { type: 'stairway', floor: '1', connectsTo: ['Stair A'] }),
      makeNode('B', ['Room 301'], { floor: '2' }),
    ]
    generateDirections(path, '1')

    const list = document.getElementById('directions-list')
    const stairIcons = list!.querySelectorAll('.direction-step-icon.stair')
    expect(stairIcons.length).toBeGreaterThanOrEqual(1)
    expect(list!.textContent).toContain('Floor 2')
  })

  it('marks steps on the active floor as active', () => {
    const path = [
      makeNode('A', ['Room 201'], { floor: '1' }),
      makeNode('S', ['Stair A'], { type: 'stairway', floor: '1', connectsTo: ['Stair A'] }),
      makeNode('B', ['Room 301'], { floor: '2' }),
    ]
    generateDirections(path, '1')

    const list = document.getElementById('directions-list')
    const activeSteps = list!.querySelectorAll('.direction-step.active')
    expect(activeSteps.length).toBeGreaterThan(0)
  })

  it('renders floor badges on steps', () => {
    const path = [
      makeNode('A', ['Room 201'], { floor: '1' }),
      makeNode('B', ['Room 202'], { floor: '1' }),
    ]
    generateDirections(path, '1')

    const list = document.getElementById('directions-list')
    const badges = list!.querySelectorAll('.direction-step-floor')
    expect(badges.length).toBeGreaterThan(0)
    expect(badges[0].textContent).toBe('F1')
  })

  it('handles empty path gracefully', () => {
    expect(() => generateDirections([], '2')).not.toThrow()
    const list = document.getElementById('directions-list')
    expect(list!.children.length).toBe(0)
  })

  it('handles null directions-list gracefully', () => {
    document.body.innerHTML = ''
    expect(() => generateDirections([makeNode('A', ['Test'])], '2')).not.toThrow()
  })
})
describe('clearRoute', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="route-status" style="display: block;"></div>
      <div id="directions-list"></div>
    `
    state.map = { removeLayer: vi.fn() } as unknown as typeof state.map
    state.currentRoute = null
    state.routeMarkers = []
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('hides route status and clears directions list', () => {
    clearRoute()
    const routeStatus = document.getElementById('route-status')
    const directionsList = document.getElementById('directions-list')
    expect(routeStatus!.classList.contains('hiding')).toBe(true)
    expect(directionsList!.children.length).toBe(0)
    expect(routeStatus!.style.display).toBe('block')
    routeStatus!.dispatchEvent(new Event('animationend'))
    expect(routeStatus!.style.display).toBe('none')
  })

  it('does not throw when DOM elements are missing', () => {
    document.body.innerHTML = ''
    expect(() => clearRoute()).not.toThrow()
  })

  it('does not throw when map is null', () => {
    state.map = null
    expect(() => clearRoute()).not.toThrow()
  })
})

// ── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes < to &lt;', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes > to &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes " to &quot;', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;')
  })

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})
