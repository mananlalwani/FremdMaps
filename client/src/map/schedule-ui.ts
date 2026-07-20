/** Schedule modal controller. Owns schedule rendering, focus management, and room suggestions. */

import { findPath } from '../utils/pathfinding'
import { findExactMatch, searchNodes } from '../utils/search'
import { getSchedule, saveSchedule } from '../utils/storage'
import type { Graph, Node, ScheduleEntry } from '../utils/types'
import { state } from './map-state'
import { displayRoute } from './route-display'

type ScheduleView = 'paths' | 'edit'

let getGraph: () => Graph | null = () => null
let triggerElement: HTMLElement | null = null
let focusController: AbortController | null = null
let setupController: AbortController | null = null
let scheduleDropdown: HTMLElement | null = null
let scheduleDropdownInput: HTMLInputElement | null = null
let scheduleSuggestions: Array<{ node: Node; label: string }> = []
let activeSuggestionIndex = -1

function modalElements(): { modal: HTMLElement; paths: HTMLElement; edit: HTMLElement } | null {
  const modal = document.getElementById('schedule-modal')
  const paths = document.getElementById('schedule-view-paths')
  const edit = document.getElementById('schedule-view-edit')
  return modal && paths && edit ? { modal, paths, edit } : null
}

function setBackgroundInert(isInert: boolean): void {
  for (const id of ['map', 'floor-switcher', 'multi-floor-banner', 'nav-panel']) {
    const element = document.getElementById(id)
    if (!element) continue
    element.inert = isInert
    element.toggleAttribute('aria-hidden', isInert)
  }
}

function clearScheduleDropdown(): void {
  scheduleDropdown?.remove()
  if (scheduleDropdownInput) {
    scheduleDropdownInput.setAttribute('aria-expanded', 'false')
    scheduleDropdownInput.removeAttribute('aria-activedescendant')
    scheduleDropdownInput.removeAttribute('aria-controls')
  }
  scheduleDropdown = null
  scheduleDropdownInput = null
  scheduleSuggestions = []
  activeSuggestionIndex = -1
}

function preferredRoomLabel(node: Node, query: string): string {
  const normalizedQuery = query.trim().toLowerCase()
  return (
    node.rooms.find((room) => room.trim().toLowerCase() === normalizedQuery) ??
    node.rooms.find((room) => room.trim().toLowerCase().includes(normalizedQuery)) ??
    node.rooms.find((room) => room.trim().toLowerCase() !== 'waypoint') ??
    node.rooms[0]
  )
}

function positionScheduleDropdown(input: HTMLInputElement): void {
  if (!scheduleDropdown) return
  const bounds = input.getBoundingClientRect()
  scheduleDropdown.style.left = `${bounds.left}px`
  scheduleDropdown.style.top = `${bounds.bottom + 6}px`
  scheduleDropdown.style.width = `${bounds.width}px`
}

function updateActiveSuggestion(): void {
  if (!scheduleDropdown || !scheduleDropdownInput) return
  const options = scheduleDropdown.querySelectorAll<HTMLElement>('[role="option"]')
  for (const [index, option] of options.entries()) {
    const isActive = index === activeSuggestionIndex
    option.classList.toggle('is-active', isActive)
    option.setAttribute('aria-selected', String(isActive))
  }
  if (activeSuggestionIndex < 0) {
    scheduleDropdownInput.removeAttribute('aria-activedescendant')
    return
  }
  scheduleDropdownInput.setAttribute(
    'aria-activedescendant',
    `schedule-room-option-${scheduleDropdownInput.dataset.period}-${activeSuggestionIndex}`
  )
}

function selectScheduleSuggestion(input: HTMLInputElement, label: string): void {
  input.value = label
  clearScheduleDropdown()
}

function showScheduleSuggestions(input: HTMLInputElement): void {
  const query = input.value.trim()
  clearScheduleDropdown()
  if (!query || state.allNodesAllFloors.length === 0) return

  const uniqueSuggestions = new Map<string, { node: Node; label: string }>()
  for (const result of searchNodes(query, state.allNodesAllFloors, { limit: 8 })) {
    const label = preferredRoomLabel(result.node, query)
    if (!uniqueSuggestions.has(label.toLowerCase())) {
      uniqueSuggestions.set(label.toLowerCase(), { node: result.node, label })
    }
  }
  scheduleSuggestions = [...uniqueSuggestions.values()].slice(0, 6)
  if (scheduleSuggestions.length === 0) return

  const dropdown = document.createElement('div')
  dropdown.className = 'schedule-period-dropdown scrollbar-thin'
  dropdown.id = `schedule-room-results-${input.dataset.period}`
  dropdown.setAttribute('role', 'listbox')
  dropdown.setAttribute('aria-label', `Room suggestions for period ${input.dataset.period}`)
  scheduleDropdown = dropdown
  scheduleDropdownInput = input

  for (const [index, suggestion] of scheduleSuggestions.entries()) {
    const option = document.createElement('button')
    option.type = 'button'
    option.id = `schedule-room-option-${input.dataset.period}-${index}`
    option.className = 'schedule-period-dropdown-item'
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', 'false')
    option.textContent = suggestion.label
    option.addEventListener('pointerdown', (event) => event.preventDefault())
    option.addEventListener('click', () => selectScheduleSuggestion(input, suggestion.label))
    dropdown.appendChild(option)
  }

  document.body.appendChild(dropdown)
  input.setAttribute('aria-controls', dropdown.id)
  input.setAttribute('aria-expanded', 'true')
  positionScheduleDropdown(input)
}

function setupScheduleAutocomplete(input: HTMLInputElement): void {
  input.addEventListener('input', () => showScheduleSuggestions(input))
  input.addEventListener('focus', () => showScheduleSuggestions(input))
  input.addEventListener('blur', clearScheduleDropdown)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearScheduleDropdown()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!scheduleDropdown || scheduleDropdownInput !== input) showScheduleSuggestions(input)
      if (scheduleSuggestions.length === 0) return
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      activeSuggestionIndex =
        (activeSuggestionIndex + direction + scheduleSuggestions.length) %
        scheduleSuggestions.length
      updateActiveSuggestion()
      return
    }
    if (event.key === 'Enter' && activeSuggestionIndex >= 0 && scheduleDropdownInput === input) {
      event.preventDefault()
      const suggestion = scheduleSuggestions[activeSuggestionIndex]
      selectScheduleSuggestion(input, suggestion.label)
    }
  })
}

function showView(view: ScheduleView): void {
  const elements = modalElements()
  if (!elements) return
  clearScheduleDropdown()
  const isPaths = view === 'paths'
  elements.paths.style.display = isPaths ? 'block' : 'none'
  elements.edit.style.display = isPaths ? 'none' : 'block'
  if (isPaths) renderPaths()
  else renderPeriods()
}

function closeModal(): void {
  const elements = modalElements()
  if (!elements) return
  clearScheduleDropdown()
  setBackgroundInert(false)
  elements.modal.style.display = 'none'
  focusController?.abort()
  focusController = null
  triggerElement?.focus()
  triggerElement = null
}

function trapFocus(modal: HTMLElement): void {
  focusController?.abort()
  focusController = new AbortController()
  modal.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeModal()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...modal.querySelectorAll<HTMLElement>('button, input, [href]')].filter(
        (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    { signal: focusController.signal }
  )
}

function openModal(trigger: HTMLElement): void {
  const elements = modalElements()
  if (!elements) return
  triggerElement = trigger
  elements.modal.style.display = 'block'
  setBackgroundInert(true)
  trapFocus(elements.modal)
  showView('paths')
  requestAnimationFrame(() =>
    elements.modal.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  )
}

function collectPeriods(): ScheduleEntry[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>('.schedule-period-input[data-period]'),
  ].map((input) => ({ period: input.dataset.period ?? '', room: input.value.trim() }))
}

function saveAndShowPaths(): void {
  saveSchedule(collectPeriods())
  showView('paths')
}

function renderPeriods(): void {
  const list = document.getElementById('schedule-periods-list')
  if (!list) return
  list.textContent = ''
  for (const entry of getSchedule()) {
    const row = document.createElement('div')
    row.className = 'schedule-period-row'
    const label = document.createElement('label')
    label.className = 'schedule-period-label'
    label.textContent = `P${entry.period}`
    const input = document.createElement('input')
    input.className = 'schedule-period-input'
    input.type = 'text'
    input.value = entry.room
    input.placeholder = 'Search room or place'
    input.dataset.period = entry.period
    input.autocomplete = 'off'
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-expanded', 'false')
    input.setAttribute('aria-label', `Room for period ${entry.period}`)
    label.htmlFor = `schedule-period-${entry.period}`
    input.id = label.htmlFor
    setupScheduleAutocomplete(input)

    const navigate = document.createElement('button')
    navigate.type = 'button'
    navigate.className = 'schedule-period-nav-btn'
    navigate.textContent = '→'
    navigate.setAttribute('aria-label', `Use period ${entry.period} as destination`)
    navigate.addEventListener('click', () => {
      const room = input.value.trim()
      if (!room) return
      const endInput = document.getElementById('end-input') as HTMLInputElement | null
      if (endInput) {
        endInput.value = room
        state.selectedEndNode = null
      }
      closeModal()
    })

    row.append(label, input, navigate)
    list.appendChild(row)
  }
}

function appendPathMessage(text: string): void {
  const list = document.getElementById('schedule-paths-list')
  if (!list) return
  const message = document.createElement('p')
  message.className = 'schedule-empty-state'
  message.textContent = text
  list.appendChild(message)
}

function createPathHeader(from: ScheduleEntry, to: ScheduleEntry): HTMLElement {
  const header = document.createElement('div')
  header.className = 'schedule-path-header'
  for (const [text, className] of [
    [`P${from.period}`, 'schedule-path-period'],
    ['→', 'schedule-path-arrow'],
    [`P${to.period}`, 'schedule-path-period'],
  ]) {
    const element = document.createElement('span')
    element.className = className
    element.textContent = text
    header.appendChild(element)
  }
  return header
}

function renderPaths(): void {
  const list = document.getElementById('schedule-paths-list')
  if (!list) return
  list.textContent = ''
  const entries = getSchedule().filter((entry) => entry.room.trim() !== '')
  if (entries.length < 2) {
    appendPathMessage(
      entries.length === 0
        ? 'No rooms set yet. Tap Edit to add rooms to your schedule.'
        : 'Add at least 2 rooms to your schedule to see paths.'
    )
    return
  }

  for (let index = 0; index < entries.length - 1; index += 1) {
    const from = entries[index]
    const to = entries[index + 1]
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'schedule-path-item'
    item.appendChild(createPathHeader(from, to))
    const rooms = document.createElement('div')
    rooms.className = 'schedule-path-rooms'
    rooms.textContent = `${from.room} → ${to.room}`
    item.appendChild(rooms)

    const fromNode = findExactMatch(from.room, state.allNodesAllFloors)
    const toNode = findExactMatch(to.room, state.allNodesAllFloors)
    const graph = getGraph()
    if (!fromNode || !toNode || !graph) {
      item.disabled = true
      const reason = document.createElement('div')
      reason.className = 'schedule-path-notfound'
      reason.textContent = !graph ? 'Map is still loading' : 'Check the room name'
      item.title = reason.textContent
      item.appendChild(reason)
    } else {
      const result = findPath(fromNode.uid, toNode.uid, state.allNodesAllFloors, graph, {
        allowFloorTransitions: fromNode.floor !== toNode.floor,
      })
      if (!result.found) {
        item.disabled = true
        const reason = document.createElement('div')
        reason.className = 'schedule-path-notfound'
        reason.textContent = 'No route is available'
        item.appendChild(reason)
      } else {
        const meta = document.createElement('div')
        meta.className = 'schedule-path-meta'
        meta.textContent = 'Tap to view route'
        item.appendChild(meta)
        item.addEventListener('click', () => {
          closeModal()
          displayRoute(result.path, result.distance)
        })
      }
    }
    list.appendChild(item)
  }
}

/** Attach the schedule modal once after the navigation panel has rendered. */
export function setupScheduleModal(graphGetter: () => Graph | null): { cleanup: () => void } {
  setupController?.abort()
  setupController = new AbortController()
  const signal = setupController.signal
  getGraph = graphGetter
  const open = document.getElementById('schedule-btn')
  const close = document.getElementById('schedule-close-btn')
  const editClose = document.getElementById('schedule-edit-close-btn')
  const edit = document.getElementById('schedule-edit-btn')
  const back = document.getElementById('schedule-back-btn')
  const save = document.getElementById('schedule-save-btn')
  if (open) open.addEventListener('click', () => openModal(open), { signal })
  close?.addEventListener('click', closeModal, { signal })
  editClose?.addEventListener('click', closeModal, { signal })
  edit?.addEventListener('click', () => showView('edit'), { signal })
  back?.addEventListener('click', saveAndShowPaths, { signal })
  save?.addEventListener('click', saveAndShowPaths, { signal })
  return {
    cleanup: () => {
      setupController?.abort()
      setupController = null
      closeModal()
    },
  }
}
