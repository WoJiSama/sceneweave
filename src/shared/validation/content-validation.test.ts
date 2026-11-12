import { afterEach, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { certifyCompositionContent, validateCompositionContent } from './content.js'
import { cloneJson, freezeJson } from './json.js'
import { isCertifiedSceneSnapshot } from './snapshots.js'
import * as scene from './scene.js'

let sequence = 0
const runtime = { ids: { nextId: () => `content-validation-${++sequence}` }, clock: { now: () => '2026-11-12T00:00:00.000Z' } }
function input() {
  return createCompositionContent(toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' }), runtime)
}
afterEach(() => vi.restoreAllMocks())

it('fully validates each public call once and shares only its independently parsed scene with identity checking', () => {
  const source = certifyCompositionContent(input()), before = cloneJson(source)
  const check = vi.spyOn(scene, 'validateSceneDocument')
  const first = validateCompositionContent(source)
  expect(check).toHaveBeenCalledTimes(1)
  expect(first).toEqual(before)
  expect(first.document).not.toBe(source.document)
  expect(isCertifiedSceneSnapshot(first.document)).toBe(false)
  expect(Object.isFrozen(first.document)).toBe(false)
  first.document.props.item.positionMm.x++
  expect(source).toEqual(before)
  const second = validateCompositionContent(first)
  expect(check).toHaveBeenCalledTimes(2)
  expect(second).toEqual(first)
  second.document.props.item.positionMm.x++
  expect(second.document.props.item.positionMm.x).not.toBe(first.document.props.item.positionMm.x)
})

it('rejects a caller-frozen invalid scene with unchanged scene ID and revision', () => {
  const source = input(), invalid = cloneJson(source)
  invalid.document.props.item.floorId = 'missing-floor'
  freezeJson(invalid)
  const check = vi.spyOn(scene, 'validateSceneDocument')
  expect(() => validateCompositionContent(invalid)).toThrow(/场景无效/)
  expect(check).toHaveBeenCalledOnce()
  expect(source.document.props.item.floorId).not.toBe('missing-floor')
})

it.each(['identity', 'appearance'] as const)('still checks complete %s after the fresh scene domain validation', kind => {
  const source = input()
  if (kind === 'identity') delete source.historyIdentity.propTokens.item
  else source.document.props.item.appearance.opacity = 0.25
  const check = vi.spyOn(scene, 'validateSceneDocument')
  expect(() => validateCompositionContent(source)).toThrow()
  expect(check).toHaveBeenCalledOnce()
})
