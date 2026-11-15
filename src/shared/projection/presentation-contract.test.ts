import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import type { BoundsMm, Prop, SceneDocument } from '../model/scene.js'
import { emptyTerrainDocument } from '../terrain-generation/compose.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { visualBase } from '../visual/base.js'
import { propPresentationEnvelope } from './presentation-contract.js'
import { projectScene } from './projection.js'

const body = { x: 6500, y: 7700, width: 1000, height: 600 }
function setMask(scene: SceneDocument, bounds: BoundsMm): void {
  const { x, y, width, height } = bounds
  scene.regions.mask = { id: 'mask', floorId: 'visual-floor', editLocked: false, visibility: 'gm', kind: 'manualMask',
    boundaryMm: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], blocksMovement: false, movementCostMultiplier: 1 }
  scene.entityLayers.mask = 'visual-layer-props'
}
function fixture(renderLayer: Prop['renderLayer'] = 'object', image = false): SceneDocument {
  const scene = emptyTerrainDocument(createRefinedBlankDocument('island', { sceneId: 'shadowless-contact-mask', title: '关闭阴影的私密物件',
    widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-11-14T00:00:00.000Z' }))
  scene.activeStyleThemeRef = null
  const definition = Object.values(scene.propDefinitions).find(row => row.defaultAppearance.kind === 'image')!
  scene.props.private = { id: 'private', floorId: 'visual-floor', editLocked: false, visibility: 'gm', definitionRef: image ? { id: definition.id, version: definition.version } : null,
    appearance: image ? cloneJson(definition.defaultAppearance) : { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
    positionMm: { x: 7000, y: 8000 }, rotationDeg: 0, visualBoundsMm: { x: -500, y: -300, width: 1000, height: 600 },
    footprintMm: { width: 400, height: 400 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
    supportRef: { kind: 'floor', id: 'visual-floor' }, renderLayer, renderOrder: 0, shadowClass: 'none', shadowOverride: null }
  scene.entityLayers.private = 'visual-layer-props'
  const environment = visualBase(scene)!.environment
  environment.contactShadowMm = 50; environment.contactShadowOpacity = .4
  setMask(scene, body)
  return scene
}
const expand = (padding: number): BoundsMm => ({ x: body.x - padding, y: body.y - padding, width: body.width + padding * 2, height: body.height + padding * 2 })
const gmEnvelope = (scene: SceneDocument) => {
  const projection = projectScene(scene, 'gm')
  return propPresentationEnvelope(projection, projection.props.find(prop => prop.id === 'private')!)
}

describe('prop contact envelopes and player masks', () => {
  it.each(['ground', 'object', 'canopy'] as const)('accepts a body-covering mask for shadowless %s symbols and images with environment contacts enabled', renderLayer => {
    for (const image of [false, true]) {
      const scene = fixture(renderLayer, image), before = canonicalJson(scene), checked = validateSceneDocument(scene)
      expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.errors)).toBe(true)
      const envelope = gmEnvelope(scene)
      expect(envelope.contact).toBe('none'); expect(envelope.boundsMm).toEqual(body)
      expect(projectScene(scene, 'player').props).toEqual([])
      expect(canonicalJson(scene)).toBe(before)
    }
  })

  it('still rejects a mask that leaves even one millimetre of the shadowless image uncovered', () => {
    const scene = fixture('object', true)
    setMask(scene, { ...body, x: body.x + 1, width: body.width - 1 })
    expect(() => projectScene(scene, 'player')).toThrow(/固定遮罩/)
  })

  it.each(['object', 'canopy'] as const)('requires the actual alpha-contact blur for %s props even without a theme shadow', renderLayer => {
    const scene = fixture(renderLayer, true)
    scene.props.private.shadowClass = 'furniture'
    const envelope = gmEnvelope(scene)
    expect(envelope.contact).toBe('source-alpha'); expect(envelope.boundsMm).toEqual(expand(200))
    expect(() => projectScene(scene, 'player')).toThrow(/固定遮罩/)
    setMask(scene, expand(200)); expect(projectScene(scene, 'player').props).toEqual([])
    visualBase(scene)!.environment.contactShadowOpacity = 0
    setMask(scene, body); expect(projectScene(scene, 'player').props).toEqual([])
  })

  it('retains explicit cast-shadow bounds when the class disables only the alpha contact', () => {
    const scene = fixture('object', true)
    scene.props.private.shadowOverride = { directionDeg: 35, offsetMm: 300, blurMm: 50, opacity: .4, color: '#18201D' }
    const envelope = gmEnvelope(scene)
    expect(envelope.contact).toBe('none'); expect(envelope.boundsMm).toEqual(expand(500))
    expect(() => projectScene(scene, 'player')).toThrow(/固定遮罩/)
    setMask(scene, expand(500)); expect(projectScene(scene, 'player').props).toEqual([])
    scene.props.private.shadowOverride.opacity = 0
    setMask(scene, body); expect(projectScene(scene, 'player').props).toEqual([])
  })
})
