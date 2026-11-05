import { beforeAll, describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { applyCommands } from '../commands/commands.js'
import { polygonDistance } from '../geometry/geometry.js'
import type { SceneDocument } from '../model/scene.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { generateTerrainDocumentV5 } from '../terrain-generation/surface-generation.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { TERRAIN_VARIANT_DEFINITION_IDS } from '../visual/terrain-variant-specs.js'
import { buildDecorationRegeneration, decorationProtectedGeometry } from './generate.js'
import { conservativePropPaintEnvelope, decorationAsProp } from './geometry.js'
import { buildIslandDressingCommands, hasGeneratedIslandBase, ISLAND_DRESSING_PRESET } from './island-dressing.js'

const ids = (prefix = 'island-dressing-command') => { let serial = 0; return () => `${prefix}-${++serial}` }
const context = () => ({ ids: { nextId: ids('island-dressing-member') }, clock: { now: () => '2026-11-02T00:00:00.000Z' } })
let ordinary: SceneDocument, complete: SceneDocument

beforeAll(() => {
  const base = createShoreBlankDocument('island', { sceneId: 'island-dressing-unit', title: 'Actual island5 geometry', now: '2026-11-02T00:00:00.000Z',
    widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const result = generateTerrainDocumentV5(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000,
    algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
  ordinary = composeTerrainDocument(base, result, 'island-dressing-birth', TASK_BUDGET_PROFILES.standard).document
  // Geometry fixture only; real complete-copy/source/PNG/license preparation is owned by application/browser tests.
  complete = { ...emptyCompositionDocument(ordinary), schemaVersion: 1, decorations: {}, decorationClusters: {} }
  const catalog = createTerrainVariantCatalogDocument()
  Object.assign(complete.assets, catalog.assets); Object.assign(complete.propDefinitions, catalog.propDefinitions)
  const checked = validateSceneDocument(complete)
  if (!checked.ok) throw new Error(checked.errors.map(row => `${row.entityId ?? ''}:${row.code}`).join('; '))
  complete = checked.document
}, 60000)

describe('island-dressing@1 explicit post-generation preset', () => {
  it('selects real public island5 supports across complete3–6 and keeps other algorithms and terrain kinds ineligible', () => {
    expect(hasGeneratedIslandBase(ordinary)).toBe(true)
    const v4 = emptyCompositionDocument(ordinary)
    expect(hasGeneratedIslandBase(v4)).toBe(true)
    expect(hasGeneratedIslandBase({ ...v4, schemaVersion: 1 })).toBe(true)
    expect(hasGeneratedIslandBase(complete)).toBe(true)
    for (const edit of [
      (scene: SceneDocument) => { scene.mapMode = 'regional' },
      (scene: SceneDocument) => { getLegacyGeneration(scene)!.recipes['terrain-recipe'].algorithmVersion = 4 },
      (scene: SceneDocument) => { const recipe = getLegacyGeneration(scene)!.recipes['terrain-recipe']; if (!('domain' in recipe)) recipe.parameters.terrainKind = 'coast' },
      (scene: SceneDocument) => { getLegacyGeneration(scene)!.recipes['terrain-recipe'].algorithmId = 'terrain-compose' },
      (scene: SceneDocument) => { getLegacyGeneration(scene)!.rules['terrain-rule'].state = 'paused' },
    ]) {
      const scene = cloneJson(complete); edit(scene)
      expect(hasGeneratedIslandBase(scene)).toBe(false)
      expect(() => buildIslandDressingCommands(scene, { nextId: ids() })).toThrow()
    }
    expect(buildIslandDressingCommands(ordinary, { nextId: ids() }).commands.length).toBeGreaterThan(0)
  })

  it('plans stable explicit mixed/light palettes without mutating the island or requiring resource metadata to be premerged', () => {
    const scene = cloneJson(complete), before = canonicalJson(scene)
    const plan = buildIslandDressingCommands(scene, { nextId: ids() })
    expect(plan.version).toBe(ISLAND_DRESSING_PRESET)
    expect(plan.commands).toHaveLength(2)
    const [crown, lower] = plan.commands
    expect(scene.terrainAreas[crown.supportRef.id].groundElevationMm).toBeGreaterThan(scene.terrainAreas[lower.supportRef.id].groundElevationMm)
    expect(crown.palette.map(row => row.definitionRef.id)).toEqual(TERRAIN_VARIANT_DEFINITION_IDS)
    expect(crown.palette.some(row => row.kind === 'prop')).toBe(true)
    expect(crown.palette.some(row => row.kind === 'decoration')).toBe(true)
    expect(lower.palette.every(row => row.kind === 'decoration' && !scene.propDefinitions[row.definitionRef.id].defaultBlocksMovement && !scene.propDefinitions[row.definitionRef.id].defaultBlocksSight)).toBe(true)
    expect(plan.commands.map(row => row.maxInstances)).toEqual([14, 20])
    expect(plan.commands.every(row => row.spacingMm === 350 && row.clusterRadiusMm === 3600 && row.clearanceMm === 400 && row.visibility === 'public')).toBe(true)
    expect(plan.commands.every(row => row.seed.startsWith(`${ISLAND_DRESSING_PRESET}/`) && row.seed.length <= 128)).toBe(true)
    expect(plan.report).toContain('上限14'); expect(plan.report).toContain('上限20'); expect(plan.report).toContain('实际数量')
    const reordered = cloneJson(scene)
    reordered.terrainAreas = Object.fromEntries(Object.entries(reordered.terrainAreas).reverse())
    expect(buildIslandDressingCommands(reordered, { nextId: ids() })).toEqual(plan)
    const awaitingCatalog = cloneJson(scene)
    for (const id of TERRAIN_VARIANT_DEFINITION_IDS) delete awaitingCatalog.propDefinitions[id]
    expect(buildIslandDressingCommands(awaitingCatalog, { nextId: ids() })).toEqual(plan)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('adds real bounded clusters through existing commands while preserving every existing prop, terrain and stair', () => {
    const scene = cloneJson(complete), before = cloneJson(scene), plan = buildIslandDressingCommands(scene, { nextId: ids() })
    const after = applyCommands(scene, plan.commands, context())
    expect(canonicalJson(scene)).toBe(canonicalJson(before))
    expect(after.terrainAreas).toEqual(before.terrainAreas)
    expect(after.terrainConnections).toEqual(before.terrainConnections)
    expect(after.paths).toEqual(before.paths)
    for (const [id, prop] of Object.entries(before.props)) expect(after.props[id]).toEqual(prop)
    for (const command of plan.commands) {
      const cluster = after.decorationClusters![command.id], actual = Object.values(cluster.members).filter(row => row.entityId)
      expect(actual.length).toBeGreaterThan(0); expect(actual.length).toBeLessThanOrEqual(command.maxInstances)
      expect(cluster.supportRef).toEqual(command.supportRef)
      expect(cluster.palette).toEqual(command.palette)
      for (const member of actual) {
        const prop = member.kind === 'prop' ? after.props[member.entityId!] : decorationAsProp(after, after.decorations![member.entityId!])
        expect(decorationProtectedGeometry(after, cluster).every(record => polygonDistance(conservativePropPaintEnvelope(prop), record.polygon) >= record.marginMm)).toBe(true)
      }
    }
    expect(validateSceneDocument(after).ok).toBe(true)
  })

  it('refuses repeat palette/support/seed even after ID changes and manual edits, and does not infer duplicates from IDs', () => {
    const plan = buildIslandDressingCommands(complete, { nextId: ids() }), after = applyCommands(complete, plan.commands, context())
    const renamed = cloneJson(after)
    for (const old of Object.values(renamed.decorationClusters!)) {
      const id = `renamed-${old.id}`, member = Object.values(old.members).find(row => row.entityId)
      if (member) member.state = 'manual'
      delete renamed.decorationClusters![old.id]
      renamed.decorationClusters![id] = { ...old, id, palette: [...old.palette].reverse() }
      renamed.entityLayers[id] = renamed.entityLayers[old.id]; delete renamed.entityLayers[old.id]
    }
    expect(() => buildIslandDressingCommands(renamed, { nextId: ids('new') })).toThrow(/相同布景配方/)
    for (const cluster of Object.values(renamed.decorationClusters!)) cluster.seed = 'explicitly-different-existing-cluster'
    expect(buildIslandDressingCommands(renamed, { nextId: ids('new') }).commands).toHaveLength(2)
  })

  it('ignores unowned/private terrain and private blockers when choosing or generating public dressing', () => {
    const original = buildIslandDressingCommands(complete, { nextId: ids() }), scene = cloneJson(complete)
    const publicSupport = scene.terrainAreas[original.commands[0].supportRef.id]
    scene.terrainAreas['unrelated-highest'] = { ...cloneJson(publicSupport), id: 'unrelated-highest', groundElevationMm: 20000, visibility: 'gm',
      boundaryMm: [{ x: 200, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 600 }, { x: 200, y: 600 }]
        .map((positionMm, index) => ({ id: `private-point-${index}`, segmentId: `private-segment-${index}`, positionMm })) }
    scene.entityLayers['unrelated-highest'] = scene.entityLayers[publicSupport.id]
    scene.regions['private-reservation'] = { id: 'private-reservation', floorId: publicSupport.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [{ x: 2000, y: 2000 }, { x: 22000, y: 2000 }, { x: 22000, y: 16000 }, { x: 2000, y: 16000 }], blocksMovement: true, movementCostMultiplier: 1 }
    scene.entityLayers['private-reservation'] = scene.entityLayers[publicSupport.id]
    expect(buildIslandDressingCommands(scene, { nextId: ids() })).toEqual(original)
    for (const command of original.commands) {
      const { type: _type, layerId: _layer, ...row } = command
      const cluster = { ...row, editLocked: false, algorithmVersion: 'cluster-v1' as const, members: {} }
      expect(buildDecorationRegeneration(scene, cluster, context())).toEqual(buildDecorationRegeneration(complete, cluster, context()))
    }
    const hiddenSupport = cloneJson(complete)
    hiddenSupport.terrainAreas[original.commands[0].supportRef.id].visibility = 'gm'
    expect(hasGeneratedIslandBase(hiddenSupport)).toBe(false)
  })

  it('refuses missing or locked supports/layers, ambiguous sources and reused nested IDs before returning commands', () => {
    const plan = buildIslandDressingCommands(complete, { nextId: ids() }), crown = plan.commands[0].supportRef.id
    for (const edit of [
      (scene: SceneDocument) => { scene.terrainAreas[crown].editLocked = true },
      (scene: SceneDocument) => { scene.userLayers[scene.entityLayers[crown]].editLocked = true },
      (scene: SceneDocument) => { delete scene.terrainAreas[crown] },
      (scene: SceneDocument) => { const generation = getLegacyGeneration(scene)!; generation.rules.extra = { ...cloneJson(generation.rules['terrain-rule']), id: 'extra' } },
    ]) {
      const scene = cloneJson(complete); edit(scene); const before = canonicalJson(scene)
      expect(() => buildIslandDressingCommands(scene, { nextId: ids() })).toThrow()
      expect(canonicalJson(scene)).toBe(before)
    }
    expect(() => buildIslandDressingCommands(complete, { nextId: ids(), layerId: 'missing-layer' })).toThrow(/同Floor/)
    expect(() => buildIslandDressingCommands(complete, { nextId: () => complete.terrainAreas[crown].boundaryMm[0].id })).toThrow(/独立ID/)
    expect(() => buildIslandDressingCommands(complete, { nextId: () => 'same-new-id' })).toThrow(/独立ID/)
  })
})
