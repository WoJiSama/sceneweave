import { describe, expect, it } from 'vitest'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { layerSceneV3 } from '../../../core/v3/test-fixtures'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { atmosphereComparison } from './atmosphere-comparison'

describe('temporary atmosphere comparison', () => {
  it('keeps actual geometry, private masks, materials and high-edge/contact shadows intact', () => {
    const scene = toCurrentSceneDocument({ ...layerSceneV3(), format: 'sceneweave-scene', schemaVersion: 1 }), source = projectScene(scene, 'gm')
    source.visual = { environment: { ...emptyVisualSystem().environment, ambientOpacity: .4, exposure: .6 }, boundsMm: source.bounds,
      boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [], suppressedTerrainEdgeIds: [], occluderRings: [], contactRings: [] }
    source.visual.lights.push({ id: 'light', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
      enabled: true, positionMm: { x: 100, y: 100 }, radiusMm: 1000, color: '#FFFFFF', intensity: 1, wallOcclusion: true })
    source.visual.fogs.push({ id: 'fog', floorId: 'floor', layerId: 'layer', visibility: 'public', editLocked: false,
      enabled: true, boundaryMm: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }], color: '#FFFFFF', opacity: .5, directionDeg: 0, scaleMm: 100, seed: 'fog' })
    source.visual.filters.push({ id: 'filter', enabled: true, preset: 'cool', exposure: .8, saturation: .8, contrast: .8, vignette: .1, grain: .1,
      seed: 'filter', targetRings: null, targetBoundsMm: source.bounds })
    const frozen = structuredClone(source), result = atmosphereComparison(source)
    expect(result.visual?.environment).toEqual({ ...source.visual.environment, ambientOpacity: 0, exposure: 1 })
    for (const key of ['terrain', 'walls', 'paths', 'masks', 'materials', 'assetIds'] as const) expect(result[key]).toBe(source[key])
    for (const key of ['boundaries', 'edgeLooks', 'occluderRings', 'contactRings'] as const) expect(result.visual![key]).toBe(source.visual[key])
    expect(result.visual!.lights).not.toBe(source.visual.lights)
    expect(result.visual!.fogs).not.toBe(source.visual.fogs)
    expect(result.visual!.filters).not.toBe(source.visual.filters)
    expect(result.visual).toMatchObject({ lights: [], fogs: [], filters: [] })
    expect(source).toEqual(frozen)
  })
  it('leaves player projections and scenes without a visual system unchanged', () => {
    const scene = toCurrentSceneDocument({ ...layerSceneV3(), format: 'sceneweave-scene', schemaVersion: 1 }), player = projectScene(scene, 'player'), gm = projectScene(scene, 'gm')
    expect(atmosphereComparison(player)).toBe(player)
    delete gm.visual
    expect(atmosphereComparison(gm)).toBe(gm)
  })
})
