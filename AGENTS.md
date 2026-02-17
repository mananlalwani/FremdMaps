# Agent Development Guidelines

This document provides essential information for AI coding agents working in this codebase.

## Project Overview

**Tech Stack**: TypeScript monorepo with Astro (frontend) + Express (backend)  
**Purpose**: School navigation app with interactive map editing and A* pathfinding  
**Package Manager**: pnpm (with workspaces)  
**Coordinate System**: Leaflet Simple CRS mapping image pixels to lat/lng  
**Design System**: "Wayfinder" - Dark moody theme with amber accents

## Build/Test/Lint Commands

### Root Level Commands
```bash
pnpm dev          # Run both client and server concurrently
pnpm build        # Build all workspace packages (TypeScript + Astro)
pnpm test         # Run tests (currently not configured)
```

### Client Commands (Frontend - Astro)
```bash
cd client
pnpm dev          # Start Astro dev server (http://localhost:4321)
pnpm build        # Build production site to ./dist/
pnpm preview      # Preview production build locally
pnpm astro        # Run Astro CLI commands
```

### Server Commands (Backend - Express)
```bash
cd server
pnpm dev          # Run with ts-node (http://localhost:5173)
pnpm build        # Compile TypeScript to ./dist/
pnpm start        # Run compiled JavaScript from ./dist/
```

### Running Single Tests
**Note**: No testing framework is currently configured. If you need to add tests:
- Consider Vitest (recommended for Astro projects)
- Add test scripts to package.json
- Create test files with `.test.ts` or `.spec.ts` extensions

## Code Style Guidelines

### Import Conventions

```typescript
// 1. External dependencies first
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import express from 'express'

// 2. Internal utilities (relative imports)
import { buildVisibilityGraph } from "../utils/graph"
import { findPath } from "../utils/pathfinding"

// 3. Type imports (use 'import type' syntax)
import type { Graph, Wall, Node } from "../utils/types"
```

**Rules**:
- Use named imports over default imports when possible
- No file extensions in import paths (`.ts`, `.tsx` omitted)
- Absolute imports from node_modules, relative for local files
- Separate type imports using `import type`

### TypeScript Conventions

**Interfaces vs Types**:
```typescript
// Use interfaces for object shapes and data models
export interface Node {
  uid: string
  rooms: string[]
  lat: number
  lng: number
}

// Use type aliases for complex types, unions, or primitives
export type Graph = Map<string, Edge[]>
export type PathResult = { path: Node[], distance: number, found: boolean }
```

**Type Safety**:
- Explicit return types on all exported functions
- Function parameters must be typed
- Avoid `any` - use proper types or `unknown`
- Use generics for reusable utilities (e.g., `PriorityQueue<T>`)
- TypeScript strict mode is enabled via Astro's tsconfig

### Naming Conventions

**Files**:
- `camelCase.ts` for utilities: `pathfinding.ts`, `geometry.ts`
- `PascalCase.astro` for components: `Map.astro`, `NavigationPanel.astro`

**Variables**:
- `camelCase` for variables: `navigationGraph`, `currentRoute`
- `SCREAMING_SNAKE_CASE` for constants: `IMAGE_WIDTH`, `MAX_ZOOM`

**Functions**:
- `camelCase` with verb-noun patterns: `findPath()`, `buildVisibilityGraph()`, `hasLineOfSight()`
- Descriptive names that clearly indicate purpose

**CSS**:
- `kebab-case` for IDs and classes: `#nav-panel`, `.input-group`, `.directions-list`

### Error Handling

```typescript
// Server-side (Express) - Return proper HTTP status codes
app.get('/api/nodes', async (req, res) => {
  try {
    const nodes = await loadNodes()
    res.json(nodes)
  } catch (error) {
    console.error('Error loading nodes:', error)
    res.status(500).json({ error: 'Failed to load nodes' })
  }
})

// Client-side - Log errors and provide user feedback
try {
  const response = await fetch('/api/nodes')
  const data = await response.json()
} catch (err) {
  console.error("Failed to load data:", err)
  alert('Failed to load navigation data')
}

// Validation - Early returns with error logging
if (!startNode || !goalNode) {
  console.error('Start or goal node not found')
  return { path: [], distance: 0, found: false }
}
```

**Logging Levels**:
- `console.log()` - Informational messages
- `console.warn()` - Warnings (e.g., isolated nodes)
- `console.error()` - Errors requiring attention

### Astro Component Structure

```astro
---
// Frontmatter: Server-side logic and imports
import ComponentName from "../components/ComponentName.astro"
import type { Props } from "../utils/types"

// Server-side data fetching or logic here
---

<!-- HTML Template -->
<div id="component">
  <slot />
</div>

<!-- Client-side Scripts (TypeScript) -->
<script>
  // Module-scoped by default
  import L from "leaflet"
  
  // DOM manipulation and event handling
  const element = document.getElementById('component')
  element?.addEventListener('click', handleClick)
</script>

<!-- Scoped Styles -->
<style>
  /* Component-specific CSS */
  #component {
    display: flex;
  }
</style>
```

**Important**: Use `<style is:global>` when styles need to apply to dynamically created elements (e.g., elements created via `innerHTML`). Astro's scoped styles only apply to elements in the template, not JavaScript-generated DOM.

### CSS Design System - "Wayfinder"

**CSS Custom Properties** (defined in `index.astro`):
```css
/* Typography Stack */
--font-display: 'DM Serif Display', serif;      /* Headings */
--font-body: 'Plus Jakarta Sans', sans-serif;   /* Body text */
--font-mono: 'JetBrains Mono', monospace;       /* Labels, room numbers */

/* Dark Panel Palette */
--panel-bg: #16161e;          /* Main panel background */
--panel-surface: #1e1e2a;     /* Card/elevated surfaces */
--panel-elevated: #262636;    /* Hover states */
--panel-border: rgba(255, 255, 255, 0.06);        /* Subtle borders */
--panel-border-hover: rgba(255, 255, 255, 0.12);  /* Hover borders */

/* Amber Accent System */
--amber-400: #ffca28;
--amber-500: #f0a500;         /* Primary accent color */
--amber-glow: rgba(240, 165, 0, 0.15);
--amber-glow-strong: rgba(240, 165, 0, 0.3);

/* Text Colors */
--text-primary: #e8e6e1;      /* Primary text (cream) */
--text-secondary: #9895a3;    /* Secondary text (muted lavender-gray) */
--text-muted: #5c5970;        /* De-emphasized text */
--text-accent: var(--amber-400);

/* Spacing Scale */
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--space-5: 20px; --space-6: 24px; --space-8: 32px;

/* Border Radius */
--radius-sm: 4px; --radius-md: 8px; --radius-lg: 14px; --radius-xl: 20px;

/* Motion */
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--duration-fast: 120ms; --duration-normal: 200ms; --duration-slow: 350ms;
```

**CSS Patterns**:
- Use CSS custom properties for all colors, spacing, typography
- Dark theme is mandatory - all components must use `--panel-*` and `--text-*` colors
- Amber (`--amber-500`) is the primary accent for interactive elements, routes, and highlights
- Mobile-first: default styles for mobile, `@media (min-width: 768px)` for desktop
- Touch targets: minimum 44px tap areas on mobile
- Add `-webkit-tap-highlight-color: transparent` to all interactive elements
- Use `:active` pseudo-class for instant touch feedback

**Component Styling Guidelines**:
```css
/* Mobile-first button example */
button {
  padding: 14px 16px;               /* Large mobile touch target */
  font-size: 15px;
  background: var(--panel-elevated);
  color: var(--text-primary);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  transition: all var(--duration-normal) var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}

button:hover {
  border-color: var(--amber-500);
  color: var(--amber-400);
}

button:active {
  transform: scale(0.97);           /* Instant feedback on tap */
}

@media (min-width: 768px) {
  button {
    padding: 10px 12px;             /* Smaller desktop size */
    font-size: 13px;
  }
}
```

## Project Architecture

### Directory Structure
```
client/src/
  components/     # Astro UI components
  pages/          # Astro pages (file-based routing)
  utils/          # TypeScript utilities (pure functions)

server/
  src/            # Express server code
  data/           # JSON data files (nodes, walls)
  scripts/        # Python utilities (OpenCV)
```

### Module Responsibilities
- `types.ts` - Type definitions only
- `geometry.ts` - Math and geometry calculations
- `graph.ts` - Visibility graph construction
- `pathfinding.ts` - A* algorithm implementation
- `directions.ts` - Turn-by-turn text generation

### Data Flow
1. JSON files in `server/data/` (nodes, walls)
2. Express API serves data via `/api/nodes`, `/api/walls`
3. Astro frontend fetches and renders data
4. User interactions trigger pathfinding algorithms
5. Admin mode allows editing and saving back via API

## Best Practices

### When Adding Features
1. Determine if it's client-side (UI/interaction) or server-side (data/API)
2. Create utility functions in appropriate `utils/*.ts` files
3. Export types from `utils/types.ts`
4. Add JSDoc comments for complex algorithms
5. Use early returns for validation
6. Prefer `const` over `let`

### When Fixing Bugs
1. Check console logs for error messages
2. Verify TypeScript types are correct
3. Test both user and admin modes (`?mode=admin`)
4. Validate against JSON data format in `server/data/`

### When Refactoring
1. Maintain separation of concerns (utils vs components)
2. Keep functions pure when possible
3. Extract repeated logic into utilities
4. Update type definitions alongside code changes

### State Management
- No global state library (React Context, Redux, etc.)
- Use local state variables in Astro script blocks
- Pass state via function parameters
- Store persistent data in JSON files

### Algorithm Implementation
- Document algorithm choices (e.g., why A* over Dijkstra)
- Include time/space complexity in comments
- Validate inputs before processing
- Return structured results with success flags

## Common Patterns

### API Endpoint Pattern
```typescript
app.post('/api/resource', express.json(), async (req, res) => {
  try {
    // Validate request body
    const data = req.body
    
    // Process data
    await saveData(data)
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error:', error)
    res.status(500).json({ error: 'Operation failed' })
  }
})
```

### Pathfinding Pattern
```typescript
// 1. Validate inputs
if (!start || !goal) return { path: [], distance: 0, found: false }

// 2. Initialize data structures
const openSet = new PriorityQueue<Node>()
const cameFrom = new Map<string, string>()

// 3. Execute algorithm
while (!openSet.isEmpty()) {
  // Algorithm logic
}

// 4. Return structured result
return { path: reconstructedPath, distance, found: true }
```

## Additional Notes

- **No linting configured**: Consider adding ESLint + Prettier if making extensive changes
- **No tests configured**: Add Vitest if test coverage is needed
- **CORS enabled**: Server allows cross-origin requests for local development
- **Image dimensions**: 6050x4675 pixels (defined in constants)
- **Coordinate system**: `lat` = Y-axis, `lng` = X-axis (Leaflet convention)
