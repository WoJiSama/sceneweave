import { describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../../../platform/browser/content/shore-blank.js'
import { applyCommands } from '../../../commands/commands.js'
import { taskBudgetProfile } from '../../../budget/task-budget.js'
import { canonicalJson, cloneJson } from '../../../validation/json.js'
import { validateSceneDocument } from '../../../validation/scene.js'
import { propFootprint, polygonDistance, polygonInside, supportedPolygon, pathPolygon } from '../../../geometry/geometry.js'
import { checkTerrainRoute } from '../../../geometry/terrain-travel.js'
import { buildDecorationRegeneration } from '../../../decorations/generate.js'
import { propPaintPolygon } from '../../../appearance/presentation.js'
import { decorationAsProp } from '../../../decorations/geometry.js'
import { getLegacyGeneration } from '../../../terrain-generation/composition-contracts.js'
import { constraintInputHash } from '../../../terrain-generation/integrity.js'
import { resolveSurfaceRules } from '../../../surface-rules/resolve.js'
import type { PointMm, SceneDocument } from '../../../model/scene.js'
import { forestRectangle, runForestGeneration, type ForestGenerationInput } from './index.js'

const stamp = '2026-11-05T00:00:00.000Z', floorId = 'visual-floor', layerId = 'visual-layer-ground'
const options = { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 }
const rect = (x: number, y: number, width: number, height: number): PointMm[] => forestRectangle({ x, y, width, height })
const source = () => createShoreBlankDocument('island', { sceneId: 'forest-test', title: '森林营地', now: stamp,
  widthMm: 32000, heightMm: 24000, preset: 'narrative' }, true, true)
const runtime = () => {
  let sequence = 0
  return { ids: { nextId: () => `forest-test-native-${++sequence}` }, clock: { now: () => stamp } }
}
function request(): ForestGenerationInput {
  return { version: 1, algorithmVersion: 1, seed: 'forest-stable', parameters: {
    floorId, layerId, boundsMm: { x: 2000, y: 2000, width: 28000, height: 20000 },
    ground: { kind: 'new', elevationMm: 0, materialRef: null },
    zones: [{ id: 'woods', supportRef: { kind: 'generated-ground' }, boundaryMm: rect(2500, 2500, 27000, 19000), vegetation: [
      { role: 'tree', coveragePpm: 80000, spacingMm: 450, clusterRadiusMm: 6500, clearanceMm: 100,
        palette: [{ key: 'tree', kind: 'prop', definitionRef: { id: 'terrain-variants-v2-prop-tree-highland-copse', version: 1 }, weight: 1 }] },
      { role: 'shrub', coveragePpm: 10000, spacingMm: 250, clusterRadiusMm: 4500, clearanceMm: 100,
        palette: [{ key: 'shrub', kind: 'decoration', definitionRef: { id: 'terrain-variants-v1-prop-shrub-heath-mound', version: 1 }, weight: 1 }] },
      { role: 'grass', coveragePpm: 3000, spacingMm: 150, clusterRadiusMm: 3000, clearanceMm: 100,
        palette: [{ key: 'grass', kind: 'decoration', definitionRef: { id: 'terrain-variants-v1-prop-grass-sedge-fan', version: 1 }, weight: 1 }] },
    ] }],
    clearings: [{ id: 'camp', supportRef: { kind: 'generated-ground' }, boundaryMm: rect(20000, 9000, 6000, 6000), anchorMm: { x: 23000, y: 12000 }, clearanceMm: 200 }],
    entrances: [{ id: 'west', supportRef: { kind: 'generated-ground' }, positionMm: { x: 4000, y: 12000 }, directionDeg: 0, widthMm: 1600 }],
    routes: [{ id: 'approach', fromEntranceId: 'west', toClearingId: 'camp', viaMm: [], widthMm: 1200, materialRef: null }],
  } }
}
function onExistingGround(): { base: SceneDocument; input: ForestGenerationInput } {
  const base = applyCommands(source(), [{ type: 'createTerrainArea', id: 'existing-ground', floorId, layerId,
    boundaryMm: rect(2000, 2000, 28000, 20000), groundElevationMm: 0, coveragePriority: 1 }], runtime())
  const input = request(), supportRef = { kind: 'terrainArea' as const, id: 'existing-ground' }
  input.parameters.ground = { kind: 'existing' }
  for (const row of [...input.parameters.zones, ...input.parameters.clearings, ...input.parameters.entrances]) row.supportRef = { ...supportRef }
  return { base, input }
}

describe('forest clearings, real routes and vegetation', () => {
  it('preserves the algorithm 1 full replay captured from the frozen original source', () => {
    const result = runForestGeneration(source(), request(), options)
    expect(result.resultHash).toBe('6cb7de658f9020208944355360be36300439a2058b16563082152ba549e88b9d')
    expect(result.candidate.documentHash).toBe('459e0e67aa47feebe0927937633a46619ef7fcce4eb527fbdfd60b66103771a6')
    expect(result.candidate.outputHash).toBe('b3b90b99f591792a743090912d20a016b572975f0f26ae2303439c1f5b89b934')
  }, 30000)

  it('generates the default Workbench forest request with real route clearance', () => {
    const base = source(), before = canonicalJson(base), input = request(), p = input.parameters
    input.seed = 'forest-1'
    p.boundsMm = { x: 0, y: 0, width: 32000, height: 24000 }
    p.ground = { kind: 'new', elevationMm: 0, materialRef: { id: 'shore-v1-material-grass', version: 1 } }
    p.zones[0].id = 'woodland'
    p.zones[0].boundaryMm = rect(0, 0, 32000, 24000)
    Object.assign(p.zones[0].vegetation[0], { spacingMm: 2500, clusterRadiusMm: 6000, clearanceMm: 200 })
    p.zones[0].vegetation[0].palette[0].key = 'tree-highland-copse'
    Object.assign(p.zones[0].vegetation[1], { spacingMm: 800, clusterRadiusMm: 4000, clearanceMm: 180 })
    p.zones[0].vegetation[1].palette[0].key = 'shrub-heath-mound'
    Object.assign(p.zones[0].vegetation[2], { coveragePpm: 1000, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 180 })
    p.zones[0].vegetation[2].palette[0].key = 'grass-sedge-fan'
    p.clearings[0] = { id: 'clearing-1', supportRef: { kind: 'generated-ground' }, boundaryMm: rect(12000, 9000, 8000, 6000), anchorMm: { x: 16000, y: 12000 }, clearanceMm: 300 }
    p.entrances[0] = { id: 'entry', supportRef: { kind: 'generated-ground' }, positionMm: { x: 1200, y: 12000 }, directionDeg: 0, widthMm: 1800 }
    p.routes[0] = { id: 'route:clearing-1', fromEntranceId: 'entry', toClearingId: 'clearing-1', viaMm: [], widthMm: 1800, materialRef: { id: 'shore-v1-material-sand-dry', version: 1 } }
    const result = runForestGeneration(base, input, options), document = cloneJson(result.candidate.document) as SceneDocument
    expect(result.report.pathIds).toHaveLength(1)
    expect(result.report.propIds.length).toBeGreaterThan(0)
    expect(validateSceneDocument(document).ok).toBe(true)
    for (const pathId of result.report.pathIds) {
      const path = document.paths[pathId]
      expect(polygonInside(pathPolygon(path), forestRectangle(p.boundsMm))).toBe(true)
      expect(checkTerrainRoute(document, { floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
    }
    for (const prop of [...Object.values(document.props), ...Object.values(document.decorations).map(row => decorationAsProp(document, row))]) {
      // Native scene validation includes the full rotated image rectangle, even
      // when its physical trunk/footprint and exact presentation remain inside.
      expect(polygonInside(propPaintPolygon(prop), forestRectangle(document.floors[prop.floorId].boundsMm))).toBe(true)
    }
    expect(canonicalJson(base)).toBe(before)
  }, 30000)

  it('is deterministic, changes actual paths and vegetation with camp/entrance requests, and preserves full clearance', () => {
    const base = source(), before = canonicalJson(base), input = request(), first = runForestGeneration(base, input, options)
    expect(runForestGeneration(base, input, options)).toEqual(first)
    expect(canonicalJson(base)).toBe(before)
    expect(first.candidate.stages.map(stage => stage.stepId)).toEqual(['ground', 'routes', 'vegetation'])
    expect(first.report.pathIds).toHaveLength(1)
    expect(first.report.propIds.length).toBeGreaterThan(1)
    expect(first.report.decorationIds.length).toBeGreaterThan(0)
    expect(validateSceneDocument(first.candidate.document).ok).toBe(true)
    const changed = request()
    changed.parameters.clearings[0] = { ...changed.parameters.clearings[0], boundaryMm: rect(13000, 15000, 6000, 6000), anchorMm: { x: 16000, y: 18000 } }
    changed.parameters.entrances[0].positionMm = { x: 16000, y: 4000 }
    changed.parameters.entrances[0].directionDeg = 90
    const second = runForestGeneration(base, changed, options)
    expect(second.candidate.document.paths[second.report.pathIds[0]].centerlineMm).not.toEqual(first.candidate.document.paths[first.report.pathIds[0]].centerlineMm)
    expect(second.candidate.document.props).not.toEqual(first.candidate.document.props)
    for (const result of [first, second]) {
      const document = cloneJson(result.candidate.document) as SceneDocument, p = result.input.parameters
      for (const pathId of result.report.pathIds) {
        const path = document.paths[pathId]
        expect(checkTerrainRoute(document, { floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }).ok).toBe(true)
      }
      for (const row of result.report.vegetation) {
        const cluster = document.decorationClusters[row.clusterId], zone = p.zones.find(zone => zone.id === row.zoneId)!
        for (const member of Object.values(cluster.members)) if (member.entityId) {
          const prop = member.kind === 'prop' ? document.props[member.entityId] : decorationAsProp(document, document.decorations[member.entityId])
          const footprint = propFootprint(prop)
          expect(supportedPolygon(document, footprint, cluster.supportRef, floorId)).toBe(true)
          expect(polygonInside(footprint, zone.boundaryMm)).toBe(true)
          for (const clearing of p.clearings) expect(polygonDistance(footprint, clearing.boundaryMm)).toBeGreaterThanOrEqual(clearing.clearanceMm)
          for (const pathId of result.report.pathIds) expect(polygonDistance(footprint, pathPolygon(document.paths[pathId]))).toBeGreaterThan(0)
        }
      }
    }
  }, 30000)

  it('uses explicitly selected existing ground, and rejects a blocked route or unsupported elevation crossing', () => {
    const { base, input } = onExistingGround(), legacy = getLegacyGeneration(base)!
    legacy.constraints['old-activity'] = { id: 'old-activity', floorId, visibility: 'public', strength: 'soft', kind: 'activityArea', boundaryMm: rect(100, 100, 1000, 1000), clearanceMm: 100 }
    legacy.checks['old-receipt'] = { id: 'old-receipt', constraintId: 'old-activity', state: 'passed', algorithmId: 'terrain-activity', algorithmVersion: 1, inputHash: constraintInputHash(base, 'old-activity'), issues: [] }
    expect(validateSceneDocument(base).ok).toBe(true)
    const before = canonicalJson(base), result = runForestGeneration(base, input, options)
    const resultDocument = cloneJson(result.candidate.document) as SceneDocument
    expect(getLegacyGeneration(resultDocument)!.checks['old-receipt'].state).toBe('unchecked')
    expect(legacy.checks['old-receipt'].state).toBe('passed')
    expect(getLegacyGeneration(resultDocument)!.constraints['old-activity']).toEqual(legacy.constraints['old-activity'])
    expect(result.report.groundAreaId).toBeNull()
    expect(result.candidate.document.terrainAreas['existing-ground']).toEqual(base.terrainAreas['existing-ground'])
    expect(result.report.propIds.length).toBeGreaterThan(0)
    const blocked = applyCommands(base, [{ type: 'createRegion', id: 'route-blocker', floorId, layerId,
      boundaryMm: rect(10000, 10000, 4000, 4000), kind: 'hazard', blocksMovement: true }], runtime())
    const blockedBefore = canonicalJson(blocked)
    expect(() => runForestGeneration(blocked, input, options)).toThrow(/净宽|路线|阻挡/)
    expect(canonicalJson(blocked)).toBe(blockedBefore)
    const stepped = applyCommands(base, [{ type: 'createTerrainArea', id: 'upper-ground', floorId, layerId,
      boundaryMm: rect(16000, 4000, 12000, 16000), groundElevationMm: 1000, coveragePriority: 2 }], runtime())
    const crossing = cloneJson(input)
    crossing.parameters.zones[0].boundaryMm = rect(2500, 2500, 10000, 19000)
    crossing.parameters.clearings[0].supportRef = { kind: 'terrainArea', id: 'upper-ground' }
    expect(() => runForestGeneration(stepped, crossing, options)).toThrow(/路线|高差|连接/)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)

  it('records native movement and deletion and never revives those slots during vegetation regeneration', () => {
    const generated = runForestGeneration(source(), request(), options), document = cloneJson(generated.candidate.document) as SceneDocument
    const treeReport = generated.report.vegetation.find(row => row.role === 'tree')!, cluster = document.decorationClusters[treeReport.clusterId]
    const entries = Object.entries(cluster.members).filter(([, member]) => member.entityId && member.state === 'managed')
    expect(entries.length).toBeGreaterThan(1)
    const [movedKey, moved] = entries[0], [deletedKey, deleted] = entries[1], movedId = moved.entityId!, deletedId = deleted.entityId!
    const positionMm = { x: document.props[movedId].positionMm.x + 1, y: document.props[movedId].positionMm.y }
    // Ordinary manual commands retain the native 256 limit; do not supply the
    // generation task budget or split this two-command user transaction.
    const observedCosts: number[] = []
    const edited = applyCommands(document, [{ type: 'updateProp', id: movedId, changes: { positionMm } }, { type: 'deleteProp', id: deletedId }], runtime(), {
      onSceneDraft: (_draft, _command, cost) => observedCosts.push(cost),
    })
    expect(observedCosts).toHaveLength(2)
    expect(observedCosts.reduce((sum, cost) => sum + cost, 0)).toBeLessThanOrEqual(256)
    const standaloneDeleted = applyCommands(document, [{ type: 'deleteProp', id: deletedId }], runtime())
    expect(standaloneDeleted.props[deletedId]).toBeUndefined()
    expect(edited.decorationClusters[cluster.id].members[movedKey]).toMatchObject({ state: 'manual', entityId: movedId })
    expect(edited.decorationClusters[cluster.id].members[deletedKey]).toEqual({ state: 'deleted', entityId: null, kind: 'prop' })
    const owners = Object.values(getLegacyGeneration(edited)!.ownership)
    expect(owners.find(row => row.target.entityId === movedId)!.state).toBe('manual')
    expect(owners.find(row => row.target.entityId === deletedId)!.state).toBe('deleted')
    const rule = edited.surfaceRules[treeReport.ruleId]
    if (rule.field === 'material') throw new Error('expected a tree vegetation rule')
    const resolved = resolveSurfaceRules(edited).find(row => row.rule.id === rule.id)!
    const before = canonicalJson(edited), replay = buildDecorationRegeneration(edited, edited.decorationClusters[cluster.id], runtime(), undefined,
      { coveragePpm: rule.coveragePpm, polygons: resolved.regionsMm.map(region => ({ outer: region.outerMm, holes: region.holesMm })) })
    expect(replay.cluster.members[movedKey]).toMatchObject({ state: 'manual', entityId: movedId })
    expect(replay.cluster.members[deletedKey]).toEqual({ state: 'deleted', entityId: null, kind: 'prop' })
    expect(replay.props.some(prop => prop.id === movedId || prop.id === deletedId)).toBe(false)
    expect(edited.props[movedId].positionMm).toEqual(positionMm)
    expect(edited.props[deletedId]).toBeUndefined()
    expect(canonicalJson(edited)).toBe(before)
    expect(validateSceneDocument(edited).ok).toBe(true)
  }, 30000)

  it('reports a finite density shortfall, and rejects excessive targets or cancellation without publishing', () => {
    const base = source(), before = canonicalJson(base), sparse = request()
    sparse.parameters.zones[0].vegetation = sparse.parameters.zones[0].vegetation.filter(row => row.role === 'tree')
    sparse.parameters.zones[0].vegetation[0].spacingMm = 40000
    const result = runForestGeneration(base, sparse, options), row = result.report.vegetation[0]
    expect(row.requested).toBeGreaterThan(row.placed)
    expect(result.report.notes.join('')).toContain('实际')
    const excessive = request(); excessive.parameters.zones[0].vegetation[0].coveragePpm = 1_000_000
    expect(() => runForestGeneration(base, excessive, options)).toThrow(/64|预算|保护/)
    expect(() => runForestGeneration(base, request(), { ...options, signal: { aborted: true } })).toThrow(/取消/)
    expect(canonicalJson(base)).toBe(before)
  }, 30000)
})
