import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const NODE_TYPES = new Set(['room', 'waypoint', 'bathroom', 'stairway'])
const MAP_BOUNDS = {
  MIN_LAT: -4675,
  MAX_LAT: 0,
  MIN_LNG: 0,
  MAX_LNG: 6050,
}

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
    fail('No floor directories found under client/public/data (expected floor<N>/)')
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

    if (!NODE_TYPES.has(n.type)) {
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
  }
}

function validateWalls(floorId, walls) {
  if (!Array.isArray(walls)) {
    fail(`floor${floorId}/walls.json must contain an array`)
  }

  for (let i = 0; i < walls.length; i += 1) {
    const segment = walls[i]
    const label = `floor${floorId}/walls.json[${i}]`
    if (!Array.isArray(segment) || segment.length !== 2) {
      fail(`${label} must be a 2-point segment`)
    }

    for (let p = 0; p < 2; p += 1) {
      const point = segment[p]
      const pointLabel = `${label}[${p}]`
      if (!Array.isArray(point) || point.length !== 2) {
        fail(`${pointLabel} must be [lat, lng]`)
      }
      assertFiniteNumber(point[0], `${pointLabel}[0]`)
      assertFiniteNumber(point[1], `${pointLabel}[1]`)
      assertMapBounds(point[0], point[1], pointLabel)
    }

    const [start, end] = segment
    if (start[0] === end[0] && start[1] === end[1]) {
      fail(`${label} is degenerate (start and end are identical)`)
    }
  }
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
        target = stairways.find(candidate =>
          candidate.floor !== stairway.floor &&
          candidate.rooms.some(room => room === targetIdentifier)
        )
      }

      if (!target) {
        fail(`Stairway ${stairway.uid} references missing connectsTo target: ${targetIdentifier}`)
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

async function main() {
  const floorIds = await discoverFloors()
  const floorsData = []

  for (const floorId of floorIds) {
    const base = resolve(ROOT, 'client/public/data', `floor${floorId}`)
    const nodes = await readJson(resolve(base, 'nodes.json'))
    const walls = await readJson(resolve(base, 'walls.json'))
    const zones = await readJson(resolve(base, 'zones.json'))

    validateNodes(floorId, nodes)
    validateWalls(floorId, walls)
    validateZones(floorId, zones)

    floorsData.push({ floorId, nodes, zones })
  }

  validateCrossFloorIntegrity(floorsData)

  console.log(`Data validation passed for ${floorIds.length} floor(s).`)
}

main().catch(err => {
  console.error(`Data validation failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
