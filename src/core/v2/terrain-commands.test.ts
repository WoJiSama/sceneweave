import { describe, expect, it } from 'vitest'
import { rectangleV2, terrainFixtureV2, testPropV2 } from './b3.test-helpers'
import { applyCommandsV2 } from './commands'
import { validateSceneV2 } from './schema'

function paintedFixture() {
  const scene = terrainFixtureV2(), origin = { kind: 'original' as const, attribution: 'Sceneweave command test', canEmbed: true }
  scene.assets.texture = { id: 'texture', sha256: 'a'.repeat(64), mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1, logicalSizeMm: { width: 1000, height: 1000 }, licenseRef: 'MIT', origin }
  scene.materials.grass = { id: 'grass', catalogId: 'sceneweave.test.grass', version: 1, licenseRef: 'MIT', origin, name: 'grass', tags: [], textureAssetId: 'texture', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['terrain'] }
  const paint = { materialRef: { id: 'grass', version: 1 }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, originMm: { x: 0, y: 0 }, alignment: 'world' as const, tint: null, opacity: 1 }
  scene.terrainAreas['island-low'].surfaceStyle = { base: paint, overlays: [{ id: 'grass-patch', boundaryMm: rectangleV2(2000, 2000, 2000, 2000), paint: structuredClone(paint), blendWidthMm: 200, renderOrder: 1 }] }
  return scene
}

describe('finite terrain and overlay atomic commands', () => {
  it('edits an overlay contour without changing material phase, support, base style or input', () => {
    const scene = paintedFixture(), before = structuredClone(scene), boundaryMm = rectangleV2(2100, 2200, 2300, 2400)
    const next = applyCommandsV2(scene, [{ type: 'setOverlayBoundary', kind: 'terrainArea', id: 'island-low', overlayId: 'grass-patch', boundaryMm }])
    expect(scene).toEqual(before)
    expect(next.terrainAreas['island-low'].surfaceStyle!.overlays[0].boundaryMm).toEqual(boundaryMm)
    expect(next.terrainAreas['island-low'].surfaceStyle!.base).toEqual(before.terrainAreas['island-low'].surfaceStyle!.base)
    expect(next.terrainConnections).toEqual(scene.terrainConnections)
    expect(next.revision).toBe(scene.revision)
  })
  it('rejects an invalid overlay after earlier height changes with no partial adoption and honors locks', () => {
    const scene = paintedFixture(), before = structuredClone(scene)
    expect(() => applyCommandsV2(scene, [{ type: 'setTerrainElevation', id: 'island-high', groundElevationMm: 4000 }, { type: 'setOverlayBoundary', kind: 'terrainArea', id: 'island-low', overlayId: 'grass-patch', boundaryMm: [{ x: 2000, y: 2000 }, { x: 4000, y: 4000 }, { x: 2000, y: 4000 }, { x: 4000, y: 2000 }] }])).toThrow(/事务未采用/)
    expect(scene).toEqual(before)
    scene.terrainAreas['island-low'].editLocked = true
    expect(() => applyCommandsV2(scene, [{ type: 'setOverlayBoundary', kind: 'terrainArea', id: 'island-low', overlayId: 'grass-patch', boundaryMm: rectangleV2(2000, 2000, 3000, 3000) }])).toThrow(/锁定/)
  })
  it('checks height dependants and explicit connection edit locks before changing inherited geometry', () => {
    const scene = terrainFixtureV2(); scene.props.tree = testPropV2('tree', 4000, 4000); scene.props.tree.editLocked = true
    expect(() => applyCommandsV2(scene, [{ type: 'setTerrainElevation', id: 'island-low', groundElevationMm: 1500 }])).toThrow(/tree/)
    scene.terrainConnections['island-stairs'].editLocked = true
    expect(() => applyCommandsV2(scene, [{ type: 'setTerrainElevation', id: 'island-high', groundElevationMm: 4000 }])).toThrow(/island-stairs/)
    expect(() => applyCommandsV2(scene, [{ type: 'removeTerrainConnection', id: 'island-stairs' }])).toThrow(/锁定/)
    expect(() => applyCommandsV2(scene, [{ type: 'setConnectionBlocked', id: 'island-stairs', blocksMovement: true }])).toThrow(/锁定/)
  })
  it('changes both copies of a shared endpoint in one final-valid transaction and rejects a one-sided crack', () => {
    const scene = terrainFixtureV2(), positionMm = { x: 11000, y: 1000 }
    expect(() => applyCommandsV2(scene, [{ type: 'moveTerrainPoint', areaId: 'island-low', pointId: 'island-low-v1', positionMm }])).toThrow(/事务未采用/)
    const next = applyCommandsV2(scene, [{ type: 'moveTerrainPoint', areaId: 'island-low', pointId: 'island-low-v1', positionMm }, { type: 'moveTerrainPoint', areaId: 'island-high', pointId: 'island-high-v0', positionMm }])
    expect(validateSceneV2(next).ok).toBe(true)
    expect(next.terrainEdges.cliff.source.segmentId).toBe('island-high-s3')
  })
  it('preserves anchors by rejecting connection deletion while referenced', () => {
    const scene = terrainFixtureV2()
    scene.notes.stairsNote = { id: 'stairsNote', floorId: 'f-a1', editLocked: false, visibility: 'public', kind: 'note', text: 'route', anchor: { type: 'entity', entityKind: 'terrainConnection', entityId: 'island-stairs' } }
    expect(() => applyCommandsV2(scene, [{ type: 'removeTerrainConnection', id: 'island-stairs' }])).toThrow(/注记引用/)
  })
})
