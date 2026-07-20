const STORAGE_KEY = 'wayfinder_onboarded'

const overlay = document.getElementById('onboarding-overlay')
const dismissBtn = document.getElementById('onboarding-dismiss') as HTMLButtonElement | null

const hasCompletedOnboarding = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const markOnboardingComplete = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Private browsing or storage policy must not block access to the map.
  }
}

if (hasCompletedOnboarding()) {
  overlay?.remove()
} else {
  dismissBtn?.focus()
}

overlay?.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !overlay.isConnected) return
  event.preventDefault()
  dismissBtn?.focus()
})

dismissBtn?.addEventListener('click', () => {
  markOnboardingComplete()
  overlay?.classList.add('dismissing')
  overlay?.addEventListener('animationend', () => overlay.remove(), { once: true })
})

overlay?.addEventListener('click', (event) => {
  if (event.target === overlay) dismissBtn?.click()
})

const escapeController = new AbortController()
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape' && overlay?.isConnected) dismissBtn?.click()
  },
  { signal: escapeController.signal }
)

const observer = new MutationObserver(() => {
  if (!overlay?.isConnected) {
    escapeController.abort()
    observer.disconnect()
  }
})
if (overlay) observer.observe(document.body, { childList: true, subtree: true })
