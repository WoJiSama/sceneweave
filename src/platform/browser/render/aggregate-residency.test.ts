import { describe, expect, it } from 'vitest'
import { buildAggregateChunkManifest, planAggregateChunks } from '../../../shared/aggregates/chunks.js'
import { createAggregateDerivedResidency, editorResidentAssetIds } from './aggregate-residency.js'
import { createEditorRenderPlan } from './editor-render-plan.js'
import type { Projection } from '../../../shared/projection/types.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { layerSceneV3 } from '../../../core/v3/test-fixtures.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'

describe('editor derived chunk residency', () => {
  it('materializes only demanded entries, deduplicates spanning content and loads explicit far selections', () => {
    const manifest = buildAggregateChunkManifest([
      { id: 'near', floorId: 'floor', boundsMm: { x: 0, y: 0, width: 9000, height: 100 } },
      { id: 'far', floorId: 'floor', boundsMm: { x: 100000, y: 0, width: 100, height: 100 } },
    ])
    const called: string[] = [], residency = createAggregateDerivedResidency(manifest, id => { called.push(id); return { id } })
    expect(residency.residency().every(row => row.state === 'unloaded')).toBe(true)
    residency.ensure(planAggregateChunks(manifest, { floorId: 'floor', boundsMm: { x: 0, y: 0, width: 100, height: 100 } }))
    residency.ensure(planAggregateChunks(manifest, { floorId: 'floor', boundsMm: { x: 8000, y: 0, width: 100, height: 100 } }))
    expect(called).toEqual(['near'])
    expect(residency.materialize('far')).toEqual({ id: 'far' })
    expect(called).toEqual(['near', 'far'])
    residency.clear(); residency.materialize('near')
    expect(called).toEqual(['near', 'far', 'near'])
  })

  it('surfaces failed or missing cells and never publishes a partial derived result as resident', () => {
    const manifest = buildAggregateChunkManifest([{ id: 'bad', floorId: 'floor', boundsMm: { x: 0, y: 0, width: 1, height: 1 } }])
    let attempts = 0
    const residency = createAggregateDerivedResidency(manifest, () => { attempts++; throw new Error('missing bytes') })
    expect(() => residency.materialize('bad')).toThrow(/missing bytes/)
    expect(residency.residency()).toContainEqual(expect.objectContaining({ state: 'failed', reason: 'missing bytes' }))
    expect(() => residency.materialize('bad')).toThrow(/missing bytes/)
    expect(attempts).toBe(2)
    expect(() => residency.ensure({ sourceHash: manifest.sourceHash, entityIds: [], keys: [{ floorId: 'floor', x: 999, y: 999 }] })).toThrow(/不能当作空白/)
  })

  it('defers only exclusively offscreen prop bitmap decode and preserves material/shared image consumers', () => {
    const scene = toCurrentSceneDocument({ ...structuredClone(layerSceneV3()), format: 'sceneweave-scene' })
    const projection = projectScene(scene, 'gm') as Projection
    const original = projection.props[0]
    projection.props = [
      { ...original, id: 'near', positionMm: { x: 1000, y: 1000 }, appearance: { ...original.appearance, kind: 'image', assetId: 'near-image' } },
      { ...original, id: 'far', positionMm: { x: 15000, y: 15000 }, appearance: { ...original.appearance, kind: 'image', assetId: 'far-image' } },
    ]
    projection.assetIds = ['near-image', 'far-image', 'other-domain']
    const plan = createEditorRenderPlan(projection, { viewBoundsMm: { x: 0, y: 0, width: 3000, height: 3000 }, screenScalePxPerMm: .1 })
    expect(editorResidentAssetIds(projection, plan)).toEqual(new Set(['near-image', 'other-domain']))
    projection.materials.texture = { id: 'texture', version: 1, textureAssetId: 'far-image' }
    projection.rooms[0] = { id: 'room', points: [], elevationMm: 0, priority: 0, style: { base: { materialRef: { id: 'texture', version: 1 } }, overlays: [] } as never }
    expect(editorResidentAssetIds(projection, plan)).toEqual(new Set(['near-image', 'far-image', 'other-domain']))
    expect(projection.assetIds).toEqual(['near-image', 'far-image', 'other-domain'])
  })
})
