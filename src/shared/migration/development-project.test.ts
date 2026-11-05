import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { validateDecorations } from '../decorations/validation.js'
import { decorationIdentityDescriptors } from '../history/identity.js'
import { cloneJson } from '../validation/json.js'
import { convertDevelopmentProject, readLegacyDevelopmentProject } from './development-project.js'
import type { ProjectData } from '../model/project.js'

function oldSnapshot(version: number) {
  const project = cloneJson(fixture({ image: true }).project) as unknown as Record<string, unknown>, scene = project.document as Record<string, unknown>
  const identity = project.historyIdentity as Record<string, unknown>, appearance = project.appearance as Record<string, unknown>
  project.schemaVersion = scene.schemaVersion = version
  if (version < 8) { delete scene.surfaceRules; delete identity.surfaceRuleTokens }
  if (version < 6) { delete scene.decorations; delete scene.decorationClusters; delete identity.decorationTokens }
  if (version < 4) { scene.generation = (scene.generation as Record<string, unknown>).legacy; scene.visual = (scene.visual as Record<string, unknown>).base; delete identity.terrainTokens }
  if (version < 3) {
    delete scene.generation; delete scene.mapMode; delete scene.regional
    if (version === 2) scene.visual = (scene.visual as Record<string, unknown>).base
    else delete scene.visual
    const base = new Set(['version', 'lineageId', 'rootSceneId', 'propTokens', 'prefabTokens', 'outdoorTokens'])
    for (const key of Object.keys(identity)) if (!base.has(key)) delete identity[key]
    appearance.version = 1; delete appearance.presentations
  }
  identity.version = version >= 8 ? 5 : version >= 6 ? 4 : version >= 4 ? 3 : version === 3 ? 2 : 1
  return project
}

/** Actual stored member transitions, rather than an empty legacy container. */
function oldCanopySnapshot() {
  const project = fixture({ image: true }).project, document = cloneJson(project.document), layerId = document.entityLayers.item
  document.terrainAreas.ground = { id: 'ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    boundaryMm: [{ x: 1000, y: 1000 }, { x: 19000, y: 1000 }, { x: 19000, y: 19000 }, { x: 1000, y: 19000 }]
      .map((positionMm, index) => ({ id: `ground-point-${index}`, segmentId: `ground-segment-${index}`, positionMm })),
    groundElevationMm: 1200, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  document.entityLayers.ground = layerId
  const template = cloneJson(document.props.item)
  document.props = {}; delete document.entityLayers.item; delete document.entityLayers.other
  const ids = ['managed-tree', 'manual-tree', 'deleted-tree', 'detached-tree']
  ids.forEach((id, index) => {
    document.props[id] = { ...cloneJson(template), id, positionMm: { x: 4000 + index * 3000, y: 5000 }, supportRef: { kind: 'terrainArea', id: 'ground' } }
    document.entityLayers[id] = layerId
  })
  document.decorationClusters.canopy = { id: 'canopy', floorId: 'blank-floor', editLocked: false, visibility: 'public',
    supportRef: { kind: 'terrainArea', id: 'ground' }, boundsMm: { x: 2000, y: 2000, width: 15000, height: 15000 }, seed: 'old-v7-canopy', algorithmVersion: 'cluster-v1',
    palette: [{ key: 'tree', definitionRef: { id: 'definition', version: 1 }, kind: 'prop', weight: 1 }],
    maxInstances: 8, spacingMm: 500, clusterRadiusMm: 1000, clearanceMm: 100,
    members: Object.fromEntries(ids.map((id, index) => [(index + 1).toString().repeat(64), { kind: 'prop' as const, entityId: id, state: 'managed' as const }])) }
  document.entityLayers.canopy = layerId
  let sequence = 0
  const runtime = { ids: { nextId: () => `old-canopy-${++sequence}` }, clock: { now: () => document.updatedAt } }
  const edited = applyCompositionCommands(createCompositionContent(document, runtime), [
    { type: 'updateProp', id: 'manual-tree', changes: { positionMm: { x: 7200, y: 5700 }, rotationDeg: 31 } },
    { type: 'deleteProp', id: 'deleted-tree' },
    { type: 'detachDecorationMember', clusterId: 'canopy', entityId: 'detached-tree' },
  ], runtime)
  const adopted = applyCompositionCommands(edited, [
    { type: 'setEditLock', kind: 'prop', id: 'manual-tree', locked: true },
    { type: 'setEditLock', kind: 'decorationCluster', id: 'canopy', locked: true },
  ], runtime)
  adopted.document.decorationClusters.canopy.canopyRule = { channel: 'trees', paintOrder: 3, mode: 'plant', canopyCoveragePpm: 350000,
    regionsMm: [[{ x: 3000, y: 3000 }, { x: 16000, y: 3000 }, { x: 16000, y: 15000 }, { x: 3000, y: 15000 }]] }
  // Preserve the v7 topology witness for its original owned canopy geometry.
  adopted.historyIdentity.decorationTokens!.canopy.topologyHash = decorationIdentityDescriptors(adopted.document).canopy.topologyHash
  adopted.historyIdentity.decorationTokens!.canopy.topologyToken = 'old-v7-canopy-topology'
  const { surfaceRules: _surfaceRules, ...legacyDocument } = adopted.document
  const { surfaceRuleTokens: _surfaceRuleTokens, ...legacyIdentity } = adopted.historyIdentity
  const legacy = readLegacyDevelopmentProject({ ...project, ...adopted, schemaVersion: 7,
    document: { ...legacyDocument, schemaVersion: 7 }, historyIdentity: { ...legacyIdentity, version: 4 } })
  if (legacy.document.schemaVersion !== 7 || legacy.historyIdentity.version !== 4) throw new Error('Expected the historical v7 fixture')
  return { ...legacy, document: legacy.document, historyIdentity: legacy.historyIdentity }
}

describe('isolated historical project conversion', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('converts development %i to the complete current v1 without changing physical objects or original evidence', version => {
    const old = oldSnapshot(version), captured = cloneJson(old), parsed = readLegacyDevelopmentProject(old)
    const result = convertDevelopmentProject(parsed)
    expect(result.schemaVersion).toBe(1); expect(result.document.schemaVersion).toBe(1)
    expect(result.historyIdentity.version).toBe(5); expect(result.appearance.version).toBe(2)
    expect(result.document.props).toEqual((old.document as ProjectData['document']).props)
    expect(result.historyIdentity.propTokens).toEqual((old.historyIdentity as ProjectData['historyIdentity']).propTokens)
    expect(result.appearance.sources).toEqual((old.appearance as ProjectData['appearance']).sources)
    expect(old).toEqual(captured)
  })
  it('rejects mislabeled envelopes and missing old birth evidence', () => {
    const old = oldSnapshot(8); old.schemaVersion = 1
    expect(() => convertDevelopmentProject(old)).toThrow()
    const broken = oldSnapshot(1), identity = broken.historyIdentity as ProjectData['historyIdentity']
    identity.propTokens = {}
    expect(() => convertDevelopmentProject(broken)).toThrow(/token|身份/)
  })

  it('converts a real v7 canopy without resampling members or losing manual, deleted, detached and birth evidence', () => {
    const old = oldCanopySnapshot(), captured = cloneJson(old)
    const beforeCluster = old.document.decorationClusters.canopy, { canopyRule, ...cluster } = beforeCluster
    const converted = convertDevelopmentProject(old), rules = Object.values(converted.document.surfaceRules)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ field: 'trees', clusterId: 'canopy', floorId: beforeCluster.floorId,
      supportRef: beforeCluster.supportRef, visibility: beforeCluster.visibility, editLocked: true, paintOrder: 3, coveragePpm: 350000,
      regionsMm: [{ outerMm: canopyRule!.regionsMm[0], holesMm: [] }] })
    expect(converted.document.entityLayers[rules[0].id]).toBe(old.document.entityLayers.canopy)
    expect(converted.document.decorationClusters.canopy).toEqual(cluster)
    expect(converted.document.props).toEqual(old.document.props)
    expect(converted.document.props['manual-tree']).toMatchObject({ positionMm: { x: 7200, y: 5700 }, rotationDeg: 31, editLocked: true })
    expect(converted.document.decorationClusters.canopy.members).toEqual({
      ['1'.repeat(64)]: { kind: 'prop', entityId: 'managed-tree', state: 'managed' },
      ['2'.repeat(64)]: { kind: 'prop', entityId: 'manual-tree', state: 'manual' },
      ['3'.repeat(64)]: { kind: 'prop', entityId: null, state: 'deleted' },
      ['4'.repeat(64)]: { kind: 'prop', entityId: 'detached-tree', state: 'detached' },
    })
    expect(converted.document.props['deleted-tree']).toBeUndefined()
    expect(converted.historyIdentity.propTokens).toEqual(old.historyIdentity.propTokens)
    expect(converted.historyIdentity.propTokens['deleted-tree']).toBeTruthy()
    expect(converted.historyIdentity.outdoorTokens).toEqual(old.historyIdentity.outdoorTokens)
    expect(converted.historyIdentity.decorationTokens!.canopy.token).toBe(old.historyIdentity.decorationTokens.canopy.token)
    expect(converted.historyIdentity.decorationTokens!.canopy.topologyToken).not.toBe(old.historyIdentity.decorationTokens.canopy.topologyToken)
    expect(converted.appearance).toEqual(old.appearance)
    expect(converted.assets).toEqual(old.assets); expect(converted.licenses).toEqual(old.licenses); expect(converted.licenseBindings).toEqual(old.licenseBindings)
    expect(convertDevelopmentProject(old)).toEqual(converted)
    expect(old).toEqual(captured)
  })

  it('rejects damaged v7 canopy topology instead of minting a replacement witness, and retains genuine topology changes', () => {
    const old = oldCanopySnapshot()
    const converted = convertDevelopmentProject(old), damaged = cloneJson(old)
    damaged.historyIdentity.decorationTokens.canopy.topologyHash = '0'.repeat(64)
    expect(() => convertDevelopmentProject(damaged)).toThrow(/树冠簇拓扑证明损坏/)
    const missing = cloneJson(old); delete missing.historyIdentity.decorationTokens.canopy
    expect(() => convertDevelopmentProject(missing)).toThrow(/树冠簇缺少真实出生证明/)

    const changed = cloneJson(old)
    changed.document.decorationClusters.canopy.canopyRule!.regionsMm[0][0].x += 100
    expect(() => convertDevelopmentProject(changed)).toThrow(/树冠簇拓扑证明损坏/)
    changed.historyIdentity.decorationTokens.canopy.topologyHash = decorationIdentityDescriptors(changed.document as unknown as ProjectData['document']).canopy.topologyHash
    changed.historyIdentity.decorationTokens.canopy.topologyToken = 'old-v7-canopy-topology-after-edit'
    const afterTopologyChange = convertDevelopmentProject(changed), [firstRule] = Object.values(converted.document.surfaceRules), [changedRule] = Object.values(afterTopologyChange.document.surfaceRules)
    expect(changedRule.id).toBe(firstRule.id)
    expect(afterTopologyChange.historyIdentity.decorationTokens!.canopy.token).toBe(converted.historyIdentity.decorationTokens!.canopy.token)
    expect(afterTopologyChange.historyIdentity.decorationTokens!.canopy.topologyToken).not.toBe(converted.historyIdentity.decorationTokens!.canopy.topologyToken)
    expect(afterTopologyChange.document.props).toEqual(converted.document.props)
    expect(afterTopologyChange.document.decorationClusters.canopy.members).toEqual(converted.document.decorationClusters.canopy.members)
  })

  it('retains complete legal v7 painted regions beyond the old sampling bounds without changing any adopted member', () => {
    const old = oldCanopySnapshot(), expected = convertDevelopmentProject(old)
    const cluster = old.document.decorationClusters.canopy
    cluster.boundsMm = { x: 2000, y: 4000, width: 4000, height: 12000 }
    expect(validateDecorations(old.document as unknown as ProjectData['document'])).toEqual([])
    const captured = cloneJson(old), converted = convertDevelopmentProject(old)
    expect(converted.document.decorationClusters.canopy).toEqual({ ...expected.document.decorationClusters.canopy,
      boundsMm: { x: 2000, y: 3000, width: 14000, height: 13000 } })
    expect(converted.document.surfaceRules).toEqual(expected.document.surfaceRules)
    expect(converted.document.props).toEqual(old.document.props)
    expect(converted.historyIdentity).toEqual(expected.historyIdentity)
    expect(converted.appearance).toEqual(old.appearance)
    expect(old).toEqual(captured)
  })

  it('rejects an illegal v7 erase coverage before normalization instead of silently making it zero', () => {
    const old = oldCanopySnapshot(), cluster = old.document.decorationClusters.canopy
    cluster.canopyRule!.mode = 'erase'
    const captured = cloneJson(old)
    expect(readLegacyDevelopmentProject(old)).toEqual(old)
    expect(validateDecorations(old.document as unknown as ProjectData['document'])).toContainEqual(expect.objectContaining({ code: 'CANOPY_RULE_ERASE', entityId: 'canopy' }))
    expect(() => convertDevelopmentProject(old)).toThrow(/旧.*擦除规则.*0/)
    expect(old).toEqual(captured)
    cluster.canopyRule!.canopyCoveragePpm = 0
    const converted = convertDevelopmentProject(old)
    expect(Object.values(converted.document.surfaceRules)).toEqual([expect.objectContaining({ field: 'trees', coveragePpm: 0 })])
    expect(converted.document.props).toEqual(old.document.props)
    expect(converted.document.decorationClusters.canopy.members).toEqual(cluster.members)
  })
})
