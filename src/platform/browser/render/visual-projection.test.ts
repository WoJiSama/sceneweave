import { describe, expect, it } from 'vitest'
import { createBlankDocumentV2 } from '../../../editor/v2/blank-project'
import { migrateSceneV2 } from '../../../core/v3/migration'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { projectVisualSystem, projectedWallFootprints } from '../../../shared/visual/projection.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import type { VisualBoundary, VisualFilter, VisualLight } from '../../../shared/visual/types.js'
import { createVisualSampleDocument } from '../content/visual-samples'
import { canonicalJson } from '../../../shared/validation/json.js'

function fixture() {
  const old = createBlankDocumentV2({ title: 'visual projection', widthMm: 10000, heightMm: 8000, preset: 'investigation', sceneId: 'visual-projection', now: '2026-10-25T00:00:00.000Z' })
  const scene: SceneDocument = { ...migrateSceneV2(old, { sceneId: 'visual-projection-native', now: old.updatedAt }), format: 'sceneweave-scene', schemaVersion: 1 }
  const projection = projectScene(scene, 'player'), layerId = Object.keys(scene.userLayers)[0]
  const entity = { floorId: Object.keys(scene.floors)[0], layerId, visibility: 'public' as const, editLocked: false }
  const boundary: VisualBoundary = { ...entity, id: 'coast', closed: false, binding: { kind: 'decoration' }, sampleSpacingMm: 500, toleranceMm: 10,
    segments: [{ id: 'curve', start: { x: 1000, y: 1000 }, control1: { x: 1500, y: 1000 }, control2: { x: 2500, y: 1000 }, end: { x: 3000, y: 1000 } }] }
  const light: VisualLight = { ...entity, id: 'light', positionMm: { x: 1000, y: 1000 }, radiusMm: 500, color: '#FFEABB', intensity: .5, wallOcclusion: true, enabled: true }
  const filter: VisualFilter = { ...entity, id: 'filter', target: { kind: 'scene' }, preset: 'warm', exposure: 1, saturation: 1, contrast: 1, vignette: .1, grain: .1, seed: 'filter', enabled: true }
  const visual = emptyVisualSystem(); visual.boundaries.coast = boundary; visual.lights.light = light; visual.filters.filter = filter
  return { scene, projection, visual, entity, boundary, light, filter }
}

describe('visual projection audience and editor isolation', () => {
  it('keeps shared-room paint order identical after canonical v2 file serialization', () => {
    const scene = createVisualSampleDocument('interior')
    const imported = JSON.parse(canonicalJson(scene)) as SceneDocument
    expect(Object.keys(scene.rooms)).not.toEqual(Object.keys(imported.rooms))
    for (const audience of ['gm', 'player'] as const) {
      expect(projectScene(imported, audience)).toEqual(projectScene(scene, audience))
    }
  })
  it('drops private or disabled effects before making drawable geometry', () => {
    const { scene, projection, visual, light } = fixture()
    visual.lights.secret = { ...light, id: 'secret', visibility: 'gm' }; visual.lights.disabled = { ...light, id: 'disabled', enabled: false }
    visual.boundaries.coast.visibility = 'gm'; visual.filters.filter.visibility = 'gm'
    const player = projectVisualSystem(scene, visual, projection, 'player')
    expect(player.boundaries).toEqual([]); expect(player.filters).toEqual([]); expect(player.lights.map(l => l.id)).toEqual(['light'])
    expect(projectVisualSystem(scene, visual, projection, 'gm').lights.map(l => l.id)).toEqual(['light', 'secret'])
  })
  it('omits hidden-layer effects and lights within final opaque player masks', () => {
    const { scene, projection, visual, entity } = fixture()
    expect(projectVisualSystem(scene, visual, projection, 'gm', new Set([entity.layerId])).lights).toEqual([])
    projection.masks = [[{ x: 500, y: 500 }, { x: 1500, y: 500 }, { x: 1500, y: 1500 }, { x: 500, y: 1500 }]]
    expect(projectVisualSystem(scene, visual, projection, 'player').lights).toEqual([])
    expect(projectVisualSystem(scene, visual, projection, 'gm').lights).toHaveLength(1)
  })
  it('does not sample a shared boundary if any supporting terrain is private or hidden', () => {
    const { scene, projection, visual, boundary } = fixture()
    boundary.binding = { kind: 'terrain', sides: [{ areaId: 'public', startPointId: 'a', endPointId: 'b', reverse: false }, { areaId: 'private', startPointId: 'c', endPointId: 'd', reverse: true }] }
    projection.terrain = [{ id: 'public', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], style: null, elevationMm: 0, priority: 0 }]
    expect(projectVisualSystem(scene, visual, projection, 'player').boundaries).toEqual([])
  })
  it('freezes selective filters to currently visible targets and drops empty private targets', () => {
    const { scene, projection, visual, filter, entity } = fixture()
    projection.terrain = [{ id: 'visible', points: [{ x: 100, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 800 }], style: null, elevationMm: 0, priority: 0 }]
    scene.entityLayers.visible = entity.layerId
    filter.target = { kind: 'entities', ids: ['private', 'visible'] }
    const result = projectVisualSystem(scene, visual, projection, 'player')
    expect(result.filters[0].targetRings).toEqual([projection.terrain[0].points])
    expect(result.filters[0].targetBoundsMm).toEqual({ x: 100, y: 200, width: 500, height: 600 })
    filter.target = { kind: 'entities', ids: ['private'] }
    expect(projectVisualSystem(scene, visual, projection, 'player').filters).toEqual([])
    filter.target = { kind: 'layer', layerId: entity.layerId }
    expect(projectVisualSystem(scene, visual, projection, 'player').filters).toHaveLength(1)
    expect(projectVisualSystem(scene, visual, projection, 'player').filters[0].regionFeatherMm).toBeUndefined()
    filter.target = { kind: 'region', boundaryMm: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 2000 }] }
    expect(projectVisualSystem(scene, visual, projection, 'player').filters[0].regionFeatherMm).toBe(320)
  })
  it('computes physical wall occluders with open gaps and closed doors', () => {
    const { projection } = fixture()
    projection.walls = [{ id: 'wall', sourceIds: [], start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, thicknessMm: 100, style: null, blocksLight: true, openings: [{ id: 'door', start: { x: 300, y: 0 }, end: { x: 700, y: 0 }, widthMm: 400, kind: 'door', state: 'open', secret: false }] }]
    expect(projectedWallFootprints(projection)).toHaveLength(2)
    projection.walls[0].openings[0].state = 'closed'
    expect(projectedWallFootprints(projection)).toHaveLength(1)
    projection.walls[0].blocksLight = false
    expect(projectedWallFootprints(projection)).toEqual([])
  })
  it('returns independent disposable geometry and leaves source effects unchanged', () => {
    const { scene, projection, visual } = fixture(), before = structuredClone(visual)
    const result = projectVisualSystem(scene, visual, projection, 'player')
    result.lights[0].positionMm.x = 99999; result.boundaries[0].points[0].x = 99999; result.environment.exposure = 2
    expect(visual).toEqual(before)
    expect(result.boundsMm).toEqual(scene.exportBoundsMm)
  })
})
