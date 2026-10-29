import { describe, expect, it } from 'vitest'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyVisualSystem } from '../visual/types.js'
import { emptyTerrainDocument } from '../terrain-generation/compose.js'
import { generationInputHash, managedOutputHash } from '../terrain-generation/integrity.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { applyCommands, applySnapshotCommands, type SceneCommand } from './commands.js'

let token = 0
const runtime = () => ({ ids: { nextId: () => `budget-token-${++token}` }, clock: { now: () => '2026-10-26T00:00:00.000Z' } })
function scene(version: 1 | 2 | 3 = 3): SceneDocument {
  const source: SceneDocument = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 2, visual: emptyVisualSystem() }
  if (version === 1) { source.schemaVersion = 1; delete source.visual }
  return version === 3 ? emptyTerrainDocument(source) : source
}
function managedScene(): SceneDocument {
  const source = scene(), generation = getLegacyGeneration(source)!, floorId = source.props.item.floorId, layerId = source.entityLayers.item
  generation.recipes.recipe = { id: 'recipe', recipeVersion: 1, algorithmId: 'budget-test', algorithmVersion: 1, mapMode: 'scene', seed: 'budget',
    parameters: { terrainKind: 'island', seaElevationMm: 0, landElevationMm: 800, plateauElevationMm: 2600, roughness: 0, densityFactor: 0, baySide: 'north' },
    materials: [], props: [], precision: { sampleSpacingMm: 1000, toleranceMm: 50, noiseCellMm: 2000 } }
  const target = { kind: 'prop' as const, entityId: 'item', parentId: null, fieldGroup: 'geometry' as const }
  generation.rules.rule = { id: 'rule', floorId, layerId, visibility: 'public', editLocked: false, kind: 'terrain', recipeRef: { id: 'recipe', version: 1 },
    inputs: [], outputs: [target], parameters: { widthMm: 200, minWidthMm: 200, maxWidthMm: 200, roughness: 0, densityFactor: 0 },
    state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  generation.ownership.owner = { id: 'owner', outputKey: 'budget/item', ruleId: 'rule', target,
    managedFields: ['geometry', 'properties'], manualFields: [], state: 'managed', birthToken: 'budget-birth' }
  generation.rules.rule.inputHash = generationInputHash(source, generation.rules.rule)
  generation.rules.rule.managedOutputHash = managedOutputHash(source, generation.rules.rule)
  expect(validateSceneDocument(source).ok).toBe(true)
  return source
}
const noop = (source: SceneDocument): SceneCommand => ({ type: 'updateProp', id: 'item', changes: { positionMm: cloneJson(source.props.item.positionMm) } })
const lock = (locked: boolean): SceneCommand => ({ type: 'setEditLock', kind: 'prop', id: 'item', locked })
function area(source: SceneDocument): SceneCommand {
  return { type: 'createTerrainArea', id: 'cost-area', floorId: source.props.item.floorId, layerId: source.entityLayers.item, surfaceStyle: null,
    boundaryMm: Array.from({ length: 20 }, (_, index) => ({ x: Math.round(13000 + 2000 * Math.cos(index * Math.PI / 10)),
      y: Math.round(13000 + 2000 * Math.sin(index * Math.PI / 10)) })) }
}

describe('native-v3 cumulative actual command budget', () => {
  it('adds preceding no-ops to a real terrain point/segment expansion at exactly 256 and rejects 257 atomically', () => {
    const source = scene(), create = area(source), standalone = applyCommands(source, [create], runtime())
    const actual = terrainCommandCost(source, standalone).total
    expect(actual).toBe(41)
    const accepted = Array.from({ length: 256 - actual }, () => noop(source))
    expect(applyCommands(source, [...accepted, create], runtime()).terrainAreas['cost-area']).toBeDefined()
    const before = canonicalJson(source)
    expect(() => applyCommands(source, [...accepted, noop(source), create], runtime())).toThrow(/256/)
    expect(canonicalJson(source)).toBe(before)
  })

  it('keeps earlier real edits charged when later commands return to the original document', () => {
    const source = scene(), create = area(source)
    // Create/remove each expands 41 records. The final document has no area.
    const remove: SceneCommand = { type: 'deleteOutdoorEntity', kind: 'terrainArea', id: 'cost-area' }
    const leading = Array.from({ length: 175 }, () => noop(source))
    expect(() => applyCommands(source, [...leading, create, remove], runtime())).toThrow(/256/)
    expect(Object.keys(source.terrainAreas)).toEqual([])
  })

  it('charges manual generation reconciliation in addition to preceding lock no-ops', () => {
    const source = managedScene(), locked = applyCommands(source, [lock(true)], runtime())
    const actual = terrainCommandCost(source, locked).total
    // Physical prop + owner record + rule record + its output reference.
    expect(actual).toBe(4)
    expect(getLegacyGeneration(locked)!.ownership.owner).toMatchObject({ state: 'manual', manualFields: ['properties'] })
    const accepted = Array.from({ length: 256 - actual }, () => lock(false))
    expect(applyCommands(source, [...accepted, lock(true)], runtime()).props.item.editLocked).toBe(true)
    expect(() => applyCommands(source, [...accepted, lock(false), lock(true)], runtime())).toThrow(/256/)
    expect(source.props.item.editLocked).toBe(false)
  })

  it('charges lock/unlock transitions individually even when the final physical lock matches the baseline', () => {
    const source = managedScene(), accepted = Array.from({ length: 251 }, () => lock(false)), observed: boolean[] = []
    const next = applyCommands(source, [...accepted, lock(true), lock(false)], runtime(), { onSceneDraft: draft => { observed.push(draft.props.item.editLocked) } })
    expect(next.props.item.editLocked).toBe(false)
    expect(getLegacyGeneration(next)!.ownership.owner.state).toBe('manual')
    expect(observed).toHaveLength(253); expect(observed.slice(-2)).toEqual([true, false])
    expect(() => applyCommands(source, [...accepted, lock(false), lock(true), lock(false)], runtime())).toThrow(/256/)
  })

  it('accepts 256 repeated no-op requests and preserves immutable no-op snapshot identity', () => {
    const source = scene(), repeated = Array.from({ length: 256 }, () => noop(source))
    expect(applyCommands(source, repeated, runtime())).toEqual(source)
    const snapshot = applySnapshotCommands(source, [], runtime())
    expect(applySnapshotCommands(snapshot, repeated, runtime())).toBe(snapshot)
    expect(applyCommands(source, Array.from({ length: 256 }, () => lock(false)), runtime())).toEqual(source)
  })

  it.each([1, 2] as const)('retains prior native-v%s no-op expansion semantics', version => {
    const source = scene(version), create = area(source)
    // Legacy branches historically charge these update no-ops zero; only v3
    // adds their request cost to the independently expanded terrain command.
    expect(applyCommands(source, [...Array.from({ length: 250 }, () => noop(source)), create], runtime()).terrainAreas['cost-area']).toBeDefined()
  })
})
