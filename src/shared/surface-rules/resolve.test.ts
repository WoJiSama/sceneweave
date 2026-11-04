import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { PointMm, SceneDocument, SurfaceRule, SurfaceRuleRegion, TerrainArea } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import { resolveSurfaceRules } from './resolve.js'

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const region = (x: number, y: number, width: number, height: number): SurfaceRuleRegion => ({ outerMm: rect(x, y, width, height), holesMm: [] })

function fixture(): SceneDocument {
  const scene = createRefinedBlankDocument('island', { sceneId: 'surface-rule-resolve', title: 'Surface rule resolver', widthMm: 24000, heightMm: 18000,
    preset: 'narrative', now: '2026-11-02T00:00:00.000Z' })
  scene.schemaVersion = 8
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const area: TerrainArea = { id: 'support', floorId, editLocked: false, visibility: 'public',
    boundaryMm: rect(0, 0, 100, 100).map((positionMm, index) => ({ id: `support-p${index}`, segmentId: `support-s${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainAreas[area.id] = area; scene.entityLayers[area.id] = layerId
  scene.surfaceRules = {}
  return scene
}

function rule(scene: SceneDocument, id: string, field: SurfaceRule['field'], visibility: 'public' | 'gm', paintOrder: number, painted: ReturnType<typeof region>): SurfaceRule {
  const common = { id, floorId: Object.keys(scene.floors)[0], editLocked: false, visibility, supportRef: { kind: 'terrainArea' as const, id: 'support' },
    paintOrder, regionsMm: [painted] }
  const layerId = `layer-${id}`
  scene.userLayers[layerId] = { id: layerId, floorId: common.floorId, name: id, order: Object.keys(scene.userLayers).length, editLocked: false }
  scene.entityLayers[id] = layerId
  if (field === 'material') {
    const material = Object.values(scene.materials)[0]
    return { ...common, field, paint: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm },
      rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, blendWidthMm: 240 }
  }
  return { ...common, field, clusterId: `${id}-cluster`, coveragePpm: 450_000 }
}

describe('v8 surface-rule resolution', () => {
  it('clips to support and lets only newer rules in the same field/audience stack cover', () => {
    const scene = fixture()
    scene.surfaceRules!.ground = rule(scene, 'ground', 'material', 'public', 1, region(-10, 10, 70, 40))
    scene.surfaceRules!.groundLater = rule(scene, 'groundLater', 'material', 'public', 2, region(40, 10, 50, 40))
    scene.surfaceRules!.trees = rule(scene, 'trees', 'trees', 'public', 3, region(40, 10, 50, 40))
    const result = resolveSurfaceRules(scene)
    const old = result.find(row => row.rule.id === 'ground')!
    expect(old.regionsMm).toEqual([{ outerMm: rect(0, 10, 40, 40), holesMm: [] }])
    expect(result.find(row => row.rule.id === 'groundLater')?.regionsMm).toEqual([region(40, 10, 50, 40)])
    expect(result.find(row => row.rule.id === 'trees')?.regionsMm).toEqual([region(40, 10, 50, 40)])
  })

  it('filters audience before resolving and keeps public geometry untouched by GM strokes', () => {
    const scene = fixture()
    scene.surfaceRules!.public = rule(scene, 'public', 'material', 'public', 1, region(10, 10, 60, 60))
    scene.surfaceRules!.private = rule(scene, 'private', 'material', 'gm', 2, region(30, 30, 50, 50))
    const player = resolveSurfaceRules(scene, undefined, { audience: 'player' })
    expect(player.map(row => row.rule.id)).toEqual(['public'])
    expect(player[0].regionsMm).toEqual([region(10, 10, 60, 60)])
    const gm = resolveSurfaceRules(scene, undefined, { audience: 'gm' })
    expect(gm.map(row => row.rule.id)).toEqual(['public', 'private'])
    expect(gm[0].regionsMm).toEqual([region(10, 10, 60, 60)])
  })

  it('filters hidden rule layers before resolving so earlier visible paint is revealed', () => {
    const scene = fixture()
    scene.surfaceRules!.under = rule(scene, 'under', 'grass', 'public', 1, region(10, 10, 60, 60))
    scene.surfaceRules!.top = rule(scene, 'top', 'grass', 'public', 2, region(30, 10, 60, 60))
    const hiddenLayer = scene.entityLayers.top
    expect(resolveSurfaceRules(scene, undefined, { hiddenLayerIds: new Set([hiddenLayer]) })).toEqual([
      expect.objectContaining({ rule: expect.objectContaining({ id: 'under' }), regionsMm: [region(10, 10, 60, 60)] }),
    ])
  })

  it('returns independent disposable values and does not mutate saved rules', () => {
    const scene = fixture()
    scene.surfaceRules!.only = rule(scene, 'only', 'shrubs', 'public', 1, { outerMm: rect(10, 10, 60, 60), holesMm: [rect(20, 20, 10, 10)] })
    const before = canonicalJson(scene), result = resolveSurfaceRules(scene)
    result[0].rule.regionsMm[0].outerMm[0].x = 999
    result[0].regionsMm[0].holesMm[0][0].x = 999
    expect(canonicalJson(scene)).toBe(before)
    expect(scene.surfaceRules!.only.regionsMm[0].outerMm[0].x).toBe(10)
  })
})
