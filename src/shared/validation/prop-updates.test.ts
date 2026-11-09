import { describe, expect, it, vi } from 'vitest'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3 } from '../../core/v3/test-fixtures.js'
import { imageFixtureV6 } from '../../core/v6/test-fixtures.js'
import { applyCompositionCommands, applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent, propAppearanceSnapshot } from '../appearance/graph.js'
import { inheritPropUpdatePresentations, presentationSourceId, propPresentation, scenePresentation } from '../appearance/presentation.js'
import { applyCommands, applySnapshotCommands } from '../commands/commands.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { certifyCompositionContent, getCertifiedCompositionContent, getCompositionRevisionTransaction, getPropUpdateCompositionTransaction, reviseCompositionContent, tryApplyPropUpdateCompositionTransaction, validateCompositionContent } from './content.js'
import { cloneJson, freezeJson } from './json.js'
import { getPropUpdateTransaction, isCertifiedSceneSnapshot, tryApplyPropUpdatesSnapshot, validateSceneSnapshot } from './snapshots.js'
import { validateSceneDocument } from './scene.js'

let sequence = 0
const runtime = { ids: { nextId: () => `prop-proof-${++sequence}` }, clock: { now: () => '2026-11-06T00:00:00.000Z' } }
const move = (x: number, id = 'item') => ({ type: 'updateProp' as const, id, changes: { positionMm: { x, y: 4000 } } })
function source(document = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })) {
  return certifyCompositionContent(createCompositionContent(document, runtime))
}

describe('controlled position and rotation transaction proofs', () => {
  it('retains certified complete branches and produces actual writes for independent and grouped Props', () => {
    const document = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })
    document.props.other = { ...cloneJson(document.props.item), id: 'other', positionMm: { x: 7000, y: 4000 } }
    document.entityLayers.other = document.entityLayers.item
    document.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId: 'blank-floor', parentId: null, frame: { translationMm: { x: 1000, y: 2000 }, quarterTurns: 1 }, members: [{ kind: 'prop', id: 'item' }], editLocked: false } } }
    const before = source(document), commands = [move(4500), { type: 'updateProp' as const, id: 'other', changes: { rotationDeg: 90 } }]
    const transaction = tryApplyPropUpdateCompositionTransaction(before, commands)!
    expect(transaction).toBeDefined()
    expect(transaction.result).toEqual(applyCompositionCommands(before, commands, runtime))
    expect(transaction.result.document.floors).toBe(before.document.floors)
    expect(transaction.result.document.aggregateCoordinates).toBe(before.document.aggregateCoordinates)
    expect(transaction.result.historyIdentity).toBe(before.historyIdentity)
    expect(transaction.result.appearance).toBe(before.appearance)
    expect(transaction.steps[0].after.document.props.other).toBe(before.document.props.other)
    expect(transaction.changes.map(change => [change.id, change.fields])).toEqual([['item', ['positionMm']], ['other', ['rotationDeg']]])
    expect(getCertifiedCompositionContent(transaction.result)).toBe(transaction.result)
    expect(getPropUpdateTransaction(transaction.result.document, before.document)).toBe(transaction.sceneTransaction)
    expect(getPropUpdateCompositionTransaction(transaction.result, before)).toBe(transaction)
    expect(getPropUpdateCompositionTransaction(transaction.steps[1].after, transaction.steps[1].before)?.commands).toHaveLength(1)
    expect(getPropUpdateCompositionTransaction(transaction.steps[1].after, before)?.commands).toHaveLength(2)
    expect(getPropUpdateTransaction(transaction.steps[1].after.document, transaction.steps[1].before.document)?.commands).toHaveLength(1)
    expect(validateSceneDocument(transaction.result.document).ok).toBe(true)
  })

  it('keeps repeated and move-back steps while preserving the original net-noop identity', () => {
    const before = source(), commands = [move(4500), move(4500), move(4000)], positions: number[] = [], costs: number[] = []
    const transaction = tryApplyPropUpdateCompositionTransaction(before, commands)!
    expect(transaction.result).toBe(before)
    expect(transaction.steps.map(step => step.changes.length)).toEqual([1, 0, 1])
    expect(transaction.changes).toEqual([])
    expect(getPropUpdateCompositionTransaction(before, before)).toBeUndefined()
    expect(getPropUpdateTransaction(before.document, before.document)).toBeUndefined()
    const result = applyCompositionDraftCommands(before, commands, runtime, { onContentDraft: content => positions.push(content.document.props.item.positionMm.x), onSceneDraft: (_draft, _command, cost) => costs.push(cost), onOperationCost: cost => costs.push(cost) })
    expect(result).toBe(before)
    expect(positions).toEqual([4500, 4500, 4000, 4000])
    expect(costs).toEqual([1, 1, 1, 3])
  })

  it('rejects caller-owned proof substitutes and captures command data without reading accessors', () => {
    const before = source(), input = [move(4500)]
    const transaction = tryApplyPropUpdateCompositionTransaction(before, input)!
    input[0].changes.positionMm.x = 6000
    expect(transaction.commands[0].changes.positionMm!.x).toBe(4500)
    expect(transaction.result.document.props.item.positionMm.x).toBe(4500)
    for (const key of ['document', 'historyIdentity', 'appearance'] as const) {
      const forged = { ...transaction.result, [key]: freezeJson(cloneJson(transaction.result[key])) }
      expect(getPropUpdateCompositionTransaction(forged)).toBeUndefined()
      expect(tryApplyPropUpdateCompositionTransaction(forged, [move(5000)])).toBeUndefined()
    }
    const getter = vi.fn(() => 4500), command = move(4500)
    Object.defineProperty(command.changes.positionMm, 'x', { enumerable: true, get: getter })
    expect(tryApplyPropUpdateCompositionTransaction(before, [command])).toBeUndefined()
    expect(getter).not.toHaveBeenCalled()
    expect(tryApplyPropUpdatesSnapshot(freezeJson(cloneJson(before.document)), [move(4500)])).toBeUndefined()
    expect(inheritPropUpdatePresentations(before.document, cloneJson(transaction.result.document), before.appearance)).toBe(false)
  })

  it('preserves entity, layer and recursively anchored note locks, including a real no-op', () => {
    for (const kind of ['entity', 'layer', 'note'] as const) {
      const document = cloneJson(source().document)
      if (kind === 'entity') document.props.item.editLocked = true
      if (kind === 'layer') document.userLayers[document.entityLayers.item].editLocked = true
      if (kind === 'note') {
        document.notes.first = { id: 'first', floorId: 'blank-floor', editLocked: false, kind: 'note', text: '', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
        document.notes.last = { id: 'last', floorId: 'blank-floor', editLocked: true, kind: 'note', text: '', visibility: 'gm', anchor: { type: 'entity', entityKind: 'note', entityId: 'first' } }
        document.entityLayers.first = document.entityLayers.last = document.entityLayers.item
      }
      const before = source(document)
      expect(() => applyCompositionDraftCommands(before, [move(4500)], runtime)).toThrow(/锁/)
      expect(applyCompositionDraftCommands(before, [move(4000)], runtime)).toBe(before)
    }
  })

  it('falls back for invalid intermediate geometry and still rejects an invalid final footprint', () => {
    const before = source(), repair = [move(-1000), move(4500)]
    expect(tryApplyPropUpdateCompositionTransaction(before, repair)).toBeUndefined()
    expect(() => applyCompositionDraftCommands(before, repair, runtime)).toThrow(/边界|占地/)
    expect(() => applyCompositionCommands(before, repair, runtime)).toThrow(/边界|占地/)
    expect(applySnapshotCommands(before.document, repair, runtime)).toEqual(applyCommands(before.document, repair, runtime))
    expect(() => applyCompositionDraftCommands(before, [move(-1000)], runtime)).toThrow(/边界|占地/)
    expect(isCertifiedSceneSnapshot(before.document)).toBe(true)
  })

  it('keeps prefab and scatter manual records on the complete fallback path', () => {
    for (const fixture of [groupLayerSceneV3(), scatterLayerSceneV3(1)]) {
      const before = source(toCurrentSceneDocument({ ...cloneJson(fixture), format: 'sceneweave-scene' }))
      const id = before.document.props.left ? 'left' : 'scatter-item-0', commands = [move(6500, id)]
      expect(tryApplyPropUpdateCompositionTransaction(before, commands)).toBeUndefined()
      expect(applyCompositionDraftCommands(before, commands, runtime)).toEqual(applyCompositionCommands(before, commands, runtime))
    }
  })

  it('supports unrelated generation branches without retaining caller-owned dependency caches', () => {
    const document = cloneJson(source().document)
    document.generation.legacy.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'terrain-compose', algorithmVersion: 1, mapMode: 'scene', seed: 'strict', parameters: { terrainKind: 'mixed', seaElevationMm: 0, landElevationMm: 500, plateauElevationMm: 1000, roughness: 0, densityFactor: 0, baySide: 'west' }, materials: [], props: [], precision: { sampleSpacingMm: 2000, toleranceMm: 100, noiseCellMm: 2000 } }
    const before = source(document), transaction = tryApplyPropUpdateCompositionTransaction(before, [move(4500)])!
    expect(transaction).toBeDefined()
    expect(transaction.result.document.generation).toBe(before.document.generation)
    expect(transaction.result).toEqual(applyCompositionCommands(before, [move(4500)], runtime))
  })

  it('inherits fixed near-side presentation and rejects rotations without promoting an invalid complete proof', () => {
    const document = toCurrentSceneDocument({ ...cloneJson(imageFixtureV6().document), format: 'sceneweave-scene' }), draft = createCompositionContent(document, runtime)
    const old = draft.appearance.sources[draft.appearance.propSources.item]
    if (old.kind !== 'prop') throw new Error('fixture')
    draft.document.props.item.footprintOffsetMm = { x: 0, y: 0 }
    const presentation = { mode: 'nearSide' as const, rootAnchorMm: { x: 0, y: 0 }, orientation: 'fixedUpright' as const, fixedRotationDeg: 0 as const, footprintAxes: 'world' as const, groundShadowMm: null }
    const id = presentationSourceId(propAppearanceSnapshot(old.snapshot), old.parentSourceId, presentation)
    draft.appearance.sources[id] = { ...old, id }; draft.appearance.propSources.item = id; draft.appearance.presentations![id] = presentation
    const before = certifyCompositionContent(draft), next = applyCompositionDraftCommands(before, [move(4500)], runtime)
    expect(getCertifiedCompositionContent(next)).toBe(next)
    expect(scenePresentation(next.document, 'item')).toBe(scenePresentation(before.document, 'item'))
    expect(propPresentation(next.appearance, 'item')).toBe(propPresentation(before.appearance, 'item'))
    const rotation = [{ type: 'updateProp' as const, id: 'item', changes: { rotationDeg: 90 } }]
    expect(tryApplyPropUpdateCompositionTransaction(before, rotation)).toBeUndefined()
    expect(() => applyCompositionDraftCommands(before, rotation, runtime)).toThrow(/旋转/)
    const publicContent = validateCompositionContent(next)
    expect(publicContent).toEqual(next); expect(publicContent).not.toBe(next)
    expect(getCertifiedCompositionContent(publicContent)).toBeUndefined()
  })

  it('binds metadata-only revision proofs to exact complete branches and validates replacement identity', () => {
    const before = source(), stamp = '2026-11-06T01:00:00.000Z'
    for (const identity of [undefined, before.historyIdentity]) {
      const result = reviseCompositionContent(before, before.document.revision + 1, stamp, identity)
      expect(result.document.props).toBe(before.document.props)
      expect(result.historyIdentity).toBe(before.historyIdentity)
      expect(result.appearance).toBe(before.appearance)
      expect(getCompositionRevisionTransaction(result, before)?.changes).toEqual({ revision: { before: before.document.revision, after: before.document.revision + 1 }, updatedAt: { before: before.document.updatedAt, after: stamp } })
      expect(getCompositionRevisionTransaction({ ...result, historyIdentity: cloneJson(result.historyIdentity) })).toBeUndefined()
      expect(validateCompositionContent(result)).toEqual(result)
    }
    const replacement = cloneJson(before.historyIdentity)
    const fullyChecked = reviseCompositionContent(before, before.document.revision + 1, stamp, replacement)
    expect(getCompositionRevisionTransaction(fullyChecked)).toBeUndefined()
    delete replacement.propTokens.item
    expect(() => reviseCompositionContent(before, before.document.revision + 1, stamp, replacement)).toThrow(/身份|token/)
    expect(() => reviseCompositionContent(before, -1, stamp)).toThrow()
  })

  it('uses the controlled snapshot path without changing the public command result', () => {
    const before = source().document, commands = [move(4500)], positions: number[] = []
    const result = applySnapshotCommands(before, commands, runtime, { onSceneDraft: scene => positions.push(scene.props.item.positionMm.x) })
    expect(result).toEqual(applyCommands(before, commands, runtime))
    expect(getPropUpdateTransaction(result, before)).toBeDefined()
    expect(positions).toEqual([4500])
    const parsed = validateSceneSnapshot(result)
    expect(parsed.ok && parsed.document).toBe(result)
  })
})
