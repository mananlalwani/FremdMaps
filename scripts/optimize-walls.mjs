#!/usr/bin/env node
/**
 * Safely optimize navigation walls by:
 * 1. Snapping near-orthogonal angles (drift <= 6px) to pure 0°/90°
 * 2. Collapsing parallel ghost lines (drywall thickness <= 6px)
 * 3. Removing isolated CAD noise (floating door swings, text ticks <= 35px)
 * 4. Merging collinear segments across gaps (<= 15px)
 * 5. Deduplicating dense parallel diagonal stair treads & seating tiers
 * 6. Filtering inactive room partitions that do not interact with navigation corridors
 *
 * By default the script runs in dry-run mode (preview only).
 * Use `--write` to apply changes to disk, and `--backup` to create `.bak` copies.
 *
 * Usage:
 *   node scripts/optimize-walls.mjs
 *   node scripts/optimize-walls.mjs --write --backup
 *   node scripts/optimize-walls.mjs --floor 1 --write
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  expandWallPolylines,
  resolveRouteSelector,
  validateCanonicalRoutes,
} from './validate-data.mjs'

const ROOT = resolve(process.cwd())
const DATA_ROOT = resolve(ROOT, 'client/public/data')
const BACKUP_ROOT = resolve(ROOT, 'backups/walls')

// Custom barrier walls that must always be explicitly preserved
const CUSTOM_WALLS_BY_FLOOR = {
  1: [
    [
      [-1895, 3827],
      [-1868, 3811],
    ],
    [
      [-1772, 1013],
      [-1800, 1019],
    ],
  ],
}

// Optimized configuration thresholds
const DEFAULTS = {
  ANGLE_SNAP_THRESHOLD: 6.0, // Max px delta to snap near-axis segments to pure 0°/90°
  PARALLEL_CLUSTER_THRESHOLD: 6.0, // Max px distance to merge parallel double-lines (drywall thickness)
  GAP_MERGE_THRESHOLD: 15.0, // Max px gap to bridge and merge touching collinear segments
  MIN_ISOLATED_LENGTH: 35.0, // Min length for floating disconnected CAD noise (door swings, furniture ticks)
  NODE_PROXIMITY_BUFFER: 100.0, // Max px distance from any node to preserve room/corridor walls
  MAX_PAIR_RAY_DISTANCE: 1200.0, // Max distance between node pairs for active line-of-sight ray casting
  STAIR_TREAD_DEDUP_DIST: 15.0, // Max distance to collapse parallel diagonal stair treads & seating tiers
  STAIR_TREAD_DEDUP_ANGLE: 10.0, // Angle tolerance (deg) for stair tread parallel groups
}

async function discoverFloors() {
  const entries = await readdir(DATA_ROOT, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && /^floor\d+$/.test(entry.name))
    .map((entry) => entry.name.replace('floor', ''))
    .sort((a, b) => Number(a) - Number(b))
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  return JSON.parse(text)
}

function segmentsIntersect(p1, p2, w1, w2) {
  const x1 = p1.lng,
    y1 = p1.lat
  const x2 = p2.lng,
    y2 = p2.lat
  const x3 = w1.lng,
    y3 = w1.lat
  const x4 = w2.lng,
    y4 = w2.lat
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < 1e-10) return false
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator
  return t >= 1e-6 && t <= 1 - 1e-6 && u >= 1e-6 && u <= 1 - 1e-6
}

/**
 * Optimize raw wall polylines for a single floor.
 */
function optimizeFloorWalls(rawWalls, nodes, floorId, options) {
  const {
    angleThreshold,
    parallelThreshold,
    gapThreshold,
    minIsolatedLen,
    nodeProximityBuffer,
    maxPairRayDistance,
    stairDedupDist,
    stairDedupAngle,
  } = options

  // Append any registered custom barrier walls for this floor
  const customWalls = CUSTOM_WALLS_BY_FLOOR[floorId] ?? []
  const inputWalls = [...rawWalls]
  for (const cw of customWalls) {
    const exists = inputWalls.some(
      (w) =>
        (w[0][0] === cw[0][0] &&
          w[0][1] === cw[0][1] &&
          w[1][0] === cw[1][0] &&
          w[1][1] === cw[1][1]) ||
        (w[0][0] === cw[1][0] &&
          w[0][1] === cw[1][1] &&
          w[1][0] === cw[0][0] &&
          w[1][1] === cw[0][1])
    )
    if (!exists) inputWalls.push(cw)
  }

  // 1. Identify isolated floating CAD artifacts (segments whose endpoints touch no other wall)
  const endpointCounts = new Map()
  for (const poly of inputWalls) {
    for (let i = 0; i < poly.length - 1; i++) {
      const k1 = `${poly[i][0]},${poly[i][1]}`
      const k2 = `${poly[i + 1][0]},${poly[i + 1][1]}`
      endpointCounts.set(k1, (endpointCounts.get(k1) || 0) + 1)
      endpointCounts.set(k2, (endpointCounts.get(k2) || 0) + 1)
    }
  }

  // 2. Deconstruct all polylines into individual segments and snap near-axis jitter
  const rawSegments = []
  for (const poly of inputWalls) {
    for (let i = 0; i < poly.length - 1; i++) {
      let [lat1, lng1] = poly[i]
      let [lat2, lng2] = poly[i + 1]

      const len = Math.hypot(lat1 - lat2, lng1 - lng2)
      const k1 = `${lat1},${lng1}`
      const k2 = `${lat2},${lng2}`
      const isIsolated = endpointCounts.get(k1) === 1 && endpointCounts.get(k2) === 1

      // Filter out isolated floating CAD tick marks, door swings, and furniture symbols
      const isCustom = customWalls.some(
        (cw) =>
          (cw[0][0] === lat1 && cw[0][1] === lng1 && cw[1][0] === lat2 && cw[1][1] === lng2) ||
          (cw[0][0] === lat2 && cw[0][1] === lng2 && cw[1][0] === lat1 && cw[1][1] === lng1)
      )

      if (len < minIsolatedLen && isIsolated && !isCustom) {
        continue
      }

      // Snap near-horizontal segments (skip custom walls)
      if (!isCustom && Math.abs(lat1 - lat2) <= angleThreshold) {
        const avgLat = Math.round((lat1 + lat2) / 2)
        lat1 = avgLat
        lat2 = avgLat
      }

      // Snap near-vertical segments (skip custom walls)
      if (!isCustom && Math.abs(lng1 - lng2) <= angleThreshold) {
        const avgLng = Math.round((lng1 + lng2) / 2)
        lng1 = avgLng
        lng2 = avgLng
      }

      // Normalize orientation (smaller point first)
      if (lat1 > lat2 || (lat1 === lat2 && lng1 > lng2)) {
        rawSegments.push({ start: [lat2, lng2], end: [lat1, lng1], isCustom })
      } else {
        rawSegments.push({ start: [lat1, lng1], end: [lat2, lng2], isCustom })
      }
    }
  }

  // 3. Group horizontal segments and cluster parallel lines within threshold
  const horizClusters = new Map() // clusterLat -> Array of [minLng, maxLng]
  for (const s of rawSegments) {
    if (s.start[0] === s.end[0] && !s.isCustom) {
      const lat = s.start[0]
      let targetLat = lat

      for (const existingLat of horizClusters.keys()) {
        if (Math.abs(existingLat - lat) <= parallelThreshold) {
          targetLat = existingLat
          break
        }
      }

      if (!horizClusters.has(targetLat)) horizClusters.set(targetLat, [])
      horizClusters
        .get(targetLat)
        .push([Math.min(s.start[1], s.end[1]), Math.max(s.start[1], s.end[1])])
    }
  }

  // 4. Group vertical segments and cluster parallel lines within threshold
  const vertClusters = new Map() // clusterLng -> Array of [minLat, maxLat]
  for (const s of rawSegments) {
    if (s.start[1] === s.end[1] && !s.isCustom) {
      const lng = s.start[1]
      let targetLng = lng

      for (const existingLng of vertClusters.keys()) {
        if (Math.abs(existingLng - lng) <= parallelThreshold) {
          targetLng = existingLng
          break
        }
      }

      if (!vertClusters.has(targetLng)) vertClusters.set(targetLng, [])
      vertClusters
        .get(targetLng)
        .push([Math.min(s.start[0], s.end[0]), Math.max(s.start[0], s.end[0])])
    }
  }

  // 5. Non-orthogonal (true diagonal) segments and custom walls
  const rawDiagonals = []
  const seenDiagonals = new Set()
  for (const s of rawSegments) {
    if ((s.start[0] !== s.end[0] && s.start[1] !== s.end[1]) || s.isCustom) {
      const key = `${s.start[0]},${s.start[1]}:${s.end[0]},${s.end[1]}`
      if (!seenDiagonals.has(key)) {
        seenDiagonals.add(key)
        rawDiagonals.push({ start: s.start, end: s.end, isCustom: s.isCustom })
      }
    }
  }

  // Deduplicate dense parallel diagonal stair treads and seating tiers
  const collapsedDiagonals = []
  const assigned = new Set()

  for (let i = 0; i < rawDiagonals.length; i++) {
    if (assigned.has(i)) continue
    const wA = rawDiagonals[i]
    if (wA.isCustom) {
      collapsedDiagonals.push([wA.start, wA.end])
      assigned.add(i)
      continue
    }

    const dLatA = wA.end[0] - wA.start[0]
    const dLngA = wA.end[1] - wA.start[1]
    const angleA = ((Math.atan2(dLatA, dLngA) * 180) / Math.PI + 180) % 180
    const midLatA = (wA.start[0] + wA.end[0]) / 2
    const midLngA = (wA.start[1] + wA.end[1]) / 2

    const group = [wA]
    assigned.add(i)

    for (let j = i + 1; j < rawDiagonals.length; j++) {
      if (assigned.has(j)) continue
      const wB = rawDiagonals[j]
      if (wB.isCustom) continue

      const dLatB = wB.end[0] - wB.start[0]
      const dLngB = wB.end[1] - wB.start[1]
      const angleB = ((Math.atan2(dLatB, dLngB) * 180) / Math.PI + 180) % 180
      const midLatB = (wB.start[0] + wB.end[0]) / 2
      const midLngB = (wB.start[1] + wB.end[1]) / 2

      let angleDiff = Math.abs(angleA - angleB)
      if (angleDiff > 90) angleDiff = Math.abs(180 - angleDiff)

      const midDist = Math.hypot(midLatA - midLatB, midLngA - midLngB)

      if (angleDiff <= stairDedupAngle && midDist <= stairDedupDist) {
        group.push(wB)
        assigned.add(j)
      }
    }

    // Keep the longest segment in the parallel stair-tread group
    group.sort(
      (a, b) =>
        Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) -
        Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1])
    )
    collapsedDiagonals.push([group[0].start, group[0].end])
  }

  const mergedWalls = []

  // 6. Merge collinear intervals for horizontal walls
  for (const [lat, intervals] of horizClusters) {
    intervals.sort((a, b) => a[0] - b[0])
    let current = [...intervals[0]]

    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i][0] <= current[1] + gapThreshold) {
        current[1] = Math.max(current[1], intervals[i][1])
      } else {
        if (current[1] > current[0]) {
          mergedWalls.push([
            [lat, current[0]],
            [lat, current[1]],
          ])
        }
        current = [...intervals[i]]
      }
    }
    if (current[1] > current[0]) {
      mergedWalls.push([
        [lat, current[0]],
        [lat, current[1]],
      ])
    }
  }

  // 7. Merge collinear intervals for vertical walls
  for (const [lng, intervals] of vertClusters) {
    intervals.sort((a, b) => a[0] - b[0])
    let current = [...intervals[0]]

    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i][0] <= current[1] + gapThreshold) {
        current[1] = Math.max(current[1], intervals[i][1])
      } else {
        if (current[1] > current[0]) {
          mergedWalls.push([
            [current[0], lng],
            [current[1], lng],
          ])
        }
        current = [...intervals[i]]
      }
    }
    if (current[1] > current[0]) {
      mergedWalls.push([
        [current[0], lng],
        [current[1], lng],
      ])
    }
  }

  // Append diagonals
  for (const diag of collapsedDiagonals) {
    mergedWalls.push(diag)
  }

  // 8. Filter inactive walls that neither block any node pair ray nor sit within corridor buffer
  const nodePairs = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dist = Math.hypot(nodes[i].lat - nodes[j].lat, nodes[i].lng - nodes[j].lng)
      if (dist <= maxPairRayDistance) {
        nodePairs.push([nodes[i], nodes[j]])
      }
    }
  }

  const activeWalls = []
  for (const w of mergedWalls) {
    const w1 = { lat: w[0][0], lng: w[0][1] }
    const w2 = { lat: w[1][0], lng: w[1][1] }

    // Check if custom barrier
    const isCustom = customWalls.some(
      (cw) =>
        (cw[0][0] === w1.lat &&
          cw[0][1] === w1.lng &&
          cw[1][0] === w2.lat &&
          cw[1][1] === w2.lng) ||
        (cw[0][0] === w2.lat && cw[0][1] === w2.lng && cw[1][0] === w1.lat && cw[1][1] === w1.lng)
    )
    if (isCustom) {
      activeWalls.push(w)
      continue
    }

    // Check if wall actively blocks any candidate node pair ray
    let blocksRay = false
    for (const [n1, n2] of nodePairs) {
      if (segmentsIntersect(n1, n2, w1, w2)) {
        blocksRay = true
        break
      }
    }

    if (blocksRay) {
      activeWalls.push(w)
      continue
    }

    // Check if wall is within corridor buffer distance of any node
    let inCorridorBuffer = false
    for (const n of nodes) {
      const d1 = Math.hypot(n.lat - w1.lat, n.lng - w1.lng)
      const d2 = Math.hypot(n.lat - w2.lat, n.lng - w2.lng)
      if (d1 <= nodeProximityBuffer || d2 <= nodeProximityBuffer) {
        inCorridorBuffer = true
        break
      }
    }

    if (inCorridorBuffer) {
      activeWalls.push(w)
    }
  }

  return activeWalls
}

function wallsMatch(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

// ── Validation Helpers ───────────────────────────────────────────────────────

function pointLiesOnWall(node, wall) {
  const [[startLat, startLng], [endLat, endLng]] = wall
  const cross =
    (node.lng - startLng) * (endLat - startLat) - (node.lat - startLat) * (endLng - startLng)
  if (Math.abs(cross) > 1e-6) return false

  return (
    node.lat >= Math.min(startLat, endLat) &&
    node.lat <= Math.max(startLat, endLat) &&
    node.lng >= Math.min(startLng, endLng) &&
    node.lng <= Math.max(startLng, endLng)
  )
}

function hasLineOfSight(start, end, walls) {
  return !walls.some(([[startLat, startLng], [endLat, endLng]]) =>
    segmentsIntersect(start, end, { lat: startLat, lng: startLng }, { lat: endLat, lng: endLng })
  )
}

function buildValidationGraph(floorsData) {
  const nodes = floorsData.flatMap(({ floorId, nodes: floorNodes }) =>
    floorNodes.map((node) => ({ ...node, floor: floorId }))
  )
  const wallsByFloor = new Map(
    floorsData.map(({ floorId, walls }) => [
      floorId,
      expandWallPolylines(walls).map((wall) => wall.points),
    ])
  )
  const graph = new Map(nodes.map((node) => [node.uid, new Set()]))

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

  const byUid = new Map(nodes.map((node) => [node.uid, node]))
  const stairways = nodes.filter((node) => node.type === 'stairway')
  for (const stairway of stairways) {
    for (const identifier of stairway.connectsTo ?? []) {
      const target =
        byUid.get(identifier) ??
        stairways.find(
          (candidate) => candidate.floor !== stairway.floor && candidate.rooms.includes(identifier)
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

function validateOptimizedData(floorsData, canonicalFixture) {
  // 1. Check no nodes lie on walls
  for (const { floorId, nodes, walls } of floorsData) {
    const segments = expandWallPolylines(walls)
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const node = nodes[nodeIndex]
      const wall = segments.find((segment) => pointLiesOnWall(node, segment.points))
      if (wall) {
        throw new Error(
          `Node ${node.uid} (${node.rooms.join(', ')}) on Floor ${floorId} lies directly on wall segment!`
        )
      }
    }
  }

  // 2. Check full graph connectivity
  const { nodes, graph } = buildValidationGraph(floorsData)
  const primaryAnchor = resolveRouteSelector(
    canonicalFixture.primaryAnchor,
    nodes,
    'Primary anchor'
  )
  const reachable = findReachable(graph, primaryAnchor.uid)
  const searchable = nodes.filter((node) => node.type !== 'waypoint')
  const unreachable = searchable.filter((node) => !reachable.has(node.uid))
  if (unreachable.length > 0) {
    throw new Error(
      `${unreachable.length} searchable nodes became unreachable after wall optimization!`
    )
  }

  // 3. Verify all canonical test routes
  validateCanonicalRoutes(canonicalFixture, nodes, graph)
}

// ── CLI Main ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const backup = args.includes('--backup')

  const floorArgIndex = args.indexOf('--floor')
  const selectedFloor = floorArgIndex !== -1 ? args[floorArgIndex + 1] : null

  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag)
    return idx !== -1 && args[idx + 1] ? parseFloat(args[idx + 1]) : fallback
  }

  const angleThreshold = getArg('--angle-threshold', DEFAULTS.ANGLE_SNAP_THRESHOLD)
  const parallelThreshold = getArg('--parallel-threshold', DEFAULTS.PARALLEL_CLUSTER_THRESHOLD)
  const gapThreshold = getArg('--gap-threshold', DEFAULTS.GAP_MERGE_THRESHOLD)
  const minIsolatedLen = getArg('--min-isolated', DEFAULTS.MIN_ISOLATED_LENGTH)
  const nodeProximityBuffer = getArg('--node-buffer', DEFAULTS.NODE_PROXIMITY_BUFFER)
  const maxPairRayDistance = getArg('--max-ray-dist', DEFAULTS.MAX_PAIR_RAY_DISTANCE)
  const stairDedupDist = getArg('--stair-dedup-dist', DEFAULTS.STAIR_TREAD_DEDUP_DIST)
  const stairDedupAngle = getArg('--stair-dedup-angle', DEFAULTS.STAIR_TREAD_DEDUP_ANGLE)

  const allFloorIds = await discoverFloors()
  const targetFloorIds = selectedFloor ? [selectedFloor] : allFloorIds
  const canonicalFixture = await readJson(resolve(ROOT, 'scripts/canonical-routes.json'))

  console.log(`\n📐 Wall Optimizer (Stair Tread & Corridor Optimization)`)
  console.log(`  Snap angle threshold:    ${angleThreshold} px`)
  console.log(`  Parallel double-line:    ${parallelThreshold} px`)
  console.log(`  Collinear gap merge:     ${gapThreshold} px`)
  console.log(`  Stair tread dedup:       ${stairDedupDist} px (±${stairDedupAngle}°)`)
  console.log(`  Floating noise filter:   ${minIsolatedLen} px`)
  console.log(`  Node proximity buffer:   ${nodeProximityBuffer} px`)
  console.log(`  Mode:                    ${write ? 'WRITE to disk' : 'DRY-RUN (preview only)'}\n`)

  const floorsData = []
  let totalOriginal = 0
  let totalOptimized = 0

  for (const floorId of allFloorIds) {
    const floorDir = resolve(DATA_ROOT, `floor${floorId}`)
    const nodes = await readJson(resolve(floorDir, 'nodes.json'))
    const zones = await readJson(resolve(floorDir, 'zones.json'))
    const rawWalls = await readJson(resolve(floorDir, 'walls.json'))

    totalOriginal += rawWalls.length

    let optimizedWalls = rawWalls
    if (targetFloorIds.includes(floorId)) {
      optimizedWalls = optimizeFloorWalls(rawWalls, nodes, floorId, {
        angleThreshold,
        parallelThreshold,
        gapThreshold,
        minIsolatedLen,
        nodeProximityBuffer,
        maxPairRayDistance,
        stairDedupDist,
        stairDedupAngle,
      })
      const secondPassWalls = optimizeFloorWalls(optimizedWalls, nodes, floorId, {
        angleThreshold,
        parallelThreshold,
        gapThreshold,
        minIsolatedLen,
        nodeProximityBuffer,
        maxPairRayDistance,
        stairDedupDist,
        stairDedupAngle,
      })
      if (!wallsMatch(optimizedWalls, secondPassWalls)) {
        throw new Error(
          `Floor ${floorId} wall optimization is not idempotent; a second pass would change the output`
        )
      }
      const reduction = (
        ((rawWalls.length - optimizedWalls.length) / rawWalls.length) *
        100
      ).toFixed(1)
      console.log(
        `Floor ${floorId}: ${rawWalls.length.toLocaleString()} walls -> ${optimizedWalls.length.toLocaleString()} walls (-${reduction}%)`
      )
    } else {
      console.log(`Floor ${floorId}: (skipped)`)
    }

    totalOptimized += optimizedWalls.length
    floorsData.push({
      floorId,
      nodes,
      walls: optimizedWalls,
      zones,
      rawWallsPath: resolve(floorDir, 'walls.json'),
    })
  }

  const overallReduction = (((totalOriginal - totalOptimized) / totalOriginal) * 100).toFixed(1)
  console.log(
    `\nTotal: ${totalOriginal.toLocaleString()} walls -> ${totalOptimized.toLocaleString()} walls (-${overallReduction}% overall reduction)\n`
  )

  // Validate integrity
  process.stdout.write(`Validating graph connectivity and canonical routes... `)
  const startTime = performance.now()
  validateOptimizedData(floorsData, canonicalFixture)
  const elapsed = (performance.now() - startTime).toFixed(1)
  console.log(`PASSED (${elapsed}ms) ✅`)

  if (!write) {
    console.log(`\n[dry-run] No changes written. Run with --write to apply changes.`)
    return
  }

  // Write changes
  if (backup) await mkdir(BACKUP_ROOT, { recursive: true })
  for (const data of floorsData) {
    if (!targetFloorIds.includes(data.floorId)) continue
    if (backup) {
      const backupPath = resolve(BACKUP_ROOT, `floor${data.floorId}-walls.json.bak`)
      await copyFile(data.rawWallsPath, backupPath)
      console.log(`  Backup created: ${backupPath}`)
    }
    await writeFile(data.rawWallsPath, JSON.stringify(data.walls, null, 2) + '\n', 'utf8')
    console.log(`  Updated: ${data.rawWallsPath}`)
  }

  console.log(`\nAll wall files successfully optimized and written! 🎉`)
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`)
  process.exitCode = 1
})
