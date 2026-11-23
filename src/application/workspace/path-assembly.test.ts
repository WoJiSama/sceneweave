import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent, resolveAppearance } from '../../shared/appearance/graph.js'
import { propFootprint, terrainPoints } from '../../shared/geometry/geometry.js'
import { checkTerrainRoute } from '../../shared/geometry/terrain-travel.js'
import type { SceneDocument, TerrainArea } from '../../shared/model/scene.js'
import { WATER_PRESETS } from '../../shared/ocean/contracts.js'
import { DEFAULT_BRIDGE_RELIEF, DEFAULT_BRIDGE_STRUCTURE, DEFAULT_FIXTURE_GLOW, isPathLampMember, type FenceAssemblyCommand, type PathAssemblyCommand, type PublishPathStyleCommand } from '../../shared/path-assembly/contracts.js'
import { prepareBridgeDrag } from '../../shared/path-assembly/bridge-links.js'
import { projectEditorScene, projectScene } from '../../shared/projection/projection.js'
import { adoptLibraryEntries, prepareLibraryEntry } from '../../shared/library/content.js'
import { exportLibraryBackup, importLibraryBackup } from '../../shared/library/backup.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { LINE_PROFILE_IDS, LINE_PROFILES } from '../../shared/path-assembly/profiles.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { cloneJson } from '../../shared/validation/json.js'
import { validateAppearanceGraph } from '../../shared/validation/content.js'
import { fromBundle, toBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { Workspace } from './workspace.js'

const floorId = 'blank-floor'
const sessions: { workspace: Workspace; repo: ProjectRepository }[] = []
afterEach(async () => {
  for (const { workspace, repo } of sessions.splice(0)) {
    await workspace.close().catch(() => {})
    const name = repo.database.name
    repo.close()
    await Dexie.delete(name)
  }
})

async function setup(image = true) {
  const bundle = fixture({ image }), scene = cloneJson(bundle.project.document)
  const layerId = scene.entityLayers.item
  scene.exportBoundsMm = { x: 0, y: 0, width: 50000, height: 30000 }
  scene.floors[floorId].boundsMm = { ...scene.exportBoundsMm }
  scene.props.item.visualBoundsMm = { x: -180, y: -60, width: 380, height: 160 }
  scene.props.item.footprintOffsetMm = { x: 20, y: 50 }
  const water: TerrainArea = {
    id: 'river', floorId, editLocked: false, visibility: 'public', coveragePriority: 1,
    groundElevationMm: -350, surfaceStyle: null, blocksMovement: true, blocksSight: false, movementCostMultiplier: 1,
    boundaryMm: [{ x: 16000, y: 1000 }, { x: 32000, y: 1000 }, { x: 32000, y: 29000 }, { x: 16000, y: 29000 }]
      .map((positionMm, i) => ({ id: 'water-p' + i, segmentId: 'water-s' + i, positionMm })),
    waterSurface: { ...WATER_PRESETS.calm },
  }
  scene.terrainAreas[water.id] = water
  scene.entityLayers[water.id] = layerId
  scene.terrainEdges.west = { id: 'west', floorId, editLocked: false, visibility: 'public', source: { areaId: water.id, segmentId: 'water-s3' },
    neighborAreaId: null, kind: 'cliff', shoreline: false, blocksMovement: true, blocksSight: false, surfaceStyle: null, styleOverride: null }
  scene.entityLayers.west = layerId
  const content = createCompositionContent(scene, runtime)
  const project = await fromBundle({ ...bundle, project: { ...bundle.project, ...content } }, validation)
  const repo = new ProjectRepository({ name: 'bridge-' + crypto.randomUUID(), runtime, validation })
  const workspace = new Workspace(repo, { runtime, validation })
  sessions.push({ workspace, repo })
  await workspace.adoptNew(project)
  return { workspace, repo, layerId }
}

const drawBridge = (layerId: string): PathAssemblyCommand => ({
  type: 'setPathAssembly', id: 'bridge', floorId, layerId,
  centerlineMm: [{ x: 10000, y: 7000 }, { x: 39000, y: 7000 }], widthMm: 2400,
  recipe: { section: { kind: 'steel', lengthMm: 2000 }, sides: 'both', shoulderMm: 460, endClearanceMm: 200, lamps: { every: 3 } },
  bridge: { finish: 'steel', elevationMm: 0, visibility: 'public' },
})

function memberId(workspace: Workspace, slot: string): string {
  const member = workspace.getDocument()!.paths.bridge.assembly?.members[slot]
  if (member?.state !== 'placed') throw new Error('Missing placed slot: ' + slot)
  return member.propId
}

const p = (x: number, y: number) => ({ x, y })
const rect = (x: number, y: number, right: number, bottom: number) => [p(x, y), p(right, y), p(right, bottom), p(x, bottom)]
const structuralBridge = (layerId: string): PathAssemblyCommand => ({ ...drawBridge(layerId), centerlineMm: [p(11000, 7000), p(39000, 7000)],
  recipe: { section: { kind: 'profile', profile: 'boxGirder', lengthMm: 2450 }, sides: 'both', shoulderMm: 720,
    endClearanceMm: 200, lamps: { every: 2, glow: DEFAULT_FIXTURE_GLOW }, structure: { ...DEFAULT_BRIDGE_STRUCTURE, relief: DEFAULT_BRIDGE_RELIEF } },
})

function bridgeProps(scene: SceneDocument, id: string, role: string) {
  return Object.entries(scene.paths[id].assembly!.members).flatMap(([key, member]) => key.endsWith(`:${role}`) && member.state === 'placed'
    ? [{ key, prop: scene.props[member.propId] }] : [])
}

describe('fitted industrial bridge structures', () => {
  it('uses one style for straight and bent spans with full-width approaches, hardware and side openings', async () => {
    const { workspace, repo, layerId } = await setup(false), style = structuralBridge(layerId).recipe
    const { section, structure } = style
    if (section.kind === 'none') throw new Error('Missing bridge source')
    const original: PublishPathStyleCommand = { type: 'publishPathStyle', id: 'industrial-bridge-v1', name: '工业跨线', source: section,
      defaults: { lengthMm: section.lengthMm, fit: true, structure: structure!, lamps: style.lamps! } }
    const newer: PublishPathStyleCommand = { ...original, id: 'industrial-bridge-v2', previousRef: { id: original.id, version: 1 },
      defaults: { ...original.defaults, structure: { ...structure!, palette: 'alloy' } } }
    await workspace.execute([original, newer])
    const blueprint = toBundle(workspace.getState().project!)
    const entry = await prepareLibraryEntry(blueprint, { kind: 'prefab', definitionId: newer.id }, validation)
    const library = await importLibraryBackup(await exportLibraryBackup({ entries: [entry], organizations: {} }, validation), validation)
    const adopted = await adoptLibraryEntries(fixture(), library.entries, validation)
    expect(adopted.bundle.project.document.prefabDefinitions[newer.id].pathStyle).toEqual(newer.defaults)
    expect(workspace.getDocument()!.prefabDefinitions[original.id].pathStyle).toEqual(original.defaults)

    const recipe = { ...style, structure: newer.defaults.structure!, section: { kind: 'prefab' as const, ref: { id: newer.id, version: 2 }, lengthMm: section.lengthMm } }
    const straight: PathAssemblyCommand = { ...structuralBridge(layerId), centerlineMm: [p(16500, 7000), p(31500, 7000)], recipe }
    const bend: PathAssemblyCommand = { ...straight, id: 'bent-bridge', widthMm: 3400, centerlineMm: [p(14000, 15000), p(24000, 15000), p(24000, 23000), p(31500, 23000)],
      recipe: { ...recipe, gaps: [{ side: 'left', fromMm: 500, toMm: 2000 }] } }
    const straightRoute = { floorId, pointsMm: [p(14000, 7000), p(34800, 7000)], widthMm: straight.widthMm }
    await workspace.execute([
      { type: 'createTerrainArea', id: 'west-platform', floorId, layerId, boundaryMm: rect(11000, 3500, 15900, 27000), groundElevationMm: 0, coveragePriority: 2 },
      { type: 'createTerrainArea', id: 'east-platform', floorId, layerId, boundaryMm: rect(32100, 3500, 44700, 27000), groundElevationMm: 0, coveragePriority: 2 },
    ])
    expect(checkTerrainRoute(workspace.getDocument()!, straightRoute).ok).toBe(false)
    const startOnly = await workspace.preview([{ ...straight, recipe: { ...recipe, structure: { ...recipe.structure,
      bridgehead: { ...DEFAULT_BRIDGE_STRUCTURE.bridgehead, ends: 'start' } } } }])
    expect(projectScene(startOnly.document, 'gm').paths[0].bridge?.structure?.landings).toHaveLength(1)
    expect(bridgeProps(startOnly.document, straight.id, 'landingLamp')).toHaveLength(2)
    expect(checkTerrainRoute(startOnly.document, straightRoute).ok).toBe(false)
    workspace.cancelPreview(startOnly)
    await workspace.execute([straight, bend])
    const first = workspace.getDocument()!, straightDeckId = first.paths.bridge.assembly!.bridge!.deckId
    expect(checkTerrainRoute(first, straightRoute)).toMatchObject({ ok: true, lengthMm: 20800 })
    expect(checkTerrainRoute(first, straightRoute).supportRefs.map(ref => ref.id).sort()).toEqual(['west-platform', straightDeckId, 'east-platform'].sort())
    expect(terrainPoints(first.terrainAreas[straightDeckId])).toEqual(expect.arrayContaining([p(15300, 4658), p(32700, 9342)]))
    expect(bridgeProps(first, straight.id, 'corner')).toHaveLength(0)
    const supports = bridgeProps(first, straight.id, 'support').filter(row => row.key.startsWith('left:'))
    expect(supports.map(({ prop }) => prop.positionMm.x)).toEqual([18350, 22050, 25750, 29450])
    expect(bridgeProps(first, straight.id, 'landingLamp')).toHaveLength(4)
    expect(bridgeProps(first, bend.id, 'corner')).toHaveLength(4)
    for (const { key, prop } of bridgeProps(first, bend.id, 'corner')) {
      expect(prop.appearance).toMatchObject({ bridgeArt: 'alloyCorner' })
      expect(bridgeProps(first, bend.id, 'cornerLamp').find(row => row.key === key + 'Lamp')?.prop.positionMm).toEqual(prop.positionMm)
    }
    for (const { key, prop } of bridgeProps(first, straight.id, 'supportLamp')) {
      expect(bridgeProps(first, straight.id, 'support').find(row => `${row.key}Lamp` === key)?.prop.positionMm).toEqual(prop.positionMm)
    }
    const crossSide = (x: number) => checkTerrainRoute(first, { floorId, widthMm: 300, pointsMm: [p(x, 11800), p(x, 16000)] })
    expect(crossSide(15300).ok).toBe(true)
    expect(crossSide(14400).issues.some(issue => issue.code === 'TERRAIN_TRAVEL_OBSTACLE')).toBe(true)
    expect(bridgeProps(first, bend.id, 'support').map(row => row.key)).not.toContain('left:0:0:support')

    const revised: PathAssemblyCommand = { ...bend, widthMm: 3900, centerlineMm: [p(14000, 15000), p(24000, 16200), p(24000, 23000), p(31300, 23000)] }
    await workspace.adoptPreview(await workspace.preview([revised]))
    await workspace.flush()
    const doc = workspace.getDocument()!, editedBend = doc.paths[bend.id]
    expect(editedBend.centerlineMm).toEqual(revised.centerlineMm)
    expect(editedBend.widthMm).toBe(3900)
    const firstCorner = bridgeProps(first, bend.id, 'corner').find(row => row.key === 'left:1:0:corner')!.prop
    const newCorner = doc.props[firstCorner.id]
    expect(newCorner.rotationDeg).not.toBe(firstCorner.rotationDeg)
    expect(newCorner.footprintMm).toEqual(firstCorner.footprintMm)
    const loaded = (await repo.load(doc.sceneId))!, cold = await importProject(await exportProject(loaded, validation), validation)
    expect(cold.project.document.paths).toEqual(doc.paths)
    expect(cold.project.document.props).toEqual(doc.props)
    const walk = checkTerrainRoute(cold.project.document, { floorId, widthMm: 3900, pointsMm: [p(12000, 14760), ...revised.centerlineMm, p(34000, 23000)] })
    expect(walk.issues).toEqual([])
    expect(walk.lengthMm).toBeCloseTo(Math.hypot(12000, 1440) + 6800 + 10000)
    for (const id of [straight.id, bend.id]) for (const { prop } of bridgeProps(cold.project.document, id, 'support')) {
      expect(prop.footprintMm).toEqual({ width: 680, height: 380 })
      expect(prop.visualBoundsMm).toMatchObject({ width: 680, height: 1080 })
    }
    expect(projectScene(cold.project.document, 'player').paths.find(row => row.id === bend.id)?.bridge?.structure?.landings).toHaveLength(2)
  })

  it('keeps manual node edits and physical footprints across palette changes and rejects oversized supports atomically', async () => {
    const { workspace, layerId } = await setup(false), command = structuralBridge(layerId)
    await workspace.execute([command])
    const start = workspace.getDocument()!, moved = memberId(workspace, 'left:0:0:support'), removed = memberId(workspace, 'right:0:2:supportLamp')
    const unchanged = memberId(workspace, 'right:0:3:support'), locked = memberId(workspace, 'right:0:1:support')
    const movedLamp = memberId(workspace, 'left:0:2:supportLamp')
    const positionMm = { ...start.props[moved].positionMm, x: start.props[moved].positionMm.x + 100 }
    const lampPosition = { ...start.props[movedLamp].positionMm, x: start.props[movedLamp].positionMm.x + 120 }
    await workspace.execute([{ type: 'updateProp', id: moved, changes: { positionMm } }, { type: 'deleteProp', id: removed },
      { type: 'updateProp', id: movedLamp, changes: { positionMm: lampPosition } }])
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: locked, locked: true }])
    const revised: PathAssemblyCommand = { ...command, centerlineMm: [command.centerlineMm[0], p(40600, 7000)],
      recipe: { ...command.recipe, structure: { ...command.recipe.structure!, palette: 'alloy' },
        lamps: { ...command.recipe.lamps!, glow: { ...DEFAULT_FIXTURE_GLOW, color: '#C3F6CB' } } } }
    await workspace.execute([revised])
    const changed = workspace.getDocument()!
    expect(changed.props[moved].positionMm).toEqual(positionMm)
    expect(changed.props[moved].appearance).toEqual(start.props[moved].appearance)
    expect(changed.props[locked]).toEqual({ ...start.props[locked], editLocked: true })
    expect(changed.props[removed]).toBeUndefined()
    expect(changed.paths.bridge.assembly!.members['right:0:2:supportLamp']).toEqual({ state: 'removed' })
    const glows = projectScene(changed, 'player').visual!.fixtureGlows!
    const lampCount = Object.entries(changed.paths.bridge.assembly!.members).filter(([key, row]) => isPathLampMember(key) && row.state === 'placed').length
    expect(glows).toHaveLength(lampCount)
    expect(glows.find(glow => glow.positionMm.x === lampPosition.x && glow.positionMm.y === lampPosition.y)?.color).toBe('#C3F6CB')
    expect(glows.some(glow => glow.positionMm.x === start.props[removed].positionMm.x && glow.positionMm.y === start.props[removed].positionMm.y)).toBe(false)
    const hidden = projectEditorScene(changed, { hiddenLayerIds: new Set([layerId]), floorId })
    expect(hidden.visual?.fixtureGlows).toBeUndefined()
    expect(changed.props[unchanged].appearance).toMatchObject({ bridgeArt: 'alloySupport' })
    expect(propFootprint(changed.props[unchanged])).toEqual(propFootprint(start.props[unchanged]))
    const invalid = { ...revised, recipe: { ...revised.recipe, structure: { ...revised.recipe.structure!,
      support: { ...DEFAULT_BRIDGE_STRUCTURE.support, footprintWidthMm: 980 } } } }
    await expect(workspace.preview([invalid])).rejects.toThrow(/通行净宽|桥面承托/)
    expect(workspace.getDocument()).toBe(changed)
    workspace.undo(); await workspace.flush()
    expect(workspace.getDocument()!.paths.bridge.centerlineMm).toEqual(command.centerlineMm)
    workspace.redo(); await workspace.flush()
    expect(workspace.getDocument()!.paths.bridge.assembly).toEqual(changed.paths.bridge.assembly)
  })

  it('keeps a private bridge and its shaped landings, members and light out of player output', async () => {
    const { workspace, layerId } = await setup(false), command = structuralBridge(layerId)
    await workspace.execute([{ type: 'upsertManualMask', id: 'cover-structure', floorId, layerId,
      boundsMm: { x: 8000, y: 3000, width: 34500, height: 8000 } }])
    const player = projectScene(workspace.getDocument()!, 'player')
    await workspace.execute([{ ...command, bridge: { ...command.bridge!, visibility: 'gm' } }])
    const scene = workspace.getDocument()!, visible = projectScene(scene, 'gm')
    expect(visible.paths[0].bridge?.structure?.landings).toHaveLength(2)
    expect(visible.paths[0].bridge?.relief).toMatchObject(DEFAULT_BRIDGE_RELIEF)
    expect(visible.visual?.fixtureGlows?.length).toBeGreaterThan(0)
    expect(visible.props.some(prop => prop.appearance.kind === 'symbol' && prop.appearance.bridgeArt === 'nodeLamp')).toBe(true)
    expect(projectScene(scene, 'player')).toEqual({ ...player, sourceRevision: scene.revision })
  })

  it('renders a single lamp override across a route update and cold reopen, then restores inheritance', async () => {
    const { workspace, layerId } = await setup(false), command = structuralBridge(layerId)
    await workspace.execute([command])
    const id = memberId(workspace, 'left:0:2:supportLamp'), otherId = memberId(workspace, 'right:0:2:supportLamp')
    const scope = { kind: 'targets' as const, ids: [id] }
    const glowAt = (scene: SceneDocument, targetId: string) => {
      const { x, y } = scene.props[targetId].positionMm
      return projectScene(scene, 'player').visual?.fixtureGlows?.find(glow => glow.positionMm.x === x && glow.positionMm.y === y)
    }
    const override = { color: '#F182B4', radiusMm: 2350, intensity: .9, anchor: { u: .5, v: .5 } }
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope,
      adjustment: { kind: 'propGlow', id: 'pink-lamp', value: override, enabled: true } }])
    const inherited = { color: '#A0EDD4', radiusMm: 1270, intensity: .54 }
    await workspace.execute([{ ...command, recipe: { ...command.recipe, lamps: { ...command.recipe.lamps!, glow: inherited } } }])
    const saved = workspace.getState().project!
    const cold = await importProject(await exportProject(toBundle(saved), validation), validation)
    expect(glowAt(cold.project.document, id)).toMatchObject({ color: override.color, radiusMm: override.radiusMm, intensity: override.intensity })
    expect(glowAt(cold.project.document, otherId)).toMatchObject(inherited)

    await workspace.execute([{ type: 'setAppearanceAdjustment', scope,
      adjustment: { kind: 'propGlow', id: 'lamp-off', value: null, enabled: true } }])
    expect(glowAt(workspace.getDocument()!, id)).toBeUndefined()
    await workspace.execute([{ type: 'removeAppearanceAdjustment', scope, adjustmentId: 'lamp-off' },
      { type: 'removeAppearanceAdjustment', scope, adjustmentId: 'pink-lamp' }])
    expect(glowAt(workspace.getDocument()!, id)).toMatchObject(inherited)
  })
})

describe('bridge and along-route assemblies', () => {
  it('rejects a snapped road across missing support and accepts the same road when the deck abuts its bank', async () => {
    const { workspace, layerId } = await setup(false), bridge = structuralBridge(layerId)
    await workspace.execute([
      { type: 'createTerrainArea', id: 'landing-bank', floorId, layerId,
        boundaryMm: rect(40201, 3500, 48000, 10800), groundElevationMm: 4000, coveragePriority: 2 },
      { ...bridge, bridge: { ...bridge.bridge!, elevationMm: 4000 } },
      { type: 'createPath', id: 'bank-road', floorId, layerId, widthMm: 2400, centerlineMm: [p(41401, 7000), p(46000, 7000)],
        supportRefs: [{ kind: 'terrainArea', id: 'landing-bank' }] },
    ])
    const start = workspace.getDocument()!
    const attach = { type: 'moveBridge', id: bridge.id, offsetMm: p(0, 0),
      attach: { bridgeEnd: 'end', pathId: 'bank-road', end: 'start' } } as const
    await expect(workspace.preview([attach])).rejects.toThrow(/连续的同高承托/)
    expect(workspace.getDocument()).toBe(start)
    await workspace.execute(start.terrainAreas['landing-bank'].boundaryMm.filter(row => row.positionMm.x === 40201).map(row => ({
      type: 'moveTerrainPoint', areaId: 'landing-bank', pointId: row.id, positionMm: p(40200, row.positionMm.y),
    })))
    await workspace.adoptPreview(await workspace.preview([attach]))
    const connected = workspace.getDocument()!
    expect(connected.paths[bridge.id].assembly!.bridge!.roadLinks?.end).toMatchObject({ pathId: 'bank-road', end: 'start' })
    const openingGap = connected.terrainAreas['landing-bank'].boundaryMm.filter(row => row.positionMm.x === 40200).map(row => ({
      type: 'moveTerrainPoint' as const, areaId: 'landing-bank', pointId: row.id, positionMm: p(40201, row.positionMm.y),
    }))
    await expect(workspace.preview(openingGap)).rejects.toThrow(/调整支撑面或解除桥路链接/)
    expect(workspace.getDocument()).toBe(connected)
    await workspace.adoptPreview(await workspace.preview([{ type: 'detachBridgeRoad', id: bridge.id, end: 'end' }, ...openingGap]))
    expect(workspace.getDocument()!.paths[bridge.id].assembly!.bridge!.roadLinks).toBeUndefined()
  })

  it('adopts only a snapped bridge end and preserves the approach tail during follow, break, restore and cold import', async () => {
    const { workspace, layerId } = await setup()
    await workspace.execute([drawBridge(layerId)])
    const roads = { west: [p(3800, 7000), p(6800, 7000), p(9197, 7000)], east: [p(39803, 7600), p(46900, 7600)] }
    for (const [id, centerlineMm] of Object.entries(roads)) await workspace.execute([{ type: 'createPath', id: `${id}-road`, floorId, layerId,
      centerlineMm, widthMm: 1600, supportRefs: [{ kind: 'floor', id: floorId }] }])
    const first = workspace.getDocument()!, initialBridge = first.paths.bridge
    expect(initialBridge.assembly!.bridge!.roadLinks).toBeUndefined()
    const previewSnap = prepareBridgeDrag(first, 'bridge')({ x: 200, y: 0 }, 350)
    expect(previewSnap.command.attach).toEqual({ bridgeEnd: 'start', pathId: 'west-road', end: 'end' })
    expect(workspace.getDocument()).toBe(first)
    await workspace.execute([previewSnap.command])
    const linked = workspace.getDocument()!, link = { pathId: 'west-road', end: 'end', restMm: p(9197, 7000) }
    expect(linked.paths.bridge.assembly!.bridge!.roadLinks).toEqual({ start: link })
    expect(linked.paths['west-road'].centerlineMm).toEqual([p(3800, 7000), p(6800, 7000), p(8397, 7000), p(9197, 7000)])
    expect(linked.paths['east-road'].centerlineMm).toEqual(roads.east)
    const member = memberId(workspace, 'left:0:0:section:body')
    const deckId = initialBridge.assembly!.bridge!.deckId

    const following = prepareBridgeDrag(linked, 'bridge')({ x: 0, y: 650 }, 0)
    expect(following.feedback.map(link => link.state)).toEqual(['follow'])
    expect(following.feedback[0].path!.centerlineMm).toEqual([p(3800, 7000), p(6800, 7000), p(8397, 7650), p(9197, 7650)])
    const candidate = await workspace.preview([following.command])
    expect(candidate.document.paths['west-road']).toEqual(following.feedback[0].path)
    expect(candidate.document.paths['east-road']).toEqual(linked.paths['east-road'])
    expect(candidate.document.props[member].positionMm).toEqual(p(linked.props[member].positionMm.x, linked.props[member].positionMm.y + 650))
    expect(candidate.document.terrainAreas[deckId].boundaryMm.map(row => row.id)).toEqual(linked.terrainAreas[deckId].boundaryMm.map(row => row.id))
    workspace.cancelPreview(candidate)
    expect(workspace.getDocument()).toBe(linked)
    await workspace.execute([following.command])
    const moved = workspace.getDocument()!
    const far = prepareBridgeDrag(moved, 'bridge')({ x: 0, y: 4000 }, 0)
    expect(far.feedback.map(link => link.state)).toEqual(['break'])
    await workspace.execute([far.command])
    expect(workspace.getDocument()!.paths.bridge.assembly!.bridge!.roadLinks).toBeUndefined()
    expect(workspace.getDocument()!.paths['west-road']).toEqual(moved.paths['west-road'])
    await workspace.undo()
    expect(workspace.getDocument()!.paths).toEqual(moved.paths)
    const locked = { type: 'setEditLock', kind: 'path', id: 'west-road', locked: true } as const
    await workspace.execute([locked])
    const protectedScene = workspace.getDocument()!
    const attempting = prepareBridgeDrag(protectedScene, 'bridge')({ x: 0, y: 200 }, 0)
    expect(attempting.feedback.map(link => link.state)).toEqual(['break'])
    await workspace.execute([attempting.command])
    expect(workspace.getDocument()!.paths['west-road']).toEqual(protectedScene.paths['west-road'])
    await workspace.undo()
    const saved = workspace.getState().project!
    const cold = await importProject(await exportProject(toBundle(saved), validation), validation)
    expect(cold.project.document.paths).toEqual(saved.document.paths)
    await workspace.execute([{ ...locked, locked: false }])
    await workspace.execute([{ type: 'deleteOutdoorEntity', id: 'west-road', kind: 'path' }])
    expect(workspace.getDocument()!.paths.bridge.assembly!.bridge!.roadLinks).toBeUndefined()
  })

  it('adopts a traversable solid steel deck, preserves manual edits and persists the entire assembly', async () => {
    const { workspace, repo, layerId } = await setup(), command = drawBridge(layerId)
    const route = { floorId, widthMm: command.widthMm, pointsMm: [{ x: 9000, y: 7000 }, { x: 41000, y: 7000 }] }
    expect(checkTerrainRoute(workspace.getDocument()!, route).ok).toBe(false)
    const preview = await workspace.preview([command])
    expect(workspace.getDocument()!.paths.bridge).toBeUndefined()
    await workspace.adoptPreview(preview)
    const created = workspace.getDocument()!, bridge = created.paths.bridge.assembly!
    expect(created.terrainEdges.west.source).toEqual({ areaId: 'river', segmentId: 'water-s3' })
    expect(Object.keys(bridge.members)).toHaveLength(38)
    const passage = checkTerrainRoute(created, route)
    expect(passage.issues).toEqual([])
    expect(passage.supportRefs).toContainEqual({ kind: 'terrainArea', id: bridge.bridge!.deckId })
    const moved = memberId(workspace, 'left:0:0:section:body'), locked = memberId(workspace, 'right:0:0:section:body')
    const removed = memberId(workspace, 'left:0:0:lamp'), ordinary = memberId(workspace, 'right:0:1:section:body')
    const positionMm = { ...created.props[moved].positionMm, x: created.props[moved].positionMm.x + 90 }
    await workspace.execute([ { type: 'updateProp', id: moved, changes: { positionMm } },
      { type: 'deleteProp', id: removed } ])
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: locked, locked: true }])
    const revised = { ...command, centerlineMm: [{ x: 10000, y: 7000 }, { x: 43000, y: 7000 }], recipe: { ...command.recipe, endClearanceMm: 400 } }
    await workspace.adoptPreview(await workspace.preview([revised]))
    await workspace.flush()
    const saved = workspace.getState().project!, doc = saved.document
    expect(doc.props[moved].positionMm).toEqual(positionMm)
    expect(doc.props[locked]).toEqual({ ...created.props[locked], editLocked: true })
    expect(doc.props[ordinary].positionMm.x).toBe(created.props[ordinary].positionMm.x + 200)
    expect(doc.props[removed]).toBeUndefined()
    expect(doc.paths.bridge.assembly!.members['left:0:0:lamp']).toEqual({ state: 'removed' })
    expect(doc.paths.bridge.assembly!.bridge!.deckId).toBe(bridge.bridge!.deckId)
    await expect(workspace.preview([{ ...revised, centerlineMm: [{ x: 14000, y: 7000 }, { x: 43000, y: 7000 }] }])).rejects.toThrow(/支撑面/)
    expect(workspace.getState().project).toBe(saved)
    expect(projectContentHash((await repo.load(doc.sceneId))!.project)).toBe(projectContentHash(toBundle(saved).project))
    workspace.undo()
    await workspace.flush()
    expect(workspace.getDocument()!.paths.bridge.centerlineMm).toEqual(command.centerlineMm)
    workspace.redo()
    await workspace.flush()
    expect(workspace.getDocument()!.paths.bridge.assembly).toEqual(doc.paths.bridge.assembly)
  })

  it('supports a one-sided bent timber bridge and skips whole sections at an opening', async () => {
    const { workspace, layerId } = await setup(), first = drawBridge(layerId)
    const command: PathAssemblyCommand = { ...first, centerlineMm: [{ x: 10000, y: 14000 }, { x: 24000, y: 14000 }, { x: 24000, y: 22000 }, { x: 40000, y: 22000 }],
      recipe: { ...first.recipe, section: { kind: 'timber', lengthMm: 1600 }, sides: 'left',
        gaps: [{ side: 'left', fromMm: 1800, toMm: 3400 }] }, bridge: { ...first.bridge!, finish: 'timber' } }
    delete command.recipe.lamps
    await workspace.execute([command])
    const doc = workspace.getDocument()!, members = doc.paths.bridge.assembly!.members
    expect(Object.keys(members).every(key => key.startsWith('left:'))).toBe(true)
    expect(members['left:0:1:section:body']).toBeUndefined()
    expect(members['left:0:2:section:body']).toBeDefined()
    expect(members['left:1:0:section:body']).toBeDefined()
    const pointsMm = [{ x: 9000, y: 14000 }, ...command.centerlineMm.slice(1, -1), { x: 41000, y: 22000 }]
    expect(checkTerrainRoute(doc, { floorId, pointsMm, widthMm: command.widthMm }).issues).toEqual([])
    expect(projectScene(doc, 'player').paths[0].bridge?.finish).toBe('timber')
  })

  it('repeats a saved asymmetric image section and keeps the authored adjustments and pixels', async () => {
    const { workspace, repo, layerId } = await setup(), base = drawBridge(layerId)
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'local-tone', kind: 'opacity', value: .65, enabled: true } }])
    await workspace.execute([{ type: 'createPrefab', id: 'source-group', definitionId: 'source-section', name: '向外挑出的灯架',
      anchorMm: { x: 3900, y: 3900 }, ids: ['item'] }])
    const command: PathAssemblyCommand = { ...base, recipe: { ...base.recipe, shoulderMm: 660,
      section: { kind: 'prefab', ref: { id: 'source-section', version: 1 }, lengthMm: 2400 } } }
    await workspace.execute([command])
    await workspace.flush()
    const stored = (await repo.load(workspace.getDocument()!.sceneId))!, { document, appearance } = resolveAppearance(stored.project)
    const slots = Object.keys(document.paths.bridge.assembly!.members)
    const left = document.props[memberId(workspace, slots.find(key => key.startsWith('left:0:0:section:'))!)]
    const right = document.props[memberId(workspace, slots.find(key => key.startsWith('right:0:0:section:'))!)]
    expect(left.positionMm.x).toBe(right.positionMm.x)
    expect(left.positionMm.y + right.positionMm.y).toBe(14000)
    expect(left.footprintOffsetMm.y).toBe(-right.footprintOffsetMm.y)
    expect(left.visualBoundsMm.y).toBe(-right.visualBoundsMm.y - right.visualBoundsMm.height)
    expect(left.appearance).toMatchObject({ kind: 'image', mirrorY: true, opacity: .65 })
    expect(right.appearance).toMatchObject({ kind: 'image', opacity: .65 })
    expect(projectScene(document, 'player', appearance).props).toContainEqual(left)
    const privateGraph = cloneJson(appearance)
    privateGraph.prefabAppearanceTemplates['source-section'].visibility = 'gm'
    expect(() => validateAppearanceGraph(privateGraph, document)).toThrow(/主持人专用组合/)
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: [left.id] },
      adjustment: { id: 'manual-opacity', kind: 'opacity', value: .4, enabled: true } }])
    await workspace.execute([{ ...command, recipe: { ...command.recipe, endClearanceMm: 500 } }])
    const revised = resolveAppearance(workspace.getState().project!)
    expect(revised.document.props[left.id].positionMm).toEqual(left.positionMm)
    expect(revised.document.props[left.id].appearance.opacity).toBe(.4)
    expect(revised.document.props[right.id].positionMm.x).toBe(right.positionMm.x + 300)
    expect(revised.document.props[right.id].appearance.opacity).toBe(.65)
    await workspace.execute([{ type: 'createLayer', id: 'bridge-layer', floorId, name: '仅桥梁路线' }])
    await workspace.execute([{ type: 'moveEntitiesToLayer', ids: ['bridge'], layerId: 'bridge-layer' }])
    const relayered = resolveAppearance(workspace.getState().project!)
    const hidden = projectEditorScene(relayered.document, { hiddenLayerIds: new Set(['bridge-layer']) }, relayered.appearance)
    expect(hidden.paths).toEqual([])
    expect(hidden.terrain.map(area => area.id)).toEqual(['river'])
    expect(hidden.props.map(prop => prop.id)).toEqual(['item', 'other'])
  })

  it('reuses edge placement on a road and rejects intrusive widths atomically', async () => {
    const { workspace, layerId } = await setup(), base = drawBridge(layerId)
    const centerlineMm = [{ x: 1500, y: 18000 }, { x: 14500, y: 18000 }]
    await workspace.execute([{ type: 'createPath', id: 'road', floorId, layerId, centerlineMm, widthMm: 1600,
      supportRefs: [{ kind: 'floor', id: floorId }] }])
    const command: PathAssemblyCommand = { type: 'setPathAssembly', id: 'road', floorId, layerId, centerlineMm, widthMm: 1600,
      recipe: { ...base.recipe, shoulderMm: 120 } }
    const original = workspace.getState().project!
    await expect(workspace.preview([command])).rejects.toThrow(/侵入设定的通行净宽/)
    expect(workspace.getState().project).toBe(original)
    await workspace.execute([{ ...command, recipe: { ...command.recipe, shoulderMm: 500 } }])
    const document = workspace.getDocument()!
    expect(document.paths.road.supportRefs).toEqual([{ kind: 'floor', id: floorId }])
    expect(document.paths.road.assembly?.bridge).toBeUndefined()
    expect(Object.keys(document.paths.road.assembly!.members).length).toBeGreaterThan(0)
    expect(document.terrainAreas).toEqual(original.document.terrainAreas)
  })

  it.each([false, true])('widens part of a road and follows its edges with the same rail members (fitted: %s)', async fit => {
    const { workspace, layerId } = await setup()
    const centerlineMm = [p(1800, 18000), p(14000, 18000)], widthMm = 1600
    await workspace.execute([{ type: 'createPath', id: 'road', floorId, layerId, centerlineMm, widthMm,
      supportRefs: [{ kind: 'floor', id: floorId }] }])
    const assembly: PathAssemblyCommand = { type: 'setPathAssembly', id: 'road', floorId, layerId, centerlineMm, widthMm,
      recipe: { section: { kind: 'timber', lengthMm: 1600 }, sides: 'left', shoulderMm: 950, endClearanceMm: 200,
        ...(fit ? { fit: true } : {}) } }
    await workspace.execute([assembly])
    const initial = workspace.getDocument()!, first = initial.paths.road.assembly!.members['left:0:1:section:body']
    if (first?.state !== 'placed') throw new Error('Missing rail to delete')
    await workspace.execute([{ type: 'deleteProp', id: first.propId }])
    const before = workspace.getDocument()!, rails = bridgeProps(before, 'road', 'section:body')
    const middle = rails.find(({ key }) => key === 'left:0:3:section:body')!.prop
    const start = rails[0].prop
    const widthSections = [{ startPpm: 250_000, endPpm: 750_000, widthMm: 2200 }]
    await expect(workspace.preview([{ type: 'updatePath', id: 'road', changes: { widthSections } }])).rejects.toThrow(/同步更新路线和构件/)
    const preview = await workspace.preview([{ ...assembly, widthSections }])
    expect(workspace.getDocument()).toBe(before)
    expect(preview.document.paths.road.widthSections).toEqual(widthSections)
    expect(preview.document.props[middle.id].positionMm).toEqual({ x: middle.positionMm.x, y: middle.positionMm.y - 300 })
    expect(preview.document.props[start.id]).toEqual(start)
    expect(preview.document.paths.road.assembly!.members['left:0:1:section:body'].state).toBe('removed')
    await workspace.adoptPreview(preview)
    await workspace.flush()
    const complete = workspace.getState().project!
    const exported = await exportProject(toBundle(complete), validation)
    const imported = await importProject(exported, validation)
    expect(imported.project.document.paths.road).toEqual(complete.document.paths.road)
    expect(imported.project.document.props[middle.id]).toEqual(complete.document.props[middle.id])
    await workspace.undo()
    expect(workspace.getDocument()!.paths.road).toEqual(before.paths.road)
    expect(workspace.getDocument()!.props[middle.id]).toEqual(middle)
  })

  it('filters a private bridge before deriving public surfaces, props or edges', async () => {
    const { workspace, layerId } = await setup(), base = drawBridge(layerId)
    await workspace.execute([{ type: 'upsertManualMask', id: 'cover-bridge', floorId, layerId,
      boundsMm: { x: 6500, y: 3000, width: 36500, height: 8000 } }])
    const before = projectScene(workspace.getDocument()!, 'player')
    await workspace.execute([{ ...base, bridge: { ...base.bridge!, visibility: 'gm' } }])
    const document = workspace.getDocument()!
    const gm = projectScene(document, 'gm'), player = projectScene(document, 'player')
    expect(gm.paths[0].id).toBe('bridge')
    expect(player.paths).toEqual(before.paths)
    expect(player.terrain).toEqual(before.terrain)
    expect(player.edges).toEqual(before.edges)
    expect(player.props).toEqual(before.props)
    expect(JSON.stringify(player)).not.toContain(document.paths.bridge.assembly!.bridge!.deckId)
  })
})



const drawFence = (layerId: string): FenceAssemblyCommand => ({
  type: 'setFenceAssembly', id: 'yard-fence', floorId, layerId, visibility: 'public', closed: true,
  centerlineMm: [{ x: 2000, y: 18000 }, { x: 11000, y: 18000 }, { x: 11000, y: 27000 }, { x: 2000, y: 27000 }],
  recipe: { section: { kind: 'profile', profile: 'ironPickets', lengthMm: 2100 }, endClearanceMm: 0,
    gaps: [{ side: 'both', fromMm: 2500, toMm: 4300 }] },
})

function fenceMembers(workspace: Workspace) {
  return workspace.getDocument()!.visual.base.base.boundaries['yard-fence'].fence!.members
}

const styleCommand = (id: string): PublishPathStyleCommand => ({ type: 'publishPathStyle', id, name: '发光桥栏',
  source: { kind: 'profile', profile: 'neonAlloy', lengthMm: 2200 }, defaults: { lengthMm: 2200, fit: true,
    dimensions: { visualWidthMm: 480, footprintWidthMm: 270, detailPercent: 135 } } })

describe('fixed along-route styles and standalone fences', () => {
  it('installs all native source profiles with independent visual and physical widths', async () => {
    const { workspace, layerId } = await setup()
    const bridge = drawBridge(layerId)
    const command: PathAssemblyCommand = { ...bridge, centerlineMm: [{ x: 9000, y: 14000 }, { x: 23000, y: 14000 },
      { x: 23000, y: 22000 }, { x: 41000, y: 22000 }], recipe: { sides: 'both', shoulderMm: 720, endClearanceMm: 200,
      section: { kind: 'profile', profile: 'neonAlloy', lengthMm: 2200 }, dimensions: { visualWidthMm: 580, footprintWidthMm: 380, detailPercent: 150 } } }
    await workspace.execute([command])
    const doc = workspace.getDocument()!, left = doc.props[memberId(workspace, 'left:0:0:section:body')], right = doc.props[memberId(workspace, 'right:0:0:section:body')]
    expect(left.appearance).toMatchObject({ bridgeArt: 'neonAlloy', detailPercent: 150, mirrorY: true })
    expect(right.appearance.mirrorY).toBeUndefined()
    expect(left.visualBoundsMm.height).toBe(580)
    expect(left.footprintMm.height).toBe(380)
    expect(checkTerrainRoute(doc, { floorId, widthMm: command.widthMm, pointsMm: command.centerlineMm }).ok).toBe(true)
    const baseline = workspace.getState().project
    await expect(workspace.preview([{ ...command, recipe: { ...command.recipe, dimensions: { footprintWidthMm: 840 } } }])).rejects.toThrow(/通行净宽|桥面承托/)
    expect(workspace.getState().project).toBe(baseline)
    for (const profile of LINE_PROFILE_IDS) {
      const candidate = await workspace.preview([{ ...command, recipe: { ...command.recipe,
        section: { kind: 'profile', profile, lengthMm: LINE_PROFILES[profile].pitchMm } } }])
      expect(Object.values(candidate.document.props).some(prop => prop.appearance.kind === 'symbol' && prop.appearance.bridgeArt === profile)).toBe(true)
      workspace.cancelPreview(candidate)
    }
  })

  it('closes a fence with a real opening and keeps it out of the road graph and public projection when private', async () => {
    const { workspace, layerId } = await setup(), baseFence = drawFence(layerId)
    const fence = { ...baseFence, recipe: { ...baseFence.recipe, lamps: { every: 3, glow: DEFAULT_FIXTURE_GLOW } } }
    await workspace.execute([fence])
    const doc = workspace.getDocument()!, members = fenceMembers(workspace)
    expect(doc.paths).toEqual({})
    expect(projectScene(doc, 'player').visual?.fixtureGlows?.length).toBeGreaterThan(0)
    expect(doc.visual.base.base.boundaries[fence.id].closed).toBe(true)
    expect(Object.keys(members).some(key => key.startsWith('right:3:'))).toBe(true)
    const crossing = (x: number) => ({ floorId, widthMm: 500, pointsMm: [{ x, y: 16000 }, { x, y: 20500 }] })
    expect(checkTerrainRoute(doc, crossing(5400)).ok).toBe(true)
    expect(checkTerrainRoute(doc, crossing(8000)).ok).toBe(false)
    const first = members['right:0:0:section:body']
    if (first.state !== 'placed') throw new Error('missing first section')
    const lamp = Object.entries(members).find(([key, row]) => isPathLampMember(key) && row.state === 'placed')?.[1]
    if (lamp?.state !== 'placed') throw new Error('missing fence lamp')
    const positionMm = p(14100, 18000), lampLayer = 'retained-lamp-layer'
    await workspace.execute([{ type: 'createLayer', id: lampLayer, floorId, name: '单独调整的灯具' },
      { type: 'moveEntitiesToLayer', ids: [lamp.propId], layerId: lampLayer }])
    await workspace.execute([{ type: 'updateProp', id: lamp.propId, changes: { positionMm } }])
    await workspace.execute([{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: [lamp.propId] },
      adjustment: { kind: 'propGlow', id: 'retained-fence-glow', value: { ...DEFAULT_FIXTURE_GLOW, anchor: { u: .5, v: .5 } }, enabled: true } }])
    const moved = workspace.getDocument()!
    expect(projectEditorScene(moved, { floorId }).props.some(prop => prop.id === lamp.propId)).toBe(true)
    const hidden = projectEditorScene(moved, { floorId, hiddenLayerIds: new Set([layerId]) })
    expect(hidden.props.some(prop => prop.id === lamp.propId)).toBe(false)
    expect(hidden.visual?.fixtureGlows).toBeUndefined()
    await workspace.execute([{ type: 'setEditLock', kind: 'prop', id: first.propId, locked: true }])
    await workspace.execute([{ type: 'upsertManualMask', id: 'cover-fence', floorId, layerId, boundsMm: { x: 1000, y: 17000, width: 11500, height: 11500 } }])
    await expect(workspace.execute([{ ...fence, visibility: 'gm' }])).rejects.toMatchObject({
      issues: [expect.objectContaining({ entityKind: 'prop', entityId: lamp.propId })],
    })
    await workspace.execute([{ type: 'upsertManualMask', id: 'cover-relocated-lamp', floorId, layerId,
      boundsMm: { x: 13000, y: 16900, width: 2200, height: 2200 } }])
    await workspace.execute([{ ...fence, visibility: 'gm' }])
    const privateDoc = workspace.getState().project!
    const publicMap = projectScene(privateDoc.document, 'player')
    expect(privateDoc.document.props[first.propId].visibility).toBe('public')
    expect(privateDoc.document.props[lamp.propId]).toMatchObject({ positionMm, visibility: 'public' })
    expect(projectScene(privateDoc.document, 'gm').visual?.fixtureGlows?.length).toBeGreaterThan(0)
    expect(publicMap.visual?.fixtureGlows).toBeUndefined()
    expect(publicMap.props.some(prop => prop.id === lamp.propId)).toBe(false)
    expect(publicMap.props.some(prop => prop.id === first.propId || prop.appearance.kind === 'symbol' && prop.appearance.bridgeArt === 'ironPickets')).toBe(false)
    await expect(workspace.preview([{ type: 'removeFenceAssembly', id: fence.id }])).rejects.toThrow(/私密构件已锁定/)
    expect(workspace.getState().project).toBe(privateDoc)
  })

  it('publishes pinned versions, atomically swaps multiple routes and preserves manual placements and holes through reopen', async () => {
    const { workspace, repo, layerId } = await setup(false)
    const publish = styleCommand('style-v1')
    await workspace.execute([publish])
    const ref = { id: publish.id, version: 1 }
    const bridge = drawBridge(layerId), fence = drawFence(layerId)
    const first = { ...bridge, recipe: { ...bridge.recipe, fit: true as const, dimensions: publish.defaults.dimensions, section: { kind: 'prefab' as const, ref, lengthMm: 2200 } } }
    await workspace.execute([first, fence])
    const moved = memberId(workspace, 'left:0:0:section:body'), removed = memberId(workspace, 'right:0:1:section:body')
    const positionMm = { ...workspace.getDocument()!.props[moved].positionMm, y: workspace.getDocument()!.props[moved].positionMm.y - 40 }
    await workspace.execute([{ type: 'updateProp', id: moved, changes: { positionMm } }, { type: 'deleteProp', id: removed }])
    const second: PublishPathStyleCommand = { ...publish, id: 'style-v2', source: { kind: 'prefab', ref, lengthMm: 2000 }, previousRef: ref,
      defaults: { ...publish.defaults, lengthMm: 2000, dimensions: { ...publish.defaults.dimensions, detailPercent: 165 } } }
    await workspace.execute([second])
    const before = workspace.getDocument()!, replacement = { kind: 'prefab' as const, ref: { id: second.id, version: 2 }, lengthMm: 2000 }
    expect(before.paths.bridge.assembly!.recipe.section).toMatchObject({ ref })
    expect(before.prefabDefinitions[second.id].catalogId).toBe(before.prefabDefinitions[publish.id].catalogId)
    await expect(workspace.preview([
      { ...first, recipe: { ...first.recipe, section: replacement } },
      { ...fence, recipe: { ...fence.recipe, section: replacement, gaps: [{ side: 'both', fromMm: 43000, toMm: 45000 }] } },
    ])).rejects.toThrow(/开口超出路线总长/)
    expect(workspace.getDocument()).toBe(before)
    await workspace.adoptPreview(await workspace.preview([
      { ...first, recipe: { ...first.recipe, fit: true, dimensions: second.defaults.dimensions, section: replacement } },
      { ...fence, recipe: { ...fence.recipe, fit: true, dimensions: second.defaults.dimensions, section: replacement } },
    ]))
    await workspace.flush()
    const saved = workspace.getState().project!, doc = saved.document
    expect(doc.paths.bridge.assembly!.recipe.section).toEqual(replacement)
    expect(doc.visual.base.base.boundaries[fence.id].fence!.recipe.section).toEqual(replacement)
    expect(doc.props[moved].positionMm).toEqual(positionMm)
    expect(doc.props[removed]).toBeUndefined()
    expect(doc.paths.bridge.assembly!.members['right:0:1:section:body']).toEqual({ state: 'removed' })
    expect(fenceMembers(workspace)['right:0:0:section:body'].state).toBe('placed')
    workspace.undo(); await workspace.flush()
    expect(workspace.getDocument()!.paths.bridge.assembly!.recipe).toEqual(before.paths.bridge.assembly!.recipe)
    expect(workspace.getDocument()!.visual.base.base.boundaries[fence.id]).toEqual(before.visual.base.base.boundaries[fence.id])
    workspace.redo(); await workspace.flush()
    const onDisk = (await repo.load(doc.sceneId))!, live = toBundle(workspace.getState().project!)
    const cold = await importProject(await exportProject(onDisk, validation), validation)
    expect(projectContentHash(cold.project)).toBe(projectContentHash(live.project))
    expect(cold.project.document.prefabDefinitions[second.id].pathStyle).toEqual(second.defaults)
  })

  it('checks dense batch replacements against the expanded manual budget', async () => {
    const { workspace, layerId } = await setup(false)
    const first = drawFence(layerId)
    const longFences: FenceAssemblyCommand[] = [16000, 19500].map((y, index) => ({ ...first, id: `long-fence-${index}`,
      closed: false, centerlineMm: [{ x: 1800, y }, { x: 14400, y }],
      recipe: { section: { kind: 'profile', profile: 'ironPickets', lengthMm: 100 }, endClearanceMm: 0 } }))
    await workspace.execute(longFences)
    const before = workspace.getDocument()!
    expect(longFences.reduce((count, fence) => count + Object.keys(before.visual.base.base.boundaries[fence.id].fence!.members).length, 0)).toBe(252)
    const replacement = longFences.map(command => ({ ...command, recipe: { ...command.recipe,
      section: { kind: 'profile' as const, profile: 'wireMesh' as const, lengthMm: 100 } } }))
    await workspace.adoptPreview(await workspace.preview(replacement))
    const after = workspace.getDocument()!
    for (const fence of replacement) expect(after.visual.base.base.boundaries[fence.id].fence!.recipe.section).toEqual(fence.recipe.section)
  })

  it('backs up and adopts the exact style and real image dependencies in another project', async () => {
    const { workspace, layerId } = await setup(), doc = workspace.getDocument()!
    const definition = doc.propDefinitions.definition, ref = { id: definition.id, version: definition.version }
    const publication: PublishPathStyleCommand = { type: 'publishPathStyle', id: 'image-style', name: '固定图像栏片',
      source: { kind: 'prop', ref, lengthMm: 800 }, defaults: { lengthMm: 800, fit: true, lamps: { every: 2, ref },
        dimensions: { visualWidthMm: 320, footprintWidthMm: 280 } } }
    await workspace.execute([publication])
    const input = toBundle(workspace.getState().project!)
    const entry = await prepareLibraryEntry(input, { kind: 'prefab', definitionId: publication.id }, validation)
    const library = await importLibraryBackup(await exportLibraryBackup({ entries: [entry], organizations: {} }, validation), validation)
    const adopted = await adoptLibraryEntries(fixture(), library.entries, validation)
    const project = adopted.bundle.project
    expect(project.document.prefabDefinitions[publication.id].pathStyle).toEqual(publication.defaults)
    expect(project.document.propDefinitions[ref.id]).toEqual(definition)
    expect(await adopted.bundle.resources.read(doc.assets.image.sha256)).toEqual(await input.resources.read(doc.assets.image.sha256))
    const path = drawBridge(layerId)
    await expect(workspace.preview([{ ...path, recipe: { ...path.recipe, section: { kind: 'prefab', ref: { id: publication.id, version: 2 }, lengthMm: 1800 } } }])).rejects.toThrow(/版本匹配/)
  })
})
