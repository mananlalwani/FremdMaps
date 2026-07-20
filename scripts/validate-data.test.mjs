import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import {
  expandWallPolylines,
  resolveRouteSelector,
  validateCanonicalRoutes,
} from './validate-data.mjs'

test('expands every consecutive pair in a wall polyline', () => {
  assert.deepEqual(expandWallPolylines([[[0, 0], [1, 1], [2, 1]]]), [
    { points: [[0, 0], [1, 1]], wallIndex: 0, segmentIndex: 0 },
    { points: [[1, 1], [2, 1]], wallIndex: 0, segmentIndex: 1 },
  ])
})

test('requires an explicit selector to resolve exactly one node', () => {
  const nodes = [
    { uid: 'a', floor: '1', rooms: ['101'] },
    { uid: 'b', floor: '2', rooms: ['101'] },
  ]
  assert.equal(resolveRouteSelector({ floor: '1', room: '101' }, nodes, 'test').uid, 'a')
  assert.throws(() => resolveRouteSelector({ room: '101' }, nodes, 'test'), /exactly one node/)
})

test('fails a disconnected canonical route', () => {
  const nodes = [
    { uid: 'a', floor: '1', rooms: ['A'], type: 'room' },
    { uid: 'b', floor: '1', rooms: ['B'], type: 'room' },
  ]
  const graph = new Map([['a', new Set()], ['b', new Set()]])
  assert.throws(
    () => validateCanonicalRoutes({ routes: [{ id: 'disconnected', start: { uid: 'a' }, end: { uid: 'b' } }] }, nodes, graph),
    /Canonical route disconnected is unreachable/
  )
})

test('emits a structured JSON report', () => {
  const output = execFileSync('node', ['scripts/validate-data.mjs', '--report=json'], { encoding: 'utf8' })
  const report = JSON.parse(output)
  assert.equal(report.valid, true)
  assert.equal(report.primaryAnchor.rooms[0], 'Attendance Office')
  assert.ok(Array.isArray(report.canonicalRoutes.routes))
})
