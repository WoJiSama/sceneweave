import { describe, expect, it } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { authoringProjectHash, applyAuthoringStep, replayAuthoring, publicAuthoringContext } from './authoring.js'
import type { AuthoringOperation, AuthoringStart } from './authoring-protocol.js'
import { emptyVisualSystem } from '../visual/types.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { validateProjectData } from '../project/validate.js'
import { diagnoseAuthoringProject } from './plan.js'
import { proposeAuthoringTerrainBoundary } from './visual-authoring.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { sha256Text } from '../validation/hash.js'

function start(): AuthoringStart {
  const project = cloneJson(svgProjectFixture().bundle.project)
  project.schemaVersion = 2; project.document.schemaVersion = 2; project.document.visual = emptyVisualSystem()
  const floorId = Object.keys(project.document.floors)[0], layerId = project.document.entityLayers.item, boundsMm = project.document.floors[floorId].boundsMm
  return { schemaVersion: 1, project: validateProjectData(project), baseContentHash: authoringProjectHash(project), seed: 'fcb3353d-8c8f-4890-b002-a9f5a464a769', preparedAt: '2026-10-25T00:00:00.000Z',
    disclosure: 'complete-metadata/public-model', skill: { id: 'sceneweave-scene-authoring', version: 1 }, scope: { targetIds: [], operations: [], placement: null,
      visual: { floorId, layerId, boundsMm, entityIds: ['item'], definitionIds: [], materialIds: [], operations: ['visualBoundary', 'visualEdge', 'visualLight', 'visualFog', 'visualFilter', 'visualEnvironment', 'visualRemove'], allowGlobalEnvironment: true } },
    brief: { recipe: 'beach', requirements: ['A continuous shore and a warm light'] } }
}
const boundary: AuthoringOperation = { kind: 'visualBoundary', id: 'coast', closed: false, segments: [{ id: 'coast-segment', start: { x: 3000, y: 3000 }, control1: { x: 5000, y: 3000 }, control2: { x: 5000, y: 5000 }, end: { x: 7000, y: 5000 } }], sampleSpacingMm: 1000, toleranceMm: 100, binding: { kind: 'decoration' } }
const edge: AuthoringOperation = { kind: 'visualEdge', id: 'foam', boundaryId: 'coast', edgeKind: 'shore', side: 'left', widthMm: 200, color: '#FFFFFF', accentColor: '#E4DFB4', opacity: .8, intensity: 1, seed: 'shore-seed', repeatMm: 300, enabled: true }
const light: AuthoringOperation = { kind: 'visualLight', id: 'lamp', positionMm: { x: 5000, y: 5000 }, radiusMm: 1000, color: '#FFD080', intensity: .6, wallOcclusion: true, enabled: true }

describe('visual authoring capabilities and atomic replay', () => {
  it('proposes a rounded authorised ring without inward-star controls or writes and replays the explicit result at its real cost', () => {
    const input = start(), scope = input.scope.visual!
    input.scope.scene = { floorId: scope.floorId, layerId: scope.layerId, boundsMm: scope.boundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] }
    const vertices = [{ x: 7000, y: 10000 }, { x: 11000, y: 7000 }, { x: 15000, y: 10000 }, { x: 11000, y: 13000 }]
    const built = applyAuthoringStep(input, replayAuthoring(input, []).state, [{ kind: 'terrain', id: 'hill', boundaryMm: vertices, groundElevationMm: 800 }], 'hill')
    const before = canonicalJson(built), allowed = new Set(built.state.changedIds)
    const proposal = proposeAuthoringTerrainBoundary(built.project, scope, allowed, { areaId: 'hill', boundaryId: 'hill-rim' })
    expect(proposal).toMatchObject({ sourceAnchorCount: 4, sourceConcaveCorners: 0, candidateConcaveCorners: 0 })
    expect(proposal.candidateAreaM2).toBeGreaterThan(proposal.sourceAreaM2)
    expect(proposal.sampleCount).toBeLessThanOrEqual(32)
    expect(proposal.candidateOperation.segments[0].start).toEqual(vertices[0])
    expect(proposal.candidateOperation.segments[0].control1.x).toBe(vertices[0].x)
    expect(proposal.candidateOperation.segments[0].control1.y).toBeLessThan(vertices[0].y)
    expect(canonicalJson(built)).toBe(before)
    const edited = applyAuthoringStep(input, built.state, [proposal.candidateOperation], 'rounded-hill')
    expect(edited.state.operationCost - built.state.operationCost).toBeLessThan(90)
    expect(edited.project.document.visual!.boundaries['hill-rim'].segments).toEqual(proposal.candidateOperation.segments)
    expect(edited.project.document.terrainAreas.hill.boundaryMm[0].id).toBe(built.project.document.terrainAreas.hill.boundaryMm[0].id)
    expect(replayAuthoring(input, edited.state.steps)).toEqual(edited)
    expect(() => proposeAuthoringTerrainBoundary(built.project, scope, new Set(), { areaId: 'hill', boundaryId: 'not-authorised' })).toThrow(/授权/)
    built.project.document.terrainAreas.hill.editLocked = true
    expect(() => proposeAuthoringTerrainBoundary(built.project, scope, allowed, { areaId: 'hill', boundaryId: 'locked-hill' })).toThrow(/锁/)
  })
  it('replays a bounded shore and point light through native commands without changing physical objects or main revision', () => {
    const input = start(), before = canonicalJson(input.project), initial = replayAuthoring(input, [])
    const result = applyAuthoringStep(input, initial.state, [boundary, edge, light], 'coast-step')
    expect(result.project.schemaVersion).toBe(2)
    expect(result.project.document.visual?.edgeLooks.foam.boundaryId).toBe('coast')
    expect(result.project.document.visual?.lights.lamp.radiusMm).toBe(1000)
    expect(result.project.document.props).toEqual(input.project.document.props)
    expect(result.project.document.revision).toBe(input.project.document.revision)
    expect(canonicalJson(input.project)).toBe(before)
    expect(replayAuthoring(input, result.state.steps)).toEqual(result)
    expect((publicAuthoringContext(input, result.state) as { visual: { entities: unknown[] } }).visual.entities).toHaveLength(3)
  })
  it('allocates globally unique bounded control IDs when two terrain proposals are adopted sequentially', () => {
    const input = start(), scope = input.scope.visual!, boundaryId = 'b'.repeat(256)
    input.scope.scene = { floorId: scope.floorId, layerId: scope.layerId, boundsMm: scope.boundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] }
    const firstId = `curve-segment-${sha256Text(JSON.stringify([boundaryId, 0, 0]))}`
    const built = applyAuthoringStep(input, replayAuthoring(input, []).state, [
      { kind: 'terrain', id: 'first-land', boundaryMm: [{ x: 7000, y: 6000 }, { x: 10000, y: 4000 }, { x: 13000, y: 6000 }, { x: 10000, y: 8000 }], groundElevationMm: 800 },
      { kind: 'terrain', id: 'second-land', boundaryMm: [{ x: 7000, y: 14000 }, { x: 10000, y: 12000 }, { x: 13000, y: 14000 }, { x: 10000, y: 16000 }], groundElevationMm: 800 },
    ], 'lands')
    // Occupy the second proposal's first deterministic choice with a real entity.
    const first = proposeAuthoringTerrainBoundary(built.project, scope, new Set(built.state.changedIds), { areaId: 'first-land', boundaryId: firstId })
    const rounded = applyAuthoringStep(input, built.state, [first.candidateOperation], 'first-curve')
    const existing = geometryIdentityIds(rounded.project.document)
    const second = proposeAuthoringTerrainBoundary(rounded.project, scope, new Set(rounded.state.changedIds), { areaId: 'second-land', boundaryId })
    expect(second.candidateOperation.segments.every(segment => segment.id.length <= 256 && !existing.has(segment.id))).toBe(true)
    expect(second.candidateOperation.segments[0].id).not.toBe(firstId)
    const finished = applyAuthoringStep(input, rounded.state, [second.candidateOperation], 'second-curve')
    const ids = Object.values(finished.project.document.visual!.boundaries).flatMap(value => value.segments.map(segment => segment.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(finished.project.document.visual!.boundaries)).toHaveLength(2)
    expect(replayAuthoring(input, finished.state.steps)).toEqual(finished)
    expect(() => proposeAuthoringTerrainBoundary(finished.project, scope, new Set(finished.state.changedIds), { areaId: 'first-land', boundaryId })).toThrow(/未占用/)
  })
  it('refuses visual operations on scene-v1 before a user explicitly creates a v2 copy', () => {
    const input = start(); delete input.project.document.visual; input.project.document.schemaVersion = 1; input.project.schemaVersion = 1
    input.baseContentHash = authoringProjectHash(input.project)
    expect(() => replayAuthoring(input, [])).toThrow(/v2独立副本/)
  })
  it('rejects a late out-of-scope operation atomically and includes visual expansion in the 256 budget', () => {
    const input = start(), initial = replayAuthoring(input, [])
    expect(() => applyAuthoringStep(input, initial.state, [boundary, { ...light, positionMm: { x: -5000, y: -5000 } }], 'outside')).toThrow()
    expect(replayAuthoring(input, [])).toEqual(initial)
    const one = applyAuthoringStep(input, initial.state, [boundary], 'boundary')
    expect(one.state.operationCost).toBeGreaterThan(1)
    expect(one.project.document.visual!.boundaries.coast).toBeDefined()
  })
  it('separately gates global environment and rejects persistent layer propagation', () => {
    const input = start(); input.scope.visual!.allowGlobalEnvironment = false
    const initial = replayAuthoring(input, [])
    expect(() => applyAuthoringStep(input, initial.state, [{ kind: 'visualEnvironment', environment: emptyVisualSystem().environment }], 'global')).toThrow(/单独明确授权/)
    expect(() => applyAuthoringStep(input, initial.state, [{ kind: 'visualFilter', id: 'filter', target: { kind: 'layer', layerId: input.scope.visual!.layerId }, preset: 'warm', exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, seed: 'filter', enabled: true }], 'layer')).toThrow(/冻结明确目标/)
  })
  it('keeps user prose requirements unverified after structural diagnostics', () => {
    const input = start(), report = diagnoseAuthoringProject(input.project, new Set(['item']), input.brief)
    expect(report.requirements[0].status).toBe('needs_human_review')
    expect(report.visualInput).toContain('No screenshot')
  })
  it('projects only frozen public physical objects and includes the real asset/license closure', () => {
    const input = start(); input.scope.visual!.definitionIds = ['definition']
    const initial = replayAuthoring(input, []), context = publicAuthoringContext(input, initial.state) as { scene: { entities: { id: string }[] } }
    expect(context.scene.entities.map(value => value.id)).toEqual(['item'])
    expect(initial.state.readIds).toContain(input.project.document.assets.image.sha256)
    expect(initial.state.readIds).toContain(input.project.licenseBindings[0].licensePath)
  })
  it('places editable members continuously through the closing arc and rejects overlapping blocking members atomically', () => {
    const input = start(), grant = input.scope.visual!
    grant.definitionIds = ['definition']; grant.operations.push('furnishAlong')
    const vertices = [{ x: 3000, y: 3000 }, { x: 6000, y: 3000 }, { x: 6000, y: 6000 }, { x: 3000, y: 6000 }]
    const closed: AuthoringOperation = { ...boundary, closed: true, segments: vertices.map((start, index) => ({ id: `square-${index}`, start, control1: start, control2: vertices[(index + 1) % 4], end: vertices[(index + 1) % 4] })) }
    const initial = applyAuthoringStep(input, replayAuthoring(input, []).state, [closed], 'square')
    const result = applyAuthoringStep(input, initial.state, [{ kind: 'furnishAlong', source: { kind: 'boundary', id: 'coast' }, definitionId: 'definition', supportRef: { kind: 'floor', id: grant.floorId }, count: 2, startDistanceMm: 10000, spacingMm: 500, offsetMm: 0 }], 'along')
    const members = Object.values(result.project.document.props).filter(prop => prop.id !== 'item')
    expect(members).toHaveLength(2)
    expect(members[0].positionMm).not.toEqual(members[1].positionMm)
    expect(members.every(prop => prop.positionMm.x === 3000 && prop.positionMm.y > 3000 && prop.positionMm.y < 6000)).toBe(true)
    expect(replayAuthoring(input, result.state.steps)).toEqual(result)
    const blocked = start(); blocked.scope.visual!.definitionIds = ['definition']; blocked.scope.visual!.operations.push('furnishAlong')
    blocked.project.document.propDefinitions.definition.defaultBlocksMovement = true
    blocked.baseContentHash = authoringProjectHash(blocked.project)
    const withCurve = applyAuthoringStep(blocked, replayAuthoring(blocked, []).state, [boundary], 'curve')
    expect(() => applyAuthoringStep(blocked, withCurve.state, [{ kind: 'furnishAlong', source: { kind: 'boundary', id: 'coast' }, definitionId: 'definition', supportRef: { kind: 'floor', id: grant.floorId }, count: 2, startDistanceMm: 0, spacingMm: 1, offsetMm: 0 }], 'overlap')).toThrow(/占地冲突/)
    expect(replayAuthoring(blocked, withCurve.state.steps)).toEqual(withCurve)
  })
  it('derives local visual continuity invalidations from intermediate topology even when final JSON changes back', () => {
    const input = start(), initial = replayAuthoring(input, [])
    const added = applyAuthoringStep(input, initial.state, [boundary], 'add')
    const other = { ...boundary, segments: boundary.kind === 'visualBoundary' ? boundary.segments.map(segment => ({ ...segment, id: 'replacement-control-identity' })) : [] } as AuthoringOperation
    const changedBack = applyAuthoringStep(input, added.state, [other, boundary], 'change-back')
    expect(changedBack.project.document.visual!.boundaries.coast).toEqual(added.project.document.visual!.boundaries.coast)
    expect(changedBack.visualInvalidatedIds).toContain('coast')
    const recreated = applyAuthoringStep(input, added.state, [{ kind: 'visualRemove', effectKind: 'boundary', id: 'coast', detach: true }, boundary], 'recreate')
    expect(recreated.visualInvalidatedIds).toContain('coast')
    expect(recreated.state).not.toHaveProperty('visualInvalidatedIds')
    expect(replayAuthoring(input, recreated.state.steps).visualInvalidatedIds).toEqual(recreated.visualInvalidatedIds)
  })
  it('replays complete bounded surface paints and feathered overlays with fixed material versions and no physical changes', () => {
    const input = start(), grant = input.scope.visual!, asset = input.project.document.assets.image
    input.project.document.materials.material = { id: 'material', catalogId: 'test.visual-paint', version: 1, licenseRef: asset.licenseRef, origin: cloneJson(asset.origin), name: 'Licensed texture', tags: [], textureAssetId: 'image', defaultTileSizeMm: { width: 1000, height: 1000 }, applicableSurfaces: ['room'] }
    input.project.licenseBindings.push({ ...input.project.licenseBindings.find(binding => binding.subjectKind === 'asset')!, subjectKind: 'material', subjectId: 'material' })
    grant.materialIds = ['material']; grant.operations.push('visualSurface')
    input.scope.scene = { floorId: grant.floorId, layerId: grant.layerId, boundsMm: grant.boundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: ['material'], operations: ['room'] }
    input.baseContentHash = authoringProjectHash(input.project)
    const room = applyAuthoringStep(input, replayAuthoring(input, []).state, [{ kind: 'room', id: 'room', thicknessMm: 200,
      boundaryMm: [{ x: 7000, y: 7000 }, { x: 11000, y: 7000 }, { x: 11000, y: 11000 }, { x: 7000, y: 11000 }] }], 'room')
    const paint = { materialRef: { id: 'material', version: 1 }, tileSizeMm: { width: 800, height: 1000 }, rotationDeg: 30, alignment: 'world' as const, originMm: { x: 100, y: 200 }, tint: null, opacity: 1 as const }
    const operation: AuthoringOperation = { kind: 'visualSurface', id: 'room', surfaceKind: 'room', style: { base: paint, overlays: [{ id: 'patch', boundaryMm: [{ x: 8000, y: 8000 }, { x: 9000, y: 8000 }, { x: 8500, y: 9000 }], paint: { ...paint, opacity: .4 }, blendWidthMm: 100, renderOrder: 0 }] } }
    const painted = applyAuthoringStep(input, room.state, [operation], 'paint')
    expect(painted.project.document.rooms.room.floorStyle).toEqual(operation.kind === 'visualSurface' ? operation.style : null)
    expect(painted.project.document.vertices).toEqual(room.project.document.vertices)
    expect(painted.project.document.walls).toEqual(room.project.document.walls)
    expect(painted.state.operationCost - room.state.operationCost).toBeGreaterThanOrEqual(2)
    expect(painted.state.readIds).toContain(asset.sha256)
    expect(replayAuthoring(input, painted.state.steps)).toEqual(painted)
    const stale = cloneJson(operation)
    if (stale.kind === 'visualSurface') stale.style!.base.materialRef.version = 2
    expect(() => applyAuthoringStep(input, room.state, [stale], 'stale-material')).toThrow(/版本不符/)
    const tinted = cloneJson(operation) as unknown as { style: { base: { tint: string } } }
    tinted.style.base.tint = '#BB9955'
    expect(() => applyAuthoringStep(input, room.state, [tinted as unknown as AuthoringOperation], 'unadopted-tint')).toThrow()
  })
  it('diagnoses only authorized public furniture footprints and never names an ungranted blocker', () => {
    const input = start(), scene = input.project.document, first = scene.props.item
    first.blocksMovement = true
    scene.props.other = { ...cloneJson(first), id: 'other' }
    scene.props.secret = { ...cloneJson(first), id: 'secret', visibility: 'gm' }
    const report = diagnoseAuthoringProject(input.project, new Set(['item', 'other', 'secret']))
    expect(report.issues).toContainEqual({ code: 'authorized_blocking_furniture_overlap', ids: ['item', 'other'], severity: 'warning' })
    expect(JSON.stringify(report)).not.toContain('secret')
  })
})
