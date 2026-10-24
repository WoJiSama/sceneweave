import { describe, expect, it } from 'vitest'
import { selectionScene as toGeometryDocumentV2 } from './selection-scene'
import { migrateSceneV2 as legacyLayers } from '../../core/v3/migration'
import type { SceneDocumentV2 } from '../../core/v2/types'
function migrateSceneV2(input: SceneDocumentV2, options: Parameters<typeof legacyLayers>[1]): SceneDocumentV3 { return { ...legacyLayers(input, options), format: 'sceneweave-scene', schemaVersion: 1 } }
import { validateSceneSnapshot as validateSceneSnapshotV3 } from '../../shared/validation/snapshots.js'
import type { SceneDocument as SceneDocumentV3 } from '../../shared/model/scene.js'
import { createBlankDocumentV2 } from '../v2/blank-project'
import { createIslandDocument, ISLAND_IDS } from '../v2/island-sample'
import { createStudyDocument, STUDY_IDS } from '../v2/study-sample'
import { projectEditorScene as projectEditorSceneV3 } from '../../shared/projection/projection.js'
import { wallGeometryV3 } from '../../platform/browser/render/renderer'
import { hiddenEntitiesV3, scopedHiddenEntitiesV3, hitTestLayersV3, selectInBoundsLayersV3, selectionGeometryLayersV3, summarizeSelectionLayersV3 } from './layer-view'

const stamp = '2026-10-21T00:00:00.000Z'
const corner = { x: 3700, y: 3700 }
const cornerBox = { x: 3680, y: 3680, width: 40, height: 40 }
const domain = (scene: SceneDocumentV3) => toGeometryDocumentV2(scene, { effectiveLocks: true, layerOrder: true })
function layer(scene: SceneDocumentV3): string {
  const id = 'higher-layer'
  scene.userLayers[id] = { id, floorId: Object.keys(scene.floors)[0], name: '上层', order: 1, editLocked: false }
  return id
}
function joinedWalls(): SceneDocumentV3 {
  const source = createBlankDocumentV2({ title: '原生墙体选择', widthMm: 20000, heightMm: 20000, preset: 'investigation', sceneId: 'source', now: stamp })
  for (const [id, xMm, yMm] of [['shared', 4000, 4000], ['east', 8000, 4000], ['south', 4000, 8000]] as const) source.vertices[id] = { id, floorId: 'blank-floor', editLocked: false, xMm, yMm }
  for (const [id, endVertexId] of [['horizontal', 'east'], ['vertical', 'south']] as const) source.walls[id] = { id, floorId: 'blank-floor', editLocked: false, startVertexId: 'shared', endVertexId, thicknessMm: 1000, blocksMovement: true, blocksSight: true, topStyle: null }
  const scene = migrateSceneV2(source, { sceneId: 'native-wall-copy', now: stamp })
  // Geometric order is horizontal first. Native user order reverses it, and
  // therefore assigns the exterior join to the vertical wall instead.
  scene.entityLayers.horizontal = layer(scene)
  return scene
}
function addConnectionLabels(scene: SceneDocumentV3, connectionId: string): void {
  const floorId = Object.keys(scene.floors)[0], base = Object.keys(scene.userLayers)[0]
  scene.notes['step-label'] = { id: 'step-label', floorId, editLocked: false, visibility: 'public', kind: 'label', text: '台阶', anchor: { type: 'entity', entityKind: 'terrainConnection', entityId: connectionId } }
  scene.notes['nested-label'] = { id: 'nested-label', floorId, editLocked: false, visibility: 'public', kind: 'label', text: '连接注记', anchor: { type: 'entity', entityKind: 'note', entityId: 'step-label' } }
  scene.entityLayers['step-label'] = base; scene.entityLayers['nested-label'] = base
}
/** Reference-only fixture for defensive hiding branches; never used by strict selection/rendering. */
function unopenedRoomConnectionReferences(): SceneDocumentV3 {
  const scene = migrateSceneV2(createStudyDocument({ sceneId: 'source', now: stamp }), { sceneId: 'room-reference-copy', now: stamp })
  scene.terrainAreas[STUDY_IDS.terrace].groundElevationMm = 1000
  scene.terrainConnections['room-step'] = { id: 'room-step', floorId: STUDY_IDS.floor, editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'room', id: STUDY_IDS.room }, positionMm: { x: 8500, y: 4500 } },
    to: { surfaceRef: { kind: 'terrainArea', id: STUDY_IDS.terrace }, positionMm: { x: 9500, y: 4500 } },
    widthMm: 800, openingId: 'terrace-door', blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
  scene.entityLayers['room-step'] = Object.keys(scene.userLayers)[0]
  addConnectionLabels(scene, 'room-step')
  return scene
}

describe('native complete-v1 layer selection', () => {
  it('uses the drawn native wall owner and topmost layer for point, marquee and select-all', () => {
    const scene = joinedWalls(), geometry = domain(scene), pick = hitTestLayersV3(scene), select = selectInBoundsLayersV3(scene), shapes = selectionGeometryLayersV3(scene)
    const rendered = wallGeometryV3(projectEditorSceneV3(scene).walls)
    expect(rendered.map(wall => wall.wall.id)).toEqual(['vertical', 'horizontal'])
    for (const wall of rendered) expect(shapes(geometry, wall.wall.id)).toEqual(wall.polygons)
    expect(pick(geometry, corner, 0)).toEqual(['vertical'])
    expect(pick(geometry, { x: 4100, y: 4100 }, 0).slice(0, 2)).toEqual(['horizontal', 'vertical'])
    expect(select(geometry, cornerBox, 'intersect').ids).toEqual(['vertical'])
    expect(select(geometry, scene.exportBoundsMm, 'contain').ids.filter(id => scene.walls[id])).toEqual(['horizontal', 'vertical'])
    expect(select(geometry, cornerBox, 'intersect').excludedHidden).toBe(0)
    // Both factories survive caller-owned edits without treating a shallow
    // object freeze as a certification or keeping an obsolete wall owner.
    const base = Object.keys(scene.userLayers)[0]
    scene.userLayers[base].order = 1; scene.userLayers['higher-layer'].order = 0
    expect(pick(geometry, corner, 0)).toEqual(['horizontal'])
    expect(select(geometry, cornerBox, 'intersect').ids).toEqual(['horizontal'])
  })

  it('removes hidden-neighbor joins while current-layer exclusions preserve visible joins', () => {
    const scene = joinedWalls(), geometry = domain(scene), base = Object.keys(scene.userLayers)[0]
    const scoped = scopedHiddenEntitiesV3(scene, new Set(), base), hidden = hiddenEntitiesV3(scene, new Set(['higher-layer']))
    expect(hitTestLayersV3(scene)(geometry, corner, 0, { hiddenIds: scoped })).toEqual(['vertical'])
    expect(selectInBoundsLayersV3(scene)(geometry, cornerBox, 'intersect', { hiddenIds: scoped }).ids).toEqual(['vertical'])
    const preview = wallGeometryV3(projectEditorSceneV3(scene, { hiddenLayerIds: new Set(['higher-layer']) }).walls)
    expect(selectionGeometryLayersV3(scene, hidden)(geometry, 'vertical')).toEqual(preview[0].polygons)
    expect(selectionGeometryLayersV3(scene, hidden)(geometry, 'horizontal')).toEqual([])
    expect(hitTestLayersV3(scene, hidden)(geometry, corner, 0)).toEqual([])
    expect(selectInBoundsLayersV3(scene, hidden)(geometry, cornerBox, 'intersect').ids).toEqual([])
    const verticalBand = { x: 3500, y: 4000, width: 1000, height: 4000 }
    expect(selectInBoundsLayersV3(scene)(geometry, verticalBand, 'contain').ids).not.toContain('vertical')
    expect(selectInBoundsLayersV3(scene, hidden)(geometry, verticalBand, 'contain').ids).toContain('vertical')
  })

  it('summarizes the same native wall bounds and keeps returned polygons detached', () => {
    const input = joinedWalls(), checked = validateSceneSnapshotV3(input)
    if (!checked.ok) throw new Error(checked.errors.map(error => error.message).join('；'))
    const scene = checked.document, geometry = domain(scene), hidden = new Set<string>()
    const shapes = selectionGeometryLayersV3(scene, hidden), summary = summarizeSelectionLayersV3(scene, hidden)
    expect(summary(geometry, ['vertical', 'vertical'])).toMatchObject({ ids: ['vertical'], count: 1, typeCounts: { wall: 1 }, effectiveLockedCount: 0, overCommandBudget: false, boundsMm: { x: 3500, y: 3500, width: 1000, height: 4500 } })
    const returned = shapes(geometry, 'vertical'); returned[0][0].x = -999
    expect(shapes(geometry, 'vertical')[0][0].x).not.toBe(-999)
    hidden.add('horizontal')
    expect(summary(geometry, ['vertical']).boundsMm).toEqual({ x: 3500, y: 4000, width: 1000, height: 4000 })
    expect(hitTestLayersV3(scene, hidden)(geometry, corner, 0)).toEqual([])
    hidden.clear()
    expect(summary(geometry, ['vertical']).boundsMm?.y).toBe(3500)
  })

  it('keeps locked walls inspectable, excludes them from bulk selection and rejects invalid queries', () => {
    const scene = joinedWalls(), base = Object.keys(scene.userLayers)[0]
    scene.userLayers[base].editLocked = true
    const geometry = domain(scene), pick = hitTestLayersV3(scene), select = selectInBoundsLayersV3(scene)
    expect(pick(geometry, corner, 0)).toEqual(['vertical'])
    expect(select(geometry, cornerBox, 'intersect')).toEqual({ ids: [], excludedLocked: 1, excludedHidden: 0 })
    expect(summarizeSelectionLayersV3(scene)(geometry, ['vertical']).effectiveLockedCount).toBe(1)
    expect(() => pick(geometry, { x: Infinity, y: 0 }, 1)).toThrow('有限坐标')
    expect(() => select(geometry, { x: NaN, y: 0, width: 1, height: 1 }, 'contain')).toThrow('有限矩形')
  })

  it('picks a ground prop above its supporting room even when the room has a higher user layer', () => {
    const scene = migrateSceneV2(createStudyDocument({ now: stamp }), { sceneId: 'ground-layer-copy', now: stamp })
    scene.entityLayers[STUDY_IDS.room] = layer(scene)
    const ids = hitTestLayersV3(scene)(domain(scene), scene.props['study-rug'].positionMm, 0)
    expect(ids).toContain(STUDY_IDS.room)
    expect(ids[0]).toBe('study-rug')
  })

  it('omits a valid B3 terrain connection and labels from native projection, point picking and marquee when its source is hidden', () => {
    const scene = migrateSceneV2(createIslandDocument({ sceneId: 'source', now: stamp }), { sceneId: 'native-connection-copy', now: stamp }), hiddenLayer = layer(scene)
    addConnectionLabels(scene, ISLAND_IDS.connection)
    scene.entityLayers[ISLAND_IDS.high] = hiddenLayer
    const geometry = domain(scene), point = { x: 14500, y: 10000 }, box = { x: 14450, y: 9950, width: 100, height: 100 }
    expect(projectEditorSceneV3(scene).connections.map(connection => connection.id)).toContain(ISLAND_IDS.connection)
    expect(hitTestLayersV3(scene)(geometry, point, 0)).toContain(ISLAND_IDS.connection)
    expect(selectInBoundsLayersV3(scene)(geometry, box, 'intersect').ids).toContain(ISLAND_IDS.connection)
    const hidden = hiddenEntitiesV3(scene, new Set([hiddenLayer]))
    expect(hidden.has(ISLAND_IDS.connection)).toBe(true); expect(hidden.has('step-label')).toBe(true); expect(hidden.has('nested-label')).toBe(true)
    const projection = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([hiddenLayer]) })
    expect(projection.connections).toEqual([]); expect(projection.notes.map(note => note.id)).not.toContain('nested-label')
    expect(hitTestLayersV3(scene, hidden)(geometry, point, 0)).not.toContain(ISLAND_IDS.connection)
    expect(selectInBoundsLayersV3(scene, hidden)(geometry, box, 'intersect').ids).not.toContain(ISLAND_IDS.connection)
    // Merely restricting selection to another layer leaves this drawn
    // connection eligible; this is different from hiding its source surface.
    const scoped = scopedHiddenEntitiesV3(scene, new Set(), Object.keys(scene.userLayers)[0])
    expect(hitTestLayersV3(scene)(geometry, point, 0, { hiddenIds: scoped })).toContain(ISLAND_IDS.connection)
  })

  it.each([STUDY_IDS.room, 'terrace-door', 'study-w2'])('defensively propagates the unopened room-connection reference dependency %s through hiddenEntitiesV3', target => {
    const scene = unopenedRoomConnectionReferences(), hiddenLayer = layer(scene)
    scene.entityLayers[target] = hiddenLayer
    // Cross-door height geometry is not currently open: the full wall band
    // must have one support elevation. Exercise only the pure reference closure
    // here, and explicitly keep this invalid fixture out of strict selectors.
    const checked = validateSceneSnapshotV3(scene)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.errors.map(error => error.code)).toContain('WALL_SUPPORT_ELEVATION')
    const hidden = hiddenEntitiesV3(scene, new Set([hiddenLayer]))
    expect(hidden.has('room-step')).toBe(true); expect(hidden.has('step-label')).toBe(true); expect(hidden.has('nested-label')).toBe(true)
    const scoped = scopedHiddenEntitiesV3(scene, new Set(), Object.keys(scene.userLayers)[0])
    expect(scoped.has('room-step')).toBe(false); expect(scoped.has('nested-label')).toBe(false)
  })

  it('rechecks caller-owned nested mutations and refuses invalid pseudo-certified inputs', () => {
    const scene = joinedWalls(), geometry = domain(scene), pick = hitTestLayersV3(scene)
    Object.freeze(scene)
    expect(pick(geometry, corner, 0)).toEqual(['vertical'])
    scene.walls.horizontal.thicknessMm = 200
    expect(pick(geometry, corner, 0)).toEqual([])
    delete scene.entityLayers.horizontal
    expect(() => pick(geometry, corner, 0)).toThrow('场景选择数据无效')
  })
})
