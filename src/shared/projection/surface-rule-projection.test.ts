import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { PointMm, SceneDocument, SurfaceRule, TerrainArea } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import * as snapshots from '../validation/snapshots.js'
import { projectEditorScene, projectScene } from './projection.js'

afterEach(() => vi.restoreAllMocks())

const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const region = (x: number, y: number, width: number, height: number) => {
  const hole = rect(x + 10, y + 10, Math.round(width / 4), Math.round(height / 4))
  return { outerMm: rect(x, y, width, height), holesMm: [[hole[0], hole[3], hole[2], hole[1]]] }
}

function fixture() {
  const scene = createRefinedBlankDocument('island', { sceneId: 'surface-rule-projection', title: 'Surface rule projection', widthMm: 24000, heightMm: 18000,
    preset: 'narrative', now: '2026-11-02T00:00:00.000Z' })
  scene.schemaVersion = 8
  const floorId = Object.keys(scene.floors)[0], groundLayer = Object.keys(scene.userLayers)[0]
  const area: TerrainArea = { id: 'support', floorId, editLocked: false, visibility: 'public',
    boundaryMm: rect(0, 0, 100, 100).map((positionMm, index) => ({ id: `support-p${index}`, segmentId: `support-s${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.terrainAreas[area.id] = area; scene.entityLayers[area.id] = groundLayer
  const publicLayer = 'surface-layer-public', privateLayer = 'surface-layer-private'
  scene.userLayers[publicLayer] = { id: publicLayer, floorId, name: 'Public paint', order: 1, editLocked: false }
  scene.userLayers[privateLayer] = { id: privateLayer, floorId, name: 'Private paint', order: 2, editLocked: false }
  const materials = Object.values(scene.materials).filter(material => material.applicableSurfaces.includes('terrain'))
  const makeRule = (id: string, visibility: 'public' | 'gm', paintOrder: number, material: (typeof materials)[number], layerId: string): SurfaceRule => {
    scene.entityLayers[id] = layerId
    return { id, floorId, editLocked: false, visibility, supportRef: { kind: 'terrainArea', id: area.id }, field: 'material', paintOrder,
      regionsMm: [region(10 + paintOrder * 5, 10, 50, 60)],
      paint: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0,
        alignment: 'world', originMm: { x: 1200, y: 2400 }, tint: null, opacity: .85 }, blendWidthMm: 320 }
  }
  scene.surfaceRules = {
    publicPaint: makeRule('publicPaint', 'public', 1, materials[0], publicLayer),
    gmPaint: makeRule('gmPaint', 'gm', 2, materials[1] ?? materials[0], privateLayer),
  }
  vi.spyOn(snapshots, 'validateSceneSnapshot').mockImplementation(input => ({ ok: true, document: structuredClone(input as SceneDocument), warnings: [] }))
  return { scene, publicLayer, privateLayer, materials }
}

describe('v8 surface-rule audience projections', () => {
  it('passes only visible transient material regions and their exact assets to editor and PNG projections', () => {
    const { scene, publicLayer, materials } = fixture(), before = canonicalJson(scene)
    const player = projectScene(scene, 'player'), gm = projectScene(scene, 'gm')
    expect(player.terrain[0].materialPatches).toEqual([{ regionsMm: [region(15, 10, 50, 60)], paint: scene.surfaceRules!.publicPaint.field === 'material' ? scene.surfaceRules!.publicPaint.paint : null, blendWidthMm: 320 }])
    expect(gm.terrain[0].materialPatches?.map(patch => patch.paint.materialRef.id)).toEqual([materials[0].id, (materials[1] ?? materials[0]).id])
    expect(player.materials).toHaveProperty(materials[0].id)
    if (materials[1]) expect(player.materials).not.toHaveProperty(materials[1].id)
    expect(player.terrain[0].materialPatches?.[0]).not.toHaveProperty('id')
    expect(player.terrain[0].materialPatches?.[0]).not.toHaveProperty('visibility')
    const editor = projectEditorScene(scene, { hiddenLayerIds: new Set([publicLayer]) })
    expect(editor.terrain[0].materialPatches?.map(patch => patch.paint.materialRef.id)).toEqual([(materials[1] ?? materials[0]).id])
    expect(canonicalJson(scene)).toBe(before)
  })
})
