import { describe, expect, it } from 'vitest'
import data from '../../platform/browser/content/scenes-data.json'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { sceneSchema } from '../validation/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { taskBudgetProfile } from '../budget/task-budget.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { defaultVolcanoInput, runVolcanoGeneration, volcanoEntityId } from './domains/volcano/index.js'
import { regenerateVolcanoSurface } from './local-volcano.js'

const stamp = '2026-11-05T00:00:00.000Z'
const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture() {
  const base = createShoreBlankDocument('island', { sceneId: 'mixed-volcano-dependencies', title: '火口与人工建筑', now: stamp, widthMm: 40000, heightMm: 32000, preset: 'narrative' })
  for (const id of ['content-m-basalt', 'content-m-volcanic-ash', 'content-m-lava', 'content-m-lava-hot']) {
    const material = data.scenes.volcano.document.materials[id as keyof typeof data.scenes.volcano.document.materials]
    base.materials[id] = sceneSchema.shape.materials.valueType.parse(material)
    base.assets[material.textureAssetId] = sceneSchema.shape.assets.valueType.parse(data.scenes.volcano.document.assets[material.textureAssetId as keyof typeof data.scenes.volcano.document.assets])
  }
  let sequence = 0
  const runtime = { clock: { now: () => stamp }, ids: { nextId: () => `mixed-manual-${++sequence}` } }
  const input = defaultVolcanoInput(base), result = runVolcanoGeneration(base, input, { profile: taskBudgetProfile('standard'), nowMilliseconds: () => 0 })
  let content = createCompositionContent(cloneJson(result.candidate.document) as typeof base, runtime)
  content = applyCompositionCommands(content, [{ type: 'createRoom', id: 'manual-building', floorId: input.parameters.floorId, layerId: input.parameters.layerId,
    boundaryMm: rectangle(23000, 10000, 3500, 3500), thicknessMm: 200, supportRef: { kind: 'terrainArea', id: result.report.craterAreaId }, purpose: '人工研究室' }], runtime)
  const wall = Object.values(content.document.walls).find(row => content.document.vertices[row.startVertexId].yMm === 10000 && content.document.vertices[row.endVertexId].yMm === 10000)!
  content = applyCompositionCommands(content, [
    { type: 'addOpening', id: 'manual-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1250, widthMm: 1000, kind: 'door', state: 'closed', locked: true },
    { type: 'createPath', id: 'manual-approach', floorId: input.parameters.floorId, layerId: input.parameters.layerId, centerlineMm: [{ x: 24000, y: 16000 }, { x: 24500, y: 14500 }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: result.report.craterAreaId }] },
  ], runtime)
  return { content, runtime, result, recipeId: volcanoEntityId(base.sceneId, input.seed, 'recipe') }
}

describe('mixed volcanic structural dependencies', () => {
  it('lists real manual building/door/support dependencies while retaining closed locked doors and all building geometry', () => {
    const { content, runtime, result, recipeId } = fixture(), before = canonicalJson(content), areaId = result.report.craterAreaId
    const positionsMm = content.document.terrainAreas[areaId].boundaryMm.map(row => ({ ...row.positionMm }))
    positionsMm[0].y += 200; positionsMm[1].y += 200
    const changed = regenerateVolcanoSurface(content, { operation: 'volcano-boundary', recipeId, areaId, positionsMm }, runtime, () => {})
    expect(changed.readIds).toEqual(expect.arrayContaining(['manual-building', 'manual-door', 'manual-approach', areaId, 'visual-floor', 'visual-layer-ground',
      ...Object.keys(content.document.walls), ...content.document.rooms['manual-building'].boundaryVertexIds]))
    for (const collection of ['rooms', 'walls', 'openings', 'paths', 'terrainConnections'] as const) expect(changed.document[collection]).toEqual(content.document[collection])
    expect(canonicalJson(content)).toBe(before)
  })
  it('rejects a crater edit that invalidates a manual building support without moving the building or publishing a partial result', () => {
    const { content, runtime, result, recipeId } = fixture(), before = canonicalJson(content), areaId = result.report.craterAreaId
    const positionsMm = content.document.terrainAreas[areaId].boundaryMm.map(row => ({ ...row.positionMm }))
    positionsMm[0].y += 500; positionsMm[1].y += 500
    expect(() => regenerateVolcanoSurface(content, { operation: 'volcano-boundary', recipeId, areaId, positionsMm }, runtime, () => {})).toThrow(/支撑|高程|厚墙/)
    expect(canonicalJson(content)).toBe(before)
  })
  it('preserves the native refusal when the supported manual building has an edit lock', () => {
    const { content, runtime, result, recipeId } = fixture(), areaId = result.report.craterAreaId
    const locked = applyCompositionCommands(content, [{ type: 'setEditLock', kind: 'room', id: 'manual-building', locked: true }], runtime), before = canonicalJson(locked)
    const positionsMm = locked.document.terrainAreas[areaId].boundaryMm.map(row => ({ ...row.positionMm }))
    positionsMm[0].y += 200; positionsMm[1].y += 200
    expect(() => regenerateVolcanoSurface(locked, { operation: 'volcano-boundary', recipeId, areaId, positionsMm }, runtime, () => {})).toThrow(/锁定/)
    expect(canonicalJson(locked)).toBe(before)
  })
})
