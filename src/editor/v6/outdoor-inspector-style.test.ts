import { describe, expect, it } from 'vitest'
import { surfaceFixtureV6 } from '../../core/v6/test-fixtures'
import { outdoorInspectorStyle } from './outdoor-inspector-style'

describe('outdoor property edits preserve complete paint', () => {
  it('retains custom placement, tint and overlays during an unrelated geometry edit without aliasing the source', () => {
    const scene = surfaceFixtureV6().document, prior = scene.terrainAreas.domain.surfaceStyle!
    Object.assign(prior.base, { tileSizeMm: { width: 700, height: 1100 }, rotationDeg: 35, alignment: 'surface', originMm: { x: -200, y: 125 }, tint: '#AABBCC' })
    Object.assign(prior.overlays[0], { blendWidthMm: 120, renderOrder: 3 })
    Object.assign(prior.overlays[0].paint, { rotationDeg: 340, opacity: .75 })
    const before = structuredClone(prior), result = outdoorInspectorStyle(scene, 'material', prior)!
    expect(result).toEqual(before)
    result.base.originMm.x = 999
    result.overlays[0].boundaryMm[0].x = 999
    expect(prior).toEqual(before)
  })

  it('switches only the fixed base reference and preserves local overlays and placement', () => {
    const scene = surfaceFixtureV6().document, prior = scene.terrainAreas.domain.surfaceStyle!
    scene.materials.other = { ...structuredClone(scene.materials.material), id: 'other', version: 7, defaultTileSizeMm: { width: 2000, height: 3000 } }
    const before = structuredClone(prior)
    expect(outdoorInspectorStyle(scene, 'other', prior)).toEqual({ ...before, base: { ...before.base, materialRef: { id: 'other', version: 7 } } })
    expect(prior).toEqual(before)
    expect(outdoorInspectorStyle(scene, 'other', null)?.base).toMatchObject({ materialRef: { id: 'other', version: 7 }, tileSizeMm: { width: 2000, height: 3000 }, rotationDeg: 0, tint: null, opacity: 1 })
  })

  it('removes all paint only on explicit clearing and refuses a missing material', () => {
    const scene = surfaceFixtureV6().document, prior = scene.terrainAreas.domain.surfaceStyle!
    const before = structuredClone(prior)
    expect(outdoorInspectorStyle(scene, '', prior)).toBeNull()
    expect(() => outdoorInspectorStyle(scene, 'missing-material', prior)).toThrow(/材质不存在/)
    expect(prior).toEqual(before)
  })
})
