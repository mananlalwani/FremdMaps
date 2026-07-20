import L from 'leaflet'
import { createDevOverlayControls, type DevOverlayControls } from './dev-tools-overlays'
import { state } from './map-state'
import { getGraphStats } from '../utils/graph'
import type { Graph, Node, TrafficZone, Wall } from '../utils/types'
import { MAP_CONFIG } from '../utils/constants'
import { logger } from '../utils/logger'
import { invalidateSearchCache } from '../utils/search'
import { invalidatePathCache } from '../utils/pathfinding'

export interface DevToolsCallbacks {
  getGraph: () => Graph | null
  initializeNavigation: () => Promise<void>
  switchFloor: (floorId: string) => void
  clearRoute: () => void
  redrawRouteForCurrentFloor: () => void
}

let _cb: DevToolsCallbacks
let devToolsController: AbortController | null = null
let overlayControls: DevOverlayControls | null = null

function markNavigationDataChanged(): void {
  state.graphDataRevision += 1
  invalidateSearchCache()
  invalidatePathCache()
}

const $ = (sel: string): HTMLElement | null => document.querySelector(sel)

function uuid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

function escHtml(s: string): string {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

export function initDevTools(callbacks: DevToolsCallbacks): void {
  _cb = callbacks
  devToolsController?.abort()
  overlayControls?.dispose()
  overlayControls = createDevOverlayControls(callbacks)
  document.getElementById('dev-menu')?.remove()
  devToolsController = new AbortController()
  window.addEventListener('schoolwayfinder:floor-data-loaded', refreshDeveloperTools, {
    signal: devToolsController.signal,
  })
  buildUI()
}

// ─── UI Builder ───────────────────────────────────────────────────────────

function buildUI(): void {
  const root = document.createElement('div')
  root.id = 'dev-menu'
  Object.assign(root.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    zIndex: '9999',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: '#e8e6e1',
    lineHeight: '1.5',
  })

  // pill
  const pill = document.createElement('button')
  pill.id = 'dev-menu-pill'
  pill.textContent = 'Dev'
  Object.assign(pill.style, {
    background: 'rgba(22,22,30,0.92)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '999px',
    color: '#e8e6e1',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    padding: '4px 12px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  })
  pill.addEventListener('click', () => {
    panel.style.display = 'flex'
    pill.style.display = 'none'
    refreshAll()
  })

  // panel
  const panel = document.createElement('div')
  panel.id = 'dev-menu-panel'
  panel.style.display = 'none'
  Object.assign(panel.style, {
    display: 'none',
    flexDirection: 'column',
    gap: '8px',
    background: 'rgba(22,22,30,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding: '12px',
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
    minWidth: '280px',
    maxWidth: 'min(92vw, 420px)',
    maxHeight: '80vh',
    overflowY: 'auto',
    wordBreak: 'break-word',
    backdropFilter: 'blur(6px)',
  })

  // header
  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  })
  const title = document.createElement('span')
  title.textContent = 'Dev Menu'
  Object.assign(title.style, {
    fontWeight: '600',
    fontSize: '12px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  })
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  Object.assign(closeBtn.style, {
    background: 'none',
    border: 'none',
    color: '#9895a3',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '0 4px',
  })
  closeBtn.addEventListener('click', () => {
    panel.style.display = 'none'
    pill.style.display = ''
  })
  header.appendChild(title)
  header.appendChild(closeBtn)
  panel.appendChild(header)

  // ── sections ──
  const sections = [
    section('Map State', buildMapState),
    section('Graph', buildGraphStats),
    section('Overlays', () => overlayControls?.element ?? document.createElement('div')),
    section('Navigation', buildNav),
    section('Actions', buildActions),
    section('Storage', buildStorageViewer),
    section('Pathfinding', buildPathTweaks),
    section('Editor', buildEditor),
  ]
  for (const s of sections) {
    panel.appendChild(s)
  }

  // assemble
  root.appendChild(pill)
  root.appendChild(panel)
  document.body.appendChild(root)
}

// ─── Section helpers ──────────────────────────────────────────────────────

function section(label: string, builder: () => HTMLElement): HTMLElement {
  const wrap = document.createElement('div')
  const lbl = document.createElement('div')
  lbl.textContent = label
  Object.assign(lbl.style, {
    fontSize: '10px',
    color: '#5c5970',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '3px',
  })
  wrap.appendChild(lbl)
  const body = builder()
  wrap.appendChild(body)
  return wrap
}

function btn(label: string, onClick: () => void, style?: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.style.cssText =
    style ??
    'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#e8e6e1;padding:3px 8px;border-radius:6px;cursor:pointer;font:inherit;font-size:inherit;transition:background-color .15s'
  b.addEventListener('mouseenter', () => {
    b.style.background = 'rgba(255,255,255,0.12)'
  })
  b.addEventListener('mouseleave', () => {
    b.style.background = 'rgba(255,255,255,0.06)'
  })
  b.addEventListener('click', onClick as (e: MouseEvent) => void)
  return b
}

function row(els: HTMLElement[]): HTMLElement {
  const r = document.createElement('div')
  Object.assign(r.style, { display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' })
  for (const el of els) r.appendChild(el)
  return r
}

// ─── Refresh ──────────────────────────────────────────────────────────────

const _liveBuilders = new Map<HTMLElement, () => string>()

function registerLive(el: HTMLElement, builder: () => string): void {
  el.className = 'dev-live'
  _liveBuilders.set(el, builder)
  el.innerHTML = builder()
}

function refreshAll(): void {
  const live = $('#dev-menu-panel')
  if (!live || live.style.display === 'none') return
  for (const [el, builder] of _liveBuilders) {
    el.innerHTML = builder()
  }
  refreshZoneList()
}

/** Refresh live values and any enabled Leaflet overlays after a floor-data change. */
function refreshDeveloperTools(): void {
  overlayControls?.refresh()
  refreshAll()
}

// ─── Section: Map State ───────────────────────────────────────────────────

function buildMapState(): HTMLElement {
  const c = document.createElement('div')
  registerLive(c, () => {
    const m = state.map
    const center = m ? m.getCenter() : null
    const zoom = m ? m.getZoom() : null
    return `
Floor: <b>${escHtml(state.currentFloor || '—')}</b><br>
Zoom: <b>${zoom ?? '—'}</b><br>
Center: <b>${center ? `${center.lat.toFixed(1)}, ${center.lng.toFixed(1)}` : '—'}</b><br>
Loaded img: <b>${[...state.loadedFloorImages].join(', ') || '—'}</b>
`.trim()
  })
  const refreshRow = row([btn('Refresh', () => refreshAll())])
  c.appendChild(refreshRow)
  return c
}

// ─── Section: Graph Stats ─────────────────────────────────────────────────

function buildGraphStats(): HTMLElement {
  const c = document.createElement('div')
  registerLive(c, () => {
    const g = _cb.getGraph()
    if (!g || g.size === 0) return '<span style="color:#f87171">No graph yet</span>'
    const stats = getGraphStats(g)
    return [
      `Nodes: <b>${stats.nodes}</b>`,
      `Edges: <b>${stats.edges}</b>`,
      `Avg degree: <b>${stats.avgDegree.toFixed(1)}</b>`,
      `Max degree: <b>${stats.maxDegree}</b>`,
      `Min degree: <b>${stats.minDegree}</b>`,
      `Collected nodes: <b>${state.collectedNodes.length}</b>`,
      `All nodes: <b>${state.allNodesAllFloors.length}</b>`,
      `Walls: <b>${state.wallObjects.length}</b>`,
      `Traffic zones: <b>${state.allTrafficZones.length}</b>`,
    ].join('<br>')
  })
  c.appendChild(row([btn('↻', () => refreshAll())]))
  return c
}

// ─── Section: Navigation ──────────────────────────────────────────────────

function buildNav(): HTMLElement {
  const c = document.createElement('div')
  c.appendChild(
    row([btn('Floor 1', () => clickFloorBtn('1')), btn('Floor 2', () => clickFloorBtn('2'))])
  )
  return c
}

function clickFloorBtn(floorId: string): void {
  const btn = document.querySelector<HTMLButtonElement>(`.floor-btn[data-floor="${floorId}"]`)
  if (btn) btn.click()
}

// ─── Section: Actions ─────────────────────────────────────────────────────

function buildActions(): HTMLElement {
  const c = document.createElement('div')
  c.appendChild(
    row([
      btn('Reload data', () => {
        void reloadAll()
      }),
      btn('Export floor', () => exportFloorData()),
      btn('Clear cache', () => {
        void (async () => {
          if ('caches' in window) {
            const keys = await caches.keys()
            for (const key of keys) {
              if (key.includes('workbox') || key.includes('fremd') || key.includes('sw')) {
                await caches.delete(key)
              }
            }
          }
          window.location.reload()
        })()
      }),
      btn('Clear storage', () => {
        localStorage.clear()
        window.location.reload()
      }),
    ])
  )
  return c
}

function exportFloorData(): void {
  const floor = state.currentFloor
  if (!floor) return

  // Serialize nodes for this floor (strip internal fields)
  const nodes = state.allNodesAllFloors
    .filter((n) => n.floor === floor)
    .map((n) => {
      const obj: Record<string, unknown> = {
        uid: n.uid,
        rooms: n.rooms,
        lat: n.lat,
        lng: n.lng,
      }
      if (n.type) obj.type = n.type
      if (n.bathroomType) obj.bathroomType = n.bathroomType
      if (n.category) obj.category = n.category
      if (n.connectsTo && n.connectsTo.length > 0) obj.connectsTo = n.connectsTo
      return obj
    })

  // Convert walls back to raw [[lat,lng],[lat,lng]] format
  const walls: number[][][] = []
  for (const w of state.wallObjects) {
    if (w.floor && w.floor !== floor) continue
    walls.push([
      [w.start.lat, w.start.lng],
      [w.end.lat, w.end.lng],
    ])
  }

  // Serialize zones for this floor
  const zones = state.allTrafficZones
    .filter((z) => z.floor === floor)
    .map((z) => ({
      uid: z.uid,
      floor: z.floor,
      bounds: z.bounds,
      intensity: z.intensity,
    }))

  downloadJson(nodes, `floor${floor}/nodes.json`, `export-nodes-floor${floor}.json`)
  downloadJson(walls, `floor${floor}/walls.json`, `export-walls-floor${floor}.json`)
  downloadJson(zones, `floor${floor}/zones.json`, `export-zones-floor${floor}.json`)
  logger.log(`[Dev] Exported floor ${floor} data (3 files)`)
}

function downloadJson(data: unknown, _pathHint: string, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function reloadAll(): Promise<void> {
  const { loadAllNodesAllFloors, loadAllFloorsWalls, loadAllFloorsZones } =
    await import('../map/map-init')
  try {
    state.allNodesAllFloors = await loadAllNodesAllFloors()
    state.wallObjects = await loadAllFloorsWalls()
    state.allTrafficZones = await loadAllFloorsZones()
    state.hasLoadedGlobalNavigationData = true
    markNavigationDataChanged()
    await _cb.initializeNavigation()
    logger.log('[Dev] Data reloaded and graph rebuilt')
    refreshAll()
  } catch (err) {
    logger.error('[Dev] Data reload failed:', err)
  }
}

// ─── Section: Storage Viewer ──────────────────────────────────────────────

function buildStorageViewer(): HTMLElement {
  const c = document.createElement('div')
  registerLive(c, () => {
    const items: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) {
        let val = localStorage.getItem(key) ?? ''
        val = val.length > 60 ? val.slice(0, 60) + '…' : val
        items.push(`${escHtml(key)}: <span style="color:#9895a3">${escHtml(val)}</span>`)
      }
    }
    return items.length > 0 ? items.join('<br>') : '<span style="color:#5c5970">(empty)</span>'
  })
  c.appendChild(
    row([
      btn('↻', () => refreshAll()),
      btn('Clear all', () => {
        localStorage.clear()
        refreshAll()
      }),
    ])
  )
  return c
}

// ─── Section: Pathfinding Tweaks ──────────────────────────────────────────

function buildPathTweaks(): HTMLElement {
  const c = document.createElement('div')
  c.style.display = 'flex'
  c.style.flexDirection = 'column'
  c.style.gap = '4px'

  // MAX_HALLWAY_DISTANCE slider
  const distLabel = document.createElement('div')
  distLabel.style.fontSize = '10px'
  distLabel.style.color = '#9895a3'
  const distSlider = document.createElement('input')
  distSlider.type = 'range'
  distSlider.min = '200'
  distSlider.max = '2000'
  distSlider.value = String(MAP_CONFIG.MAX_HALLWAY_DISTANCE)
  distSlider.style.width = '100%'
  distSlider.style.accentColor = '#f0a500'
  const updateDistLabel = () => {
    distLabel.textContent = `MAX_HALLWAY_DISTANCE: ${distSlider.value}px`
  }
  updateDistLabel()
  distSlider.addEventListener('input', updateDistLabel)

  const applyBtn = btn('Apply & rebuild', () => {
    void (async () => {
      ;(MAP_CONFIG as { MAX_HALLWAY_DISTANCE: number }).MAX_HALLWAY_DISTANCE = Number(
        distSlider.value
      )
      markNavigationDataChanged()
      await _cb.initializeNavigation()
      refreshAll()
    })()
  })

  c.appendChild(distLabel)
  c.appendChild(distSlider)
  c.appendChild(applyBtn)
  return c
}

// ─── Section: Editor ──────────────────────────────────────────────────────

type EditMode =
  | 'none'
  | 'add-node'
  | 'edit-node'
  | 'delete-node'
  | 'add-wall'
  | 'edit-wall'
  | 'delete-wall'
  | 'add-zone'
  | 'edit-zone'
  | 'delete-zone'

let _editMode: EditMode = 'none'
let _editMarker: L.Marker | L.CircleMarker | null = null
let _zoneRect: L.Rectangle | null = null
let _zoneCorner1: { lat: number; lng: number } | null = null
let _highlightRect: L.Rectangle | null = null
let _wallLine: L.Polyline | null = null
let _wallPoint1: { lat: number; lng: number } | null = null
let _highlightWall: L.Polyline | null = null
let _modeLabel: HTMLElement | null = null

function setEditorMode(mode: EditMode): void {
  _editMode = mode
  if (_modeLabel) _modeLabel.textContent = `Mode: ${mode}`
  clearEditorState()
  if (state.map) {
    state.map.getContainer().style.cursor = mode === 'none' ? '' : 'crosshair'
  }
}

function buildEditor(): HTMLElement {
  const c = document.createElement('div')
  c.style.display = 'flex'
  c.style.flexDirection = 'column'
  c.style.gap = '4px'

  const modeLabel = document.createElement('div')
  modeLabel.style.fontSize = '10px'
  modeLabel.style.color = '#9895a3'
  _modeLabel = modeLabel

  const modeRow = row([
    btn('None', () => setEditorMode('none'), _btnStyle('none')),
    btn('+Node', () => setEditorMode('add-node'), _btnStyle('add-node')),
    btn('✎Node', () => setEditorMode('edit-node'), _btnStyle('edit-node')),
    btn('✕Node', () => setEditorMode('delete-node'), _btnStyle('delete-node')),
    btn('+Wall', () => setEditorMode('add-wall'), _btnStyle('add-wall')),
    btn('✎Wall', () => setEditorMode('edit-wall'), _btnStyle('edit-wall')),
    btn('✕Wall', () => setEditorMode('delete-wall'), _btnStyle('delete-wall')),
    btn('+Zone', () => setEditorMode('add-zone'), _btnStyle('add-zone')),
    btn('✎Zone', () => setEditorMode('edit-zone'), _btnStyle('edit-zone')),
    btn('✕Zone', () => setEditorMode('delete-zone'), _btnStyle('delete-zone')),
  ])

  const editorPanel = document.createElement('div')
  editorPanel.id = 'dev-editor-panel'
  editorPanel.style.cssText =
    'background:rgba(30,30,42,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px;font-size:10px;display:none'

  const zoneList = document.createElement('div')
  zoneList.id = 'dev-zone-list'
  zoneList.className = 'dev-live'
  zoneList.style.marginTop = '4px'

  c.appendChild(modeLabel)
  c.appendChild(modeRow)
  c.appendChild(editorPanel)
  c.appendChild(zoneList)
  return c
}

function refreshZoneList(): void {
  const list = $('#dev-zone-list')
  if (!list) return
  const zones = state.allTrafficZones.filter((z) => z.floor === state.currentFloor)
  if (zones.length === 0) {
    list.innerHTML = '<div style="color:#5c5970;font-size:10px">No zones on this floor</div>'
    return
  }
  list.innerHTML = zones
    .map(
      (z, i) =>
        `<div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:2px">
          <span style="color:#60a5fa;font-size:10px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(z.uid.slice(0, 8))}… ×${z.intensity}</span>
          <button class="dev-zone-edit" data-idx="${i}" style="background:none;border:1px solid rgba(96,165,250,0.3);color:#60a5fa;border-radius:4px;cursor:pointer;font-size:9px;padding:1px 5px">✎</button>
          <button class="dev-zone-del" data-idx="${i}" style="background:none;border:1px solid rgba(248,113,113,0.3);color:#f87171;border-radius:4px;cursor:pointer;font-size:9px;padding:1px 5px">✕</button>
        </div>`
    )
    .join('')
  const editBtns = list.querySelectorAll('.dev-zone-edit')
  for (let i = 0; i < editBtns.length; i++) {
    const idx = parseInt((editBtns[i] as HTMLElement).dataset.idx ?? '', 10)
    const zone = zones[idx]
    const btn = editBtns[i] as HTMLButtonElement
    btn.addEventListener('click', () => {
      setEditorMode('none')
      showEditZoneForm(zone)
    })
  }
  const delBtns = list.querySelectorAll('.dev-zone-del')
  for (let i = 0; i < delBtns.length; i++) {
    const idx = parseInt((delBtns[i] as HTMLElement).dataset.idx ?? '', 10)
    const zone = zones[idx]
    const btn = delBtns[i] as HTMLButtonElement
    btn.addEventListener('click', () => {
      setEditorMode('none')
      confirmDeleteZone(zone)
    })
  }
}

function _btnStyle(mode: EditMode): string {
  return _editMode === mode
    ? 'background:rgba(240,165,0,0.25);border:1px solid rgba(240,165,0,0.5);color:#ffca28;padding:3px 8px;border-radius:6px;cursor:pointer;font:inherit;font-size:inherit'
    : 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#e8e6e1;padding:3px 8px;border-radius:6px;cursor:pointer;font:inherit;font-size:inherit;transition:background-color .15s'
}

function clearEditorState(): void {
  clearHighlight()
  if (_editMarker && state.map) {
    state.map.removeLayer(_editMarker)
    _editMarker = null
  }
  if (_zoneRect && state.map) {
    state.map.removeLayer(_zoneRect)
    _zoneRect = null
  }
  _zoneCorner1 = null
  if (_wallLine && state.map) {
    state.map.removeLayer(_wallLine)
    _wallLine = null
  }
  _wallPoint1 = null
  clearWallHighlight()
  const panel = $('#dev-editor-panel')
  if (panel) panel.style.display = 'none'
}

function handleEditNodeClick(latlng: L.LatLng): void {
  const node = findNearestNode(latlng)
  if (!node) {
    logger.log('[Dev] No node near click point')
    return
  }
  showEditForm(node)
}

function handleDeleteNodeClick(latlng: L.LatLng): void {
  const node = findNearestNode(latlng)
  if (!node) {
    logger.log('[Dev] No node near click point')
    return
  }
  confirmDeleteNode(node)
}

function handleEditWallClick(latlng: L.LatLng): void {
  const wall = findNearestWall(latlng)
  if (!wall) {
    logger.log('[Dev] No wall near click point')
    return
  }
  highlightWall(wall)
  showEditWallForm(wall)
}

function handleDeleteWallClick(latlng: L.LatLng): void {
  const wall = findNearestWall(latlng)
  if (!wall) {
    logger.log('[Dev] No wall near click point')
    return
  }
  highlightWall(wall)
  confirmDeleteWall(wall)
}

function handleEditZoneClick(latlng: L.LatLng): void {
  const zone = findNearestZone(latlng)
  if (!zone) {
    logger.log('[Dev] No zone at click point')
    return
  }
  highlightZone(zone)
  showEditZoneForm(zone)
}

function handleDeleteZoneClick(latlng: L.LatLng): void {
  const zone = findNearestZone(latlng)
  if (!zone) {
    logger.log('[Dev] No zone at click point')
    return
  }
  highlightZone(zone)
  confirmDeleteZone(zone)
}

// ─── Zone Helpers ─────────────────────────────────────────────────────────

function findNearestZone(latlng: L.LatLng): TrafficZone | null {
  const floorZones = state.allTrafficZones.filter((z) => z.floor === state.currentFloor)
  for (const z of floorZones) {
    const { minLat, maxLat, minLng, maxLng } = z.bounds
    if (
      latlng.lat >= minLat &&
      latlng.lat <= maxLat &&
      latlng.lng >= minLng &&
      latlng.lng <= maxLng
    ) {
      return z
    }
  }
  return null
}

function highlightZone(zone: TrafficZone): void {
  if (!state.map) return
  if (_highlightRect) state.map.removeLayer(_highlightRect)
  const { minLat, minLng, maxLat, maxLng } = zone.bounds
  _highlightRect = L.rectangle(
    [
      [minLat, minLng],
      [maxLat, maxLng],
    ],
    {
      color: '#f0a500',
      weight: 3,
      fillColor: '#f0a500',
      fillOpacity: 0.15,
    }
  ).addTo(state.map)
}

function showEditZoneForm(zone: TrafficZone): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<form id="dev-edit-zone-form" style="display:flex;flex-direction:column;gap:4px">
  <div style="color:#9895a3">Edit zone <b>${escHtml(zone.uid.slice(0, 8))}…</b></div>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">
    Congestion (1–10):
    <input name="intensity" type="number" min="1" max="10" step="0.5" value="${zone.intensity}" style="width:60px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit">
  </label>
  <div style="color:#5c5970;font-size:9px">Bounds: ${zone.bounds.minLat.toFixed(0)},${zone.bounds.minLng.toFixed(0)} → ${zone.bounds.maxLat.toFixed(0)},${zone.bounds.maxLng.toFixed(0)}</div>
  <div style="display:flex;gap:4px">
    <button type="submit" style="flex:1;background:rgba(240,165,0,0.15);border:1px solid rgba(240,165,0,0.3);color:#ffca28;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Save</button>
    <button type="button" id="dev-edit-zone-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</form>
`
  const form = panel.querySelector('#dev-edit-zone-form') as HTMLFormElement
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    zone.intensity = parseFloat((fd.get('intensity') as string) || '2')
    markNavigationDataChanged()
    void _cb.initializeNavigation()
    clearHighlight()
    logger.log(`[Dev] Updated zone ${zone.uid} congestion=${zone.intensity}`)
    panel.style.display = 'none'
    refreshAll()
  })
  const cancel = panel.querySelector('#dev-edit-zone-cancel')
  cancel?.addEventListener('click', () => {
    clearHighlight()
    panel.style.display = 'none'
  })
}

function confirmDeleteZone(zone: TrafficZone): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<div style="display:flex;flex-direction:column;gap:6px">
  <div style="color:#f87171">Delete zone <b>${escHtml(zone.uid.slice(0, 8))}…</b> (×${zone.intensity})?</div>
  <div style="display:flex;gap:4px">
    <button id="dev-delete-zone-confirm" style="flex:1;background:rgba(248,113,113,0.15);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Delete</button>
    <button id="dev-delete-zone-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</div>
`
  const confirmBtn = panel.querySelector('#dev-delete-zone-confirm')
  confirmBtn?.addEventListener('click', () => {
    state.allTrafficZones = state.allTrafficZones.filter((z) => z.uid !== zone.uid)
    state.trafficZones = state.trafficZones.filter((z) => z.uid !== zone.uid)
    const rectIdx = state.trafficZoneRects.findIndex(
      (_, i) => state.trafficZones[i]?.uid === zone.uid
    )
    if (rectIdx !== -1 && state.map) {
      state.map.removeLayer(state.trafficZoneRects[rectIdx])
      state.trafficZoneRects.splice(rectIdx, 1)
    }
    markNavigationDataChanged()
    void _cb.initializeNavigation()
    clearHighlight()
    logger.log(`[Dev] Deleted zone ${zone.uid}`)
    panel.style.display = 'none'
    refreshAll()
  })
  const cancel = panel.querySelector('#dev-delete-zone-cancel')
  cancel?.addEventListener('click', () => {
    clearHighlight()
    panel.style.display = 'none'
  })
}

function clearHighlight(): void {
  if (_highlightRect && state.map) {
    state.map.removeLayer(_highlightRect)
    _highlightRect = null
  }
}

// ─── Wall Helpers ─────────────────────────────────────────────────────────

function findNearestWall(latlng: L.LatLng, threshold = 50): Wall | null {
  let nearest: Wall | null = null
  let nearestDistance = Infinity
  for (const wall of state.wallObjects) {
    if (wall.floor !== state.currentFloor) continue
    const distance = pointToSegmentDistance(latlng, wall.start, wall.end)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = wall
    }
  }
  return nearestDistance <= threshold ? nearest : null
}

function pointToSegmentDistance(point: L.LatLng, start: Wall['start'], end: Wall['end']): number {
  const deltaLat = end.lat - start.lat
  const deltaLng = end.lng - start.lng
  const lengthSquared = deltaLat ** 2 + deltaLng ** 2
  if (lengthSquared === 0) return Math.hypot(point.lat - start.lat, point.lng - start.lng)

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.lat - start.lat) * deltaLat + (point.lng - start.lng) * deltaLng) / lengthSquared
    )
  )
  return Math.hypot(
    point.lat - (start.lat + projection * deltaLat),
    point.lng - (start.lng + projection * deltaLng)
  )
}

function highlightWall(wall: Wall): void {
  if (!state.map) return
  clearWallHighlight()
  _highlightWall = L.polyline(
    [
      [wall.start.lat, wall.start.lng],
      [wall.end.lat, wall.end.lng],
    ],
    { color: '#f0a500', weight: 5, opacity: 0.9 }
  ).addTo(state.map)
}

function clearWallHighlight(): void {
  if (_highlightWall && state.map) {
    state.map.removeLayer(_highlightWall)
    _highlightWall = null
  }
}

function applyWallChanges(): void {
  state.collectedWalls = state.wallObjects
    .filter((wall) => wall.floor === state.currentFloor)
    .map((wall) => [
      [wall.start.lat, wall.start.lng],
      [wall.end.lat, wall.end.lng],
    ])
  markNavigationDataChanged()
  void _cb.initializeNavigation()
  overlayControls?.refresh()
  refreshAll()
}

function handleWallClick(latlng: L.LatLng): void {
  if (!state.map) return

  if (_wallPoint1 === null) {
    _wallPoint1 = { lat: latlng.lat, lng: latlng.lng }
    _wallLine = L.polyline([[latlng.lat, latlng.lng]], {
      color: '#f87171',
      weight: 5,
      opacity: 0.8,
      dashArray: '6 4',
    }).addTo(state.map)
    logger.log('[Dev] Wall start set — click the other endpoint')
    return
  }

  const start = _wallPoint1
  const end = { lat: latlng.lat, lng: latlng.lng }
  _wallLine?.setLatLngs([
    [start.lat, start.lng],
    [end.lat, end.lng],
  ])
  showAddWallForm(start, end)
}

function showAddWallForm(start: Wall['start'], end: Wall['end']): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<form id="dev-add-wall-form" style="display:flex;flex-direction:column;gap:4px">
  <div style="color:#9895a3">New wall on Floor ${escHtml(state.currentFloor)}</div>
  <div style="color:#5c5970;font-size:9px">${start.lat.toFixed(1)}, ${start.lng.toFixed(1)} → ${end.lat.toFixed(1)}, ${end.lng.toFixed(1)}</div>
  <div style="display:flex;gap:4px">
    <button type="submit" style="flex:1;background:rgba(248,113,113,0.15);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Add wall</button>
    <button type="button" id="dev-add-wall-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</form>
`
  const form = panel.querySelector('#dev-add-wall-form') as HTMLFormElement
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    state.wallObjects.push({ start, end, floor: state.currentFloor })
    if (_wallLine && state.map) state.map.removeLayer(_wallLine)
    _wallLine = null
    _wallPoint1 = null
    panel.style.display = 'none'
    applyWallChanges()
    logger.log(`[Dev] Added wall from ${start.lat},${start.lng} to ${end.lat},${end.lng}`)
  })
  panel.querySelector('#dev-add-wall-cancel')?.addEventListener('click', () => {
    clearEditorState()
  })
}

function showEditWallForm(wall: Wall): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<form id="dev-edit-wall-form" style="display:flex;flex-direction:column;gap:4px">
  <div style="color:#9895a3">Edit wall endpoints</div>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">Start lat <input name="startLat" value="${wall.start.lat}" style="width:84px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit"></label>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">Start lng <input name="startLng" value="${wall.start.lng}" style="width:84px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit"></label>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">End lat <input name="endLat" value="${wall.end.lat}" style="width:84px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit"></label>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">End lng <input name="endLng" value="${wall.end.lng}" style="width:84px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit"></label>
  <div style="display:flex;gap:4px">
    <button type="submit" style="flex:1;background:rgba(240,165,0,0.15);border:1px solid rgba(240,165,0,0.3);color:#ffca28;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Save</button>
    <button type="button" id="dev-edit-wall-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</form>
`
  const form = panel.querySelector('#dev-edit-wall-form') as HTMLFormElement
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const values = new FormData(form)
    const startLat = Number(values.get('startLat'))
    const startLng = Number(values.get('startLng'))
    const endLat = Number(values.get('endLat'))
    const endLng = Number(values.get('endLng'))
    if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) return

    wall.start = { lat: startLat, lng: startLng }
    wall.end = { lat: endLat, lng: endLng }
    panel.style.display = 'none'
    clearWallHighlight()
    applyWallChanges()
    logger.log('[Dev] Updated wall endpoints')
  })
  panel.querySelector('#dev-edit-wall-cancel')?.addEventListener('click', () => {
    clearWallHighlight()
    panel.style.display = 'none'
  })
}

function confirmDeleteWall(wall: Wall): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<div style="display:flex;flex-direction:column;gap:6px">
  <div style="color:#f87171">Delete this wall segment?</div>
  <div style="display:flex;gap:4px">
    <button id="dev-delete-wall-confirm" style="flex:1;background:rgba(248,113,113,0.15);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Delete</button>
    <button id="dev-delete-wall-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</div>
`
  panel.querySelector('#dev-delete-wall-confirm')?.addEventListener('click', () => {
    state.wallObjects = state.wallObjects.filter((candidate) => candidate !== wall)
    panel.style.display = 'none'
    clearWallHighlight()
    applyWallChanges()
    logger.log('[Dev] Deleted wall')
  })
  panel.querySelector('#dev-delete-wall-cancel')?.addEventListener('click', () => {
    clearWallHighlight()
    panel.style.display = 'none'
  })
}

export function handleMapClick(latlng: L.LatLng): void {
  if (_editMode === 'none' || _editMode === 'add-node') {
    if (_editMode === 'add-node') showNodeForm(latlng)
    return
  }
  if (_editMode === 'add-zone') {
    handleZoneClick(latlng)
    return
  }
  if (_editMode === 'edit-node') {
    handleEditNodeClick(latlng)
    return
  }
  if (_editMode === 'delete-node') {
    handleDeleteNodeClick(latlng)
    return
  }
  if (_editMode === 'add-wall') {
    handleWallClick(latlng)
    return
  }
  if (_editMode === 'edit-wall') {
    handleEditWallClick(latlng)
    return
  }
  if (_editMode === 'delete-wall') {
    handleDeleteWallClick(latlng)
    return
  }
  if (_editMode === 'edit-zone') {
    handleEditZoneClick(latlng)
    return
  }
  handleDeleteZoneClick(latlng)
}

function findNearestNode(latlng: L.LatLng, threshold = 80): Node | null {
  let best: Node | null = null
  let bestDist = Infinity
  for (const n of state.collectedNodes) {
    const d = Math.sqrt((n.lat - latlng.lat) ** 2 + (n.lng - latlng.lng) ** 2)
    if (d < bestDist) {
      bestDist = d
      best = n
    }
  }
  return bestDist <= threshold ? best : null
}

// ─── Add Node Form ────────────────────────────────────────────────────────

function showNodeForm(latlng: L.LatLng): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<form id="dev-add-node-form" style="display:flex;flex-direction:column;gap:4px">
  <div style="color:#9895a3">Add node at ${latlng.lat.toFixed(1)}, ${latlng.lng.toFixed(1)}</div>
  <input name="rooms" placeholder="Room names (comma-separated)" style="background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;color:#e8e6e1;font:inherit">
  <select name="type" style="background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;color:#e8e6e1;font:inherit">
    <option value="room">Room</option>
    <option value="waypoint">Waypoint</option>
    <option value="bathroom">Bathroom</option>
    <option value="stairway">Stairway</option>
  </select>
  <div style="display:flex;gap:4px">
    <button type="submit" style="flex:1;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.3);color:#4ade80;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Add</button>
    <button type="button" id="dev-add-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</form>
`
  const form = panel.querySelector('#dev-add-node-form') as HTMLFormElement
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const roomsRaw = (fd.get('rooms') as string) || ''
    const nodeType = (fd.get('type') as string) || 'room'
    const rooms = roomsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const newNode: Node = {
      uid: uuid(),
      rooms: rooms.length > 0 ? rooms : ['New Node'],
      lat: latlng.lat,
      lng: latlng.lng,
      type: nodeType as Node['type'],
      floor: state.currentFloor,
    }

    state.collectedNodes.push(newNode)
    state.allNodesAllFloors.push(newNode)
    markNavigationDataChanged()
    void _cb.initializeNavigation()
    logger.log(`[Dev] Added node ${newNode.uid} at ${newNode.lat},${newNode.lng}`)
    panel.style.display = 'none'
    refreshAll()
  })
  const cancel = panel.querySelector('#dev-add-cancel')
  cancel?.addEventListener('click', () => {
    panel.style.display = 'none'
  })
}

// ─── Edit Node Form ───────────────────────────────────────────────────────

function showEditForm(node: Node): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<form id="dev-edit-node-form" style="display:flex;flex-direction:column;gap:4px">
  <div style="color:#9895a3">Edit node <b>${escHtml(node.uid)}</b></div>
  <input name="rooms" value="${escHtml(node.rooms.join(', '))}" placeholder="Room names" style="background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;color:#e8e6e1;font:inherit">
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">
    Lat: <input name="lat" value="${node.lat}" style="width:80px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit">
  </label>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">
    Lng: <input name="lng" value="${node.lng}" style="width:80px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit">
  </label>
  <select name="type" style="background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:3px 6px;color:#e8e6e1;font:inherit">
    ${['room', 'waypoint', 'bathroom', 'stairway']
      .map((t) => `<option value="${t}"${t === node.type ? ' selected' : ''}>${t}</option>`)
      .join('')}
  </select>
  <div style="display:flex;gap:4px">
    <button type="submit" style="flex:1;background:rgba(240,165,0,0.15);border:1px solid rgba(240,165,0,0.3);color:#ffca28;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Save</button>
    <button type="button" id="dev-edit-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</form>
`
  const form = panel.querySelector('#dev-edit-node-form') as HTMLFormElement
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const rooms = ((fd.get('rooms') as string) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const lat = parseFloat(fd.get('lat') as string)
    const lng = parseFloat(fd.get('lng') as string)
    const nodeType = (fd.get('type') as string) || 'room'

    if (!isNaN(lat)) node.lat = lat
    if (!isNaN(lng)) node.lng = lng
    if (rooms.length > 0) node.rooms = rooms
    node.type = nodeType as Node['type']

    markNavigationDataChanged()
    void _cb.initializeNavigation()
    logger.log(`[Dev] Updated node ${node.uid}`)
    panel.style.display = 'none'
    refreshAll()
  })
  const cancel = panel.querySelector('#dev-edit-cancel')
  cancel?.addEventListener('click', () => {
    panel.style.display = 'none'
  })
}

// ─── Delete Node ──────────────────────────────────────────────────────────

function confirmDeleteNode(node: Node): void {
  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<div style="display:flex;flex-direction:column;gap:6px">
  <div style="color:#f87171">Delete node <b>${escHtml(node.uid)}</b> (${escHtml(node.rooms.join(', '))})?</div>
  <div style="display:flex;gap:4px">
    <button id="dev-delete-confirm" style="flex:1;background:rgba(248,113,113,0.15);border:1px solid rgba(248,113,113,0.3);color:#f87171;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Delete</button>
    <button id="dev-delete-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</div>
`
  const confirmBtn = panel.querySelector('#dev-delete-confirm')
  confirmBtn?.addEventListener('click', () => {
    state.collectedNodes = state.collectedNodes.filter((n) => n.uid !== node.uid)
    state.allNodesAllFloors = state.allNodesAllFloors.filter((n) => n.uid !== node.uid)
    markNavigationDataChanged()
    void _cb.initializeNavigation()
    logger.log(`[Dev] Deleted node ${node.uid}`)
    panel.style.display = 'none'
    refreshAll()
  })
  const cancel = panel.querySelector('#dev-delete-cancel')
  cancel?.addEventListener('click', () => {
    panel.style.display = 'none'
  })
}

// ─── Add Zone ─────────────────────────────────────────────────────────────

function handleZoneClick(latlng: L.LatLng): void {
  if (!state.map) return

  if (!_zoneCorner1) {
    _zoneCorner1 = { lat: latlng.lat, lng: latlng.lng }
    if (_editMarker) state.map.removeLayer(_editMarker)
    _editMarker = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 6,
      color: '#60a5fa',
      fillColor: '#60a5fa',
      fillOpacity: 0.5,
    }).addTo(state.map)
    logger.log('[Dev] First corner set — click opposite corner')
    return
  }

  const c1 = _zoneCorner1
  const minLat = Math.min(c1.lat, latlng.lat)
  const maxLat = Math.max(c1.lat, latlng.lat)
  const minLng = Math.min(c1.lng, latlng.lng)
  const maxLng = Math.max(c1.lng, latlng.lng)

  if (_editMarker) {
    state.map.removeLayer(_editMarker)
    _editMarker = null
  }

  const rect = L.rectangle(
    [
      [minLat, minLng],
      [maxLat, maxLng],
    ],
    { color: '#60a5fa', weight: 2, fillOpacity: 0.15 }
  ).addTo(state.map)
  _zoneRect = rect

  const panel = $('#dev-editor-panel')
  if (!panel) return
  panel.style.display = 'block'
  panel.innerHTML = `
<form id="dev-add-zone-form" style="display:flex;flex-direction:column;gap:4px">
  <div style="color:#9895a3">New zone</div>
  <label style="display:flex;gap:4px;align-items:center;color:#9895a3;font-size:10px">
    Congestion (1–10):
    <input name="intensity" type="number" min="1" max="10" step="0.5" value="2" style="width:60px;background:#16161e;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 4px;color:#e8e6e1;font:inherit">
  </label>
  <div style="display:flex;gap:4px">
    <button type="submit" style="flex:1;background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.3);color:#60a5fa;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Save</button>
    <button type="button" id="dev-zone-cancel" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#9895a3;padding:3px 8px;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>
  </div>
</form>
`
  const form = panel.querySelector('#dev-add-zone-form') as HTMLFormElement
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const intensity = parseFloat((fd.get('intensity') as string) || '2')

    const zone: TrafficZone = {
      uid: uuid(),
      floor: state.currentFloor,
      bounds: { minLat, minLng, maxLat, maxLng },
      intensity,
    }
    state.allTrafficZones.push(zone)
    state.trafficZones.push(zone)
    if (_zoneRect && state.map) {
      state.trafficZoneRects.push(_zoneRect)
    }
    _zoneRect = null
    _zoneCorner1 = null

    markNavigationDataChanged()
    void _cb.initializeNavigation()
    logger.log(`[Dev] Added zone ${zone.uid} congestion=${intensity}`)
    panel.style.display = 'none'
    refreshAll()
  })
  const cancel = panel.querySelector('#dev-zone-cancel')
  cancel?.addEventListener('click', () => {
    if (_zoneRect && state.map) {
      state.map.removeLayer(_zoneRect)
      _zoneRect = null
    }
    _zoneCorner1 = null
    panel.style.display = 'none'
  })
}
