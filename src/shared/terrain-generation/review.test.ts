import { describe, expect, it } from 'vitest'
import { createT8SampleDocument } from '../../../tools/testing/terrain-t8-fixtures.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { SceneDocument } from '../model/scene.js'
import { createEmptyGeneration5, getLegacyGeneration, getLegacyVisual } from './composition-contracts.js'
import { terrainRecordChanges } from './review.js'

// Typed snapshots isolate review semantics; these are not adoption receipts.
function compositionReviewScene(): SceneDocument {
  const legacy = createT8SampleDocument('archipelago-coast')
  return { ...legacy, schemaVersion: 4, generation: createEmptyGeneration5(getLegacyGeneration(legacy)),
    visual: { version: 3, base: getLegacyVisual(legacy)!, transitions: {} } }
}

describe('terrain composition persisted change review', () => {
  it('includes complete feature/check changes alongside inherited legacy records', () => {
    const before = compositionReviewScene(), after = cloneJson(before)
    if (after.generation?.version !== 5) throw new Error('fixture')
    after.generation.features.island = { id: 'island', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public', editLocked: false,
      kind: 'landmass', shape: { kind: 'ellipse', centerMm: { x: 12000, y: 12000 }, radiusXMm: 5000, radiusYMm: 4000, rotationMilliDeg: 0 }, elevationMm: 600, roughnessPpm: 100000, seedKey: 'island' }
    after.generation.checks['composition-check'] = { id: 'composition-check', requirementId: 'island-count', algorithmId: 'terrain-requirement', algorithmVersion: 1,
      state: 'failed', inputHash: 'a'.repeat(64), issues: [{ code: 'COMPONENT_COUNT', message: '实际分量不符。', entityId: null }] }
    after.generation.legacy.exclusions.preserve = { id: 'preserve', key: 'preserve', floorId: 'visual-floor', visibility: 'public', boundaryMm: [{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 2000 }], reason: 'manual', candidateKey: null, birthToken: null }
    const original = canonicalJson(before), changes = terrainRecordChanges(before, after)
    expect(changes.map(change => `${change.collection}/${change.id}`)).toEqual(['generation.exclusions/preserve', 'generation5.features/island', 'generation5.checks/composition-check'])
    expect(changes.find(change => change.id === 'island')?.after).toEqual(after.generation.features.island)
    expect(changes.find(change => change.id === 'composition-check')?.after).toMatchObject({ state: 'failed', issues: [{ code: 'COMPONENT_COUNT' }] })
    expect(canonicalJson(before)).toBe(original)
  })

  it('reviews inherited materialized edges and new explicit transitions without hiding either wrapper', () => {
    const before = compositionReviewScene(), after = cloneJson(before)
    if (after.visual?.version !== 3) throw new Error('fixture')
    const p = [{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 2000 }]
    after.visual.base.materializedEdges['legacy-shore'] = { id: 'legacy-shore', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public', editLocked: false,
      boundaryId: 'legacy-boundary', inputHash: 'a'.repeat(64), kind: 'shore', polygons: [p], strokes: [], materialRef: null, fillColor: '#AABBCC', opacity: .5 }
    after.visual.transitions.shore = { id: 'shore', floorId: 'visual-floor', layerId: 'visual-layer-ground', visibility: 'public', editLocked: false, enabled: true,
      boundaryId: 'composition-boundary', kind: 'shore', side: 'left', leftSurface: 'sand', rightSurface: 'water', leftElevationMm: 600, rightElevationMm: 0, widthMm: 500,
      distanceSource: { algorithmId: 'terrain-distance', algorithmVersion: 1, metric: 'euclidean-mm', boundaryHash: 'b'.repeat(64), clipMm: before.exportBoundsMm, reachMm: 1000, sampleSpacingMm: 100, inputHash: 'c'.repeat(64) },
      polygons: [{ id: 'shore-polygon', pointsMm: p, fillColor: '#DDBB99', opacity: .4, materialRef: null }], strokes: [], inputHash: 'd'.repeat(64), outputHash: 'e'.repeat(64) }
    expect(terrainRecordChanges(before, after).map(change => `${change.collection}/${change.id}`)).toEqual(['visual.materializedEdges/legacy-shore', 'visual3.transitions/shore'])
    expect(terrainRecordChanges(before, cloneJson(before))).toEqual([])
  })
})
