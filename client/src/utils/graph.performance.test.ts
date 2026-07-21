/** Regression guard for the real navigation dataset's graph-build cost. */

import { describe, expect, it } from 'vitest'
import { MAP_CONFIG } from './constants'
import { convertWallData } from './geometry'
import { buildVisibilityGraph } from './graph'
import type { Node, TrafficZone } from './types'

async function readJson<T>(relativePath: string): Promise<T> {
  const file = new URL(`../../public/${relativePath}`, import.meta.url)
  // @ts-expect-error Node's file API is available in Vitest, while the browser-only client tsconfig
  // intentionally omits Node type declarations.
  const fileSystem = (await import('node:fs/promises')) as unknown as {
    readFile: (path: URL, encoding: 'utf8') => Promise<string>
  }
  return JSON.parse(await fileSystem.readFile(file, 'utf8')) as T
}

describe('visibility graph performance', () => {
  it('builds the checked-in floor data within the interaction budget', async () => {
    const [
      floorOneNodes,
      floorTwoNodes,
      floorOneWalls,
      floorTwoWalls,
      floorOneZones,
      floorTwoZones,
    ] = await Promise.all([
      readJson<Node[]>('data/floor1/nodes.json'),
      readJson<Node[]>('data/floor2/nodes.json'),
      readJson<number[][][]>('data/floor1/walls.json'),
      readJson<number[][][]>('data/floor2/walls.json'),
      readJson<TrafficZone[]>('data/floor1/zones.json'),
      readJson<TrafficZone[]>('data/floor2/zones.json'),
    ])

    const nodes = [
      ...floorOneNodes.map((node) => ({ ...node, floor: '1' })),
      ...floorTwoNodes.map((node) => ({ ...node, floor: '2' })),
    ]
    const walls = [
      ...convertWallData(floorOneWalls).map((wall) => ({ ...wall, floor: '1' })),
      ...convertWallData(floorTwoWalls).map((wall) => ({ ...wall, floor: '2' })),
    ]
    const zones = [...floorOneZones, ...floorTwoZones]

    const startedAt = performance.now()
    const graph = buildVisibilityGraph(nodes, walls, MAP_CONFIG.MAX_HALLWAY_DISTANCE, zones)
    const elapsedMs = performance.now() - startedAt

    expect(graph.size).toBe(nodes.length)
    expect(elapsedMs).toBeLessThan(3_000)
  })
})
