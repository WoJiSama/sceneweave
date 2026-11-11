import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fixture as projectFixture, runtime as workspaceRuntime, validation } from '../../application/workspace/test-fixtures.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { fromBundle, toBundle } from '../../application/workspace/project.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyCommands, applySnapshotCommands, type SceneCommand } from '../commands/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { MANUAL_TRANSACTION_BUDGET, MANUAL_TRANSACTION_BUDGETS, manualChangedTargets, measureCommandBudget } from '../budget/command-budget.js'
import { selectManualCommandBudget } from '../budget/manual-request.js'
import { captureExecutionBudget, taskBudgetProfile, withAdditionalExecutionWorkObserver, withExecutionWorkObserver } from '../budget/task-budget.js'
import { resolveBuildingStructurePort } from '../generation/building-port.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateCompositionContent } from '../validation/content.js'
import { visualBase } from '../visual/base.js'
import type { CompositionContent } from '../model/appearance.js'
import { createPathAttachmentPlan } from './state.js'
import { createPathAttachmentTransactionBudget, mayMutatePathAttachments } from './transaction-budget.js'

let sequence = 0
const runtime = { ids: { nextId: () => `relation-budget-${++sequence}` }, clock: { now: () => '2026-11-10T14:00:00.000Z' } }
const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, w: number, h: number) => [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)]
let full: CompositionContent
const roadIds = Array.from({ length: 129 }, (_, i) => `budget-road-${i}`)
const relationId = (id: string) => `${id}-attachment`
beforeAll(() => {
  const bundle = projectFixture(), scene = bundle.project.document, floorId = Object.keys(scene.floors)[0], layerId = Object.values(scene.userLayers)[0].id
  scene.floors[floorId].boundsMm = { x: 0, y: 0, width: 40000, height: 40000 }; scene.exportBoundsMm = cloneJson(scene.floors[floorId].boundsMm)
  Object.values(scene.props).forEach((prop, i) => { prop.positionMm = p(1500 + i * 600, 1800) })
  let document = applyCommands(scene, [
    { type: 'createTerrainArea', id: 'budget-ground', floorId, layerId, boundaryMm: rect(4000, 4000, 30000, 30000), groundElevationMm: 0, coveragePriority: 0 },
    { type: 'createRoom', id: 'budget-room', floorId, layerId, boundaryMm: rect(14000, 16000, 6000, 6000), thicknessMm: 300, supportRef: { kind: 'terrainArea', id: 'budget-ground' } },
  ], runtime)
  const wall = Object.values(document.walls).find(w => document.vertices[w.startVertexId].yMm === 16000 && document.vertices[w.endVertexId].yMm === 16000)!
  document = applyCommands(document, [{ type: 'addOpening', id: 'budget-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1600, widthMm: 2000, kind: 'door', state: 'closed', locked: true }], runtime)
  const port = resolveBuildingStructurePort(document, 'budget-door', 1000)
  const base = applyCompositionCommands(createCompositionContent(document, runtime), roadIds.map(id => ({ type: 'createPath' as const, id, floorId, layerId,
    centerlineMm: [port.outsideMm, p(port.outsideMm.x, 10000), p(port.outsideMm.x + 5000, 8000)], widthMm: 1000, supportRefs: [port.supportRef] })), runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })
  const owned = cloneJson(base.document)
  // Read-only plans bind actual path/structure proofs; one real identity
  // advance establishes the fixture's fresh relation births, then full cold validation.
  for (const id of roadIds) {
    const plan = createPathAttachmentPlan(base, { id: relationId(id), pathId: id, openingId: 'budget-door', end: 'start', leadLengthMm: 1000, maxDisplacementMm: 1200 })
    owned.paths[id] = plan.path; (owned.pathAttachments ??= {})[plan.attachment.id] = plan.attachment
  }
  full = validateCompositionContent({ document: owned, appearance: base.appearance, historyIdentity: advanceHistoryIdentity(base.historyIdentity, base.document, owned, runtime) })
}, 120_000)

function single() {
  const content = cloneJson(full)
  for (const id of roadIds.slice(1)) { delete content.document.paths[id]; delete content.document.entityLayers[id]; delete content.document.pathAttachments![relationId(id)] }
  return validateCompositionContent(content)
}
const deletion = (count: number): SceneCommand[] => roadIds.slice(0, count).map(id => ({ type: 'deleteOutdoorEntity', kind: 'path', id }))
const sessions: Workspace[] = [], repos: ProjectRepository[] = [], names: string[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close().catch(() => {})
  for (const repo of repos.splice(0)) repo.close()
  for (const name of names.splice(0)) await Dexie.delete(name)
})

describe('fixed compact relation transaction budget at the shared owners', () => {
  it.each([
    ['standard', MANUAL_TRANSACTION_BUDGETS.standard], ['expanded', MANUAL_TRANSACTION_BUDGETS.expanded], ['AI-expanded', taskBudgetProfile('expanded')],
  ] as const)('rejects 129 road+relation deletions under %s at both shared entry points', (_name, budget) => {
    const before = canonicalJson(full)
    for (const apply of [applyCommands, applySnapshotCommands]) expect(() => apply(full.document, deletion(129), runtime, { budget })).toThrow(/预算超限\[semanticTargets\].*258\/256/)
    expect(canonicalJson(full)).toBe(before)
  }, 60_000)

  it.each([
    ['applyCommands', 'raw', applyCommands, undefined], ['applyCommands', 'expanded', applyCommands, MANUAL_TRANSACTION_BUDGETS.expanded],
    ['applySnapshotCommands', 'raw', applySnapshotCommands, undefined], ['applySnapshotCommands', 'expanded', applySnapshotCommands, MANUAL_TRANSACTION_BUDGETS.expanded],
  ] as const)('accepts the exact 128-road + 128-relation boundary at %s with %s', (_entry, _profile, apply, budget) => {
    const result = apply(full.document, deletion(128), runtime, { budget })
    expect(Object.keys(result.paths)).toEqual([roadIds[128]])
    expect(Object.keys(result.pathAttachments!)).toEqual([relationId(roadIds[128])])
    expect(manualChangedTargets(full.document, result)).toHaveLength(256)
  }, 60_000)

  it('accepts the exact 128-road + 128-relation boundary with strict complete metadata', () => {
    const result = applyCompositionCommands(full, deletion(128), runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })
    expect(Object.keys(result.document.paths)).toHaveLength(1)
    expect(measureCommandBudget(full.document, result.document, { before: full, after: result }).semanticTargets).toBe(256)
  }, 60_000)

  it('enforces the compact input cap independently of real changes and still allows a small relation lock', () => {
    const base = single(), command: SceneCommand = { type: 'setEditLock', kind: 'pathAttachment', id: relationId(roadIds[0]), locked: true }
    for (const apply of [applyCommands, applySnapshotCommands]) {
      expect(apply(base.document, [command], runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded }).pathAttachments![relationId(roadIds[0])].editLocked).toBe(true)
      expect(() => apply(base.document, Array.from({ length: 257 }, () => command), runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })).toThrow(/输入指令最多256/)
    }
  })

  it('counts 86 real opening moves within the input cap even when the final snapshot would equal the input', () => {
    const base = single(), commands = Array.from({ length: 86 }, (_, i): SceneCommand => ({ type: 'updateOpening', id: 'budget-door', changes: { offsetMm: i % 2 === 0 ? 1700 : 1600 } }))
    const before = canonicalJson(base)
    for (const apply of [applyCommands, applySnapshotCommands]) expect(() => apply(base.document, commands, runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })).toThrow(/预算超限\[semanticTargets\].*258\/256/)
    expect(canonicalJson(base)).toBe(before)
    expect(applySnapshotCommands(base.document, commands.slice(0, 84), runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })).toEqual(base.document)
  }, 60_000)

  it('charges earlier non-relation changes even when the relation is first changed by the last command', () => {
    const original = single(), floorId = Object.keys(original.document.floors)[0], layerId = Object.values(original.document.userLayers)[0].id
    const base = applyCompositionCommands(original, [{ type: 'createRoom', id: 'unattached-room', floorId, layerId, boundaryMm: rect(26000, 20000, 4000, 4000), thicknessMm: 300,
      supportRef: { kind: 'terrainArea', id: 'budget-ground' } }], runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })
    // 52 complete transforms return the independent room to its original
    // geometry. Each really changes one room and four walls: 260 targets.
    const commands: SceneCommand[] = Array.from({ length: 52 }, (_, i) => ({ type: 'transformBuilding', id: 'unattached-room', offsetMm: p(i % 2 === 0 ? 100 : -100, 0), pivotMm: p(0, 0), quarterTurns: 0 }))
    commands.push({ type: 'detachPathAttachment', id: relationId(roadIds[0]) })
    const before = canonicalJson(base)
    for (const apply of [applyCommands, applySnapshotCommands]) expect(() => apply(base.document, commands, runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })).toThrow(/semanticTargets.*260\/256/)
    expect(canonicalJson(base)).toBe(before)
  }, 60_000)

  it('keeps cumulative charges after a whole batch of detachments removes the last relationship', () => {
    const environment = visualBase(full.document)!.environment, floorId = full.document.paths[roadIds[0]].floorId, layerId = full.document.entityLayers[roadIds[0]]
    const commands: SceneCommand[] = roadIds.map(id => ({ type: 'detachPathAttachment', id: relationId(id) }))
    commands.push(...Array.from({ length: 126 }, (_, i): SceneCommand => ({ type: 'setVisualEnvironment', environment: { ...environment, exposure: i % 2 === 0 ? .9 : environment.exposure } })))
    commands.push({ type: 'upsertVisualFilter', filter: { id: 'after-detach-filter', floorId, layerId, editLocked: false, visibility: 'public', enabled: true,
      target: { kind: 'entities', ids: roadIds.slice(0, 2) }, preset: 'neutral', exposure: .9, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'after-detach' } })
    expect(commands).toHaveLength(256)
    expect(() => applyCommands(full.document, commands, runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })).toThrow(/预算超限\[semanticTargets\].*257\/256/)
    const result = applyCommands(full.document, roadIds.map(id => ({ type: 'detachPathAttachment', id: relationId(id) })), runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })
    expect(result.pathAttachments).toEqual({}); expect(result.paths).toEqual(full.document.paths)
    expect(() => applyCommands(full.document, [{ type: 'bindPathAttachment', id: 'new-link', pathId: roadIds[0], openingId: 'budget-door', end: 'start', leadLengthMm: 1000, maxDisplacementMm: 1200 }, { type: 'detachPathAttachment', id: 'new-link' }], runtime)).toThrow(/独立预览采用/)
  }, 60_000)

  it('does not let a read-only observer erase a real relationship change or provide mismatched complete metadata', () => {
    const base = single(), before = canonicalJson(base), command: SceneCommand = { type: 'detachPathAttachment', id: relationId(roadIds[0]) }
    expect(() => applyCommands(base.document, [command], runtime, { onSceneDraft(draft) { draft.pathAttachments![relationId(roadIds[0])] = cloneJson(base.document.pathAttachments![relationId(roadIds[0])]) } })).toThrow(/只能读取候选/)
    expect(() => applyCommands(base.document, [command], runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded, budgetContent: { before: base, after: () => base } })).toThrow(/完整计量结果与实际场景不一致/)
    expect(canonicalJson(base)).toBe(before)
  })

  it('selects compact explicitly for relation edits but retains the ordinary tier for unrelated Path properties', () => {
    expect(selectManualCommandBudget(full.document, deletion(129))).toBe(MANUAL_TRANSACTION_BUDGET)
    const unrelated = Array.from({ length: 3 }, (_, pass) => roadIds.map(id => ({ type: 'updatePath' as const, id, changes: { renderOrder: pass + 3, movementCostMultiplier: 1.5 } }))).flat()
    expect(selectManualCommandBudget(full.document, unrelated)).toBe(MANUAL_TRANSACTION_BUDGETS.standard)
    let afterDocument = full.document, metadataReads = 0
    const result = applySnapshotCommands(full.document, unrelated.slice(0, 1), runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded,
      onSceneDraft(draft) { afterDocument = cloneJson(draft) },
      budgetContent: { before: full, after: () => { metadataReads++; return { ...full, document: afterDocument } } },
    })
    expect(result.pathAttachments).toEqual(full.document.pathAttachments)
    expect(metadataReads).toBe(1)
  }, 60_000)

  it('keeps implicit visual geometry writers metered and rejects a path curve that rewrites the protected tail', () => {
    const base = single(), floorId = base.document.paths[roadIds[0]].floorId, layerId = base.document.entityLayers[roadIds[0]], points = base.document.paths[roadIds[0]].centerlineMm
    const command: SceneCommand = { type: 'upsertVisualBoundary', boundary: { id: 'implicit-road-curve', floorId, layerId, editLocked: false, visibility: 'public', closed: false,
      sampleSpacingMm: 1000, toleranceMm: 10, binding: { kind: 'path', pathId: roadIds[0] }, segments: [{ id: 'implicit-road-segment', start: points[0],
        control1: p(points[0].x, 12000), control2: p(points.at(-1)!.x - 1000, 9000), end: points.at(-1)! }] } }
    expect(mayMutatePathAttachments(base.document, [command])).toBe(true)
    expect(selectManualCommandBudget(base.document, [command])).toBe(MANUAL_TRANSACTION_BUDGET)
    const before = canonicalJson(base)
    expect(() => applyCommands(base.document, [command], runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })).toThrow(/人工经由点|顺序|附着/)
    expect(canonicalJson(base)).toBe(before)
  })

  it('accepts an implicit supported terrain curve while retaining unchanged real anchors and complete identity proofs', () => {
    const base = single(), area = base.document.terrainAreas['budget-ground'], layerId = base.document.entityLayers[area.id]
    const command: SceneCommand = { type: 'upsertVisualBoundary', boundary: { id: 'implicit-ground-curve', floorId: area.floorId, layerId, editLocked: false, visibility: 'public', closed: false,
      sampleSpacingMm: 1500, toleranceMm: 15, binding: { kind: 'terrain', sides: [{ areaId: area.id, startPointId: area.boundaryMm[0].id, endPointId: area.boundaryMm[1].id, reverse: false }] },
      segments: [{ id: 'implicit-ground-segment', start: p(4000, 4000), control1: p(14000, 4500), control2: p(24000, 4500), end: p(34000, 4000) }] } }
    expect(mayMutatePathAttachments(base.document, [command])).toBe(true)
    const result = applyCompositionCommands(base, [command], runtime, { budget: MANUAL_TRANSACTION_BUDGETS.expanded })
    expect(result.document.terrainAreas[area.id].boundaryMm).not.toEqual(area.boundaryMm)
    expect(result.document.pathAttachments).toEqual(base.document.pathAttachments)
    expect(result.document.paths).toEqual(base.document.paths)
    expect(validateCompositionContent(JSON.parse(canonicalJson(result))).document).toEqual(result.document)
  })

  it('keeps the current project/checkpoint and durable branch unchanged after an over-budget delete', async () => {
    const bundle = projectFixture(); Object.assign(bundle.project, full)
    const name = `relation-budget-cas-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, runtime: workspaceRuntime, validation })
    repos.push(repo); names.push(name)
    const workspace = new Workspace(repo, { runtime: workspaceRuntime, validation }); sessions.push(workspace)
    await workspace.adoptNew(await fromBundle(bundle, validation)); await workspace.flush()
    const before = canonicalJson(toBundle(workspace.getState().project!).project), checkpoint = workspace.checkpoint(), durable = canonicalJson((await repo.load(full.document.sceneId))!.project)
    await expect(workspace.execute(deletion(129))).rejects.toThrow(/预算超限\[semanticTargets\]/)
    expect(workspace.checkpoint()).toBe(checkpoint); expect(canonicalJson(toBundle(workspace.getState().project!).project)).toBe(before)
    await workspace.flush(); expect(canonicalJson((await repo.load(full.document.sceneId))!.project)).toBe(durable)
  }, 60_000)
})

describe('relation meter retained resources and additive observer scopes', () => {
  it('keeps retained asset/decode peaks and accumulates real execution while change-then-restore stays charged', () => {
    const base = single(), detached = cloneJson(base.document); delete detached.pathAttachments![relationId(roadIds[0])]
    const meter = createPathAttachmentTransactionBudget()
    for (let i = 0; i < 128; i++) { meter.step(base.document, detached); meter.step(detached, base.document) }
    expect(meter.finish().semanticTargets).toBe(256)
    expect(() => meter.step(base.document, detached)).toThrow(/semanticTargets.*257\/256/)
    const work = createPathAttachmentTransactionBudget(); work.observeExecution({ gridNodes: 24000 }); work.step(base.document, detached)
    expect(() => work.observeExecution({ gridNodes: 1000 })).toThrow(/gridNodes/)
    const image = projectFixture({ image: true }).project, resourceBefore = cloneJson(base.document), resourceAfter = cloneJson(detached)
    Object.assign(resourceBefore.assets, image.document.assets); Object.assign(resourceAfter.assets, image.document.assets)
    const resources = createPathAttachmentTransactionBudget()
    for (let i = 0; i < 20; i++) {
      resources.step(resourceBefore, resourceAfter, { before: base, after: { ...base, assets: image.assets } })
      resources.step(resourceAfter, resourceBefore, { before: base, after: { ...base, assets: image.assets } })
    }
    expect(resources.finish().assetBytes).toBe(Object.values(image.assets).reduce((sum, record) => sum + record.sizeBytes, 0))
    expect(resources.finish().decodePixels).toBe(1)
  }, 60_000)

  it('forwards nested execution observers and restores them after errors and rejected asynchronous scopes', () => {
    const outer: number[] = [], inner: number[] = [], nested: number[] = [], meter = captureExecutionBudget(taskBudgetProfile('small'))
    withExecutionWorkObserver(delta => outer.push(delta.gridNodes ?? 0), () => {
      withAdditionalExecutionWorkObserver(delta => inner.push(delta.gridNodes ?? 0), () => {
        meter.charge({ gridNodes: 1 })
        expect(() => withAdditionalExecutionWorkObserver(delta => nested.push(delta.gridNodes ?? 0), () => { meter.charge({ gridNodes: 2 }); throw new Error('failure') })).toThrow('failure')
        meter.charge({ gridNodes: 3 })
      })
      expect(() => withAdditionalExecutionWorkObserver(() => {}, () => Promise.resolve())).toThrow(/不能跨Promise/)
      meter.charge({ gridNodes: 4 })
    })
    meter.charge({ gridNodes: 5 })
    expect(outer).toEqual([1, 2, 3, 4]); expect(inner).toEqual([1, 2, 3]); expect(nested).toEqual([2])
  })
})
