import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import { projectScene } from './projection.js'

const floorId = 'visual-floor', layerId = 'visual-layer-ground'
const p = (x: number, y: number): PointMm => ({ x, y })
const directions = [
  ['negative slope', [p(1000, 13000), p(5000, 9000), p(9000, 5000), p(13000, 1000)]],
  ['positive slope', [p(1000, 1000), p(5000, 5000), p(9000, 9000), p(13000, 13000)]],
  ['horizontal', [p(1000, 7000), p(5000, 7000), p(9000, 7000), p(13000, 7000)]],
  ['vertical', [p(7000, 1000), p(7000, 5000), p(7000, 9000), p(7000, 13000)]],
] as const

function fixture(points: readonly PointMm[], order: number[], reversed = false): SceneDocument {
  const scene = createRefinedBlankDocument('island', { sceneId: 'wall-canonicalization', title: '墙段归一', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-11-11T00:00:00.000Z' })
  for (const [index, point] of points.entries()) {
    const id = `point-${index}`
    scene.vertices[id] = { id, floorId, editLocked: false, xMm: point.x, yMm: point.y }
    scene.entityLayers[id] = layerId
  }
  for (const index of order) {
    const id = `segment-${index}`, start = index === -1 ? 0 : index, end = index === -1 ? points.length - 1 : index + 1
    scene.walls[id] = { id, floorId, editLocked: false, startVertexId: `point-${reversed ? end : start}`, endVertexId: `point-${reversed ? start : end}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: null }
    scene.entityLayers[id] = layerId
  }
  return scene
}

describe('current player wall canonicalization', () => {
  it.each(directions)('makes %s chains match a whole wall regardless of insertion order or endpoint direction', (_name, points) => {
    const expected = projectScene(fixture(points, [-1]), 'player').walls
    for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0], [2, 1, 0]]) for (const reversed of [false, true]) {
      const scene = fixture(points, order, reversed), before = canonicalJson(scene), result = projectScene(scene, 'player')
      expect(result.walls).toEqual(expected)
      expect(canonicalJson(scene)).toBe(before)
      expect(projectScene(scene, 'gm').walls).toHaveLength(3)
    }
  })

  it('preserves public openings while an unrevealed secret does not introduce a split', () => {
    const points = directions[0][1], scene = fixture(points, [2, 1, 0], true)
    scene.openings.public = { id: 'public', floorId, editLocked: false, wallId: 'segment-0', offsetReferenceVertexId: 'point-0', offsetMm: 1000, widthMm: 1000, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }
    scene.entityLayers.public = layerId
    const expected = projectScene(scene, 'player').walls
    scene.openings.secret = { ...scene.openings.public, id: 'secret', wallId: 'segment-1', offsetReferenceVertexId: 'point-1', secret: true }
    scene.entityLayers.secret = layerId
    const result = projectScene(scene, 'player').walls
    expect(result).toHaveLength(1)
    expect(result[0].openings).toHaveLength(1)
    expect(result).toEqual(expected)
  })

  it.each(['layer', 'thickness', 'style', 'light'] as const)('keeps a genuine %s boundary separate', change => {
    const scene = fixture(directions[0][1].slice(0, 3), [1, 0]), wall = scene.walls['segment-1']
    if (change === 'layer') {
      scene.userLayers.other = { id: 'other', floorId, name: 'Other', order: Object.keys(scene.userLayers).length, editLocked: false }
      scene.entityLayers[wall.id] = 'other'
    } else if (change === 'thickness') wall.thicknessMm = 300
    else if (change === 'light') wall.blocksSight = false
    else {
      const material = Object.values(scene.materials).find(row => row.applicableSurfaces.includes('wall'))!
      wall.topStyle = { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { ...material.defaultTileSizeMm }, rotationDeg: 0, alignment: 'world', originMm: p(0, 0), tint: null, opacity: 1 }, overlays: [] }
    }
    expect(projectScene(scene, 'player').walls).toHaveLength(2)
  })
})
