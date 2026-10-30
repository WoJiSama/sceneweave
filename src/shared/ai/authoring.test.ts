import { describe, expect, it } from 'vitest'
import native from '../../platform/browser/content/scenes-data.json'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { emptyTerrainDocument } from '../terrain-generation/compose.js'
import { emptyVisualSystem } from '../visual/types.js'
import type { CompositionCommand } from '../model/appearance.js'
import { inspectDependencies } from '../geometry/dependencies.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { validateProjectData } from '../project/validate.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { AuthoringOperation, AuthoringStart, AuthoringStep } from './authoring-protocol-v1.js'
import { applyAuthoringStep, authoringProjectHash, checkAuthoringDraft, findAuthoringAssets, authoringAssetPage, publicAuthoringContext, replayAuthoring, validateAuthoringStart } from './authoring.js'

const stamp = '2026-10-24T00:00:00.000Z'
function fixture(): ProjectData {
  const document = cloneJson(native.scenes.blank.document) as unknown as SceneDocument
  document.title = 'GM private engineering title'
  document.assets = {}; document.propDefinitions = {}; document.materials = {}; document.prefabDefinitions = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  document.propDefinitions.definition = { id: 'definition', catalogId: 'test.authoring', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave test symbols', canEmbed: true },
    name: '公开桌子', tags: ['桌子', 'furniture'], defaultAppearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
    defaultVisualBoundsMm: { x: -200, y: -100, width: 400, height: 200 }, defaultFootprintMm: { width: 300, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 },
    defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  let count = 0
  const context: PreparationContext = { ids: { nextId: () => `fixture-token-${++count}` }, clock: { now: () => stamp } }
  const content = applyCompositionCommands(createCompositionContent(document, context), [{ type: 'addProp', id: 'target', floorId: 'blank-floor', layerId: 'layer-default-0',
    definitionRef: { id: 'definition', version: 1 }, positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'floor', id: 'blank-floor' } }], context)
  const text = 'MIT test licence; complete text stays local/server only', hash = sha256Text(text)
  return validateProjectData({ ...content, format: 'sceneweave-complete-project', schemaVersion: 1, assets: {}, licenses: { [hash]: { sha256: hash, text } },
    licenseBindings: [{ subjectKind: 'propDefinition', subjectId: 'definition', licenseRef: 'MIT', licensePath: `licenses/${hash}.txt`, embedding: 'allowed' }], authoringSources: {} })
}
function start(project = fixture()): AuthoringStart {
  return { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: 'fcb3353d-8c8f-4890-b002-a9f5a464a769', preparedAt: stamp,
    skill: { id: 'sceneweave-prop-authoring', version: 1 }, disclosure: 'complete-metadata/public-model',
    scope: { targetIds: ['target'], operations: ['place', 'transform', 'opacity'], placement: { floorId: 'blank-floor', layerId: 'layer-default-0',
      supportRef: { kind: 'floor', id: 'blank-floor' }, boundsMm: { x: 1000, y: 1000, width: 8000, height: 8000 }, definitionIds: ['definition'] } } }
}
const place: AuthoringOperation = { kind: 'place', definitionId: 'definition', positionMm: { x: 6000, y: 6000 }, rotationDeg: 30 }
function modify(project: ProjectData, commands: CompositionCommand[]): ProjectData {
  let count = 0
  const context: PreparationContext = { ids: { nextId: () => `extra-token-${++count}` }, clock: { now: () => stamp } }
  const content = applyCompositionCommands({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, commands, context)
  const hash = Object.keys(project.licenses)[0]
  return validateProjectData({ ...project, ...content, licenseBindings: inspectDependencies(content.document).subjects
    .map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' })) })
}

describe('shared public prop authoring ledger', () => {
  it('captures a strict immutable start and hashes all complete metadata deterministically', () => {
    const input = start(), checked = validateAuthoringStart(input)
    input.project.document.title += ' changed'
    expect(checked.project.document.title).toBe('GM private engineering title')
    expect(Object.isFrozen(checked.project.appearance)).toBe(true)
    expect(authoringProjectHash(checked.project)).toBe(sha256Text(canonicalJson(checked.project)))
    expect(() => validateAuthoringStart({ ...checked, baseContentHash: 'a'.repeat(64) })).toThrow(/hash/)
    expect(() => validateAuthoringStart({ ...checked, extra: true } as AuthoringStart)).toThrow()
    const oversized = cloneJson(checked); oversized.project.document.title = 'x'.repeat(4 * 1024 * 1024)
    expect(() => validateAuthoringStart(oversized)).toThrow(/4MiB/)
    let reads = 0
    const getter = start(); Object.defineProperty(getter.project, 'assets', { enumerable: true, get() { reads++; throw new Error('must not call') } })
    expect(() => validateAuthoringStart(getter)).toThrow(); expect(reads).toBe(0)
  })
  it('requires explicit scene scope for complete3 and accepts the T6 scene grant', () => {
    const project=fixture(),context={ids:{nextId:()=>crypto.randomUUID()},clock:{now:()=>stamp}}
    const visual={...project.document,schemaVersion:2 as const,visual:emptyVisualSystem()}
    const document=emptyTerrainDocument(visual),content=createCompositionContent(document,context)
    const terrain=validateProjectData({...project,schemaVersion:3,...content})
    expect(()=>validateAuthoringStart(start(terrain))).toThrow(/T6/)
    const floorId = Object.keys(terrain.document.floors)[0], layerId = Object.keys(terrain.document.userLayers).find(id => terrain.document.userLayers[id].floorId === floorId)!
    const explicit = start(terrain)
    explicit.scope = { targetIds: [], operations: [], placement: null, scene: { floorId, layerId, boundsMm: terrain.document.exportBoundsMm,
      entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], generationLayerIds: [layerId], regionalDefinitionIds: [], operations: ['terrainGenerate'] } }
    expect(validateAuthoringStart(explicit).scope.scene).toMatchObject({ floorId, layerId, generationLayerIds: [layerId], operations: ['terrainGenerate'] })
  })
  it('replays deterministic generated IDs, birth tokens and mixed supported operations without changing main revision', () => {
    const input = start(), initial = replayAuthoring(input, [])
    const first = applyAuthoringStep(input, initial.state, [place, { kind: 'opacity', id: 'target', value: .3 }, { kind: 'transform', id: 'target', rotationDeg: 45 }], 'step-one')
    expect(first.state.operationCost).toBe(3)
    const id = first.state.changedIds.find(id => id !== 'target')!
    expect(first.project.document.props[id].visibility).toBe('public')
    expect(first.project.historyIdentity.propTokens[id]).toMatch(/^ai-/)
    expect(first.project.document.props.target.appearance.opacity).toBe(.3)
    expect(first.project.document.props.target.rotationDeg).toBe(45)
    expect(first.project.document.revision).toBe(input.project.document.revision)
    expect(first.project.document.updatedAt).toBe(input.project.document.updatedAt)
    expect(replayAuthoring(cloneJson(input), cloneJson(first.state.steps))).toEqual(first)
    expect(checkAuthoringDraft(input, first.state)).toEqual({ valid: true, operationCost: 3, changedIds: first.state.changedIds, readIds: first.state.readIds, writeIds: first.state.writeIds })
    const second = applyAuthoringStep(input, first.state, [{ kind: 'transform', id, positionMm: { x: 6500, y: 6000 } }], 'step-two')
    expect(second.project.document.props[id].positionMm.x).toBe(6500)
    expect(input.project.document.props.target.appearance.opacity).toBe(1)
  })
  it('rejects a whole mixed step, arbitrary IDs, unknown operations, and ungranted delete', () => {
    const input = start(), initial = replayAuthoring(input, [])
    for (const bad of [[place, { kind: 'transform', id: 'ungranted', rotationDeg: 10 }], [{ kind: 'delete', id: 'target' }],
      [{ kind: 'opacity', id: 'target', value: .5, editLocked: false }]]) {
      expect(() => applyAuthoringStep(input, initial.state, bad as AuthoringOperation[], 'bad')).toThrow()
      expect(replayAuthoring(input, [])).toEqual(initial)
    }
    expect(() => applyAuthoringStep(input, initial.state, Array.from({ length: 17 }, () => place), 'too-many')).toThrow()
    input.scope.operations.push('delete')
    const deleted = applyAuthoringStep(input, initial.state, [{ kind: 'delete', id: 'target' }], 'delete')
    expect(deleted.project.document.props.target).toBeUndefined()
    expect(deleted.project.historyIdentity.propTokens.target).toBe(input.project.historyIdentity.propTokens.target)
  })
  it('never trusts remote hashes, cost, read/write sets, order or duplicate step IDs', () => {
    const input = start(), initial = replayAuthoring(input, [])
    const changed = applyAuthoringStep(input, initial.state, [place], 'one').state
    for (const fake of [{ ...changed, contentHash: initial.state.contentHash }, { ...changed, operationCost: 0 }, { ...changed, changedIds: [] },
      { ...changed, readIds: [] }, { ...changed, writeIds: [] }, { ...changed, draftRevision: 0 }]) {
      expect(() => checkAuthoringDraft(input, fake)).toThrow(/账本/)
    }
    expect(() => replayAuthoring(input, [{ ...changed.steps[0], index: 2 }])).toThrow(/连续/)
    expect(() => replayAuthoring(input, [...changed.steps, { ...changed.steps[0], index: 2 }])).toThrow(/唯一/)
  })
  it('counts repeated no-ops across steps and refuses 255 -> 257 atomically', () => {
    const input = start(), noop: AuthoringOperation = { kind: 'transform', id: 'target', rotationDeg: 0 }
    const steps: AuthoringStep[] = Array.from({ length: 16 }, (_, i) => ({ index: i + 1, stepId: `step-${i + 1}`, operations: Array.from({ length: i === 15 ? 15 : 16 }, () => noop) }))
    const state = replayAuthoring(input, steps).state
    expect(state.operationCost).toBe(255)
    expect(() => applyAuthoringStep(input, state, [noop, noop], 'overflow')).toThrow(/256/)
    expect(state.operationCost).toBe(255)
    expect(applyAuthoringStep(input, state, [noop], 'last').state.operationCost).toBe(256)
  }, 30_000)
  it('enforces true rotated image/footprint extents and keeps support/layer/physics fixed', () => {
    const input = start(), initial = replayAuthoring(input, [])
    expect(() => applyAuthoringStep(input, initial.state, [{ ...place, positionMm: { x: 1100, y: 1100 }, rotationDeg: 45 }], 'outside')).toThrow(/范围/)
    expect(() => applyAuthoringStep(input, initial.state, [{ kind: 'transform', id: 'target', positionMm: { x: 5, y: 5 }, rotationDeg: 45 }], 'outside-world')).toThrow()
    const edited = applyAuthoringStep(input, initial.state, [{ kind: 'transform', id: 'target', positionMm: { x: 3000, y: 4500 } }], 'good')
    const before = input.project.document.props.target, after = edited.project.document.props.target
    expect(after.footprintMm).toEqual(before.footprintMm); expect(after.supportRef).toEqual(before.supportRef)
    expect(edited.project.document.entityLayers).toEqual(input.project.document.entityLayers)
    expect(edited.project.document.propDefinitions).toEqual(input.project.document.propDefinitions)
    expect(edited.project.licenses).toEqual(input.project.licenses)
  })
  it('rejects unknown/private/locked targets and masked geometry before any public disclosure', () => {
    for (const mutate of [
      (p: ProjectData) => { p.document.props.target.visibility = 'gm' },
      (p: ProjectData) => { p.document.props.target.editLocked = true },
      (p: ProjectData) => { p.document.userLayers['layer-default-0'].editLocked = true },
    ]) {
      const project = fixture(); mutate(project); expect(() => validateAuthoringStart(start(project))).toThrow()
    }
    const unknown = start(); unknown.scope.targetIds.push('bad-id'); expect(() => validateAuthoringStart(unknown)).toThrow()
    const project = fixture(); project.document.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [{ x: 3000, y: 3000 }, { x: 5000, y: 3000 }, { x: 5000, y: 5000 }, { x: 3000, y: 5000 }], blocksMovement: false, movementCostMultiplier: 1 }
    project.document.entityLayers.mask = 'layer-default-0'
    expect(() => validateAuthoringStart(start(project))).toThrow(/遮罩/)
  })
  it('rejects anchored dependencies and prefab members even when individually public', () => {
    const noted = modify(fixture(), [{ type: 'createNote', id: 'private-note', floorId: 'blank-floor', layerId: 'layer-default-0',
      anchor: { type: 'entity', entityKind: 'prop', entityId: 'target' }, kind: 'clue', text: 'private clue not disclosed', visibility: 'gm' }])
    expect(() => validateAuthoringStart(start(noted))).toThrow(/注记/)
    const grouped = modify(fixture(), [{ type: 'createPrefab', id: 'group', definitionId: 'group-definition', name: 'public group', ids: ['target'], anchorMm: { x: 4000, y: 4000 } }])
    expect(grouped.document.props.target.visibility).toBe('public')
    expect(() => validateAuthoringStart(start(grouped))).toThrow(/组合/)
  })
  it('checks recursive public support and its layer/lock before transform, opacity or placement', () => {
    let project = modify(fixture(), [{ type: 'updateProp', id: 'target', changes: { positionMm: { x: 14000, y: 14000 } } },
    { type: 'createTerrainArea', id: 'support-area', floorId: 'blank-floor', layerId: 'layer-default-0',
      boundaryMm: [{ x: 500, y: 500 }, { x: 9500, y: 500 }, { x: 9500, y: 9500 }, { x: 500, y: 9500 }] },
    { type: 'createRoom', id: 'support-room', floorId: 'blank-floor', layerId: 'layer-default-0', thicknessMm: 100,
      boundaryMm: [{ x: 1500, y: 1500 }, { x: 8500, y: 1500 }, { x: 8500, y: 8500 }, { x: 1500, y: 8500 }],
      supportRef: { kind: 'terrainArea', id: 'support-area' } }])
    project.document.props.target.positionMm = { x: 4000, y: 4000 }
    project.document.props.target.supportRef = { kind: 'room', id: 'support-room' }; project.document.props.target.roomId = 'support-room'
    project = validateProjectData(project)
    const input = start(project); input.scope.placement!.supportRef = { kind: 'room', id: 'support-room' }
    const first = replayAuthoring(input, [])
    expect(first.state.readIds).toEqual(expect.arrayContaining(['support-area', 'support-room']))
    const result = applyAuthoringStep(input, first.state, [place], 'support')
    const newId = result.state.changedIds[0]
    expect(result.project.document.props[newId].supportRef).toEqual({ kind: 'room', id: 'support-room' })
    expect(result.project.document.props[newId].roomId).toBe('support-room')
    for (const mutation of [
      (p: ProjectData) => { p.document.terrainAreas['support-area'].editLocked = true },
      (p: ProjectData) => { p.document.terrainAreas['support-area'].visibility = 'gm' },
      (p: ProjectData) => { p.document.rooms['support-room'].editLocked = true },
      (p: ProjectData) => { p.document.vertices[p.document.rooms['support-room'].boundaryVertexIds[0]].editLocked = true },
      (p: ProjectData) => { Object.values(p.document.walls)[0].editLocked = true },
    ]) {
      const changed = cloneJson(project); mutation(changed)
      expect(() => validateAuthoringStart(start(changed))).toThrow()
    }
  })
  it('uses only authorised public context/assets and preserves existing layer opacity rules', () => {
    const project = fixture(), context: PreparationContext = { ids: { nextId: () => 'unused-id' }, clock: { now: () => stamp } }
    Object.assign(project, applyCompositionCommands({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId: 'layer-default-0' },
      adjustment: { id: 'layer-opacity', kind: 'opacity', enabled: true, value: .6 } }], context))
    project.document.props.target.appearance.opacity = .6
    const input = start(project), initial = replayAuthoring(input, [])
    const edited = applyAuthoringStep(input, initial.state, [{ kind: 'opacity', id: 'target', value: .2 }], 'opacity')
    expect(edited.project.appearance.layerAdjustments).toEqual(project.appearance.layerAdjustments)
    expect(edited.project.document.props.target.appearance.opacity).toBe(.2)
    const publicText = JSON.stringify(publicAuthoringContext(input, edited.state))
    expect(publicText).not.toContain('GM private'); expect(publicText).not.toContain('complete text'); expect(publicText).not.toContain('attribution')
    expect(findAuthoringAssets(input, '桌子', 10)).toEqual([expect.objectContaining({ id: 'definition', name: '公开桌子' })])
    const noPlacement = cloneJson(input); noPlacement.scope.placement = null; noPlacement.scope.operations = ['transform']
    expect(findAuthoringAssets(noPlacement, '', 10)).toEqual([])
    expect(() => findAuthoringAssets(input, '', 100)).toThrow()
    expect(authoringAssetPage(input, '', 1)).toMatchObject({ total: 1, nextOffset: null, assets: [{ id: 'definition' }] })
    expect(authoringAssetPage(input, '', 1, 1).assets).toEqual([])
    expect(() => authoringAssetPage(input, '', 1, -1)).toThrow()
    expect(authoringAssetPage(input, '', 1, 1024).assets).toEqual([])
    expect(() => authoringAssetPage(input, '', 1, 1025)).toThrow()
    expect(edited.state.readIds).toEqual(expect.arrayContaining(['target', 'blank-floor', 'layer-default-0', 'definition', 'MIT', 'layer-opacity']))
  })
  it('records ordering reads without disclosing unrelated private props or treating them as writes', () => {
    const project = modify(fixture(), [{ type: 'addProp', id: 'unselected-gm-object', floorId: 'blank-floor', layerId: 'layer-default-0',
      definitionRef: { id: 'definition', version: 1 }, positionMm: { x: 16000, y: 16000 }, supportRef: { kind: 'floor', id: 'blank-floor' } }])
    project.document.props['unselected-gm-object'].visibility = 'gm'; project.document.props['unselected-gm-object'].editLocked = true
    const input = start(project), initial = replayAuthoring(input, [])
    const changed = applyAuthoringStep(input, initial.state, [place], 'place')
    expect(changed.state.readIds).toContain('unselected-gm-object')
    expect(changed.state.writeIds).not.toContain('unselected-gm-object')
    expect(JSON.stringify(publicAuthoringContext(input, changed.state))).not.toContain('unselected-gm-object')
    expect(changed.project.document.props['unselected-gm-object']).toEqual(project.document.props['unselected-gm-object'])
  })
  it('continues scene-created furniture through granted prop tools within the original scene bounds', () => {
    const project = modify(fixture(), [{ type: 'deleteProp', id: 'target' }]), input = start(project)
    input.skill = { id: 'sceneweave-scene-authoring', version: 1 }
    input.scope = { targetIds: [], operations: ['transform', 'opacity', 'delete'], placement: null, scene: {
      floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm: { x: 1000, y: 1000, width: 8000, height: 8000 },
      entityIds: [], definitionIds: ['definition'], prefabDefinitionIds: [], materialIds: [], operations: ['room', 'furnish'],
    } }
    const built = applyAuthoringStep(input, replayAuthoring(input, []).state, [
      { kind: 'room', id: 'house', boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }], thicknessMm: 100 },
      { kind: 'furnish', id: 'table', definitionId: 'definition', positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'room', id: 'house' } },
      { kind: 'furnish', id: 'yard-table', definitionId: 'definition', positionMm: { x: 8000, y: 8000 }, supportRef: { kind: 'floor', id: 'blank-floor' } },
    ], 'build')
    const edited = applyAuthoringStep(input, built.state, [{ kind: 'transform', id: 'table', positionMm: { x: 4500, y: 4500 }, rotationDeg: 30 }, { kind: 'opacity', id: 'table', value: .4 }], 'adjust')
    expect(edited.project.document.props.table.positionMm).toEqual({ x: 4500, y: 4500 })
    expect(edited.project.document.props.table.appearance.opacity).toBe(.4)
    expect(edited.project.document.props.table.supportRef).toEqual({ kind: 'room', id: 'house' })
    expect(edited.project.document.props.table.footprintMm).toEqual(project.document.propDefinitions.definition.defaultFootprintMm)
    expect(edited.state.operationCost).toBe(13)
    expect(replayAuthoring(input, edited.state.steps)).toEqual(edited)
    expect(() => applyAuthoringStep(input, edited.state, [{ kind: 'transform', id: 'yard-table', positionMm: { x: 9200, y: 8000 } }], 'outside-scene')).toThrow(/新增授权范围/)
    expect(() => applyAuthoringStep(input, edited.state, [{ kind: 'place', definitionId: 'definition', positionMm: { x: 8000, y: 8000 } }], 'no-placement')).toThrow(/未获授权/)
    const deleted = applyAuthoringStep(input, edited.state, [{ kind: 'delete', id: 'yard-table' }], 'remove')
    expect(deleted.project.document.props['yard-table']).toBeUndefined()
    expect(built.project.document.props['yard-table']).toBeDefined()
  })
})
