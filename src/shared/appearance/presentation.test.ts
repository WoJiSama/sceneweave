import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { applyCompositionCommands } from './commands.js'
import { createCompositionContent, propAppearanceSnapshot } from './graph.js'
import { effectivePropShadow, nearSidePaintEnvelope, presentationBounds, presentationContact, presentationShadow, presentationSourceId, propPaintPolygon, propPresentation, propShadowDirection, validatePresentations } from './presentation.js'
import type { CompositionContent } from '../model/appearance.js'
import type { Prop } from '../model/scene.js'
import { emptyTerrainDocument } from '../terrain-generation/compose.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import type { PreparationContext } from '../ports/runtime.js'

const now = '2026-10-27T00:00:00.000Z'
let sequence = 0
const runtime = (): PreparationContext => ({ ids: { nextId: () => `presentation-test-${++sequence}` }, clock: { now: () => now } })

function content(): CompositionContent {
  const source = createRefinedBlankDocument('island', { sceneId: 'presentation-test', title: '固定表现测试', widthMm: 24000, heightMm: 18000, preset: 'narrative', now })
  const scene = emptyTerrainDocument(source)
  const definition = Object.values(scene.propDefinitions).find(row => row.defaultAppearance.kind === 'image')
  if (!definition || definition.defaultAppearance.kind !== 'image') throw new Error('固定图片定义缺失')
  const prop: Prop = { id: 'near-tree', floorId: 'visual-floor', editLocked: false, visibility: 'public', definitionRef: { id: definition.id, version: definition.version },
    appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), positionMm: { x: 7000, y: 8000 }, rotationDeg: 0,
    footprintMm: cloneJson(definition.defaultFootprintMm), footprintOffsetMm: cloneJson(definition.defaultFootprintOffsetMm), blocksMovement: definition.defaultBlocksMovement,
    blocksSight: definition.defaultBlocksSight, supportRef: { kind: 'floor', id: 'visual-floor' }, renderLayer: definition.defaultRenderLayer, renderOrder: 0,
    shadowClass: definition.defaultShadowClass, shadowOverride: null }
  scene.props[prop.id] = prop; scene.entityLayers[prop.id] = 'visual-layer-props'
  const result = createCompositionContent(scene, runtime())
  const originalSourceId = result.appearance.propSources[prop.id], original = result.appearance.sources[originalSourceId]
  if (!original || original.kind !== 'prop') throw new Error('固定表现源缺失')
  const nearSide = { mode: 'nearSide' as const, rootAnchorMm: { x: 0, y: Math.round(prop.visualBoundsMm.y + prop.visualBoundsMm.height * .75) }, orientation: 'fixedUpright' as const, fixedRotationDeg: 0 as const,
    footprintAxes: 'world' as const, groundShadowMm: [{ x: -100, y: -80 }, { x: 420, y: -80 }, { x: 520, y: 260 }, { x: -80, y: 260 }] }
  const nearSourceId = presentationSourceId(propAppearanceSnapshot(original.snapshot), original.parentSourceId, nearSide)
  result.appearance.sources[nearSourceId] = { ...cloneJson(original), id: nearSourceId }
  result.appearance.propSources[prop.id] = nearSourceId
  result.appearance.presentations![nearSourceId] = nearSide
  validatePresentations(result.appearance, result.document)
  return result
}

describe('fixed near-side prop presentations', () => {
  it('binds a stable source identity and paints from the root anchor', () => {
    const source = content(), prop = source.document.props['near-tree'], presentation = propPresentation(source.appearance, prop.id)
    if (!presentation || presentation.mode !== 'nearSide') throw new Error('near-side presentation missing')
    const snapshot = source.appearance.sources[source.appearance.propSources[prop.id]]
    if (!snapshot || snapshot.kind !== 'prop') throw new Error('near-side source missing')
    expect(source.appearance.propSources[prop.id]).toBe(presentationSourceId(snapshot.snapshot, snapshot.parentSourceId, presentation))
    const bounds = presentationBounds(prop, presentation), paint = propPaintPolygon(prop, presentation)
    expect(bounds.y).toBe(prop.visualBoundsMm.y - presentation.rootAnchorMm.y)
    expect(paint[0]).toEqual({ x: prop.positionMm.x + bounds.x, y: prop.positionMm.y + bounds.y })
    const rotated = cloneJson(prop); rotated.rotationDeg = 137
    expect(propPaintPolygon(rotated, presentation)).toEqual(paint)
    expect(presentationShadow(prop, presentation, 0)[0]).toEqual({ x: prop.positionMm.x - 100, y: prop.positionMm.y - 80 })
    expect(presentationShadow(prop, presentation, 90)[0].x).toBeCloseTo(prop.positionMm.x + 80)
    expect(presentationShadow(prop, presentation, 90)[0].y).toBeCloseTo(prop.positionMm.y - 100)
    expect(presentationShadow(prop, presentation, 0, 500)[0]).toEqual({ x: prop.positionMm.x + 400, y: prop.positionMm.y - 80 })
    expect(presentationContact(prop, presentation)).toHaveLength(4)
    expect(presentationContact(prop, presentation)[0]).toEqual({ x: prop.positionMm.x - prop.footprintMm.width / 2, y: prop.positionMm.y - prop.footprintMm.height / 2 })
  })

  it('rejects an out-of-bounds root and malformed source shadow', () => {
    const source = content(), sourceId = source.appearance.propSources['near-tree'], presentation = source.appearance.presentations![sourceId]
    const snapshot = source.appearance.sources[sourceId]
    if (!snapshot || snapshot.kind !== 'prop' || presentation.mode !== 'nearSide') throw new Error('near-side fixture missing')
    const outside = cloneJson(source.appearance)
    outside.presentations![sourceId].rootAnchorMm = { x: snapshot.snapshot.visualBoundsMm.width + 1, y: 0 }
    expect(() => validatePresentations(outside, source.document)).toThrow(/表现内容|根锚点/)
    const malformed = cloneJson(source.appearance)
    malformed.presentations![sourceId].groundShadowMm = [{ x: 1000, y: 1000 }, { x: 1200, y: 1000 }, { x: 1200, y: 1200 }, { x: 1000, y: 1200 }]
    expect(() => validatePresentations(malformed, source.document)).toThrow(/表现内容|地面影|包含树根|自交/)
  })

  it('keeps near-side props upright on edits and preserves the presentation when copied', () => {
    const source = content()
    expect(() => applyCompositionCommands(source, [{ type: 'updateProp', id: 'near-tree', changes: { rotationDeg: 45 } }], runtime())).toThrow(/直立|旋转/)
    const copied = applyCompositionCommands(source, [{ type: 'copyProp', id: 'near-tree', newId: 'near-tree-copy', offsetMm: { x: 500, y: 300 } }], runtime())
    expect(copied.document.props['near-tree-copy'].rotationDeg).toBe(0)
    expect(copied.appearance.propSources['near-tree-copy']).toBe(source.appearance.propSources['near-tree'])
    expect(canonicalJson(copied.appearance.presentations![source.appearance.propSources['near-tree']])).toBe(canonicalJson(source.appearance.presentations![source.appearance.propSources['near-tree']]))
  })

  it('uses a light near-side default shadow while preserving explicit overrides', () => {
    const source = content(), prop = source.document.props['near-tree'], presentation = propPresentation(source.appearance, prop.id)
    expect(effectivePropShadow(prop, presentation, { directionDeg: 50, offsetMm: 300, blurMm: 110, opacity: .24, color: '#294D42' })).toMatchObject({ offsetMm: 150, blurMm: 48, opacity: .12 })
    const override = { directionDeg: 135, offsetMm: 420, blurMm: 24, opacity: .42, color: '#123456' }
    prop.shadowOverride = override
    expect(effectivePropShadow(prop, presentation)).toEqual(override)
    expect(propShadowDirection(prop, effectivePropShadow(prop, presentation), 25)).toBe(135)
    const envelope = nearSidePaintEnvelope(prop, presentation, override, 25, 100)
    expect(envelope).not.toBeNull()
    expect(envelope!.x).toBeLessThan(prop.positionMm.x - prop.footprintMm.width / 2 - 399)
    expect(envelope!.y).toBeLessThan(prop.positionMm.y - prop.footprintMm.height / 2 - 399)
    expect(envelope!.width).toBeGreaterThan(prop.footprintMm.width + 800)
    prop.shadowClass = 'none'
    expect(effectivePropShadow(prop, presentation)).toEqual(override)
    prop.shadowOverride = null
    expect(effectivePropShadow(prop, presentation)).toBeNull()
    expect(propShadowDirection(prop, effectivePropShadow(prop, presentation), 25)).toBe(25)
  })

  it('requires player masks to cover the blurred root contact shadow envelope', async () => {
    const source = content(), prop = source.document.props['near-tree'], presentation = propPresentation(source.appearance, prop.id)
    if (!presentation || presentation.mode !== 'nearSide' || source.document.visual?.version !== 2) throw new Error('near-side fixture missing')
    prop.visibility = 'gm'
    source.document.visual.base.environment.contactShadowMm = 1000
    source.document.visual.base.environment.contactShadowOpacity = .4
    const shadow = effectivePropShadow(prop, presentation), base = nearSidePaintEnvelope(prop, presentation, shadow, 135)
    const complete = nearSidePaintEnvelope(prop, presentation, shadow, 135, 1000)
    if (!base || !complete) throw new Error('near-side paint envelope missing')
    const rectangle = (bounds: { x: number; y: number; width: number; height: number }) => {
      const left = Math.floor(bounds.x), top = Math.floor(bounds.y), right = Math.ceil(bounds.x + bounds.width), bottom = Math.ceil(bounds.y + bounds.height)
      return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
    }
    source.document.regions['near-side-mask'] = { id: 'near-side-mask', floorId: prop.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: rectangle(base), blocksMovement: false, movementCostMultiplier: 1 }
    source.document.entityLayers['near-side-mask'] = Object.keys(source.document.userLayers)[0]
    const { projectScene } = await import('../projection/projection.js')
    expect(() => projectScene(source.document, 'player', source.appearance)).toThrow(/固定遮罩/)
    source.document.regions['near-side-mask'].boundaryMm = rectangle(complete)
    expect(() => projectScene(source.document, 'player', source.appearance)).not.toThrow()
  })

  it('keeps the fixed presentation out of the disposable player projection metadata', async () => {
    const source = content(), { projectScene } = await import('../projection/projection.js')
    const projection = projectScene(source.document, 'player', source.appearance)
    expect(projection.propPresentations?.['near-tree']).toMatchObject({ mode: 'nearSide', rootAnchorMm: { x: 0 } })
    expect(JSON.stringify(projection)).not.toContain('presentation-source-')
    expect(JSON.stringify(projection)).not.toContain('fixedRotationDeg')
  })
})
