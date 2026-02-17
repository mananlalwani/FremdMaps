/**
 * Featured/popular destinations configuration
 * These rooms appear as suggestions when search is empty
 */

export const FEATURED_ROOMS = [
  'Main Office',
  'Cafeteria',
  'Library',
  'Gymnasium',
  'Auditorium'
] as const

/**
 * Search configuration
 */
export const SEARCH_CONFIG = {
  MAX_RESULTS: 10,
  MIN_QUERY_LENGTH: 1,
  DEBOUNCE_MS: 150,
  FUZZY_THRESHOLD: 0.4,
  SHOW_CATEGORY_ICONS: true,
  HIGHLIGHT_MATCHES: true
} as const

/**
 * Category filter options for search
 */
export const CATEGORY_FILTERS = [
  { value: 'classroom', label: 'Classrooms', icon: '📚' },
  { value: 'office', label: 'Offices', icon: '💼' },
  { value: 'lab', label: 'Labs', icon: '🔬' },
  { value: 'bathroom', label: 'Bathrooms', icon: '🚻' },
  { value: 'cafeteria', label: 'Cafeteria', icon: '🍽️' },
  { value: 'gymnasium', label: 'Gymnasium', icon: '🏃' },
  { value: 'library', label: 'Library', icon: '📖' },
  { value: 'auditorium', label: 'Auditorium', icon: '🎭' }
] as const
