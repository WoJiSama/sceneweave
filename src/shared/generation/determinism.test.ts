import { describe, expect, it } from 'vitest'
import { domainExecutionFixture } from '../../../tools/testing/domain-execution-fixtures.js'
import type { PropDefinition, SceneDocument } from '../model/scene.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { roomPoints, openingEndpoints } from '../geometry/geometry.js'
import { validateSceneDocument } from '../validation/scene.js'
import { generationDomains } from './domains/registry.js'
import { runInteriorGeneration, type InteriorGenerationInput } from './domains/interior/index.js'
import { defaultMixedInput, runMixedGeneration, type MixedGenerationInput } from './domains/mixed/index.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { generationRecipeSchema } from '../terrain-generation/contracts.js'

const options = { profile: domainExecutionFixture('interior').profile, nowMilliseconds: () => 0 }
function furnishedBase(kind: 'forest' | 'volcano' | 'interior', sceneId: string) {
  const base = domainExecutionFixture(kind).base
  base.sceneId = sceneId
  for (const role of ['seat', 'table', 'storage'] as const) base.propDefinitions[`det-${role}`] = {
    id: `det-${role}`, catalogId: `det-${role}`, version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Determinism test', canEmbed: true }, name: role, tags: [],
    defaultAppearance: { kind: 'symbol', symbol: 'crate', tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -300, y: -300, width: 600, height: 600 },
    defaultFootprintMm: { width: 600, height: 600 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false,
    defaultRenderLayer: 'object', defaultShadowClass: 'furniture',
  } satisfies PropDefinition
  return base
}
const palette = () => (['seat', 'table', 'storage'] as const).map(role => ({ role, ref: { id: `det-${role}`, version: 1 } }))
/** Compare actual world geometry and business fields. Only typed identities are
 * mapped to their actual supporting geometry; source documents remain intact. */
function geometry(d: SceneDocument) {
  const ordered = (rows: unknown[]) => rows.map(canonicalJson).sort()
  const room = (id: string) => roomPoints(d, d.rooms[id])
  const support = (ref: { kind: string; id: string }): unknown => ref.kind === 'room' ? { kind: 'room', boundary: room(ref.id) }
    : ref.kind === 'terrainArea' ? { kind: ref.kind, boundary: d.terrainAreas[ref.id].boundaryMm.map(point => point.positionMm), elevation: d.terrainAreas[ref.id].groundElevationMm }
      : { kind: ref.kind, bounds: d.floors[ref.id].boundsMm }
  return {
    rooms: ordered(Object.values(d.rooms).map(({ id, boundaryVertexIds: _ring, floorId: _floor, supportRef, ...row }) => ({ ...row, boundary: room(id), support: support(supportRef) }))),
    walls: ordered(Object.values(d.walls).map(({ id: _id, floorId: _floor, startVertexId, endVertexId, ...row }) => ({ ...row,
      start: [d.vertices[startVertexId].xMm, d.vertices[startVertexId].yMm], end: [d.vertices[endVertexId].xMm, d.vertices[endVertexId].yMm] }))),
    openings: ordered(Object.values(d.openings).map(({ id: _id, wallId: _wall, floorId: _floor, offsetReferenceVertexId: _vertex, offsetMm: _offset, ...row }) => ({ ...row, endpoints: openingEndpoints(d, d.openings[_id]) }))),
    props: ordered(Object.values(d.props).map(({ id: _id, floorId: _floor, roomId, supportRef, ...row }) => ({ ...row, room: roomId ? room(roomId) : null, support: support(supportRef) }))),
    terrain: ordered(Object.values(d.terrainAreas).map(({ id: _id, floorId: _floor, boundaryMm, ...row }) => ({ ...row, boundaryMm: boundaryMm.map(point => point.positionMm) }))),
    paths: ordered(Object.values(d.paths).map(({ id: _id, floorId: _floor, supportRefs, ...row }) => ({ ...row, supports: ordered(supportRefs.map(support)) }))),
    decorations: ordered(Object.values(d.decorations).map(({ id: _id, floorId: _floor, supportRef, ...row }) => ({ ...row, support: support(supportRef) }))),
  }
}
function mixed(kind: 'forest' | 'volcano', sceneId: string, version: MixedGenerationInput['algorithmVersion'] = generationDomains.mixed.algorithm.version) {
  const base = furnishedBase(kind, sceneId)
  Object.values(base.floors)[0].boundsMm = { x: 0, y: 0, width: 40000, height: 32000 }; base.exportBoundsMm = { x: 0, y: 0, width: 40000, height: 32000 }
  const input = defaultMixedInput(base, kind, 'forest-outpost-1'); input.algorithmVersion = version
  const p = input.parameters.building
  p.rooms = ['first', 'second'].map(id => ({ id, purpose: '哨站休息室', minAreaMm2: 4_000_000, maxAreaMm2: 200_000_000, minClearSideMm: 1200 }))
  p.arrangement.palette = palette()
  return runMixedGeneration(base, input, options)
}
function interior(sceneId: string, version: InteriorGenerationInput['algorithmVersion'] = generationDomains.interior.algorithm.version) {
  const base = furnishedBase('interior', sceneId), input: InteriorGenerationInput = cloneJson(domainExecutionFixture('interior').input)
  input.algorithmVersion = version; input.parameters.arrangement.furniture = true; input.parameters.arrangement.palette = palette()
  input.parameters.rooms.forEach(row => { row.purpose = '公共休息室' })
  return runInteriorGeneration(base, input, options)
}

describe('new-project semantic determinism across independent identities', () => {
  it('keeps furnished interior geometry independent of its new scene identity', () => {
    const first = interior('det-scene-a'), second = interior('det-scene-b')
    expect(first.report.furnishing.propIds.length).toBeGreaterThan(0)
    expect(first.candidate.document.sceneId).not.toBe(second.candidate.document.sceneId)
    expect(first.report.furnishing.propIds).not.toEqual(second.report.furnishing.propIds)
    expect(geometry(second.candidate.document as SceneDocument)).toEqual(geometry(first.candidate.document as SceneDocument))
    const recipe = Object.values(getLegacyGeneration(first.candidate.document as SceneDocument)!.recipes).find(row => 'domain' in row && row.domain === 'interior')!
    expect(recipe).toMatchObject({ recipeVersion: 5, algorithmVersion: 5 })
    expect(generationRecipeSchema.safeParse({ ...recipe, algorithmVersion: 2 }).success).toBe(false)
  }, 30000)
  it.each(['forest', 'volcano'] as const)('keeps %s furniture, exterior door, approach and vegetation stable across new identities', kind => {
    const first = mixed(kind, 'det-scene-a'), second = mixed(kind, 'det-scene-b')
    expect(first.report.roomIds).not.toEqual(second.report.roomIds)
    expect(validateSceneDocument(second.candidate.document).ok).toBe(true)
    expect(geometry(second.candidate.document as SceneDocument)).toEqual(geometry(first.candidate.document as SceneDocument))
    const recipes = Object.values(getLegacyGeneration(first.candidate.document as SceneDocument)!.recipes).filter(row => 'domain' in row && ['interior', 'mixed'].includes(row.domain))
    expect(recipes).toHaveLength(2)
    for (const recipe of recipes) {
      const version = 4
      expect(recipe).toMatchObject({ recipeVersion: version, algorithmVersion: version })
      expect(generationRecipeSchema.safeParse({ ...recipe, algorithmVersion: 1 }).success).toBe(false)
    }
  }, 30000)
  it('captures legacy replay baselines without changing their identities or full results', () => {
    expect(interior('det-scene-a', 2).resultHash).toBe('f0c90d6d6ad8623bf270eaac7fabb6d1a6ebac856c7b0f9aea2822a5770e0a2e')
    expect(mixed('forest', 'det-scene-a', 1).resultHash).toBe('3ff6c9dca7f6161ea396cb21452e019e8db2917a83eb2179f48ea55ca54b3172')
    expect(mixed('volcano', 'det-scene-a', 1).resultHash).toBe('86ba0d7ad704c18e334294cc344c56993d0e961d3f200991f385e20567171fcc')
  }, 30000)
})
