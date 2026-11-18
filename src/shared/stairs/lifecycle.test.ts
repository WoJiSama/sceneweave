import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { fromBundle } from '../../application/workspace/project.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { ProjectBundle } from '../model/project.js'
import type { PointMm, SceneDocument, TerrainConnection } from '../model/scene.js'
import { validateGeometry } from '../geometry/geometry.js'
import { checkTerrainRoute } from '../geometry/terrain-travel.js'
import { buildRestorePlan } from '../history/restore.js'
import { projectScene } from '../projection/projection.js'
import { exportProject, importProject } from '../project/file.js'
import { createTerrainSlopeCommand } from '../terrain-inlay/slope.js'
import { validateTerrainInlayProofs } from '../terrain-inlay/scene.js'
import { certifyCompositionContent } from '../validation/content.js'
import { cloneJson } from '../validation/json.js'
import { sceneDocumentSchema } from '../validation/scene.js'
import { defaultStaircase, type StaircaseConfig } from './contracts.js'
import { prepareStaircaseCommands } from './edit.js'

const floorId = 'blank-floor'
const rect = (x: number, y: number, right: number, bottom: number): PointMm[] => [
  { x, y }, { x: right, y }, { x: right, y: bottom }, { x, y: bottom },
]
const coveredStaircase = (): StaircaseConfig => ({ ...defaultStaircase(), preset: 'timber', material: 'oak',
  layout: { kind: 'stretch', stepCount: 19 }, textureScaleMm: 240,
  covers: [{ id: 'cover-at-upper-edge', kind: 'grass', pointsPpm: [
    { x: 500_000, y: 200_000 }, { x: 800_000, y: 200_000 },
    { x: 800_000, y: 500_000 }, { x: 500_000, y: 500_000 },
  ] }],
})
const physicalConnection = (connection: TerrainConnection) => {
  const { staircase: _staircase, ...physical } = connection
  return physical
}

/** The same real-byte complete-project adapter used by workspace/storage tests.
 * Props sit outside the two source terraces, so stair appearance cannot alter
 * their explicit floor support or silently discard their bitmap resources. */
function prepared(bundle: ProjectBundle = fixture({ image: true })) {
  const scene = bundle.project.document
  scene.props.item.positionMm = { x: 14000, y: 14000 }
  scene.props.other.positionMm = { x: 16000, y: 16000 }
  const initial = certifyCompositionContent(createCompositionContent(scene, runtime))
  const createArea = (id: string, boundaryMm: PointMm[], z: number, priority: number): CompositionCommand => ({
    type: 'createTerrainArea', id, floorId, boundaryMm, groundElevationMm: z,
    coveragePriority: priority, visibility: 'public', surfaceStyle: null,
  })
  return applyCompositionDraftCommands(initial, [
    createArea('low', rect(1000, 1000, 11000, 11000), 1000, 1),
    createArea('high', rect(5500, 2000, 10500, 10000), 3000, 2),
    { type: 'createTerrainConnection', id: 'stairs', floorId, kind: 'stairs',
      from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 2000, y: 6000 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 9000, y: 6000 } },
      widthMm: 1000, openingId: null, staircase: defaultStaircase() },
  ], runtime)
}

const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) {
    const name = repository.database.name; repository.close(); await Dexie.delete(name)
  }
})

describe('dedicated staircase complete-project lifecycle', () => {
  it('persists strict component data without changing support, width, travel or the original bitmap props', () => {
    const before = prepared(), physical = physicalConnection(before.document.terrainConnections.stairs)
    const config = coveredStaircase(), source = JSON.stringify(config)
    const after = applyCompositionDraftCommands(before, prepareStaircaseCommands(before.document, 'stairs', { staircase: config }), runtime)
    expect(JSON.stringify(config)).toBe(source)
    expect(physicalConnection(after.document.terrainConnections.stairs)).toEqual(physical)
    expect(after.document.props).toEqual(before.document.props)
    expect(after.document.terrainAreas).toEqual(before.document.terrainAreas)
    expect(after.document.assets).toEqual(before.document.assets)
    expect(after.document.schemaVersion).toBe(1)
    const cold = sceneDocumentSchema.parse(JSON.parse(JSON.stringify(after.document)))
    expect(cold.terrainConnections.stairs.staircase).toEqual(config)
    expect(validateGeometry(cold).errors).toEqual([])
    expect(checkTerrainRoute(cold, { floorId, pointsMm: [physical.from.positionMm, physical.to.positionMm], widthMm: 1000 }).ok).toBe(true)
    const unknown = cloneJson(cold) as SceneDocument
    Object.assign(unknown.terrainConnections.stairs.staircase!, { uncheckedPattern: 'old-renderer' })
    expect(sceneDocumentSchema.safeParse(unknown).success).toBe(false)
    const removed = applyCompositionDraftCommands(after, prepareStaircaseCommands(after.document, 'stairs', { staircase: null }), runtime)
    expect(removed.document.terrainConnections.stairs.staircase).toBeUndefined()
    expect(physicalConnection(removed.document.terrainConnections.stairs)).toEqual(physical)
  })

  it('keeps cover data within audience-filtered connections and returns independent projection data', () => {
    const content = prepared()
    const withCovers = applyCompositionDraftCommands(content, prepareStaircaseCommands(content.document, 'stairs', { staircase: coveredStaircase() }), runtime)
    const scene = cloneJson(withCovers.document), projected = projectScene(scene, 'gm').connections.find(row => row.id === 'stairs')!
    expect(projected.staircase).toEqual(scene.terrainConnections.stairs.staircase)
    projected.staircase!.covers[0].pointsPpm[0].x = 0
    expect(scene.terrainConnections.stairs.staircase!.covers[0].pointsPpm[0].x).toBe(500_000)
    scene.terrainConnections.stairs.visibility = 'gm'
    scene.regions.mask = { id: 'mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: rect(0, 0, 20000, 20000), blocksMovement: false, movementCostMultiplier: 1 }
    scene.entityLayers.mask = scene.entityLayers.stairs
    const player = projectScene(scene, 'player')
    expect(player.connections).toEqual([])
    expect(JSON.stringify(player)).not.toContain('cover-at-upper-edge')
    expect(projectScene(scene, 'gm').connections[0].staircase).toEqual(coveredStaircase())
  })

  it('keeps previews atomic under stale baselines and source locks, then survives undo, cold storage and real-byte backup import', async () => {
    const bundle = fixture({ image: true }), content = prepared(bundle)
    Object.assign(bundle.project, content)
    const imageHash = bundle.project.document.assets.image.sha256, originalBytes = await bundle.resources.read(imageHash)
    const repository = new ProjectRepository({ name: `staircase-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(bundle, validation))
    const commands = () => prepareStaircaseCommands(workspace.getDocument()!, 'stairs', { staircase: coveredStaircase() })
    const before = cloneJson(workspace.getDocument()!), stale = await workspace.preview(commands())
    expect(workspace.getDocument()).toEqual(before)
    await workspace.execute([{ type: 'setEditLock', kind: 'terrainArea', id: 'low', locked: true }])
    const locked = cloneJson(workspace.getDocument()!)
    await expect(workspace.adoptPreview(stale)).rejects.toThrow(/场景已有修改/)
    workspace.cancelPreview(stale)
    await expect(workspace.preview(commands())).rejects.toThrow(/锁/)
    expect(workspace.getDocument()).toEqual(locked)
    await workspace.execute([{ type: 'setEditLock', kind: 'terrainArea', id: 'low', locked: false }])
    const preview = await workspace.preview(commands())
    await workspace.adoptPreview(preview)
    expect(workspace.getDocument()!.terrainConnections.stairs.staircase).toEqual(coveredStaircase())
    workspace.undo(); expect(workspace.getDocument()!.terrainConnections.stairs.staircase).toEqual(defaultStaircase())
    workspace.redo(); expect(workspace.getDocument()!.terrainConnections.stairs.staircase).toEqual(coveredStaircase())
    await workspace.flush()
    const cold = (await repository.load(workspace.getDocument()!.sceneId))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(await cold.resources.read(imageHash)).toEqual(originalBytes)
    const imported = await importProject(await exportProject(cold, validation), validation)
    expect(imported.project.document).toEqual(cold.project.document)
    expect(imported.project.historyIdentity).toEqual(cold.project.historyIdentity)
    expect(imported.project.licenseBindings).toEqual(cold.project.licenseBindings)
    expect(await imported.resources.read(imageHash)).toEqual(originalBytes)
  }, 30000)

  it('changes only the component on a real inlay and never resurrects a removed component when restoring frozen source', () => {
    const original = prepared(), adopted = applyCompositionDraftCommands(original, [
      { ...createTerrainSlopeCommand(original.document, 'stairs', { bankWidthMm: 1000 }), appearance: 'source-ground', finish: { kind: 'slope' } },
    ], runtime)
    const actual = cloneJson(adopted.document.terrainConnections.stairs), sources = cloneJson(adopted.document.terrainAreas)
    const after = applyCompositionDraftCommands(adopted, prepareStaircaseCommands(adopted.document, 'stairs', { staircase: coveredStaircase() }), runtime)
    expect(after.document.terrainConnections.stairs.terrainInlay).toEqual(actual.terrainInlay)
    expect(after.document.terrainAreas).toEqual(sources)
    expect(validateTerrainInlayProofs(after.document, after.historyIdentity)).toEqual([])
    expect(validateGeometry(after.document).errors).toEqual([])
    const removed = applyCompositionDraftCommands(after, prepareStaircaseCommands(after.document, 'stairs', { staircase: null }), runtime)
    const restored = applyCompositionDraftCommands(removed, [{ type: 'restoreTerrainInlaySource', id: 'stairs', disposition: 'restore-original-connection-and-ground' }], runtime)
    expect(restored.document.terrainConnections.stairs.staircase).toBeUndefined()
    expect(restored.document.terrainConnections.stairs.terrainInlay).toBeUndefined()
    expect(restored.document.terrainConnections.stairs.from).toEqual(original.document.terrainConnections.stairs.from)
    expect(restored.document.terrainAreas).toEqual(sources)
  })

  it('restores staircase properties on the same birth without replacing unrelated edits, and can restore absence', () => {
    const historic = prepared(), current = applyCompositionDraftCommands(historic, [
      ...prepareStaircaseCommands(historic.document, 'stairs', { staircase: coveredStaircase() }),
      { type: 'updateProp', id: 'item', changes: { rotationDeg: 23 } },
    ], runtime)
    const geometryOnly = buildRestorePlan(current, historic, { ids: ['stairs'], mode: 'outdoorGeometry' })
    expect(geometryOnly.document.terrainConnections.stairs.staircase).toEqual(coveredStaircase())
    const properties = buildRestorePlan(current, historic, { ids: ['stairs'], mode: 'outdoorProperties' })
    expect(properties.document.terrainConnections.stairs.staircase).toEqual(defaultStaircase())
    expect(properties.document.props).toEqual(current.document.props)
    const absent = applyCompositionDraftCommands(historic, prepareStaircaseCommands(historic.document, 'stairs', { staircase: null }), runtime)
    expect(buildRestorePlan(current, absent, { ids: ['stairs'], mode: 'outdoorProperties' }).document.terrainConnections.stairs.staircase).toBeUndefined()
  })

  it('treats explicit bank-only edits as a slope rebuild while keeping the route and source terrain', () => {
    const original = prepared(), adopted = applyCompositionDraftCommands(original, [createTerrainSlopeCommand(original.document, 'stairs', { bankWidthMm: 1000 })], runtime)
    const commands = prepareStaircaseCommands(adopted.document, 'stairs', { staircase: defaultStaircase(), bankWidthMm: { left: 500, right: 700 } })
    expect(commands.map(command => command.type)).toEqual(['restoreTerrainInlaySource', 'updateTerrainConnection', 'adoptTerrainInlay'])
    const after = applyCompositionDraftCommands(adopted, commands, runtime)
    expect(after.document.terrainConnections.stairs.from).toEqual(adopted.document.terrainConnections.stairs.from)
    expect(after.document.terrainConnections.stairs.to).toEqual(adopted.document.terrainConnections.stairs.to)
    expect(after.document.terrainConnections.stairs.terrainInlay!.geometry).not.toEqual(adopted.document.terrainConnections.stairs.terrainInlay!.geometry)
    expect(after.document.terrainAreas).toEqual(adopted.document.terrainAreas)
  })

  it('explicitly rebuilds an existing slope for width/rotation while preserving component covers and source geometry', () => {
    const original = prepared(), adopted = applyCompositionDraftCommands(original, [
      createTerrainSlopeCommand(original.document, 'stairs', { bankWidthMm: 1000 }),
    ], runtime)
    const before = JSON.stringify(adopted), commands = prepareStaircaseCommands(adopted.document, 'stairs', {
      staircase: coveredStaircase(), widthMm: 1200,
      transform: { rotationDeg: 2, lengthScale: 1 }, bankWidthMm: { left: 700, right: 900 },
    })
    expect(JSON.stringify(adopted)).toBe(before)
    expect(commands.map(command => command.type)).toContain('restoreTerrainInlaySource')
    expect(commands.map(command => command.type)).toContain('adoptTerrainInlay')
    const after = applyCompositionDraftCommands(adopted, commands, runtime), connection = after.document.terrainConnections.stairs
    expect(connection.widthMm).toBe(1200)
    expect(connection.staircase).toEqual(coveredStaircase())
    expect(connection.terrainInlay!.originalConnection.widthMm).toBe(1200)
    expect(connection.to.positionMm).not.toEqual(adopted.document.terrainConnections.stairs.to.positionMm)
    expect(after.document.terrainAreas).toEqual(adopted.document.terrainAreas)
    expect(validateTerrainInlayProofs(after.document, after.historyIdentity)).toEqual([])
    expect(validateGeometry(after.document).errors).toEqual([])
  })
})
