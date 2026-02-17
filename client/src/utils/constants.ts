/**
 * Application constants
 */

// Map Configuration
export const MAP_CONFIG = {
  IMAGE_WIDTH: 6050,
  IMAGE_HEIGHT: 4675,
  MIN_ZOOM: -5,
  MAX_ZOOM: 2,
  MAX_HALLWAY_DISTANCE: 600, // Maximum distance for hallway connections (in pixels)
  PATH_SIMPLIFICATION_ANGLE: 30, // Angle threshold for path simplification (in degrees)
} as const;

// Floor Configuration
export const FLOORS = {
  DEFAULT: '2', // Default floor on page load
  AVAILABLE: [
    { id: '1', name: 'Floor 1', image: '/floor1.png' },
    { id: '2', name: 'Floor 2', image: '/floor2.png' },
  ],
} as const;

// API Configuration
export const API_CONFIG = {
  DEFAULT_URL: 'http://localhost:5173',
  ENDPOINTS: {
    NODES: '/api/nodes',
    WALLS: '/api/walls',
    WALLS_ORIGINAL: '/api/walls/original',
    WALLS_OPTIMIZED: '/api/walls/optimized',
  },
} as const;

// UI Configuration
export const UI_CONFIG = {
  SEARCH_DEBOUNCE_MS: 150,
  STATUS_MESSAGE_TIMEOUT_MS: 5000,
  ROUTE_PATH_COLOR: '#f0a500', // Amber accent
  ROUTE_PATH_WEIGHT: 5,
} as const;

// Geometry Constants
export const GEOMETRY = {
  EPSILON: 1e-6, // Tolerance for floating-point comparisons
  INTERSECTION_EPSILON: 1e-10, // Tolerance for segment intersection
} as const;
