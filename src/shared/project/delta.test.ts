import { toCurrentSceneDocument } from '../model/current-scene.js'
import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Bytes } from '../validation/hash.js'
import { createProjectDelta, applyProjectDelta, applyProjectDeltaChain, DeltaSizeError, projectDeltaBytes, projectDeltaJson, validateProjectDelta } from './delta.js'
import { projectContentHash, validateProjectData } from './validate.js'

let sequence = 0
function fixture(): ProjectData {
  const document: SceneDocument = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  const content = createCompositionContent(document, { ids: { nextId: () => `delta-test-${++sequence}` }, clock: { now: () => '2026-10-29T00:00:00.000Z' } })
  return validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} })
}

describe('complete project bidirectional deltas', () => {
  it('round trips changed leaves, arrays, inserted and removed records in both directions', () => {
    const before = fixture(); before.appearance.instanceAdjustments.item = []
    const after = cloneJson(before)
    after.appearance.instanceAdjustments.item = [{ id: 'history-opacity', kind: 'opacity', value: 1, enabled: false }]
    after.document.title = 'Delta after'
    after.document.props.item.positionMm.x += 250
    after.document.units.gridVisible = !after.document.units.gridVisible
    const oldLayer = Object.keys(after.document.userLayers)[0]
    after.document.userLayers.added = { ...after.document.userLayers[oldLayer], id: 'added', name: 'Added' }
    for (const id of Object.keys(after.document.entityLayers)) if (after.document.entityLayers[id] === oldLayer) after.document.entityLayers[id] = 'added'
    delete after.document.userLayers[oldLayer]
    const delta = createProjectDelta(before, validateProjectData(after))
    expect(delta.changes.length).toBeGreaterThan(4)
    expect(applyProjectDelta(before, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(before)
    expect(projectContentHash(applyProjectDelta(before, delta, 'forward'))).toBe(delta.afterHash)
    expect(projectDeltaBytes(delta)).toBe(new TextEncoder().encode(projectDeltaJson(delta)).length)
  })

  it('preserves dictionary keys named constructor and prototype with own data properties', () => {
    const before = fixture(), oldLayer = Object.keys(before.document.userLayers)[0], layer = before.document.userLayers[oldLayer]
    const constructorKey: string = 'constructor'
    before.document.userLayers[constructorKey] = { ...layer, id: constructorKey, name: 'Before' }
    before.appearance.layerAdjustments[constructorKey] = []
    for (const id of Object.keys(before.document.entityLayers)) if (before.document.entityLayers[id] === oldLayer) before.document.entityLayers[id] = 'constructor'
    delete before.document.userLayers[oldLayer]
    const after = cloneJson(before)
    after.document.userLayers[constructorKey].name = 'After'
    after.document.userLayers.prototype = { ...after.document.userLayers[constructorKey], id: 'prototype', name: 'Prototype', order: 1 }
    const delta = createProjectDelta(before, validateProjectData(after))
    expect(applyProjectDelta(before, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(before)
  })

  it('records complete source, asset, appearance and license closures with their real metadata', () => {
    const before = svgProjectFixture().bundle.project
    const after = svgProjectFixture('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect x="0" y="0" width="1" height="1" fill="#112233"/></svg>', [17, 34, 51, 255]).bundle.project
    const text = 'Second actual test license', sha256 = sha256Bytes(encodeUtf8(text))
    after.appearance.instanceAdjustments.item = [{ id: 'after-disabled-opacity', kind: 'opacity', value: 1, enabled: false }]
    after.licenses = { [sha256]: { sha256, text } }
    after.licenseBindings.forEach(binding => { binding.licensePath = `licenses/${sha256}.txt` })
    const delta = createProjectDelta(before, after), roots = new Set(delta.changes.map(change => change.path[0]))
    expect(roots).toEqual(new Set(['document', 'appearance', 'assets', 'authoringSources', 'licenses', 'licenseBindings']))
    expect(applyProjectDelta(before, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(before)
  })

  it('rejects a different baseline, changed precondition, duplicate/overlap and unsafe path', () => {
    const before = fixture(), after = cloneJson(before)
    after.document.title = 'Changed'
    const delta = createProjectDelta(before, after)
    const wrong = cloneJson(before); wrong.document.title = 'Unrelated'
    expect(() => applyProjectDelta(wrong, delta, 'forward')).toThrow(/基线hash/)
    const altered = cloneJson(delta)
    altered.changes[0].before = { present: true, value: 'not the stored title' }
    expect(() => applyProjectDelta(before, altered, 'forward')).toThrow()
    expect(() => validateProjectDelta({ ...delta, changes: [...delta.changes, cloneJson(delta.changes[0])] })).toThrow(/重复或互为祖先/)
    expect(() => validateProjectDelta({ ...delta, changes: [...delta.changes, { path: [...delta.changes[0].path, 'child'], before: { present: false }, after: { present: true, value: 1 } }] })).toThrow(/重复或互为祖先/)
    expect(() => validateProjectDelta({ ...delta, changes: [{ ...delta.changes[0], path: ['__proto__'] }] })).toThrow(/安全字段路径/)
    expect(before.document.title).not.toBe('Changed')
  })

  it('rejects accessors, hidden data, symbols and invalid JSON without invoking getters', () => {
    const before = fixture(), after = cloneJson(before); after.document.title = 'Changed'
    const delta = createProjectDelta(before, after)
    let calls = 0
    const accessor = { ...delta }
    Object.defineProperty(accessor, 'version', { enumerable: true, get() { calls++; return 1 } })
    expect(() => validateProjectDelta(accessor)).toThrow()
    expect(calls).toBe(0)
    const nestedAccessor = cloneJson(delta)
    Object.defineProperty(nestedAccessor.changes[0].before, 'present', { enumerable: true, get() { calls++; return true } })
    expect(() => validateProjectDelta(nestedAccessor)).toThrow()
    expect(calls).toBe(0)
    const hidden = cloneJson(delta) as unknown as Record<string, unknown>
    Object.defineProperty(hidden, 'extra', { value: 1, enumerable: false })
    expect(() => validateProjectDelta(hidden)).toThrow()
    const symbol = cloneJson(delta) as unknown as Record<PropertyKey, unknown>
    symbol[Symbol('hidden')] = 1
    expect(() => validateProjectDelta(symbol)).toThrow()
    const invalid = cloneJson(delta)
    invalid.changes[0].after = { present: true, value: undefined as never }
    expect(() => validateProjectDelta(invalid)).toThrow()
  })

  it('serializes deltas above one-project JSON value limits and distinguishes oversized deltas', () => {
    const before = new Array(310_000).fill(0), after = [...before]; after[0] = 1
    const delta = { format: 'sceneweave-project-delta', version: 1, beforeHash: 'a'.repeat(64), afterHash: 'b'.repeat(64),
      changes: [{ path: ['document', 'atomicArray'], before: { present: true, value: before }, after: { present: true, value: after } }] }
    expect(validateProjectDelta(delta).changes).toHaveLength(1)
    expect(projectDeltaJson(delta)).toContain('"sceneweave-project-delta"')
    expect(() => validateProjectDelta({ ...delta, changes: [...delta.changes,
      { ...delta.changes[0], path: ['document', 'secondArray'] }] })).toThrow(DeltaSizeError)
  })
})

describe('complete project forward delta chains', () => {
  function chain() {
    const projects = [fixture()]
    for (let revision = 1; revision <= 3; revision++) {
      const project = cloneJson(projects.at(-1)!)
      project.document.revision = revision
      project.document.title = `Chain version ${revision}`
      project.document.props.item.positionMm.x += 50
      project.appearance.instanceAdjustments.item = [{ id: `chain-${revision}`, kind: 'opacity', value: 1, enabled: false }]
      projects.push(validateProjectData(project))
    }
    const deltas = projects.slice(1).map((project, index) => createProjectDelta(projects[index], project))
    return { projects, deltas, rootHash: projectContentHash(projects[0]) }
  }

  it('matches three strict single steps and returns each actual output hash and revision', () => {
    const { projects, deltas, rootHash } = chain()
    const result = applyProjectDeltaChain(projects[0], deltas, rootHash)
    const singles = deltas.reduce((project, delta) => applyProjectDelta(project, delta, 'forward'), projects[0])
    expect(result.project).toEqual(singles)
    expect(result.project).toEqual(projects[3])
    expect(result.states).toEqual(projects.slice(1).map(project => ({ contentHash: projectContentHash(project), revision: project.document.revision })))
    expect(deltas.reduceRight((project, delta) => applyProjectDelta(project, delta, 'backward'), result.project)).toEqual(projects[0])
  })

  it('checks the complete root even for an empty chain and returns an independent project', () => {
    const { projects, rootHash } = chain()
    const result = applyProjectDeltaChain(projects[0], [], rootHash)
    expect(result).toEqual({ project: projects[0], states: [] })
    result.project.document.title = 'Empty chain caller mutation'
    expect(projects[0].document.title).not.toBe(result.project.document.title)
    expect(() => applyProjectDeltaChain(projects[0], [], 'f'.repeat(64))).toThrow(/基线hash/)
    const changed = cloneJson(projects[0]); changed.document.title = 'Different baseline'
    expect(() => applyProjectDeltaChain(changed, [], rootHash)).toThrow(/基线hash/)
    const invalid = cloneJson(projects[0]); invalid.document.revision = -1
    expect(() => applyProjectDeltaChain(invalid, [], 'f'.repeat(64))).toThrow()
  })

  it('owns all intermediate mutations even with frozen roots and deltas, including a failed later step', () => {
    const { projects, deltas, rootHash } = chain(), root = freezeJson(cloneJson(projects[0]))
    const inputs = freezeJson(cloneJson(deltas)), before = JSON.stringify(root), original = JSON.stringify(inputs)
    expect(applyProjectDeltaChain(root, inputs, rootHash).project).toEqual(projects[3])
    const broken = cloneJson(deltas); broken[2].afterHash = 'f'.repeat(64)
    expect(() => applyProjectDeltaChain(root, freezeJson(broken), rootHash)).toThrow(/重建完整内容hash/)
    expect(JSON.stringify(root)).toBe(before)
    expect(JSON.stringify(inputs)).toBe(original)
  })

  it('rejects a bad middle hash, precondition, result or schema without modifying the root or deltas', () => {
    const { projects, deltas, rootHash } = chain(), before = cloneJson(projects[0]), originalDeltas = cloneJson(deltas)
    const wrongBefore = cloneJson(deltas); wrongBefore[1].beforeHash = 'f'.repeat(64)
    expect(() => applyProjectDeltaChain(projects[0], wrongBefore, rootHash)).toThrow(/前一步完整内容hash/)
    const wrongSlot = cloneJson(deltas)
    wrongSlot[1].changes.find(change => change.path.join('.') === 'document.title')!.before = { present: true, value: 'Wrong middle title' }
    expect(() => applyProjectDeltaChain(projects[0], wrongSlot, rootHash)).toThrow(/前置字段值/)
    const wrongResult = cloneJson(deltas); wrongResult[1].afterHash = 'f'.repeat(64)
    expect(() => applyProjectDeltaChain(projects[0], wrongResult, rootHash)).toThrow(/重建完整内容hash/)
    const invalidResult = cloneJson(deltas)
    invalidResult[1].changes.find(change => change.path.join('.') === 'document.revision')!.after = { present: true, value: -1 }
    expect(() => applyProjectDeltaChain(projects[0], invalidResult, rootHash)).toThrow()
    expect(projects[0]).toEqual(before)
    expect(deltas).toEqual(originalDeltas)
  })

  it('rejects accessors and oversized or sparse chains without invoking getters', () => {
    const { projects, deltas, rootHash } = chain()
    let calls = 0
    const arrayAccessor: unknown[] = []
    Object.defineProperty(arrayAccessor, '0', { enumerable: true, get() { calls++; return deltas[0] } })
    expect(() => applyProjectDeltaChain(projects[0], arrayAccessor, rootHash)).toThrow(/访问器/)
    const deltaAccessor = cloneJson(deltas)
    Object.defineProperty(deltaAccessor[1], 'beforeHash', { enumerable: true, get() { calls++; return deltas[1].beforeHash } })
    expect(() => applyProjectDeltaChain(projects[0], deltaAccessor, rootHash)).toThrow()
    const rootAccessor = cloneJson(projects[0])
    Object.defineProperty(rootAccessor.document, 'title', { enumerable: true, get() { calls++; return projects[0].document.title } })
    expect(() => applyProjectDeltaChain(rootAccessor, deltas, rootHash)).toThrow(/访问器/)
    expect(calls).toBe(0)
    expect(() => applyProjectDeltaChain(projects[0], [...deltas, deltas[0]], rootHash)).toThrow(/超过范围/)
    expect(() => applyProjectDeltaChain(projects[0], new Array(1), rootHash)).toThrow()
  })

  it('isolates the final project from later input, delta and caller mutations without retaining proof', () => {
    const { projects, deltas, rootHash } = chain(), expected = cloneJson(projects[3])
    const result = applyProjectDeltaChain(projects[0], deltas, rootHash)
    const inputBefore = cloneJson(projects[0]), deltasBefore = cloneJson(deltas)
    result.project.document.props.item.positionMm.x += 999
    result.project.appearance.instanceAdjustments.item.push({ id: 'caller-adjustment', kind: 'opacity', value: 1, enabled: false })
    expect(projects[0]).toEqual(inputBefore)
    expect(deltas).toEqual(deltasBefore)
    const again = applyProjectDeltaChain(projects[0], deltas, rootHash)
    expect(again.project).toEqual(expected)
    projects[0].document.title = 'Mutated caller root'
    deltas[2].changes.find(change => change.path.join('.') === 'document.title')!.after = { present: true, value: 'Mutated caller delta' }
    expect(again.project).toEqual(expected)
    expect(() => applyProjectDeltaChain(projects[0], deltas, rootHash)).toThrow(/基线hash/)
  })
})
