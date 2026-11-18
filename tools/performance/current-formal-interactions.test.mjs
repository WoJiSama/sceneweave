import test from 'node:test'
import assert from 'node:assert/strict'
import { worldDeltaToLocal, propDragPlan, currentMeasurementPolicy, exclusiveWindowArgument, stopFileArgument } from './current-formal-interactions.mjs'

test('trusted world drag has an exact local displacement in every rotated aggregate frame', () => {
  assert.deepEqual([0, 1, 2, 3].map(turn => worldDeltaToLocal({ x: 400, y: 200 }, turn)),
    [{ x: 400, y: 200 }, { x: 200, y: -400 }, { x: -400, y: -200 }, { x: -200, y: 400 }])
  assert.throws(() => worldDeltaToLocal({ x: 400, y: 0 }, 4))
  assert.deepEqual([0, 1, 2, 3].map(turn => worldDeltaToLocal({ x: 1, y: 0 }, turn)),
    [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }])
})

test('drag plan rejects a clipped, subthreshold or unrepresentable gesture before measurement', () => {
  const input = { target: { x: 132000, y: 132000 }, bounds: { x: 0, y: 0, width: 180000, height: 180000 },
    canvas: { x: -3020, y: -3120, width: 4800, height: 4800 }, viewport: { x: 0, y: 0, width: 1000, height: 800 }, distanceMm: 400, snapMm: 100 }
  const plan = propDragPlan(input)
  assert.deepEqual(plan.offsetMm, { x: 400, y: 0 })
  assert.ok(plan.screenDistancePx >= 8)
  assert.deepEqual(propDragPlan({ ...input, distanceMm: -800 }).offsetMm, { x: -800, y: 0 })
  assert.throws(() => propDragPlan({ ...input, target: { x: 180000, y: 180000 } }), /clipped/)
  assert.throws(() => propDragPlan({ ...input, canvas: { x: 0, y: 0, width: 900, height: 900 } }), /too short/)
  assert.throws(() => propDragPlan({ ...input, snapMm: 300 }), /representable/)
})

test('full repetitions alone cannot establish an exclusive formal run; profiling remains diagnostic', () => {
  assert.equal(currentMeasurementPolicy({}).measurementClass, 'diagnostic-current-v1-production-ui-observation')
  assert.equal(currentMeasurementPolicy({ exclusiveWindow: '  ' }).exclusiveWindow, null)
  assert.equal(currentMeasurementPolicy({ exclusiveWindow: 'Coordinator confirmed window' }).measurementClass, 'formal-current-v1-production-ui-observation')
  assert.equal(currentMeasurementPolicy({ smoke: true, exclusiveWindow: 'confirmed' }).measurementClass, 'diagnostic-current-v1-production-ui-smoke')
  assert.equal(currentMeasurementPolicy({ profile: true, exclusiveWindow: 'confirmed' }).measurementClass, 'diagnostic-current-v1-production-ui-profile')
})

test('a missing or duplicated exclusive-window argument cannot turn another flag into formal confirmation', () => {
  assert.equal(exclusiveWindowArgument([]), null)
  assert.equal(exclusiveWindowArgument(['--exclusive-window', ' Confirmed by coordinator ']), 'Confirmed by coordinator')
  for (const args of [['--exclusive-window'], ['--exclusive-window', '--timeout-ms', '180000'],
    ['--exclusive-window', ' '], ['--exclusive-window', 'first', '--exclusive-window', 'second']]) {
    assert.throws(() => exclusiveWindowArgument(args), /explicit confirmation/)
  }
})

test('an explicit stop file cannot silently consume another option or be supplied twice', () => {
  assert.equal(stopFileArgument([]), null)
  assert.equal(stopFileArgument(['--stop-file', 'D:/work/stop.json']), 'D:/work/stop.json')
  for (const args of [['--stop-file'], ['--stop-file', '--smoke'], ['--stop-file', ' '], ['--stop-file', 'a', '--stop-file', 'b']]) {
    assert.throws(() => stopFileArgument(args), /--stop-file needs one explicit/)
  }
})
