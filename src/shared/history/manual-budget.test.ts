import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { createCompositionContent, resolveAppearance } from '../appearance/graph.js'
import { MANUAL_TRANSACTION_BUDGET, manualChangedTargets } from '../budget/command-budget.js'
import { cloneJson } from '../validation/json.js'
import { buildRestorePlan } from './restore.js'
import { StructureContinuitySession } from './structure-continuity.js'
import { buildStructureRestorePlan, inspectStructureRestoreScope } from './structure-restore.js'

describe('manual restore budget', () => {
  // The 256-point path undergoes repeated complete geometry validation for legacy rejection, restore and lock rejection.
  it('restores one long path under its independent geometry budget while retaining legacy limits', () => {
    const scene = cloneJson(fixture().project.document), layerId = scene.entityLayers.item
    scene.paths.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public', widthMm: 400,
      centerlineMm: Array.from({ length: 256 }, (_, i) => ({ x: 1000 + i * 20, y: 6000 })), supportRefs: [{ kind: 'floor', id: 'blank-floor' }],
      surfaceStyle: null, renderOrder: 0, movementCostMultiplier: 1 }
    scene.entityLayers.road = layerId
    const historic = createCompositionContent(scene, runtime), current = cloneJson(historic)
    current.document.paths.road.centerlineMm.forEach(point => { point.y += 100 })
    const before = cloneJson(current)
    expect(() => buildRestorePlan(current, historic, { ids: ['road'], mode: 'outdoorGeometry' })).toThrow(/256/)
    const restored = buildRestorePlan(current, historic, { ids: ['road'], mode: 'outdoorGeometry' }, {}, MANUAL_TRANSACTION_BUDGET)
    expect(restored.commandCost).toBe(1)
    expect(restored.document.paths.road).toEqual(historic.document.paths.road)
    expect(restored.document.props).toEqual(current.document.props)
    expect(current).toEqual(before)
    current.document.userLayers[layerId].editLocked = true
    expect(() => buildRestorePlan(current, historic, { ids: ['road'], mode: 'outdoorGeometry' }, {}, MANUAL_TRANSACTION_BUDGET)).toThrow(/锁定/)
  }, 20000)

  it('still rejects a layer restore that changes more than 256 independent objects', () => {
    const scene = cloneJson(fixture().project.document), source = scene.props.item, layerId = scene.entityLayers.item
    scene.props = {}; scene.entityLayers = {}
    for (let i = 0; i < 257; i++) {
      const id = `prop-${i}`
      scene.props[id] = { ...cloneJson(source), id, positionMm: { x: 1000 + i * 50, y: 5000 }, renderOrder: i }
      scene.entityLayers[id] = layerId
    }
    const historic = createCompositionContent(scene, runtime), draft = cloneJson(historic)
    draft.appearance.layerAdjustments[layerId] = [{ id: 'layer-opacity', kind: 'opacity', value: .4, enabled: true }]
    const current = resolveAppearance(draft), before = cloneJson(current)
    expect(() => buildRestorePlan(current, historic, { ids: [layerId], mode: 'layer' }, {}, MANUAL_TRANSACTION_BUDGET)).toThrow(/semanticTargets.*257\/256/)
    expect(current).toEqual(before)
  })

  it('measures actual structure changes and retains exact confirmation and continuity requirements', () => {
    const historic = fixture({ building: true }).project, current = cloneJson(historic)
    current.document.walls['wall-0'].thicknessMm = 300
    const session = new StructureContinuitySession()
    session.reset(historic.document); session.recordSnapshot('snapshot', 'hash', historic.document); session.advance(historic.document, current.document)
    const proof = session.prove('snapshot', 'hash', current.document, historic.document)
    const request = { ids: ['wall-0'], mode: 'geometry' as const }
    const scope = inspectStructureRestoreScope(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, proof, MANUAL_TRANSACTION_BUDGET)
    expect(() => buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, proof, MANUAL_TRANSACTION_BUDGET)).toThrow(/依赖范围尚未完整确认/)
    const plan = buildStructureRestorePlan(current.document, current.historyIdentity, historic.document, historic.historyIdentity,
      { ...request, acknowledgedDependencyIds: scope.dependencyIds, confirmedLayerIds: scope.requiredLayerIds }, proof, MANUAL_TRANSACTION_BUDGET)
    expect(plan.document.walls['wall-0'].thicknessMm).toBe(200)
    expect(plan.commandCost).toBe(manualChangedTargets(current.document, plan.document).length)
    expect(plan.commandCost).toBeGreaterThan(0)
    expect(() => inspectStructureRestoreScope(current.document, current.historyIdentity, historic.document, historic.historyIdentity, request, { snapshotId: 'forged' }, MANUAL_TRANSACTION_BUDGET)).toThrow(/连续性/)
  })
})
