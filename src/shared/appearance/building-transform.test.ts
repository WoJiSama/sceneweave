import { describe, expect, it } from 'vitest'
import native from '../../platform/browser/content/scenes-data.json'
import { applyCommands } from '../commands/commands.js'
import type { CompositionContent } from '../model/appearance.js'
import type { PointMm, SceneDocument, SurfaceStyle } from '../model/scene.js'
import { createEmptyGeneration } from '../terrain-generation/contracts.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { applyCompositionCommands, applyCompositionDraftCommands } from './commands.js'
import { createCompositionContent, listRequiredVariants, resolveAppearance, surfaceStyle } from './graph.js'

const runtime = () => ({ ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-11-02T00:00:00.000Z' } })
const floorId = 'blank-floor', layerId = 'layer-default-0'
const shift = { type: 'transformBuilding' as const, id: 'house', offsetMm: { x: 1000, y: 500 }, pivotMm: { x: 10000, y: 10000 }, quarterTurns: 0 as const }
const turn = { ...shift, offsetMm: { x: 0, y: 0 }, quarterTurns: 1 as const }
const point = (x: number, y: number): PointMm => ({ x, y })
function style(id: string, materialId = 'b2-m-03', alignment: 'world' | 'surface' = 'surface', overlay = false): SurfaceStyle {
  const base = { materialRef: { id: materialId, version: 1 }, tileSizeMm: { width: 800, height: 1000 }, rotationDeg: 15,
    alignment, originMm: point(3000, 3200), tint: null, opacity: 1 }
  return { base, overlays: overlay ? [{ id: `${id}-overlay`, boundaryMm: [point(3000, 3000), point(4000, 3000), point(4000, 4000)],
    paint: { ...cloneJson(base), alignment: 'world', originMm: point(80, 120), rotationDeg: 20, opacity: .5 }, blendWidthMm: 100, renderOrder: 0 }] : [] }
}
function fixture(version: 1 | 3 | 4 | 5 | 6 = 5, bridge = false): CompositionContent {
  let document = cloneJson(native.scenes.blank.document) as SceneDocument
  document.schemaVersion = version
  if (version >= 3) {
    document.mapMode = 'scene'; document.regional = null
    document.generation = version === 3 ? createEmptyGeneration() : createEmptyGeneration5()
    document.visual = version === 3 ? { version: 2, base: emptyVisualSystem(), materializedEdges: {} }
      : { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
    if (version === 6) { document.decorations = {}; document.decorationClusters = {} }
  }
  document.terrainAreas.ground = { id: 'ground', floorId, editLocked: false, visibility: 'public',
    boundaryMm: [point(0, 0), point(20000, 0), point(20000, 20000), point(0, 20000)].map((positionMm, index) => ({ id: `ground-point-${index}`, segmentId: `ground-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: style('ground'), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  document.entityLayers.ground = layerId
  document = applyCommands(document, [
    { type: 'createRoom', id: 'house', floorId, layerId, boundaryMm: [point(2000, 2000), point(8000, 2000), point(8000, 8000), point(2000, 8000)], thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'ground' } },
    { type: 'createRoom', id: 'other', floorId, layerId, boundaryMm: [point(12000, 12000), point(18000, 12000), point(18000, 18000), point(12000, 18000)], thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'ground' } },
  ], runtime())
  document.rooms.house.floorStyle = style('house', 'b2-m-03', 'surface', true)
  document.rooms.other.floorStyle = style('other', 'b2-m-03', 'surface', true)
  document.walls['house:wall:0'].topStyle = style('wall', 'b2-m-04')
  document.walls['house:wall:2'].topStyle = style('world', 'b2-m-04', 'world')
  document.paths.road = { id: 'road', floorId, editLocked: false, visibility: 'public', centerlineMm: [point(3500, 4500), point(6000, 4500)],
    widthMm: 400, supportRefs: [{ kind: 'room', id: 'house' }], surfaceStyle: style('road'), movementCostMultiplier: 1, renderOrder: 0 }
  document.entityLayers.road = layerId
  if (bridge) {
    document.walls.bridge = { id: 'bridge', floorId, editLocked: false, startVertexId: 'house:vertex:2', endVertexId: 'other:vertex:0',
      thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    document.entityLayers.bridge = layerId
  }
  return createCompositionContent(document, runtime())
}
const sourceFor = (content: CompositionContent, id: string) => {
  const source = content.appearance.sources[content.appearance.surfaceSources[id]]
  if (source?.kind !== 'surface') throw new Error(`Expected fixed surface source: ${id}`)
  return source
}

describe('building transforms of fixed surface sources', () => {
  it.each([1, 3, 4, 5, 6] as const)('preserves surface placement and overlay geometry through v%i appearance resolution', version => {
    const source = fixture(version), original = canonicalJson(source), next = resolveAppearance(applyCompositionCommands(source, [shift], runtime()))
    for (const id of ['house', 'house:wall:0', 'road']) {
      expect(surfaceStyle(next.document, id)?.base).toMatchObject({ originMm: point(4000, 3700), rotationDeg: 15 })
      expect(sourceFor(next, id).parentSourceId).toBe(source.appearance.surfaceSources[id])
      expect(next.appearance.sources[source.appearance.surfaceSources[id]]).toEqual(sourceFor(source, id))
    }
    expect(next.document.rooms.house.floorStyle?.overlays[0]).toMatchObject({
      boundaryMm: [point(4000, 3500), point(5000, 3500), point(5000, 4500)], paint: { originMm: point(80, 120), rotationDeg: 20 },
    })
    for (const id of ['ground', 'other', 'house:wall:2']) {
      expect(next.appearance.surfaceSources[id]).toBe(source.appearance.surfaceSources[id])
      expect(surfaceStyle(next.document, id)).toEqual(surfaceStyle(source.document, id))
    }
    expect(canonicalJson(source)).toBe(original)
  })

  it('transforms original fixed paints while retaining effective derived materials and layer/instance adjustments', () => {
    let source = fixture()
    source.appearance.layerAdjustments[layerId] = [{ id: 'layer-brightness', enabled: true, kind: 'brightness', value: .7 }]
    source.appearance.instanceAdjustments.house = [{ id: 'house-tint', enabled: true, kind: 'tint', value: '#778899' }]
    for (const variant of listRequiredVariants(source)) {
      source.appearance.variants[variant.id] = variant
      source.document.assets[variant.outputAssetId] = { ...cloneJson(source.document.assets[variant.sourceAssetId]), id: variant.outputAssetId }
    }
    source = resolveAppearance(source)
    const oldSource = sourceFor(source, 'house'), material = source.document.rooms.house.floorStyle!.base.materialRef
    expect(material.id).toMatch(/^composition-material-/)
    const next = resolveAppearance(applyCompositionCommands(source, [shift], runtime()))
    expect(sourceFor(next, 'house').snapshot.base).toMatchObject({ materialRef: { id: 'b2-m-03', version: 1 }, tint: null, originMm: point(4000, 3700) })
    expect(next.document.rooms.house.floorStyle?.base.materialRef).toEqual(material)
    expect(next.appearance.sources[oldSource.id]).toEqual(oldSource)
    expect(next.appearance.layerAdjustments).toEqual(source.appearance.layerAdjustments)
    expect(next.appearance.instanceAdjustments).toEqual(source.appearance.instanceAdjustments)
    expect(next.appearance.variants).toEqual(source.appearance.variants)
    expect(next.document.materials).toEqual(source.document.materials)
  })

  it.each([1, 3, 5] as const)('accumulates sequential translations and quarter-turns in one v%i transaction', version => {
    const source = fixture(version), next = resolveAppearance(applyCompositionCommands(source, [shift, turn], runtime()))
    expect(next.document.rooms.house.floorStyle?.base).toMatchObject({ originMm: point(16300, 4000), rotationDeg: 105 })
    expect(next.document.rooms.house.floorStyle?.overlays[0]).toMatchObject({
      boundaryMm: [point(16500, 4000), point(16500, 5000), point(15500, 5000)], paint: { originMm: point(80, 120), rotationDeg: 20 },
    })
    const last = sourceFor(next, 'house'), parent = next.appearance.sources[last.parentSourceId!]
    expect(parent?.parentSourceId).toBe(source.appearance.surfaceSources.house)
    expect(next.appearance.sources[source.appearance.surfaceSources.house]).toEqual(sourceFor(source, 'house'))
    expect(next.appearance.surfaceSources.ground).toBe(source.appearance.surfaceSources.ground)
    expect(next.appearance.surfaceSources.other).toBe(source.appearance.surfaceSources.other)
  })

  it('keeps per-command source ancestry when a subsequent transform returns to the same geometry, including owned drafts', () => {
    const source = fixture(), commands = [shift, { ...shift, offsetMm: point(-1000, -500) }]
    const publicResult = applyCompositionCommands(source, commands, runtime()), draftResult = applyCompositionDraftCommands(source, commands, runtime())
    for (const next of [publicResult, draftResult]) {
      expect(resolveAppearance(next).document.rooms.house.floorStyle).toEqual(source.document.rooms.house.floorStyle)
      const last = sourceFor(next, 'house'), parent = next.appearance.sources[last.parentSourceId!]
      expect(last.id).not.toBe(source.appearance.surfaceSources.house)
      expect(parent?.parentSourceId).toBe(source.appearance.surfaceSources.house)
    }
    expect(draftResult.appearance).toEqual(publicResult.appearance)
    const noop = applyCompositionCommands(source, [{ ...shift, offsetMm: point(0, 0) }], runtime())
    expect(noop.appearance).toEqual(source.appearance)
  })

  it.each([1, 3] as const)('uses the newly connected component when a v%i batch first creates a shared building', version => {
    const source = fixture(version), next = resolveAppearance(applyCompositionCommands(source, [
      { type: 'createRoom', id: 'bridge-room', floorId, layerId, thicknessMm: 200, supportRef: { kind: 'terrainArea', id: 'ground' },
        boundaryMm: [point(8000, 2000), point(14000, 2000), point(14000, 12000), point(12000, 12000), point(12000, 8000), point(8000, 8000)] },
      shift,
    ], runtime()))
    expect(next.document.rooms.other.floorStyle?.base.originMm).toEqual(point(4000, 3700))
    expect(next.document.rooms.other.floorStyle?.overlays[0].boundaryMm).toEqual([point(4000, 3500), point(5000, 3500), point(5000, 4500)])
    expect(sourceFor(next, 'other').parentSourceId).toBe(source.appearance.surfaceSources.other)
    expect(next.appearance.surfaceSources.ground).toBe(source.appearance.surfaceSources.ground)
  })

  it.each([1, 3] as const)('keeps both v%i surface transforms when a later command deletes their connecting free wall', version => {
    const source = fixture(version, true), next = resolveAppearance(applyCompositionCommands(source, [shift, { type: 'deleteWall', id: 'bridge' }], runtime()))
    expect(next.document.walls.bridge).toBeUndefined()
    expect(next.document.rooms.house.floorStyle?.base.originMm).toEqual(point(4000, 3700))
    expect(next.document.rooms.other.floorStyle?.base.originMm).toEqual(point(4000, 3700))
    expect(sourceFor(next, 'other').parentSourceId).toBe(source.appearance.surfaceSources.other)
  })

  it.each([1, 3] as const)('excludes the disconnected v%i room when its bridge is deleted before transformation', version => {
    const source = fixture(version, true), next = resolveAppearance(applyCompositionCommands(source, [{ type: 'deleteWall', id: 'bridge' }, shift], runtime()))
    expect(next.document.rooms.house.floorStyle?.base.originMm).toEqual(point(4000, 3700))
    expect(next.document.rooms.other.floorStyle).toEqual(source.document.rooms.other.floorStyle)
    expect(next.appearance.surfaceSources.other).toBe(source.appearance.surfaceSources.other)
  })
})
