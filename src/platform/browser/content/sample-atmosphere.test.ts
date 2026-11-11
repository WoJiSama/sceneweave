import { describe, expect, it } from 'vitest'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { createThemePackSampleDocument } from './theme-pack-catalog.js'
import { applySampleAtmosphere, SAMPLE_ATMOSPHERE_PROFILES, type SampleAtmosphereProfileId } from './sample-atmosphere.js'

const fixture = (profile: SampleAtmosphereProfileId) => profile === 'outpost-daylight'
  ? createThemePackSampleDocument('wilderness', 0) : createRefinedIslandDocument()
const profiles = ['outpost-daylight', 'island-daylight'] as const

describe('new sample daylight composition', () => {
  it.each(profiles)('changes only the explicit %s environment and known source effects', profile => {
    const original = fixture(profile), before = structuredClone(original), after = applySampleAtmosphere(original, profile)
    expect(original).toEqual(before)
    const expected = structuredClone(before)
    visualBase(expected)!.environment = { ...SAMPLE_ATMOSPHERE_PROFILES[profile].environment }
    if (profile === 'island-daylight') {
      delete visualBase(expected)!.filters['q1-paper-tone']; delete visualBase(expected)!.fogs['q1-water-haze']
    }
    expect(after).toEqual(expected)
    expect(after.styleThemes).toEqual(before.styleThemes)
    expect(after.assets).toEqual(before.assets)
    expect(validateSceneDocument(after).ok).toBe(true)
    expect(applySampleAtmosphere(original, profile)).toEqual(after)
  })

  it.each(profiles)('retains actual world values through JSON cold capture and both audience projections for %s', profile => {
    const before = fixture(profile), after = applySampleAtmosphere(before, profile)
    const cold = JSON.parse(canonicalJson(after)) as SceneDocument
    expect(validateSceneDocument(cold).ok).toBe(true)
    expect(cold.visual).toEqual(after.visual)
    for (const audience of ['gm', 'player'] as const) {
      const source = projectScene(before, audience), result = projectScene(cold, audience)
      expect(result.visual!.environment).toEqual(SAMPLE_ATMOSPHERE_PROFILES[profile].environment)
      expect(result.visual!.filters).toEqual([]); expect(result.visual!.fogs).toEqual([])
      for (const key of ['rooms', 'walls', 'terrain', 'props', 'paths', 'connections', 'masks', 'theme', 'assetIds'] as const) {
        expect(result[key]).toEqual(source[key])
      }
    }
    expect(() => applySampleAtmosphere(after, profile)).toThrow(/不覆盖/)
  })

  it('recognizes the explicit detailed-island layout while preserving source witnesses', () => {
    const source = createRefinedIslandDocument()
    source.presetSnapshot = { ...source.presetSnapshot, presetId: 'sceneweave-detailed-island', presetVersion: 1 }
    expect(validateSceneDocument(applySampleAtmosphere(source, 'island-daylight')).ok).toBe(true)
  })

  it('refuses wrong construction scopes, multiple Floors and unknown profiles without mutation', () => {
    const outpost = fixture('outpost-daylight'), before = canonicalJson(outpost)
    expect(() => applySampleAtmosphere(outpost, 'island-daylight')).toThrow(/不覆盖/)
    expect(() => applySampleAtmosphere(outpost, '__proto__' as SampleAtmosphereProfileId)).toThrow('未知')
    expect(canonicalJson(outpost)).toBe(before)
    const multiple = fixture('outpost-daylight'), floor = Object.values(multiple.floors)[0]
    multiple.floors.upper = { ...floor, id: 'upper', name: '楼上' }
    multiple.userLayers['upper-layer'] = { id: 'upper-layer', floorId: 'upper', name: '楼上', order: 0, editLocked: false }
    const multiBefore = canonicalJson(multiple)
    expect(() => applySampleAtmosphere(multiple, 'outpost-daylight')).toThrow(/单 Floor|一个 Floor/)
    expect(canonicalJson(multiple)).toBe(multiBefore)
  })

  it('refuses manual, private, disabled and foreign source effects instead of normalizing them', () => {
    for (const mutate of [
      (scene: SceneDocument) => { visualBase(scene)!.environment.exposure = 1.1 },
      (scene: SceneDocument) => { visualBase(scene)!.filters['q1-paper-tone'].visibility = 'gm' },
      (scene: SceneDocument) => { visualBase(scene)!.filters['q1-paper-tone'].enabled = false },
      (scene: SceneDocument) => { visualBase(scene)!.filters['q1-paper-tone'].seed = 'hand-edited' },
      (scene: SceneDocument) => { visualBase(scene)!.fogs['q1-water-haze'].boundaryMm[0].x++ },
      (scene: SceneDocument) => { delete visualBase(scene)!.fogs['q1-water-haze'] },
      (scene: SceneDocument) => { const fog = visualBase(scene)!.fogs['q1-water-haze']; visualBase(scene)!.fogs.extra = { ...structuredClone(fog), id: 'extra' } },
    ]) {
      const scene = fixture('island-daylight'); mutate(scene)
      const before = canonicalJson(scene)
      expect(() => applySampleAtmosphere(scene, 'island-daylight')).toThrow(/不覆盖/)
      expect(canonicalJson(scene)).toBe(before)
    }
    const scene = fixture('outpost-daylight'), floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
    visualBase(scene)!.lights.extra = { id: 'extra', floorId, layerId, visibility: 'gm', editLocked: false, enabled: true,
      positionMm: { x: 1000, y: 1000 }, radiusMm: 500, color: '#FFEEDD', intensity: .1, wallOcclusion: false }
    const before = canonicalJson(scene)
    expect(() => applySampleAtmosphere(scene, 'outpost-daylight')).toThrow(/不覆盖/)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('retains actual physical and visual dependency locks and rejects invalid complete models', () => {
    for (const lock of ['entity', 'layer', 'effect'] as const) {
      const scene = fixture('island-daylight')
      if (lock === 'entity') Object.values(scene.props)[0].editLocked = true
      if (lock === 'layer') Object.values(scene.userLayers)[0].editLocked = true
      if (lock === 'effect') visualBase(scene)!.filters['q1-paper-tone'].editLocked = true
      const before = canonicalJson(scene)
      expect(() => applySampleAtmosphere(scene, 'island-daylight')).toThrow(/锁定|不覆盖/)
      expect(canonicalJson(scene)).toBe(before)
    }
    const invalid = fixture('outpost-daylight'); invalid.terrainAreas['sample-ground'].groundElevationMm = .5
    expect(() => applySampleAtmosphere(invalid, 'outpost-daylight')).toThrow('基线无效')
  })
})
