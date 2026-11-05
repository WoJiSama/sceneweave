import { describe, expect, it } from 'vitest'
import { applyCommands } from '../commands/commands.js'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { createHistoryIdentity, validateHistoryIdentity } from '../history/identity.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import type { SceneDocument } from '../model/scene.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { generationInputHash, managedOutputHash } from './integrity.js'
import type { GenerationReference } from './contracts.js'

const stamp = '2026-11-05T00:00:00.000Z', floorId = 'floor', layerId = 'layer'
let sequence = 0
const runtime = () => ({ ids: { nextId: () => `building-identity-${++sequence}` }, clock: { now: () => stamp } })
const boundary = [{ x: 3000, y: 3000 }, { x: 9000, y: 3000 }, { x: 9000, y: 9000 }, { x: 3000, y: 9000 }]
function generated(): SceneDocument {
  const bounds = { x: 0, y: 0, width: 24000, height: 18000 }
  const source = toCurrentSceneDocument({ format: 'sceneweave-scene', schemaVersion: 1, sceneId: 'building-identity', revision: 0, title: 'Generated building', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false }, exportBoundsMm: bounds,
    floors: { floor: { id: floorId, name: 'Ground', boundsMm: bounds } }, userLayers: { layer: { id: layerId, floorId, name: 'Ground', order: 0, editLocked: false } }, entityLayers: {},
    vertices: {}, rooms: {}, walls: {}, openings: {}, props: {}, regions: {}, notes: {}, assets: {}, propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
    presetSnapshot: { presetId: 'test', presetVersion: 1, distanceMode: 'metric', source: 'original fixture', gridSizeMm: 1000 }, constraints: { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] } })
  const document = applyCommands(source, [{ type: 'createRoom', id: 'bedroom', floorId, layerId, boundaryMm: boundary, thicknessMm: 200 }], runtime())
  const generation = document.generation.legacy
  generation.recipes['building-recipe'] = { id: 'building-recipe', recipeVersion: 2, algorithmId: 'interior-layout', algorithmVersion: 2, domain: 'interior', mapMode: 'scene', seed: 'birth-test',
    parameters: { floorId, layerId, boundsMm: { x: 2000, y: 2000, width: 12000, height: 12000 }, wallThicknessMm: 200,
      rooms: [{ id: 'bedroom', purpose: 'Bedroom', minAreaMm2: 25_000_000, maxAreaMm2: 40_000_000, minClearSideMm: 4500 }], relations: [],
      corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null }, arrangement: { doors: false, entrance: false, furniture: false, doorWidthMm: 1200, clearWidthMm: 1000, palette: [] } },
    materials: [], props: [], precision: { sampleSpacingMm: 1, toleranceMm: 1, noiseCellMm: 1 } }
  const targets: GenerationReference[] = (['rooms', 'walls', 'vertices'] as const).flatMap(collection => Object.keys(document[collection]).map(entityId => ({
    kind: ({ rooms: 'room', walls: 'wall', vertices: 'vertex' } as const)[collection], entityId, parentId: null, fieldGroup: 'geometry',
  })))
  generation.rules['building-rule'] = { id: 'building-rule', floorId, layerId, visibility: 'public', editLocked: false, kind: 'building', recipeRef: { id: 'building-recipe', version: 2 }, inputs: [], outputs: targets,
    parameters: { widthMm: 0, minWidthMm: 0, maxWidthMm: 0, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  targets.forEach((target, index) => {
    const id = `building-owner-${index}`
    generation.ownership[id] = { id, outputKey: `bedroom/${target.kind}/${target.entityId}`, ruleId: 'building-rule', target,
      managedFields: ['geometry', 'properties', 'surface', 'source'], manualFields: [], state: 'managed', birthToken: `output-birth-${index}` }
  })
  const rule = generation.rules['building-rule']; rule.inputHash = generationInputHash(document, rule); rule.managedOutputHash = managedOutputHash(document, rule)
  return document
}
const owner = (scene: SceneDocument, id: string) => Object.values(scene.generation.legacy.ownership).find(row => row.target.entityId === id)!

describe('generated building persistence and native edit continuity', () => {
  it('allocates real generated-only room, wall and shared vertex births at first complete result', () => {
    const document = generated(), identity = createHistoryIdentity(document, runtime())
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(identity.generationTokens!.bedroom.kind).toBe('generatedRoom')
    for (const id of Object.keys(document.walls)) expect(identity.generationTokens![id].kind).toBe('generatedWall')
    for (const id of Object.keys(document.vertices)) expect(identity.generationTokens![id].kind).toBe('generatedVertex')
    const manual = cloneJson(document); manual.generation.legacy.recipes = {}; manual.generation.legacy.rules = {}; manual.generation.legacy.ownership = {}
    expect(createHistoryIdentity(manual, runtime()).generationTokens).toEqual({})
    const missing = cloneJson(identity); delete missing.generationTokens!.bedroom
    expect(() => validateHistoryIdentity(missing, document)).toThrow(/缺少出生/)
  })

  it('records indirect room and wall geometry edits and retains birth/topology for coordinate-only moves', () => {
    const before = generated(), content = createCompositionContent(before, runtime()), vertex = before.rooms.bedroom.boundaryVertexIds[0]
    const after = applyCompositionCommands(content, [{ type: 'moveVertex', id: vertex, positionMm: { x: 3200, y: 3000 } }], runtime())
    expect(owner(after.document, 'bedroom')).toMatchObject({ state: 'manual', manualFields: ['geometry'] })
    for (const wall of Object.values(before.walls).filter(wall => wall.startVertexId === vertex || wall.endVertexId === vertex)) expect(owner(after.document, wall.id).manualFields).toContain('geometry')
    expect(after.document.generation.legacy.rules['building-rule'].state).toBe('paused')
    expect(after.historyIdentity.generationTokens!.bedroom).toEqual(content.historyIdentity.generationTokens!.bedroom)
    expect(validateSceneDocument(after.document).ok).toBe(true)
  })

  it('does not restore an old topology token after a native change-back in one transaction', () => {
    const content = createCompositionContent(generated(), runtime()), wallId = Object.keys(content.document.walls)[0]
    const before = content.historyIdentity.generationTokens![wallId]
    const after = applyCompositionCommands(content, [{ type: 'reverseWall', id: wallId }, { type: 'reverseWall', id: wallId }], runtime())
    expect(canonicalJson(after.document.walls[wallId])).toBe(canonicalJson(content.document.walls[wallId]))
    expect(after.historyIdentity.generationTokens![wallId].token).toBe(before.token)
    expect(after.historyIdentity.generationTokens![wallId].topologyHash).toBe(before.topologyHash)
    expect(after.historyIdentity.generationTokens![wallId].topologyToken).not.toBe(before.topologyToken)
  })

  it('persists deletion tombstones and rejects ordinary deletion/recreation with the same room ID', () => {
    const content = createCompositionContent(generated(), runtime())
    const deleted = applyCompositionCommands(content, [{ type: 'deleteRoom', id: 'bedroom', removeOrphanWalls: true }], runtime())
    expect(owner(deleted.document, 'bedroom')).toMatchObject({ state: 'deleted', managedFields: [] })
    expect(deleted.historyIdentity.generationTokens!.bedroom.token).toBe(content.historyIdentity.generationTokens!.bedroom.token)
    expect(() => applyCompositionCommands(deleted, [{ type: 'createRoom', id: 'bedroom', floorId, layerId, boundaryMm: boundary, thicknessMm: 200 }], runtime())).toThrow(/出生身份不能复用/)
  })

  it('rejects a cold document whose real building geometry no longer matches the managed hash', () => {
    const document = generated(), vertex = document.rooms.bedroom.boundaryVertexIds[0]
    document.vertices[vertex].xMm += 200
    const checked = validateSceneDocument(document)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.errors.some(issue => issue.code === 'TERRAIN_OUTPUT_HASH')).toBe(true)
  })
})
