/** Search autocomplete and recent-search UI controller. */

import { FEATURED_ROOMS, SEARCH_CONFIG } from '../config/featured'
import {
  findExactMatch,
  getCategoryIcon,
  getCategoryLabel,
  inferCategory,
  rankWithRecency,
  searchNodes,
} from '../utils/search'
import {
  clearRecentSearches,
  getFrequentRooms,
  getRecentSearches,
  removeRecentSearch,
  trackSearch,
} from '../utils/storage'
import type { Node, SearchResult } from '../utils/types'
import { state } from './map-state'

type SearchType = 'start' | 'end'
let resultId = 0

function inputFor(type: SearchType): HTMLInputElement | null {
  return document.getElementById(
    type === 'start' ? 'start-input' : 'end-input'
  ) as HTMLInputElement | null
}

function setSelected(type: SearchType, node: Node, label?: string): void {
  const input = inputFor(type)
  if (!input) return
  input.value = label ?? node.rooms.find((room) => room !== 'waypoint') ?? node.uid
  if (type === 'start') state.selectedStartNode = node
  else state.selectedEndNode = node
}

function hide(dropdown: HTMLElement): void {
  dropdown.style.display = 'none'
  const list = dropdown.querySelector<HTMLElement>('[data-results-list]')
  const input = list?.id
    ? document.querySelector<HTMLInputElement>(`[aria-controls="${list.id}"]`)
    : null
  input?.setAttribute('aria-expanded', 'false')
  input?.removeAttribute('aria-activedescendant')
}

function renderResults(results: SearchResult[], dropdown: HTMLElement, type: SearchType): void {
  const list = dropdown.querySelector<HTMLElement>('[data-results-list]')
  if (!list) return
  list.textContent = ''
  if (results.length === 0) {
    list.textContent = 'No rooms found. Try a different search.'
    list.className = 'search-empty'
    return
  }
  list.className = 'search-results scrollbar-thin'
  for (const result of results) {
    const label =
      (result.matches.length > 0 ? result.matches[0] : undefined) ??
      result.node.rooms.find((room) => room !== 'waypoint') ??
      result.node.uid
    const row = document.createElement('div')
    row.className = 'search-result-row'
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'search-result-item'
    option.id = `search-result-${++resultId}`
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', 'false')
    const icon = document.createElement('span')
    icon.className = 'result-icon'
    icon.textContent = getCategoryIcon(result.node.category ?? inferCategory(result.node))
    const content = document.createElement('div')
    content.className = 'result-content'
    const primary = document.createElement('div')
    primary.className = 'result-primary'
    primary.textContent = label
    const secondary = document.createElement('div')
    secondary.className = 'result-secondary'
    secondary.textContent = `${getCategoryLabel(result.node.category ?? inferCategory(result.node))}${result.node.floor ? ` • Floor ${result.node.floor}` : ''}`
    content.append(primary, secondary)
    option.addEventListener('click', () => {
      setSelected(type, result.node, label)
      hide(dropdown)
    })
    option.append(icon, content)
    row.appendChild(option)
    list.appendChild(row)
  }
}

function showSuggestions(dropdown: HTMLElement, type: SearchType): void {
  const rooms = FEATURED_ROOMS.map((room) => findExactMatch(room, state.allNodesAllFloors)).filter(
    (node): node is Node => Boolean(node)
  )
  renderResults(
    rooms.map((node) => ({ node, score: 0, matches: [node.rooms[0]] })),
    dropdown,
    type
  )
}

function setupInput(type: SearchType): () => void {
  const input = inputFor(type)
  const wrapper = document.querySelector(
    type === 'start' ? '#start-dropdown-wrapper' : '#end-dropdown-wrapper'
  )
  const dropdown = wrapper?.querySelector<HTMLElement>('[data-dropdown-container]')
  if (!input || !dropdown) return () => undefined
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const update = (): void => {
    activeIndex = -1
    const query = input.value.trim()
    dropdown.style.display = 'block'
    input.setAttribute('aria-expanded', 'true')
    if (!query) {
      showSuggestions(dropdown, type)
      return
    }
    if (query.length < SEARCH_CONFIG.MIN_QUERY_LENGTH) return
    const results = rankWithRecency(
      searchNodes(query, state.allNodesAllFloors, { limit: SEARCH_CONFIG.MAX_RESULTS }),
      getFrequentRooms()
    ).filter(
      (result) =>
        result.node.type === 'room' ||
        (!result.node.type && !result.node.rooms.includes('waypoint'))
    )
    trackSearch(query, results.length)
    state.currentSearchResults = results
    renderResults(results, dropdown, type)
  }
  input.addEventListener(
    'input',
    () => {
      if (type === 'start') state.selectedStartNode = null
      else state.selectedEndNode = null
      if (timer) clearTimeout(timer)
      timer = setTimeout(update, SEARCH_CONFIG.DEBOUNCE_MS)
    },
    { signal: controller.signal }
  )
  input.addEventListener(
    'focus',
    () => {
      state.activeDropdown = type
      update()
    },
    { signal: controller.signal }
  )
  let activeIndex = -1
  const applyActiveIndex = (): void => {
    const options = [...dropdown.querySelectorAll<HTMLElement>('[role="option"]')]
    options.forEach((option, index) => {
      const active = index === activeIndex
      option.classList.toggle('active', active)
      option.setAttribute('aria-selected', String(active))
    })
    if (activeIndex >= 0 && activeIndex < options.length) {
      const active = options[activeIndex]
      input.setAttribute('aria-activedescendant', active.id)
      active.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }
  input.addEventListener(
    'keydown',
    (event) => {
      const options = [...dropdown.querySelectorAll<HTMLElement>('[role="option"]')]
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        activeIndex = Math.min(activeIndex + 1, options.length - 1)
        applyActiveIndex()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        activeIndex = activeIndex <= 0 ? options.length - 1 : activeIndex - 1
        applyActiveIndex()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        state.activeDropdown = null
        hide(dropdown)
      } else if (event.key === 'Enter' && options[activeIndex >= 0 ? activeIndex : 0]) {
        event.preventDefault()
        options[activeIndex >= 0 ? activeIndex : 0].click()
      } else activeIndex = -1
    },
    { signal: controller.signal }
  )
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Node) || (!input.contains(target) && !dropdown.contains(target)))
        hide(dropdown)
    },
    { signal: controller.signal }
  )
  return () => {
    controller.abort()
    if (timer) clearTimeout(timer)
  }
}

/** Re-render recent routes and wire selection back to the route controller. */
export function updateRecentSearchesUI(onRouteRequested: () => void): void {
  const list = document.getElementById('recent-list')
  const toggle = document.getElementById('recent-toggle-btn')
  const clear = document.getElementById('clear-recent-btn')
  if (!list) return
  const recent = getRecentSearches()
  toggle?.classList.toggle('has-items', recent.length > 0)
  list.textContent = ''
  for (const entry of recent) {
    const item = document.createElement('div')
    item.className = 'recent-item'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'recent-select'
    button.setAttribute('aria-label', `Route from ${entry.from} to ${entry.to}`)
    button.textContent = `${entry.from} → ${entry.to}`
    button.addEventListener('click', () => {
      const start = inputFor('start')
      const end = inputFor('end')
      if (!start || !end) return
      start.value = entry.from
      end.value = entry.to
      state.selectedStartNode = null
      state.selectedEndNode = null
      onRouteRequested()
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'recent-delete'
    remove.textContent = '×'
    remove.setAttribute('aria-label', `Delete route from ${entry.from} to ${entry.to}`)
    remove.addEventListener('click', () => {
      removeRecentSearch(entry.from, entry.to)
      updateRecentSearchesUI(onRouteRequested)
    })
    item.append(button, remove)
    list.appendChild(item)
  }
  if (clear)
    clear.onclick = () => {
      clearRecentSearches()
      updateRecentSearchesUI(onRouteRequested)
    }
}

/** Initialize autocomplete, recent-search rendering, and its disclosure button. */
export function setupSearchUI(onRouteRequested: () => void): { cleanup: () => void } {
  const cleanups = [setupInput('start'), setupInput('end')]
  updateRecentSearchesUI(onRouteRequested)
  const toggle = document.getElementById('recent-toggle-btn')
  const dropdown = document.getElementById('recent-dropdown')
  const controller = new AbortController()
  toggle?.addEventListener(
    'click',
    () => {
      if (!dropdown) return
      const open = dropdown.style.display !== 'none'
      dropdown.style.display = open ? 'none' : 'block'
      toggle.classList.toggle('active', !open)
    },
    { signal: controller.signal }
  )
  return {
    cleanup: () => {
      controller.abort()
      cleanups.forEach((cleanup) => cleanup())
    },
  }
}
