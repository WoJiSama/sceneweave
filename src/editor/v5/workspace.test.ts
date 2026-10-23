import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPropAppearanceSourceV5, bitmapVariantV5, createAppearanceGraphV5, resolveAppearanceV5 } from '../../core/v5/graph'
import { validateCompleteProjectV5 } from '../../io/v5/project-file'
import { prepareCompositionCommandsV5 } from '../../io/v5/prepare'
import type { CompleteProjectV5, NamedSnapshotV5 } from '../../io/v5/types'
import { pixelPng } from '../../io/v3/test-fixtures'
import { WorkspaceV5 } from './workspace'
import { deferred, projectV5, snapshotV5, workspaceSetupV5 } from './workspace-test-fixtures'

// Real V5 graph/identity/commands/restore; durability and bitmap decoding have their own IO/browser suites.
vi.mock('../../io/v5/project-file', () => ({ validateCompleteProjectV5: vi.fn(async () => {}) }))
vi.mock('../../io/v5/prepare', async () => {
  const { applyCompositionCommandsV5 } = await import('../../core/v5/commands')
  const { resolveAppearanceV5 } = await import('../../core/v5/graph')
  const materialize = async (project: CompleteProjectV5) => ({ ...project, ...resolveAppearanceV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }) })
  return {
    materializeProjectV5: vi.fn(materialize),
    prepareCompositionCommandsV5: vi.fn(async (project, commands) => materialize({ ...project, ...applyCompositionCommandsV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, commands) })),
  }
})
const validate = vi.mocked(validateCompleteProjectV5), prepare = vi.mocked(prepareCompositionCommandsV5)
beforeEach(() => { vi.useFakeTimers(); validate.mockReset().mockResolvedValue(); prepare.mockClear() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Valid catalog shape with explicit IO custody doubles; no active scene target changes. */
function catalogCandidate(input: CompleteProjectV5): CompleteProjectV5 {
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

describe('V5 full candidate workspace', () => {
  it('keeps fixed bitmap bytes and source roots through set, disable, undo, remove, save and reopen', async () => {
    const input = projectV5(), document = input.document, prop = document.props.item
    const origin = { kind: 'original' as const, attribution: 'Workspace source custody test', canEmbed: true }, sourceHash = 'a'.repeat(64), derivedHash = 'b'.repeat(64)
    document.assets.image = { id: 'image', sha256: sourceHash, mimeType: 'image/png', pixelWidth: 8, pixelHeight: 8, logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'MIT', origin }
    document.propDefinitions.photo = { id: 'photo', catalogId: 'test.photo', version: 1, licenseRef: 'MIT', origin, name: 'Photo', tags: [], defaultAppearance: { kind: 'image', assetId: 'image', tint: null, opacity: 1 },
      defaultVisualBoundsMm: prop.visualBoundsMm, defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
    prop.definitionRef = { id: 'photo', version: 1 }; prop.appearance = structuredClone(document.propDefinitions.photo.defaultAppearance)
    input.appearance = createAppearanceGraphV5(document)
    const variant = bitmapVariantV5('image', '#AABBCC', 1)!
    document.assets[variant.outputAssetId] = { ...document.assets.image, id: variant.outputAssetId, sha256: derivedHash }
    input.appearance.variants[variant.id] = variant
    input.appearance.instanceAdjustments.item = [{ id: 'tint', kind: 'tint', value: '#AABBCC', enabled: true }]
    Object.assign(input, resolveAppearanceV5(input))
    delete input.appearance.instanceAdjustments.item
    Object.assign(input, resolveAppearanceV5(input))
    for (const [hash, value] of [[sourceHash, 'source'], [derivedHash, 'derived']] as const) input.assets[hash] = { sha256: hash, blob: new Blob([value]), mimeType: 'image/png', sizeBytes: value.length, pixelWidth: 8, pixelHeight: 8 }
    const { workspace, durable } = workspaceSetupV5(input)
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
    const { workspace, input, api, durable } = workspaceSetupV5()
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
    const { workspace, input } = workspaceSetupV5()
    await workspace.openPersisted(input)
    const cancelled = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 15 } }])
    workspace.cancelPreview(cancelled)
    await expect(workspace.adoptPreview(cancelled)).rejects.toThrow(/重复/)
    await expect(workspace.adoptPreview(structuredClone(cancelled))).rejects.toThrow(/重复/)
    const stale = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }])
    await workspace.updateProp('item', { rotationDeg: 45 })
    await expect(workspace.adoptPreview(stale)).rejects.toThrow(/已有修改/)
    const gate = deferred<CompleteProjectV5>(), original = prepare.getMockImplementation()!
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
    const { workspace, input } = workspaceSetupV5()
    input.migrationSource = { sourceSchemaVersion: 4, sourceSceneId: 'old', sourceRevision: 7, sourceHash: 'b'.repeat(64),
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
    const input = catalogCandidate(projectV5()); input.document.props.item.editLocked = true
    const { workspace, api } = workspaceSetupV5(input)
    await workspace.openPersisted(input)
    const before = workspace.getState(), sourceId = input.appearance.propSources.item, layerId = input.document.entityLayers.item
    const changes: ((candidate: CompleteProjectV5) => void)[] = [
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
    const actualIO = await vi.importActual<typeof import('../../io/v5/project-file')>('../../io/v5/project-file')
    const actualPrepare = await vi.importActual<typeof import('../../io/v5/prepare')>('../../io/v5/prepare')
    validate.mockImplementation(actualIO.validateCompleteProjectV5)
    const png = pixelPng(), drawImage = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })))
    vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob([png.slice().buffer], { type: 'image/png' })) })) })
    const input = projectV5(); input.document.props.item.editLocked = true
    const { workspace, durable } = workspaceSetupV5(input)
    await workspace.openPersisted(input)
    const checkpoint = workspace.checkpoint(), candidate = await actualPrepare.prepareAssetImportV5(input, {
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
    await actualIO.validateCompleteProjectV5(durable())
  })

  it('rechecks cancellation after adoption validation and rejects no-op/revision-overflow without side effects', async () => {
    const { workspace, input } = workspaceSetupV5()
    await workspace.openPersisted(input)
    const preview = await workspace.preview([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 30 } }])
    const gate = deferred(); validate.mockReturnValueOnce(gate.promise)
    const adopting = workspace.adoptPreview(preview)
    workspace.cancelPreview(preview); gate.resolve()
    await expect(adopting).rejects.toThrow(/取消/)
    expect(workspace.getState().canUndo).toBe(false)
    await workspace.execute([{ type: 'updateProp', id: 'item', changes: { rotationDeg: 0 } }])
    expect(workspace.getState().project!.document.revision).toBe(0)
    const max = projectV5(); max.document.revision = Number.MAX_SAFE_INTEGER
    const overflow = new WorkspaceV5(workspaceSetupV5(max).api)
    await overflow.openPersisted(max)
    await expect(overflow.updateProp('item', { rotationDeg: 40 })).rejects.toThrow(/安全整数/)
    expect(overflow.getState().canUndo).toBe(false)
  })
})

describe('V5 protected selective restore', () => {
  it('restores a frozen C source after undo removed ancestor B, retaining exact ancestor bytes and licenses', async () => {
    const input = projectV5(), prop = input.document.props.item
    const origin = { kind: 'original' as const, attribution: 'Cross-branch source custody test', canEmbed: true }, licenseHash = 'd'.repeat(64)
    const a = input.document.assets.a = { id: 'a', sha256: 'a'.repeat(64), mimeType: 'image/png' as const, pixelWidth: 8, pixelHeight: 8,
      logicalSizeMm: { width: 200, height: 200 }, licenseRef: 'MIT', origin }
    const definition = input.document.propDefinitions.photo = { id: 'photo', catalogId: 'test.photo', version: 1, licenseRef: 'MIT', origin, name: 'Photo', tags: [],
      defaultAppearance: { kind: 'image' as const, assetId: a.id, tint: null, opacity: 1 }, defaultVisualBoundsMm: prop.visualBoundsMm,
      defaultFootprintMm: prop.footprintMm, defaultFootprintOffsetMm: prop.footprintOffsetMm, defaultBlocksMovement: false, defaultBlocksSight: false,
      defaultRenderLayer: 'object' as const, defaultShadowClass: 'none' as const }
    prop.definitionRef = { id: definition.id, version: 1 }; prop.appearance = structuredClone(definition.defaultAppearance)
    input.appearance = createAppearanceGraphV5(input.document)
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
      historic.appearance.propSources.item = addPropAppearanceSourceV5(historic.appearance, snapshot, historic.appearance.propSources.item)
      historic.assets[asset.sha256] = { sha256: asset.sha256, blob: new Blob([`source-${id}`]), mimeType: 'image/png', sizeBytes: 8, pixelWidth: 8, pixelHeight: 8 }
      for (const [subjectKind, subjectId] of [['asset', id], ['propDefinition', `branch-root-${id}`]] as const) {
        historic.licenseBindings.push({ subjectKind, subjectId, licenseRef: 'MIT', licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })
      }
    }
    Object.assign(historic, resolveAppearanceV5(historic))
    const { workspace, durable } = workspaceSetupV5(input)
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
    const { workspace, input, api, durable } = workspaceSetupV5()
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

  it('preserves V5 effective appearance and current layer metadata through a selected restore', async () => {
    const { workspace, input } = workspaceSetupV5(), layerId = input.document.entityLayers.item
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
    expect(resolveAppearanceV5(workspace.getState().project!).document.props.item.appearance.opacity).toBe(1)
    workspace.undo(); expect(workspace.getState().project!.document.props.item.appearance.opacity).toBe(.25)
    await workspace.flush()
  })

  it('keeps the current document and undo when quota, metadata CAS or scene CAS reject protection', async () => {
    for (const failure of ['quota', 'metadata', 'scene'] as const) {
      const { workspace, input, api, changeMetadata, changeDurable } = workspaceSetupV5()
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
      const { workspace, input, api, named } = workspaceSetupV5()
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
    const { workspace, input, api, named, durable } = workspaceSetupV5()
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
    const { workspace, input, source, api, named } = workspaceSetupV5()
    await workspace.openPersisted(input)
    const gate = deferred<NamedSnapshotV5 | null>(); api.loadNamedSnapshot.mockReturnValueOnce(gate.promise)
    const late = workspace.prepareRestore(source.id, { ids: ['item'], mode: 'transform' })
    await workspace.updateProp('item', { rotationDeg: 20 }); gate.resolve(source)
    await expect(late).rejects.toThrow(/已有修改/)
    const preview = await workspace.prepareRestore(source.id, { ids: ['item'], mode: 'transform' })
    await expect(workspace.applyRestore(structuredClone(preview))).rejects.toThrow(/重复/)
    named.set(source.id, { ...snapshotV5(input), contentHash: 'f'.repeat(64) })
    await expect(workspace.applyRestore(preview)).rejects.toThrow(/校验值/)
    expect(api.createNamedSnapshot).not.toHaveBeenCalled()
    await workspace.flush()
  })
})


describe('U1a compatibility route departure', () => {
  it('closes only after save and invalidates the old checkpoint and undo session', async () => {
    const { workspace, api, input } = workspaceSetupV5()
    await workspace.openPersisted(input)
    await workspace.updateProp('item', { rotationDeg: 30 })
    const checkpoint = workspace.checkpoint()
    expect(workspace.getState().canUndo).toBe(true)
    await workspace.close(checkpoint)
    expect(workspace.getState()).toMatchObject({ project: null, status: 'empty', canUndo: false, canRedo: false })
    expect(() => workspace.assertCheckpoint(checkpoint)).toThrow()
  })
  it('preserves the current document and usable undo when save fails', async () => {
    const { workspace, api, input } = workspaceSetupV5()
    await workspace.openPersisted(input)
    await workspace.updateProp('item', { rotationDeg: 30 })
    const current = workspace.getState().project
    api.save.mockRejectedValueOnce(new Error('关闭前保存失败'))
    await expect(workspace.close()).rejects.toThrow('关闭前保存失败')
    expect(workspace.getState().project).toBe(current)
    expect(workspace.getState().canUndo).toBe(true)
    await workspace.undo()
    expect(workspace.getState().project!.document.props['item'].rotationDeg).toBe(0)
  })
})
