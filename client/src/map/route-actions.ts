/** Navigation-panel actions translated from DOM events into route-planning requests. */

import { t } from '../utils/i18n'
import { addRecentSearch } from '../utils/storage'
import { state } from './map-state'
import type { ActiveRoute } from '../navigation/activeRoute'
import type { RoutePlanOutcome, RoutePlanner } from '../navigation/routePlanner'

export interface RouteActionOptions {
  planner: RoutePlanner
  activeRoute: ActiveRoute
  collapsePanel: () => void
  refreshRecent: () => void
  showStatus: (message: string, type?: 'info' | 'warning' | 'error') => void
  translate?: typeof t
  rememberRoute?: typeof addRecentSearch
}

export interface RouteActions {
  findRoute: () => void
  cleanup: () => void
}

function showPlanFailure(
  outcome: Exclude<RoutePlanOutcome, { status: 'ok' }>,
  options: RouteActionOptions,
  translate: typeof t
): void {
  if (outcome.status === 'not-ready') {
    options.showStatus(translate('route.mapLoading'), 'warning')
    return
  }
  if (outcome.status === 'origin-not-found' || outcome.status === 'destination-not-found') {
    options.showStatus(translate('route.locationsNotFound'), 'error')
    return
  }
  options.showStatus(translate('route.noPath'), 'error')
}

/** Attach route and bathroom actions after the navigation panel is rendered. */
export function setupRouteActions(options: RouteActionOptions): RouteActions {
  const translate = options.translate ?? t
  const rememberRoute = options.rememberRoute ?? addRecentSearch

  const findRoute = (): void => {
    const startInput = document.querySelector<HTMLInputElement>('#start-input')
    const endInput = document.querySelector<HTMLInputElement>('#end-input')
    if (!startInput || !endInput) return
    const startText = startInput.value.trim()
    const endText = endInput.value.trim()
    if (!startText || !endText) {
      options.showStatus(translate('route.missingLocations'), 'warning')
      return
    }

    const outcome = options.planner.plan(
      { text: startText, selectedUid: state.selectedStartNode?.uid },
      { text: endText, selectedUid: state.selectedEndNode?.uid }
    )
    if (outcome.status !== 'ok') {
      showPlanFailure(outcome, options, translate)
      return
    }

    rememberRoute(startText, endText)
    options.refreshRecent()
    options.activeRoute.show(outcome.plan)
    options.collapsePanel()
  }

  const findBathroom = (): void => {
    const startInput = document.querySelector<HTMLInputElement>('#start-input')
    const startText = startInput?.value.trim() ?? ''
    if (!startText) {
      options.showStatus(translate('route.missingStart'), 'warning')
      return
    }
    const outcome = options.planner.planToNearestBathroom({
      text: startText,
      selectedUid: state.selectedStartNode?.uid,
    })
    if (outcome.status !== 'ok') {
      if (outcome.status === 'origin-not-found') {
        options.showStatus(translate('route.roomNotFound', { room: startText }), 'error')
      } else if (outcome.status === 'not-ready') {
        options.showStatus(translate('route.mapLoading'), 'warning')
      } else if (outcome.status === 'no-bathroom') {
        options.showStatus(translate('route.noBathrooms'), 'error')
      } else {
        options.showStatus(translate('route.noBathroomPath'), 'error')
      }
      return
    }
    options.activeRoute.show(outcome.plan)
    options.collapsePanel()
  }

  const controller = new AbortController()
  document.getElementById('find-route-btn')?.addEventListener('click', findRoute, {
    signal: controller.signal,
  })
  document.getElementById('find-bathroom-btn')?.addEventListener('click', findBathroom, {
    signal: controller.signal,
  })
  return { findRoute, cleanup: () => controller.abort() }
}
