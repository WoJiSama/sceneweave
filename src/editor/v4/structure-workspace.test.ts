import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures'
import { createHistoryIdentityV4 } from '../../core/v4/identity'
import { HISTORY_LIMITS_V4 } from '../../core/v4/types'
import type { StructureRestoreRequestV4 } from '../../core/v4/structure-restore'
import { validateCompleteProjectV4 } from '../../io/v4/project-file'
import type { CompleteProjectV4, NamedSnapshotV4 } from '../../io/v4/types'
import { WorkspaceV4, type WorkspaceRepositoryV4 } from './workspace'

// Real native commands, restore plan and continuity; storage/bitmap bytes have separate IO/browser coverage.
vi.mock('../../io/v4/project-file', () => ({ validateCompleteProjectV4: vi.fn(async () => {}) }))
const validate = vi.mocked(validateCompleteProjectV4)
function project(): CompleteProjectV4 {
  const document = layerSceneV3(), layerId = document.entityLayers.item
  document.assets = {}; document.propDefinitions = {}
  const points = [{ xMm: 3000, yMm: 3000 }, { xMm: 10000, yMm: 3000 }, { xMm: 10000, yMm: 10000 }, { xMm: 3000, yMm: 10000 }]
  points.forEach((point, i) => {
    const id = `v${i}`, wallId = `w${i}`
    document.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, ...point }
    document.walls[wallId] = { id: wallId, floorId: 'blank-floor', editLocked: false, startVertexId: id, endVertexId: `v${(i + 1) % points.length}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    document.entityLayers[id] = layerId; document.entityLayers[wallId] = layerId
  })
  document.rooms.room = { id: 'room', floorId: 'blank-floor', editLocked: false, boundaryVertexIds: points.map((_, i) => `v${i}`), purpose: 'original room', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: 'blank-floor' }, groundElevationMm: 0, floorStyle: null }
  document.entityLayers.room = layerId
  document.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'w0', offsetReferenceVertexId: 'v0', offsetMm: 2000, widthMm: 1000, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }
  document.entityLayers.door = layerId
  document.notes.note = { id: 'note', floorId: 'blank-floor', editLocked: false, anchor: { type: 'entity', entityKind: 'room', entityId: 'room' }, kind: 'note', text: 'original note', visibility: 'gm' }
  document.entityLayers.note = layerId
  return { document, historyIdentity: createHistoryIdentityV4(document), assets: {}, licenses: {}, licenseBindings: [] }
}
function snapshot(project: CompleteProjectV4, id: string, kind: 'named' | 'protection' = 'named'): NamedSnapshotV4 {
  return { id, sceneId: project.document.sceneId, lineageId: project.historyIdentity.lineageId, sourceRevision: project.document.revision, name: '结构初稿', kind, contentHash: 'a'.repeat(64), createdAt: '2026-10-22T00:00:00.000Z', project: structuredClone(project) }
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function setup() {
  const input = project(), named = new Map<string, NamedSnapshotV4>()
  let durable = structuredClone(input), metadataVersion = 0
  const api = {
    save: vi.fn<WorkspaceRepositoryV4['save']>(async (candidate, expected) => {
      if (expected !== null && durable.document.revision !== expected) { const error = new Error('另一个标签已保存'); error.name = 'ConflictErrorV4'; throw error }
      durable = structuredClone(candidate)
    }),
    usage: vi.fn<WorkspaceRepositoryV4['usage']>(async () => ({ metadataVersion, namedCount: [...named.values()].filter(value => value.kind === 'named').length,
      protectionCount: [...named.values()].filter(value => value.kind === 'protection').length, resourceBytes: 0, documentBytes: 0, originalBytes: 0, limits: HISTORY_LIMITS_V4 })),
    loadNamedSnapshot: vi.fn<WorkspaceRepositoryV4['loadNamedSnapshot']>(async id => named.has(id) ? structuredClone(named.get(id)!) : null),
    createNamedSnapshot: vi.fn<WorkspaceRepositoryV4['createNamedSnapshot']>(async (candidate, name, options = {}) => {
      if (candidate.document.revision !== durable.document.revision || options.expectedRevision !== durable.document.revision) throw new Error('保存基线已变化')
      if (options.expectedMetadataVersion !== metadataVersion) throw new Error('历史元数据CAS冲突')
      if (options.sourceSnapshot && named.get(options.sourceSnapshot.id)?.contentHash !== options.sourceSnapshot.contentHash) throw new Error('源快照CAS冲突')
      const value = { ...snapshot(candidate, `snapshot-${named.size}`, options.kind ?? 'named'), name }
      named.set(value.id, structuredClone(value)); metadataVersion++; return value
    }),
    importArchive: vi.fn<WorkspaceRepositoryV4['importArchive']>(async archive => archive),
  } satisfies WorkspaceRepositoryV4
  const workspace = new WorkspaceV4(api)
  return { workspace, api, input, named, durable: () => durable, bumpMetadata: () => metadataVersion++ }
}
async function prepare(workspace: WorkspaceV4, id: string, request: StructureRestoreRequestV4 = { ids: ['room'], mode: 'properties' }) {
  const inspected = await workspace.inspectStructureRestore(id, request)
  return workspace.prepareStructureRestore(id, { ...request, acknowledgedDependencyIds: inspected.scope.dependencyIds, confirmedLayerIds: inspected.scope.requiredLayerIds })
}
beforeEach(() => { vi.useFakeTimers(); validate.mockReset().mockResolvedValue() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('C2 session-bound guarded structure restore', () => {
  it('captures a session snapshot, protects current once, restores one transaction, preserves later content and registers protection continuity', async () => {
    const { workspace, input, api, durable } = setup()
    await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('结构原稿')
    workspace.execute([{ type: 'moveVertex', id: 'v1', positionMm: { x: 11000, y: 3000 } }, { type: 'updateRoom', id: 'room', changes: { purpose: 'current room' } }])
    workspace.execute([{ type: 'copyProp', id: 'item', newId: 'later', offsetMm: { x: 1200, y: 0 } }, { type: 'updateNote', id: 'note', changes: { text: 'later note' } }])
    const current = workspace.getState().project!, preview = await prepare(workspace, source.id)
    expect(preview.plan.dependencyIds).toEqual(expect.arrayContaining(['v1', 'door', 'note']))
    expect(preview.plan.changes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'room' }), expect.objectContaining({ id: 'v1' })]))
    expect(preview.project.document.notes.note.text).toBe('later note')
    const protection = await workspace.applyStructureRestore(preview)
    expect(protection.kind).toBe('protection'); expect(protection.project.document.revision).toBe(2)
    expect(api.createNamedSnapshot).toHaveBeenCalledTimes(2)
    expect(workspace.getState().project!.document).toMatchObject({ revision: 3, rooms: { room: { purpose: 'original room' } }, vertices: { v1: { xMm: 10000 } }, props: { later: current.document.props.later }, notes: { note: { text: 'later note' } } })
    await expect(workspace.applyStructureRestore(preview)).rejects.toThrow(/重复/)
    const protectedPreview = await prepare(workspace, protection.id)
    expect(protectedPreview.plan.changed).toBe(true)
    workspace.cancelStructureRestore(protectedPreview)
    workspace.undo(); expect(workspace.getState().project!.document).toMatchObject({ revision: 4, rooms: { room: { purpose: 'current room' } } })
    workspace.redo(); expect(workspace.getState().project!.document.revision).toBe(5)
    await workspace.flush(); expect(durable().document.revision).toBe(5)
  })

  it('refuses saved/imported snapshots without this session witness and clears evidence after reopening', async () => {
    const { workspace, input, named } = setup()
    named.set('preexisting', snapshot(input, 'preexisting'))
    await workspace.openPersisted(input)
    await expect(workspace.inspectStructureRestore('preexisting', { ids: ['room'], mode: 'geometry' })).rejects.toThrow(/本会话.*连续性/)
    const created = await workspace.createNamedSnapshot('本会话快照')
    expect((await workspace.inspectStructureRestore(created.id, { ids: ['room'], mode: 'geometry' })).scope.rootIds).toEqual(['room'])
    await workspace.openPersisted(structuredClone(workspace.getState().project!))
    await expect(workspace.inspectStructureRestore(created.id, { ids: ['room'], mode: 'geometry' })).rejects.toThrow(/重开、导入或切换/)
  })

  it('invalidates deleted/recreated or reversed structures through edits and undo, even after equal IDs/topology return', async () => {
    for (const kind of ['door', 'wall'] as const) {
      const { workspace, input } = setup(); await workspace.openPersisted(input)
      const source = await workspace.createNamedSnapshot('原结构')
      if (kind === 'door') workspace.execute([{ type: 'deleteOpening', id: 'door' }])
      else workspace.execute([{ type: 'reverseWall', id: 'w0' }])
      workspace.undo()
      await expect(workspace.inspectStructureRestore(source.id, { ids: [kind === 'door' ? 'door' : 'w0'], mode: 'properties' })).rejects.toThrow(/曾删除、重建或改变拓扑/)
      await workspace.flush()
    }
  })

  it('refuses delete/recreate in one transaction, including equal final JSON; separate recreation loses continuity', async () => {
    const { workspace, input } = setup(); await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('原开口')
    for (const state of ['open', 'closed'] as const) {
      const before = workspace.getState()
      expect(() => workspace.execute([{ type: 'deleteOpening', id: 'door' }, { type: 'addOpening', id: 'door', wallId: 'w0', offsetReferenceVertexId: 'v0', offsetMm: 2000, widthMm: 1000, kind: 'door', state }])).toThrow(/同一事务不能删除后重建/)
      expect(workspace.getState()).toBe(before)
    }
    workspace.execute([{ type: 'deleteOpening', id: 'door' }])
    workspace.execute([{ type: 'addOpening', id: 'door', wallId: 'w0', offsetReferenceVertexId: 'v0', offsetMm: 2000, widthMm: 1000, kind: 'door', state: 'closed' }])
    await expect(workspace.inspectStructureRestore(source.id, { ids: ['door'], mode: 'properties' })).rejects.toThrow(/曾删除、重建或改变拓扑/)
    await workspace.flush()
  })

  it('requires full expansion confirmation and refuses cancelled, cloned, stale, removed or rehashed source previews before protection', async () => {
    const { workspace, input, named, api } = setup(); await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('原稿')
    workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'edited' } }])
    await expect(workspace.prepareStructureRestore(source.id, { ids: ['room'], mode: 'properties' })).rejects.toThrow(/依赖范围尚未完整确认/)
    const cancelled = await prepare(workspace, source.id); workspace.cancelStructureRestore(cancelled)
    await expect(workspace.applyStructureRestore(cancelled)).rejects.toThrow(/重复/)
    await expect(workspace.applyStructureRestore(structuredClone(cancelled))).rejects.toThrow(/重复/)
    const stale = await prepare(workspace, source.id); workspace.updateProp('item', { rotationDeg: 45 })
    await expect(workspace.applyStructureRestore(stale)).rejects.toThrow(/已有修改/)
    const rehashed = await prepare(workspace, source.id); named.get(source.id)!.contentHash = 'b'.repeat(64)
    await expect(workspace.applyStructureRestore(rehashed)).rejects.toThrow(/内容校验值/)
    named.get(source.id)!.contentHash = source.contentHash
    const removed = await prepare(workspace, source.id); named.delete(source.id)
    await expect(workspace.applyStructureRestore(removed)).rejects.toThrow(/源快照已删除/)
    expect(api.createNamedSnapshot).toHaveBeenCalledTimes(1)
    await workspace.flush()
  })

  it('leaves current/undo intact when protection quota or metadata CAS fails', async () => {
    for (const failure of ['quota', 'metadata'] as const) {
      const { workspace, input, api, bumpMetadata } = setup(); await workspace.openPersisted(input)
      const source = await workspace.createNamedSnapshot('原稿')
      workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'edited' } }])
      const preview = await prepare(workspace, source.id)
      if (failure === 'quota') api.createNamedSnapshot.mockRejectedValueOnce(new DOMException('存储已满', 'QuotaExceededError'))
      else {
        const save = api.createNamedSnapshot.getMockImplementation()!
        api.createNamedSnapshot.mockImplementationOnce(async (...args) => { bumpMetadata(); return save(...args) })
      }
      await expect(workspace.applyStructureRestore(preview)).rejects.toThrow(failure === 'quota' ? /存储已满/ : /元数据CAS冲突/)
      expect(workspace.getState()).toMatchObject({ canUndo: true, project: { document: { revision: 1, rooms: { room: { purpose: 'edited' } } } } })
      workspace.undo(); expect(workspace.getState().project!.document.revision).toBe(2)
      await workspace.flush()
    }
  })

  it('rechecks cancellation, source deletion/content and intervening edits after protection IO', async () => {
    for (const event of ['cancel', 'delete', 'tamper', 'edit'] as const) {
      const { workspace, input, api, named } = setup(); await workspace.openPersisted(input)
      const source = await workspace.createNamedSnapshot('原稿')
      workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'edited' } }])
      const preview = await prepare(workspace, source.id), save = api.createNamedSnapshot.getMockImplementation()!
      api.createNamedSnapshot.mockImplementationOnce(async (...args) => {
        const protectedSnapshot = await save(...args)
        if (event === 'cancel') workspace.cancelStructureRestore(preview)
        else if (event === 'delete') named.delete(source.id)
        else if (event === 'tamper') named.get(source.id)!.project.document.rooms.room.purpose = 'tampered with same mock hash'
        else workspace.updateProp('item', { rotationDeg: 90 })
        return protectedSnapshot
      })
      await expect(workspace.applyStructureRestore(preview)).rejects.toThrow(event === 'cancel' ? /取消/ : event === 'delete' ? /删除/ : event === 'tamper' ? /连续性记录/ : /已有修改/)
      expect([...named.values()].filter(value => value.kind === 'protection')).toHaveLength(1)
      expect(workspace.getState().project!.document.rooms.room.purpose).toBe('edited')
      await workspace.flush()
    }
  })

  it('preserves new memory/undo/protection and old durable branch when the adopted save fails', async () => {
    const { workspace, input, api, named, durable } = setup(); await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('原稿')
    workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'edited' } }]); await workspace.flush()
    await workspace.applyStructureRestore(await prepare(workspace, source.id))
    api.save.mockRejectedValueOnce(new Error('恢复后保存失败'))
    await expect(workspace.flush()).rejects.toThrow(/恢复后保存失败/)
    expect(workspace.getState()).toMatchObject({ status: 'error', canUndo: true, project: { document: { revision: 2, rooms: { room: { purpose: 'original room' } } } } })
    expect(durable().document).toMatchObject({ revision: 1, rooms: { room: { purpose: 'edited' } } })
    expect([...named.values()].filter(value => value.kind === 'protection')).toHaveLength(1)
    workspace.undo(); expect(workspace.getState().project!.document.revision).toBe(3)
    await workspace.retry(); expect(durable().document.revision).toBe(3)
  })

  it('rejects a late resource validation and late snapshot result after a newer edit', async () => {
    const { workspace, input, api } = setup(); await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('原稿')
    workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'edited' } }])
    const inspection = await workspace.inspectStructureRestore(source.id, { ids: ['room'], mode: 'properties' })
    const gate = deferred(); validate.mockReturnValueOnce(gate.promise)
    const preparing = workspace.prepareStructureRestore(source.id, { ids: ['room'], mode: 'properties', acknowledgedDependencyIds: inspection.scope.dependencyIds })
    for (let index = 0; index < 10; index++) await Promise.resolve()
    workspace.updateProp('item', { rotationDeg: 45 }); gate.resolve()
    await expect(preparing).rejects.toThrow(/已有修改/)
    const loading = deferred<NamedSnapshotV4 | null>(); api.loadNamedSnapshot.mockReturnValueOnce(loading.promise)
    const inspecting = workspace.inspectStructureRestore(source.id, { ids: ['room'], mode: 'geometry' })
    workspace.updateProp('item', { rotationDeg: 90 }); loading.resolve(source)
    await expect(inspecting).rejects.toThrow(/已有修改/)
    expect(api.createNamedSnapshot).toHaveBeenCalledTimes(1)
    await workspace.flush()
  })

  it('retains current license/material bytes and never adopts historical appearance through structure properties', async () => {
    const { workspace, input, named } = setup(); await workspace.openPersisted(input)
    const source = await workspace.createNamedSnapshot('原稿')
    workspace.execute([{ type: 'updateRoom', id: 'room', changes: { purpose: 'edited' } }])
    const historical = named.get(source.id)!
    historical.project.licenses['b'.repeat(64)] = { sha256: 'b'.repeat(64), text: 'unrelated historic license' }
    const preview = await prepare(workspace, source.id)
    expect(preview.project.licenses).toEqual({})
    expect(workspace.getState().project!.licenses).toEqual({})
    await workspace.flush()
  })
})
