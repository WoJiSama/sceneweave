import { describe, expect, it } from 'vitest'
import { migrateSceneV2 } from '../../core/v3/migration'
import type { PointMm, PropV2, SceneDocumentV3 } from '../../core/v3/types'
import { createBlankDocumentV2 } from '../../editor/v2/blank-project'
import { createIslandDocument, ISLAND_IDS } from '../../editor/v2/island-sample'
import { createStudyDocument, STUDY_IDS } from '../../editor/v2/study-sample'
import { projectSceneV2 } from '../v2/projection'
import { projectEditorSceneV3, projectSceneV3 } from './projection'
import { wallGeometryV3 } from './renderer'

const stamp = '2026-10-21T00:00:00.000Z'
function layer(scene: SceneDocumentV3, id = 'extra', name = '额外图层'): string {
  scene.userLayers[id] = { id, floorId: Object.keys(scene.floors)[0], name, order: Object.keys(scene.userLayers).length, editLocked: false }
  return id
}
function blank() {
  return migrateSceneV2(createBlankDocumentV2({ title: 'projection', widthMm: 10000, heightMm: 8000, preset: 'investigation', sceneId: 'source', now: stamp }), { sceneId: 'layers', now: stamp })
}
function prop(scene: SceneDocumentV3, id: string, band: PropV2['renderLayer'], renderOrder = 0): PropV2 {
  const floorId = Object.keys(scene.floors)[0]
  return { id, floorId, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity: 1 },
    positionMm: { x: 3000, y: 3000 }, rotationDeg: 0, visualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 }, footprintMm: { width: 500, height: 500 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
    visibility: 'public', supportRef: { kind: 'floor', id: floorId }, renderLayer: band, renderOrder, shadowClass: 'none', shadowOverride: null }
}
function note(scene: SceneDocumentV3, id: string, kind: 'opening' | 'wall' | 'note' | 'prefabInstance', anchorId: string) {
  scene.notes[id] = { id, floorId: Object.keys(scene.floors)[0], editLocked: false, anchor: { type: 'entity', entityKind: kind, entityId: anchorId }, kind: 'label', text: id, visibility: 'public' }
  scene.entityLayers[id] = Object.keys(scene.userLayers)[0]
}
function emptyPrefabScene(): SceneDocumentV3 {
  const scene = migrateSceneV2(createStudyDocument(), { sceneId: 'layers', now: stamp })
  for (const member of Object.values(scene.prefabInstances[STUDY_IDS.deskGroup].members)) {
    if (member.propId) { delete scene.props[member.propId]; delete scene.entityLayers[member.propId] }
    member.propId = null
  }
  note(scene, 'prefab-label', 'prefabInstance', STUDY_IDS.deskGroup); note(scene, 'nested-prefab-label', 'note', 'prefab-label')
  return scene
}

describe('strict v3 physical projection and editor-only layers', () => {
  it.each(['study', 'island'] as const)('preserves every default %s projection field for both audiences', sample => {
    const original = sample === 'study' ? createStudyDocument() : createIslandDocument(), migrated = migrateSceneV2(original, { sceneId: 'layers', now: stamp })
    for (const audience of ['gm', 'player'] as const) expect(projectSceneV3(migrated, audience)).toEqual({ ...projectSceneV2(original, audience), sourceRevision: migrated.revision })
    expect(projectEditorSceneV3(migrated)).toEqual(projectSceneV3(migrated, 'gm'))
  })

  it('treats an empty hidden-layer set as the default GM view, including empty prefab anchors', () => {
    const scene = emptyPrefabScene(), before = structuredClone(scene), complete = projectSceneV3(scene, 'gm')
    expect(complete.notes.map(n => n.id)).toEqual(['prefab-label', 'nested-prefab-label'])
    expect(complete.notes.map(n => n.positionMm)).toEqual([scene.prefabInstances[STUDY_IDS.deskGroup].anchorMm, scene.prefabInstances[STUDY_IDS.deskGroup].anchorMm])
    expect(projectEditorSceneV3(scene, { hiddenLayerIds: new Set() })).toEqual(complete)
    expect(projectSceneV3(scene, 'player').notes).toEqual([])
    expect(scene).toEqual(before)
  })

  it('retains empty prefab anchor labels and nested labels when hiding an unrelated layer', () => {
    const scene = emptyPrefabScene(), unrelated = layer(scene)
    scene.entityLayers['study-lamp'] = unrelated
    const before = structuredClone(scene), complete = projectSceneV3(scene, 'gm'), preview = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([unrelated]) })
    expect(preview.props.some(p => p.id === 'study-lamp')).toBe(false)
    expect(preview.notes).toEqual(complete.notes)
    expect(preview.notes.map(n => n.id)).toEqual(['prefab-label', 'nested-prefab-label'])
    expect(scene).toEqual(before)
  })

  it('suppresses empty prefab anchor labels and nested labels when hiding the prefab layer', () => {
    const scene = emptyPrefabScene(), hidden = layer(scene)
    scene.entityLayers[STUDY_IDS.deskGroup] = hidden
    const before = structuredClone(scene), complete = projectSceneV3(scene, 'gm'), preview = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([hidden]) })
    expect(scene.entityLayers['prefab-label']).not.toBe(hidden); expect(scene.entityLayers['nested-prefab-label']).not.toBe(hidden)
    expect(complete.notes.map(n => n.id)).toEqual(['prefab-label', 'nested-prefab-label'])
    expect(preview.notes).toEqual([])
    expect(preview.props).toEqual(complete.props); expect(scene).toEqual(before)
  })

  it('applies user order inside system bands, before object-local order, without changing source geometry', () => {
    const scene = blank(), base = Object.keys(scene.userLayers)[0], extra = layer(scene)
    for (const [id, band, owner, order] of [['object-later', 'object', extra, -20], ['canopy', 'canopy', base, -30], ['ground', 'ground', extra, 90], ['object-first', 'object', base, 50]] as const) {
      scene.props[id] = prop(scene, id, band, order); scene.entityLayers[id] = owner
    }
    const before = structuredClone(scene)
    for (const audience of ['gm', 'player'] as const) expect(projectSceneV3(scene, audience).props.map(p => p.id)).toEqual(['ground', 'object-first', 'object-later', 'canopy'])
    scene.userLayers[extra].order = 0; scene.userLayers[base].order = 1
    expect(projectSceneV3(scene, 'gm').props.map(p => p.id)).toEqual(['ground', 'object-later', 'object-first', 'canopy'])
    expect(scene.props).toEqual(before.props); expect(scene.floors).toEqual(before.floors)
  })

  it('hides an opening symbol while preserving its exact wall hole, and recursively suppresses anchored labels', () => {
    const scene = migrateSceneV2(createStudyDocument(), { sceneId: 'layers', now: stamp }), hidden = layer(scene)
    scene.entityLayers['diagonal-window'] = hidden
    note(scene, 'opening-label', 'opening', 'diagonal-window'); note(scene, 'nested-label', 'note', 'opening-label')
    const before = structuredClone(scene), complete = projectSceneV3(scene, 'gm'), preview = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([hidden]) })
    expect(preview.walls.find(w => w.id === 'study-w1')!.openings[0].paintSymbol).toBe(false)
    expect(wallGeometryV3(preview.walls).map(w => w.polygons)).toEqual(wallGeometryV3(complete.walls).map(w => w.polygons))
    expect(preview.notes.map(n => n.id)).not.toContain('opening-label'); expect(preview.notes.map(n => n.id)).not.toContain('nested-label')
    expect(complete.notes.map(n => n.id)).toContain('opening-label'); expect(scene).toEqual(before)
  })

  it('hides a wall together with its opening and labels, retaining furniture on a different visible layer', () => {
    const scene = migrateSceneV2(createStudyDocument(), { sceneId: 'layers', now: stamp }), hidden = layer(scene)
    scene.entityLayers['study-w1'] = hidden; scene.entityLayers[STUDY_IDS.room] = hidden
    note(scene, 'wall-label', 'wall', 'study-w1'); note(scene, 'opening-label', 'opening', 'diagonal-window')
    const preview = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([hidden]) })
    expect(preview.walls.some(w => w.id === 'study-w1')).toBe(false); expect(preview.walls.flatMap(w => w.openings).some(o => o.id === 'diagonal-window')).toBe(false)
    expect(preview.rooms).toEqual([]); expect(preview.props.map(p => p.id)).toContain('study-desk'); expect(preview.notes.map(n => n.id)).not.toContain('opening-label'); expect(preview.notes.map(n => n.id)).not.toContain('wall-label')
  })

  it('omits hidden terrain decorations and dependent connections without re-resolving physical coverage or furniture support', () => {
    const scene = migrateSceneV2(createIslandDocument(), { sceneId: 'layers', now: stamp }), hidden = layer(scene)
    scene.entityLayers[ISLAND_IDS.high] = hidden
    const complete = projectSceneV3(scene, 'gm'), preview = projectEditorSceneV3(scene, { hiddenLayerIds: new Set([hidden]) })
    expect(preview.terrain.some(a => a.id === ISLAND_IDS.high)).toBe(false); expect(preview.connections).toEqual([])
    expect(preview.edges).toEqual(complete.edges.filter(e => e.sourceAreaId !== ISLAND_IDS.high && e.neighborAreaId !== ISLAND_IDS.high))
    expect(preview.props).toEqual(complete.props)
    const high = scene.terrainAreas[ISLAND_IDS.high], oldHeight = high.groundElevationMm
    scene.userLayers[hidden].order = 0; scene.userLayers[Object.keys(scene.userLayers)[0]].order = 1
    expect(projectSceneV3(scene, 'gm').edges).toEqual(complete.edges); expect(high.groundElevationMm).toBe(oldHeight)
  })

  it('keeps player projection independent of layer IDs, names and editor isolation metadata', () => {
    const scene = blank(), base = Object.keys(scene.userLayers)[0]
    scene.props.visible = prop(scene, 'visible', 'object'); scene.entityLayers.visible = base
    const before = projectSceneV3(scene, 'player'), renamed = structuredClone(scene), replacement = 'PRIVATE-LAYER-ID'
    renamed.userLayers[replacement] = { ...renamed.userLayers[base], id: replacement, name: 'PRIVATE-LAYER-NAME' }; delete renamed.userLayers[base]
    for (const id of Object.keys(renamed.entityLayers)) renamed.entityLayers[id] = replacement
    expect(projectSceneV3(renamed, 'player')).toEqual(before)
    expect(JSON.stringify(before)).not.toContain(base); expect(JSON.stringify(projectSceneV3(renamed, 'player'))).not.toContain('PRIVATE-LAYER')
    expect(projectEditorSceneV3(renamed, { hiddenLayerIds: new Set([replacement]) }).props).toEqual([])
    expect(projectSceneV3(renamed, 'player').props).toHaveLength(1)
  })

  it('rejects v2, missing membership and mutable pseudo-certified inputs before projection', () => {
    const scene = blank()
    expect(() => projectSceneV3({ ...scene, schemaVersion: 2 } as never, 'gm')).toThrow('场景不能绘制')
    scene.props.item = prop(scene, 'item', 'object'); Object.freeze(scene)
    expect(() => projectSceneV3(scene, 'gm')).toThrow('场景不能绘制')
  })
})
