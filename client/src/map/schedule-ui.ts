/** Schedule modal controller. Owns schedule rendering, focus management, and route selection. */

import { findPath } from '../utils/pathfinding'
import { findExactMatch } from '../utils/search'
import { getSchedule, saveSchedule } from '../utils/storage'
import type { Graph, ScheduleEntry } from '../utils/types'
import { state } from './map-state'
import { displayRoute } from './route-display'

type ScheduleView = 'paths' | 'edit'

let getGraph: () => Graph | null = () => null
let triggerElement: HTMLElement | null = null
let focusController: AbortController | null = null
let setupController: AbortController | null = null

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

function showView(view: ScheduleView): void {
  const elements = modalElements()
  if (!elements) return
  const isPaths = view === 'paths'
  elements.paths.style.display = isPaths ? 'block' : 'none'
  elements.edit.style.display = isPaths ? 'none' : 'block'
  if (isPaths) renderPaths()
  else renderPeriods()
}

function closeModal(): void {
  const elements = modalElements()
  if (!elements) return
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
    input.placeholder = 'Room…'
    input.dataset.period = entry.period
    input.autocomplete = 'off'
    input.setAttribute('aria-label', `Room for period ${entry.period}`)
    label.htmlFor = `schedule-period-${entry.period}`
    input.id = label.htmlFor

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
    const fromNode = findExactMatch(from.room, state.allNodesAllFloors)
    const toNode = findExactMatch(to.room, state.allNodesAllFloors)
    item.textContent = `P${from.period} → P${to.period}: ${from.room} → ${to.room}`
    const graph = getGraph()
    if (!fromNode || !toNode || !graph) {
      item.disabled = true
      item.title = !graph ? 'Map not ready yet' : 'Room not found'
    } else {
      const result = findPath(fromNode.uid, toNode.uid, state.allNodesAllFloors, graph)
      if (!result.found) item.disabled = true
      else
        item.addEventListener('click', () => {
          closeModal()
          displayRoute(result.path, result.distance)
        })
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
