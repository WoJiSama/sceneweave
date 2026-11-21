import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { BoundsMm, SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { visualBase } from '../visual/base.js'
import { WALL_RELIEF_MATERIAL_ID } from '../appearance/wall-edge-profile.js'
import { missingCoverageBounds } from './privacy-coverage.js'
import { boundsCovered, getPlayerCoverageDiagnostics, PlayerCoverageError, projectScene } from './projection.js'

const rect = ({ x, y, width, height }: BoundsMm) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const floorId = 'visual-floor', layerId = 'visual-layer-ground'
function fixture(): SceneDocument {
  const scene = createRefinedBlankDocument('island', { sceneId: 'coverage-diagnosis', title: '精确保密覆盖诊断', widthMm: 24000, heightMm: 18000,
    now: '2026-11-18T00:00:00.000Z', preset: 'narrative' })
  const theme = scene.styleThemes[scene.activeStyleThemeRef!.id]
  theme.shadowPresets.wall = { directionDeg: 50, offsetMm: 130, blurMm: 70, opacity: .22, color: '#4C3D2C' }
  const points = rect({ x: 4000, y: 3000, width: 4000, height: 3000 })
  for (const [i, p] of points.entries()) {
    const id = `v${i}`, wallId = `w${i}`
    scene.vertices[id] = { id, floorId, editLocked: false, xMm: p.x, yMm: p.y }
    scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId: id, endVertexId: `v${(i + 1) % 4}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[id] = layerId; scene.entityLayers[wallId] = layerId
  }
  scene.rooms.secret = { id: 'secret', floorId, editLocked: false, visibility: 'gm', boundaryVertexIds: points.map((_, i) => `v${i}`), purpose: '秘密账房',
    accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0, floorStyle: null }
  scene.entityLayers.secret = layerId
  return scene
}
function mask(scene: SceneDocument, id: string, bounds: BoundsMm, selectedFloor = floorId, selectedLayer = layerId) {
  scene.regions[id] = { id, floorId: selectedFloor, editLocked: false, visibility: 'gm', kind: 'manualMask', boundaryMm: rect(bounds), blocksMovement: false, movementCostMultiplier: 1 }
  scene.entityLayers[id] = selectedLayer
}
const expectedRoomBounds = { x: 3390, y: 2390, width: 5220, height: 4220 }

describe('player coverage diagnosis from the exact projection safety boundary', () => {
  it('reports the real wall thickness and shadow envelope without mutating the source', () => {
    const scene = fixture(), before = canonicalJson(scene)
    const issues = getPlayerCoverageDiagnostics(scene)
    expect(issues).toEqual([{ entityKind: 'room', entityId: 'secret', floorId, requiredBoundsMm: expectedRoomBounds, missingBoundsMm: [expectedRoomBounds] }])
    expect(() => projectScene(scene, 'player')).toThrow(PlayerCoverageError)
    expect(() => projectScene(scene, 'player')).toThrow('固定遮罩未覆盖私密几何、视觉范围或装饰阴影')
    expect(canonicalJson(scene)).toBe(before)
    mask(scene, 'cover', expectedRoomBounds)
    expect(getPlayerCoverageDiagnostics(scene)).toEqual([])
    expect(projectScene(scene, 'player').rooms).toEqual([])
  })

  it('reports only missing strips when an existing mask already covers the room body', () => {
    const scene = fixture()
    mask(scene, 'body', { x: 4000, y: 3000, width: 4000, height: 3000 })
    expect(getPlayerCoverageDiagnostics(scene)[0].missingBoundsMm).toEqual([
      { x: 3390, y: 2390, width: 610, height: 4220 },
      { x: 4000, y: 2390, width: 4000, height: 610 },
      { x: 4000, y: 6000, width: 4000, height: 610 },
      { x: 8000, y: 2390, width: 610, height: 4220 },
    ])
  })

  it('collects related private props together and clips every required envelope to the output', () => {
    const scene = fixture()
    scene.floors[floorId].outputBoundsMm = { x: 5000, y: 3500, width: 10000, height: 10000 }
    scene.props.owned = { id: 'owned', floorId, editLocked: false, visibility: 'public', definitionRef: null,
      appearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, positionMm: { x: 6000, y: 4000 }, rotationDeg: 0,
      visualBoundsMm: { x: -500, y: -300, width: 1000, height: 600 }, footprintMm: { width: 400, height: 400 }, footprintOffsetMm: { x: 0, y: 0 },
      blocksMovement: false, blocksSight: false, supportRef: { kind: 'room', id: 'secret' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null }
    scene.entityLayers.owned = layerId
    const issues = getPlayerCoverageDiagnostics(scene, undefined, { floorId })
    expect(issues.map(issue => [issue.entityKind, issue.entityId])).toEqual([['room', 'secret'], ['prop', 'owned']])
    expect(issues[0].requiredBoundsMm).toEqual({ x: 5000, y: 3500, width: 3610, height: 3110 })
    expect(issues[1].requiredBoundsMm).toEqual({ x: 5500, y: 3700, width: 1000, height: 600 })
  })

  it('does not use another Floor mask and requires explicit Floor selection', () => {
    const scene = fixture(), upper = 'upper-floor', upperLayer = 'upper-layer'
    scene.floors[floorId].outputBoundsMm = cloneJson(scene.exportBoundsMm)
    scene.floors[floorId].environment = cloneJson(visualBase(scene)!.environment)
    scene.floors[upper] = { ...cloneJson(scene.floors[floorId]), id: upper, name: '楼上' }
    scene.userLayers[upperLayer] = { ...cloneJson(scene.userLayers[layerId]), id: upperLayer, floorId: upper }
    mask(scene, 'upper-mask', expectedRoomBounds, upper, upperLayer)
    expect(() => getPlayerCoverageDiagnostics(scene)).toThrow('多楼层投影必须明确选择目标Floor')
    expect(getPlayerCoverageDiagnostics(scene, undefined, { floorId }).map(issue => issue.entityId)).toEqual(['secret'])
    expect(getPlayerCoverageDiagnostics(scene, undefined, { floorId: upper })).toEqual([])
  })

  it('preserves structural errors instead of classifying them as fixable mask gaps', () => {
    const scene = fixture()
    delete scene.vertices.v0
    expect(() => getPlayerCoverageDiagnostics(scene)).toThrow('场景不能绘制')
    try { getPlayerCoverageDiagnostics(scene) } catch (error) { expect(error).not.toBeInstanceOf(PlayerCoverageError) }
  })

  it('retains the standalone stone-wall full-envelope refusal even for missing pixels outside the crop', () => {
    const scene = fixture()
    scene.rooms = {}
    delete scene.entityLayers.secret
    for (const id of ['w1', 'w2', 'w3']) { delete scene.walls[id]; delete scene.entityLayers[id] }
    const originalMaterial = Object.values(scene.materials).find(material => material.applicableSurfaces.includes('wall'))!
    const material = { ...cloneJson(originalMaterial), id: WALL_RELIEF_MATERIAL_ID, version: 1 }
    scene.materials[material.id] = material
    scene.walls.w0.edgeProfile = 'stone-blocks-v1'
    scene.walls.w0.topStyle = { base: { materialRef: { id: material.id, version: 1 }, tileSizeMm: cloneJson(material.defaultTileSizeMm), rotationDeg: 0,
      alignment: 'world', originMm: { x: 0, y: 0 }, opacity: 1, tint: null }, overlays: [] }
    scene.floors[floorId].outputBoundsMm = { x: 4000, y: 3000, width: 10000, height: 10000 }
    mask(scene, 'wall-body', { x: 3490, y: 2490, width: 5020, height: 1020 })
    mask(scene, 'visible-relief', { x: 4000, y: 3000, width: 4555, height: 555 })
    const issue = getPlayerCoverageDiagnostics(scene).find(row => row.reason === 'wall-relief')!
    expect(issue.requiredBoundsMm).toEqual({ x: 3445, y: 2445, width: 5110, height: 1110 })
    expect(issue.missingBoundsMm.some(box => box.x < 4000 || box.y < 3000)).toBe(true)
    expect(() => projectScene(scene, 'player')).toThrow('固定遮罩还需覆盖块石外缘')
    mask(scene, 'full-relief', issue.requiredBoundsMm)
    expect(getPlayerCoverageDiagnostics(scene)).toEqual([])
  })
})

describe('exact uncovered rectangle union', () => {
  it('returns disjoint missing cells matching actual covered area, including overlapping masks', () => {
    const bounds = { x: 0, y: 0, width: 20, height: 20 }
    const masks = [{ x: -5, y: 3, width: 15, height: 7 }, { x: 5, y: 5, width: 12, height: 9 }, { x: 3, y: 14, width: 9, height: 10 }]
    const missing = missingCoverageBounds(bounds, masks)
    const includes = (box: BoundsMm, x: number, y: number) => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height
    let uncovered = 0
    for (let y = .5; y < 20; y++) for (let x = .5; x < 20; x++) {
      const count = missing.filter(box => includes(box, x, y)).length
      expect(count).toBe(masks.some(box => includes(box, x, y)) ? 0 : 1)
      uncovered += count
    }
    expect(missing.reduce((sum, box) => sum + box.width * box.height, 0)).toBe(uncovered)
  })

  it('agrees with the pre-existing safety predicate over varied rectangle unions and one-mm gaps', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    let seed = 13
    const random = () => { seed = seed * 16807 % 2147483647; return seed % 141 - 20 }
    for (let i = 0; i < 120; i++) {
      const masks = Array.from({ length: i % 7 }, () => ({ x: random(), y: random(), width: Math.abs(random()) + 1, height: Math.abs(random()) + 1 }))
      expect(missingCoverageBounds(bounds, masks).length === 0).toBe(boundsCovered(bounds, masks))
    }
    expect(missingCoverageBounds(bounds, [{ ...bounds, width: 99 }])).toEqual([{ x: 99, y: 0, width: 1, height: 100 }])
    expect(missingCoverageBounds(bounds, [{ x: -10, y: -10, width: 70, height: 120 }, { x: 50, y: -10, width: 60, height: 120 }])).toEqual([])
  })
})
