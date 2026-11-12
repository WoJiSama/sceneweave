import { toCurrentSceneDocument } from '../model/current-scene.js'
import { describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionDraftCommands, completeCompositionTransactionReceipt, getCompositionTransactionReceipt } from '../appearance/commands.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Bytes } from '../validation/hash.js'
import * as hashModule from '../validation/hash.js'
import * as sceneModule from '../validation/scene.js'
import { encodeProjectCoordinates } from '../aggregates/scene-coordinates.js'
import { reviseCompositionContent, tryApplyPropUpdateCompositionTransaction } from '../validation/content.js'
import type { PropUpdateCommand } from '../validation/snapshots.js'
import { createProjectDelta, tryCreateLocalProjectDelta, applyProjectDelta, applyProjectDeltaChain, createProjectDeltaReplay, DeltaSizeError, projectDeltaBytes, projectDeltaJson, validateProjectDelta } from './delta.js'
import { encodeProjectContentData, getOwnedProjectEncoding } from './encoding.js'
import { certifyProjectData, completeProjectTransactionReceipt, createProjectReplayValidator, getProjectLocalTransaction, projectContentHash, releaseProjectLocalTransaction, releaseProjectTransactionReceipt, tryCertifyLocalProjectData, validateProjectData } from './validate.js'

let sequence = 0
function fixture(configure?: (document: SceneDocument) => void): ProjectData {
  const document: SceneDocument = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  configure?.(document)
  const content = createCompositionContent(document, { ids: { nextId: () => `delta-test-${++sequence}` }, clock: { now: () => '2026-10-29T00:00:00.000Z' } })
  return validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} })
}

describe('complete project bidirectional deltas', () => {
  it('does not issue a reusable size proof to a public mutable validation result', () => {
    const project = fixture()
    expect(tryCertifyLocalProjectData(project, project)).toBeUndefined()
    project.document.revision = -1
    expect(tryCertifyLocalProjectData(project, project)).toBeUndefined()
    expect(() => validateProjectData(project)).toThrow()
  })
  it('reuses only complete equal owned replay bodies and still checks metadata, changed content and every digest', () => {
    const original = fixture(), validator = createProjectReplayValidator(), scene = vi.spyOn(sceneModule, 'validateSceneDocument')
    try {
      const first = validator.validate(original); expect(scene).toHaveBeenCalledTimes(1)
      const same = cloneJson(original); same.document.title = 'Metadata only'; same.document.revision++
      expect(validator.validate(same)).toEqual(same); expect(scene).toHaveBeenCalledTimes(1)
      same.document.title = 'Caller mutated'; expect(first.document.title).toBe(original.document.title)
      const changed = cloneJson(original); changed.document.notes['unregistered'] = { invalid: true } as never
      expect(() => validator.validate(changed)).toThrow(); expect(scene).toHaveBeenCalledTimes(2)
      const unknown = cloneJson(original) as ProjectData & { unknown: boolean }; unknown.unknown = true
      expect(() => validator.validate(unknown)).toThrow()
      const badTitle = cloneJson(original); badTitle.document.title = ''
      expect(() => validator.validate(badTitle)).toThrow()
      const badRevision = cloneJson(original); badRevision.document.revision = -1
      expect(() => validator.validate(badRevision)).toThrow()
      const badLicense = cloneJson(original); badLicense.licenses['a'.repeat(64)] = { sha256: 'a'.repeat(64), text: 'not matching' }
      expect(() => validator.validate(badLicense)).toThrow()
      const calls = scene.mock.calls.length; validator.clear(); validator.validate(original)
      expect(scene).toHaveBeenCalledTimes(calls + 1)
      // Public validation never consumes this private family's memo.
      validateProjectData(first); expect(scene).toHaveBeenCalledTimes(calls + 2)
    } finally { scene.mockRestore() }
  })
  it('owns immutable audit states while checking unknown baselines, every result and independent branches', () => {
    const before = fixture(), left = cloneJson(before), right = cloneJson(before)
    left.document.title = 'Left'; right.document.title = 'Right'
    const first = createProjectDelta(before, left), second = createProjectDelta(before, right), replay = createProjectDeltaReplay()
    const captured = replay.capture(before, first.beforeHash)
    expect(Object.isFrozen(captured.document)).toBe(true)
    before.document.title = 'caller changed'
    expect(replay.apply(captured, first)).toEqual(left)
    expect(replay.apply(captured, second)).toEqual(right)
    expect(() => replay.apply(before, first)).toThrow(/hash/)
    expect(() => replay.apply(captured, { ...first, afterHash: 'a'.repeat(64) })).toThrow(/hash/)
    expect(() => replay.capture(captured, 'b'.repeat(64))).toThrow(/hash/)
    const invalid = cloneJson(captured); invalid.document.revision = -1
    expect(() => replay.capture(invalid, first.beforeHash)).toThrow()
    const getter = vi.fn(() => 1), unsafe = { ...captured }
    Object.defineProperty(unsafe, 'unexpected', { enumerable: true, get: getter })
    expect(() => replay.capture(unsafe, first.beforeHash)).toThrow(); expect(getter).not.toHaveBeenCalled()
  })
  it('reuses exact canonical bodies across branches while hashing every output and invalidating changed geometry', () => {
    const original = fixture(document => {
      document.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId: document.props.item.floorId,
        parentId: null, frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
    })
    // Valid numeric and reserved-name entity IDs must keep the preexisting
    // canonical wire ordering and own-data semantics.
    for (const key of ['10', '2', '01', 'constructor', 'prototype']) {
      original.document.userLayers[key] = { ...Object.values(original.document.userLayers)[0], id: key, name: key,
        order: Object.keys(original.document.userLayers).length }
    }
    const root = validateProjectData(original), projects: ProjectData[] = []
    for (let revision = 1; revision <= 9; revision++) {
      const project = cloneJson(root)
      project.document.revision = revision; project.document.updatedAt = `2026-11-12T00:00:00.${String(revision).padStart(3,'0')}Z`
      project.document.title = ['完整 😀', '\"quoted\" \\ path\n', '数值键 10 2'][revision % 3]
      if (revision >= 5) project.document.props.item.positionMm.x += 250
      projects.push(validateProjectData(project))
    }
    const deltas = projects.map(project => createProjectDelta(root, project)), replay = createProjectDeltaReplay()
    const baseline = replay.capture(root, deltas[0].beforeHash), digest = vi.spyOn(hashModule,'sha256Bytes')
    try {
      for (let i = 0; i < projects.length; i++) {
        const count = digest.mock.calls.length
        const actual = replay.apply(baseline,deltas[i])
        expect(actual).toEqual(projects[i]); expect(Object.isFrozen(actual.document)).toBe(true)
        expect(digest.mock.calls.length).toBeGreaterThan(count)
        const bytes = digest.mock.calls.at(-1)![0]
        expect(new TextDecoder().decode(bytes)).toBe(canonicalJson(encodeProjectCoordinates(projects[i])))
      }
      expect(() => replay.apply(baseline,{ ...deltas.at(-1)!, afterHash: 'f'.repeat(64) })).toThrow(/hash/)
      replay.clear()
      expect(replay.capture(projects[0],deltas[0].afterHash)).toEqual(projects[0])
    } finally {digest.mockRestore();replay.clear()}
  })
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

describe('privately certified local project deltas', () => {
  function propStage(before: ProjectData, changes: PropUpdateCommand['changes']) {
    const content = { document: before.document, historyIdentity: before.historyIdentity, appearance: before.appearance }
    const transaction = tryApplyPropUpdateCompositionTransaction(content, [{ type: 'updateProp', id: 'item', changes }])
    expect(transaction).toBeDefined()
    const result = tryCertifyLocalProjectData({ ...before, ...transaction!.result }, before)
    expect(result).toBeDefined()
    return result!
  }
  function revisionStage(before: ProjectData, increment = 1, updatedAt = '2026-11-06T00:00:00.000Z') {
    const baseline = { document: before.document, historyIdentity: before.historyIdentity, appearance: before.appearance }
    const content = reviseCompositionContent(baseline, before.document.revision + increment, updatedAt)
    const result = tryCertifyLocalProjectData({ ...before, ...content }, before)
    expect(result).toBeDefined()
    return result!
  }

  it('derives only real position/rotation writes and preserves complete bidirectional hashes', () => {
    const before = certifyProjectData(fixture()), after = propStage(before, { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 })
    const receipt = getProjectLocalTransaction(after)!, delta = tryCreateLocalProjectDelta(cloneJson(before), after)!
    expect(receipt.baseline).toBe(before)
    expect(receipt.result).toBe(after)
    expect(receipt.stage).toBe('prop')
    expect(receipt.propChanges.map(change => change.fields)).toEqual([['positionMm', 'rotationDeg']])
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(delta.changes.map(change => change.path)).toEqual([
      ['document', 'props', 'item', 'positionMm'], ['document', 'props', 'item', 'rotationDeg'],
    ])
    const complete = createProjectDelta(before, after)
    expect([delta.beforeHash, delta.afterHash]).toEqual([complete.beforeHash, complete.afterHash])
    expect(applyProjectDelta(before, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(before)
  })

  it('merges only the immediately preceding Prop stage into its single revision step', () => {
    const before = certifyProjectData(fixture()), moved = propStage(before, { positionMm: { x: 4500, y: 4000 } }), after = revisionStage(moved)
    const receipt = getProjectLocalTransaction(after)!, delta = tryCreateLocalProjectDelta(before, after)!
    expect(receipt.baseline).toBe(before)
    expect(receipt.stage).toBe('revision')
    expect(receipt.propChanges).toHaveLength(1)
    expect(delta.changes.map(change => change.path.join('.'))).toEqual(['document.props.item.positionMm', 'document.revision', 'document.updatedAt'])
    expect(applyProjectDelta(before, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(before)
    expect(delta.afterHash).toBe(projectContentHash(after))
  })

  it('starts a fresh baseline for a later edit and never merges revision chains', () => {
    const before = certifyProjectData(fixture()), first = revisionStage(propStage(before, { positionMm: { x: 4500, y: 4000 } }))
    const second = revisionStage(propStage(first, { positionMm: { x: 5000, y: 4000 } }), 1, '2026-11-06T00:00:01.000Z')
    expect(getProjectLocalTransaction(second)?.baseline).toBe(first)
    expect(tryCreateLocalProjectDelta(before, second)).toBeUndefined()
    expect(applyProjectDelta(first, tryCreateLocalProjectDelta(first, second)!, 'forward')).toEqual(second)
    const third = revisionStage(second, 1, '2026-11-06T00:00:02.000Z')
    expect(getProjectLocalTransaction(third)?.baseline).toBe(second)
    expect(getProjectLocalTransaction(third)?.propChanges).toEqual([])
    expect(tryCreateLocalProjectDelta(first, third)).toBeUndefined()
    expect(applyProjectDelta(second, tryCreateLocalProjectDelta(second, third)!, 'forward')).toEqual(third)
  })

  it('does not merge a skipped revision and supports genuine revision-only writes', () => {
    const before = certifyProjectData(fixture()), moved = propStage(before, { positionMm: { x: 4500, y: 4000 } }), after = revisionStage(moved, 2)
    expect(getProjectLocalTransaction(after)?.baseline).toBe(moved)
    expect(getProjectLocalTransaction(after)?.propChanges).toEqual([])
    expect(tryCreateLocalProjectDelta(before, after)).toBeUndefined()
    const delta = tryCreateLocalProjectDelta(moved, after)!
    expect(delta.changes.map(change => change.path.join('.'))).toEqual(['document.revision', 'document.updatedAt'])
    expect(applyProjectDelta(moved, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(moved)
  })

  it('requires private proof and exact full before/after content through detached save copies', () => {
    const before = certifyProjectData(fixture()), after = propStage(before, { positionMm: { x: 4500, y: 4000 } })
    const copied = validateProjectData(after), forged = freezeJson(cloneJson(after))
    expect(getProjectLocalTransaction(copied)).toBeUndefined()
    expect(getProjectLocalTransaction(forged)).toBeUndefined()
    expect(getProjectLocalTransaction({ ...after })).toBeUndefined()
    expect(tryCreateLocalProjectDelta(before, copied)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(before, forged)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(before, copied, after)).toEqual(tryCreateLocalProjectDelta(before, after))
    copied.document.title = 'Different saved result, same revision'
    expect(tryCreateLocalProjectDelta(before, copied, after)).toBeUndefined()
    const unrelated = cloneJson(before); unrelated.document.title = 'Different stored baseline, same revision'
    expect(tryCreateLocalProjectDelta(unrelated, after)).toBeUndefined()
    expect(unrelated.document.sceneId).toBe(before.document.sceneId)
    expect(unrelated.document.revision).toBe(before.document.revision)
  })

  it('does not execute unsafe caller getters and releases only the named result', () => {
    const before = certifyProjectData(fixture()), after = propStage(before, { positionMm: { x: 4500, y: 4000 } }), revised = revisionStage(after)
    let calls = 0
    const unsafeBefore = cloneJson(before), unsafeAfter = cloneJson(after)
    Object.defineProperty(unsafeBefore.document, 'title', { enumerable: true, get() { calls++; return before.document.title } })
    Object.defineProperty(unsafeAfter.document, 'title', { enumerable: true, get() { calls++; return after.document.title } })
    expect(tryCreateLocalProjectDelta(unsafeBefore, after)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(before, unsafeAfter, after)).toBeUndefined()
    expect(getProjectLocalTransaction(unsafeAfter)).toBeUndefined()
    expect(calls).toBe(0)
    releaseProjectLocalTransaction({ ...after })
    expect(getProjectLocalTransaction(after)).toBeDefined()
    releaseProjectLocalTransaction(after)
    expect(getProjectLocalTransaction(after)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(before, after)).toBeUndefined()
    expect(getProjectLocalTransaction(revised)).toBeDefined()
    expect(tryCreateLocalProjectDelta(before, revised)).toBeDefined()
  })

  it('rejects extra fields, invalid JSON and custom prototypes at either copied endpoint', () => {
    const before = certifyProjectData(fixture()), after = propStage(before, { positionMm: { x: 4500, y: 4000 } })
    const mutations: ((project: ProjectData) => void)[] = [
      project => { (project as unknown as Record<string, unknown>).extra = true },
      project => { (project.document.props.item as unknown as Record<string, unknown>).extra = true },
      project => { (project as unknown as Record<string, unknown>).assets = undefined },
      project => { project.document.props.item.rotationDeg = NaN },
      project => { (project as unknown as Record<string, unknown>).extra = () => true },
      project => { (project as unknown as Record<PropertyKey, unknown>)[Symbol('hidden')] = true },
      project => { Object.defineProperty(project.document, 'hidden', { value: true }) },
      project => { Object.setPrototypeOf(project.document.props.item, { inherited: true }) },
      project => { delete (project as Partial<ProjectData>).historyIdentity },
    ]
    for (const mutate of mutations) {
      const invalidBefore = cloneJson(before), invalidAfter = cloneJson(after)
      mutate(invalidBefore); mutate(invalidAfter)
      expect(tryCreateLocalProjectDelta(invalidBefore, after)).toBeUndefined()
      expect(tryCreateLocalProjectDelta(before, invalidAfter, after)).toBeUndefined()
    }
    expect(tryCreateLocalProjectDelta(null as unknown as ProjectData, after)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(before, { document: null } as unknown as ProjectData, after)).toBeUndefined()
  })

  it('rejects different complete content even when hash outputs are identical', () => {
    const before = certifyProjectData(fixture()), after = propStage(before, { positionMm: { x: 4500, y: 4000 } })
    const wrongBefore = cloneJson(before), wrongAfter = cloneJson(after)
    wrongBefore.document.title = 'Another baseline'; wrongAfter.document.title = 'Another result'
    const collision = vi.spyOn(hashModule, 'sha256Bytes').mockReturnValue('a'.repeat(64))
    try {
      expect(sha256Bytes(encodeUtf8('one'))).toBe(sha256Bytes(encodeUtf8('another')))
      expect(tryCreateLocalProjectDelta(wrongBefore, after)).toBeUndefined()
      expect(tryCreateLocalProjectDelta(before, wrongAfter, after)).toBeUndefined()
    } finally { collision.mockRestore() }
  })

  it('stores actual frame-relative values for a moved and rotated aggregate member', () => {
    const input = fixture(document => {
      document.props.item.positionMm = { x: 4000, y: 4000 }; document.props.item.rotationDeg = 0
      document.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId: document.props.item.floorId,
        parentId: null, frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
    })
    const before = certifyProjectData(input), after = revisionStage(propStage(before, { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 }))
    const delta = tryCreateLocalProjectDelta(before, after)!
    expect(delta.changes.find(change => change.path.at(-1) === 'positionMm')).toEqual({ path: ['document', 'props', 'item', 'positionMm'],
      before: { present: true, value: { x: 2000, y: -3000 } }, after: { present: true, value: { x: 2000, y: -3500 } } })
    expect(delta.changes.find(change => change.path.at(-1) === 'rotationDeg')).toEqual({ path: ['document', 'props', 'item', 'rotationDeg'],
      before: { present: true, value: 270 }, after: { present: true, value: 0 } })
    expect(delta.beforeHash).toBe(projectContentHash(before))
    expect(delta.afterHash).toBe(projectContentHash(after))
    expect(tryCreateLocalProjectDelta(encodeProjectCoordinates(before), encodeProjectCoordinates(after), after)).toEqual(delta)
    const normalizedAlias = cloneJson(after); normalizedAlias.document.props.item.rotationDeg += 360
    expect(tryCreateLocalProjectDelta(before, normalizedAlias, after)).toBeUndefined()
    expect(applyProjectDelta(before, delta, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, delta, 'backward')).toEqual(before)
  })

  it('consumes exact owned encodings without rehashing and keeps full bidirectional delta bytes', () => {
    const before = certifyProjectData(fixture(document => {
      document.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId: document.props.item.floorId,
        parentId: null, frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
    })), after = revisionStage(propStage(before, { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 }))
    const encodings = { before: encodeProjectContentData(before), after: encodeProjectContentData(after) }
    const expected = tryCreateLocalProjectDelta(before, after)!, digest = vi.spyOn(hashModule, 'sha256Bytes')
    try {
      expect(tryCreateLocalProjectDelta(before, after, after, encodings)).toEqual(expected)
      expect(tryCreateLocalProjectDelta(encodings.before.stored, encodings.after.stored, after, encodings)).toEqual(expected)
      expect(digest).not.toHaveBeenCalled()
    } finally { digest.mockRestore() }
    expect(applyProjectDelta(before, expected, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, expected, 'backward')).toEqual(before)
    expect(encodings.before.contentHash).toBe(projectContentHash(before))
    expect(encodings.after.contentHash).toBe(projectContentHash(after))
    expect(Object.isFrozen(encodings.after.stored.document.props.item.positionMm)).toBe(true)
  })

  it('owns the actual complete encoding and rejects unsafe inputs without invoking getters', () => {
    const input = fixture(); input.document.title = '完整编码 🗺️'
    const encoding = encodeProjectContentData(input), bytes = new TextEncoder().encode(encoding.canonical)
    expect(encoding.byteLength).toBe(bytes.length)
    expect(encoding.contentHash).toBe(sha256Bytes(bytes))
    expect(encoding.contentHash).toBe(projectContentHash(input))
    expect(getOwnedProjectEncoding(encoding, input)).toBe(encoding)
    expect(getOwnedProjectEncoding({ ...encoding })).toBeUndefined()
    input.document.title = 'Caller changed later'
    expect(encoding.stored.document.title).toBe('完整编码 🗺️')
    let calls = 0
    Object.defineProperty(input.document, 'title', { enumerable: true, get() { calls++; return 'Unsafe' } })
    expect(() => encodeProjectContentData(input)).toThrow(/访问器|JSON/)
    expect(calls).toBe(0)
  })

  it('keeps full comparison for copied endpoints, copied or forged encodings and mutable source lookalikes', () => {
    const before = certifyProjectData(fixture()), after = revisionStage(propStage(before, { positionMm: { x: 4500, y: 4000 } }))
    const encodings = { before: encodeProjectContentData(before), after: encodeProjectContentData(after) }, expected = tryCreateLocalProjectDelta(before, after)!
    const copiedBefore = cloneJson(before), copiedAfter = cloneJson(after)
    const mutableEncodings = { before: encodeProjectContentData(copiedBefore), after: encodeProjectContentData(copiedAfter) }
    const forged = { before: { ...encodings.before, contentHash: 'a'.repeat(64) }, after: { ...encodings.after, contentHash: 'b'.repeat(64) } }
    expect(getOwnedProjectEncoding(forged.before)).toBeUndefined()
    expect(getOwnedProjectEncoding(encodings.before, copiedBefore)).toBeUndefined()
    const digest = vi.spyOn(hashModule, 'sha256Bytes')
    try {
      for (const proof of [encodings, mutableEncodings, forged, cloneJson(encodings)]) {
        digest.mockClear()
        expect(tryCreateLocalProjectDelta(copiedBefore, copiedAfter, after, proof)).toEqual(expected)
        expect(digest).toHaveBeenCalled()
      }
      digest.mockClear()
      expect(tryCreateLocalProjectDelta(before, after, after, forged)).toEqual(expected)
      expect(digest).toHaveBeenCalled()
      copiedBefore.document.title = 'Stale before after encoding'
      copiedAfter.document.title = 'Different after after encoding'
      expect(tryCreateLocalProjectDelta(copiedBefore, after, after, mutableEncodings)).toBeUndefined()
      expect(tryCreateLocalProjectDelta(before, copiedAfter, after, mutableEncodings)).toBeUndefined()
      expect(tryCreateLocalProjectDelta(before, after, cloneJson(after), encodings)).toBeUndefined()
      releaseProjectLocalTransaction(after)
      expect(tryCreateLocalProjectDelta(before, after, after, encodings)).toBeUndefined()
    } finally { digest.mockRestore() }
  })

  it('does not evaluate evidence accessors or let a genuine encoding authorize a noncontiguous baseline', () => {
    const before = certifyProjectData(fixture()), first = revisionStage(propStage(before, { positionMm: { x: 4500, y: 4000 } }))
    const second = revisionStage(propStage(first, { positionMm: { x: 5000, y: 4000 } }), 1, '2026-11-06T00:00:01.000Z')
    let calls = 0
    const encodings = { before: encodeProjectContentData(before), after: encodeProjectContentData(second) }
    expect(tryCreateLocalProjectDelta(before, second, second, encodings)).toBeUndefined()
    const unsafe = Object.defineProperty({ after: encodeProjectContentData(first) }, 'before', { enumerable: true, get() { calls++; return encodings.before } })
    expect(tryCreateLocalProjectDelta(before, first, first, unsafe as typeof encodings)).toEqual(tryCreateLocalProjectDelta(before, first))
    expect(calls).toBe(0)
  })

  function commonStage(before: ProjectData, commands: readonly CompositionCommand[]) {
    const content = applyCompositionDraftCommands({ document: before.document, historyIdentity: before.historyIdentity, appearance: before.appearance }, commands,
      { ids: { nextId: () => `delta-common-${++sequence}` }, clock: { now: () => '2026-11-09T00:00:00.000Z' } })
    const after = certifyProjectData({ ...before, ...content })
    const receipt = completeCompositionTransactionReceipt({ document: after.document, historyIdentity: after.historyIdentity, appearance: after.appearance }, getCompositionTransactionReceipt(content)!)!
    expect(completeProjectTransactionReceipt(before, after, receipt)).toBeDefined()
    return after
  }

  it('reuses actual encodings for complete common receipts and revokes that reuse with the receipt', () => {
    const before = certifyProjectData(fixture()), after = commonStage(before, [{ type: 'renameScene', title: 'Common exact endpoint' }])
    const encodings = { before: encodeProjectContentData(before), after: encodeProjectContentData(after) }
    const expected = createProjectDelta(before, after), digest = vi.spyOn(hashModule, 'sha256Bytes')
    try {
      expect(tryCreateLocalProjectDelta(encodings.before.stored, encodings.after.stored, after, encodings)).toEqual(expected)
      expect(digest).not.toHaveBeenCalled()
    } finally { digest.mockRestore() }
    expect(applyProjectDelta(before, expected, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, expected, 'backward')).toEqual(before)
    releaseProjectTransactionReceipt(after)
    expect(tryCreateLocalProjectDelta(before, after, after, encodings)).toBeUndefined()
  })

  it('retains full stored replay when aggregate encoding introduces changes absent from a common world receipt', () => {
    const before = certifyProjectData(fixture()), after = commonStage(before, [{ type: 'createAggregateGroup', group: {
      id: 'new-encoding-group', floorId: before.document.props.item.floorId, parentId: null, members: [{ kind: 'prop', id: 'item' }],
      frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, editLocked: false,
    } }])
    const encodings = { before: encodeProjectContentData(before), after: encodeProjectContentData(after) }
    expect(tryCreateLocalProjectDelta(before, after)).toBeUndefined()
    expect(tryCreateLocalProjectDelta(encodings.before.stored, encodings.after.stored, after, encodings)).toBeUndefined()
    const full = createProjectDelta(before, after)
    expect(applyProjectDelta(before, full, 'forward')).toEqual(after)
    expect(applyProjectDelta(after, full, 'backward')).toEqual(before)
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
