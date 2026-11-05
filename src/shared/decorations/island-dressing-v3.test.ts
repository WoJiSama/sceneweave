import { beforeAll, describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { addPropAppearanceSource, createCompositionContent } from '../appearance/graph.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { SceneCommand } from '../commands/commands.js'
import type { SceneDocument, SurfaceRuleField } from '../model/scene.js'
import { applyCommands } from '../commands/commands.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { cloneJson, canonicalJson, encodeUtf8 } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { generateTerrainDocumentV5 } from '../terrain-generation/surface-generation.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { TERRAIN_VARIANT_SPECS } from '../visual/terrain-variant-specs.js'
import { SHORE_MATERIAL_IDS } from '../visual/shore-art.js'
import { polygonInside, terrainPoints } from '../geometry/geometry.js'
import { polygonBooleanWithHoles } from '../geometry/polygon-boolean.js'
import { buildIslandDressingCommandsV2 } from './island-dressing.js'
import { hasIslandSurfaceDressingV1, buildIslandSurfaceDressingCommandsV1, ISLAND_SURFACE_DRESSING_PRESET_V1 } from './island-dressing-v3.js'
import { projectScene } from '../projection/projection.js'
import { inspectDependencies } from '../geometry/dependencies.js'
import { pixelPng, validation } from '../../application/workspace/test-fixtures.js'
import { createMemoryResources } from '../project/resources.js'
import { sha256Bytes } from '../project/binary.js'

const ids = (prefix = 'island-v3') => { let serial = 0; return () => `${prefix}-${++serial}` }
const context = (prefix = 'member-v3') => ({ ids: { nextId: ids(prefix) }, clock: { now: () => '2026-11-02T00:00:00Z' } })
let scene: SceneDocument, appearance: AppearanceGraph

beforeAll(() => {
  const base = createShoreBlankDocument('island', { sceneId: 'island-surface-dressing-v3', title: 'V8 island surface dressing', now: '2026-11-02T00:00:00Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const generated = generateTerrainDocumentV5(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000,
    algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
  const composed = { ...emptyCompositionDocument(composeTerrainDocument(base, generated, 'island-v3-birth', TASK_BUDGET_PROFILES.standard).document),
    schemaVersion: 1, decorations: {}, decorationClusters: {} }
  const catalog = createTerrainVariantCatalogDocument()
  Object.assign(composed.assets, catalog.assets); Object.assign(composed.propDefinitions, catalog.propDefinitions)
  appearance = { version: 2, presentations: {}, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {} }
  for (const spec of TERRAIN_VARIANT_SPECS) {
    const definition = composed.propDefinitions[spec.definitionId]
    addPropAppearanceSource(appearance, { definitionRef: { id: definition.id, version: definition.version }, appearance: cloneJson(definition.defaultAppearance),
      visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm), shadowClass: definition.defaultShadowClass, shadowOverride: null }, null, spec.presentation)
  }
  scene = { ...cloneJson(composed), schemaVersion: 1, surfaceRules: {} }
  const checkedV8 = validateSceneDocument(scene)
  if (!checkedV8.ok) throw new Error(checkedV8.errors.map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('; '))
  scene = checkedV8.document
}, 60000)

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]

async function migratedIslandWithBlockedTreeRemainder() {
  const v7Base = cloneJson(scene)
  v7Base.surfaceRules = {}
  const crown = v7Base.terrainAreas['terrain-high']
  const points = terrainPoints(crown), minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y)), splitX = Math.floor((minX + maxX) / 2)
  const rightRegion = polygonBooleanWithHoles({ operation: 'intersection', subject: [{ outer: points, holes: [] }],
    clip: [{ outer: rectangle(splitX, minY - 1000, maxX - splitX + 1000, maxY - minY + 2000), holes: [] }] }).polygons
  const canopyRegions = rightRegion.filter(region => region.holes.length === 0).map(region => region.outer)
  if (!canopyRegions.length) throw new Error('岩岛回归夹具无法裁出无洞的旧树区。')
  const treeSpec = TERRAIN_VARIANT_SPECS.find(row => row.key === 'tree-wind-oak')!
  const legacyTree = { ...cloneJson(v7Base.propDefinitions[treeSpec.definitionId]), id: 'v7-small-tree-definition', catalogId: 'test.v7-small-tree',
    name: 'V7 small tree fixture', defaultVisualBoundsMm: { x: -400, y: -500, width: 800, height: 1000 } }
  v7Base.propDefinitions[legacyTree.id] = legacyTree
  const canopy = { type: 'paintSurfaceVegetation' as const, id: 'v7-island-tree-rule', clusterId: 'v7-island-managed-trees', field:'trees' as const, floorId: crown.floorId, layerId: v7Base.entityLayers[crown.id],
    visibility: 'public' as const, supportRef: { kind: 'terrainArea' as const, id: crown.id }, regionsMm: canopyRegions.map(outerMm=>({outerMm,holesMm:[]})),
    palette:[{key:'tree',definitionRef:{id:legacyTree.id,version:1},kind:'prop' as const,weight:1}],seed:'v7-island-managed-tree-seed',
    coveragePpm: 1_000_000, spacingMm:900, clusterRadiusMm:2200,clearanceMm:400 }
  const v7WithCanopy = applyCommands(v7Base, [canopy], context('v7-canopy'), { appearance })
  const oldCluster = cloneJson(v7WithCanopy.decorationClusters!['v7-island-managed-trees'])
  const oldManagedProps = Object.values(oldCluster.members).filter(member => member.kind === 'prop' && member.entityId && member.state === 'managed').map(member => member.entityId!)
  if (!oldManagedProps.length) throw new Error('岩岛回归夹具未生成任何v7托管树。')

  const v2 = buildIslandDressingCommandsV2(v7WithCanopy, { nextId: ids('v7-route-and-plants'), appearance })
  const v7WithV2 = applyCommands(v7WithCanopy, v2.commands, context('v7-route-members'), { appearance })
  const generation = getLegacyGeneration(v7WithV2)
  if (!generation) throw new Error('岩岛回归夹具缺少v7底图来源。')
  generation.constraints['v7-empty-west-tree-zone'] = { id: 'v7-empty-west-tree-zone', floorId: crown.floorId, visibility: 'public', strength: 'hard',
    kind: 'activityArea', boundaryMm: rectangle(v7WithV2.floors[crown.floorId].boundsMm.x, v7WithV2.floors[crown.floorId].boundsMm.y,
      splitX + 1000 - v7WithV2.floors[crown.floorId].boundsMm.x,
      v7WithV2.floors[crown.floorId].boundsMm.height), clearanceMm: 400 }

  return { migrated: v7WithV2, oldCluster, oldManagedProps }
}

describe('island-surface-dressing@1 v8 rule-backed post-generation preset', () => {
  it('plans full-crown fixed-variant vegetation and rejects an over-budget adoption atomically', () => {
    const before = cloneJson(scene), plan = buildIslandSurfaceDressingCommandsV1(scene, { nextId: ids(), appearance })
    expect(plan.version).toBe(ISLAND_SURFACE_DRESSING_PRESET_V1)
    expect(plan.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plan.commands.filter(command => command.type === 'paintSurfaceVegetation')).toHaveLength(3)
    expect(plan.commands.filter(command => command.type === 'paintSurfaceMaterial')).toHaveLength(1)
    expect(plan.commands.some(command => command.type === 'addProp')).toBe(false)
    expect(plan.commands.some(command => command.type === 'updateTerrainConnection')).toBe(true)
    expect(plan.commands.some(command => command.type === 'upsertVisualEdgeLook')).toBe(true)
    expect(plan.commands.some(command => command.type === 'createDecorationCluster')).toBe(true)
    expect(plan.commands.find(command => command.type === 'paintSurfaceMaterial')).toMatchObject({
      type: 'paintSurfaceMaterial', supportRef: { kind: 'terrainArea', id: 'terrain-high' },
      paint: { materialRef: { id: SHORE_MATERIAL_IDS.grass, version: 1 }, tileSizeMm: { width: 3000, height: 3000 }, alignment: 'world' },
      blendWidthMm: 320,
    })
    expect(plan.commands.findIndex(command => command.type === 'paintSurfaceVegetation'))
      .toBeLessThan(plan.commands.findIndex(command => command.type === 'createDecorationCluster'))
    let after: SceneDocument
    try { after = applyCommands(scene, plan.commands, context('member-rules-v3'), { appearance }) }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/256/)
      expect(canonicalJson(scene)).toBe(canonicalJson(before))
      return
    }
    expect(canonicalJson(scene)).toBe(canonicalJson(before))
    expect(after.schemaVersion).toBe(1)
    expect(after.terrainAreas).toEqual(scene.terrainAreas)
    expect(after.paths).toEqual(scene.paths)
    expect(after.constraints).toEqual(scene.constraints)
    for (const [id, prop] of Object.entries(scene.props)) expect(after.props[id]).toEqual(prop)
    const materialRule = Object.values(after.surfaceRules ?? {}).find(rule => rule.field === 'material')
    expect(materialRule).toMatchObject({ field: 'material', supportRef: { kind: 'terrainArea', id: 'terrain-high' }, blendWidthMm: 320,
      paint: { materialRef: { id: SHORE_MATERIAL_IDS.grass, version: 1 }, tileSizeMm: { width: 3000, height: 3000 }, alignment: 'world' } })
    expect(materialRule?.regionsMm).toEqual([{ outerMm: terrainPoints(after.terrainAreas['terrain-high']), holesMm: [] }])
    const rules = Object.values(after.surfaceRules ?? {}).filter(rule => rule.field !== 'material')
    expect(rules.map(rule => rule.field).sort()).toEqual(['grass', 'shrubs', 'trees'])
    const expectedVariant: Record<Exclude<SurfaceRuleField, 'material'>, string> = {
      trees: 'tree-wind-oak', shrubs: 'shrub-heath-mound', grass: 'grass-sedge-fan',
    }
    for (const rule of rules) {
      expect(rule.supportRef.kind).toBe('terrainArea')
      expect(rule.regionsMm.length).toBeGreaterThan(0)
      expect(rule.regionsMm).toEqual([{ outerMm: terrainPoints(after.terrainAreas[rule.supportRef.id]), holesMm: [] }])
      expect(rule.regionsMm.every(region => polygonInside(region.outerMm, terrainPoints(after.terrainAreas[rule.supportRef.id])))).toBe(true)
      const cluster = after.decorationClusters![rule.clusterId]
      const spec = TERRAIN_VARIANT_SPECS.find(row => row.key === expectedVariant[rule.field])!
      expect(cluster.palette).toEqual([{ key: spec.key, definitionRef: { id: spec.definitionId, version: 1 }, kind: rule.field === 'trees' ? 'prop' : 'decoration', weight: 1 }])
      const actual = Object.values(cluster.members).filter(member => member.entityId && member.state === 'managed').length
      expect(actual, rule.field).toBeGreaterThan(0)
      if (rule.field === 'trees') expect(actual).toBeGreaterThanOrEqual(2)
    }
    const stair = Object.values(after.terrainConnections).find(connection => connection.route?.segments.some(segment => segment.id.startsWith('island-dressing-v2-')))
    expect(stair?.route?.stairStyle).toBe('naturalRock')
    expect(hasIslandSurfaceDressingV1(after)).toBe(true)
    const validation = validateSceneDocument(after)
    expect(validation.ok, validation.ok ? '' : JSON.stringify(validation.errors)).toBe(true)
    const projected = projectScene(after, 'player')
    expect(projected.terrain.find(row => row.id === materialRule!.supportRef.id)?.materialPatches).toHaveLength(1)
  }, 60000)

  it('preserves existing material coverage when the remaining vegetation candidate exceeds budget', () => {
    const first = buildIslandSurfaceDressingCommandsV1(scene, { nextId: ids('material-source'), appearance })
    const material = first.commands.find((command): command is Extract<SceneCommand, { type: 'paintSurfaceMaterial' }> => command.type === 'paintSurfaceMaterial')!
    material.paint.rotationDeg = 37
    const painted = applyCommands(scene, [material], context('manual-ground'), { appearance })
    const priorRule = cloneJson(painted.surfaceRules![material.id])
    const next = buildIslandSurfaceDressingCommandsV1(painted, { nextId: ids('ground-preserved'), appearance })
    expect(next.commands.some(command => command.type === 'paintSurfaceMaterial')).toBe(false)
    expect(next.report).toContain('保留已有地表材质规则')
    const beforeAdoption = canonicalJson(painted)
    let after: SceneDocument
    try { after = applyCommands(painted, next.commands, context('ground-preserved-members'), { appearance }) }
    catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/256/)
      expect(canonicalJson(painted)).toBe(beforeAdoption)
      return
    }
    expect(after.surfaceRules![material.id]).toEqual(priorRule)
    expect(after.terrainAreas).toEqual(scene.terrainAreas)
  }, 60000)

  it('keeps an existing tree rule and its managed members when filling uncovered fields', () => {
    const first = buildIslandSurfaceDressingCommandsV1(scene, { nextId: ids('tree-source'), appearance })
    const tree = first.commands.find((command): command is Extract<SceneCommand, { type: 'paintSurfaceVegetation' }> => command.type === 'paintSurfaceVegetation' && command.field === 'trees')!
    tree.seed = 'manual-tree-rule'
    const withTreeRule = applyCommands(scene, [tree], context('manual-tree-members'), { appearance })
    const beforeRule = cloneJson(withTreeRule.surfaceRules![tree.id])
    const beforeCluster = cloneJson(withTreeRule.decorationClusters![tree.clusterId])
    const next = buildIslandSurfaceDressingCommandsV1(withTreeRule, { nextId: ids('fill-uncovered'), appearance })
    expect(next.commands.filter((command): command is Extract<SceneCommand, { type: 'paintSurfaceVegetation' }> => command.type === 'paintSurfaceVegetation').map(command => command.field))
      .not.toContain('trees')
    expect(next.commands.some(command => command.type === 'paintSurfaceMaterial')).toBe(true)
    const after = applyCommands(withTreeRule, next.commands, context('fill-uncovered-members'), { appearance })
    expect(after.surfaceRules![tree.id]).toEqual(beforeRule)
    expect(after.decorationClusters![tree.clusterId]).toEqual(beforeCluster)
    for (const member of Object.values(beforeCluster.members)) if (member.entityId) expect(after.props[member.entityId]).toEqual(withTreeRule.props[member.entityId])
  }, 60000)

  it('preserves existing managed trees when an uncovered region generates no candidates', async () => {
    const { migrated, oldCluster, oldManagedProps } = await migratedIslandWithBlockedTreeRemainder()
    const migratedRule = Object.values(migrated.surfaceRules ?? {}).find(rule => rule.field === 'trees')!
    if (migratedRule.field === 'material') throw new Error('岩岛回归夹具缺少迁移后的树木规则。')
    expect(migratedRule.clusterId).toBe(oldCluster.id)
    const beforeRule = cloneJson(migratedRule), beforeCluster = cloneJson(migrated.decorationClusters![oldCluster.id])
    const beforeTrees = Object.fromEntries(oldManagedProps.map(id => [id, cloneJson(migrated.props[id])]))
    const plan = buildIslandSurfaceDressingCommandsV1(migrated, { nextId: ids('after-v7-migration'), appearance })
    expect(plan.commands.filter((command): command is Extract<SceneCommand, { type: 'paintSurfaceVegetation' }> => command.type === 'paintSurfaceVegetation').map(command => command.field))
      .not.toContain('trees')
    expect(plan.report).toContain('trees、shrubs、grass区域无可用候选')
    expect(plan.report).not.toMatch(/新增植被规则：[^；]*trees/)
    const after = applyCommands(migrated, plan.commands, context('after-v7-migration-members'), { appearance })
    expect(after.surfaceRules![migratedRule.id]).toEqual(beforeRule)
    expect(after.decorationClusters![oldCluster.id]).toEqual(beforeCluster)
    for (const id of oldManagedProps) expect(after.props[id]).toEqual(beforeTrees[id])
  }, 60000)

  it('has deterministic source identity and channel seeds independent of ID allocation and record insertion order', () => {
    const first = buildIslandSurfaceDressingCommandsV1(scene, { nextId: ids('first'), appearance })
    const reordered = cloneJson(scene)
    reordered.terrainAreas = Object.fromEntries(Object.entries(reordered.terrainAreas).reverse())
    reordered.terrainConnections = Object.fromEntries(Object.entries(reordered.terrainConnections).reverse())
    const second = buildIslandSurfaceDressingCommandsV1(reordered, { nextId: ids('second'), appearance })
    expect(second.sourceHash).toBe(first.sourceHash)
    const seeds = (plan: typeof first) => plan.commands.filter((command): command is Extract<SceneCommand, { type: 'paintSurfaceVegetation' }> => command.type === 'paintSurfaceVegetation')
      .map(command => command.seed).sort()
    expect(seeds(second)).toEqual(seeds(first))
  })

  it('reuses an existing v2 route, preserves it on budget rejection, and rejects a user-owned route', () => {
    const v2 = buildIslandDressingCommandsV2(scene, { nextId: ids('v2'), appearance })
    const withV2Route = applyCommands(scene, v2.commands, context('member-v2'), { appearance })
    const existingRoute = cloneJson(withV2Route.terrainConnections['terrain-stairs'].route)
    const beforeReusePlan = canonicalJson(withV2Route)
    const next = buildIslandSurfaceDressingCommandsV1(withV2Route, { nextId: ids('reuse'), appearance })
    expect(canonicalJson(withV2Route)).toBe(beforeReusePlan)
    expect(next.commands.some(command => command.type === 'updateTerrainConnection')).toBe(false)
    const repeated = cloneJson(withV2Route), priorCluster = Object.values(repeated.decorationClusters ?? {})[0]
    if (!priorCluster) throw new Error('岩岛回归夹具缺少已有布景簇。')
    priorCluster.seed = `${ISLAND_SURFACE_DRESSING_PRESET_V1}/already-applied`
    expect(() => buildIslandSurfaceDressingCommandsV1(repeated, { nextId: ids('repeat'), appearance })).toThrow(/不能重复追加/)
    const afterReuse = applyCommands(withV2Route, next.commands, context('member-reuse-v3'), { appearance })
    expect(afterReuse.terrainConnections['terrain-stairs'].route).toEqual(existingRoute)

    const manual = cloneJson(withV2Route)
    manual.terrainConnections['terrain-stairs'].route!.segments[0].id = 'hand-authored-stair-route'
    expect(() => buildIslandSurfaceDressingCommandsV1(manual, { nextId: ids('manual'), appearance })).toThrow(/已有人工路线/)
  }, 60000)
})
