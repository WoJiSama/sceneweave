import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StructureRestoreRequestV4 } from '../../core/v4/structure-restore'
import { createAppearanceGraphV5 } from '../../core/v5/graph'
import type { CompleteProjectV5 } from '../../io/v5/types'
import { validateCompleteProjectV5 } from '../../io/v5/project-file'
import { WorkspaceV5 } from './workspace'
import { buildingProjectV5, workspaceSetupV5 } from './workspace-test-fixtures'

// Native commands, V5 metadata and V4's opaque runtime witness are real. Only storage/decoder IO is doubled.
vi.mock('../../io/v5/project-file', () => ({ validateCompleteProjectV5: vi.fn(async () => {}) }))
vi.mock('../../io/v5/prepare', async () => {
  const { applyCompositionCommandsV5 } = await import('../../core/v5/commands')
  const { resolveAppearanceV5 } = await import('../../core/v5/graph')
  const materialize = async (project: CompleteProjectV5) => ({ ...project, ...resolveAppearanceV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }) })
  return { materializeProjectV5: vi.fn(materialize), prepareCompositionCommandsV5: vi.fn(async (project, commands) => materialize({ ...project,
    ...applyCompositionCommandsV5({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance }, commands) })) }
})
beforeEach(() => { vi.useFakeTimers(); vi.mocked(validateCompleteProjectV5).mockReset().mockResolvedValue() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
async function confirmed(workspace: WorkspaceV5, snapshotId: string, request: StructureRestoreRequestV4) {
  const inspection = await workspace.inspectStructureRestore(snapshotId, request)
  return workspace.prepareStructureRestore(snapshotId, { ...request, acknowledgedDependencyIds: inspection.scope.dependencyIds, confirmedLayerIds: inspection.scope.requiredLayerIds })
}

describe('V5 retains C2 guarded structural continuity', () => {
  it('carries real named-snapshot witness through room appearance restore and discards it on reopen', async () => {
    const input = buildingProjectV5(), hash = 'a'.repeat(64), origin = { kind: 'original' as const, attribution: 'Test resource custody', canEmbed: true }
    delete input.document.notes.note; delete input.document.entityLayers.note
    input.document.assets.paint = { id: 'paint', sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1,
      logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'MIT', origin }
    input.document.materials.paintMaterial = { id: 'paintMaterial', catalogId: 'test.paint-material', version: 1, name: 'Paint', tags: [], licenseRef: 'MIT', origin,
      textureAssetId: 'paint', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
    input.document.rooms.room.floorStyle = { base: { materialRef: { id: 'paintMaterial', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0,
      originMm: { x: 0, y: 0 }, alignment: 'world', tint: null, opacity: 1 }, overlays: [] }
    input.appearance = createAppearanceGraphV5(input.document)
    input.assets[hash] = { sha256: hash, blob: new Blob(['decoder IO double']), mimeType: 'image/png', sizeBytes: 17, pixelWidth: 1, pixelHeight: 1 }
    input.licenses[hash] = { sha256: hash, text: 'Test license IO double' }
    input.licenseBindings = [{ subjectKind: 'asset', subjectId: 'paint', licenseRef: 'MIT', licensePath: `licenses/${hash}.txt`, embedding: 'allowed' },
      { subjectKind: 'material', subjectId: 'paintMaterial', licenseRef: 'MIT', licensePath: `licenses/${hash}.txt`, embedding: 'allowed' }]
    const { workspace } = workspaceSetupV5(input, false)
    await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('材质初稿')
    await workspace.execute([{ type: 'setSurfacePaint', kind: 'room', id: 'room', changes: { rotationDeg: 35 } }])
    const preview = await workspace.prepareRestore(source.id, { ids: ['room'], mode: 'appearance' })
    expect(preview.project.document.rooms.room.floorStyle!.base.rotationDeg).toBe(35)
    await workspace.applyRestore(preview); await workspace.flush()
    expect(workspace.getState().project!.historyIdentity.version).toBe(2)
    expect(workspace.getState().project!.document.revision).toBe(2)
    await workspace.openPersisted(workspace.getState().project!)
    await expect(workspace.prepareRestore(source.id, { ids: ['room'], mode: 'appearance' })).rejects.toThrow(/本会话/)
  })

  it('restores a wall with explicit dependency confirmation while preserving the current appearance graph and a later room edit', async () => {
    const { workspace, input, durable } = workspaceSetupV5(buildingProjectV5(), false)
    await workspace.openPersisted(input)
    const named = await workspace.createNamedSnapshot('结构初稿'), layerId = input.document.entityLayers.item
    await workspace.execute([{ type: 'setWallThickness', id: 'w0', thicknessMm: 400 }, { type: 'updateRoom', id: 'room', changes: { purpose: 'later purpose' } }])
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'manual-opacity', kind: 'opacity', value: .4, enabled: true } }])
    const graph = workspace.getState().project!.appearance
    const preview = await confirmed(workspace, named.id, { ids: ['w0'], mode: 'geometry' })
    expect(preview.plan.impacts.find(impact => impact.id === 'w0')?.layerId).toBe(layerId)
    expect(preview.plan.requiredLayerIds).toEqual([]) // all dependencies share the explicitly selected root's layer
    expect(preview.project.appearance).toEqual(graph)
    expect(preview.project.historyIdentity.version).toBe(2)
    await workspace.applyStructureRestore(preview)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, walls: { w0: { thicknessMm: 200 } }, rooms: { room: { purpose: 'later purpose' } } })
    expect(workspace.getState().project!.appearance).toEqual(graph)
    workspace.undo(); expect(workspace.getState().project!.document.walls.w0.thicknessMm).toBe(400)
    workspace.redo(); await workspace.flush()
    expect(durable().document.revision).toBe(5)
    expect(durable().appearance).toEqual(graph)
  })

  it('clears structural witness after reopen and rejects delete/recreate even after undo', async () => {
    const { workspace, input } = workspaceSetupV5(buildingProjectV5(), false)
    await workspace.openPersisted(input)
    const named = await workspace.createNamedSnapshot('会话结构')
    await workspace.execute([{ type: 'deleteOpening', id: 'door' }])
    workspace.undo()
    await expect(workspace.inspectStructureRestore(named.id, { ids: ['door'], mode: 'properties' })).rejects.toThrow(/删除|重建|拓扑/)
    await workspace.flush()
    await workspace.openPersisted(workspace.getState().project!)
    await expect(workspace.inspectStructureRestore(named.id, { ids: ['w0'], mode: 'geometry' })).rejects.toThrow(/本会话/)
  })

  it('cancels without consuming undo and rejects metadata CAS without changing V5 state', async () => {
    const { workspace, input, api, changeMetadata } = workspaceSetupV5(buildingProjectV5(), false)
    await workspace.openPersisted(input)
    const named = await workspace.createNamedSnapshot('结构初稿')
    await workspace.execute([{ type: 'setWallThickness', id: 'w0', thicknessMm: 400 }])
    const cancelled = await confirmed(workspace, named.id, { ids: ['w0'], mode: 'geometry' })
    workspace.cancelStructureRestore(cancelled)
    await expect(workspace.applyStructureRestore(cancelled)).rejects.toThrow(/重复/)
    const preview = await confirmed(workspace, named.id, { ids: ['w0'], mode: 'geometry' }), before = workspace.getState().project
    const create = api.createNamedSnapshot.getMockImplementation()!
    api.createNamedSnapshot.mockImplementationOnce(async (...args) => { changeMetadata(); return create(...args) })
    await expect(workspace.applyStructureRestore(preview)).rejects.toThrow(/元数据/)
    expect(workspace.getState().project).toBe(before)
    expect(workspace.getState().canUndo).toBe(true)
    await workspace.flush()
  })
})
