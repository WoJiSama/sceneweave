import { getLegacyGeneration } from './composition-contracts.js'
import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { applyBuildingCommand, type BuildingCommand } from '../commands/building.js'
import { applyOutdoorCommand, type OutdoorCommand } from '../commands/outdoor.js'
import { applyCommands } from '../commands/commands.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { composeTerrainDocument } from './compose.js'
import { generateTerrainDocument } from './generate.js'
import { prepareTerrainEdit, terrainEditRequestSchema } from './edit.js'
import { canRegenerateProp, surroundingsEntityHash, surroundingsOutputHash, surroundingsRequestSchema } from './surroundings.js'
import { terrainPoints } from '../geometry/geometry.js'

const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
const context = { ids: { nextId: (() => { let index = 0; return () => `fixture-id-${index++}` })() }, clock: { now: () => '2026-10-27T00:00:00.000Z' } }

function makeFixture() {
  const base = createRefinedBlankDocument('island', { sceneId: 'surroundings-fixture', title: 'T-S06建筑周边', widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-10-27T00:00:00.000Z' })
  const result = generateTerrainDocument(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0' })
  const draft = result.document
  const low = terrainPoints(draft.terrainAreas['terrain-low']), cx = Math.round(low.reduce((sum, point) => sum + point.x, 0) / low.length), cy = Math.round(low.reduce((sum, point) => sum + point.y, 0) / low.length)
  const rooms: BuildingCommand[] = [
    { type: 'createRoom', id: 'outpost-west', floorId: 'visual-floor', boundaryMm: [{ x: cx - 700, y: cy - 700 }, { x: cx, y: cy - 700 }, { x: cx, y: cy + 700 }], thicknessMm: 240, purpose: '西侧值守房', supportRef: { kind: 'terrainArea', id: 'terrain-low' } },
    { type: 'createRoom', id: 'outpost-east', floorId: 'visual-floor', boundaryMm: [{ x: cx, y: cy - 700 }, { x: cx + 700, y: cy - 700 }, { x: cx, y: cy + 700 }], thicknessMm: 240, purpose: '东侧储藏房', supportRef: { kind: 'terrainArea', id: 'terrain-low' } },
  ]
  for (const command of rooms) applyBuildingCommand(draft, command)
  const shared = Object.values(draft.walls).find(wall => {
    const a = draft.vertices[wall.startVertexId], b = draft.vertices[wall.endVertexId]
    return !!a && !!b && a.xMm === cx && b.xMm === cx && a.yMm !== b.yMm
  })
  if (!shared) throw new Error(`fixture shared wall missing: ${Object.values(draft.walls).map(w => { const a=draft.vertices[w.startVertexId], b=draft.vertices[w.endVertexId]; return `${a?.xMm},${a?.yMm}-${b?.xMm},${b?.yMm}` }).join('|')}`)
  const path: OutdoorCommand = { type: 'createPath', id: 'outpost-yard-path', floorId: 'visual-floor', layerId: 'visual-layer-ground', centerlineMm: [{ x: cx - 500, y: cy }, { x: cx + 500, y: cy }], widthMm: 1000, supportRefs: [{ kind: 'terrainArea', id: 'terrain-low' }] }
  const complete = composeTerrainDocument(base, { ...result, document: draft }, 't-s06-fixture').document
  applyBuildingCommand(complete, { type: 'addOpening', id: 'outpost-door', wallId: shared.id, offsetReferenceVertexId: shared.startVertexId, offsetMm: 100, widthMm: 1000, kind: 'door', state: 'open', locked: false })
  applyOutdoorCommand(complete, path, context)
  if (complete.generation) for (const check of Object.values(getLegacyGeneration(complete)!.checks)) check.state = 'unchecked'
  const validation = validateSceneDocument(complete)
  if (!validation.ok) throw new Error(validation.errors.map(issue => `${issue.entityId ?? ''}:${issue.message}`).join('; '))
  return complete
}

function request(scene: ReturnType<typeof makeFixture>, overrides: Partial<Record<'regenerateScenery' | 'seed' | 'maxDisplacementMm' | 'boundaryIds' | 'scopeMm', unknown>> = {}) {
  return surroundingsRequestSchema.parse({ kind: 'surroundings', sceneId: scene.sceneId, operationId: 's06-surroundings', floorId: 'visual-floor', scopeMm: { x: 0, y: 0, width: 24000, height: 18000 }, linkMode: 'scenery', seed: 's06-seed', maxDisplacementMm: 10, boundaryIds: ['terrain-high-curve'], regenerateScenery: true, ...overrides })
}

describe('T-S06 existing-building surroundings regeneration', () => {
  it('builds real shared-wall, open-door and yard-path geometry before composing v3', () => {
    const scene = makeFixture(), shared = scene.walls[scene.openings['outpost-door'].wallId]
    expect(shared).toBeDefined()
    expect(Object.values(scene.rooms)).toHaveLength(2)
    expect(Object.values(scene.openings)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'outpost-door', wallId: shared!.id, state: 'open', locked: false })]))
    expect(scene.paths['outpost-yard-path'].supportRefs).toEqual([{ kind: 'terrainArea', id: 'terrain-low' }])
  })

  it('preserves rooms, shared wall, door and yard path with exact hashes and cold validation', () => {
    const scene = makeFixture(), before = canonicalJson(scene), result = prepareTerrainEdit(scene, request(scene)), next = result.document
    for (const collection of ['rooms', 'walls', 'openings', 'paths'] as const) for (const row of Object.values(scene[collection])) expect(surroundingsEntityHash(next, collection, row.id)).toBe(surroundingsEntityHash(scene, collection, row.id))
    expect(next.generation?.version).toBe(3)
    if (next.generation?.version !== 3) throw new Error('fixture surroundings missing')
    const current = Object.values(next.generation!.surroundings).find(row => row.state === 'current')!
    expect(current.preserved.some(row => row.collection === 'rooms' && row.entityId === 'outpost-west')).toBe(true)
    expect(current.outputHash).toBe(surroundingsOutputHash(next, current))
    expect(validateSceneDocument(JSON.parse(canonicalJson(next))).ok).toBe(true)
    expect(canonicalJson(scene)).toBe(before)
  })

  it('keeps manual, locked, deleted and paused props out of automatic scenery changes', () => {
    const scene = makeFixture(), ids = Object.values(scene.props).map(prop => prop.id), [manualId, lockedId, deletedId, pausedId] = ids
    if (!manualId || !lockedId || !deletedId || !pausedId) throw new Error('fixture needs four props')
    const manualPosition = { ...scene.props[manualId].positionMm, x: scene.props[manualId].positionMm.x + 10 }
    let manual = applyCommands(scene, [{ type: 'updateProp', id: manualId, changes: { positionMm: manualPosition } }, { type: 'deleteProp', id: deletedId }], context)
    manual = applyCommands(manual, [{ type: 'setEditLock', kind: 'prop', id: lockedId, locked: true }], context)
    const pausedOwner = Object.values(getLegacyGeneration(manual)!.ownership).find(row => row.target.entityId === pausedId)!
    expect(getLegacyGeneration(manual)!.rules[pausedOwner.ruleId].state).toBe('paused')
    expect(canRegenerateProp(manual, manual.props[manualId])).toBe(false)
    expect(canRegenerateProp(manual, manual.props[lockedId])).toBe(false)
    expect(canRegenerateProp(manual, manual.props[pausedId])).toBe(false)
    expect(() => prepareTerrainEdit(manual, request(manual, { regenerateScenery: true }))).toThrow(/没有可重生成|保持/)
    expect(manual.props[manualId].positionMm).toEqual(manualPosition)
    expect(manual.props[lockedId].editLocked).toBe(true)
    expect(manual.props[deletedId]).toBeUndefined()
    expect(manual.props[pausedId]).toBeDefined()
  })

  it('does not move any prop when scenery regeneration is declined and is deterministic across clones', () => {
    const scene = makeFixture(), first = prepareTerrainEdit(scene, request(scene)), second = prepareTerrainEdit(cloneJson(scene), request(scene))
    expect(canonicalJson(second.document)).toBe(canonicalJson(first.document))
    expect(() => prepareTerrainEdit(scene, request(scene, { regenerateScenery: false }))).toThrow(/没有可重生成/)
  })

  it('rejects duplicate or overlong boundaries, invalid scopes and preservation overflow atomically', () => {
    const scene = makeFixture(), before = canonicalJson(scene)
    expect(() => prepareTerrainEdit(scene, request(scene, { boundaryIds: ['terrain-high-curve', 'terrain-high-curve'] }))).toThrow()
    expect(() => prepareTerrainEdit(scene, request(scene, { boundaryIds: Array.from({ length: 33 }, (_, index) => `boundary-${index}`) }))).toThrow()
    expect(() => prepareTerrainEdit(scene, request(scene, { scopeMm: { x: 0, y: 0, width: 100, height: 100 } }))).toThrow()
    const many = cloneJson(scene)
    for (let index = 0; index < 257; index++) {
      const id = `fixture-note-${index}`
      many.notes[id] = { id, floorId: 'visual-floor', visibility: 'public', editLocked: false, anchor: { type: 'point', positionMm: { x: 1000 + index, y: 1000 } }, kind: 'note', text: '预算负例' }
      many.entityLayers[id] = 'visual-layer-details'
    }
    expect(validateSceneDocument(many).ok).toBe(true)
    expect(() => prepareTerrainEdit(many, request(many))).toThrow(/256|保全/)
    expect(canonicalJson(scene)).toBe(before)
  })
})
