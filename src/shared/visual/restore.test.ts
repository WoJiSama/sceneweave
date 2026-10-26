import { describe, expect, it } from 'vitest'
import type { SceneDocument, PointMm } from '../model/scene.js'
import type { CompositionContent } from '../model/appearance.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { buildRestorePlan } from '../history/restore.js'
import { VisualContinuitySession, assertVisualContinuity } from '../history/visual-continuity.js'
import { inspectVisualChanges } from './commands.js'
import { emptyVisualSystem, type VisualBoundary, type VisualLight } from './types.js'

const stamp = '2026-10-25T00:00:00.000Z'
let sequence = 0
const context = () => ({ ids: { nextId: () => `visual-restore-${++sequence}` }, clock: { now: () => stamp } })
const p = (x: number, y: number): PointMm => ({ x, y })
const common = { floorId: 'floor', layerId: 'layer', visibility: 'public' as const, editLocked: false }
function blank(): SceneDocument {
  return { format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'visual-restore', revision: 0, title: 'Visual restore fixture', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: true }, exportBoundsMm: { x: 0, y: 0, width: 24000, height: 18000 },
    floors: { floor: { id: 'floor', name: 'Ground', boundsMm: { x: 0, y: 0, width: 24000, height: 18000 } } }, vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {}, prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    userLayers: { layer: { id: 'layer', floorId: 'floor', name: 'Ground', order: 0, editLocked: false }, effects: { id: 'effects', floorId: 'floor', name: 'Effects', order: 1, editLocked: false } }, entityLayers: {},
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } }
}
const light = (): VisualLight => ({ ...common, id: 'light', positionMm: p(3000, 3000), radiusMm: 1000, color: '#FFD080', intensity: .3, wallOcclusion: true, enabled: true })
const curve = (): VisualBoundary => ({ ...common, id: 'curve', closed: false, sampleSpacingMm: 1500, toleranceMm: 30, binding: { kind: 'decoration' }, segments: [{ id: 'cubic', start: p(12000, 1000), control1: p(11000, 6000), control2: p(13000, 12000), end: p(12000, 17000) }] })
function content(...commands: SceneCommand[]): CompositionContent { return createCompositionContent(applyCommands(blank(), commands, context()), context()) }
function capture(historic: CompositionContent, current: CompositionContent, invalidatedIds: string[] = []) {
  const session = new VisualContinuitySession()
  session.reset(historic.document); session.recordSnapshot('snapshot', 'hash', historic.document)
  session.advance(historic.document, current.document, invalidatedIds)
  return { session, evidence: { visualContinuity: session.prove('snapshot', 'hash', current.document, historic.document) } }
}

describe('finite visual restore and exact prepared impact', () => {
  it('restores explicit effect parameters while preserving current organization, privacy and out-of-scope work', () => {
    const historic = content({ type: 'upsertVisualLight', light: light() }), incoming = { ...light(), intensity: .8, layerId: 'effects', visibility: 'gm' as const }
    const current = applyCompositionCommands(historic, [{ type: 'upsertVisualLight', light: incoming }, { type: 'createTerrainArea', id: 'yard', floorId: 'floor', boundaryMm: [p(16000, 10000), p(20000, 10000), p(20000, 14000), p(16000, 14000)] }], context())
    const before = structuredClone(current), { evidence } = capture(historic, current)
    const plan = buildRestorePlan(current, historic, { ids: ['light'], mode: 'visual' }, evidence)
    expect(plan.document.visual!.lights.light).toEqual({ ...light(), layerId: 'effects', visibility: 'gm' })
    expect(plan.document.terrainAreas).toEqual(current.document.terrainAreas)
    expect(plan.historyIdentity).toEqual(current.historyIdentity)
    expect(plan.commandCost).toBe(1); expect(plan.affectedIds).toEqual(['light'])
    expect(plan.changes[0].layerId).toBe('effects'); expect(current).toEqual(before)
    expect(() => buildRestorePlan(current, historic, { ids: ['light'], mode: 'visual' })).toThrow(/连续性/)
  })

  it('keeps both physical sides aligned and restores only a continuous existing curve', () => {
    const bound = curve(); bound.binding = { kind: 'terrain', sides: [{ areaId: 'sand', startPointId: 'sand:point:1', endPointId: 'sand:point:2', reverse: false }, { areaId: 'water', startPointId: 'water:point:3', endPointId: 'water:point:0', reverse: true }] }
    const historic = content(
      { type: 'createTerrainArea', id: 'sand', floorId: 'floor', boundaryMm: [p(1000, 1000), p(12000, 1000), p(12000, 17000), p(1000, 17000)] },
      { type: 'createTerrainArea', id: 'water', floorId: 'floor', layerId: 'effects', boundaryMm: [p(12000, 1000), p(23000, 1000), p(23000, 17000), p(12000, 17000)] },
      { type: 'upsertVisualBoundary', boundary: bound })
    const moved = structuredClone(bound); moved.segments[0].control1.x += 100
    const current = applyCompositionCommands(historic, [{ type: 'upsertVisualBoundary', boundary: moved }], context()), { evidence } = capture(historic, current)
    expect(current.historyIdentity.outdoorTokens.sand).toEqual(historic.historyIdentity.outdoorTokens.sand)
    const plan = buildRestorePlan(current, historic, { ids: ['curve'], mode: 'visual' }, evidence)
    expect(plan.document.terrainAreas).toEqual(historic.document.terrainAreas)
    expect(plan.document.visual!.boundaries.curve).toEqual(bound)
    expect(plan.changes.map(change => change.id).sort()).toEqual(['curve', 'sand', 'water'])
    expect(plan.changes.find(change => change.id === 'water')!.layerId).toBe('effects')
    expect(plan.commandCost).toBeGreaterThan(3)
    expect(() => buildRestorePlan(current, historic, { ids: ['sand'], mode: 'outdoorGeometry' })).toThrow(/visual/)
  })

  it('rejects physical topology changes even when visual controls have the same IDs', () => {
    const bound = curve(); bound.binding = { kind: 'path', pathId: 'road' }
    const historic = content({ type: 'createPath', id: 'road', floorId: 'floor', centerlineMm: [p(12000, 1000), p(12000, 17000)], widthMm: 400, supportRefs: [{ kind: 'floor', id: 'floor' }] }, { type: 'upsertVisualBoundary', boundary: bound })
    const current = applyCompositionCommands(historic, [{ type: 'upsertVisualBoundary', boundary: { ...bound, sampleSpacingMm: 700 } }], context()), { evidence } = capture(historic, current)
    expect(() => buildRestorePlan(current, historic, { ids: ['curve'], mode: 'visual' }, evidence)).toThrow(/拓扑/)
  })

  it('refuses forged, stale, reopened and destructive same-ID witnesses', () => {
    const historic = content({ type: 'upsertVisualLight', light: light() }), current = applyCompositionCommands(historic, [{ type: 'upsertVisualLight', light: { ...light(), intensity: .6 } }], context())
    expect(() => buildRestorePlan(current, historic, { ids: ['light'], mode: 'visual' }, { visualContinuity: Object.freeze({ snapshotId: 'snapshot' }) })).toThrow(/连续性/)
    const { session, evidence } = capture(historic, current)
    session.advance(current.document, structuredClone(current.document))
    expect(() => assertVisualContinuity(evidence.visualContinuity, current.document, historic.document, ['light'])).toThrow(/连续性/)
    session.reset(current.document)
    expect(() => session.prove('snapshot', 'hash', current.document, historic.document)).toThrow(/连续性/)
    const invalidated = capture(historic, current, ['light'])
    expect(() => buildRestorePlan(current, historic, { ids: ['light'], mode: 'visual' }, invalidated.evidence)).toThrow(/删除、重建/)
  })

  it('never regains continuity after real deletion/recreation or control-topology change-back', () => {
    const historic = content({ type: 'upsertVisualBoundary', boundary: curve() }, { type: 'upsertVisualLight', light: light() })
    const session = new VisualContinuitySession(); session.reset(historic.document); session.recordSnapshot('s', 'h', historic.document)
    const removed = applyCompositionCommands(historic, [{ type: 'removeVisualEffect', kind: 'light', id: 'light' }], context())
    session.advance(historic.document, removed.document)
    const recreated = applyCompositionCommands(removed, [{ type: 'upsertVisualLight', light: light() }], context())
    session.advance(removed.document, recreated.document)
    const different = curve(); different.segments[0].id = 'new-cubic'
    const changed = applyCompositionCommands(recreated, [{ type: 'upsertVisualBoundary', boundary: different }], context()); session.advance(recreated.document, changed.document)
    const reverted = applyCompositionCommands(changed, [{ type: 'upsertVisualBoundary', boundary: curve() }], context()); session.advance(changed.document, reverted.document)
    const evidence = { visualContinuity: session.prove('s', 'h', reverted.document, historic.document) }
    expect(() => buildRestorePlan(reverted, historic, { ids: ['light'], mode: 'visual' }, evidence)).toThrow(/删除、重建/)
    expect(() => buildRestorePlan(reverted, historic, { ids: ['curve'], mode: 'visual' }, evidence)).toThrow(/控制拓扑/)
  })

  it('checks local dependency locks and makes global environment restoration explicit', () => {
    const historic = content({ type: 'upsertVisualLight', light: light() }), current = applyCompositionCommands(historic, [{ type: 'setVisualEnvironment', environment: { ...emptyVisualSystem().environment, ambientOpacity: .3, ambientColor: '#445566' } }], context())
    const { evidence } = capture(historic, current), plan = buildRestorePlan(current, historic, { ids: [current.document.sceneId], mode: 'visual' }, evidence)
    expect(plan.document.visual!.environment).toEqual(historic.document.visual!.environment)
    const locked = structuredClone(current); locked.document.userLayers.effects.editLocked = true
    const lockedProof = capture(historic, locked).evidence
    expect(() => buildRestorePlan(locked, historic, { ids: [locked.document.sceneId], mode: 'visual' }, lockedProof)).toThrow(/锁定图层/)
  })

  it('inspects prepared geometry and cross-layer dependencies without consuming IDs or mutating bytes', () => {
    const historic = content({ type: 'createTerrainArea', id: 'near', floorId: 'floor', layerId: 'effects', boundaryMm: [p(2000, 2000), p(4000, 2000), p(4000, 4000), p(2000, 4000)] })
    const command = { type: 'upsertVisualLight' as const, light: light() }
    const current = applyCompositionCommands(historic, [command], context()), before = structuredClone(historic), after = structuredClone(current), allocated = sequence
    const impact = inspectVisualChanges(historic.document, current.document, [command])
    expect(impact.affectedIds).toContain('near'); expect(impact.layerIds).toEqual(['effects', 'layer'])
    expect(impact.createdIds).toEqual(['light']); expect(impact.commandCost).toBe(3)
    expect(historic).toEqual(before); expect(current).toEqual(after); expect(sequence).toBe(allocated)
    const locked = structuredClone(current); locked.document.terrainAreas.near.editLocked = true
    expect(() => buildRestorePlan(locked, current, { ids: ['light'], mode: 'visual' }, capture(current, locked).evidence)).toThrow(/锁定/)
  })

  it('enforces one cumulative 256-record restore budget across all selected curves', () => {
    const historicScene = blank(); historicScene.schemaVersion = 2; historicScene.visual = emptyVisualSystem()
    for (let index = 0; index < 64; index++) {
      const y = 1000 + index * 200
      historicScene.visual.boundaries[`curve-${index}`] = { ...common, id: `curve-${index}`, closed: false, binding: { kind: 'decoration' }, sampleSpacingMm: 1500, toleranceMm: 30,
        segments: Array.from({ length: 4 }, (_, segment) => ({ id: `cubic-${index}-${segment}`, start: p(1000 + segment * 4000, y), control1: p(2000 + segment * 4000, y), control2: p(4000 + segment * 4000, y), end: p(5000 + segment * 4000, y) })) }
    }
    const historic = createCompositionContent(historicScene, context()), current = structuredClone(historic)
    for (const boundary of Object.values(current.document.visual!.boundaries)) for (const segment of boundary.segments) { segment.control1.y += 10; segment.control2.y += 10 }
    const before = structuredClone(current), { evidence } = capture(historic, current)
    expect(() => buildRestorePlan(current, historic, { ids: Object.keys(historicScene.visual!.boundaries), mode: 'visual' }, evidence)).toThrow(/256/)
    expect(current).toEqual(before)
  })
})
