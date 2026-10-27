import { describe, expect, it } from 'vitest'
import type { Prop } from '../../../shared/model/scene.js'
import { createBlankDocumentV2 } from '../../../editor/v2/blank-project'
import { migrateSceneV2 } from '../../../core/v3/migration'
import { projectScene } from '../../../shared/projection/projection.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { createEditorRenderPlan as createEditorRenderPlanV2, editorPaintBounds as editorPaintBoundsV2 } from './editor-render-plan'

function projection() {
  const scene = createBlankDocumentV2({ title: 'editor plan', widthMm: 10000, heightMm: 8000, preset: 'investigation', sceneId: 'editor-plan', now: '2026-10-21T00:00:00.000Z' })
  const prop: Prop = { id: 'item', floorId: 'blank-floor', editLocked: false, definitionRef: null,
    appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, visualBoundsMm: { x: -50, y: -50, width: 100, height: 100 },
    positionMm: { x: 1000, y: 1000 }, rotationDeg: 0, footprintMm: { width: 100, height: 100 }, footprintOffsetMm: { x: 0, y: 0 },
    blocksMovement: false, blocksSight: false, visibility: 'public', supportRef: { kind: 'floor', id: 'blank-floor' }, renderLayer: 'object', renderOrder: 0,
    shadowClass: 'none', shadowOverride: null }
  scene.props.item = prop
  return projectScene({ ...migrateSceneV2(scene, { sceneId: `${scene.sceneId}-native`, now: scene.updatedAt }), format: 'sceneweave-scene', schemaVersion: 1 }, 'gm')
}

describe('editor-only prop rendering plan', () => {
  it('chooses deterministic detail from screen size and restores detail on zoom', () => {
    const source = projection(), before = structuredClone(source)
    expect(createEditorRenderPlanV2(source, { screenScalePxPerMm: .119 }).props[0].detail).toBe('outline')
    expect(createEditorRenderPlanV2(source, { screenScalePxPerMm: .12 }).props[0].detail).toBe('image')
    expect(createEditorRenderPlanV2(source, { screenScalePxPerMm: .399 }).props[0].detail).toBe('image')
    expect(createEditorRenderPlanV2(source, { screenScalePxPerMm: .4 }).props[0].detail).toBe('full')
    expect(source).toEqual(before)
  })

  it('uses rotated visual bounds rather than physical footprint or unrotated width', () => {
    const source = projection(); source.props[0].rotationDeg = 45
    source.props[0].footprintMm = { width: 9000, height: 7000 }
    const result = createEditorRenderPlanV2(source, { screenScalePxPerMm: .1 })
    expect(result.props[0].detail).toBe('image')
    expect(result.props[0].screenSizePx).toBeCloseTo(Math.SQRT2 * 10)
    expect(result.props[0].visualBoundsMm.width).toBeCloseTo(Math.SQRT2 * 100)
  })

  it('omits offscreen bodies but retains a full-detail shadow crossing the crop edge', () => {
    const source = projection(), prop = source.props[0]
    prop.positionMm = { x: 800, y: 1000 }
    const crop = { x: 1000, y: 900, width: 1000, height: 1000 }
    expect(createEditorRenderPlanV2(source, { viewBoundsMm: crop, screenScalePxPerMm: .4 }).omittedPropCount).toBe(1)
    prop.shadowOverride = { directionDeg: 0, offsetMm: 200, blurMm: 20, opacity: .5, color: '#39443E' }
    const withShadow = createEditorRenderPlanV2(source, { viewBoundsMm: crop, screenScalePxPerMm: .4 })
    expect(withShadow.props).toHaveLength(1)
    expect(withShadow.props[0].paintBoundsMm).toEqual({ x: 470, y: 670, width: 660, height: 660 })
    // The medium representation draws no shadow, so that hidden body is omitted.
    expect(createEditorRenderPlanV2(source, { viewBoundsMm: crop, screenScalePxPerMm: .2 }).omittedPropCount).toBe(1)
  })

  it('retains offscreen source alpha for visual contact shadows at every detail level', () => {
    const source = projection(), prop = source.props[0], visual = emptyVisualSystem()
    prop.positionMm = { x: 800, y: 1000 }; prop.shadowClass = 'furniture'
    visual.environment.contactShadowMm = 100; visual.environment.contactShadowOpacity = .4
    source.visual = { ...visual, boundsMm: source.bounds, boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [], occluderRings: [], contactRings: [], suppressedTerrainEdgeIds: [] }
    const crop = { x: 1000, y: 900, width: 1000, height: 1000 }
    expect(createEditorRenderPlanV2(source, { viewBoundsMm: crop, screenScalePxPerMm: .1 }).props).toHaveLength(1)
    expect(createEditorRenderPlanV2(source, { viewBoundsMm: crop, screenScalePxPerMm: .4 }).props).toHaveLength(1)
    visual.environment.contactShadowMm = 0
    expect(createEditorRenderPlanV2(source, { viewBoundsMm: crop, screenScalePxPerMm: .4 }).props).toHaveLength(0)
  })

  it('clamps a temporary crop while preserving order, exact source props and resource closure', () => {
    const source = projection(), original = source.props[0]
    source.props.push({ ...structuredClone(original), id: 'other', positionMm: { x: 6000, y: 4000 } })
    source.assetIds = ['even-if-only-offscreen']
    const result = createEditorRenderPlanV2(source, { viewBoundsMm: { x: -1000, y: -2000, width: 5000, height: 5000 }, screenScalePxPerMm: .2 })
    expect(result.boundsMm).toEqual({ x: 0, y: 0, width: 4000, height: 3000 })
    expect(result.props.map(entry => entry.prop.id)).toEqual(['item'])
    expect(result.detailCounts).toEqual({ outline: 0, image: 1, full: 0 })
    expect(source.assetIds).toEqual(['even-if-only-offscreen'])
    expect(source.props).toHaveLength(2)
    expect(source.bounds).toEqual({ x: 0, y: 0, width: 10000, height: 8000 })
  })

  it('pads a cropped raster for shadow sources and clamps the padded bounds to the fixed output range', () => {
    const source = projection(); source.props[0].shadowOverride = { directionDeg: 0, offsetMm: 100, blurMm: 10, opacity: .5, color: '#39443E' }
    const plan = createEditorRenderPlanV2(source, { viewBoundsMm: { x: 900, y: 900, width: 500, height: 500 }, screenScalePxPerMm: 1 })
    expect(editorPaintBoundsV2(source, plan)).toEqual({ x: 760, y: 760, width: 780, height: 780 })
    const full = createEditorRenderPlanV2(source, { screenScalePxPerMm: 1 })
    expect(editorPaintBoundsV2(source, full)).toEqual(source.bounds)
  })

  it('keeps wide materialized strokes visible when their centerline falls outside the editor crop', () => {
    const source = projection(), visual = emptyVisualSystem()
    visual.environment.contactShadowMm = 0
    source.visual = { environment: visual.environment, boundsMm: source.bounds, boundaries: [], edgeLooks: [], lights: [], fogs: [], filters: [],
      occluderRings: [], contactRings: [], suppressedTerrainEdgeIds: [], materializedEdges: [{ id: 'wide-edge', kind: 'shore', polygons: [],
        strokes: [{ id: 'wide-stroke', pointsMm: [{ x: 700, y: 900 }, { x: 700, y: 1400 }], widthMm: 600, color: '#FFFFFF', opacity: 1 }], fillColor: '#FFFFFF', opacity: 1 }] }
    const plan = createEditorRenderPlanV2(source, { viewBoundsMm: { x: 900, y: 900, width: 500, height: 500 }, screenScalePxPerMm: 1 })
    expect(editorPaintBoundsV2(source, plan)).toEqual({ x: 600, y: 600, width: 1100, height: 1100 })
    expect(editorPaintBoundsV2(source, createEditorRenderPlanV2(source, { screenScalePxPerMm: 1 }))).toEqual(source.bounds)
  })

  it('rejects invalid scales and non-intersecting or invalid crops', () => {
    const source = projection()
    for (const scale of [0, -1, NaN, Infinity]) expect(() => createEditorRenderPlanV2(source, { screenScalePxPerMm: scale })).toThrow(/比例/)
    for (const viewBoundsMm of [{ x: 20000, y: 0, width: 100, height: 100 }, { x: NaN, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 0, height: 100 }]) {
      expect(() => createEditorRenderPlanV2(source, { screenScalePxPerMm: .2, viewBoundsMm })).toThrow(/视口/)
    }
  })
})
