import { FLOORS, MAP_CONFIG, getDataUrl } from '../utils/constants'
import { convertWallData } from '../utils/geometry'
import { graphLogger, logger } from '../utils/logger'
import type { Node, TrafficZone, Wall } from '../utils/types'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
type JsonInput = JsonValue | undefined
interface JsonObject {
  [key: string]: JsonValue | undefined
}

export interface NavigationSnapshot {
  revision: number
  scope: 'complete' | 'limited'
  floors: readonly string[]
  nodes: readonly Node[]
  walls: readonly Wall[]
  zones: readonly TrafficZone[]
}

export type NavigationEdit =
  | { type: 'add-node'; node: Node }
  | { type: 'update-node'; uid: string; changes: Partial<Node> }
  | { type: 'remove-node'; uid: string }
  | { type: 'add-wall'; wall: Wall }
  | { type: 'update-wall'; wall: Wall; replacement: Wall }
  | { type: 'remove-wall'; wall: Wall }
  | { type: 'add-zone'; zone: TrafficZone }
  | { type: 'update-zone'; uid: string; changes: Partial<TrafficZone> }
  | { type: 'remove-zone'; uid: string }

export type NavigationDataListener = (
  snapshot: NavigationSnapshot,
  reason: 'load' | 'reload' | 'edit'
) => void
export type NavigationEditGuard = (
  candidate: NavigationSnapshot,
  previous: NavigationSnapshot
) => Promise<void>

export interface NavigationData {
  getSnapshot(): NavigationSnapshot | null
  getFloor(floorId: string): { nodes: Node[]; walls: Wall[]; zones: TrafficZone[] }
  load(preferredFloor: string, signal?: AbortSignal): Promise<NavigationSnapshot>
  reload(preferredFloor: string, signal?: AbortSignal): Promise<NavigationSnapshot>
  applyEdit(edit: NavigationEdit): Promise<NavigationSnapshot>
  subscribe(listener: NavigationDataListener): () => void
  addEditGuard(guard: NavigationEditGuard): () => void
}

interface NavigationDataOptions {
  fetch?: NavigationFetch
}

export type NavigationFetch = (url: string, init?: RequestInit) => Promise<Response>

function isObject(value: JsonInput): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: JsonInput): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isString(value: JsonInput): value is string {
  return Object.prototype.toString.call(value) === '[object String]'
}

function assertNumber(value: JsonInput, label: string): number {
  if (!isFiniteNumber(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function assertString(value: JsonInput, label: string): string {
  if (!isString(value) || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function assertBounds(lat: number, lng: number, label: string): void {
  if (lat < -MAP_CONFIG.IMAGE_HEIGHT || lat > 0)
    throw new Error(`${label}.lat is outside map bounds`)
  if (lng < 0 || lng > MAP_CONFIG.IMAGE_WIDTH) throw new Error(`${label}.lng is outside map bounds`)
}

const NODE_TYPES: ReadonlyArray<NonNullable<Node['type']>> = [
  'room',
  'waypoint',
  'bathroom',
  'stairway',
]
const BATHROOM_TYPES: ReadonlyArray<NonNullable<Node['bathroomType']>> = [
  'all-gender',
  'mens',
  'womens',
  'accessible',
]
const CATEGORIES: ReadonlyArray<NonNullable<Node['category']>> = [
  'classroom',
  'office',
  'lab',
  'bathroom',
  'cafeteria',
  'gymnasium',
  'library',
  'auditorium',
  'stairway',
  'entrance',
  'other',
]

function isNodeType(value: string): value is NonNullable<Node['type']> {
  return NODE_TYPES.some((candidate) => candidate === value)
}

function isBathroomType(value: string): value is NonNullable<Node['bathroomType']> {
  return BATHROOM_TYPES.some((candidate) => candidate === value)
}

function isCategory(value: string): value is NonNullable<Node['category']> {
  return CATEGORIES.some((candidate) => candidate === value)
}

function parseStringArray(value: JsonInput, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`)
  }
  return value.map((item, index) => assertString(item, `${label}[${index}]`))
}

function parseNodes(value: JsonValue, floorId: string, label: string): Node[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`
    if (!isObject(entry)) throw new Error(`${itemLabel} must be an object`)
    const uid = assertString(entry.uid, `${itemLabel}.uid`)
    if (seen.has(uid))
      throw new Error(`${itemLabel}.uid duplicates another node on floor ${floorId}: ${uid}`)
    seen.add(uid)
    const lat = assertNumber(entry.lat, `${itemLabel}.lat`)
    const lng = assertNumber(entry.lng, `${itemLabel}.lng`)
    assertBounds(lat, lng, itemLabel)
    const node: Node = {
      uid,
      lat,
      lng,
      rooms: parseStringArray(entry.rooms, `${itemLabel}.rooms`),
      floor: floorId,
    }
    if (entry.type !== undefined) {
      const type = assertString(entry.type, `${itemLabel}.type`)
      if (!isNodeType(type)) throw new Error(`${itemLabel}.type is invalid`)
      node.type = type
    }
    if (entry.searchAliases !== undefined)
      node.searchAliases = parseStringArray(entry.searchAliases, `${itemLabel}.searchAliases`, true)
    if (entry.connectsTo !== undefined)
      node.connectsTo = parseStringArray(entry.connectsTo, `${itemLabel}.connectsTo`, true)
    if (entry.bathroomType !== undefined) {
      const bathroomType = assertString(entry.bathroomType, `${itemLabel}.bathroomType`)
      if (!isBathroomType(bathroomType)) throw new Error(`${itemLabel}.bathroomType is invalid`)
      node.bathroomType = bathroomType
    }
    if (entry.category !== undefined) {
      const category = assertString(entry.category, `${itemLabel}.category`)
      if (!isCategory(category)) throw new Error(`${itemLabel}.category is invalid`)
      node.category = category
    }
    return node
  })
}

function parseWalls(value: JsonValue, label: string): number[][][] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`
    if (!Array.isArray(entry) || entry.length < 2) {
      throw new Error(`${itemLabel} must be a polyline with at least 2 points`)
    }
    const points = entry.map((point, pointIndex) => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw new Error(`${itemLabel}[${pointIndex}] must be [lat, lng]`)
      }
      const lat = assertNumber(point[0], `${itemLabel}[${pointIndex}].lat`)
      const lng = assertNumber(point[1], `${itemLabel}[${pointIndex}].lng`)
      assertBounds(lat, lng, `${itemLabel}[${pointIndex}]`)
      return [lat, lng]
    })
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      if (
        points[pointIndex - 1][0] === points[pointIndex][0] &&
        points[pointIndex - 1][1] === points[pointIndex][1]
      ) {
        throw new Error(`${itemLabel} contains a degenerate segment`)
      }
    }
    return points
  })
}

function parseZones(value: JsonValue, floorId: string, label: string): TrafficZone[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`
    if (!isObject(entry)) throw new Error(`${itemLabel} must be an object`)
    const uid = assertString(entry.uid, `${itemLabel}.uid`)
    if (seen.has(uid))
      throw new Error(`${itemLabel}.uid duplicates another zone on floor ${floorId}: ${uid}`)
    seen.add(uid)
    const floor = assertString(entry.floor, `${itemLabel}.floor`)
    if (floor !== floorId) throw new Error(`${itemLabel}.floor must equal ${floorId}`)
    if (!isObject(entry.bounds)) throw new Error(`${itemLabel}.bounds must be an object`)
    const bounds = {
      minLat: assertNumber(entry.bounds.minLat, `${itemLabel}.bounds.minLat`),
      minLng: assertNumber(entry.bounds.minLng, `${itemLabel}.bounds.minLng`),
      maxLat: assertNumber(entry.bounds.maxLat, `${itemLabel}.bounds.maxLat`),
      maxLng: assertNumber(entry.bounds.maxLng, `${itemLabel}.bounds.maxLng`),
    }
    assertBounds(bounds.minLat, bounds.minLng, `${itemLabel}.bounds.min`)
    assertBounds(bounds.maxLat, bounds.maxLng, `${itemLabel}.bounds.max`)
    if (bounds.minLat > bounds.maxLat || bounds.minLng > bounds.maxLng) {
      throw new Error(`${itemLabel}.bounds must satisfy min <= max`)
    }
    const intensity = assertNumber(entry.intensity, `${itemLabel}.intensity`)
    if (intensity < 1 || intensity > 10)
      throw new Error(`${itemLabel}.intensity must be in range [1, 10]`)
    return { uid, floor, bounds, intensity }
  })
}

async function readJson(response: Response): Promise<JsonValue> {
  // SAFETY: the navigation-data parsers validate every value before domain use.
  return (await response.json()) as JsonValue
}

function cloneSnapshot(snapshot: NavigationSnapshot): NavigationSnapshot {
  return {
    ...snapshot,
    floors: [...snapshot.floors],
    nodes: structuredClone(snapshot.nodes),
    walls: structuredClone(snapshot.walls),
    zones: structuredClone(snapshot.zones),
  }
}

function sameWall(left: Wall, right: Wall): boolean {
  return (
    left.floor === right.floor &&
    left.start.lat === right.start.lat &&
    left.start.lng === right.start.lng &&
    left.end.lat === right.end.lat &&
    left.end.lng === right.end.lng
  )
}

function assertKnownFloor(
  floor: string | undefined,
  snapshot: NavigationSnapshot,
  label: string
): void {
  if (!floor || !snapshot.floors.includes(floor)) {
    throw new Error(`${label}.floor must belong to this navigation revision`)
  }
}

function validateSnapshot(snapshot: NavigationSnapshot): void {
  const nodeUids = new Set<string>()
  const zoneUids = new Set<string>()

  for (const node of snapshot.nodes) {
    const label = `Node ${node.uid}`
    const uid = assertString(node.uid, `${label}.uid`)
    assertKnownFloor(node.floor, snapshot, label)
    assertBounds(
      assertNumber(node.lat, `${label}.lat`),
      assertNumber(node.lng, `${label}.lng`),
      label
    )
    parseStringArray(node.rooms, `${label}.rooms`)
    if (node.searchAliases) parseStringArray(node.searchAliases, `${label}.searchAliases`, true)
    if (node.connectsTo) parseStringArray(node.connectsTo, `${label}.connectsTo`, true)
    if (nodeUids.has(uid)) throw new Error(`Node UID is duplicated: ${uid}`)
    nodeUids.add(uid)
  }
  for (const wall of snapshot.walls) {
    assertKnownFloor(wall.floor, snapshot, 'Wall')
    assertBounds(
      assertNumber(wall.start.lat, 'Wall.start.lat'),
      assertNumber(wall.start.lng, 'Wall.start.lng'),
      'Wall.start'
    )
    assertBounds(
      assertNumber(wall.end.lat, 'Wall.end.lat'),
      assertNumber(wall.end.lng, 'Wall.end.lng'),
      'Wall.end'
    )
    if (wall.start.lat === wall.end.lat && wall.start.lng === wall.end.lng) {
      throw new Error('Wall must not contain a degenerate segment')
    }
  }
  for (const zone of snapshot.zones) {
    const label = `Zone ${zone.uid}`
    const uid = assertString(zone.uid, `${label}.uid`)
    assertKnownFloor(zone.floor, snapshot, label)
    const { minLat, minLng, maxLat, maxLng } = zone.bounds
    assertBounds(
      assertNumber(minLat, `${label}.bounds.minLat`),
      assertNumber(minLng, `${label}.bounds.minLng`),
      `${label}.bounds.min`
    )
    assertBounds(
      assertNumber(maxLat, `${label}.bounds.maxLat`),
      assertNumber(maxLng, `${label}.bounds.maxLng`),
      `${label}.bounds.max`
    )
    if (minLat > maxLat || minLng > maxLng) {
      throw new Error(`${label}.bounds must satisfy min <= max`)
    }
    const intensity = assertNumber(zone.intensity, `${label}.intensity`)
    if (intensity < 1 || intensity > 10) {
      throw new Error(`${label}.intensity must be in range [1, 10]`)
    }
    if (zoneUids.has(uid)) throw new Error(`Zone UID is duplicated: ${uid}`)
    zoneUids.add(uid)
  }
}

function assertEditTarget(snapshot: NavigationSnapshot, edit: NavigationEdit): void {
  if (edit.type === 'add-node' && snapshot.nodes.some((node) => node.uid === edit.node.uid)) {
    throw new Error(`Node UID already exists: ${edit.node.uid}`)
  }
  if (
    (edit.type === 'update-node' || edit.type === 'remove-node') &&
    !snapshot.nodes.some((node) => node.uid === edit.uid)
  ) {
    throw new Error(`Node does not exist: ${edit.uid}`)
  }
  if (edit.type === 'add-zone' && snapshot.zones.some((zone) => zone.uid === edit.zone.uid)) {
    throw new Error(`Zone UID already exists: ${edit.zone.uid}`)
  }
  if (
    (edit.type === 'update-zone' || edit.type === 'remove-zone') &&
    !snapshot.zones.some((zone) => zone.uid === edit.uid)
  ) {
    throw new Error(`Zone does not exist: ${edit.uid}`)
  }
  if (
    (edit.type === 'update-wall' || edit.type === 'remove-wall') &&
    !snapshot.walls.some((wall) => sameWall(wall, edit.wall))
  ) {
    throw new Error('Wall does not exist')
  }
}

function applyEdit(
  snapshot: NavigationSnapshot,
  edit: NavigationEdit,
  revision: number
): NavigationSnapshot {
  const candidate = cloneSnapshot({ ...snapshot, revision })
  let nodes = [...candidate.nodes]
  let walls = [...candidate.walls]
  let zones = [...candidate.zones]
  switch (edit.type) {
    case 'add-node':
      nodes.push(structuredClone(edit.node))
      break
    case 'update-node':
      nodes = nodes.map((node) =>
        node.uid === edit.uid ? { ...node, ...structuredClone(edit.changes), uid: node.uid } : node
      )
      break
    case 'remove-node':
      nodes = nodes.filter((node) => node.uid !== edit.uid)
      break
    case 'add-wall':
      walls.push(structuredClone(edit.wall))
      break
    case 'update-wall':
      walls = walls.map((wall) =>
        sameWall(wall, edit.wall) ? structuredClone(edit.replacement) : wall
      )
      break
    case 'remove-wall':
      walls = walls.filter((wall) => !sameWall(wall, edit.wall))
      break
    case 'add-zone':
      zones.push(structuredClone(edit.zone))
      break
    case 'update-zone':
      zones = zones.map((zone) =>
        zone.uid === edit.uid ? { ...zone, ...structuredClone(edit.changes), uid: zone.uid } : zone
      )
      break
    case 'remove-zone':
      zones = zones.filter((zone) => zone.uid !== edit.uid)
      break
  }
  return { ...candidate, nodes, walls, zones }
}

export function createNavigationData(options: NavigationDataOptions = {}): NavigationData {
  const fetchData = options.fetch ?? globalThis.fetch.bind(globalThis)
  const listeners = new Set<NavigationDataListener>()
  const guards = new Set<NavigationEditGuard>()
  let snapshot: NavigationSnapshot | null = null
  let editQueue: Promise<void> = Promise.resolve()
  let nextRevision = 0

  const publish = (
    next: NavigationSnapshot,
    reason: 'load' | 'reload' | 'edit'
  ): NavigationSnapshot => {
    snapshot = next
    for (const listener of listeners) listener(next, reason)
    return next
  }

  const loadFloor = async (floorId: string, signal?: AbortSignal) => {
    const [nodesResponse, wallsResponse, zonesResponse] = await Promise.all([
      fetchData(getDataUrl(floorId, 'nodes'), { signal }),
      fetchData(getDataUrl(floorId, 'walls'), { signal }),
      fetchData(getDataUrl(floorId, 'zones'), { signal }),
    ])
    if (!nodesResponse.ok)
      throw new Error(`Failed to load floor ${floorId} nodes: ${nodesResponse.status}`)
    if (!wallsResponse.ok)
      throw new Error(`Failed to load floor ${floorId} walls: ${wallsResponse.status}`)
    const nodes = parseNodes(await readJson(nodesResponse), floorId, `floor${floorId}/nodes.json`)
    const walls = convertWallData(
      parseWalls(await readJson(wallsResponse), `floor${floorId}/walls.json`)
    ).map((wall) => ({ ...wall, floor: floorId }))
    const zones = zonesResponse.ok
      ? parseZones(await readJson(zonesResponse), floorId, `floor${floorId}/zones.json`)
      : []
    if (!zonesResponse.ok)
      logger.warn(`Failed to load zones for floor ${floorId}: ${zonesResponse.status}`)
    return { floorId, nodes, walls, zones }
  }

  const load = async (
    preferredFloor: string,
    signal: AbortSignal | undefined,
    reason: 'load' | 'reload'
  ) => {
    try {
      const floors = await Promise.all(FLOORS.AVAILABLE.map((floor) => loadFloor(floor.id, signal)))
      return publish(
        {
          revision: ++nextRevision,
          scope: 'complete',
          floors: floors.map((floor) => floor.floorId),
          nodes: floors.flatMap((floor) => floor.nodes),
          walls: floors.flatMap((floor) => floor.walls),
          zones: floors.flatMap((floor) => floor.zones),
        },
        reason
      )
    } catch (error) {
      if (signal?.aborted) throw error
      const previous = snapshot
      const canKeepSnapshot =
        previous &&
        (reason === 'reload' ||
          previous.scope === 'complete' ||
          previous.floors.includes(preferredFloor))
      if (canKeepSnapshot) {
        logger.error('Navigation-data reload failed; keeping the last coherent revision', error)
        return previous
      }
      graphLogger.warn('Complete navigation data unavailable; loading a limited revision', error)
      const floor = await loadFloor(preferredFloor, signal)
      return publish(
        {
          revision: ++nextRevision,
          scope: 'limited',
          floors: [preferredFloor],
          nodes: floor.nodes,
          walls: floor.walls,
          zones: floor.zones,
        },
        reason
      )
    }
  }

  return {
    getSnapshot: () => snapshot,
    getFloor: (floorId) => ({
      nodes:
        snapshot?.nodes
          .filter((node) => node.floor === floorId)
          .map((node) => structuredClone(node)) ?? [],
      walls:
        snapshot?.walls
          .filter((wall) => wall.floor === floorId)
          .map((wall) => structuredClone(wall)) ?? [],
      zones:
        snapshot?.zones
          .filter((zone) => zone.floor === floorId)
          .map((zone) => structuredClone(zone)) ?? [],
    }),
    load: (preferredFloor, signal) => {
      if (snapshot && (snapshot.scope === 'complete' || snapshot.floors.includes(preferredFloor))) {
        return Promise.resolve(snapshot)
      }
      return load(preferredFloor, signal, 'load')
    },
    reload: (preferredFloor, signal) => load(preferredFloor, signal, 'reload'),
    applyEdit(edit): Promise<NavigationSnapshot> {
      const commit = editQueue.then(async () => {
        if (!snapshot) throw new Error('Navigation data must be loaded before editing')
        const previous = snapshot
        assertEditTarget(previous, edit)
        const candidate = applyEdit(previous, edit, ++nextRevision)
        validateSnapshot(candidate)
        for (const guard of guards) await guard(candidate, previous)
        return publish(candidate, 'edit')
      })
      editQueue = commit.then(
        () => undefined,
        () => undefined
      )
      return commit
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addEditGuard(guard) {
      guards.add(guard)
      return () => guards.delete(guard)
    },
  }
}
