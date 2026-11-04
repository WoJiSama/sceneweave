import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { advanceHistoryIdentity } from '../../shared/history/identity.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import { cloneJson } from '../../shared/validation/json.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { captureEditableDraft, fromBundle, toBundle, validateEditableProject, type EditableProject } from './project.js'
import { prepareTerrainUpgrade } from './terrain.js'
import { prepareCompositionUpgrade } from './terrain-composition.js'
import { prepareConnectionUpgrade } from './connection-upgrade.js'
import { prepareDecorationUpgrade } from './decoration-upgrade.js'
import { prepareCanopyUpgrade } from './canopy-upgrade.js'
import { prepareSurfaceRulesUpgrade } from './surface-rules-upgrade.js'

const repositories: ProjectRepository[] = []
afterEach(async () => {
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

async function source7(): Promise<EditableProject> {
  const base = captureEditableDraft(await fromBundle(fixture({ image: true }), validation))
  base.schemaVersion = 2; base.document.schemaVersion = 2; base.document.visual = emptyVisualSystem()
  Object.assign(base, createCompositionContent(base.document, runtime))
  const checked = await validateEditableProject(base, validation)
  const v3 = await prepareTerrainUpgrade(checked, { runtime, validation })
  const v4 = await prepareCompositionUpgrade(v3, { runtime, validation })
  const v5 = await prepareConnectionUpgrade(v4, { runtime, validation })
  const v6 = await prepareDecorationUpgrade(v5, { runtime, validation })
  const v7 = await prepareCanopyUpgrade(v6, { runtime, validation }), candidate = captureEditableDraft(v7)
  const before = cloneJson(candidate.document), layerId = candidate.document.entityLayers.item
  candidate.document.terrainAreas['tree-support'] = { id: 'tree-support', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 1000, y: 1000 }, { x: 7000, y: 1000 }, { x: 7000, y: 7000 }, { x: 1000, y: 7000 }]
      .map((positionMm, index) => ({ id: `tree-point-${index}`, segmentId: `tree-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  candidate.document.entityLayers['tree-support'] = layerId
  candidate.document.props.item.supportRef = { kind: 'terrainArea', id: 'tree-support' }
  candidate.document.props.item.positionMm = { x: 4000, y: 4000 }
  candidate.document.decorationClusters!['tree-cluster'] = { id: 'tree-cluster', floorId: 'blank-floor', editLocked: true, visibility: 'public',
    supportRef: { kind: 'terrainArea', id: 'tree-support' }, boundsMm: { x: 1000, y: 1000, width: 6000, height: 6000 },
    seed: 'stable-tree-seed', algorithmVersion: 'cluster-v1', palette: [{ key: 'oak', definitionRef: { id: 'definition', version: 1 }, kind: 'prop', weight: 1 }],
    maxInstances: 4, spacingMm: 200, clusterRadiusMm: 1000, clearanceMm: 100,
    members: { ['a'.repeat(64)]: { kind: 'prop', entityId: 'item', state: 'manual' } },
    canopyRule: { regionsMm: [[{ x: 2000, y: 2000 }, { x: 5000, y: 2000 }, { x: 5000, y: 5000 }, { x: 2000, y: 5000 }],
      [{ x: 4500, y: 3000 }, { x: 6500, y: 3000 }, { x: 6500, y: 6000 }, { x: 4500, y: 6000 }]],
    channel: 'trees', paintOrder: 3, mode: 'plant', canopyCoveragePpm: 250_000 } }
  candidate.document.entityLayers['tree-cluster'] = layerId
  candidate.historyIdentity = advanceHistoryIdentity(v7.historyIdentity, before, candidate.document, runtime)
  return validateEditableProject(candidate, validation)
}

describe('strict complete8 surface-rule copies', () => {
  it('moves v7 canopy ownership to a fresh tree rule without regenerating members or changing old identities', async () => {
    const source = await source7(), sourceProject = toBundle(source).project
    const sourceProps = cloneJson(source.document.props), cluster = cloneJson(source.document.decorationClusters!['tree-cluster'])
    const oldIdentity = cloneJson(source.historyIdentity), target = await prepareSurfaceRulesUpgrade(source, { runtime, validation })
    expect(target).toMatchObject({ schemaVersion: 8, document: { schemaVersion: 8, revision: 0 }, historyIdentity: { version: 5 } })
    expect(target.document.sceneId).not.toBe(source.document.sceneId)
    expect(target.historyIdentity.lineageId).not.toBe(source.historyIdentity.lineageId)
    expect(target.document.props).toEqual(sourceProps)
    const migratedCluster = cloneJson(target.document.decorationClusters!['tree-cluster'])
    delete migratedCluster.canopyRule
    const originalCluster = cloneJson(cluster)
    delete originalCluster.canopyRule
    expect(migratedCluster).toEqual(originalCluster)
    expect(target.document.decorationClusters!['tree-cluster'].canopyRule).toBeUndefined()
    const rule = Object.values(target.document.surfaceRules!).find(row => row.field === 'trees')!
    expect(rule).toMatchObject({ field: 'trees', clusterId: 'tree-cluster', supportRef: { kind: 'terrainArea', id: 'tree-support' },
      paintOrder: 3, coveragePpm: 250_000, editLocked: true })
    expect(rule.regionsMm).toHaveLength(1)
    expect(rule.regionsMm[0].holesMm).toEqual([])
    expect(target.document.entityLayers[rule.id]).toBe(target.document.entityLayers['tree-cluster'])
    expect(target.historyIdentity.propTokens).toEqual(oldIdentity.propTokens)
    expect(target.historyIdentity.decorationTokens!['tree-cluster'].token).toBe(oldIdentity.decorationTokens!['tree-cluster'].token)
    expect(target.historyIdentity.decorationTokens!['tree-cluster'].topologyToken).not.toBe(oldIdentity.decorationTokens!['tree-cluster'].topologyToken)
    expect(target.historyIdentity.surfaceRuleTokens![rule.id]).toBeTruthy()
    expect(target.document.props.item.supportRef).toEqual({ kind: 'terrainArea', id: 'tree-support' })
    expect(toBundle(source).project).toEqual(sourceProject)
    expect(projectContentHash(toBundle(source).project)).not.toBe(projectContentHash(toBundle(target).project))
    expect(await validateEditableProject(source, validation)).toMatchObject({ schemaVersion: 7 })
    await expect(prepareSurfaceRulesUpgrade(target, { runtime, validation })).rejects.toThrow(/完整v7/)
  })

  it('preserves the v7 source, saves and cold-reads the v8 copy, exports/imports original family', async () => {
    const repo = new ProjectRepository({ name: `surface-copy-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
    const source = await source7(), sourceId = source.document.sceneId, sourceHash = projectContentHash(toBundle(source).project)
    await repo.save(toBundle(source), null)
    const target = await prepareSurfaceRulesUpgrade(source, { runtime, validation })
    await repo.preserveNativeUpgrade(toBundle(source), toBundle(target))
    await repo.save(toBundle(target), null)
    const cold = await repo.load(target.document.sceneId)
    expect(cold!.project).toEqual(toBundle(target).project)
    expect(projectContentHash((await repo.load(sourceId))!.project)).toBe(sourceHash)
    expect((await repo.listNativeUpgradeSummaries(target.document.sceneId))[0]).toMatchObject({ sourceSchemaVersion: 7, sourceSceneId: sourceId })
    const transfer = await repo.exportNativeUpgradeCapsule(target.document.sceneId)
    expect(transfer.capsule.family.current.project.schemaVersion).toBe(7)
    expect(transfer.capsule.targetInitialProject).toEqual(toBundle(target).project)
    const bytes = await repo.exportNativeUpgradeFile(target.document.sceneId)
    const imported = new ProjectRepository({ name: `surface-originals-${crypto.randomUUID()}`, runtime, validation }); repositories.push(imported)
    await imported.importNativeUpgradeFile(bytes)
    expect((await imported.exportNativeUpgradeCapsule(target.document.sceneId)).capsule).toEqual(transfer.capsule)
    expect(await imported.load(sourceId)).toBeNull()
    expect(await imported.load(target.document.sceneId)).toBeNull()
  })
})
