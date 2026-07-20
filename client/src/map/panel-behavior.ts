/**
 * Responsive navigation-panel behavior.
 *
 * Keeps mobile panel state and virtual-keyboard avoidance out of Map.astro.
 */

import { t } from '../utils/i18n'

type PanelState = 'normal' | 'expanded' | 'minimized'

export interface PanelBehavior {
  collapseForRoute: () => void
  cleanup: () => void
}

export function setupPanelBehavior(): PanelBehavior {
  const navPanel = document.getElementById('nav-panel')
  const panelHandle = document.getElementById('panel-handle')
  const panelHandleLabel = document.getElementById('panel-handle-label')
  let panelState: PanelState = 'normal'
  const controller = new AbortController()

  const updatePanelHandleCopy = (): void => {
    const isExpanded = panelState === 'expanded'
    panelHandle?.setAttribute('aria-label', t(isExpanded ? 'panel.collapse' : 'panel.expand'))
    if (panelHandleLabel) {
      panelHandleLabel.textContent = t(
        isExpanded
          ? 'panel.tapCollapse'
          : panelState === 'minimized'
            ? 'panel.tapOpen'
            : 'panel.tapExpand'
      )
    }
  }

  const setPanelState = (nextState: Exclude<PanelState, 'normal'>): void => {
    if (!navPanel) return
    const isExpanded = nextState === 'expanded'
    navPanel.classList.toggle('panel-expanded', isExpanded)
    navPanel.classList.toggle('panel-minimized', !isExpanded)
    panelState = nextState
    panelHandle?.setAttribute('aria-expanded', String(isExpanded))
    updatePanelHandleCopy()
  }

  window.addEventListener('fremdmaps:locale-change', updatePanelHandleCopy, {
    signal: controller.signal,
  })

  const collapseForRoute = (): void => {
    if (!navPanel || window.innerWidth >= 768) return
    setPanelState('minimized')
  }

  const applyKeyboardInset = (): void => {
    if (!navPanel) return
    if (window.innerWidth >= 768 || !window.visualViewport) {
      navPanel.style.bottom = ''
      return
    }
    const viewport = window.visualViewport
    const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    navPanel.style.bottom = `${keyboardInset}px`
  }

  if (navPanel && window.visualViewport) {
    const activeInputSelector = 'input, textarea, [contenteditable="true"]'
    document.addEventListener(
      'focusin',
      (event) => {
        const target = event.target as Element | null
        if (!target?.matches(activeInputSelector)) return
        window.setTimeout(() => {
          ;(target as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
        }, 120)
        applyKeyboardInset()
      },
      { signal: controller.signal }
    )
    document.addEventListener('focusout', () => window.setTimeout(applyKeyboardInset, 100), {
      signal: controller.signal,
    })
    window.visualViewport.addEventListener('resize', applyKeyboardInset, {
      signal: controller.signal,
    })
    window.addEventListener('orientationchange', applyKeyboardInset, { signal: controller.signal })
    window.addEventListener('resize', applyKeyboardInset, { signal: controller.signal })
    applyKeyboardInset()
  }

  if (panelHandle && navPanel) {
    panelHandle.addEventListener(
      'click',
      () => {
        if (window.innerWidth >= 768) return
        setPanelState(panelState === 'expanded' ? 'minimized' : 'expanded')
      },
      { signal: controller.signal }
    )

    const panelHeader = navPanel.querySelector('.panel-header')
    if (panelHeader) {
      let lastTap = 0
      panelHeader.addEventListener(
        'click',
        () => {
          if (window.innerWidth >= 768) return
          const now = Date.now()
          if (now - lastTap < 300) setPanelState('minimized')
          lastTap = now
        },
        { signal: controller.signal }
      )
    }
  }

  return {
    collapseForRoute,
    cleanup: () => {
      controller.abort()
      if (navPanel) navPanel.style.bottom = ''
    },
  }
}
