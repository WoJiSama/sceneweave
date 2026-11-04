import { describe, expect, it } from 'vitest'
import { applyCommands } from '../commands/commands.js'
import { createTerrainVariantCatalogDocument, terrainVariantDefinitionId } from '../../platform/browser/content/terrain-variant-catalog.js'
import { createEmptyGeneration } from '../terrain-generation/contracts.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import type { PointMm, SceneDocument, SceneDocument8, SurfaceRuleRegion } from '../model/scene.js'
import { polygonBooleanWithHoles } from '../geometry/polygon-boolean.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { estimateSurfaceRegionInstances } from '../decorations/generate.js'
import { applySurfaceRuleCommand, type SurfaceRuleCommand } from './commands.js'
import { resolveSurfaceRules } from './resolve.js'

const p = (x: number, y: number): PointMm => ({ x, y })
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)]
const region = (x: number, y: number, width: number, height: number): SurfaceRuleRegion => ({ outerMm: rect(x, y, width, height), holesMm: [] })
let sequence = 0
const context = () => ({ ids: { nextId: () => `surface-command-${++sequence}` }, clock: { now: () => '2026-11-02T00:00:00.000Z' } })

function fixture(): SceneDocument8 {
  const source = createTerrainVariantCatalogDocument()
  source.schemaVersion = 3; source.mapMode = 'scene'; source.regional = null; source.generation = createEmptyGeneration()
  source.visual = { version: 2, base: emptyVisualSystem(), materializedEdges: {} }
  const scene = emptyCompositionDocument(source)
  scene.schemaVersion = 8
  scene.generation = createEmptyGeneration5()
  scene.visual = { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} }
  scene.mapMode = 'scene'; scene.regional = null
  scene.decorations = {}; scene.decorationClusters = {}; scene.surfaceRules = {}
  const floor = Object.values(scene.floors)[0], layer = Object.values(scene.userLayers)[0]
  floor.boundsMm = { x: 0, y: 0, width: 48000, height: 36000 }
  scene.exportBoundsMm = { x: 0, y: 0, width: 48000, height: 36000 }
  scene.terrainAreas.ground = { id: 'ground', floorId: floor.id, editLocked: false, visibility: 'public', boundaryMm: rect(0, 0, 48000, 36000)
    .map((positionMm, index) => ({ id: `ground-point-${index}`, segmentId: `ground-segment-${index}`, positionMm })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  scene.entityLayers.ground = layer.id
  return scene as SceneDocument8
}

function vegetation(scene: SceneDocument8, args: { id: string; field: 'trees' | 'shrubs' | 'grass'; area: SurfaceRuleRegion; coveragePpm?: number }): SurfaceRuleCommand {
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const tree = scene.propDefinitions[terrainVariantDefinitionId('tree-wind-oak')]
  const shrub = scene.propDefinitions[terrainVariantDefinitionId('shrub-island-heath')]
  const grass = scene.propDefinitions[terrainVariantDefinitionId('grass-sedge-fan')]
  const definition = args.field === 'trees' ? tree : args.field === 'shrubs' ? shrub : grass
  return { type: 'paintSurfaceVegetation', id: `${args.id}-rule`, clusterId: `${args.id}-cluster`, floorId, layerId, visibility: 'public',
    supportRef: { kind: 'terrainArea', id: 'ground' }, regionsMm: [args.area], field: args.field, coveragePpm: args.coveragePpm ?? 0, seed: args.id,
    palette: [{ key: args.field, definitionRef: { id: definition.id, version: definition.version }, kind: args.field === 'trees' ? 'prop' : 'decoration', weight: 1 }],
    spacingMm: 200, clusterRadiusMm: 3000, clearanceMm: 50 }
}

function polygonArea(regions: SurfaceRuleRegion[]): bigint {
  const area2 = (ring: PointMm[]) => ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length]
    return sum + BigInt(point.x) * BigInt(next.y) - BigInt(next.x) * BigInt(point.y)
  }, 0n)
  return regions.reduce((sum, row) => {
    const outer = area2(row.outerMm), outerAbs = outer < 0n ? -outer : outer
    const holes = row.holesMm.reduce((count, ring) => { const value = area2(ring); return count + (value < 0n ? -value : value) }, 0n)
    return sum + (outerAbs - holes) / 2n
  }, 0n)
}

describe('v8 surface-rule command transactions', () => {
  it('lets the newest same-channel rule cover, then local erase reveals the earlier rule', () => {
    const original = fixture(), whole = region(4000, 4000, 16000, 14000), patch = region(9000, 8000, 5000, 5000)
    const base = applyCommands(original, [vegetation(original, { id: 'grass-base', field: 'grass', area: whole })], context())
    const layered = applyCommands(base, [
      vegetation(base as SceneDocument8, { id: 'grass-top', field: 'grass', area: patch }),
      vegetation(base as SceneDocument8, { id: 'tree-overlay', field: 'trees', area: patch }),
    ], context())
    const grassBeforeErase = resolveSurfaceRules(layered).find(row => row.rule.id === 'grass-base-rule')!.regionsMm
    expect(polygonArea(grassBeforeErase)).toBeLessThan(16_000n * 14_000n)
    expect(polygonArea(resolveSurfaceRules(layered).find(row => row.rule.id === 'tree-overlay-rule')!.regionsMm)).toBe(25_000_000n)

    const erased = applyCommands(layered, [{ type: 'eraseSurfaceRules', supportRef: { kind: 'terrainArea', id: 'ground' }, field: 'grass', visibility: 'public', regionsMm: [patch] }], context())
    expect(erased.surfaceRules!['grass-top-rule']).toBeUndefined()
    expect(polygonArea(resolveSurfaceRules(erased).find(row => row.rule.id === 'grass-base-rule')!.regionsMm)).toBe(16_000n * 14_000n)
    expect(erased.surfaceRules!['tree-overlay-rule']).toBeDefined()
    expect(polygonArea(resolveSurfaceRules(erased).find(row => row.rule.id === 'tree-overlay-rule')!.regionsMm)).toBe(25_000_000n)
  })

  it('keeps manually edited and locked members while updating the managed vegetation target', () => {
    const base = fixture(), command = vegetation(base, { id: 'grass-managed', field: 'grass', area: region(2000, 2000, 18000, 15000), coveragePpm: 40_000 })
    const planted = applyCommands(base, [command], context()), cluster = planted.decorationClusters!['grass-managed-cluster']
    const initial = Object.values(cluster.members).filter(member => member.entityId && member.state === 'managed')
    expect(initial.length).toBeGreaterThan(2)
    const manualId = initial[0].entityId!, lockedId = initial[1].entityId!
    const manual = planted.decorations![manualId]
    const edited = applyCommands(planted, [{ type: 'updateDecoration', id: manualId, changes: { positionMm: { x: manual.positionMm.x + 137, y: manual.positionMm.y } } }], context())
    const manuallyEdited = edited.decorations![manualId]
    const locked = applyCommands(edited, [{ type: 'setEditLock', kind: 'decoration', id: lockedId, locked: true }], context())
    const lockedMember = locked.decorations![lockedId]
    const beforeUpdate = cloneJson(locked)
    const updated = applyCommands(locked, [{ type: 'updateSurfaceVegetation', id: 'grass-managed-rule', coveragePpm: 100_000 }], context())
    const nextCluster = updated.decorationClusters!['grass-managed-cluster']

    expect(nextCluster.members[Object.keys(nextCluster.members).find(key => nextCluster.members[key].entityId === manualId)!].state).toBe('manual')
    expect(updated.decorations![manualId]).toEqual(manuallyEdited)
    expect(updated.decorations![lockedId]).toEqual(lockedMember)
    expect(Object.values(nextCluster.members).filter(member => member.entityId && member.state !== 'deleted' && member.state !== 'detached').length).toBeGreaterThan(initial.length)
    expect(locked).toEqual(beforeUpdate)
    expect(updated.surfaceRules!['grass-managed-rule']).toMatchObject({ coveragePpm: 100_000 })
  })

  it('rejects locked support, rule and vegetation cluster edits', () => {
    const base = fixture(), create = vegetation(base, { id: 'grass-locks', field: 'grass', area: region(2000, 2000, 12000, 10000), coveragePpm: 20_000 })
    const lockedSupport = cloneJson(base); lockedSupport.terrainAreas.ground.editLocked = true
    expect(() => applyCommands(lockedSupport, [create], context())).toThrow(/锁/)

    const planted = applyCommands(base, [create], context())
    const lockedRule = applyCommands(planted, [{ type: 'setEditLock', kind: 'surfaceRule', id: 'grass-locks-rule', locked: true }], context())
    expect(() => applyCommands(lockedRule, [{ type: 'updateSurfaceVegetation', id: 'grass-locks-rule', coveragePpm: 50_000 }], context())).toThrow(/锁/)
    const lockedCluster = applyCommands(planted, [{ type: 'setEditLock', kind: 'decorationCluster', id: 'grass-locks-cluster', locked: true }], context())
    expect(() => applyCommands(lockedCluster, [{ type: 'updateSurfaceVegetation', id: 'grass-locks-rule', coveragePpm: 50_000 }], context())).toThrow(/锁/)
  })

  it('refuses to remove a path-anchored tree and preserves a note-anchored tree when its rule reaches zero', () => {
    const base = fixture(), treeRule = vegetation(base, { id: 'tree-dependency', field: 'trees', area: region(5000, 5000, 14000, 12000), coveragePpm: 80_000 })
    const planted = applyCommands(base, [treeRule], context()), cluster = planted.decorationClusters!['tree-dependency-cluster']
    const treeId = Object.values(cluster.members).find(member => member.entityId && member.state === 'managed')?.entityId
    expect(treeId).toBeTruthy()
    const dependent = cloneJson(planted)
    dependent.constraints.pathChecks.push({ id: 'tree-route-check', from: { type: 'entity', entityKind: 'prop', entityId: treeId! },
      to: { type: 'point', positionMm: p(25000, 25000) }, clearanceMm: 1, mode: 'current', assumedOpenDoorIds: [] })
    expect(() => applySurfaceRuleCommand(dependent, { type: 'updateSurfaceVegetation', id: 'tree-dependency-rule', coveragePpm: 0 }, context())).toThrow(/注记或路径依赖/)

    const noted = cloneJson(planted)
    noted.notes['tree-note'] = { id: 'tree-note', floorId: Object.keys(noted.floors)[0], editLocked: false,
      anchor: { type: 'entity', entityKind: 'prop', entityId: treeId! }, kind: 'note', text: 'Keep this tree annotated.', visibility: 'public' }
    noted.entityLayers['tree-note'] = Object.keys(noted.userLayers)[0]
    const afterErase = applyCommands(noted, [{ type: 'updateSurfaceVegetation', id: 'tree-dependency-rule', coveragePpm: 0 }], context())
    expect(afterErase.props[treeId!]).toBeDefined()
    expect(afterErase.notes['tree-note'].anchor).toEqual(noted.notes['tree-note'].anchor)
  })

  it('rejects aggregate expansion above 256 without mutating the caller document', () => {
    const scene = fixture(), original = cloneJson(scene)
    const commands = Array.from({ length: 40 }, (_, index) => vegetation(scene, { id: `budget-rule-${index}`, field: 'grass', area: region(4000, 4000, 16000, 14000) }))
    expect(() => applyCommands(scene, commands, context())).toThrow(/256/)
    expect(scene).toEqual(original)
  })
})
