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
 * Each string must exactly match a `rooms` entry in the nodes data so the
 * search can resolve the destination.  Displayed in the order listed.
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
 * - `SHOW_CATEGORY_ICONS`: render emoji/icon beside category filter chips.
 * - `HIGHLIGHT_MATCHES`: bold the matched portion of result text.
 */
export const SEARCH_CONFIG = {
  MAX_RESULTS: 10,
  MIN_QUERY_LENGTH: 1,
  DEBOUNCE_MS: 150,
  FUZZY_THRESHOLD: 0.4,
  SHOW_CATEGORY_ICONS: true,
  HIGHLIGHT_MATCHES: true,
} as const

/**
 * Category filter chips shown above the search results.
 *
 * Each entry is rendered as a toggleable chip in the search dropdown.
 * Activating a chip narrows results to nodes whose `rooms` array contains
 * the chip's `value` as a substring (case-insensitive).
 *
 * - `value`: filter token matched against room names.
 * - `label`: human-readable chip label.
 * - `icon`: emoji displayed beside the label when `SEARCH_CONFIG.SHOW_CATEGORY_ICONS` is true.
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
