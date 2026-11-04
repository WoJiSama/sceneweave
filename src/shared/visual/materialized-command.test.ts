import { describe, expect, it } from 'vitest'
import { applyCommands } from '../commands/commands.js'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { generateTerrainDocumentV5 } from '../terrain-generation/surface-generation.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { createCompositionContent } from '../appearance/graph.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import type { SceneDocument } from '../model/scene.js'
import type { MaterializedEdge } from '../terrain-generation/contracts.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { getLegacyVisual } from '../terrain-generation/composition-contracts.js'
import { applyVisualCommand, visualCommandCost } from './commands.js'
import { visualBase } from './base.js'
import { cloneJson } from '../validation/json.js'

const context = () => { let id = 0; return { ids: { nextId: () => `materialized-new-${id++}` }, clock: { now: () => '2026-11-02T00:00:00Z' } } }
const common = { floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public' as const, editLocked: false }
function fixture(version: 5 | 6 = 6): { scene: SceneDocument; edge: MaterializedEdge } {
  const source = createShoreBlankDocument('island', { sceneId: 'materialized-command', title: 'Cliff detail', now: '2026-11-02T00:00:00Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const generation = generateTerrainDocumentV5(source, { sceneId: source.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000, algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
  const terrain = composeTerrainDocument(source, generation, 'birth', TASK_BUDGET_PROFILES.standard).document
  const scene = { ...emptyCompositionDocument(terrain), schemaVersion: version, ...(version === 6 ? { decorations: {}, decorationClusters: {} } : {}) } as SceneDocument
  const start = { x: 4000, y: 4000 }, end = { x: 16000, y: 4000 }
  const boundary = { ...common, id: 'source-boundary', closed: false, segments: [{ id: 'source-segment', start, control1: start, control2: end, end }], sampleSpacingMm: 2000, toleranceMm: 50, binding: { kind: 'decoration' as const } }
  visualBase(scene)!.boundaries[boundary.id] = boundary
  const edge: MaterializedEdge = { ...common, id: 'detail-edge', boundaryId: boundary.id, inputHash: materializedBoundaryHash(boundary), kind: 'cliff',
    polygons: [[{ x: 4000, y: 4000 }, { x: 16000, y: 4000 }, { x: 16000, y: 4800 }, { x: 4000, y: 4800 }]],
    strokes: [{ id: 'detail-stroke', pointsMm: [{ x: 5000, y: 4300 }, { x: 9000, y: 4500 }, { x: 14000, y: 4350 }], widthMm: 45, color: '#D9C8A0', opacity: .4 }],
    materialRef: null, fillColor: '#737D76', opacity: .9 }
  return { scene, edge }
}

describe('strict native materialized-edge command', () => {
  it('saves explicit geometry without altering its source and counts geometry plus birth records', () => {
    const { scene, edge } = fixture(), before = cloneJson(scene), ids = context(), content = createCompositionContent(scene, ids)
    const result = applyCompositionCommands(content, [{ type: 'upsertMaterializedEdge', edge }], ids)
    expect(scene).toEqual(before)
    expect(visualBase(result.document)!.boundaries).toEqual(visualBase(scene)!.boundaries)
    expect(getLegacyVisual(result.document)!.materializedEdges[edge.id]).toEqual(edge)
    expect(result.historyIdentity.presentationTokens![edge.id].kind).toBe('materializedEdge')
    expect(result.historyIdentity.presentationTokens![edge.strokes[0].id].kind).toBe('materializedStroke')
    expect(visualCommandCost(scene, result.document)).toBeGreaterThanOrEqual(8)
    expect(terrainCommandCost(scene, result.document, { before: content, after: result }).total).toBeGreaterThan(visualCommandCost(scene, result.document))
    const impact = applyVisualCommand(cloneJson(scene), { type: 'upsertMaterializedEdge', edge }, context())
    expect(impact.createdIds).toContain(edge.id)
    expect(impact.affectedIds).toContain(edge.boundaryId)
    expect(impact.affectedIds).toContain(edge.strokes[0].id)
    expect(impact.layerIds).toContain(edge.layerId)
  })

  it('requires an explicit same-transaction replacement of the enabled legacy purpose', () => {
    const { scene, edge } = fixture(), visual = visualBase(scene)!
    visual.edgeLooks.legacy = { ...common, id: 'legacy', boundaryId: edge.boundaryId, kind: 'cliff', side: 'right', widthMm: 800, color: '#737D76', accentColor: '#D9C8A0', opacity: .9, intensity: .8, seed: 'legacy', repeatMm: 400, enabled: true }
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge }], context())).toThrow(/启用的同用途旧边带/)
    const after = applyCommands(scene, [{ type: 'upsertVisualEdgeLook', edgeLook: { ...visual.edgeLooks.legacy, enabled: false } }, { type: 'upsertMaterializedEdge', edge }], context())
    expect(getLegacyVisual(after)!.materializedEdges[edge.id]).toEqual(edge)
  })

  it('rejects old strict versions, stale sources, locks and occupied stroke identities', () => {
    const { scene, edge } = fixture()
    const { decorations: _decorations, decorationClusters: _clusters, ...oldScene } = cloneJson(scene)
    oldScene.schemaVersion = 4
    expect(() => applyCommands(oldScene, [{ type: 'upsertMaterializedEdge', edge }], context())).toThrow(/scene5–6/)
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge: { ...edge, inputHash: '0'.repeat(64) } }], context())).toThrow(/源hash|来源/)
    const locked = cloneJson(scene); visualBase(locked)!.boundaries[edge.boundaryId].editLocked = true
    expect(() => applyCommands(locked, [{ type: 'upsertMaterializedEdge', edge: { ...edge, inputHash: materializedBoundaryHash(visualBase(locked)!.boundaries[edge.boundaryId]) } }], context())).toThrow(/锁定/)
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge: { ...edge, strokes: [{ ...edge.strokes[0], id: edge.boundaryId }] } }], context())).toThrow(/ID|身份/)
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge: { ...edge, strokes: [{ ...edge.strokes[0], id: edge.id }] } }], context())).toThrow(/ID|身份/)
    const dense = { ...edge, polygons: [], strokes: [{ ...edge.strokes[0], pointsMm: Array.from({ length: 300 }, (_, index) => ({ x: 5000 + index * 10, y: 4400 })) }] }
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge: dense }], context())).toThrow(/256/)
  })

  it('never publishes a GM boundary and rejects duplicate saved purpose records', () => {
    const { scene, edge } = fixture(), boundary = visualBase(scene)!.boundaries[edge.boundaryId]
    boundary.visibility = 'gm'
    const privateEdge = { ...edge, inputHash: materializedBoundaryHash(boundary) }
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge: privateEdge }], context())).toThrow(/不得公开/)
    boundary.visibility = 'public'
    const existing = { ...edge, id: 'existing-edge', strokes: [{ ...edge.strokes[0], id: 'existing-stroke' }] }
    getLegacyVisual(scene)!.materializedEdges[existing.id] = existing
    expect(() => applyCommands(scene, [{ type: 'upsertMaterializedEdge', edge }], context())).toThrow(/只能保留一条/)
  })
})
