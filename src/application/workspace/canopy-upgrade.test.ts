import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { applyCommands } from '../../shared/commands/commands.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { projectScene } from '../../shared/projection/projection.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { validateSceneDocument } from '../../shared/validation/scene.js'
import { cloneJson } from '../../shared/validation/json.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { captureEditableDraft, fromBundle, toBundle, validateEditableProject, type EditableProject } from './project.js'
import { prepareTerrainUpgrade } from './terrain.js'
import { prepareCompositionUpgrade } from './terrain-composition.js'
import { prepareConnectionUpgrade } from './connection-upgrade.js'
import { prepareDecorationUpgrade } from './decoration-upgrade.js'
import { prepareCanopyUpgrade } from './canopy-upgrade.js'
import { Workspace } from './workspace.js'

const repositories: ProjectRepository[] = [], sessions: Workspace[] = []
afterEach(async () => {
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

async function source6(): Promise<EditableProject> {
  const base = captureEditableDraft(await fromBundle(fixture({ image: true }), validation))
  base.schemaVersion = 2; base.document.schemaVersion = 2; base.document.visual = emptyVisualSystem()
  Object.assign(base, createCompositionContent(base.document, runtime))
  const checked = await validateEditableProject(base, validation)
  const v3 = await prepareTerrainUpgrade(checked, { runtime, validation })
  const v4 = await prepareCompositionUpgrade(v3, { runtime, validation })
  const v5 = await prepareConnectionUpgrade(v4, { runtime, validation })
  const v6 = await prepareDecorationUpgrade(v5, { runtime, validation })
  const candidate = captureEditableDraft(v6), layerId = candidate.document.entityLayers.item
  candidate.document.decorationClusters!.trees = {
    id: 'trees', floorId: 'blank-floor', editLocked: false, visibility: 'public', supportRef: { kind: 'floor', id: 'blank-floor' },
    boundsMm: { x: 1000, y: 1000, width: 4000, height: 4000 }, seed: 'canopy-upgrade-seed', algorithmVersion: 'cluster-v1',
    palette: [{ key: 'tree', definitionRef: { id: 'definition', version: 1 }, kind: 'prop', weight: 1 }],
    maxInstances: 1, spacingMm: 100, clusterRadiusMm: 500, clearanceMm: 100, members: {},
  }
  candidate.document.entityLayers.trees = layerId
  candidate.historyIdentity = advanceHistoryIdentity(v6.historyIdentity, v6.document, candidate.document, runtime)
  return validateEditableProject(candidate, validation)
}

async function source6WithCanopySurface(): Promise<EditableProject> {
  const source = await source6(), candidate = captureEditableDraft(source), layerId = candidate.document.entityLayers.item
  const previous = cloneJson(candidate.document), definition = candidate.document.propDefinitions.definition
  definition.name = 'Test oak tree'; definition.tags = ['tree']
  candidate.document.terrainAreas['canopy-ground'] = {
    id: 'canopy-ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 10000, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 10000, y: 20000 }]
      .map((positionMm, index) => ({ id: `canopy-point-${index}`, segmentId: `canopy-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
  }
  candidate.document.regions['canopy-private-mask'] = {
    id: 'canopy-private-mask', floorId: 'blank-floor', editLocked: false, boundaryMm: [{ x: 14500, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 14500, y: 20000 }],
    kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1, visibility: 'gm',
  }
  candidate.document.entityLayers['canopy-ground'] = layerId
  candidate.document.entityLayers['canopy-private-mask'] = layerId
  candidate.historyIdentity = advanceHistoryIdentity(candidate.historyIdentity, previous, candidate.document, runtime)
  return validateEditableProject(candidate, validation)
}

describe('strict complete7 canopy copies', () => {
  it('creates a v7 copy while preserving v6 scene, decoration cluster and identity4', async () => {
    const source = await source6(), before = toBundle(source).project, target = await prepareCanopyUpgrade(source, { runtime, validation })
    expect(source.schemaVersion).toBe(6)
    expect(target).toMatchObject({ schemaVersion: 7, document: { schemaVersion: 7, revision: 0 }, historyIdentity: { version: 4 } })
    expect(target.document.sceneId).not.toBe(source.document.sceneId)
    expect(target.historyIdentity.lineageId).not.toBe(source.historyIdentity.lineageId)
    expect(target.historyIdentity.rootSceneId).toBe(target.document.sceneId)
    expect(target.document.decorationClusters).toEqual(source.document.decorationClusters)
    expect(target.document.decorationClusters!.trees.canopyRule).toBeUndefined()
    expect(target.historyIdentity.decorationTokens).toEqual(source.historyIdentity.decorationTokens)
    expect(target.document).toEqual({ ...source.document, schemaVersion: 7, sceneId: target.document.sceneId, revision: 0,
      title: target.document.title, createdAt: target.document.createdAt, updatedAt: target.document.updatedAt })
    expect(toBundle(source).project).toEqual(before)
    expect(await validateEditableProject(source, validation)).toMatchObject({ schemaVersion: 6 })
    await expect(prepareCanopyUpgrade(target, { runtime, validation })).rejects.toThrow(/完整v6/)
  })

  it('preserves the v6 source and cold-reads the independently saved v7 copy', async () => {
    const repo = new ProjectRepository({ name: `canopy-copy-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
    await workspace.adoptNew(await source6())
    const source = workspace.getState().project!, sourceId = source.document.sceneId, sourceHash = projectContentHash(toBundle(source).project)
    await workspace.enableCanopyCopy()
    const target = workspace.getState().project!, cold = await repo.load(target.document.sceneId)
    expect(target.schemaVersion).toBe(7)
    expect(cold!.project).toEqual(toBundle(target).project)
    expect(projectContentHash((await repo.load(sourceId))!.project)).toBe(sourceHash)
    const transfer = await repo.exportNativeUpgradeCapsule(target.document.sceneId)
    expect(transfer.capsule.family.current.project.schemaVersion).toBe(6)
    expect(transfer.capsule.targetInitialProject).toEqual(toBundle(target).project)
  })

  it('rejects changing cluster generation during the format-copy migration', async () => {
    const repo = new ProjectRepository({ name: `canopy-copy-forged-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const source = await source6(), target = await prepareCanopyUpgrade(source, { runtime, validation })
    const forgedDraft = captureEditableDraft(target)
    forgedDraft.document.decorationClusters!.trees.maxInstances = 2
    const forged = await validateEditableProject(forgedDraft, validation)
    await repo.save(toBundle(source), null)
    await expect(repo.preserveNativeUpgrade(toBundle(source), toBundle(forged))).rejects.toThrow(/不得在迁移中添加树冠规则或改写生成结果/)
    expect(await repo.database.nativeUpgradeCapsules.count()).toBe(0)
    expect(await repo.load(forged.document.sceneId)).toBeNull()
  })

  it('keeps v6 decoration commands compatible and carries v7 canopy trees through identity and player projection', async () => {
    const source = await source6WithCanopySurface(), sourceScene = cloneJson(source.document)
    const area = [{ x: 10500, y: 2000 }, { x: 14500, y: 2000 }, { x: 14500, y: 6000 }, { x: 10500, y: 6000 }]
    const publicRule = { type: 'createCanopyRegion' as const, id: 'public-canopy', floorId: 'blank-floor', layerId: sourceScene.entityLayers.item,
      visibility: 'public' as const, supportRef: { kind: 'terrainArea' as const, id: 'canopy-ground' }, regionsMm: [area],
      definitionRef: { id: 'definition', version: 1 }, seed: 'public-canopy-seed', mode: 'plant' as const, canopyCoveragePpm: 7500,
      spacingMm: 600, clusterRadiusMm: 800, clearanceMm: 100 }
    const privateRule = { ...publicRule, id: 'private-canopy', visibility: 'gm' as const,
      regionsMm: [[{ x: 15000, y: 2000 }, { x: 19000, y: 2000 }, { x: 19000, y: 6000 }, { x: 15000, y: 6000 }]], seed: 'private-canopy-seed' }

    expect(validateSceneDocument({ ...sourceScene, decorationClusters: { ...sourceScene.decorationClusters,
      trees: { ...sourceScene.decorationClusters!.trees, canopyRule: { regionsMm: [area], channel: 'trees', paintOrder: 1, mode: 'plant', canopyCoveragePpm: 300_000 } } } }).ok).toBe(false)
    expect(validateSceneDocument(applyCommands(sourceScene, [{ type: 'deleteDecorationCluster', id: 'trees' }], runtime)).ok).toBe(true)
    expect(() => applyCommands(sourceScene, [publicRule], runtime)).toThrow(/v7/)

    const upgraded = await prepareCanopyUpgrade(source, { runtime, validation })
    expect(upgraded.schemaVersion).toBe(7)
    const publicOnly = applyCommands(upgraded.document, [publicRule], runtime)
    const privateOverlay = applyCommands(upgraded.document, [publicRule, { ...privateRule, regionsMm: [area] }], runtime)
    const publicPositions = (scene: typeof upgraded.document, id: string) => Object.values(scene.decorationClusters![id].members)
      .flatMap(member => member.entityId && member.state !== 'deleted' && member.state !== 'detached'
        ? [`${scene.props[member.entityId].positionMm.x},${scene.props[member.entityId].positionMm.y}`] : []).sort()
    expect(publicPositions(privateOverlay, 'public-canopy')).toEqual(publicPositions(publicOnly, 'public-canopy'))
    const lockedPrivate = applyCommands(upgraded.document, [privateRule], runtime)
    lockedPrivate.decorationClusters!['private-canopy'].editLocked = true
    expect(() => applyCommands(lockedPrivate, [{ ...publicRule, id: 'public-beside-private' }], runtime)).not.toThrow()

    const generated = applyCommands(upgraded.document, [publicRule, privateRule], runtime)
    const publicTreeIds = Object.values(generated.decorationClusters!['public-canopy'].members)
      .flatMap(member => member.entityId && member.state !== 'deleted' && member.state !== 'detached' ? [member.entityId] : [])
    const privateTreeIds = Object.values(generated.decorationClusters!['private-canopy'].members)
      .flatMap(member => member.entityId && member.state !== 'deleted' && member.state !== 'detached' ? [member.entityId] : [])
    expect(publicTreeIds.length).toBeGreaterThan(0)
    expect(privateTreeIds.length).toBeGreaterThan(0)

    const identity = advanceHistoryIdentity(upgraded.historyIdentity, upgraded.document, generated, runtime)
    expect(identity.version).toBe(4)
    for (const id of [...publicTreeIds, ...privateTreeIds]) expect(identity.propTokens[id]).toBeTruthy()
    expect(validateSceneDocument(generated).ok).toBe(true)
    expect(source.document).toEqual(sourceScene)

    const player = projectScene(generated, 'player'), gm = projectScene(generated, 'gm')
    expect(player.props.map(prop => prop.id)).toEqual(expect.arrayContaining(publicTreeIds))
    expect(privateTreeIds.some(id => player.props.some(prop => prop.id === id))).toBe(false)
    expect(gm.props.map(prop => prop.id)).toEqual(expect.arrayContaining([...publicTreeIds, ...privateTreeIds]))
    expect(JSON.stringify(player)).not.toContain('canopyRule')

    const erased = applyCommands(publicOnly, [{ type: 'updateCanopyRegion', id: 'public-canopy', mode: 'erase', canopyCoveragePpm: 0 }], runtime)
    expect(validateSceneDocument(erased).ok).toBe(true)
    expect(publicTreeIds.every(id => !erased.props[id])).toBe(true)
    expect(Object.values(erased.decorationClusters!['public-canopy'].members).every(member => !member.entityId || erased.props[member.entityId])).toBe(true)

    const earlier = { ...publicRule, id: 'earlier-canopy', seed: 'earlier-canopy-seed' }
    const later = { ...publicRule, id: 'later-canopy', seed: 'later-canopy-seed' }
    const layered = applyCommands(upgraded.document, [earlier, later], runtime)
    expect(publicPositions(layered, 'earlier-canopy')).toEqual([])
    const revealed = applyCommands(layered, [{ type: 'deleteDecorationCluster', id: 'later-canopy' }], runtime)
    expect(publicPositions(revealed, 'earlier-canopy').length).toBeGreaterThan(0)
    expect(validateSceneDocument(revealed).ok).toBe(true)
  })
})
