import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { fixture as projectFixture, runtime as workspaceRuntime, validation } from '../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle } from '../../application/workspace/project.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { inspectOutdoorChanges } from '../commands/outdoor.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { MANUAL_TRANSACTION_BUDGET } from '../budget/command-budget.js'
import { resolveBuildingEntrancePort, resolveBuildingStructurePort } from '../generation/building-port.js'
import { validateCompositionContent } from '../validation/content.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { CompositionContent } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { createPathAttachmentPlan } from './state.js'

// New acceptance combinations, not the earlier leaf examples: four exterior
// orientations, both path ends, translated positions and non-sample IDs; base
// vertex + wall thickness + whole-building movement in the same transaction.
const NOW = '2026-11-10T09:30:00.000Z'
let sequence = 0
const runtime = { ids: { nextId: () => `acceptance-rel-token-${++sequence}` }, clock: { now: () => NOW } }
const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, w: number, h: number) => [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)]
type Side = 'north' | 'east' | 'south' | 'west'
function prepare(side: Side = 'north', end: 'start' | 'end' = 'start', shift = p(0, 0)) {
  const bundle = projectFixture(), base = bundle.project.document
  const floorId = Object.keys(base.floors)[0], layerId = Object.values(base.userLayers).find(layer => layer.floorId === floorId)!.id
  base.floors[floorId].boundsMm = { x: 0, y: 0, width: 80000, height: 70000 }
  base.exportBoundsMm = cloneJson(base.floors[floorId].boundsMm)
  Object.values(base.props).forEach((prop, index) => { prop.positionMm = p(1500 + index * 600, 1800) })
  const ids = { area: `丘地::${side} Δ`, room: `小屋/${side} 37`, door: `外门 ${side} 甲`, road: `手绘路:${end}/${side}`, link: `附着 ${side} → ${end}` }
  const x = 27100 + shift.x, y = 28300 + shift.y
  let scene = applyCommands(base, [
    { type: 'createTerrainArea', id: ids.area, floorId, layerId, boundaryMm: rect(4000, 5000, 68000, 58000), groundElevationMm: 850, coveragePriority: 0 },
    { type: 'createRoom', id: ids.room, floorId, layerId, boundaryMm: rect(x, y, 7800, 6200), thicknessMm: 600, supportRef: { kind: 'terrainArea', id: ids.area } },
  ], runtime)
  const wall = Object.values(scene.walls).find(w => {
    const a = scene.vertices[w.startVertexId], b = scene.vertices[w.endVertexId]
    return side === 'north' ? a.yMm === y && b.yMm === y : side === 'south' ? a.yMm === y + 6200 && b.yMm === y + 6200
      : side === 'west' ? a.xMm === x && b.xMm === x : a.xMm === x + 7800 && b.xMm === x + 7800
  })!
  scene = applyCommands(scene, [{ type: 'addOpening', id: ids.door, wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1900, widthMm: 1800,
    kind: 'door', state: 'closed', locked: true }], runtime)
  const port = resolveBuildingStructurePort(scene, ids.door, 1100)
  const normal = p(Math.sign(port.outsideMm.x - port.positionMm.x), Math.sign(port.outsideMm.y - port.positionMm.y)), tangent = p(-normal.y, normal.x)
  const point = (n: number, t = 0) => p(port.outsideMm.x + normal.x * n + tangent.x * t, port.outsideMm.y + normal.y * n + tangent.y * t)
  const points = [port.outsideMm, point(4300), point(6100, 1800), point(8300, 1800)]
  scene = applyCommands(scene, [{ type: 'createPath', id: ids.road, floorId, layerId, centerlineMm: end === 'start' ? points : [...points].reverse(), widthMm: 1100,
    supportRefs: [port.supportRef], movementCostMultiplier: 1.35, renderOrder: 19 }], runtime)
  const content = createCompositionContent(scene, runtime)
  const bind: SceneCommand = { type: 'bindPathAttachment', id: ids.link, pathId: ids.road, openingId: ids.door, end, leadLengthMm: 1300, maxDisplacementMm: 1700 }
  Object.assign(bundle.project, content)
  return { bundle, content, ids, floorId, layerId, wall, normal, tangent, bind, end }
}
const apply = (content: CompositionContent, commands: SceneCommand[]) => applyCompositionCommands(content, commands, runtime, { budget: MANUAL_TRANSACTION_BUDGET })
const tail = (scene: SceneDocument, id: string, end: 'start' | 'end') => (end === 'start' ? scene.paths[id].centerlineMm : [...scene.paths[id].centerlineMm].reverse()).slice(2)
const pathProperties = (scene: SceneDocument, id: string) => { const { centerlineMm: _, ...properties } = scene.paths[id]; return properties }

const sessions: Workspace[] = [], repos: ProjectRepository[] = [], databases: string[] = []
async function open(f = prepare()) {
  const name = `acceptance-relations-${crypto.randomUUID()}`, repo = new ProjectRepository({ name, runtime: workspaceRuntime, validation })
  repos.push(repo); databases.push(name)
  const workspace = new Workspace(repo, { runtime: workspaceRuntime, validation }); sessions.push(workspace)
  await workspace.adoptNew(await fromBundle(f.bundle, validation)); await workspace.flush()
  return { ...f, workspace, repo }
}
afterEach(async () => {
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repos.splice(0)) repo.close()
  for (const name of databases.splice(0)) await Dexie.delete(name)
})

describe('formal acceptance: door/path combinations and failed-transaction preservation', () => {
  it.each([
    ['north', 'start', 1300, -700], ['east', 'end', -2100, 1900],
    ['south', 'end', 3900, 1100], ['west', 'start', -1700, -2300],
  ] as const)('%s/%s follows base corner, thickness and translation with exact tail/proof preservation', (side, end, dx, dy) => {
    const f = prepare(side, end, p(dx, dy)), input = canonicalJson(f.content)
    expect(() => resolveBuildingEntrancePort(f.content.document, f.ids.door, 1100)).toThrow(/已打开且未上锁/)
    const plan = createPathAttachmentPlan(f.content, { id: f.ids.link, pathId: f.ids.road, openingId: f.ids.door, end, leadLengthMm: 1300, maxDisplacementMm: 1700 })
    expect(plan.dependencyIds).toEqual(expect.arrayContaining([f.ids.room, f.ids.door, f.ids.area, f.ids.road, f.wall.id, f.layerId]))
    const bound = apply(f.content, [f.bind]), reference = bound.document.vertices[f.wall.startVertexId]
    const combined = apply(bound, [
      { type: 'moveVertex', id: reference.id, positionMm: p(reference.xMm + f.tangent.x * 120, reference.yMm + f.tangent.y * 120) },
      { type: 'setWallThickness', id: f.wall.id, thicknessMm: 900 },
      { type: 'transformBuilding', id: f.ids.room, offsetMm: p(130, -90), pivotMm: p(0, 0), quarterTurns: 0 },
      { type: 'updateOpening', id: f.ids.door, changes: { offsetMm: 2070, widthMm: 2000 } },
    ])
    expect(tail(combined.document, f.ids.road, end)).toEqual(tail(bound.document, f.ids.road, end))
    expect(pathProperties(combined.document, f.ids.road)).toEqual(pathProperties(bound.document, f.ids.road))
    expect(combined.document.openings[f.ids.door]).toMatchObject({ state: 'closed', locked: true })
    expect(combined.document.pathAttachments![f.ids.link].anchor.port).toEqual(resolveBuildingStructurePort(combined.document, f.ids.door, 1100))
    expect(combined.document.pathAttachments![f.ids.link].proofs).toEqual(bound.document.pathAttachments![f.ids.link].proofs)
    expect(validateCompositionContent(JSON.parse(canonicalJson(combined))).document).toEqual(combined.document)
    expect(canonicalJson(f.content)).toBe(input)
  })

  it.each(['north', 'east', 'south', 'west'] as const)('rejects a diagonal %s corner without a half-updated path or anchor', side => {
    const f = prepare(side), bound = apply(f.content, [f.bind]), before = canonicalJson(bound), v = bound.document.vertices[f.wall.startVertexId]
    expect(() => apply(bound, [{ type: 'moveVertex', id: v.id, positionMm: p(v.xMm + f.normal.x * 100, v.yMm + f.normal.y * 100) }])).toThrow(/正交|结构端口|外门/)
    expect(canonicalJson(bound)).toBe(before)
  })

  it('rejects a later locked second road and preserves both roads, identities, appearance and the whole command batch', () => {
    const f = prepare('east', 'end'), road = f.content.document.paths[f.ids.road]
    const withSecond = apply(f.content, [{ type: 'createPath', id: '另一条路/乙', floorId: f.floorId, layerId: f.layerId, centerlineMm: cloneJson(road.centerlineMm), widthMm: road.widthMm, supportRefs: cloneJson(road.supportRefs) }])
    const first = apply(withSecond, [f.bind]), both = apply(first, [{ ...f.bind, id: '第二个关系/乙', pathId: '另一条路/乙' }])
    const locked = apply(both, [{ type: 'setEditLock', kind: 'path', id: '另一条路/乙', locked: true }]), before = canonicalJson(locked)
    expect(validateCompositionContent(JSON.parse(before)).document.pathAttachments).toEqual(locked.document.pathAttachments)
    expect(() => apply(locked, [{ type: 'setWallThickness', id: f.wall.id, thicknessMm: 800 }, { type: 'updateOpening', id: f.ids.door, changes: { offsetMm: 2100 } }])).toThrow(/锁定/)
    expect(canonicalJson(locked)).toBe(before)
  })

  it('requires detach for tail insertion/reversal, keeps the manual edit after detach, and deletes only a removed road relationship', () => {
    const f = prepare('south', 'end'), bound = apply(f.content, [f.bind]), before = canonicalJson(bound)
    const changed = cloneJson(bound.document.paths[f.ids.road].centerlineMm)
    changed.splice(1, 0, p(changed[0].x + 300, changed[0].y))
    expect(() => apply(bound, [{ type: 'updatePath', id: f.ids.road, changes: { centerlineMm: changed } }])).toThrow(/人工经由点|顺序/)
    expect(() => apply(bound, [{ type: 'updatePath', id: f.ids.road, changes: { centerlineMm: [...bound.document.paths[f.ids.road].centerlineMm].reverse() } }])).toThrow(/人工经由点|顺序/)
    expect(canonicalJson(bound)).toBe(before)
    const detached = apply(bound, [{ type: 'detachPathAttachment', id: f.ids.link }, { type: 'updatePath', id: f.ids.road, changes: { centerlineMm: changed } }])
    expect(detached.document.paths[f.ids.road].centerlineMm).toEqual(changed)
    expect(detached.document.pathAttachments).toEqual({})
    const deleted = apply(bound, [{ type: 'deleteOutdoorEntity', kind: 'path', id: f.ids.road }])
    expect(deleted.document.pathAttachments).toEqual({}); expect(deleted.document.openings).toEqual(bound.document.openings)
    expect(deleted.document.rooms).toEqual(bound.document.rooms); expect(deleted.document.walls).toEqual(bound.document.walls)
    const impact = inspectOutdoorChanges(bound.document, deleted.document, [f.ids.road])
    expect(impact.removedIds).toEqual(expect.arrayContaining([f.ids.road, f.ids.link]))
    expect(impact.affectedIds).toEqual(expect.arrayContaining([f.ids.door, f.ids.room, f.wall.id, f.wall.startVertexId, f.wall.endVertexId]))
  })

  it('keeps a stale/cancelled preview and a late relation lock from touching the current or persisted branch', async () => {
    const f = await open(prepare('west', 'start', p(2700, 1300))), preview = await f.workspace.preview([f.bind])
    await f.workspace.execute([{ type: 'renameScene', title: '候选之后的独立修改' }]); await f.workspace.flush()
    const snapshot = () => canonicalJson(toBundle(f.workspace.getState().project!).project)
    let before = snapshot(), checkpoint = f.workspace.checkpoint()
    await expect(f.workspace.adoptPreview(preview)).rejects.toThrow(/基线|变化|过期|已有修改/)
    expect(snapshot()).toBe(before); expect(f.workspace.checkpoint()).toBe(checkpoint)
    expect(Object.keys((await f.repo.load(f.workspace.getDocument()!.sceneId))!.project.document.pathAttachments ?? {})).toHaveLength(0)
    const cancelled = await f.workspace.preview([f.bind]); f.workspace.cancelPreview(cancelled)
    await expect(f.workspace.adoptPreview(cancelled)).rejects.toThrow(/不可重复|取消/)
    expect(snapshot()).toBe(before)
    await f.workspace.execute([f.bind]); await f.workspace.execute([{ type: 'setEditLock', kind: 'pathAttachment', id: f.ids.link, locked: true }]); await f.workspace.flush()
    before = snapshot(); checkpoint = f.workspace.checkpoint()
    const persisted = canonicalJson((await f.repo.load(f.workspace.getDocument()!.sceneId))!.project)
    await expect(f.workspace.execute([{ type: 'setWallThickness', id: f.wall.id, thicknessMm: 1000 }])).rejects.toThrow(/锁定/)
    expect(snapshot()).toBe(before); expect(f.workspace.checkpoint()).toBe(checkpoint)
    await f.workspace.flush()
    expect(canonicalJson((await f.repo.load(f.workspace.getDocument()!.sceneId))!.project)).toBe(persisted)
  }, 30_000)

  it('refuses deleting a relationship-locked road without changing the document, checkpoint or durable project', async () => {
    const f = await open(prepare('east', 'end', p(1700, -800)))
    await f.workspace.execute([f.bind])
    await f.workspace.execute([{ type: 'setEditLock', kind: 'pathAttachment', id: f.ids.link, locked: true }]); await f.workspace.flush()
    const before = canonicalJson(toBundle(f.workspace.getState().project!).project), checkpoint = f.workspace.checkpoint()
    const persisted = canonicalJson((await f.repo.load(f.workspace.getDocument()!.sceneId))!.project)
    await expect(f.workspace.execute([{ type: 'deleteOutdoorEntity', kind: 'path', id: f.ids.road }])).rejects.toThrow(/锁定/)
    expect(canonicalJson(toBundle(f.workspace.getState().project!).project)).toBe(before)
    expect(f.workspace.checkpoint()).toBe(checkpoint)
    await f.workspace.flush()
    expect(canonicalJson((await f.repo.load(f.workspace.getDocument()!.sceneId))!.project)).toBe(persisted)
  }, 30_000)

  it('deletes the road and relation together, preserves both tombstones and restores current proofs through undo/redo/cold load', async () => {
    const f = await open(prepare('south', 'end', p(-1900, 2100)))
    await f.workspace.execute([f.bind]); const bound = f.workspace.getState().project!
    await f.workspace.execute([{ type: 'deleteOutdoorEntity', kind: 'path', id: f.ids.road }])
    let deleted = f.workspace.getState().project!
    expect(deleted.document.paths[f.ids.road]).toBeUndefined(); expect(deleted.document.pathAttachments).toEqual({})
    expect(deleted.document.openings).toEqual(bound.document.openings); expect(deleted.document.walls).toEqual(bound.document.walls); expect(deleted.document.rooms).toEqual(bound.document.rooms)
    expect(deleted.historyIdentity.outdoorTokens[f.ids.road]).toEqual(bound.historyIdentity.outdoorTokens[f.ids.road])
    expect(deleted.historyIdentity.structureTokens![f.ids.link]).toEqual(bound.historyIdentity.structureTokens![f.ids.link])
    f.workspace.undo()
    const restored = f.workspace.getState().project!
    expect(restored.document.paths[f.ids.road]).toEqual(bound.document.paths[f.ids.road])
    expect(restored.document.pathAttachments![f.ids.link].proofs.path.topologyToken).toBe(restored.historyIdentity.outdoorTokens[f.ids.road].topologyToken)
    expect(restored.historyIdentity.outdoorTokens[f.ids.road].topologyToken).not.toBe(bound.historyIdentity.outdoorTokens[f.ids.road].topologyToken)
    expect(restored.historyIdentity.structureTokens![f.ids.link].topologyToken).not.toBe(bound.historyIdentity.structureTokens![f.ids.link].topologyToken)
    validateCompositionContent({ document: restored.document, appearance: restored.appearance, historyIdentity: restored.historyIdentity })
    f.workspace.redo(); deleted = f.workspace.getState().project!
    expect(deleted.document.paths[f.ids.road]).toBeUndefined(); expect(deleted.document.pathAttachments).toEqual({})
    await f.workspace.flush()
    const cold = (await f.repo.load(deleted.document.sceneId))!
    expect(cold.project.document).toEqual(deleted.document)
    expect(cold.project.historyIdentity).toEqual(deleted.historyIdentity)
    await expect(fromBundle(cold, validation)).resolves.toBeDefined()
  }, 30_000)
})
