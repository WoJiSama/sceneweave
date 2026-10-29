import { getLegacyGeneration } from './composition-contracts.js'
import { describe, expect, it } from 'vitest'
import { applyCompositionCommands, applyCompositionDraftCommands } from '../appearance/commands.js'
import { addPropAppearanceSource, createCompositionContent, resolveAppearance } from '../appearance/graph.js'
import { buildRestorePlan } from '../history/restore.js'
import type { CompositionCommand, CompositionContent } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { validateCompositionContent, validateCompositionDraft } from '../validation/content.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createEmptyGeneration, type GenerationReference } from './contracts.js'
import { constraintInputHash, detachChangedOutputs, generationInputHash, managedOutputHash } from './integrity.js'
import { terrainCommandCost } from './cost.js'
import { selectionScene } from '../../editor/native-canvas/selection-scene.js'
import { hitTestAll, selectInBounds } from '../../editor/native-canvas/selection.js'
import { isCertifiedSceneSnapshot, validateSceneSnapshot } from '../validation/snapshots.js'
import { previewOutdoorCommands, type OutdoorCommand } from '../commands/outdoor.js'

const stamp = '2026-10-26T00:00:00.000Z'
let sequence = 0
const runtime = () => ({ ids: { nextId: () => `terrain-lifecycle-${++sequence}` }, clock: { now: () => stamp } })
const ref: GenerationReference = { kind: 'prop', entityId: 'item', parentId: null, fieldGroup: 'geometry' }
function refresh(document: SceneDocument) {
  const rule = getLegacyGeneration(document)!.rules.rule
  rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
  getLegacyGeneration(document)!.checks.check.inputHash = constraintInputHash(document, 'clear')
}
function content(): CompositionContent {
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const document: SceneDocument = {
    format: 'sceneweave-scene', schemaVersion: 3, sceneId: 'terrain-lifecycle', revision: 0, title: 'Terrain lifecycle fixture', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: true }, exportBoundsMm: bounds,
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: bounds } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { objects: { id: 'objects', floorId: 'floor', name: 'Objects', order: 0, editLocked: false }, rules: { id: 'rules', floorId: 'floor', name: 'Rules', order: 1, editLocked: false } }, entityLayers: { item: 'objects' },
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] },
    mapMode: 'scene', generation: createEmptyGeneration(), regional: null, visual: { version: 2, base: emptyVisualSystem(), materializedEdges: {} },
  }
  document.props.item = { id: 'item', floorId: 'floor', editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 },
    positionMm: { x: 4000, y: 4000 }, rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'floor' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
  const generation = getLegacyGeneration(document)!
  generation.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'test-terrain', algorithmVersion: 1, mapMode: 'scene', seed: 'fixture',
    parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 800, plateauElevationMm: 2600, roughness: 0, densityFactor: 0, baySide: 'north' }, materials: [], props: [], precision: { sampleSpacingMm: 1000, toleranceMm: 50, noiseCellMm: 2000 } }
  generation.rules.rule = { id: 'rule', floorId: 'floor', layerId: 'rules', visibility: 'public', editLocked: false, kind: 'terrain', recipeRef: { id: 'recipe', version: 1 }, inputs: [], outputs: [ref], parameters: { widthMm: 200, minWidthMm: 200, maxWidthMm: 200, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  generation.ownership.owner = { id: 'owner', outputKey: 'fixture/item', ruleId: 'rule', target: ref, managedFields: ['geometry', 'properties', 'appearance'], manualFields: [], state: 'managed', birthToken: 'fixture-birth' }
  generation.constraints.clear = { id: 'clear', floorId: 'floor', visibility: 'public', strength: 'hard', kind: 'activityArea', boundaryMm: [{ x: 8000, y: 8000 }, { x: 10000, y: 8000 }, { x: 10000, y: 10000 }, { x: 8000, y: 10000 }], clearanceMm: 0 }
  generation.checks.check = { id: 'check', constraintId: 'clear', state: 'passed', algorithmId: 'test-clearance', algorithmVersion: 1, inputHash: '0'.repeat(64), issues: [] }
  refresh(document)
  return createCompositionContent(document, runtime())
}
const opacity = (value: number): CompositionCommand => ({ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'manual-opacity', kind: 'opacity', value, enabled: true } })

describe('T0/T1 generated-result lifecycle through appearance and history', () => {
  it('protects graph-only appearance before resolving and leaves geometry managed', () => {
    const source = content(), before = canonicalJson(source), draft = applyCompositionDraftCommands(source, [opacity(.4)], runtime())
    expect(draft.document.props.item.appearance.opacity).toBe(1)
    expect(getLegacyGeneration(draft.document)!.ownership.owner).toMatchObject({ state: 'manual', managedFields: ['geometry', 'properties'], manualFields: ['appearance'] })
    expect(getLegacyGeneration(draft.document)!.rules.rule.state).toBe('paused')
    expect(getLegacyGeneration(draft.document)!.checks.check.state).toBe('unchecked')
    expect(() => validateCompositionDraft(draft)).not.toThrow()
    const resolved = resolveAppearance(draft)
    expect(resolved.document.props.item.appearance.opacity).toBe(.4)
    expect(() => validateCompositionContent(resolved)).not.toThrow()
    expect(canonicalJson(source)).toBe(before)
  })

  it('does not mark a disabled adjustment manual or detach geometric fields by appearance hints', () => {
    const source = content(), command = opacity(.4)
    if (command.type !== 'setAppearanceAdjustment') throw new Error('fixture command')
    command.adjustment.enabled = false
    const draft = applyCompositionCommands(source, [command], runtime())
    expect(draft.document.generation).toEqual(source.document.generation)
    const hinted = cloneJson(source.document)
    detachChangedOutputs(source.document, hinted, [{ ...ref, fieldGroup: 'appearance' }])
    expect(getLegacyGeneration(hinted)!.ownership.owner.managedFields).toContain('geometry')
    expect(getLegacyGeneration(hinted)!.ownership.owner.manualFields).toEqual(['appearance'])
  })

  it('rejects implicit edits of a locked rule or its separately locked layer', () => {
    for (const kind of ['rule', 'layer'] as const) {
      const source = content()
      if (kind === 'rule') getLegacyGeneration(source.document)!.rules.rule.editLocked = true
      else source.document.userLayers.rules.editLocked = true
      const before = canonicalJson(source)
      expect(() => applyCompositionCommands(source, [opacity(.4)], runtime())).toThrow(/规则|图层/)
      expect(() => applyCompositionCommands(source, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }], runtime())).toThrow(/规则|图层/)
      expect(canonicalJson(source)).toBe(before)
    }
  })

  it('requires locked-rule permission when editing one of its unowned inputs', () => {
    const source = content()
    source.document.props.input = { ...cloneJson(source.document.props.item), id: 'input', positionMm: { x: 6500, y: 4500 } }
    source.document.entityLayers.input = 'objects'
    getLegacyGeneration(source.document)!.rules.rule.inputs = [{ ...ref, entityId: 'input' }]
    getLegacyGeneration(source.document)!.rules.rule.editLocked = true
    refresh(source.document)
    const input = createCompositionContent(source.document, runtime()), before = canonicalJson(input)
    expect(() => applyCompositionCommands(input, [{ type: 'updateProp', id: 'input', changes: { rotationDeg: 35 } }], runtime())).toThrow(/规则|图层/)
    expect(canonicalJson(input)).toBe(before)
  })

  it('waits for real resolved geometry before protecting a source-dependent bounds change', () => {
    const source = content(), replacement = cloneJson(source.document.props.item)
    replacement.visualBoundsMm.width = 260
    const sourceId = addPropAppearanceSource(source.appearance, replacement)
    const pending = applyCompositionCommands(source, [{ type: 'setAppearanceSource', ids: ['item'], sourceId }], runtime())
    expect(getLegacyGeneration(pending.document)!.ownership.owner.manualFields).toEqual(['appearance'])
    expect(getLegacyGeneration(pending.document)!.ownership.owner.managedFields).toContain('geometry')
    const resolved = resolveAppearance(pending)
    detachChangedOutputs(pending.document, resolved.document)
    expect(getLegacyGeneration(resolved.document)!.ownership.owner.manualFields).toEqual(['appearance', 'geometry'])
    expect(() => validateCompositionContent(resolved)).not.toThrow()
  })

  it('includes generation records in the cumulative command budget even with one final target', () => {
    const source = content(), before = canonicalJson(source)
    const commands = Array.from({ length: 254 }, (_, index) => opacity(index % 2 ? .6 : .4))
    expect(() => applyCompositionCommands(source, commands, runtime())).toThrow(/256/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('previews restore ownership/check changes and preserves current position and other manual fields', () => {
    const current = content(), historic = cloneJson(current)
    historic.document.props.item.appearance.opacity = .6
    historic.appearance.propSources.item = addPropAppearanceSource(historic.appearance, historic.document.props.item)
    refresh(historic.document)
    const before = canonicalJson(current), plan = buildRestorePlan(current, historic, { ids: ['item'], mode: 'appearance' })
    expect(getLegacyGeneration(plan.document)!.ownership.owner.manualFields).toEqual(['appearance'])
    expect(plan.document.props.item.positionMm).toEqual(current.document.props.item.positionMm)
    expect(plan.changes.filter(change => change.kind === 'generation').map(change => change.id)).toEqual(expect.arrayContaining(['owner', 'rule', 'check']))
    expect(plan.commandCost).toBeGreaterThanOrEqual(terrainCommandCost(current.document, plan.document).total)
    expect(() => validateCompositionContent(resolveAppearance({ document: plan.document, historyIdentity: plan.historyIdentity, appearance: plan.appearance }))).not.toThrow()
    expect(canonicalJson(current)).toBe(before)
  })

  it('restores an explicitly recreated deleted result as manual without reactivating generation', () => {
    const historic = content(), current = applyCompositionCommands(historic, [{ type: 'deleteProp', id: 'item' }], runtime())
    expect(getLegacyGeneration(current.document)!.ownership.owner.state).toBe('deleted')
    const plan = buildRestorePlan(current, historic, { ids: ['item'], mode: 'entity' })
    expect(getLegacyGeneration(plan.document)!.ownership.owner.state).toBe('manual')
    expect(getLegacyGeneration(plan.document)!.ownership.owner.managedFields).toEqual([])
    expect(getLegacyGeneration(plan.document)!.rules.rule.state).toBe('paused')
    expect(validateSceneDocument(plan.document).ok).toBe(true)
  })

  it.each(['effectiveLocks', 'layerOrder'] as const)('keeps the %s inspector disposable while preserving generated source hashes', option => {
    const source = content().document
    source.props.item.renderOrder = 9
    source.userLayers.objects.editLocked = option === 'effectiveLocks'
    refresh(source)
    const checked = validateSceneSnapshot(source)
    if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join('；'))
    const before = canonicalJson(checked.document), hash = getLegacyGeneration(checked.document)!.rules.rule.managedOutputHash
    const view = selectionScene(checked.document, { [option]: true })
    expect(isCertifiedSceneSnapshot(checked.document)).toBe(true)
    expect(isCertifiedSceneSnapshot(view)).toBe(false)
    expect(hitTestAll(view, { x: 4000, y: 4000 }, 0)).toContain('item')
    if (option === 'effectiveLocks') expect(selectInBounds(view, view.exportBoundsMm, 'contain').ids).not.toContain('item')
    else expect(selectInBounds(view, view.exportBoundsMm, 'contain').ids).toContain('item')
    expect(getLegacyGeneration(view)!.rules.rule.managedOutputHash).toBe(hash)
    expect(validateSceneDocument(view).ok).toBe(false)
    expect(canonicalJson(checked.document)).toBe(before)
  })

  it('includes generated prop detachment in direct outdoor previews without stale-hash failures', () => {
    const source = content(), before = canonicalJson(source)
    const commands: OutdoorCommand[] = [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 4300, y: 4200 } } }]
    const preview = previewOutdoorCommands(source.document, commands, runtime())
    const next = applyCompositionCommands(source, commands, runtime())
    expect(preview.reason).toBeNull()
    expect(preview.commandCost).toBe(terrainCommandCost(source.document, next.document).total)
    expect(preview.commandCost).toBeGreaterThan(1)
    expect(getLegacyGeneration(next.document)!.ownership.owner.manualFields).toContain('geometry')
    expect(canonicalJson(source)).toBe(before)
  })

  it('previews a real shore-point edit with all generation metadata in the same bounded delta', () => {
    const source = content(), document = source.document, generation = getLegacyGeneration(document)!
    document.terrainAreas.shore = { id: 'shore', floorId: 'floor', editLocked: false, visibility: 'public', boundaryMm: [{ x: 9000, y: 2000 }, { x: 14000, y: 2000 }, { x: 14000, y: 7000 }, { x: 9000, y: 7000 }].map((positionMm, index) => ({ id: `shore-p${index}`, segmentId: `shore-s${index}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    document.entityLayers.shore = 'objects'
    const shoreRef: GenerationReference = { kind: 'terrainArea', entityId: 'shore', parentId: null, fieldGroup: 'geometry' }
    generation.rules.rule.outputs.push(shoreRef)
    generation.ownership.shoreOwner = { id: 'shoreOwner', outputKey: 'fixture/shore', ruleId: 'rule', target: shoreRef, managedFields: ['geometry', 'properties', 'surface', 'source'], manualFields: [], state: 'managed', birthToken: 'fixture-shore' }
    refresh(document)
    const input = createCompositionContent(document, runtime()), before = canonicalJson(input)
    const commands: OutdoorCommand[] = [{ type: 'moveTerrainPoint', areaId: 'shore', pointId: 'shore-p0', positionMm: { x: 8800, y: 2000 } }]
    const preview = previewOutdoorCommands(input.document, commands, runtime()), next = applyCompositionCommands(input, commands, runtime())
    expect(preview.reason).toBeNull()
    expect(preview.commandCost).toBe(terrainCommandCost(input.document, next.document).total)
    expect(getLegacyGeneration(next.document)!.ownership.shoreOwner.manualFields).toContain('geometry')
    expect(preview.commandCost).toBeGreaterThan(2)
    expect(canonicalJson(input)).toBe(before)
  })
})
