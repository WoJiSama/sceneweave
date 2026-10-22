import { vi } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures'
import type { SceneDocumentV3 } from '../../core/v3/types'
import { createCompositionContentV5 } from '../../core/v5/graph'
import { HISTORY_LIMITS_V5 } from '../../core/v5/types'
import type { CompleteProjectV5, NamedSnapshotV5 } from '../../io/v5/types'
import { WorkspaceV5, type WorkspaceRepositoryV5 } from './workspace'

export function projectV5(document: SceneDocumentV3 = layerSceneV3()): CompleteProjectV5 {
  document = structuredClone(document)
  document.assets = {}; document.propDefinitions = {}
  return { ...createCompositionContentV5(document), assets: {}, licenses: {}, licenseBindings: [] }
}
export function snapshotV5(project: CompleteProjectV5, id = 'saved-snapshot', kind: 'named' | 'protection' = 'named'): NamedSnapshotV5 {
  return { id, sceneId: project.document.sceneId, lineageId: project.historyIdentity.lineageId, sourceRevision: project.document.revision,
    name: '初稿', kind, contentHash: 'a'.repeat(64), createdAt: '2026-10-22T00:00:00.000Z', project: structuredClone(project) }
}
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
/** A deterministic CAS repository double; actual IndexedDB/bytes are covered by IO suites. */
export function workspaceSetupV5(input = projectV5(), withInitialSnapshot = true) {
  const source = snapshotV5(input), named = new Map<string, NamedSnapshotV5>(withInitialSnapshot ? [[source.id, source]] : [])
  let durable = structuredClone(input), metadataVersion = 0
  const api = {
    save: vi.fn<WorkspaceRepositoryV5['save']>(async (candidate, expected) => {
      if (expected !== null && durable.document.revision !== expected) {
        const error = new Error('另一标签已保存'); error.name = 'ConflictErrorV5'; throw error
      }
      durable = structuredClone(candidate)
    }),
    usage: vi.fn<WorkspaceRepositoryV5['usage']>(async () => ({ metadataVersion,
      namedCount: [...named.values()].filter(value => value.kind === 'named').length,
      protectionCount: [...named.values()].filter(value => value.kind === 'protection').length,
      resourceBytes: 0, documentBytes: 0, originalBytes: 0, limits: HISTORY_LIMITS_V5 })),
    loadNamedSnapshot: vi.fn<WorkspaceRepositoryV5['loadNamedSnapshot']>(async id => named.has(id) ? structuredClone(named.get(id)!) : null),
    createNamedSnapshot: vi.fn<WorkspaceRepositoryV5['createNamedSnapshot']>(async (candidate, name, options = {}) => {
      if (candidate.document.revision !== durable.document.revision || options.expectedRevision !== durable.document.revision) throw new Error('保存基线已变化')
      if (options.expectedMetadataVersion !== metadataVersion) throw new Error('快照元数据已变化')
      if (options.sourceSnapshot && named.get(options.sourceSnapshot.id)?.contentHash !== options.sourceSnapshot.contentHash) throw new Error('源快照已删除或变化')
      const value = { ...snapshotV5(candidate, `named-${named.size}`, options.kind ?? 'named'), name }
      named.set(value.id, structuredClone(value)); metadataVersion++; return value
    }),
    importArchive: vi.fn<WorkspaceRepositoryV5['importArchive']>(async archive => archive),
  } satisfies WorkspaceRepositoryV5
  const workspace = new WorkspaceV5(api)
  return { workspace, api, source, named, input, durable: () => durable,
    changeDurable: (next: CompleteProjectV5) => { durable = structuredClone(next) }, changeMetadata: () => { metadataVersion++ } }
}

export function buildingProjectV5(): CompleteProjectV5 {
  const document = layerSceneV3(), layerId = document.entityLayers.item
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
  return projectV5(document)
}
