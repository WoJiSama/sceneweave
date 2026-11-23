import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fromBundle } from '../../application/workspace/project.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CompositionContent } from '../model/appearance.js'
import { certifyCompositionContent, releasePropUpdateCompositionTransaction, tryApplyPropUpdateCompositionTransaction } from '../validation/content.js'
import { cloneJson } from '../validation/json.js'
import type { AttachmentCommand } from './commands.js'
import { resolvePropContact } from './contact.js'
import { validateAttachmentProofs } from './identity.js'
import { inspectAttachments } from './validation.js'

const surface: AttachmentCommand = { type: 'addAttachmentSurface', id: 'table-top', owner: { kind: 'prop', id: 'item' },
  feature: { kind: 'propTop', polygonLocalMm: [{ x: -1000, y: -600 }, { x: 1000, y: -600 }, { x: 1000, y: 600 }, { x: -1000, y: 600 }], heightLocalMm: 800 }, capabilities: ['support'] }
const bind: AttachmentCommand = { type: 'bindPropAttachment', id: 'on-table', childId: 'other', surfaceId: 'table-top', mode: 'support', follow: 'follow', anchorState: 'manual',
  anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } }

function bundle(options: { image?: boolean } = {}) {
  const value = fixture(options), document = value.project.document
  Object.assign(document.props.item, { positionMm: { x: 6000, y: 6000 }, rotationDeg: 0, footprintMm: { width: 2400, height: 1600 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false })
  Object.assign(document.props.other, { positionMm: { x: 6200, y: 6000 }, rotationDeg: 0, footprintMm: { width: 400, height: 200 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false })
  Object.assign(value.project, createCompositionContent(document, runtime))
  return value
}
function content(value: Pick<CompositionContent, 'document' | 'historyIdentity' | 'appearance'>): CompositionContent {
  return { document: value.document, historyIdentity: value.historyIdentity, appearance: value.appearance }
}
function assertContact(value: CompositionContent) {
  expect(resolvePropContact(value.document, 'other')).toMatchObject({ actualSurfaceId: 'table-top', contactElevationMm: 800, rootSupportRef: { kind: 'floor', id: 'blank-floor' } })
  expect(inspectAttachments(value.document)).toEqual([])
  expect(validateAttachmentProofs(value.document, value.historyIdentity)).toEqual([])
}
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})
async function workspaceSetup(options?: { image?: boolean }) {
  const repository = new ProjectRepository({ name: `attachment-integration-${crypto.randomUUID()}`, runtime, validation })
  repositories.push(repository)
  const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
  await workspace.adoptNew(await fromBundle(bundle(options), validation))
  return { repository, workspace, owner: workspace.getDocument()!.sceneId }
}

describe('attachment composition and actual Workspace adoption', () => {
  it('allocates real identities before same-transaction binding and follows host translation and rotation once', () => {
    const source = certifyCompositionContent(content(bundle().project))
    const attached = applyCompositionDraftCommands(source, [surface, bind], runtime)
    assertContact(attached)
    expect(attached.historyIdentity.structureTokens!['table-top'].kind).toBe('attachmentSurface')
    expect(attached.historyIdentity.structureTokens!['on-table'].kind).toBe('attachment')
    expect(attached.document.attachmentSurfaces!['table-top'].proofs.owner.birthToken).toBe(source.historyIdentity.propTokens.item)
    expect(attached.document.attachments!['on-table'].proofs.child.birthToken).toBe(source.historyIdentity.propTokens.other)
    expect(source.document.attachmentSurfaces).toBeUndefined()
    const proofs = cloneJson(attached.document.attachments!['on-table'].proofs)
    const moved = applyCompositionDraftCommands(attached, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 7000, y: 6500 }, rotationDeg: 90 } }], runtime)
    expect(moved.document.props.other).toMatchObject({ positionMm: { x: 7000, y: 6700 }, rotationDeg: 90 })
    expect(moved.document.attachments!['on-table'].anchor).toEqual(bind.type === 'bindPropAttachment' ? bind.anchor : null)
    expect(moved.document.attachments!['on-table'].proofs).toEqual(proofs)
    expect(moved.historyIdentity.propTokens).toEqual(attached.historyIdentity.propTokens)
    expect(moved.historyIdentity.structureTokens).toEqual(attached.historyIdentity.structureTokens)
    assertContact(moved)
  })

  it('updates top contact when terrain under the host changes height', () => {
    const { document } = bundle().project
    const supportRef = { kind: 'terrainArea' as const, id: 'hill' }
    const boundary = [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }]
    const relief = { version: 1 as const, columns: 2, rows: 2, offsetsMm: [0, 600, 0, 600] }
    document.terrainAreas.hill = { id: 'hill', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: boundary.map((positionMm, i) => ({ id: `hill-point-${i}`, segmentId: `hill-edge-${i}`, positionMm })),
      groundElevationMm: 300, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, relief }
    document.entityLayers.hill = document.entityLayers.item
    document.props.item.supportRef = document.props.other.supportRef = supportRef
    const attached = applyCompositionDraftCommands(createCompositionContent(document, runtime), [surface, bind], runtime)
    expect(resolvePropContact(attached.document, 'other').contactElevationMm).toBe(1500)
    const raised = applyCompositionDraftCommands(attached, [{ type: 'updateTerrainArea', id: 'hill',
      changes: { relief: { ...relief, offsetsMm: relief.offsetsMm.map(height => height + 300) } } }], runtime)
    expect(raised.document.attachments!['on-table']).toMatchObject({ materialized: { contactElevationMm: 1800 },
      anchor: attached.document.attachments!['on-table'].anchor, proofs: attached.document.attachments!['on-table'].proofs })
    expect(raised.document.props.other.positionMm).toEqual(attached.document.props.other.positionMm)
    expect(inspectAttachments(raised.document)).toEqual([])
  })

  it('records explicit child placement as a local manual anchor, preserves proofs and refuses the independent-Prop shortcut', () => {
    const source = certifyCompositionContent(content(bundle().project))
    const independent = tryApplyPropUpdateCompositionTransaction(source, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 7000, y: 6500 } } }])
    expect(independent).toBeDefined()
    releasePropUpdateCompositionTransaction(independent!)
    const attached = applyCompositionDraftCommands(source, [surface, bind], runtime)
    const proofs = cloneJson(attached.document.attachments!['on-table'].proofs)
    const moved = applyCompositionDraftCommands(attached, [{ type: 'updateProp', id: 'other', changes: { positionMm: { x: 6500, y: 6100 } } }], runtime)
    expect(moved.document.attachments!['on-table']).toMatchObject({ anchorState: 'manual', anchor: { localMm: { x: 500, y: 100 } }, proofs })
    assertContact(moved)
    expect(tryApplyPropUpdateCompositionTransaction(certifyCompositionContent(moved), [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 7000, y: 6500 } } }])).toBeUndefined()
    expect(() => applyCompositionDraftCommands(moved, [{ type: 'updateProp', id: 'other', changes: { positionMm: { x: 9000, y: 9000 } } }], runtime)).toThrow(/完整旋转占地/)
    expect(moved.document.props.other.positionMm).toEqual({ x: 6500, y: 6100 })
    expect(attached.document.props.other.positionMm).toEqual({ x: 6200, y: 6000 })
  })

  it('adopts full related changes, rejects an invalid move atomically, restores local edits and cold-reads the actual saved state', async () => {
    const { repository, workspace, owner } = await workspaceSetup()
    await workspace.execute([surface]); await workspace.execute([bind])
    const proofs = cloneJson(workspace.getDocument()!.attachments!['on-table'].proofs)
    await workspace.updateProp('item', { positionMm: { x: 7000, y: 6500 }, rotationDeg: 90 })
    expect(workspace.getDocument()!.props.other).toMatchObject({ positionMm: { x: 7000, y: 6700 }, rotationDeg: 90 })
    await workspace.updateProp('other', { positionMm: { x: 6900, y: 7000 } })
    expect(workspace.getDocument()!.attachments!['on-table'].anchor).toMatchObject({ localMm: { x: 500, y: 100 } })
    const checkpoint = workspace.checkpoint(), revision = workspace.getDocument()!.revision
    await expect(workspace.updateProp('other', { positionMm: { x: 10000, y: 10000 } })).rejects.toThrow(/完整旋转占地/)
    expect(workspace.checkpoint()).toBe(checkpoint)
    workspace.undo()
    expect(workspace.getDocument()!).toMatchObject({ revision: revision + 1, props: { other: { positionMm: { x: 7000, y: 6700 } } } })
    workspace.redo()
    expect(workspace.getDocument()!).toMatchObject({ revision: revision + 2, props: { other: { positionMm: { x: 6900, y: 7000 } } } })
    expect(workspace.getDocument()!.attachments!['on-table'].proofs).toEqual(proofs)
    assertContact(content(workspace.getState().project!))
    await workspace.flush()
    const cold = (await repository.load(owner))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(cold.project.historyIdentity).toEqual(workspace.getState().project!.historyIdentity)
    assertContact(content(cold.project))
    const invalid = { ...cold, project: cloneJson(cold.project) }
    const invalidRelation = invalid.project.document.attachments!['on-table']
    if (invalidRelation.mode === 'embed') throw new Error('Expected the actual Prop relation')
    invalidRelation.materialized.childGeometryHash = '0'.repeat(64)
    await expect(fromBundle(invalid, validation)).rejects.toThrow(/附着|结果|哈希/)
  })

  it('undoes and redoes attachment birth without reusing a retired relation identity', async () => {
    const { workspace } = await workspaceSetup()
    await workspace.execute([surface]); await workspace.execute([bind])
    const original = cloneJson(workspace.getState().project!.historyIdentity.structureTokens!['on-table'])
    workspace.undo()
    expect(workspace.getDocument()!.attachments?.['on-table']).toBeUndefined()
    expect(workspace.getState().project!.historyIdentity.structureTokens!['on-table']).toEqual(original)
    workspace.redo()
    assertContact(content(workspace.getState().project!))
    const restored = workspace.getState().project!.historyIdentity.structureTokens!['on-table']
    expect(restored.token).toBe(original.token)
    expect(restored.topologyToken).not.toBe(original.topologyToken)
  })

  it('deletes only the chosen table or the group and preserves attached props outside the selected deletion', async () => {
    const { workspace } = await workspaceSetup({ image: true })
    await workspace.execute([{ type: 'createPrefab', id: 'dinner', definitionId: 'dinner-source', name: '宴席', ids: ['item'], anchorMm: { x: 6000, y: 6000 } }])
    await workspace.execute([surface, bind])
    const before = workspace.getDocument()!
    const tableOnly = await workspace.preview([{ type: 'deleteProp', id: 'item' }])
    expect(tableOnly.document.props.other).toEqual(before.props.other)
    expect(tableOnly.document.props.item).toBeUndefined()
    expect(tableOnly.document.prefabInstances.dinner).toBeDefined()
    expect(tableOnly.document.attachments?.['on-table']).toBeUndefined()
    expect(tableOnly.document.attachmentSurfaces?.['table-top']).toBeUndefined()
    expect(workspace.getDocument()).toBe(before)
    workspace.cancelPreview(tableOnly)
    await workspace.execute([{ type: 'deletePrefab', id: 'dinner', memberIds: ['item'] }])
    expect(workspace.getDocument()!.prefabInstances.dinner).toBeUndefined()
    expect(workspace.getDocument()!.props.other).toEqual(before.props.other)
    workspace.undo()
    expect(workspace.getDocument()!.prefabInstances.dinner).toEqual(before.prefabInstances.dinner)
    assertContact(content(workspace.getState().project!))
  })

  it('carries a locked lamp by its unchanged anchor when the complete host wall is translated', () => {
    const { project } = fixture({ building: true })
    const document = project.document
    document.props.other.supportRef = { kind: 'room', id: 'room' }
    document.props.other.roomId = 'room'
    const source = createCompositionContent(document, runtime)
    const attached = applyCompositionDraftCommands(source, [
      { type: 'addAttachmentSurface', id: 'wall-face', owner: { kind: 'wall', id: 'wall-0' },
        feature: { kind: 'wallSide', referenceVertexId: 'vertex-0', side: 'left', startMm: 0, endMm: 7000, lowMm: 0, highMm: 3000 }, capabilities: ['hang'] },
      { type: 'bindPropAttachment', id: 'wall-lamp', childId: 'other', surfaceId: 'wall-face', mode: 'hang', follow: 'follow', anchorState: 'manual',
        anchor: { kind: 'vertical', referenceVertexId: 'vertex-0', alongMm: 2000, heightMm: 1800, heightExtentMm: 400, normalOffsetMm: 100, rotationOffsetDeg: 0 } },
    ], runtime)
    const locked = applyCompositionDraftCommands(attached, [{ type: 'setEditLock', id: 'other', kind: 'prop', locked: true }], runtime)
    const anchor = locked.document.attachments!['wall-lamp'].anchor
    const moved = applyCompositionDraftCommands(locked, [{ type: 'translateWall', id: 'wall-0', offsetMm: { x: 0, y: 1000 } }], runtime)
    expect(moved.document.props.other).toMatchObject({ positionMm: { x: 5000, y: 4200 }, editLocked: true })
    expect(moved.document.attachments!['wall-lamp'].anchor).toEqual(anchor)
    expect(validateAttachmentProofs(moved.document, moved.historyIdentity)).toEqual([])
    expect(() => applyCompositionDraftCommands(moved, [{ type: 'updateProp', id: 'other', changes: { positionMm: { x: 5100, y: 4200 } } }], runtime)).toThrow(/锁定/)
  })

  it('restores a surface and relation through separate undo steps with current surface continuity', async () => {
    const { workspace } = await workspaceSetup()
    await workspace.execute([surface]); await workspace.execute([bind])
    const originalSurface = cloneJson(workspace.getState().project!.historyIdentity.structureTokens!['table-top'])
    workspace.undo(); workspace.undo()
    expect(workspace.getDocument()!.attachmentSurfaces?.['table-top']).toBeUndefined()
    expect(workspace.getDocument()!.attachments?.['on-table']).toBeUndefined()
    workspace.redo()
    const restoredSurface = workspace.getState().project!.historyIdentity.structureTokens!['table-top']
    expect(restoredSurface.token).toBe(originalSurface.token)
    expect(restoredSurface.topologyToken).not.toBe(originalSurface.topologyToken)
    workspace.redo()
    assertContact(content(workspace.getState().project!))
    expect(workspace.getDocument()!.attachments!['on-table'].proofs.surfaces[0].topologyToken).toBe(restoredSurface.topologyToken)
  })
})
