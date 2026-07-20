import { applyTranslations, getLocale, setLocale } from '../utils/i18n'

const STORAGE_KEY = 'wayfinder_onboarded'

const overlay = document.getElementById('onboarding-overlay')
const dismissBtn = document.getElementById('onboarding-dismiss') as HTMLButtonElement | null
const languageSelect = document.getElementById(
  'onboarding-language-select'
) as HTMLSelectElement | null

if (languageSelect) languageSelect.value = getLocale()

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
  languageSelect?.focus()
}

overlay?.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !overlay.isConnected) return
  if (!languageSelect || !dismissBtn) return
  if (event.shiftKey && document.activeElement === languageSelect) {
    event.preventDefault()
    dismissBtn.focus()
  } else if (!event.shiftKey && document.activeElement === dismissBtn) {
    event.preventDefault()
    languageSelect.focus()
  }
})

languageSelect?.addEventListener('change', () => {
  const locale = languageSelect.value === 'es' ? 'es' : 'en'
  setLocale(locale)
  applyTranslations()
  const headerLanguageSelect = document.getElementById(
    'language-select'
  ) as HTMLSelectElement | null
  if (headerLanguageSelect) headerLanguageSelect.value = locale
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
