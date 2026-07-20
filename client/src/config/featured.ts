/**
 * Featured destinations and search configuration.
 *
 * Values here control what the search UI shows by default and how it behaves
 * at runtime.  Change these to tune the user experience without touching
 * component logic.
 */

/**
 * Room names shown as quick-pick suggestions when the search input is empty.
 *
 * Matching is case-insensitive and uses room-name containment; each entry
 * should therefore name a unique, stable destination. Displayed in the order
 * listed.
 */
export const FEATURED_ROOMS = [
  'Main Office',
  'Cafeteria',
  'Library',
  'Gymnasium',
  'Auditorium',
] as const

/**
 * Runtime tuning knobs for the search feature.
 *
 * - `MAX_RESULTS`: maximum number of results shown in the dropdown at once.
 * - `MIN_QUERY_LENGTH`: characters required before a search is triggered
 *   (prevents noise from single-keystroke queries).
 * - `DEBOUNCE_MS`: milliseconds to wait after the last keystroke before
 *   running the search (reduces redundant work while typing).
 * - `FUZZY_THRESHOLD`: Fuse.js score threshold (0 = perfect match,
 *   1 = match anything); lower values are stricter.
 */
export const SEARCH_CONFIG = {
  MAX_RESULTS: 10,
  MIN_QUERY_LENGTH: 1,
  DEBOUNCE_MS: 150,
  FUZZY_THRESHOLD: 0.4,
  RECENCY_BOOST: 0.2,
  RECENCY_HALF_LIFE_DAYS: 7,
} as const

/**
 * Reserved category-filter chip definitions.
 *
 * The current search UI does not render category chips yet. When it does,
 * each entry is intended to represent an inferred `RoomCategory`, not a
 * substring match against room names.
 *
 * - `value`: `RoomCategory` value to filter by.
 * - `label`: human-readable chip label.
 * - `icon`: emoji available for a future chip renderer.
 */
export const CATEGORY_FILTERS = [
  { value: 'classroom', label: 'Classrooms', icon: '📚' },
  { value: 'office', label: 'Offices', icon: '💼' },
  { value: 'lab', label: 'Labs', icon: '🔬' },
  { value: 'bathroom', label: 'Bathrooms', icon: '🚻' },
  { value: 'cafeteria', label: 'Cafeteria', icon: '🍽️' },
  { value: 'gymnasium', label: 'Gymnasium', icon: '🏃' },
  { value: 'library', label: 'Library', icon: '📖' },
  { value: 'auditorium', label: 'Auditorium', icon: '🎭' },
] as const
