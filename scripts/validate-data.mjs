import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(process.cwd())
const NODE_TYPES = new Set(['room', 'waypoint', 'bathroom', 'stairway'])
const BATHROOM_TYPES = new Set(['all-gender', 'mens', 'womens', 'accessible'])
const ROOM_CATEGORIES = new Set([
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
])
const MAP_BOUNDS = {
  MIN_LAT: -4675,
  MAX_LAT: 0,
  MIN_LNG: 0,
  MAX_LNG: 6050,
}
const REPORT_MODE = process.argv.includes('--report=json')

function fail(message) {
  throw new Error(message)
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`)
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`)
  }
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  return JSON.parse(text)
}

function assertMapBounds(lat, lng, label) {
  if (lat < MAP_BOUNDS.MIN_LAT || lat > MAP_BOUNDS.MAX_LAT) {
    fail(`${label}.lat is outside map bounds [${MAP_BOUNDS.MIN_LAT}, ${MAP_BOUNDS.MAX_LAT}]`)
  }
  if (lng < MAP_BOUNDS.MIN_LNG || lng > MAP_BOUNDS.MAX_LNG) {
    fail(`${label}.lng is outside map bounds [${MAP_BOUNDS.MIN_LNG}, ${MAP_BOUNDS.MAX_LNG}]`)
  }
}

async function discoverFloors() {
  const dataRoot = resolve(ROOT, 'client/public/data')
  const entries = await readdir(dataRoot, { withFileTypes: true })
  const floorIds = entries
    .filter(entry => entry.isDirectory() && /^floor\d+$/.test(entry.name))
    .map(entry => entry.name.replace('floor', ''))
    .sort((a, b) => Number(a) - Number(b))

  if (floorIds.length === 0) {
    fail('No floor data directories found under client/public/data')
  }

  return floorIds
}

function validateNodes(floorId, nodes) {
  if (!Array.isArray(nodes)) {
    fail(`floor${floorId}/nodes.json must contain an array`)
  }

  const floorUidSet = new Set()

  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i]
    const label = `floor${floorId}/nodes.json[${i}]`
    assertObject(n, label)

    assertString(n.uid, `${label}.uid`)
    if (floorUidSet.has(n.uid)) {
      fail(`${label}.uid duplicates another node on floor${floorId}: ${n.uid}`)
    }
    floorUidSet.add(n.uid)

    if (!Array.isArray(n.rooms) || n.rooms.length === 0) {
      fail(`${label}.rooms must be a non-empty array`)
    }
    for (let r = 0; r < n.rooms.length; r += 1) {
      assertString(n.rooms[r], `${label}.rooms[${r}]`)
    }

    assertFiniteNumber(n.lat, `${label}.lat`)
    assertFiniteNumber(n.lng, `${label}.lng`)
    assertMapBounds(n.lat, n.lng, label)

    if (n.type !== undefined && !NODE_TYPES.has(n.type)) {
      fail(`${label}.type must be one of: ${Array.from(NODE_TYPES).join(', ')}`)
    }

    if (n.floor !== undefined && String(n.floor) !== floorId) {
      fail(`${label}.floor must match "${floorId}" when present`)
    }

    if (n.connectsTo !== undefined) {
      if (!Array.isArray(n.connectsTo)) {
        fail(`${label}.connectsTo must be an array when present`)
      }
      for (let c = 0; c < n.connectsTo.length; c += 1) {
        assertString(n.connectsTo[c], `${label}.connectsTo[${c}]`)
      }
    }

    if (n.bathroomType !== undefined) {
      assertString(n.bathroomType, `${label}.bathroomType`)
      if (!BATHROOM_TYPES.has(n.bathroomType)) {
        fail(`${label}.bathroomType must be one of: ${Array.from(BATHROOM_TYPES).join(', ')}`)
      }
    }

    if (n.category !== undefined) {
      assertString(n.category, `${label}.category`)
      if (!ROOM_CATEGORIES.has(n.category)) {
        fail(`${label}.category must be one of: ${Array.from(ROOM_CATEGORIES).join(', ')}`)
      }
    }
  }
}

function validateWalls(floorId, walls) {
  if (!Array.isArray(walls)) {
    fail(`floor${floorId}/walls.json must contain an array`)
  }

  for (let i = 0; i < walls.length; i += 1) {
    const polyline = walls[i]
    const label = `floor${floorId}/walls.json[${i}]`
    if (!Array.isArray(polyline) || polyline.length < 2) {
      fail(`${label} must be a polyline with at least 2 points`)
    }

    for (let p = 0; p < polyline.length; p += 1) {
      const point = polyline[p]
      const pointLabel = `${label}[${p}]`
      if (!Array.isArray(point) || point.length !== 2) {
        fail(`${pointLabel} must be [lat, lng]`)
      }
      assertFiniteNumber(point[0], `${pointLabel}[0]`)
      assertFiniteNumber(point[1], `${pointLabel}[1]`)
      assertMapBounds(point[0], point[1], pointLabel)
    }

    for (let p = 1; p < polyline.length; p += 1) {
      const start = polyline[p - 1]
      const end = polyline[p]
      if (start[0] === end[0] && start[1] === end[1]) {
        fail(`${label}[${p - 1}..${p}] is degenerate (consecutive points are identical)`)
      }
    }
  }
}

/** Expand on-disk wall polylines into individual line segments for geometry checks. */
function expandWallPolylines(walls) {
  return walls.flatMap((polyline, wallIndex) =>
    polyline.slice(1).map((point, pointIndex) => ({
      points: [polyline[pointIndex], point],
      wallIndex,
      segmentIndex: pointIndex,
    }))
  )
}

function validateZones(floorId, zones) {
  if (!Array.isArray(zones)) {
    fail(`floor${floorId}/zones.json must contain an array`)
  }

  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i]
    const label = `floor${floorId}/zones.json[${i}]`
    assertObject(zone, label)

    assertString(zone.uid, `${label}.uid`)
    if (String(zone.floor) !== floorId) {
      fail(`${label}.floor must equal "${floorId}"`)
    }

    assertObject(zone.bounds, `${label}.bounds`)
    assertFiniteNumber(zone.bounds.minLat, `${label}.bounds.minLat`)
    assertFiniteNumber(zone.bounds.minLng, `${label}.bounds.minLng`)
    assertFiniteNumber(zone.bounds.maxLat, `${label}.bounds.maxLat`)
    assertFiniteNumber(zone.bounds.maxLng, `${label}.bounds.maxLng`)

    assertMapBounds(zone.bounds.minLat, zone.bounds.minLng, `${label}.bounds.min`)
    assertMapBounds(zone.bounds.maxLat, zone.bounds.maxLng, `${label}.bounds.max`)

    if (zone.bounds.minLat > zone.bounds.maxLat) {
      fail(`${label}.bounds.minLat must be <= bounds.maxLat`)
    }
    if (zone.bounds.minLng > zone.bounds.maxLng) {
      fail(`${label}.bounds.minLng must be <= bounds.maxLng`)
    }

    assertFiniteNumber(zone.intensity, `${label}.intensity`)
    if (zone.intensity < 1 || zone.intensity > 10) {
      fail(`${label}.intensity must be in range [1, 10]`)
    }
  }
}

function validateCrossFloorIntegrity(floorsData) {
  const allNodes = []
  const seenGlobalUids = new Set()

  for (const { floorId, nodes, zones } of floorsData) {
    const zoneUidSet = new Set()
    for (let i = 0; i < zones.length; i += 1) {
      const zone = zones[i]
      const label = `floor${floorId}/zones.json[${i}]`
      if (zoneUidSet.has(zone.uid)) {
        fail(`${label}.uid duplicates another zone on floor${floorId}: ${zone.uid}`)
      }
      zoneUidSet.add(zone.uid)
    }

    for (const node of nodes) {
      if (seenGlobalUids.has(node.uid)) {
        fail(`Node UID is duplicated across floors: ${node.uid}`)
      }
      seenGlobalUids.add(node.uid)
      allNodes.push({ ...node, floor: floorId })
    }
  }

  const stairways = allNodes.filter(node => node.type === 'stairway')
  const byUid = new Map(allNodes.map(node => [node.uid, node]))

  for (const stairway of stairways) {
    if (!Array.isArray(stairway.connectsTo) || stairway.connectsTo.length === 0) {
      fail(`Stairway ${stairway.uid} (${stairway.rooms[0]}) has no connectsTo entries`)
    }

    for (const targetIdentifier of stairway.connectsTo) {
      let target = byUid.get(targetIdentifier)
      if (!target) {
        const candidates = stairways.filter(candidate =>
          candidate.floor !== stairway.floor &&
          candidate.rooms.some(room => room === targetIdentifier)
        )
        if (candidates.length > 1) {
          fail(`Stairway ${stairway.uid} has ambiguous connectsTo target "${targetIdentifier}"`)
        }
        target = candidates[0]
      }

      if (!target) {
        fail(`Stairway ${stairway.uid} references missing connectsTo target: ${targetIdentifier}`)
      }

      if (target.type !== 'stairway') {
        fail(`Stairway ${stairway.uid} connectsTo target ${target.uid} is not a stairway`)
      }

      if (target.uid === stairway.uid) {
        fail(`Stairway ${stairway.uid} cannot connect to itself`)
      }

      if (target.floor === stairway.floor) {
        fail(`Stairway ${stairway.uid} must connect to a different floor (target ${target.uid})`)
      }

      const targetLinks = Array.isArray(target.connectsTo) ? target.connectsTo : []
      const reciprocalByUid = targetLinks.includes(stairway.uid)
      const reciprocalByName = targetLinks.some(link => stairway.rooms.includes(link))
      if (!reciprocalByUid && !reciprocalByName) {
        fail(`Stairway connection is not reciprocal: ${stairway.uid} -> ${target.uid}`)
      }
    }
  }
}

function pointLiesOnWall(node, wall) {
  const [[startLat, startLng], [endLat, endLng]] = wall
  const cross = (node.lng - startLng) * (endLat - startLat) -
    (node.lat - startLat) * (endLng - startLng)
  if (Math.abs(cross) > 1e-6) return false

  return node.lat >= Math.min(startLat, endLat) &&
    node.lat <= Math.max(startLat, endLat) &&
    node.lng >= Math.min(startLng, endLng) &&
    node.lng <= Math.max(startLng, endLng)
}

function validateNodesDoNotLieOnWalls(floorsData) {
  for (const { floorId, nodes, walls } of floorsData) {
    const segments = expandWallPolylines(walls)
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const node = nodes[nodeIndex]
      const wall = segments.find(segment => pointLiesOnWall(node, segment.points))
      if (wall) {
        fail(
          `floor${floorId}/nodes.json[${nodeIndex}] (${node.uid}) lies on ` +
          `floor${floorId}/walls.json[${wall.wallIndex}] segment ${wall.segmentIndex}`
        )
      }
    }
  }
}

function segmentsIntersect(p1, p2, w1, w2) {
  const x1 = p1.lng
  const y1 = p1.lat
  const x2 = p2.lng
  const y2 = p2.lat
  const x3 = w1.lng
  const y3 = w1.lat
  const x4 = w2.lng
  const y4 = w2.lat
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-10) return false
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator
  return t >= 1e-6 && t <= 1 - 1e-6 && u >= 1e-6 && u <= 1 - 1e-6
}

function hasLineOfSight(start, end, walls) {
  return !walls.some(([[startLat, startLng], [endLat, endLng]]) =>
    segmentsIntersect(start, end, { lat: startLat, lng: startLng }, { lat: endLat, lng: endLng })
  )
}

function buildValidationGraph(floorsData) {
  const nodes = floorsData.flatMap(({ floorId, nodes: floorNodes }) =>
    floorNodes.map(node => ({ ...node, floor: floorId }))
  )
  const wallsByFloor = new Map(
    floorsData.map(({ floorId, walls }) => [floorId, expandWallPolylines(walls).map(wall => wall.points)])
  )
  const graph = new Map(nodes.map(node => [node.uid, new Set()]))

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const first = nodes[i]
      const second = nodes[j]
      if (first.floor !== second.floor) continue
      const distance = Math.hypot(first.lat - second.lat, first.lng - second.lng)
      if (distance > 800) continue
      if (!hasLineOfSight(first, second, wallsByFloor.get(first.floor) ?? [])) continue
      graph.get(first.uid).add(second.uid)
      graph.get(second.uid).add(first.uid)
    }
  }

  const byUid = new Map(nodes.map(node => [node.uid, node]))
  const stairways = nodes.filter(node => node.type === 'stairway')
  for (const stairway of stairways) {
    for (const identifier of stairway.connectsTo ?? []) {
      const target = byUid.get(identifier) ?? stairways.find(candidate =>
        candidate.floor !== stairway.floor && candidate.rooms.includes(identifier)
      )
      if (target) {
        graph.get(stairway.uid).add(target.uid)
        graph.get(target.uid).add(stairway.uid)
      }
    }
  }

  return { nodes, graph }
}

function findReachable(graph, startUid) {
  const reachable = new Set([startUid])
  const queue = [startUid]
  for (let index = 0; index < queue.length; index += 1) {
    for (const neighbor of graph.get(queue[index]) ?? []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return reachable
}

function resolveRouteSelector(selector, nodes, label) {
  const matches = nodes.filter(node =>
    (selector.uid === undefined || node.uid === selector.uid) &&
    (selector.floor === undefined || node.floor === selector.floor) &&
    (selector.room === undefined || node.rooms.includes(selector.room))
  )
  if (matches.length !== 1) {
    fail(`${label} must resolve to exactly one node (found ${matches.length})`)
  }
  return matches[0]
}

function validateCanonicalRoutes(fixture, nodes, graph) {
  const results = []
  for (const route of fixture.routes ?? []) {
    const start = resolveRouteSelector(route.start, nodes, `canonical route ${route.id} start`)
    const end = resolveRouteSelector(route.end, nodes, `canonical route ${route.id} end`)
    const found = findReachable(graph, start.uid).has(end.uid)
    results.push({ id: route.id, startUid: start.uid, endUid: end.uid, found })
    if (!found) fail(`Canonical route ${route.id} is unreachable`)
  }

  const stairways = nodes.filter(node => node.type === 'stairway')
  const stairwayPairs = []
  const seenPairs = new Set()
  for (const stairway of stairways) {
    for (const identifier of stairway.connectsTo ?? []) {
      const target = nodes.find(node => node.uid === identifier) ?? stairways.find(node =>
        node.floor !== stairway.floor && node.rooms.includes(identifier)
      )
      if (!target) continue
      const key = [stairway.uid, target.uid].sort().join(':')
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const found = findReachable(graph, stairway.uid).has(target.uid)
      stairwayPairs.push({ fromUid: stairway.uid, toUid: target.uid, found })
      if (!found) fail(`Stairway pair ${stairway.uid} -> ${target.uid} is unreachable`)
    }
  }
  return { routes: results, stairwayPairs }
}

function validateGraphConnectivity(floorsData, primaryAnchor) {
  const { nodes, graph } = buildValidationGraph(floorsData)
  const isolated = nodes.filter(node => graph.get(node.uid).size === 0)
  if (isolated.length > 0) {
    const detail = isolated.map(node => `${node.uid} (${node.rooms.join(', ')})`).join('; ')
    fail(`Isolated navigation node(s): ${detail}`)
  }

  const searchable = nodes.filter(node => node.type !== 'waypoint')
  const start = resolveRouteSelector(primaryAnchor, nodes, 'Primary graph anchor')
  const reachable = findReachable(graph, start.uid)
  const unreachable = searchable.filter(node => !reachable.has(node.uid))
  if (unreachable.length > 0) {
    const detail = unreachable.map(node => `${node.uid} (${node.rooms.join(', ')})`).join('; ')
    fail(`Unreachable searchable node(s) from ${start.uid}: ${detail}`)
  }
  return { nodes, graph, primaryAnchor: start, isolated, unreachable }
}

async function main() {
  const floorIds = await discoverFloors()
  const canonicalFixture = await readJson(resolve(ROOT, 'scripts/canonical-routes.json'))
  const floorsData = []

  for (const floorId of floorIds) {
    const base = resolve(ROOT, 'client/public/data', `floor${floorId}`)
    const nodes = await readJson(resolve(base, 'nodes.json'))
    const walls = await readJson(resolve(base, 'walls.json'))
    const zones = await readJson(resolve(base, 'zones.json'))

    validateNodes(floorId, nodes)
    validateWalls(floorId, walls)
    validateZones(floorId, zones)

    floorsData.push({ floorId, nodes, walls, zones })
  }

  validateCrossFloorIntegrity(floorsData)
  validateNodesDoNotLieOnWalls(floorsData)
  const validation = validateGraphConnectivity(floorsData, canonicalFixture.primaryAnchor)
  const canonicalRoutes = validateCanonicalRoutes(canonicalFixture, validation.nodes, validation.graph)

  const report = {
    valid: true,
    floorCount: floorIds.length,
    primaryAnchor: validation.primaryAnchor,
    nodeCount: validation.nodes.length,
    directedEdgeCount: [...validation.graph.values()].reduce((total, edges) => total + edges.size, 0),
    isolatedNodes: validation.isolated,
    unreachableSearchableNodes: validation.unreachable,
    canonicalRoutes,
  }
  if (REPORT_MODE) console.log(JSON.stringify(report, null, 2))
  else console.log(`Data validation passed for ${floorIds.length} floor(s).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(err => {
    const message = err instanceof Error ? err.message : String(err)
    if (REPORT_MODE) console.log(JSON.stringify({ valid: false, failures: [message] }, null, 2))
    else console.error(`Data validation failed: ${message}`)
    process.exitCode = 1
  })
}

export { expandWallPolylines, resolveRouteSelector, validateCanonicalRoutes }
