export const SUPPORTED_LOCALES = ['en', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

const STORAGE_KEY = 'fremd_maps_locale'

const translations = {
  en: {
    'app.name': 'Fremd Maps',
    'language.label': 'Language',
    'language.english': 'English',
    'language.spanish': 'Español',
    'map.label': 'School map',
    'map.instructions':
      'Interactive school map. Use the From and To fields to plan a route; turn-by-turn directions appear in the navigation panel.',
    'floor.label': 'Floor {floor}',
    'floor.floors': 'Floors {floors}',
    'floor.one': 'Floor 1',
    'floor.two': 'Floor 2',
    'panel.expand': 'Expand navigation panel',
    'panel.collapse': 'Collapse navigation panel',
    'panel.tapExpand': 'Tap to expand',
    'panel.tapCollapse': 'Tap to collapse',
    'panel.tapOpen': 'Tap to open',
    'panel.recent': 'Recent searches',
    'search.start': 'Start',
    'search.destination': 'Destination',
    'search.placeholder': 'Room number or name',
    'search.noResults': 'No rooms found. Try a different search.',
    'favorite.add': 'Add {room} to favorites',
    'favorite.remove': 'Remove {room} from favorites',
    'category.classroom': 'Classroom',
    'category.office': 'Office',
    'category.lab': 'Lab',
    'category.bathroom': 'Bathroom',
    'category.cafeteria': 'Cafeteria',
    'category.gymnasium': 'Gymnasium',
    'category.library': 'Library',
    'category.auditorium': 'Auditorium',
    'category.stairway': 'Stairway',
    'category.entrance': 'Entrance',
    'category.other': 'Other',
    'category.unknown': 'Unknown',
    'search.recent': 'Recent',
    'search.clear': 'Clear',
    'route.go': 'Go',
    'route.clear': 'Clear',
    'route.bathroom': 'Find Bathroom',
    'route.schedule': 'My Schedule',
    'route.reportIssue': 'Report an issue',
    'route.directions': 'Turn-by-turn directions',
    'route.follow': 'Follow the amber path on the map',
    'route.followMulti': '{floors} floors • Follow the amber path',
    'route.continues': 'Route continues on another floor',
    'route.switchFloor': 'Switch to Floor',
    'route.missingLocations': 'Enter both a starting point and a destination',
    'route.mapLoading': 'Map not ready yet — please wait a moment',
    'route.locationsNotFound': 'One or both locations could not be found.',
    'route.noPath': 'No path found between these locations.',
    'route.missingStart': 'Enter your starting location first',
    'route.roomNotFound': 'Room “{room}” not found',
    'route.noBathrooms': 'No reachable bathrooms found',
    'route.noBathroomPath': 'Could not find a path to the nearest bathroom.',
    'direction.start': 'Start at {place}',
    'direction.arrive': 'Arrive at {place}',
    'direction.continue': 'Continue straight',
    'direction.right': 'Turn right',
    'direction.left': 'Turn left',
    'direction.around': 'Turn around',
    'direction.exitStairs': 'Exit the stairs and continue',
    'direction.exitStairsTurn': 'Exit the stairs and {direction}',
    'direction.toward': '{direction} toward {place}',
    'direction.startingPoint': 'Starting point',
    'direction.destination': 'Destination',
    'direction.stairs': 'Stairs {name}',
    'direction.theStairs': 'the stairs',
    'direction.takeStairs': 'Take the stairs to Floor {floor}',
    'direction.takeNamedStairs': 'Take {stairs} to Floor {floor}',
    'schedule.label': 'My Schedule',
    'schedule.edit': 'Edit schedule',
    'schedule.close': 'Close schedule',
    'schedule.back': 'Back to paths view',
    'schedule.subtitlePaths': 'Tap a route to navigate it.',
    'schedule.subtitleEdit': 'Set a room for each period.',
    'schedule.save': 'Save schedule',
    'schedule.placeholder': 'Search room or place',
    'schedule.suggestions': 'Room suggestions for period {period}',
    'schedule.roomForPeriod': 'Room for period {period}',
    'schedule.usePeriod': 'Use period {period} as destination',
    'schedule.empty': 'No rooms set yet. Tap Edit to add rooms to your schedule.',
    'schedule.oneRoom': 'Add at least 2 rooms to your schedule to see paths.',
    'schedule.loading': 'Map is still loading',
    'schedule.checkRoom': 'Check the room name',
    'schedule.noRoute': 'No route is available',
    'schedule.viewRoute': 'Tap to view route',
    'onboarding.label': 'Welcome to Fremd Maps',
    'onboarding.kicker': 'Welcome to Fremd Maps',
    'onboarding.headline': 'Find a room. Get there.',
    'onboarding.copy':
      'Search by room number or name. We’ll map the route and handle floor changes for you.',
    'onboarding.languagePrompt': 'Choose your language',
    'onboarding.start': 'Get started',
    'update.ready': 'A newer map is ready.',
    'update.reload': 'Reload',
  },
  es: {
    'app.name': 'Fremd Maps',
    'language.label': 'Idioma',
    'language.english': 'English',
    'language.spanish': 'Español',
    'map.label': 'Mapa de la escuela',
    'map.instructions':
      'Mapa interactivo de la escuela. Usa los campos de origen y destino para planear una ruta; las indicaciones aparecen en el panel de navegación.',
    'floor.label': 'Piso {floor}',
    'floor.floors': 'Pisos {floors}',
    'floor.one': 'Piso 1',
    'floor.two': 'Piso 2',
    'panel.expand': 'Expandir el panel de navegación',
    'panel.collapse': 'Contraer el panel de navegación',
    'panel.tapExpand': 'Toca para expandir',
    'panel.tapCollapse': 'Toca para contraer',
    'panel.tapOpen': 'Toca para abrir',
    'panel.recent': 'Búsquedas recientes',
    'search.start': 'Origen',
    'search.destination': 'Destino',
    'search.placeholder': 'Número o nombre del salón',
    'search.noResults': 'No se encontraron salones. Prueba otra búsqueda.',
    'favorite.add': 'Agregar {room} a favoritos',
    'favorite.remove': 'Quitar {room} de favoritos',
    'category.classroom': 'Salón',
    'category.office': 'Oficina',
    'category.lab': 'Laboratorio',
    'category.bathroom': 'Baño',
    'category.cafeteria': 'Cafetería',
    'category.gymnasium': 'Gimnasio',
    'category.library': 'Biblioteca',
    'category.auditorium': 'Auditorio',
    'category.stairway': 'Escaleras',
    'category.entrance': 'Entrada',
    'category.other': 'Otro',
    'category.unknown': 'Desconocido',
    'search.recent': 'Recientes',
    'search.clear': 'Borrar',
    'route.go': 'Ir',
    'route.clear': 'Borrar',
    'route.bathroom': 'Buscar baño',
    'route.schedule': 'Mi horario',
    'route.reportIssue': 'Reportar un problema',
    'route.directions': 'Indicaciones paso a paso',
    'route.follow': 'Sigue la ruta ámbar en el mapa',
    'route.followMulti': '{floors} pisos • Sigue la ruta ámbar',
    'route.continues': 'La ruta continúa en otro piso',
    'route.switchFloor': 'Cambiar al piso',
    'route.missingLocations': 'Ingresa un origen y un destino',
    'route.mapLoading': 'El mapa aún no está listo; espera un momento',
    'route.locationsNotFound': 'No se encontró una o ambas ubicaciones.',
    'route.noPath': 'No se encontró una ruta entre estas ubicaciones.',
    'route.missingStart': 'Ingresa primero tu ubicación de origen',
    'route.roomNotFound': 'No se encontró el salón “{room}”',
    'route.noBathrooms': 'No se encontraron baños accesibles',
    'route.noBathroomPath': 'No se encontró una ruta al baño más cercano.',
    'direction.start': 'Comienza en {place}',
    'direction.arrive': 'Llegaste a {place}',
    'direction.continue': 'Sigue derecho',
    'direction.right': 'Gira a la derecha',
    'direction.left': 'Gira a la izquierda',
    'direction.around': 'Da la vuelta',
    'direction.exitStairs': 'Sal de las escaleras y sigue derecho',
    'direction.exitStairsTurn': 'Sal de las escaleras y {direction}',
    'direction.toward': '{direction} hacia {place}',
    'direction.startingPoint': 'Punto de inicio',
    'direction.destination': 'Destino',
    'direction.stairs': 'Escaleras {name}',
    'direction.theStairs': 'las escaleras',
    'direction.takeStairs': 'Toma las escaleras al piso {floor}',
    'direction.takeNamedStairs': 'Toma {stairs} al piso {floor}',
    'schedule.label': 'Mi horario',
    'schedule.edit': 'Editar horario',
    'schedule.close': 'Cerrar horario',
    'schedule.back': 'Volver a las rutas',
    'schedule.subtitlePaths': 'Toca una ruta para navegarla.',
    'schedule.subtitleEdit': 'Establece un salón para cada periodo.',
    'schedule.save': 'Guardar horario',
    'schedule.placeholder': 'Busca un salón o lugar',
    'schedule.suggestions': 'Sugerencias de salones para el periodo {period}',
    'schedule.roomForPeriod': 'Salón para el periodo {period}',
    'schedule.usePeriod': 'Usar el periodo {period} como destino',
    'schedule.empty': 'Aún no hay salones. Toca Editar para agregar salones a tu horario.',
    'schedule.oneRoom': 'Agrega al menos 2 salones a tu horario para ver rutas.',
    'schedule.loading': 'El mapa todavía está cargando',
    'schedule.checkRoom': 'Revisa el nombre del salón',
    'schedule.noRoute': 'No hay una ruta disponible',
    'schedule.viewRoute': 'Toca para ver la ruta',
    'onboarding.label': 'Bienvenido a Fremd Maps',
    'onboarding.kicker': 'Bienvenido a Fremd Maps',
    'onboarding.headline': 'Encuentra un salón. Llega allí.',
    'onboarding.copy':
      'Busca por número o nombre de salón. Mostraremos la ruta y los cambios de piso.',
    'onboarding.languagePrompt': 'Elige tu idioma',
    'onboarding.start': 'Comenzar',
    'update.ready': 'Hay un mapa nuevo listo.',
    'update.reload': 'Recargar',
  },
} as const

export type TranslationKey = keyof (typeof translations)['en']
type TranslationValues = Record<string, string | number>

let locale = readInitialLocale()

function isLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Storage can be unavailable in private browsing; browser preference is still safe to use.
  }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function getLocale(): Locale {
  return locale
}

export function t(key: TranslationKey, values: TranslationValues = {}): string {
  return translations[locale][key].replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(values[name] ?? `{${name}}`)
  )
}

export function setLocale(nextLocale: Locale): void {
  locale = nextLocale
  try {
    localStorage.setItem(STORAGE_KEY, nextLocale)
  } catch {
    // A locale preference is optional; keep the in-memory choice for this session.
  }
  document.documentElement.lang = nextLocale
  window.dispatchEvent(new CustomEvent<Locale>('fremdmaps:locale-change', { detail: nextLocale }))
}

/** Apply data-driven translations for static Astro markup. */
export function applyTranslations(root: ParentNode = document): void {
  document.documentElement.lang = locale
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n as TranslationKey)
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.placeholder = t(element.dataset.i18nPlaceholder as TranslationKey)
    }
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel as TranslationKey))
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle as TranslationKey)
  })
}

export function initializeI18n(): void {
  applyTranslations()
}
