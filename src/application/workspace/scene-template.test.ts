import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareSceneTemplate, loadSceneTemplate, inspectSceneTemplate } from '../../shared/scene-templates/content.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { applyCompositionDraftCommands } from '../../shared/appearance/commands.js'
import { resolvePropContact } from '../../shared/attachments/contact.js'
import { canonicalJson } from '../../shared/validation/json.js'
import { projectScene } from '../../shared/projection/projection.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fromBundle, toBundle } from './project.js'
import { fixture, runtime, validation, pixelPng } from './test-fixtures.js'
import { Workspace } from './workspace.js'
import { prepareCompositionCommands } from './prepare.js'
import { exportProject } from '../../shared/project/file.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { assessSceneTemplatePlacement } from '../../shared/scene-templates/placement-budget.js'
import { largerBuildingTemplate } from '../../../tests/scene-template-budget-fixtures.js'
import type { SceneTemplatePreparationProgress } from '../../shared/scene-templates/content.js'

const options = { validation, runtime }, opened: { workspace: Workspace; repository: ProjectRepository }[] = []
afterEach(async () => { for (const { workspace, repository } of opened.splice(0)) { await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name) } })
function source() {
  const input = fixture({ building: true, image: true }), scene = input.project.document
  Object.assign(scene.props.item, { positionMm: { x: 4500, y: 4500 }, roomId: 'room', supportRef: { kind: 'room', id: 'room' } })
  scene.props.other.positionMm = { x: 16000, y: 16000 }
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'closed', locked: true, secret: true, revealed: false }
  scene.notes.clue = { id: 'clue', floorId: 'blank-floor', editLocked: false, kind: 'clue', title: 'GM only', text: 'a private clue', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' } }
  scene.entityLayers.door = scene.entityLayers.room; scene.entityLayers.clue = scene.entityLayers.room
  Object.assign(input.project, createCompositionContent(scene, runtime))
  return input
}
const placement = { floorId: 'blank-floor', layerId: 'layer-default-0', supportRef: { kind: 'floor' as const, id: 'blank-floor' }, anchorMm: { x: 12000, y: 3000 }, quarterTurns: 1 as const }

describe('cross-project complete room templates', () => {
  it('copies tabletop support with fresh proofs through a rotated placement, cold storage and a subsequent move', async () => {
    const original = source(), doc = original.project.document
    Object.assign(doc.props.item, { footprintMm: { width: 1200, height: 1000 }, footprintOffsetMm: { x: 0, y: 0 }, rotationDeg: 0 })
    Object.assign(doc.props.other, { positionMm: { x: 4700, y: 4500 }, footprintMm: { width: 240, height: 200 }, footprintOffsetMm: { x: 0, y: 0 },
      blocksMovement: false, supportRef: { kind: 'room', id: 'room' }, roomId: 'room', visibility: 'gm' })
    doc.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false, boundaryMm: [{ x: 3500, y: 3500 }, { x: 5500, y: 3500 }, { x: 5500, y: 5500 }, { x: 3500, y: 5500 }], kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm' }
    doc.entityLayers.mask = doc.entityLayers.room
    Object.assign(original.project, applyCompositionDraftCommands(createCompositionContent(doc, runtime), [
      { type: 'addAttachmentSurface', id: 'tabletop', owner: { kind: 'prop', id: 'item' }, capabilities: ['support'],
        feature: { kind: 'propTop', heightLocalMm: 800, polygonLocalMm: [{ x: -500, y: -400 }, { x: 500, y: -400 }, { x: 500, y: 400 }, { x: -500, y: 400 }] } },
      { type: 'bindPropAttachment', id: 'lamp-support', childId: 'other', surfaceId: 'tabletop', mode: 'support', follow: 'follow', anchorState: 'manual',
        anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } },
    ], runtime))
    const request = { name: '带桌灯的书房', roomIds: ['room'], maskIds: ['mask'] }, before = canonicalJson(original.project)
    expect(inspectSceneTemplate(original.project.document, request)).toMatchObject({ attachmentSurfaceIds: ['tabletop'], attachmentIds: ['lamp-support'] })
    const entry = await prepareSceneTemplate(original, request, options), capsule = await loadSceneTemplate(entry.bytes, validation)
    const capturedLink = Object.values(capsule.project.document.attachments!)[0]
    expect(capturedLink.id).not.toBe('lamp-support')
    expect(capturedLink.proofs.lineageId).toBe(capsule.project.historyIdentity.lineageId)
    expect(canonicalJson(original.project)).toBe(before)

    const repository = new ProjectRepository({ name: `scene-template-attachment-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const baseline = workspace.getState().project!
    const candidate = await workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId: baseline.document.entityLayers.item })
    await workspace.adoptPreview(candidate.preview)
    const placed = workspace.getState().project!, link = Object.values(placed.document.attachments!)[0], surface = placed.document.attachmentSurfaces![link.mode === 'embed' ? '' : link.surfaceId]
    const host = placed.document.props[surface.owner.id], child = placed.document.props[link.child.id]
    expect(candidate.addedIds).toEqual(expect.arrayContaining([surface.id, link.id]))
    expect(link.id).not.toBe(capturedLink.id)
    expect(link.proofs.child.birthToken).toBe(placed.historyIdentity.propTokens[child.id])
    expect(link.proofs.surfaces[0].birthToken).toBe(placed.historyIdentity.structureTokens![surface.id].token)
    expect(surface.proofs.owner.birthToken).toBe(placed.historyIdentity.propTokens[host.id])
    expect(child.positionMm).toEqual({ x: host.positionMm.x, y: host.positionMm.y + 200 })
    expect(resolvePropContact(placed.document, child.id)).toMatchObject({ contactElevationMm: 800, actualSurfaceId: surface.id })
    expect(canonicalJson(projectScene(placed.document, 'player'))).not.toContain(child.id)
    workspace.undo(); expect(workspace.getState().project!.document.attachments).toBeUndefined()
    workspace.redo(); await workspace.flush()
    const cold = (await repository.load(placed.document.sceneId))!.project
    expect(cold.document.attachments).toEqual(workspace.getState().project!.document.attachments)
    expect(cold.document.attachments![link.id].proofs.surfaces[0].topologyToken).toBe(cold.historyIdentity.structureTokens![surface.id].topologyToken)
    expect(cold.document.attachments![link.id].anchor).toEqual(link.anchor)

    await workspace.execute([{ type: 'updateProp', id: host.id, changes: { positionMm: { x: host.positionMm.x - 350, y: host.positionMm.y }, rotationDeg: 180 } }])
    const moved = workspace.getState().project!.document
    expect(moved.props[child.id].positionMm).toEqual({ x: host.positionMm.x - 550, y: host.positionMm.y })
    expect(resolvePropContact(moved, child.id).contactElevationMm).toBe(800)
  })

  it('extracts assigned room props, reserving footprint selection for floor props already stored in older templates', async () => {
    const input = source(), scene = input.project.document
    scene.props.other.positionMm = { x: 6000, y: 6000 }
    const request = { name: 'Room contents', roomIds: ['room'] }
    expect(inspectSceneTemplate(scene, request).propIds).toEqual(['item'])
    const entry = await prepareSceneTemplate(input, request, options), stored = await loadSceneTemplate(entry.bytes, validation)
    expect(Object.values(stored.project.document.props)).toHaveLength(1)
    const legacy = structuredClone(stored.project), doc = legacy.document, prop = Object.values(doc.props)[0]
    delete prop.roomId
    prop.supportRef = { kind: 'floor', id: prop.floorId }
    const reopen = async () => loadSceneTemplate(await exportProject({ project: legacy, resources: stored.resources }, validation), validation)
    expect((await reopen()).project.document.props[prop.id]).toEqual(prop)
    prop.positionMm = { x: 1000, y: 1000 }
    await expect(reopen()).rejects.toThrow(/范围外/)
  })

  it('keeps actual geometry/openings/current furniture, excludes unrelated metadata, and supports one cancel/adopt/undo/redo/save/cold-read transaction', async () => {
    const original = source(), before = canonicalJson(original.project)
    const entry = await prepareSceneTemplate(original, { name: '客房', roomIds: ['room'], noteIds: ['clue'] }, options)
    expect(canonicalJson(original.project)).toBe(before)
    const template = await loadSceneTemplate(entry.bytes, validation), contents = template.project.document
    expect(Object.keys(contents.rooms)).toHaveLength(1); expect(Object.keys(contents.walls)).toHaveLength(4)
    expect(Object.keys(contents.props)).toHaveLength(1); expect(Object.keys(contents.notes)).toHaveLength(1)
    expect(contents.sceneId).not.toBe(original.project.document.sceneId)
    expect(canonicalJson(template.project)).not.toContain(original.project.historyIdentity.lineageId)
    const repository = new ProjectRepository({ name: `scene-template-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const baseline = workspace.getState().project!, target = { ...placement, layerId: baseline.document.entityLayers.item }
    const cancelled = await workspace.previewSceneTemplate(entry.bytes, target)
    expect(workspace.getState().project).toBe(baseline); workspace.cancelPreview(cancelled.preview)
    await expect(workspace.adoptPreview(cancelled.preview)).rejects.toThrow()
    const candidate = await workspace.previewSceneTemplate(entry.bytes, target)
    await workspace.adoptPreview(candidate.preview)
    const adopted = workspace.getState().project!, room = Object.values(adopted.document.rooms)[0], door = Object.values(adopted.document.openings)[0]
    expect(room.supportRef).toEqual(target.supportRef); expect(room.floorId).toBe(target.floorId)
    expect(door).toMatchObject({ kind: 'door', state: 'closed', locked: true, secret: true, revealed: false, offsetMm: 1000, widthMm: 1200 })
    expect(adopted.document.props.item).toEqual(baseline.document.props.item)
    const copied = Object.values(adopted.document.props).find(prop => !baseline.document.props[prop.id])!
    expect(copied.positionMm).toEqual({ x: 10500, y: 4500 })
    expect(copied.supportRef).toEqual({ kind: 'room', id: room.id })
    expect(adopted.historyIdentity.propTokens[copied.id]).not.toBe(original.project.historyIdentity.propTokens.item)
    expect(adopted.historyIdentity.structureTokens![room.id].token).not.toBe(original.project.historyIdentity.structureTokens!.room.token)
    expect(canonicalJson(projectScene(adopted.document, 'player'))).not.toContain('a private clue')
    expect(adopted.document.revision).toBe(baseline.document.revision + 1)
    workspace.undo(); expect(workspace.getState().project!.document.rooms).toEqual({})
    workspace.redo(); await workspace.flush()
    const cold = await repository.load(adopted.document.sceneId)
    expect(cold!.project.document.rooms).toEqual(adopted.document.rooms)
    expect(cold!.project.document.props).toEqual(adopted.document.props)
    expect(toBundle(workspace.getState().project!).project.appearance).toEqual(cold!.project.appearance)
  })
  it('rejects locked/partial scopes and leaves the source unchanged', async () => {
    const input = source(), scene = input.project.document
    scene.userLayers[scene.entityLayers.room].editLocked = true
    expect(() => inspectSceneTemplate(scene, { name: 'locked', roomIds: ['room'] })).toThrow(/锁/)
    scene.userLayers[scene.entityLayers.room].editLocked = false
    expect(() => inspectSceneTemplate(scene, { name: 'external anchor', roomIds: ['room'], noteIds: ['missing'] })).toThrow(/注记/)
    scene.paths.path = { id: 'path', floorId: 'blank-floor', editLocked: false, centerlineMm: [{ x: 4000, y: 7000 }, { x: 7000, y: 7000 }], widthMm: 400, supportRefs: [{ kind: 'room', id: 'room' }], surfaceStyle: null, visibility: 'public', movementCostMultiplier: 1, renderOrder: 0 }
    expect(() => inspectSceneTemplate(scene, { name: 'path', roomIds: ['room'] })).toThrow(/路径/)
  })
  it('rejects corrupt files, target locks, invalid geometry, cancellation and stale previews without adopting anything', async () => {
    const entry = await prepareSceneTemplate(source(), { name: '客房', roomIds: ['room'] }, options)
    await expect(loadSceneTemplate(entry.bytes.subarray(0, 64), validation)).rejects.toThrow()
    const repository = new ProjectRepository({ name: `scene-template-failure-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const baseline = workspace.getState().project!, target = { ...placement, layerId: baseline.document.entityLayers.item }
    await expect(workspace.previewSceneTemplate(entry.bytes, { ...target, anchorMm: { x: -1000000, y: -1000000 } })).rejects.toThrow()
    expect(workspace.getState().project).toBe(baseline)
    const controller = new AbortController(); controller.abort()
    await expect(workspace.previewSceneTemplate(entry.bytes, target, { signal: controller.signal })).rejects.toThrow()
    const candidate = await workspace.previewSceneTemplate(entry.bytes, target)
    await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 17 } }])
    await expect(workspace.adoptPreview(candidate.preview)).rejects.toThrow()
    expect(Object.keys(workspace.getState().project!.document.rooms)).toHaveLength(0)
  })
  it('requires complete shared-wall ownership and retains a whole two-room building with one actual common wall', async () => {
    let project = await fromBundle(source(), validation)
    project = await prepareCompositionCommands(project, [{ type: 'createRoom', id: 'second', floorId: 'blank-floor', layerId: project.document.entityLayers.room, thicknessMm: 200,
      boundaryMm: [{ x: 10000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 10000 }, { x: 10000, y: 10000 }], purpose: '储藏间' }], options)
    await expect(prepareSceneTemplate(toBundle(project), { name: 'partial', roomIds: ['room'] }, options)).rejects.toThrow(/共墙/)
    const entry = await prepareSceneTemplate(toBundle(project), { name: '完整建筑', roomIds: ['room', 'second'] }, options), template = await loadSceneTemplate(entry.bytes, validation)
    expect(Object.keys(template.project.document.rooms)).toHaveLength(2)
    expect(Object.keys(template.project.document.walls)).toHaveLength(7)
    expect(Object.keys(template.project.document.openings)).toHaveLength(1)
  })
  it('rejects a locked destination and collision with existing blocking furniture, preserving both projects', async () => {
    const original = source(), unchanged = canonicalJson(original.project)
    const entry = await prepareSceneTemplate(original, { name: '客房', roomIds: ['room'] }, options)
    const repository = new ProjectRepository({ name: `scene-template-lock-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace })
    const locked = fixture(), layerId = locked.project.document.entityLayers.item
    locked.project.document.userLayers[layerId].editLocked = true
    await workspace.adoptNew(await fromBundle(locked, validation))
    const baseline = workspace.getState().project!
    await expect(workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId })).rejects.toThrow(/锁/)
    expect(workspace.getState().project).toBe(baseline)
    const obstructed = fixture()
    Object.assign(obstructed.project.document.props.other, { positionMm: { x: 12000, y: 5000 }, blocksMovement: true })
    await workspace.adoptNew(await fromBundle(obstructed, validation))
    const before = workspace.getState().project!
    await expect(workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId })).rejects.toThrow(/冲突/)
    expect(workspace.getState().project).toBe(before)
    expect(canonicalJson(original.project)).toBe(unchanged)
  })
  it('freezes effective appearance across destination layer rules and rejects fixed-definition collisions', async () => {
    let project = await fromBundle(source(), validation)
    project = await prepareCompositionCommands(project, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] }, adjustment: { id: 'source-opacity', kind: 'opacity', enabled: true, value: .6 } }], options)
    const entry = await prepareSceneTemplate(toBundle(project), { name: '有效外观', roomIds: ['room'] }, options)
    const repository = new ProjectRepository({ name: `scene-template-appearance-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const layerId = workspace.getState().project!.document.entityLayers.item
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId }, adjustment: { id: 'destination-opacity', kind: 'opacity', enabled: true, value: .2 } }])
    const baseline = workspace.getState().project!, result = await workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId })
    const copy = Object.values(result.preview.document.props).find(prop => !baseline.document.props[prop.id])!
    expect(copy.appearance.opacity).toBe(.6); expect(result.preview.document.props.item.appearance.opacity).toBe(.2)
    const conflicting = fixture({ image: true }); conflicting.project.document.propDefinitions.definition.name = 'different fixed definition'
    await workspace.adoptNew(await fromBundle(conflicting, validation))
    const before = workspace.getState().project!
    await expect(workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId: before.document.entityLayers.item })).rejects.toThrow(/固定|冲突/)
    expect(workspace.getState().project).toBe(before)
  })
  it('rejects a masquerading full project and explicitly carries only selected private masks and annotations', async () => {
    const input = source(), scene = input.project.document
    scene.props.item.visibility = 'gm'
    scene.regions.mask = { id: 'mask', floorId: 'blank-floor', editLocked: false, boundaryMm: [{ x: 3900, y: 3900 }, { x: 5100, y: 3900 }, { x: 5100, y: 5100 }, { x: 3900, y: 5100 }], kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm' }
    scene.entityLayers.mask = scene.entityLayers.room
    Object.assign(input.project, createCompositionContent(scene, runtime))
    await expect(prepareSceneTemplate(input, { name: 'missing mask', roomIds: ['room'] }, options)).rejects.toThrow(/遮罩/)
    const entry = await prepareSceneTemplate(input, { name: '私密客房', roomIds: ['room'], maskIds: ['mask'], noteIds: ['clue'] }, options)
    const loaded = await loadSceneTemplate(entry.bytes, validation)
    expect(Object.values(loaded.project.document.props)[0].visibility).toBe('gm')
    const output = canonicalJson(projectScene(loaded.project.document, 'player'))
    expect(output).not.toContain('a private clue'); expect(output).not.toContain('image')
    const fake = structuredClone(loaded.project); fake.document.presetSnapshot.source = 'source project secret metadata'
    await expect(loadSceneTemplate(await exportProject({ project: fake, resources: loaded.resources }, validation), validation)).rejects.toThrow(/元数据/)
  })
  it('edits one of two placed instances without changing the other instance or the source template', async () => {
    const input = source(), original = canonicalJson(input.project)
    const entry = await prepareSceneTemplate(input, { name: '客房', roomIds: ['room'] }, options), bytes = entry.bytes.slice()
    const repository = new ProjectRepository({ name: `scene-template-independent-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const initial = workspace.getState().project!, layerId = initial.document.entityLayers.item
    const first = await workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId })
    await workspace.adoptPreview(first.preview)
    const a = workspace.getState().project!, propA = Object.values(a.document.props).find(prop => !initial.document.props[prop.id])!
    const second = await workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId, anchorMm: { x: 12000, y: 12000 } })
    await workspace.adoptPreview(second.preview)
    const b = workspace.getState().project!, propB = Object.values(b.document.props).find(prop => !a.document.props[prop.id])!
    expect(b.historyIdentity.propTokens[propA.id]).not.toBe(b.historyIdentity.propTokens[propB.id])
    await workspace.execute([{ type: 'updateProp', id: propA.id, changes: { rotationDeg: 31 } }])
    expect(workspace.getState().project!.document.props[propB.id]).toEqual(propB)
    expect(workspace.getState().project!.document.props[propA.id].rotationDeg).toBe(31)
    expect(canonicalJson(input.project)).toBe(original); expect(entry.bytes).toEqual(bytes)
    await workspace.flush()
    const cold = await repository.load(b.document.sceneId)
    expect(cold!.project.document.props[propB.id]).toEqual(propB)
    expect(cold!.project.document.props[propA.id].rotationDeg).toBe(31)
  })
  it('admits more than 256 actual targets in one registered transaction, and undoes all of them together', async () => {
    const input = source(), scene = input.project.document
    for (let n = 0; n < 260; n++) {
      const id = `extra-${n}`
      scene.props[id] = { ...structuredClone(scene.props.item), id }
      scene.entityLayers[id] = scene.entityLayers.item
    }
    Object.assign(input.project, createCompositionContent(scene, runtime))
    const entry = await prepareSceneTemplate(input, { name: '大范围模板', roomIds: ['room'] }, options)
    const repository = new ProjectRepository({ name: `scene-template-budget-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const before = workspace.getState().project!
    const stages: SceneTemplatePreparationProgress[] = []
    const result = await workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId: before.document.entityLayers.item }, { onProgress: progress => stages.push(progress), cooperate: async () => {} })
    expect(result.operationCost).toBeGreaterThan(256)
    expect(result.preview.budgetProfile!.semanticTargets).toBeGreaterThanOrEqual(result.operationCost)
    expect(result.preview.budgetUsage!.metadataRecords).toBeGreaterThan(result.operationCost)
    expect(stages.filter(stage => stage.profile).every(stage => stage.profile === result.preview.budgetProfile)).toBe(true)
    expect(stages.some(stage => stage.stage === 'placing' && stage.completed === 32)).toBe(true)
    expect(workspace.getState().project).toBe(before)
    await workspace.adoptPreview(result.preview)
    expect(Object.keys(workspace.getState().project!.document.props)).toHaveLength(263)
    workspace.undo(); expect(workspace.getState().project!.document.props).toEqual(before.document.props)
    workspace.redo(); await workspace.flush()
    expect(Object.keys((await repository.load(before.document.sceneId))!.project.document.props)).toHaveLength(263)
  })
  it('rejects over 1024 actual targets during assessment without creating identities or partial resources', async () => {
    const input = source(), scene = input.project.document
    for (let n = 0; n < 1030; n++) { const id = `over-${n}`; scene.props[id] = { ...structuredClone(scene.props.item), id }; scene.entityLayers[id] = scene.entityLayers.item }
    Object.assign(input.project, createCompositionContent(scene, runtime))
    const entry = await prepareSceneTemplate(input, { name: '超出范围', roomIds: ['room'] }, options)
    let identities = 0
    const observedRuntime = { ...runtime, ids: { nextId: () => { identities++; return runtime.ids.nextId() } } }
    const repository = new ProjectRepository({ name: `template-over-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, { ...options, runtime: observedRuntime })
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const before = workspace.getState().project!, beforeIds = identities
    await expect(workspace.previewSceneTemplate(entry.bytes, { ...placement, layerId: before.document.entityLayers.item })).rejects.toThrow(/semanticTargets/)
    expect(identities).toBe(beforeIds); expect(workspace.getState().project).toBe(before); expect(workspace.getState().canUndo).toBe(false)
  // The full 1030-prop source and resource validation takes over 5s on Windows.
  }, 25000)
  it('cancels midway through transformed content and detects a changed baseline at a cooperative boundary', async () => {
    const input = source(), scene = input.project.document
    for (let n = 0; n < 80; n++) { const id = `cancel-${n}`; scene.props[id] = { ...structuredClone(scene.props.item), id }; scene.entityLayers[id] = scene.entityLayers.item }
    Object.assign(input.project, createCompositionContent(scene, runtime))
    const entry = await prepareSceneTemplate(input, { name: '分段取消', roomIds: ['room'] }, options)
    const repository = new ProjectRepository({ name: `template-cancel-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const before = workspace.getState().project!, target = { ...placement, layerId: before.document.entityLayers.item }, controller = new AbortController()
    await expect(workspace.previewSceneTemplate(entry.bytes, target, { signal: controller.signal, onProgress: p => { if (p.stage === 'placing' && p.completed >= 32) controller.abort() }, cooperate: async () => {} })).rejects.toThrow(/取消/)
    expect(workspace.getState().project).toBe(before); expect(workspace.getState().canUndo).toBe(false)
    let mutate = false, changed = false
    await expect(workspace.previewSceneTemplate(entry.bytes, target, { onProgress: p => { mutate = p.stage === 'placing' }, cooperate: async () => {
      if (mutate && !changed) { changed = true; await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 29 } }]) }
    } })).rejects.toThrow()
    expect(changed).toBe(true); expect(Object.keys(workspace.getState().project!.document.rooms)).toHaveLength(0)
    expect(workspace.getState().project!.document.props.other.rotationDeg).toBe(29)
  })
  it('meters actual distinct images and keeps reused resources from being charged as extra edit targets', async () => {
    const input = source(), scene = input.project.document, images = new Map<string, Uint8Array>()
    for (let n = 0; n < 24; n++) {
      const id = `image-${n}`, definitionId = `definition-${n}`, propId = `furniture-${n}`, bytes = pixelPng([n * 9, 100, 50, 255]), hash = sha256Bytes(bytes)
      images.set(hash, bytes)
      scene.assets[id] = { ...structuredClone(scene.assets.image), id, sha256: hash }
      scene.propDefinitions[definitionId] = { ...structuredClone(scene.propDefinitions.definition), id: definitionId, catalogId: `test.native-workspace.${n}`, defaultAppearance: { kind: 'image', assetId: id, tint: null, opacity: 1 } }
      scene.props[propId] = { ...structuredClone(scene.props.item), id: propId, definitionRef: { id: definitionId, version: 1 }, appearance: { kind: 'image', assetId: id, tint: null, opacity: 1 } }
      scene.entityLayers[propId] = scene.entityLayers.item
      input.project.assets[hash] = { sha256: hash, sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1, mimeType: 'image/png' }
    }
    for (const hash of Object.keys(input.project.assets)) if (!images.has(hash)) images.set(hash, await input.resources.read(hash))
    input.resources = createMemoryResources(images)
    Object.assign(input.project, createCompositionContent(scene, runtime))
    const binding = input.project.licenseBindings[0]
    input.project.licenseBindings = inspectDependencies(scene).subjects.map(subject => ({ ...subject, licensePath: binding.licensePath, embedding: 'allowed' }))
    const entry = await prepareSceneTemplate(input, { name: '多资源客房', roomIds: ['room'] }, options)
    const repository = new ProjectRepository({ name: `template-images-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const before = workspace.getState().project!, target = { ...placement, layerId: before.document.entityLayers.item }
    const first = await workspace.previewSceneTemplate(entry.bytes, target)
    expect(first.preview.budgetUsage!.decodePixels).toBe(25)
    expect(first.preview.budgetUsage!.assetBytes).toBe([...images.values()].reduce((sum, bytes) => sum + bytes.length, 0))
    await workspace.adoptPreview(first.preview)
    const second = await workspace.previewSceneTemplate(entry.bytes, { ...target, anchorMm: { x: 12000, y: 12000 } })
    expect(second.operationCost).toBe(first.operationCost)
    expect(second.preview.budgetUsage!.assetBytes).toBe(first.preview.budgetUsage!.assetBytes)
    expect(second.preview.budgetUsage!.metadataBytes).toBeLessThan(first.preview.budgetUsage!.metadataBytes)
    expect(Object.keys(second.preview.project.assets)).toHaveLength(25)
    workspace.cancelPreview(second.preview)
  })

  it('places a larger sixteen-room shared-wall building with 576 furniture instances under one expanded budget', async () => {
    const entry = await largerBuildingTemplate(), targetBundle = fixture()
    targetBundle.project.document.exportBoundsMm.width = targetBundle.project.document.exportBoundsMm.height = 60000
    targetBundle.project.document.floors['blank-floor'].boundsMm.width = targetBundle.project.document.floors['blank-floor'].boundsMm.height = 60000
    Object.assign(targetBundle.project, createCompositionContent(targetBundle.project.document, runtime))
    const repository = new ProjectRepository({ name: `template-large-building-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(targetBundle, validation))
    const before = workspace.getState().project!
    const result = await workspace.previewSceneTemplate(entry.bytes, { ...placement, quarterTurns: 0, anchorMm: { x: 2000, y: 2000 }, layerId: before.document.entityLayers.item })
    expect(result.preview.budgetProfile!.tierId).toBe('expanded')
    expect(result.operationCost).toBe(632)
    expect(Object.keys(result.preview.document.rooms)).toHaveLength(16)
    expect(Object.keys(result.preview.document.walls)).toHaveLength(40)
    await workspace.adoptPreview(result.preview); workspace.undo()
    expect(workspace.getState().project!.document.rooms).toEqual(before.document.rooms)
    workspace.redo(); await workspace.flush()
    expect(Object.keys((await repository.load(before.document.sceneId))!.project.document.props)).toHaveLength(578)
  })
  it('selects a larger tier for dense geometry with few targets and rejects excessive geometric work atomically', async () => {
    const build = async (sides: number) => {
      const input = source(), scene = input.project.document
      const boundaryMm = Array.from({ length: sides * 4 }, (_, i) => {
        const t = i % sides / sides, side = Math.floor(i / sides)
        return { x: Math.round(3500 + (side === 0 ? t : side === 1 ? 1 : side === 2 ? 1 - t : 0) * 6000), y: Math.round(3500 + (side === 0 ? 0 : side === 1 ? t : side === 2 ? 1 : 1 - t) * 6000) }
      })
      for (let i = 0; i < 32; i++) { const id = `dense-mask-${i}`; scene.regions[id] = { id, floorId: 'blank-floor', editLocked: false, boundaryMm, kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm' }; scene.entityLayers[id] = scene.entityLayers.room }
      Object.assign(input.project, createCompositionContent(scene, runtime))
      return prepareSceneTemplate(input, { name: '密集轮廓', roomIds: ['room'], maskIds: Object.keys(scene.regions) }, options)
    }
    const entry = await build(16)
    const repository = new ProjectRepository({ name: `template-geometry-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
    opened.push({ repository, workspace }); await workspace.adoptNew(await fromBundle(fixture(), validation))
    const before = workspace.getState().project!, target = { ...placement, layerId: before.document.entityLayers.item }
    const preview = await workspace.previewSceneTemplate(entry.bytes, target)
    expect(preview.operationCost).toBeLessThan(256)
    expect(preview.preview.budgetProfile!.semanticTargets).toBeGreaterThan(256)
    expect(preview.preview.budgetUsage!.geometryPoints).toBeGreaterThan(2000)
    workspace.cancelPreview(preview.preview)
    // Isolate policy arithmetic for a very large valid-shaped ring; repeatedly
    // running the complete pixel/projection path here would measure unrelated
    // mask composition. The full executor's actual target-overflow is above.
    const excessive = structuredClone((await loadSceneTemplate(entry.bytes, validation)).project)
    for (const region of Object.values(excessive.document.regions)) region.boundaryMm = Array.from({ length: 1024 }, (_, i) => {
      const side = Math.floor(i / 256), t = i % 256 / 256
      return { x: Math.round(5500 + (side === 0 ? t : side === 1 ? 1 : side === 2 ? 1 - t : 0) * 6000), y: Math.round(5500 + (side === 0 ? 0 : side === 1 ? t : side === 2 ? 1 : 1 - t) * 6000) }
    })
    expect(() => assessSceneTemplatePlacement(toBundle(before).project, excessive)).toThrow(/intersectionPairs|geometryPoints/)
    expect(workspace.getState().project).toBe(before); expect(workspace.getState().canUndo).toBe(false)
  })

})
