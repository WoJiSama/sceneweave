import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../commands/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import type { CompositionContent } from '../model/appearance.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { structureIdentityDescriptors } from '../history/structure-identity.js'
import { resolveBuildingStructurePort } from '../generation/building-port.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateCompositionContent } from '../validation/content.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { pathAttachmentSchema } from './contracts.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { createPathAttachmentPlan, followPathAttachments, rebindPathAttachmentProofs, validatePathAttachmentGeometry, validatePathAttachmentProofs, type AttachmentScene } from './state.js'

const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, width: number, height: number) => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
let sequence = 0
const runtime = () => ({ clock: { now: () => '2026-11-10T00:00:00.000Z' }, ids: { nextId: () => `persistent-attachment-${++sequence}` } })
function fixture() {
  const source = createShoreBlankDocument('island', { sceneId: 'ordinary-persistent-door-road', title: '普通门路关系', now: '2026-11-10T00:00:00.000Z', widthMm: 40000, heightMm: 40000, preset: 'narrative' })
  let scene = applyCommands(source, [
    { type: 'createTerrainArea', id: 'ground', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(0, 0, 40000, 40000), groundElevationMm: 1200, coveragePriority: 0 },
    { type: 'createRoom', id: 'room', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundaryMm: rect(12000, 12000, 6000, 6000), thicknessMm: 400, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime())
  const wall = Object.values(scene.walls).find(row => scene.vertices[row.startVertexId].yMm === 12000 && scene.vertices[row.endVertexId].yMm === 12000)!
  scene = applyCommands(scene, [{ type: 'addOpening', id: 'door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 2400, widthMm: 1200, kind: 'door', state: 'open' }], runtime())
  const port = resolveBuildingStructurePort(scene, 'door', 1000)
  scene = applyCommands(scene, [{ type: 'createPath', id: 'road', floorId: 'visual-floor', layerId: 'visual-layer-ground', centerlineMm: [port.outsideMm, p(port.outsideMm.x, port.outsideMm.y - 4000), p(port.outsideMm.x + 2500, port.outsideMm.y - 6000)], widthMm: 1000, supportRefs: [port.supportRef] }], runtime())
  const content = createCompositionContent(scene, runtime()), request = { id: 'attachment', pathId: 'road', openingId: 'door', end: 'start' as const, leadLengthMm: 1000, maxDisplacementMm: 500 }
  return { content, request, wall, port }
}
function bind(content: CompositionContent, request: ReturnType<typeof fixture>['request']): CompositionContent {
  return applyCompositionCommands(content, [{ type: 'bindPathAttachment', ...request }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
}
function directBound() {
  const f = fixture(), plan = createPathAttachmentPlan(f.content, f.request), scene = cloneJson(f.content.document) as AttachmentScene
  scene.paths.road = plan.path; scene.pathAttachments = { [plan.attachment.id]: plan.attachment }
  const identity = advanceHistoryIdentity(f.content.historyIdentity, f.content.document, scene, runtime())
  return { ...f, plan, scene, identity }
}

describe('persistent manual door/path attachment leaf state', () => {
  it('creates strict complete geometry/proofs from actual identities while preserving the input', () => {
    const f = fixture(), before = canonicalJson(f.content), plan = createPathAttachmentPlan(f.content, f.request)
    expect(pathAttachmentSchema.safeParse(plan.attachment).success).toBe(true)
    expect(plan.attachment.proofs.lineageId).toBe(f.content.historyIdentity.lineageId)
    expect(plan.attachment.proofs.path.birthToken).toBe(f.content.historyIdentity.outdoorTokens.road.token)
    expect(plan.attachment.proofs.opening.birthToken).toBe(f.content.historyIdentity.structureTokens!.door.token)
    expect(plan.path.surfaceStyle).toEqual(f.content.document.paths.road.surfaceStyle)
    expect(plan.path.centerlineMm.slice(2)).toEqual(f.content.document.paths.road.centerlineMm.slice(1))
    expect(plan.dependencyIds).toEqual(expect.arrayContaining(['attachment', 'road', 'door', 'room', 'ground', 'visual-layer-ground']))
    expect(canonicalJson(f.content)).toBe(before)
  })

  it('binds through one native composition command and cold-validates real relationship birth tokens', () => {
    const f = fixture(), result = bind(f.content, f.request), row = result.document.pathAttachments!.attachment
    expect(row.proofs).toBeDefined(); expect(result.historyIdentity.structureTokens!.attachment.kind).toBe('pathAttachment')
    expect(validatePathAttachmentGeometry(result.document)).toEqual([])
    expect(validatePathAttachmentProofs(result.document, result.historyIdentity)).toEqual([])
    expect(validateCompositionContent(JSON.parse(canonicalJson(result))).document.pathAttachments).toEqual(result.document.pathAttachments)
    expect(result.document.paths.road.widthMm).toBe(f.content.document.paths.road.widthMm)
    expect(result.appearance).toEqual(f.content.appearance)
  })

  it('refuses raw binding without identity, uninitialized structural pools and reused IDs', () => {
    const f = fixture(), noPool = cloneJson(f.content); delete noPool.historyIdentity.structureTokens
    expect(() => createPathAttachmentPlan(noPool, f.request)).toThrow(/先明确建立当前结构身份/)
    expect(() => applyCommands(f.content.document, [{ type: 'bindPathAttachment', ...f.request }], runtime())).toThrow(/完整工程.*身份/)
    expect(() => createPathAttachmentPlan(f.content, { ...f.request, id: 'room' })).toThrow(/身份/)
    const result = bind(f.content, f.request)
    expect(() => createPathAttachmentPlan(result, { ...f.request, id: 'another-attachment' })).toThrow(/每条道路只允许一个/)
  })

  it.each(['offset', 'width', 'thickness'] as const)('follows actual %s changes atomically through native commands and keeps fixed tail/identity', field => {
    const f = fixture(), first = bind(f.content, f.request), oldTail = cloneJson(first.document.paths.road.centerlineMm.slice(2))
    const commands = field === 'offset' ? [{ type: 'updateOpening' as const, id: 'door', changes: { offsetMm: 2600 } }]
      : field === 'width' ? [{ type: 'updateOpening' as const, id: 'door', changes: { widthMm: 1400 } }]
        : [{ type: 'setWallThickness' as const, id: f.wall.id, thicknessMm: 600 }]
    const snapshot = canonicalJson(first), next = applyCompositionCommands(first, commands, runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(next.document.paths.road.centerlineMm.slice(2)).toEqual(oldTail)
    expect(next.document.pathAttachments!.attachment.anchor.port).toEqual(resolveBuildingStructurePort(next.document, 'door', 1000))
    expect(next.document.pathAttachments!.attachment.proofs).toEqual(first.document.pathAttachments!.attachment.proofs)
    expect(next.historyIdentity.structureTokens!.attachment).toEqual(first.historyIdentity.structureTokens!.attachment)
    expect(validatePathAttachmentProofs(next.document, next.historyIdentity)).toEqual([])
    expect(canonicalJson(first)).toBe(snapshot)
  })

  it('preserves relationships when closing/locking the door or later placing a dynamic blocker', () => {
    const f = fixture(), first = bind(f.content, f.request), before = canonicalJson(first.document.pathAttachments)
    const closed = applyCompositionCommands(first, [{ type: 'updateOpening', id: 'door', changes: { state: 'closed', locked: true } }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(canonicalJson(closed.document.pathAttachments)).toBe(before)
    const blocked = applyCompositionCommands(closed, [{ type: 'createRegion', id: 'later-obstacle', floorId: 'visual-floor', layerId: 'visual-layer-ground', kind: 'hazard',
      boundaryMm: rect(f.port.outsideMm.x - 200, f.port.outsideMm.y - 2500, 400, 400), blocksMovement: true }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(validateSceneDocument(blocked.document).ok).toBe(true)
    expect(validatePathAttachmentProofs(blocked.document, blocked.historyIdentity)).toEqual([])
    expect(blocked.document.paths.road.centerlineMm).toEqual(first.document.paths.road.centerlineMm)
    expect(() => applyCompositionCommands(blocked, [{ type: 'updateOpening', id: 'door', changes: { offsetMm: 2500 } }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })).toThrow(/完整室外.*阻挡/)
  })

  it.each(['relation', 'path', 'layer', 'recursive-note'] as const)('respects %s locks during related movement while accepting a locked cold project', lock => {
    const f = directBound(), before = cloneJson(f.scene)
    if (lock === 'relation') before.pathAttachments!.attachment.editLocked = true
    if (lock === 'path') before.paths.road.editLocked = true
    if (lock === 'layer') before.userLayers['visual-layer-ground'].editLocked = true
    if (lock === 'recursive-note') {
      before.notes.note = { id: 'note', floorId: 'visual-floor', editLocked: true, visibility: 'gm', kind: 'note', text: '', anchor: { type: 'entity', entityKind: 'path', entityId: 'road' } }
      before.entityLayers.note = 'visual-layer-ground'
    }
    expect(validatePathAttachmentGeometry(before)).toEqual([])
    const after = cloneJson(before); after.openings.door.offsetMm += 100
    const snapshot = canonicalJson(after)
    expect(() => followPathAttachments(before, after)).toThrow(/锁定/)
    expect(canonicalJson(after)).toBe(snapshot)
  })

  it('rejects protected manual tail editing and allows explicit detach followed by ordinary path editing', () => {
    const f = fixture(), first = bind(f.content, f.request), changed = cloneJson(first.document.paths.road.centerlineMm)
    changed[2].x += 100
    expect(() => applyCompositionCommands(first, [{ type: 'updatePath', id: 'road', changes: { centerlineMm: changed } }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })).toThrow(/人工经由点|顺序/)
    const detached = applyCompositionCommands(first, [{ type: 'detachPathAttachment', id: 'attachment' }, { type: 'updatePath', id: 'road', changes: { centerlineMm: changed } }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(detached.document.pathAttachments).toEqual({})
    expect(detached.document.paths.road.centerlineMm).toEqual(changed)
    expect(detached.historyIdentity.structureTokens!.attachment.token).toBe(first.historyIdentity.structureTokens!.attachment.token)
  })

  it('does not resurrect explicitly removed relations or deleted paths during follow', () => {
    const f = directBound(), after = cloneJson(f.scene)
    delete after.pathAttachments!.attachment; delete after.paths.road; delete after.entityLayers.road
    const result = followPathAttachments(f.scene, after)
    expect(result.document.pathAttachments).toEqual({}); expect(result.document.paths.road).toBeUndefined()
    expect(f.scene.paths.road).toBeDefined()
  })

  it('keeps a multi-road follow atomic if a later related relationship is locked', () => {
    const f = fixture(), added = applyCompositionCommands(f.content, [{ type: 'createPath', id: 'second-road', floorId: 'visual-floor', layerId: 'visual-layer-ground',
      centerlineMm: cloneJson(f.content.document.paths.road.centerlineMm), widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'ground' }] }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    const first = bind(added, f.request), both = bind(first, { ...f.request, id: 'second-attachment', pathId: 'second-road' })
    const before = cloneJson(both.document), after = cloneJson(both.document)
    before.pathAttachments!['second-attachment'].editLocked = true; after.pathAttachments!['second-attachment'].editLocked = true
    after.openings.door.offsetMm += 100
    const snapshot = canonicalJson(after)
    expect(() => followPathAttachments(before, after)).toThrow(/锁定/)
    expect(canonicalJson(after)).toBe(snapshot)
  })

  it('follows after the real native generation lifecycle refreshes an input receipt', () => {
    const f = fixture(), scene = cloneJson(f.content.document), generation = getLegacyGeneration(scene)!
    const input = { kind: 'opening' as const, entityId: 'door', parentId: null, fieldGroup: 'geometry' as const }, target = { kind: 'path' as const, entityId: 'road', parentId: null, fieldGroup: 'geometry' as const }
    generation.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'attachment-test', algorithmVersion: 1, mapMode: 'scene', seed: 'existing-generated-road',
      parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 800, plateauElevationMm: 2600, roughness: 0, densityFactor: 0, baySide: 'north' },
      materials: [], props: [], precision: { sampleSpacingMm: 1000, toleranceMm: 50, noiseCellMm: 2000 } }
    generation.rules.rule = { id: 'rule', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public', editLocked: false, kind: 'terrain', recipeRef: { id: 'recipe', version: 1 },
      inputs: [input], outputs: [target], parameters: { widthMm: 1000, minWidthMm: 0, maxWidthMm: 1000, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
    generation.ownership.owner = { id: 'owner', outputKey: 'existing-generated-road/road', ruleId: 'rule', target, managedFields: ['geometry'], manualFields: [], state: 'managed', birthToken: 'existing-road-birth' }
    generation.rules.rule.inputHash = generationInputHash(scene, generation.rules.rule); generation.rules.rule.managedOutputHash = managedOutputHash(scene, generation.rules.rule)
    const first = bind(createCompositionContent(scene, runtime()), f.request)
    const followed = applyCompositionCommands(first, [{ type: 'updateOpening', id: 'door', changes: { offsetMm: 2600 } }], runtime(), { budget: MANUAL_TRANSACTION_BUDGET })
    expect(followed.document.paths.road.centerlineMm[0]).not.toEqual(first.document.paths.road.centerlineMm[0])
    expect(validatePathAttachmentProofs(followed.document, followed.historyIdentity)).toEqual([])
    expect(getLegacyGeneration(followed.document)!.rules.rule.inputHash).toBe(generationInputHash(followed.document, getLegacyGeneration(followed.document)!.rules.rule))
  })

  it('rejects cold geometry/proof forgery against the real lineage, birth and current topology pools', () => {
    const f = directBound()
    expect(validatePathAttachmentProofs(f.scene, f.identity)).toEqual([])
    for (const field of ['lineage', 'birth', 'topology', 'self', 'route', 'kind'] as const) {
      const scene = cloneJson(f.scene), identity = cloneJson(f.identity)
      if (field === 'lineage') scene.pathAttachments!.attachment.proofs.lineageId = 'forged-lineage'
      if (field === 'birth') scene.pathAttachments!.attachment.proofs.opening.birthToken = 'forged-birth'
      if (field === 'topology') identity.structureTokens!.door.topologyToken = 'retired-topology'
      if (field === 'self') delete identity.structureTokens!.attachment
      if (field === 'route') scene.paths.road.centerlineMm[2].x += 50
      if (field === 'kind') identity.structureTokens!.door.kind = 'wall'
      expect(validatePathAttachmentProofs(scene, identity), field).not.toEqual([])
    }
  })

  it('rejects duplicate path relations, hidden doors and illegal layer membership', () => {
    const f = directBound(), duplicate = cloneJson(f.scene)
    duplicate.pathAttachments!.duplicate = { ...cloneJson(duplicate.pathAttachments!.attachment), id: 'duplicate' }
    expect(validatePathAttachmentGeometry(duplicate).some(issue => /每条道路/.test(issue.message))).toBe(true)
    const hidden = cloneJson(f.scene); hidden.openings.door.secret = true
    expect(validatePathAttachmentGeometry(hidden).some(issue => /公开可见/.test(issue.message))).toBe(true)
    const layered = cloneJson(f.scene); layered.entityLayers.attachment = 'visual-layer-ground'
    expect(validatePathAttachmentGeometry(layered).some(issue => /不是独立图层实体/.test(issue.message))).toBe(true)
    expect(pathAttachmentSchema.safeParse({ ...f.scene.pathAttachments!.attachment, seed: 'cannot-be-authority' }).success).toBe(false)
  })

  it('rebinds only controlled restored proof fields against newly advanced real tokens', () => {
    const f = directBound(), identity = cloneJson(f.identity)
    identity.structureTokens!.door.topologyToken = 'controlled-undo-current-topology'
    expect(validatePathAttachmentProofs(f.scene, identity)).not.toEqual([])
    const before = canonicalJson(f.scene), restored = rebindPathAttachmentProofs(f.scene, identity)
    expect(restored.pathAttachments!.attachment.proofs.opening.topologyToken).toBe('controlled-undo-current-topology')
    expect(restored.paths).toEqual(f.scene.paths); expect(restored.pathAttachments!.attachment.anchor).toEqual(f.scene.pathAttachments!.attachment.anchor)
    expect(validatePathAttachmentProofs(restored, identity)).toEqual([])
    expect(canonicalJson(f.scene)).toBe(before)
    const fake = cloneJson(identity); fake.structureTokens!.door.topologyHash = '0'.repeat(64)
    expect(() => rebindPathAttachmentProofs(f.scene, fake)).toThrow(/真实当前出生/)
    expect(structureIdentityDescriptors(f.scene).attachment.kind).toBe('pathAttachment')
  })
})
