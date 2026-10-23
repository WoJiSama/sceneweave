import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPropAppearanceSourceV6, bitmapVariantV6, createAppearanceGraphV6, resolveAppearanceV6 } from '../../core/v6/graph'
import { getCertifiedCompositionContentV6 } from '../../core/v6/schema'
import { validateCompleteProjectV6 } from '../../io/v6/project-file'
import { prepareCompositionCommandsV6 } from '../../io/v6/prepare'
import type { CompleteProjectV6, NamedSnapshotV6 } from '../../io/v6/types'
import { pixelPng } from '../../io/v3/test-fixtures'
import { outdoorProject } from '../../io/v6/test-fixtures'
import { WorkspaceV6 } from './workspace'
import { buildingProjectV6, deferred, projectV6, snapshotV6, workspaceSetupV6 } from './workspace-test-fixtures'

// Real V6 graph/identity/commands/restore; durability and bitmap decoding have their own IO/browser suites.
vi.mock('../../io/v6/project-file', async importOriginal => {
  const actual = await importOriginal<typeof import('../../io/v6/project-file')>()
  const validate = vi.fn(async (_input: CompleteProjectV6) => {})
  return { ...actual, validateCompleteProjectV6: validate,
    captureValidatedProjectV6: vi.fn(async (input: CompleteProjectV6) => { await validate(input); return actual.captureCompleteProjectV6(input) }) }
})
vi.mock('../../io/v6/prepare', async () => {
  const { applyCompositionCommandsV6 } = await import('../../core/v6/commands')
  const { resolveAppearanceV6 } = await import('../../core/v6/graph')
  const materialize = async (project: CompleteProjectV6) => ({ ...project, ...resolveAppearanceV6({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }) })
  return {
    materializeProjectV6: vi.fn(materialize),
    prepareCompositionCommandsV6: vi.fn(async (project, commands) => materialize({ ...project, ...applyCompositionCommandsV6({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, commands) })),
  }
})
const validate = vi.mocked(validateCompleteProjectV6), prepare = vi.mocked(prepareCompositionCommandsV6)
beforeEach(() => { vi.useFakeTimers(); validate.mockReset().mockResolvedValue(); prepare.mockClear() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Valid catalog shape with explicit IO custody doubles; no active scene target changes. */
function catalogCandidate(input: CompleteProjectV6): CompleteProjectV6 {
  const candidate = structuredClone(input), hash = 'c'.repeat(64), licenseHash = 'd'.repeat(64)
  const origin = { kind: 'imported' as const, attribution: 'Workspace catalog custody test', canEmbed: true }
  candidate.document.assets.catalogImage = { id: 'catalogImage', sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1,
    logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'test-catalog', origin }
  candidate.document.materials.catalogMaterial = { id: 'catalogMaterial', catalogId: 'test.catalog', version: 1, licenseRef: 'test-catalog', origin,
    name: 'Imported catalog material', tags: [], textureAssetId: 'catalogImage', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
  candidate.assets[hash] = { sha256: hash, blob: new Blob(['IO-validated resource custody double']), mimeType: 'image/png', sizeBytes: 35, pixelWidth: 1, pixelHeight: 1 }
  candidate.licenses[licenseHash] = { sha256: licenseHash, text: 'License custody double' }
  candidate.licenseBindings.push(...(['asset', 'material'] as const).map(subjectKind => ({ subjectKind,
    subjectId: subjectKind === 'asset' ? 'catalogImage' : 'catalogMaterial', licenseRef: 'test-catalog', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })))
  return candidate
}

describe('V6 full candidate workspace', () => {
  it('flushes for passive Home without replacing the branch, undo or session structure witness', async () => {
    const { workspace, input, durable } = workspaceSetupV6(buildingProjectV6())
    await workspace.openPersisted(input)
    const named = await workspace.createNamedSnapshot('离开前结构')
    await workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: '继续编辑的房间' } }])
    const current = workspace.getState().project, checkpoint = workspace.checkpoint()
    await workspace.flush()
    expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(workspace.getState().canUndo).toBe(true)
    expect(durable().document.rooms.room.purpose).toBe('继续编辑的房间')
    expect((await workspace.inspectStructureRestore(named.id, { ids: ['room'], mode: 'properties' })).scope.rootIds).toEqual(['room'])
    workspace.undo()
    expect(workspace.getState().project!.document.rooms.room.purpose).toBe('original room')
    await workspace.flush()
  })

  it('closes only after the complete save and invalidates undo, pending previews and C2 witnesses', async () => {
    const { workspace, input, durable } = workspaceSetupV6(buildingProjectV6())
    await workspace.openPersisted(input)
    const named = await workspace.createNamedSnapshot('真正离开前')
    await workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: '已保存的房间' } }])
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } }])
    const checkpoint = workspace.checkpoint()
    await workspace.close()
    expect(durable().document.rooms.room.purpose).toBe('已保存的房间')
    expect(workspace.getState()).toEqual({ project: null, status: 'empty', error: null, canUndo: false, canRedo: false, lastTransaction: null })
    expect(workspace.checkpoint()).toBeGreaterThan(checkpoint)
    await expect(workspace.adoptPreview(preview)).rejects.toThrow(/已有修改/)
    workspace.undo(); workspace.redo()
    expect(workspace.getState().project).toBeNull()
    await workspace.openPersisted(durable())
    await expect(workspace.inspectStructureRestore(named.id, { ids: ['room'], mode: 'properties' })).rejects.toThrow(/本会话.*连续性/)
  })

  it.each(['error', 'conflict'] as const)('retains the complete branch, undo and witness when close meets a save %s', async failure => {
    const { workspace, input, api, durable } = workspaceSetupV6(buildingProjectV6())
    await workspace.openPersisted(input)
    const named = await workspace.createNamedSnapshot('失败时保留')
    await workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: '内存分支' } }])
    const current = workspace.getState().project, checkpoint = workspace.checkpoint(), persisted = durable()
    const error = new Error('离开前保存被拒绝'); error.name = failure === 'conflict' ? 'ConflictErrorV6' : 'QuotaExceededError'
    api.save.mockRejectedValueOnce(error)
    await expect(workspace.close()).rejects.toThrow(/保存被拒绝/)
    expect(workspace.getState()).toMatchObject({ project: current, status: failure, canUndo: true })
    expect(workspace.getState().project).toBe(current)
    expect(workspace.checkpoint()).toBe(checkpoint)
    expect(durable()).toEqual(persisted)
    expect((await workspace.inspectStructureRestore(named.id, { ids: ['room'], mode: 'properties' })).scope.rootIds).toEqual(['room'])
    await workspace.retry()
    await workspace.close()
    expect(workspace.getState().project).toBeNull()
  })

  it('refuses close if a newer edit arrives during the save and preserves that branch', async () => {
    const { workspace, input, api } = workspaceSetupV6()
    await workspace.openPersisted(input)
    await workspace.updateProp('item', { rotationDeg: 15 })
    const saved = deferred<void>()
    api.save.mockReturnValueOnce(saved.promise)
    const closing = workspace.close()
    await workspace.updateProp('item', { rotationDeg: 30 })
    // This race uses held save completions; real repository CAS is covered by
    // the persistence suite, while this assertion concerns session ownership.
    api.save.mockResolvedValueOnce()
    saved.resolve()
    await expect(closing).rejects.toThrow(/已有修改/)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 2, props: { item: { rotationDeg: 30 } } })
    expect(workspace.getState().canUndo).toBe(true)
  })

  it('rejects delayed preparation after close without installing or writing its candidate', async () => {
    const { workspace, input, api } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const original = prepare.getMockImplementation()!, candidate = await original(workspace.getState().project!, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }])
    const late = deferred<CompleteProjectV6>()
    prepare.mockReturnValueOnce(late.promise)
    const operation = workspace.updateProp('item', { rotationDeg: 15 })
    await workspace.close()
    late.resolve(candidate)
    await expect(operation).rejects.toThrow(/已有修改/)
    expect(workspace.getState().project).toBeNull()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('previews and saves display preferences as one undoable revision without rescaling locked entities', async () => {
    const { workspace, input, durable } = workspaceSetupV6()
    input.document.props.item.editLocked = true
    await workspace.openPersisted(input)
    const initial = workspace.getState().project!, physical = structuredClone(initial.document.props)
    const commands = [{ type: 'setSceneDisplay' as const, display: 'ft' as const, distanceMode: 'grid' as const, gridSizeMm: 1524, snapMm: 254, gridVisible: true }]
    const cancelled = await workspace.preview(commands)
    workspace.cancelPreview(cancelled)
    expect(workspace.getState().project).toBe(initial)
    const preview = await workspace.preview(commands)
    expect(workspace.getState().project).toBe(initial)
    await workspace.adoptPreview(preview)
    expect(workspace.getState().project!.document).toMatchObject({ revision: initial.document.revision + 1, units: { display: 'ft', gridSizeMm: 1524 } })
    expect(workspace.getState().project!.document.props).toEqual(physical)
    await workspace.flush()
    expect(durable().document.units.display).toBe('ft')
    workspace.undo()
    expect(workspace.getState().project!.document.units).toEqual(initial.document.units)
    expect(workspace.getState().project!.document.revision).toBe(initial.document.revision + 2)
    workspace.redo()
    expect(workspace.getState().project!.document.revision).toBe(initial.document.revision + 3)
    expect(workspace.getState().project!.document.props).toEqual(physical)
    await workspace.flush()
  })

  it('captures immediate commands and commits once only after both preparation validations finish', async () => {
    const actual = await vi.importActual<typeof import('../../io/v6/prepare')>('../../io/v6/prepare')
    const { workspace, input, durable } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const before = workspace.getState(), installed = before.project!
    expect(getCertifiedCompositionContentV6({ document: installed.document, historyIdentity: installed.historyIdentity, appearance: installed.appearance })).toBeDefined()
    validate.mockClear()
    const gate = deferred()
    validate.mockReturnValueOnce(gate.promise)
    prepare.mockImplementationOnce(actual.prepareCompositionCommandsV6)
    const commands = [{ type: 'updateProp' as const, id: 'item', changes: { rotationDeg: 15 } }]
    const executing = workspace.execute(commands)
    expect(validate).toHaveBeenCalledTimes(1)
    expect(workspace.getState()).toBe(before)
    commands[0].changes.rotationDeg = 75
    gate.resolve()
    await executing
    // IO is doubled here; this verifies that the real prepare pipeline owns both
    // input/candidate boundaries without registering a separate UI preview.
    expect(validate).toHaveBeenCalledTimes(2)
    const adopted = workspace.getState().project!
    expect(adopted.document).toMatchObject({ revision: 1, props: { item: { rotationDeg: 15 } } })
    expect(getCertifiedCompositionContentV6({ document: adopted.document, historyIdentity: adopted.historyIdentity, appearance: adopted.appearance })).toBeDefined()
    expect(Object.isFrozen(adopted.document.props.item)).toBe(true)
    workspace.undo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 2, props: { item: { rotationDeg: 0 } } })
    expect(workspace.getState().canUndo).toBe(false)
    await workspace.flush()
    expect(durable().document.revision).toBe(2)
  })

  it('retains the current state and undo when immediate candidate validation rejects', async () => {
    const actual = await vi.importActual<typeof import('../../io/v6/prepare')>('../../io/v6/prepare')
    const { workspace, input, api } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const before = workspace.getState()
    validate.mockClear().mockResolvedValueOnce().mockRejectedValueOnce(new Error('候选位图校验失败'))
    prepare.mockImplementationOnce(actual.prepareCompositionCommandsV6)
    await expect(workspace.updateProp('item', { rotationDeg: 15 })).rejects.toThrow(/候选位图校验失败/)
    expect(validate).toHaveBeenCalledTimes(2)
    expect(workspace.getState()).toBe(before)
    expect(workspace.getState().canUndo).toBe(false)
    expect(api.save).not.toHaveBeenCalled()
  })

  it('rejects a late immediate command without overwriting the newer edit or adding undo', async () => {
    const { workspace, input } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const original = prepare.getMockImplementation()!, gate = deferred<CompleteProjectV6>()
    const candidate = await original(workspace.getState().project!, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }])
    prepare.mockReturnValueOnce(gate.promise)
    const late = workspace.updateProp('item', { rotationDeg: 15 })
    await workspace.updateProp('item', { rotationDeg: 75 })
    gate.resolve(candidate)
    await expect(late).rejects.toThrow(/已有修改/)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 1, props: { item: { rotationDeg: 75 } } })
    workspace.undo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 2, props: { item: { rotationDeg: 0 } } })
    expect(workspace.getState().canUndo).toBe(false)
    await workspace.flush()
  })

  it('rechecks the checkpoint when commit validation synchronously changes the current branch', async () => {
    const { input, api } = workspaceSetupV6()
    let reenter = false, candidateChecks = 0
    const workspace = new WorkspaceV6(api, () => {
      if (reenter && ++candidateChecks === 2) {
        reenter = false
        workspace.undo()
      }
    })
    await workspace.openPersisted(input)
    await workspace.updateProp('item', { rotationDeg: 45 })
    reenter = true
    await expect(workspace.updateProp('item', { rotationDeg: 60 })).rejects.toThrow(/已有修改/)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 2, props: { item: { rotationDeg: 0 } } })
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: true })
    workspace.redo()
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, props: { item: { rotationDeg: 45 } } })
    await workspace.flush()
  })

  it('timestamps only completed transactions before notifying subscribers and never persists the session timing', async () => {
    const { workspace, input, api, durable } = workspaceSetupV6()
    await workspace.openPersisted(input)
    expect(workspace.getState().lastTransaction).toBeNull()
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }])
    expect(workspace.getState().lastTransaction).toBeNull()
    const gate = deferred<void>()
    validate.mockImplementationOnce(() => gate.promise)
    const adopting = workspace.adoptPreview(preview)
    expect(workspace.getState().project!.document.revision).toBe(0)
    expect(workspace.getState().lastTransaction).toBeNull()
    const observed: number[] = []
    const unsubscribe = workspace.subscribe(() => {
      const transaction = workspace.getState().lastTransaction
      if (transaction) observed.push(transaction.committedAtMs)
    })
    const clock = vi.spyOn(performance, 'now').mockReturnValue(123)
    gate.resolve()
    await adopting
    expect(workspace.getState().lastTransaction).toEqual({ sceneId: input.document.sceneId, revision: 1, committedAtMs: 123 })
    expect(observed).toEqual([123])
    await workspace.flush()
    expect(workspace.getState().lastTransaction?.committedAtMs).toBe(123)
    expect(durable()).not.toHaveProperty('lastTransaction')
    expect(api.save.mock.calls[0][0]).not.toHaveProperty('lastTransaction')
    clock.mockReturnValue(170)
    workspace.undo()
    expect(workspace.getState().lastTransaction).toMatchObject({ revision: 2, committedAtMs: 170 })
    clock.mockReturnValue(190)
    workspace.redo()
    expect(workspace.getState().lastTransaction).toMatchObject({ revision: 3, committedAtMs: 190 })
    await workspace.flush()
    await workspace.openPersisted(durable())
    expect(workspace.getState().lastTransaction).toBeNull()
    unsubscribe()
  })

  it('commits an outdoor topology round trip as one revision and keeps the invalidated marker through undo', async () => {
    const input = await outdoorProject(), { workspace, durable } = workspaceSetupV6(input)
    await workspace.openPersisted(input)
    const area = input.document.terrainAreas.domain, originalSegment = area.boundaryMm[0].segmentId
    const changed = structuredClone(area.boundaryMm)
    ;[changed[0].segmentId, changed[1].segmentId] = [changed[1].segmentId, changed[0].segmentId]

    await workspace.execute([
      { type: 'updateTerrainArea', id: area.id, changes: { boundaryMm: changed } },
      { type: 'updateTerrainArea', id: area.id, changes: { boundaryMm: area.boundaryMm } },
    ])
    const adopted = workspace.getState().project!
    expect(adopted.document.revision).toBe(1)
    expect(adopted.document.terrainAreas.domain.boundaryMm[0].segmentId).toBe(originalSegment)
    expect(adopted.historyIdentity.outdoorTokens.domain.topologyToken).not.toBe(input.historyIdentity.outdoorTokens.domain.topologyToken)
    workspace.undo()
    expect(workspace.getState().project!.document.revision).toBe(2)
    expect(workspace.getState().project!.historyIdentity.outdoorTokens.domain.topologyToken).not.toBe(input.historyIdentity.outdoorTokens.domain.topologyToken)
    await workspace.flush()
    expect(durable().document.revision).toBe(2)
  })

  it('reports the actual materialized scatter member when restoring a source under a current layer rule', async () => {
    const input = await outdoorProject(1), { workspace } = workspaceSetupV6(input)
    await workspace.openPersisted(input)
    const layerId = input.document.entityLayers.scatter
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId },
      adjustment: { id: 'today-opacity', kind: 'opacity', enabled: true, value: .25 } }])
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['scatter-item-0'] },
      adjustment: { id: 'today-opacity', kind: 'opacity', enabled: true, value: .8 } }])

    const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['scatter-item-0'], mode: 'source' })
    const change = preview.plan.changes.find(value => value.id === 'scatter-item-0')
    expect(change).toBeDefined()
    expect((change!.after as { entity: unknown }).entity).toEqual(preview.project.document.props['scatter-item-0'])
    expect(preview.project.document.props['scatter-item-0'].appearance.opacity).toBe(.25)
    await workspace.flush()
  })

  it('keeps fixed bitmap bytes and source roots through set, disable, undo, remove, save and reopen', async () => {
    const input = projectV6(), document = input.document, prop = document.props.item
    const origin = { kind: 'original' as const, attribution: 'Workspace source custody test', canEmbed: true }, sourceHash = 'a'.repeat(64), derivedHash = 'b'.repeat(64)
    document.assets.image = { id: 'image', sha256: sourceHash, mimeType: 'image/png', pixelWidth: 8, pixelHeight: 8, logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'MIT', origin }
    document.propDefinitions.photo = { id: 'photo', catalogId: 'test.photo', version: 1, licenseRef: 'MIT', origin, name: 'Photo', tags: [], defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 },
      defaultVisualBoundsMm: prop.visualBoundsMm, defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    prop.definitionRef = { id: 'photo', version: 1 }; prop.appearance = structuredClone(document.propDefinitions.photo.defaultAppearance)
    input.appearance = createAppearanceGraphV6(document)
    const variant = bitmapVariantV6('image', '#AABBCC', 1)!
    document.assets[variant.outputAssetId] = { ...document.assets.image, id: variant.outputAssetId, sha256: derivedHash }
    input.appearance.variants[variant.id] = variant
    input.appearance.instanceAdjustments.item = [{ id: 'tint', kind: 'tint', value: '#AABBCC', enabled: true }]
    Object.assign(input, resolveAppearanceV6(input))
    delete input.appearance.instanceAdjustments.item
    Object.assign(input, resolveAppearanceV6(input))
    for (const [hash, value] of [[sourceHash, 'source'], [derivedHash, 'derived']] as const) input.assets[hash] = { sha256: hash, blob: new Blob([value]), mimeType: 'image/png', sizeBytes: value.length, pixelWidth: 8, pixelHeight: 8 }
    const { workspace, durable } = workspaceSetupV6(input)
    await workspace.openPersisted(input)
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'tint', kind: 'tint', value: '#AABBCC', enabled: true } }])
    expect(workspace.getState().project!.document.props.item.appearance).toMatchObject({ assetId: variant.outputAssetId })
    await workspace.execute([{ type: 'toggleAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustmentId: 'tint', enabled: false }])
    expect(workspace.getState().project!.document.props.item.appearance).toMatchObject({ assetId: 'image' })
    workspace.undo(); expect(workspace.getState().project!.document.props.item.appearance).toMatchObject({ assetId: variant.outputAssetId })
    workspace.redo()
    await workspace.execute([{ type: 'removeAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustmentId: 'tint' }])
    await workspace.flush(); await workspace.openPersisted(durable())
    expect(workspace.getState().project!.document.revision).toBe(5)
    expect(workspace.getState().project!.appearance.variants[variant.id]).toEqual(variant)
    expect(workspace.getState().project!.appearance.propSources.item).toBe(input.appearance.propSources.item)
    expect(await workspace.getState().project!.assets[derivedHash].blob.text()).toBe('derived')
    expect(await workspace.getState().project!.assets[sourceHash].blob.text()).toBe('source')
  })

  it('previews without mutating, then atomically adopts a complete source/layer state and preserves it through undo/redo', async () => {
    const { workspace, input, api, durable } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const layerId = input.document.entityLayers.item, before = workspace.getState()
    const preview = await workspace.preview([{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'opacity-rule', kind: 'opacity', value: .4, enabled: true } }])
    expect(workspace.getState()).toBe(before)
    expect(preview.document.props.item.appearance.opacity).toBe(.4)
    expect(Object.isFrozen(preview.project.appearance.layerAdjustments)).toBe(true)
    await workspace.adoptPreview(preview)
    expect(workspace.getState().project).toMatchObject({ document: { revision: 1 }, appearance: { layerAdjustments: { [layerId]: [{ id: 'opacity-rule' }] } } })
    await expect(workspace.adoptPreview(preview)).rejects.toThrow(/重复/)
    workspace.undo()
    expect(workspace.getState().project).toMatchObject({ document: { revision: 2 }, appearance: input.appearance, historyIdentity: input.historyIdentity })
    workspace.redo()
    expect(workspace.getState().project!.document.revision).toBe(3)
    expect(workspace.getState().project!.appearance.layerAdjustments[layerId][0].value).toBe(.4)
    await workspace.flush()
    expect(durable()).toEqual(workspace.getState().project)
    expect(api.save.mock.calls.map(([value, revision]) => [value.document.revision, revision])).toEqual([[3, 0]])
  })

  it('rejects cancelled, forged, stale and late command candidates without consuming history', async () => {
    const { workspace, input } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const cancelled = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }])
    workspace.cancelPreview(cancelled)
    await expect(workspace.adoptPreview(cancelled)).rejects.toThrow(/重复/)
    await expect(workspace.adoptPreview(structuredClone(cancelled))).rejects.toThrow(/重复/)
    const stale = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }])
    await workspace.updateProp('item', { rotationDeg: 45 })
    await expect(workspace.adoptPreview(stale)).rejects.toThrow(/已有修改/)
    const gate = deferred<CompleteProjectV6>(), original = prepare.getMockImplementation()!
    const lateCandidate = await original(workspace.getState().project!, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 60 } }])
    prepare.mockReturnValueOnce(gate.promise)
    const late = workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 60 } }])
    await workspace.updateProp('item', { rotationDeg: 75 })
    gate.resolve(lateCandidate)
    await expect(late).rejects.toThrow(/已有修改/)
    expect(workspace.getState().project!.document.props.item.rotationDeg).toBe(75)
    expect(workspace.getState().project!.document.revision).toBe(2)
    await workspace.flush()
  })

  it('adopts prepared import candidates with their original checkpoint, full bytes and provenance; a late import cannot install', async () => {
    const { workspace, input } = workspaceSetupV6()
    input.migrationSource = { sourceSchemaVersion: 5, sourceSceneId: 'old', sourceRevision: 7, sourceHash: 'b'.repeat(64),
      migratorVersion: 'test-only-envelope', migratedAt: '2026-10-22T00:00:00.000Z', original: new Blob(['exact source custody']) }
    await workspace.openPersisted(input)
    const checkpoint = workspace.checkpoint(), candidate = catalogCandidate(workspace.getState().project!)
    const preview = await workspace.previewPrepared(candidate, '素材导入', checkpoint)
    await workspace.adoptPreview(preview)
    expect(await workspace.getState().project!.assets['c'.repeat(64)].blob.text()).toBe('IO-validated resource custody double')
    expect(workspace.getState().project!.migrationSource).toEqual(input.migrationSource)
    workspace.undo(); expect(workspace.getState().project!.assets).toEqual(input.assets)
    workspace.redo(); expect(workspace.getState().project!.assets['c'.repeat(64)]).toBeDefined()
    await expect(workspace.previewPrepared(candidate, '迟到导入', checkpoint)).rejects.toThrow(/已有修改/)
    const dropped = structuredClone(workspace.getState().project!); delete dropped.historyIdentity.propTokens.item
    await expect(workspace.previewPrepared(dropped)).rejects.toThrow(/已分配身份/)
    await workspace.flush()
  })

  it('rejects generic prepared edits to locked objects, privacy, layers, mappings and immutable resource records', async () => {
    const input = catalogCandidate(projectV6()); input.document.props.item.editLocked = true
    const { workspace, api } = workspaceSetupV6(input)
    await workspace.openPersisted(input)
    const before = workspace.getState(), sourceId = input.appearance.propSources.item, layerId = input.document.entityLayers.item
    const changes: ((candidate: CompleteProjectV6) => void)[] = [
      candidate => { candidate.document.props.item.positionMm.x += 100 },
      candidate => { candidate.document.props.item.visibility = 'gm' },
      candidate => { candidate.document.userLayers[layerId].editLocked = true },
      candidate => { candidate.document.title = 'Generic overwrite' },
      candidate => { candidate.historyIdentity.propTokens.unallocated = 'unexpected-token' },
      candidate => { candidate.appearance.propSources.item = 'replacement-source' },
      candidate => { candidate.appearance.instanceAdjustments.item = [{ id: 'bypass', kind: 'opacity', value: .5, enabled: true }] },
      candidate => { candidate.appearance.layerAdjustments[layerId] = [{ id: 'bypass', kind: 'opacity', value: .5, enabled: true }] },
      candidate => { const source = candidate.appearance.sources[sourceId]; if (source.kind === 'prop') source.snapshot.appearance.opacity = .25 },
      candidate => { delete candidate.appearance.sources[sourceId] },
      candidate => { candidate.document.materials.catalogMaterial.name = 'Replaced fixed catalog item' },
      candidate => { delete candidate.document.assets.catalogImage },
      candidate => { delete candidate.assets['c'.repeat(64)] },
      candidate => { delete candidate.licenses['d'.repeat(64)] },
      candidate => { candidate.licenseBindings.pop() },
    ]
    for (const mutate of changes) {
      const candidate = structuredClone(input); mutate(candidate)
      await expect(workspace.previewPrepared(candidate)).rejects.toThrow(/素材入库/)
      expect(workspace.getState()).toBe(before)
    }
    expect(api.save).not.toHaveBeenCalled()
    expect(workspace.getState()).toMatchObject({ canUndo: false, canRedo: false, project: { document: { revision: 0 } } })
  })

  it('accepts the real asset-import pipeline and fully validates bytes before registering or adopting it', async () => {
    // Only the native image decoder/canvas are doubled; actual IO normalizes PNG bytes,
    // hashes resources/licenses and validates the complete candidate at both boundaries.
    const actualIO = await vi.importActual<typeof import('../../io/v6/project-file')>('../../io/v6/project-file')
    const actualPrepare = await vi.importActual<typeof import('../../io/v6/prepare')>('../../io/v6/prepare')
    validate.mockImplementation(actualIO.validateCompleteProjectV6)
    const png = pixelPng(), drawImage = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })))
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob([png.slice().buffer], { type: 'image/png' })) })) })
    const input = projectV6(); input.document.props.item.editLocked = true
    const { workspace, durable } = workspaceSetupV6(input)
    await workspace.openPersisted(input)
    const checkpoint = workspace.checkpoint(), candidate = await actualPrepare.prepareAssetImportV6(input, {
      file: new Blob([png.slice().buffer], { type: 'image/png' }), kind: 'prop', name: 'Imported original pixel', widthMm: 1000, heightMm: 1000,
      footprintWidthMm: 500, footprintHeightMm: 500, licenseText: 'CC0-1.0. Original test artwork.', attribution: 'Sceneweave tests', canEmbed: true,
    })
    const preview = await workspace.previewPrepared(candidate, '素材导入', checkpoint)
    expect(workspace.getState().project).toEqual(input)
    expect(preview.project.document.props).toEqual(input.document.props)
    expect(preview.project.historyIdentity).toEqual(input.historyIdentity)
    expect(preview.project.appearance.propSources).toEqual(input.appearance.propSources)
    await workspace.adoptPreview(preview); await workspace.flush()
    expect(durable().document.revision).toBe(1)
    expect(Object.values(durable().document.propDefinitions).map(value => value.name)).toContain('Imported original pixel')
    expect(drawImage).toHaveBeenCalledTimes(1)
    const before = workspace.getState(), corrupt = structuredClone(before.project!), resource = Object.values(corrupt.assets)[0]
    const bytes = new Uint8Array(await resource.blob.arrayBuffer()); bytes[bytes.length - 1] ^= 1
    resource.blob = new Blob([bytes.buffer], { type: 'image/png' })
    await expect(workspace.previewPrepared(corrupt)).rejects.toThrow(/CRC/)
    expect(workspace.getState()).toBe(before)
    await actualIO.validateCompleteProjectV6(durable())
  })

  it('rechecks cancellation after adoption validation and rejects no-op/revision-overflow without side effects', async () => {
    const { workspace, input } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }])
    const gate = deferred(); validate.mockReturnValueOnce(gate.promise)
    const adopting = workspace.adoptPreview(preview)
    workspace.cancelPreview(preview); gate.resolve()
    await expect(adopting).rejects.toThrow(/取消/)
    expect(workspace.getState().canUndo).toBe(false)
    await workspace.execute([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 0 } }])
    expect(workspace.getState().project!.document.revision).toBe(0)
    const max = projectV6(); max.document.revision = Number.MAX_SAFE_INTEGER
    const overflow = new WorkspaceV6(workspaceSetupV6(max).api)
    await overflow.openPersisted(max)
    await expect(overflow.updateProp('item', { rotationDeg: 40 })).rejects.toThrow(/安全整数/)
    expect(overflow.getState().canUndo).toBe(false)
  })
})

describe('V6 protected selective restore', () => {
  it('restores a frozen C source after undo removed ancestor B, retaining exact ancestor bytes and licenses', async () => {
    const input = projectV6(), prop = input.document.props.item
    const origin = { kind: 'original' as const, attribution: 'Cross-branch source custody test', canEmbed: true }, licenseHash = 'd'.repeat(64)
    const a = input.document.assets.a = { id: 'a', sha256: 'a'.repeat(64), mimeType: 'image/png' as const, pixelWidth: 8, pixelHeight: 8,
      logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'MIT', origin }
    const definition = input.document.propDefinitions.photo = { id: 'photo', catalogId: 'test.photo', version: 1, licenseRef: 'MIT', origin, name: 'Photo', tags: [],
      defaultAppearance: { kind: 'image' as const, assetId: a.id, tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
      defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
      defaultRenderLayer: 'object' as const, defaultShadowClass: 'none' as const }
    prop.definitionRef = { id: definition.id, version: 1 }; prop.appearance = structuredClone(definition.defaultAppearance)
    input.appearance = createAppearanceGraphV6(input.document)
    input.licenses[licenseHash] = { sha256: licenseHash, text: 'Exact retained license text' }
    input.assets[a.sha256] = { sha256: a.sha256, blob: new Blob(['source-a']), mimeType: 'image/png', sizeBytes: 8, pixelWidth: 8, pixelHeight: 8 }
    input.licenseBindings = [{ subjectKind: 'asset', subjectId: 'a', licenseRef: 'MIT', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' },
      { subjectKind: 'propDefinition', subjectId: definition.id, licenseRef: 'MIT', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' }]
    const historic = structuredClone(input)
    for (const id of ['b', 'c'] as const) {
      const asset = historic.document.assets[id] = { ...a, id, sha256: id.repeat(64) }
      // These valid fixed catalog roots deliberately differ from the restore helper's carriers.
      historic.document.propDefinitions[`branch-root-${id}`] = { ...definition, id: `branch-root-${id}`, catalogId: `test.${id}`,
        defaultAppearance: { ...definition.defaultAppearance, assetId: id } }
      const snapshot = { ...historic.document.props.item, appearance: { ...definition.defaultAppearance, assetId: id } }
      historic.appearance.propSources.item = addPropAppearanceSourceV6(historic.appearance, snapshot, historic.appearance.propSources.item)
      historic.assets[asset.sha256] = { sha256: asset.sha256, blob: new Blob([`source-${id}`]), mimeType: 'image/png', sizeBytes: 8, pixelWidth: 8, pixelHeight: 8 }
      for (const [subjectKind, subjectId] of [['asset', id], ['propDefinition', `branch-root-${id}`]] as const) {
        historic.licenseBindings.push({ subjectKind, subjectId, licenseRef: 'MIT', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })
      }
    }
    Object.assign(historic, resolveAppearanceV6(historic))
    const { workspace, durable } = workspaceSetupV6(input)
    await workspace.openPersisted(input)
    // This fixture stands in for command preparation's complete imported source custody;
    // the public catalog-only prepared entry must never install changed instance mappings.
    prepare.mockResolvedValueOnce(historic)
    await workspace.execute([{ type: 'setAppearanceSource', ids: ['item'], sourceId: historic.appearance.propSources.item }])
    const snapshot = await workspace.createNamedSnapshot('保留 B 祖先的 C')
    workspace.undo()
    expect(Object.keys(workspace.getState().project!.document.assets)).toEqual(['a'])
    await workspace.updateProp('item', { rotationDeg: 55 })
    const preview = await workspace.prepareRestore(snapshot.id, { ids: ['item'], mode: 'appearance' })
    expect(preview.project.document.props.item.appearance).toMatchObject({ assetId: 'c' })
    expect(preview.project.document.props.item.rotationDeg).toBe(55)
    const roots = Object.values(preview.project.document.propDefinitions).filter(value => value.tags.includes('sceneweave:retained-appearance'))
    expect(roots.map(value => value.defaultAppearance.kind === 'image' && value.defaultAppearance.assetId).sort()).toEqual(['b', 'c'])
    for (const root of roots) expect(preview.project.licenseBindings).toContainEqual({ subjectKind: 'propDefinition', subjectId: root.id,
      licenseRef: 'MIT', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })
    expect(preview.project.document.propDefinitions['branch-root-b']).toBeUndefined()
    expect(preview.project.appearance.sources[historic.appearance.propSources.item]).toEqual(historic.appearance.sources[historic.appearance.propSources.item])
    const protection = await workspace.applyRestore(preview)
    expect(Object.keys(protection.project.document.assets)).toEqual(['a'])
    await workspace.flush()
    for (const id of ['a', 'b', 'c']) expect(await durable().assets[id.repeat(64)].blob.text()).toBe(`source-${id}`)
    expect(durable().licenses).toEqual(input.licenses)
    expect(durable().document.revision).toBe(4)
    workspace.undo()
    expect(workspace.getState().project!.document.props.item).toMatchObject({ rotationDeg: 55, appearance: { assetId: 'a' } })
    expect(Object.keys(workspace.getState().project!.document.assets)).toEqual(['a'])
  })

  it('flushes the exact current branch, protects it, restores only selected properties, and keeps monotonic undo', async () => {
    const { workspace, input, api, durable } = workspaceSetupV6()
    await workspace.openPersisted(input)
    await workspace.updateProp('item', { rotationDeg: 45 })
    await workspace.execute([{ type: 'copyProp', id: 'item', newId: 'later', offsetMm: { x: 1200, y: 0 } }])
    const later = workspace.getState().project!.document.props.later, graph = workspace.getState().project!.appearance
    const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
    const protection = await workspace.applyRestore(preview)
    expect(protection.project.document.revision).toBe(2)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, props: { item: { rotationDeg: 0 }, later } })
    expect(workspace.getState().project!.appearance).toEqual(graph)
    expect(api.createNamedSnapshot.mock.calls[0][2]).toMatchObject({ expectedRevision: 2, expectedMetadataVersion: 0, sourceSnapshot: { id: 'saved-snapshot', contentHash: 'a'.repeat(64) } })
    workspace.undo(); expect(workspace.getState().project!.document).toMatchObject({ revision: 4, props: { item: { rotationDeg: 45 } } })
    workspace.redo(); await workspace.flush()
    expect(durable().document.revision).toBe(5)
  })

  it('preserves V6 effective appearance and current layer metadata through a selected restore', async () => {
    const { workspace, input } = workspaceSetupV6(), layerId = input.document.entityLayers.item
    await workspace.openPersisted(input)
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'today', kind: 'opacity', value: .25, enabled: true } }])
    const sourcePreview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'source' })
    expect(sourcePreview.project.document.props.item.appearance.opacity).toBe(.25)
    expect(sourcePreview.plan.changed).toBe(false)
    expect(sourcePreview.plan.changes).toEqual([])
    const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'appearance' })
    expect(preview.project.document.props.item.appearance.opacity).toBe(1)
    expect(preview.project.appearance.layerAdjustments[layerId][0].value).toBe(.25)
    await workspace.applyRestore(preview)
    expect(workspace.getState().project!.document.props.item.appearance.opacity).toBe(1)
    expect(resolveAppearanceV6(workspace.getState().project!).document.props.item.appearance.opacity).toBe(1)
    workspace.undo(); expect(workspace.getState().project!.document.props.item.appearance.opacity).toBe(.25)
    await workspace.flush()
  })

  it('keeps the current document and undo when quota, metadata CAS or scene CAS reject protection', async () => {
    for (const failure of ['quota', 'metadata', 'scene'] as const) {
      const { workspace, input, api, changeMetadata, changeDurable } = workspaceSetupV6()
      await workspace.openPersisted(input); await workspace.updateProp('item', { rotationDeg: 45 }); await workspace.flush()
      const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' }), before = workspace.getState().project
      const original = api.createNamedSnapshot.getMockImplementation()!
      api.createNamedSnapshot.mockImplementationOnce(async (...args) => {
        if (failure === 'quota') throw new DOMException('存储已满', 'QuotaExceededError')
        if (failure === 'metadata') changeMetadata()
        else { const other = structuredClone(before!); other.document.revision++; changeDurable(other) }
        return original(...args)
      })
      await expect(workspace.applyRestore(preview)).rejects.toThrow(failure === 'quota' ? /存储已满/ : /已变化/)
      expect(workspace.getState().project).toBe(before)
      expect(workspace.getState().canUndo).toBe(true)
      workspace.undo(); expect(workspace.getState().project!.document.revision).toBe(2)
    }
  })

  it('rejects edits, cancellation and source deletion after the protection await, retaining the landed protection point', async () => {
    for (const event of ['edit', 'cancel', 'delete'] as const) {
      const { workspace, input, api, named } = workspaceSetupV6()
      await workspace.openPersisted(input); await workspace.updateProp('item', { rotationDeg: 45 })
      const preview = await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' })
      const saved = api.createNamedSnapshot.getMockImplementation()!
      api.createNamedSnapshot.mockImplementationOnce(async (...args) => {
        const protection = await saved(...args)
        if (event === 'edit') await workspace.updateProp('item', { rotationDeg: 90 })
        else if (event === 'cancel') workspace.cancelRestore(preview)
        else named.delete('saved-snapshot')
        return protection
      })
      await expect(workspace.applyRestore(preview)).rejects.toThrow(event === 'edit' ? /已有修改/ : event === 'cancel' ? /取消/ : /删除/)
      expect([...named.values()].filter(value => value.kind === 'protection')).toHaveLength(1)
      expect(workspace.getState().project!.document.props.item.rotationDeg).toBe(event === 'edit' ? 90 : 45)
      await workspace.flush()
    }
  })

  it('retains restored memory, undo, protection and the older durable branch if the later save fails', async () => {
    const { workspace, input, api, named, durable } = workspaceSetupV6()
    await workspace.openPersisted(input); await workspace.updateProp('item', { rotationDeg: 45 }); await workspace.flush()
    await workspace.applyRestore(await workspace.prepareRestore('saved-snapshot', { ids: ['item'], mode: 'transform' }))
    api.save.mockRejectedValueOnce(new Error('写入失败'))
    await expect(workspace.flush()).rejects.toThrow(/写入失败/)
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true, project: { document: { revision: 2, props: { item: { rotationDeg: 0 } } } } })
    expect(durable().document).toMatchObject({ revision: 1, props: { item: { rotationDeg: 45 } } })
    expect([...named.values()].filter(value => value.kind === 'protection')).toHaveLength(1)
    workspace.undo(); await workspace.retry(); expect(durable().document.revision).toBe(3)
  })

  it('refuses a late snapshot fetch, changed source hash, and forged restore preview', async () => {
    const { workspace, input, source, api, named } = workspaceSetupV6()
    await workspace.openPersisted(input)
    const gate = deferred<NamedSnapshotV6 | null>(); api.loadNamedSnapshot.mockReturnValueOnce(gate.promise)
    const late = workspace.prepareRestore(source.id, { ids: ['item'], mode: 'transform' })
    await workspace.updateProp('item', { rotationDeg: 20 }); gate.resolve(source)
    await expect(late).rejects.toThrow(/已有修改/)
    const preview = await workspace.prepareRestore(source.id, { ids: ['item'], mode: 'transform' })
    await expect(workspace.applyRestore(structuredClone(preview))).rejects.toThrow(/重复/)
    named.set(source.id, { ...snapshotV6(input), contentHash: 'f'.repeat(64) })
    await expect(workspace.applyRestore(preview)).rejects.toThrow(/校验值/)
    expect(api.createNamedSnapshot).not.toHaveBeenCalled()
    await workspace.flush()
  })
})
