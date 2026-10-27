import type { SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyTerrainDocument } from './compose.js'
import { assertTerrainBudget, terrainCommandCost } from './cost.js'
import { createEmptyRegional, type GenerationReference } from './contracts.js'
import { generationInputHash, managedOutputHash } from './integrity.js'

const p = (x: number, y: number) => ({ x, y })
const rectangle = (left: number, top: number, right: number, bottom: number) => [p(left, top), p(right, top), p(right, bottom), p(left, bottom)]
const WIDTH_MM = 10_000_000, HEIGHT_MM = 8_000_000
const FLOOR = 'visual-floor', LAYER = 'visual-layer-ground'
const common = { floorId: FLOOR, layerId: LAYER, visibility: 'public' as const, editLocked: false }

/**
 * T0 contract/budget witness only. No regional symbols, artwork or generation UI
 * promised by T5 are implemented by this fixed land/river/ridge/forest vector.
 */
export function createRegionalFeasibilityVector(base: SceneDocument): { empty: SceneDocument; document: SceneDocument; cost: ReturnType<typeof terrainCommandCost> } {
  const checkedBase = validateSceneDocument(base)
  if (!checkedBase.ok || base.schemaVersion !== 2 || base.visual?.version !== 1) throw new Error('区域可达性向量须从完整有效v2空白创建。')
  for (const key of ['vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups'] as const) {
    if (Object.keys(base[key]).length) throw new Error('区域可达性向量不能覆盖物理场景实体。')
  }
  if (!base.floors[FLOOR] || !base.userLayers[LAYER] || base.userLayers[LAYER].editLocked) throw new Error('区域可达性向量Floor/图层缺失或已锁定。')
  const empty = emptyTerrainDocument(checkedBase.document)
  empty.exportBoundsMm = { x: 0, y: 0, width: WIDTH_MM, height: HEIGHT_MM }
  empty.floors[FLOOR].boundsMm = { ...empty.exportBoundsMm }
  empty.mapMode = 'regional'; empty.regional = createEmptyRegional()
  const document = cloneJson(empty), regional = document.regional!, generation = document.generation!
  const style = (fill: string, stroke = '#5D6B56', strokeWidthMm = 10000) => ({ fill, stroke, strokeWidthMm, opacity: 1 })
  regional.areas['regional-vector-land'] = { ...common, id: 'regional-vector-land', kind: 'land', boundaryMm: rectangle(0, 0, WIDTH_MM, HEIGHT_MM), style: style('#B8BE86'), relativeElevationMm: 0 }
  regional.areas['regional-vector-water'] = { ...common, id: 'regional-vector-water', kind: 'water', boundaryMm: [p(0, 0), p(WIDTH_MM, 0), p(WIDTH_MM, 1900000), p(7000000, 2200000), p(4500000, 1700000), p(2200000, 2100000), p(0, 1800000)], style: style('#86B2B7'), relativeElevationMm: 0 }
  regional.areas['regional-vector-forest'] = { ...common, id: 'regional-vector-forest', kind: 'forest', boundaryMm: [p(1500000, 3500000), p(3600000, 3000000), p(4200000, 5100000), p(2800000, 6100000), p(1000000, 5200000)], style: style('#617C58'), relativeElevationMm: null }
  generation.constraints['regional-vector-river-port'] = { id: 'regional-vector-river-port', floorId: FLOOR, visibility: 'public', strength: 'hard', kind: 'port', positionMm: p(5800000, HEIGHT_MM), directionDeg: 270, widthMm: 60000 }
  regional.lines['regional-vector-river'] = { ...common, id: 'regional-vector-river', kind: 'river', pointsMm: [p(5800000, HEIGHT_MM), p(5900000, 6500000), p(5200000, 4700000), p(5700000, 3300000), p(6200000, 2050000)].map((positionMm, index) => ({ id: `regional-vector-river-point-${index}`, positionMm })),
    displayWidthMm: 70000, actualWidthMm: 60000, portIds: ['regional-vector-river-port'], connectedLineIds: [], flow: 'forward', style: style('#86B2B7', '#588D98', 70000) }
  regional.lines['regional-vector-road'] = { ...common, id: 'regional-vector-road', kind: 'road', pointsMm: [p(700000, 7000000), p(2800000, 6500000), p(5400000, 6200000), p(8400000, 5600000)].map((positionMm, index) => ({ id: `regional-vector-road-point-${index}`, positionMm })),
    displayWidthMm: 30000, actualWidthMm: null, portIds: [], connectedLineIds: [], flow: 'none', style: style('#BAA27D', '#8E795C', 30000) }
  regional.lines['regional-vector-ridge'] = { ...common, id: 'regional-vector-ridge', kind: 'ridge', pointsMm: [p(6500000, 6900000), p(7200000, 5900000), p(7900000, 4300000)].map((positionMm, index) => ({ id: `regional-vector-ridge-point-${index}`, positionMm })),
    displayWidthMm: 50000, actualWidthMm: null, portIds: [], connectedLineIds: [], flow: 'none', style: style('#9E9577', '#80745B', 50000) }
  generation.recipes['regional-vector-recipe'] = { id: 'regional-vector-recipe', recipeVersion: 1, algorithmId: 'regional-feasibility-vector', algorithmVersion: 1, mapMode: 'regional', seed: 'regional-fixed-10x8km-v1',
    parameters: { terrainKind: 'mixed', seaElevationMm: 0, landElevationMm: 0, plateauElevationMm: 0, roughness: 0, densityFactor: 0, baySide: 'north' }, materials: [], props: [], precision: { sampleSpacingMm: 100000, toleranceMm: 10000, noiseCellMm: 100000 } }
  generation.intents['regional-vector-intent'] = { id: 'regional-vector-intent', floorId: FLOOR, visibility: 'public', boundsMm: { ...document.exportBoundsMm },
    skeleton: [{ id: 'regional-vector-land-skeleton', kind: 'landmass', positionMm: p(5000000, 4000000), radiusMm: 4000000, directionDeg: 0 },
      { id: 'regional-vector-river-skeleton', kind: 'channel', positionMm: p(5600000, 5000000), radiusMm: 3000000, directionDeg: 270 },
      { id: 'regional-vector-ridge-skeleton', kind: 'ridge', positionMm: p(7200000, 5900000), radiusMm: 2000000, directionDeg: 300 },
      { id: 'regional-vector-forest-skeleton', kind: 'forest', positionMm: p(2600000, 4500000), radiusMm: 1800000, directionDeg: 0 }], constraintIds: ['regional-vector-river-port'], preserveIds: [] }
  const targets: GenerationReference[] = [
    ...Object.keys(regional.areas).map(entityId => ({ kind: 'regionalArea' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
    ...Object.keys(regional.lines).map(entityId => ({ kind: 'regionalLine' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
    ...Object.keys(regional.landmarks).map(entityId => ({ kind: 'regionalLandmark' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
    ...Object.keys(regional.symbols).map(entityId => ({ kind: 'regionalSymbol' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
  ]
  generation.rules['regional-vector-rule'] = { ...common, id: 'regional-vector-rule', kind: 'regional', recipeRef: { id: 'regional-vector-recipe', version: 1 }, inputs: [], outputs: targets,
    parameters: { widthMm: WIDTH_MM, minWidthMm: 0, maxWidthMm: WIDTH_MM, roughness: 0, densityFactor: 0 }, state: 'paused', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  for (const [index, target] of targets.entries()) {
    const id = `regional-vector-owner-${index}`
    generation.ownership[id] = { id, outputKey: `regional-fixed-10x8km-v1/${target.kind}/${target.entityId}`, ruleId: 'regional-vector-rule', target,
      managedFields: ['geometry', 'properties', 'surface', 'source', 'membership', 'appearance'], manualFields: [], state: 'managed', birthToken: 'regional-vector-birth-v1' }
  }
  const rule = generation.rules['regional-vector-rule']
  rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
  const checked = validateSceneDocument(document)
  if (!checked.ok) throw new Error(`区域可达性向量无效：${checked.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  const cost = assertTerrainBudget(empty, checked.document)
  return { empty, document: checked.document, cost }
}
