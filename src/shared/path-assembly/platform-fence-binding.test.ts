import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { applyCompositionCommands, applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent, resolveAppearance } from '../appearance/graph.js'
import { propPaintPolygon } from '../appearance/presentation.js'
import { applyCommands, type SceneCommand } from '../commands/commands.js'
import { polygonsOverlap, propFootprint, supportedPolygon } from '../geometry/geometry.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { projectScene } from '../projection/projection.js'
import { validateCompositionContent } from '../validation/content.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { prepareBridgeDrag } from './bridge-links.js'
import { DEFAULT_BRIDGE_STRUCTURE, type FenceAssemblyCommand } from './contracts.js'
import { fenceRoutePoints } from './fitted-layout.js'
import { planBoundPlatformFence } from './platform-fence-binding.js'

const floorId = 'blank-floor', layerId = 'layer-default-0', railLayer = 'rail-layer'
const p = (x: number, y: number): PointMm => ({ x, y })
const rect = (x: number, y: number, right: number, bottom: number) => [p(x, y), p(right, y), p(right, bottom), p(x, bottom)]
const support = (id: string) => ({ kind: 'terrainArea' as const, id })
const binding = { version: 1, platformId: 'west', selection: { kind: 'all' }, insetMm: 500, openingPolicy: 'structural' } as const
const fence: FenceAssemblyCommand = { type: 'setFenceAssembly', id: 'guard', floorId, layerId: railLayer, visibility: 'public', platformBinding: binding,
  recipe: { section: { kind: 'profile', profile: 'ironPickets', lengthMm: 2000 }, endClearanceMm: 0 } }
const stairs = (x = 6500): Extract<SceneCommand, { type: 'createTerrainConnection' }> => ({ type: 'createTerrainConnection', id: 'stairs', floorId, layerId,
  kind: 'stairs', from: { surfaceRef: support('west'), positionMm: p(x, 12500) }, to: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: p(x, 16500) }, widthMm: 1400 })
const bridge: Extract<SceneCommand, { type: 'setPathAssembly' }> = { type: 'setPathAssembly', id: 'crossing', floorId, layerId, widthMm: 1900, centerlineMm: [p(10800, 6400), p(12200, 6400)],
  bridge: { elevationMm: 1200, finish: 'steel', visibility: 'public' },
  recipe: { section: { kind: 'steel', lengthMm: 1800 }, sides: 'both', shoulderMm: 650, endClearanceMm: 150, fit: true, structure: DEFAULT_BRIDGE_STRUCTURE } }
const guard = (scene: SceneDocument) => scene.visual.base.base.boundaries.guard
const propsOf = (scene: SceneDocument) => Object.values(guard(scene).fence!.members).flatMap(member => member.state === 'placed' ? [scene.props[member.propId]] : [])
let serial = 0
const context = { ids: { nextId: () => `fence-test-${++serial}` }, clock: { now: () => '2026-11-22T00:00:00.000Z' } }
const edit = (scene: SceneDocument, ...commands: SceneCommand[]) => applyCommands(scene, commands, context)

function blank(widthMm = 20000, heightMm = 20000) {
  const scene = toCurrentSceneDocument({ ...cloneJson(layerSceneV3()), format: 'sceneweave-scene' })
  delete scene.props.item
  delete scene.entityLayers.item
  scene.floors[floorId].boundsMm = scene.exportBoundsMm = { x: 0, y: 0, width: widthMm, height: heightMm }
  return edit(scene, { type: 'createLayer', id: railLayer, name: '护栏', floorId })
}

function fixture() {
  return edit(blank(),
    { type: 'createTerrainArea', id: 'west', floorId, layerId, groundElevationMm: 1200, boundaryMm: rect(2000, 2000, 10000, 14000) },
    { type: 'createTerrainArea', id: 'east', floorId, layerId, groundElevationMm: 1200, boundaryMm: rect(13000, 2000, 19000, 14000) })
}

describe('persistent platform fences', () => {
  it('adopts a coordinate-free command, retains the stock route and survives a cold read', () => {
    const standalone: FenceAssemblyCommand = { type: 'setFenceAssembly', id: 'yard', floorId, layerId, centerlineMm: [p(3500, 6000), p(7500, 6000)],
      closed: false, visibility: 'public', recipe: { ...fence.recipe, gaps: [{ side: 'both', fromMm: 1500, toMm: 2500 }] } }
    const source = createCompositionContent(fixture(), context)
    const adopted = applyCompositionCommands(source, [standalone, fence], context)
    const opened = validateCompositionContent(JSON.parse(JSON.stringify(adopted)))
    const scene = opened.document
    expect(guard(scene).fence?.platformBinding).toEqual(binding)
    expect(fenceRoutePoints(guard(scene))).toEqual(rect(2500, 2500, 9500, 13500))
    expect(propsOf(scene).length).toBeGreaterThan(4)
    expect(propsOf(scene).every(prop => prop.supportRef.id === 'west' && supportedPolygon(scene, propFootprint(prop), support('west'), floorId))).toBe(true)
    expect(scene.visual.base.base.boundaries.yard.fence?.platformBinding).toBeUndefined()
    expect(scene.visual.base.base.boundaries.yard.fence?.recipe.gaps).toEqual(standalone.recipe.gaps)
    expect(() => edit(fixture(), { ...fence, platformBinding: { ...binding, insetMm: 0 } })).toThrow(/承托/)
  })

  it('keeps the section identity, moved member and deleted slot during ordinary outline edits', () => {
    const scene = edit(fixture(), fence)
    const [first, deleted] = Object.entries(guard(scene).fence!.members)
    if (first[1].state !== 'placed' || deleted[1].state !== 'placed') throw new Error('构件夹具失败')
    const moved = p(4200, 7200), before = edit(scene, { type: 'updateProp', id: first[1].propId, changes: { positionMm: moved } }, { type: 'deleteProp', id: deleted[1].propId })
    const pointId = before.terrainAreas.west.boundaryMm[1].id
    const after = edit(before, { type: 'moveTerrainPoint', areaId: 'west', pointId, positionMm: p(10400, 2000) })
    expect(fenceRoutePoints(guard(after))[1]).not.toEqual(fenceRoutePoints(guard(before))[1])
    expect(guard(after).fence!.recipe.section).toEqual(fence.recipe.section)
    expect(guard(after).fence!.members[deleted[0]]).toEqual({ state: 'removed' })
    expect(after.props[first[1].propId].positionMm).toEqual(moved)
    expect(guard(after).segments.map(row => row.id)).toEqual(guard(before).segments.map(row => row.id))
  })

  it('keeps a deleted repeat on its directed terrain edge after the ring start moves', () => {
    const scene = edit(fixture(), fence)
    const old = guard(scene), removed = old.fence!.members['right:0:0:section:body']
    if (removed.state !== 'placed') throw new Error('构件夹具失败')
    const before = edit(scene, { type: 'deleteProp', id: removed.propId })
    const ring = before.terrainAreas.west.boundaryMm
    const after = edit(before, { type: 'updateTerrainArea', id: 'west', changes: { boundaryMm: [...ring.slice(1), ring[0]] } })
    expect(guard(after).segments.map(row => row.id)).toEqual([...old.segments.slice(1), old.segments[0]].map(row => row.id))
    expect(guard(after).fence!.members['right:3:0:section:body']).toEqual({ state: 'removed' })
    expect(after.props[removed.propId]).toBeUndefined()
  })

  it.each(['explicit', 'default'])('cuts real bridge and stair arrivals with the %s opening policy', policy => {
    const { openingPolicy: _openingPolicy, ...defaultBinding } = binding
    const scene = edit(fixture(), { ...fence, platformBinding: policy === 'explicit' ? binding : defaultBinding }, bridge, stairs())
    const gaps = guard(scene).fence!.recipe.gaps!
    expect(gaps).toHaveLength(2)
    expect(gaps[0].fromMm).toBeLessThan(10900)
    expect(gaps[0].toMm).toBeGreaterThan(10900)
    expect(gaps[1].fromMm).toBeLessThan(21000)
    expect(gaps[1].toMm).toBeGreaterThan(21000)
    const after = edit(scene, { type: 'removeTerrainConnection', id: 'stairs' })
    expect(guard(after).fence!.recipe.gaps).toEqual([gaps[0]])
    expect(validateSceneDocument(after).ok).toBe(true)
    const stale = cloneJson(after)
    guard(stale).fence!.recipe.gaps = gaps
    expect(validateSceneDocument(stale).ok).toBe(false)
  })

  it('sweeps the painted width and physical footprint at an oblique bridge landing', () => {
    const bridgePlan = { ...bridge, centerlineMm: [p(15500, 9000), p(15500, 31900)], widthMm: 3600,
      recipe: { ...bridge.recipe, shoulderMm: 1500, endClearanceMm: 340 } }
    const rim = { ...fence, recipe: { ...fence.recipe, fit: true as const, dimensions: { visualWidthMm: 880, footprintWidthMm: 235 } },
      platformBinding: { ...binding, insetMm: 700 } }
    const scene = edit(blank(46000, 42000),
      { type: 'createTerrainArea', id: 'west', floorId, layerId, groundElevationMm: 1200,
        boundaryMm: [p(10700, 31800), p(12400, 29000), p(22900, 29000), p(25700, 31700), p(25700, 37300), p(10700, 37300)] },
      bridgePlan, rim)

    const planned = planBoundPlatformFence(scene, rim, rim.platformBinding)
    const narrow = planBoundPlatformFence(scene, { ...rim, recipe: { ...rim.recipe, dimensions: { visualWidthMm: 235, footprintWidthMm: 235 } } }, rim.platformBinding)
    expect(planned.sideReachMm).toBe(440)
    expect(planned.route.gaps[0].fromMm).toBeLessThan(narrow.route.gaps[0].fromMm)
    expect(guard(scene).fence!.recipe.gaps).toEqual(planned.route.gaps)
    for (const prop of propsOf(scene)) {
      expect(prop.visualBoundsMm.height).toBe(880)
      expect(prop.footprintMm.height).toBe(235)
      expect(planned.bands.some(band => polygonsOverlap(propFootprint(prop), band))).toBe(false)
      expect(planned.bands.some(band => polygonsOverlap(propPaintPolygon(prop), band))).toBe(false)
    }
  })

  it('moves a bridge and re-seats only its affected managed guardrails in the same transaction', () => {
    const scene = edit(fixture(), bridge, fence)
    const offsetMm = p(0, 1600)
    const previous = guard(scene).fence!.recipe.gaps!
    const moved = edit(scene, { type: 'moveBridge', id: 'crossing', offsetMm })
    expect(guard(moved).fence!.recipe.gaps).toEqual(previous.map(gap => ({ ...gap, fromMm: gap.fromMm + offsetMm.y, toMm: gap.toMm + offsetMm.y })))
    const from = p(9500, 9500), heldId = propsOf(scene).find(prop => prop.positionMm.x === 9500 && prop.positionMm.y > 8500)!.id
    const manual = edit(scene, { type: 'updateProp', id: heldId, changes: { positionMm: from } })
    expect(() => edit(manual, { type: 'moveBridge', id: 'crossing', offsetMm })).toThrow(new RegExp(heldId))
    expect(manual.props[heldId].positionMm).toEqual(from)
  })

  it('keeps layer-adjusted guardrails managed during bridge drag and adoption', () => {
    const source = createCompositionContent(fixture(), context)
    const saved = applyCompositionCommands(source, [bridge, fence], context)
    const painted = resolveAppearance(applyCompositionCommands(saved, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId: railLayer },
      adjustment: { id: 'rail-opacity', kind: 'opacity', value: .7, enabled: true } }], context))
    const offset = p(0, 1600)
    const preview = prepareBridgeDrag(painted.document, bridge.id, new Set(), painted.appearance)(offset, 0)
    expect(preview.path.centerlineMm[0].y).toBe(bridge.centerlineMm[0].y + offset.y)
    const adopted = resolveAppearance(applyCompositionCommands(painted, [preview.command], context))
    expect(propsOf(adopted.document).every(row => row.appearance.opacity === .7)).toBe(true)
    expect(guard(adopted.document).fence!.recipe.gaps).not.toEqual(guard(painted.document).fence!.recipe.gaps)
  })

  it('rejects moving a supported guardrail into the bridge approach, including on cold read', () => {
    const source = createCompositionContent(fixture(), context)
    const current = applyCompositionCommands(source, [bridge, fence], context), scene = current.document
    const prop = propsOf(scene).find(row => row.positionMm.x === 9500 && row.positionMm.y > 8500)!
    const positionMm = p(9200, 6400)
    expect(supportedPolygon(scene, propFootprint({ ...prop, positionMm }), support('west'), floorId)).toBe(true)
    const command: SceneCommand = { type: 'updateProp', id: prop.id, changes: { positionMm } }
    expect(() => edit(scene, command)).toThrow(new RegExp(prop.id))
    expect(() => applyCompositionDraftCommands(current, [command], context)).toThrow(new RegExp(prop.id))
    expect(scene.props[prop.id].positionMm).not.toEqual(positionMm)
    const altered = cloneJson(current)
    altered.document.props[prop.id].positionMm = positionMm
    expect(validateSceneDocument(altered.document)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: 'PLATFORM_FENCE_OPENING', entityId: prop.id })]),
    })
    expect(() => validateCompositionContent(JSON.parse(JSON.stringify(altered)))).toThrow(new RegExp(prop.id))
  })

  it('updates fitted appearance dimensions through the complete project command path', () => {
    const source = createCompositionContent(fixture(), context)
    const first = applyCompositionCommands(source, [fence], context)
    const resized = first.document.terrainAreas.west.boundaryMm.map(row => ({ ...row, positionMm: p(row.positionMm.x === 10000 ? 11000 : row.positionMm.x, row.positionMm.y) }))
    const updated = applyCompositionCommands(first, [{ type: 'updateTerrainArea', id: 'west', changes: { boundaryMm: resized } }], context)
    const direct = edit(first.document, { type: 'updateTerrainArea', id: 'west', changes: { boundaryMm: resized } })
    expect(propsOf(updated.document).map(row => row.visualBoundsMm)).toEqual(propsOf(direct).map(row => row.visualBoundsMm))
    expect(validateCompositionContent(JSON.parse(JSON.stringify(updated))).document).toEqual(updated.document)
    const reopened = applyCompositionCommands(updated, [stairs()], context)
    expect(guard(reopened.document).fence!.routeFingerprint).toBe(guard(updated.document).fence!.routeFingerprint)
    expect(guard(reopened.document).fence!.recipe.gaps).toHaveLength(1)
    expect(validateCompositionContent(JSON.parse(JSON.stringify(reopened))).document).toEqual(reopened.document)
  })

  it('filters private structure and masked contacts before planning public cutouts', () => {
    const scene = edit(fixture(), bridge, stairs())
    const target = { floorId, visibility: 'public' as const, recipe: fence.recipe }
    const mask: SceneCommand = { type: 'upsertManualMask', id: 'screen', floorId, layerId,
      boundsMm: { x: 5800, y: 14100, width: 1400, height: 2300 } }
    const masked = edit(scene, mask)
    expect(planBoundPlatformFence(masked, target, binding).route.gaps).toHaveLength(1)
    expect(planBoundPlatformFence(masked, { ...target, visibility: 'gm' }, binding).route.gaps).toHaveLength(2)
    const deckId = scene.paths.crossing.assembly!.bridge!.deckId
    const privateScene = edit(scene, { ...bridge, bridge: { ...bridge.bridge!, visibility: 'gm' } },
      { type: 'updateTerrainConnection', id: 'stairs', changes: { visibility: 'gm' } })
    expect(privateScene.terrainAreas[deckId].visibility).toBe('gm')
    expect(planBoundPlatformFence(privateScene, target, binding).route.gaps).toEqual([])
  })

  it('closes a public cutout when a new player mask covers only the outside landing', () => {
    const source = fixture()
    const definition = Object.values(source.propDefinitions)[0]
    source.propDefinitions.trim = { ...definition, id: 'trim', catalogId: 'test.trim', defaultBlocksMovement: false,
      defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 },
      defaultFootprintMm: { width: 900, height: 220 }, defaultFootprintOffsetMm: p(0, 0),
      defaultVisualBoundsMm: { x: -450, y: -150, width: 900, height: 300 } }
    const trim: FenceAssemblyCommand = { ...fence, recipe: { section: { kind: 'prop', ref: { id: 'trim', version: definition.version }, lengthMm: 1800 }, fit: true, endClearanceMm: 0 } }
    const plain = edit(source, trim)
    const open = edit(plain, stairs())
    expect(guard(open).fence?.recipe.gaps).toHaveLength(1)
    const masked = edit(open, { type: 'upsertManualMask', id: 'mask', floorId, layerId, boundsMm: { x: 5800, y: 14500, width: 1400, height: 1600 } })
    expect(guard(masked).fence?.recipe.gaps).toBeUndefined()
    const trimPositions = (scene: SceneDocument) => projectScene(scene, 'player').props.filter(row => row.definitionRef?.id === 'trim').map(row => row.positionMm)
      .sort((a, b) => a.x - b.x || a.y - b.y)
    expect(trimPositions(masked)).toEqual(trimPositions(plain))
  })

  it('rejects a locked fence or a retained blocking member in a new entrance atomically', () => {
    const scene = edit(fixture(), fence)
    const locked = edit(scene, { type: 'setLayerLock', id: railLayer, locked: true })
    expect(() => edit(locked, stairs())).toThrow(/锁定/)
    expect(locked.terrainConnections).toEqual({})
    const first = propsOf(scene)[0]
    const held = edit(scene, { type: 'updateProp', id: first.id, changes: { positionMm: p(6500, 13400) } })
    expect(() => edit(held, stairs())).toThrow(new RegExp(first.id))
    expect(held.terrainConnections).toEqual({})
    expect(held.props[first.id].positionMm).toEqual(p(6500, 13400))
  })
})
