import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromBundle } from '../../application/workspace/project.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { hitTestAll, selectInBounds, selectionGeometry } from '../../editor/native-canvas/selection.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { encodeSceneCoordinates, decodeSceneCoordinates } from '../aggregates/scene-coordinates.js'
import { applyNaturalAggregateCommand } from '../aggregates/natural-transform.js'
import { createAggregateSpatialSnapshot } from '../aggregates/spatial.js'
import { applyCompositionDraftCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CarvedRockCommand } from '../commands/carved-rock.js'
import { pointInPolygon, terrainPoints, validateGeometry } from '../geometry/geometry.js'
import { supportSampleAt } from '../geometry/support-sample.js'
import { checkTerrainRoute, checkTerrainTravel } from '../geometry/terrain-travel.js'
import type { CompositionCommand, CompositionContent } from '../model/appearance.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { projectScene, terrainDecorationPadding } from '../projection/projection.js'
import { certifyCompositionContent } from '../validation/content.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { createRockShellSampler, type RockShell } from './index.js'
import { followRockShells } from './state.js'

const floorId = 'blank-floor'
function bundle(masked = false) {
  const value = fixture(), scene = value.project.document
  delete scene.props.item; delete scene.props.other; delete scene.entityLayers.item; delete scene.entityLayers.other
  if (masked) {
    scene.regions['privacy-mask'] = { id: 'privacy-mask', floorId, editLocked: false, visibility: 'gm', kind: 'manualMask',
      boundaryMm: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 0, y: 20000 }], blocksMovement: false, movementCostMultiplier: 1 }
    scene.entityLayers['privacy-mask'] = Object.keys(scene.userLayers)[0]
  }
  Object.assign(value.project, createCompositionContent(scene, runtime))
  return value
}
const content = (value: Pick<CompositionContent, 'document' | 'historyIdentity' | 'appearance'>): CompositionContent => ({ document: value.document, historyIdentity: value.historyIdentity, appearance: value.appearance })
const createArea: CompositionCommand = { type: 'createTerrainArea', id: 'rock', floorId,
  boundaryMm: [{ x: 6000, y: 4000 }, { x: 18000, y: 4000 }, { x: 18000, y: 14000 }, { x: 6000, y: 14000 }],
  groundElevationMm: 2000, visibility: 'public', surfaceStyle: null }
const makeRock: CompositionCommand = { type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -500 } }
const addSource: CompositionCommand = { type: 'addAttachmentSurface', id: 'rock-face', owner: { kind: 'terrainArea', id: 'rock' },
  feature: { kind: 'rockSourceFace', sourceSegmentIds: ['rock:segment:0'] }, capabilities: ['embed'] }
const createShell = (excludedSegmentIds: string[] = []): CompositionCommand => ({ type: 'createRockShell', id: 'rock', widthMm: 1000,
  direction: { x: 0, y: 1 }, seed: 'composition-real-mesh', excludedSegmentIds })
const removeShell: CompositionCommand = { type: 'removeRockShell', id: 'rock', disposition: 'restore-vertical-body' }
function rock(masked = false) {
  let value = certifyCompositionContent(content(bundle(masked).project))
  value = applyCompositionDraftCommands(value, [createArea], runtime)
  return applyCompositionDraftCommands(value, [makeRock], runtime)
}
function path(scene: SceneDocument, visibility: 'public' | 'gm' = 'public'): Extract<CarvedRockCommand, { type: 'createCarvedMountainPath' }> {
  return { type: 'createCarvedMountainPath', id: 'mountain-path', attachmentId: 'path-embed', walkSurfaceId: 'path-walk', sourceSurfaceId: 'rock-face',
    fromSurfaceRef: { kind: 'floor', id: floorId }, toSurfaceRef: { kind: 'terrainArea', id: 'rock' },
    pointsMm: [{ x: 6000, y: 6000, z: 0 }, { x: 16000, y: 6000, z: 2000 }], widthMm: 1000, cutSide: 'right',
    layerId: scene.entityLayers.rock, visibility, follow: 'follow' }
}
const savedShell = (scene: SceneDocument): RockShell => scene.terrainAreas.rock.rockBody!.shell!
function sidePoint(scene: SceneDocument): PointMm {
  const sampler = createRockShellSampler(savedShell(scene))
  for (const face of sampler.triangles) {
    const point = { x: Math.round(face.verticesMm.reduce((sum, v) => sum + v.x, 0) / 3), y: Math.round(face.verticesMm.reduce((sum, v) => sum + v.y, 0) / 3) }
    if (!pointInPolygon(point, terrainPoints(scene.terrainAreas.rock)) && sampler.sample(point)) return point
  }
  throw new Error('fixture needs a nonvertical actual side face outside the unchanged top')
}
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repository of repositories.splice(0)) { const name = repository.database.name; repository.close(); await Dexie.delete(name) }
})

describe('real rock-shell composition, persistence and consumers', () => {
  it('creates a complete strict shell with fresh topology and uses actual side triangles for projection and support', () => {
    const prepared = rock(), result = applyCompositionDraftCommands(prepared, [createShell()], runtime), scene = result.document, shell = savedShell(scene)
    expect(validateGeometry(scene).errors).toEqual([])
    expect(scene.terrainAreas.rock.boundaryMm).toEqual(prepared.document.terrainAreas.rock.boundaryMm)
    expect(result.historyIdentity.outdoorTokens.rock.token).toBe(prepared.historyIdentity.outdoorTokens.rock.token)
    expect(result.historyIdentity.outdoorTokens.rock.topologyToken).not.toBe(prepared.historyIdentity.outdoorTokens.rock.topologyToken)
    expect(shell.sourceBoundaryMm).toEqual(scene.terrainAreas.rock.boundaryMm)
    expect(Object.keys(shell.verticesMm).length).toBeGreaterThan(4)
    const p = sidePoint(scene), actual = createRockShellSampler(shell).sample(p)!
    expect(supportSampleAt(scene, floorId, p)).toMatchObject({ actualSurfaceId: actual.faceId, zMm: actual.zMm, normal: actual.normal, walkable: false, sourceRockShellAreaId: 'rock' })
    expect(checkTerrainTravel(scene, { floorId, from: p, to: { x: p.x + 10, y: p.y }, widthMm: 10 }).ok).toBe(false)
    const gm = projectScene(scene, 'gm', result.appearance, { floorId }), player = projectScene(scene, 'player', result.appearance, { floorId })
    expect(player.rocks).toEqual(gm.rocks)
    const faceIds = new Set(Object.keys(shell.faces).map(id => `rock-shell:${id}`))
    const actualFacets = gm.rocks![0].facets.filter(row => faceIds.has(row.id))
    expect(actualFacets.length).toBeGreaterThan(0)
    for (const facet of actualFacets) {
      const face = shell.faces[facet.id.slice('rock-shell:'.length)]
      expect(facet.pointsMm).toEqual(face.vertexIds.map(id => { const { x, y } = shell.verticesMm[id]; return { x, y } }))
    }
    expect(JSON.stringify(player)).not.toMatch(/verticesMm|sourceBoundaryMm|excludedSegmentIds|birthToken|topologyToken|composition-real-mesh/)
  })

  it('rejects injected shells, regeneration and ordinary height/nonrigid changes without altering the original', () => {
    const prepared = rock(), result = applyCompositionDraftCommands(prepared, [createShell()], runtime), shell = cloneJson(savedShell(result.document)), before = canonicalJson(result)
    const injected = [
      { type: 'updateTerrainArea', id: 'rock', changes: { rockBody: { baseElevationMm: -500, shell } } },
      { type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -500, shell } },
      { ...createShell(), shell },
    ] as unknown as CompositionCommand[]
    for (const command of injected) expect(() => applyCompositionDraftCommands(prepared, [command], runtime)).toThrow(/无效|Unrecognized|识别/)
    expect(() => applyCompositionDraftCommands(result, [createShell()], runtime)).toThrow(/已有真实侧壳/)
    expect(() => applyCompositionDraftCommands(result, [{ type: 'setTerrainElevation', id: 'rock', groundElevationMm: 2500 }], runtime)).toThrow(/刚性XY|高程/)
    expect(() => applyCompositionDraftCommands(result, [{ type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -1000 } }], runtime)).toThrow(/侧壳/)
    expect(() => applyCompositionDraftCommands(result, [{ type: 'moveTerrainPoint', areaId: 'rock', pointId: result.document.terrainAreas.rock.boundaryMm[0].id, positionMm: { x: 6500, y: 4000 } }], runtime)).toThrow(/刚体|侧壳/)
    expect(canonicalJson(result)).toBe(before)
    expect(prepared.document.terrainAreas.rock.rockBody!.shell).toBeUndefined()
  })

  it('preflights the remaining transaction budget before allocating shell or topology IDs', () => {
    const prepared = rock(), before = canonicalJson(prepared)
    const nextId = vi.fn(() => `budget-shell-${crypto.randomUUID()}`)
    expect(() => applyCompositionDraftCommands(prepared, [createShell()], { ...runtime, ids: { nextId } }, { initialOperationCost: 250 })).toThrow(/预算/)
    expect(nextId.mock.calls).toHaveLength(0)
    expect(canonicalJson(prepared)).toBe(before)
  })

  it('refuses topology rebuilds around explicit source surfaces and existing real mountain paths', () => {
    const prepared = rock(), sourced = applyCompositionDraftCommands(prepared, [addSource], runtime)
    expect(() => applyCompositionDraftCommands(sourced, [createShell()], runtime)).toThrow(/解绑|宿主表面/)
    const carved = applyCompositionDraftCommands(sourced, [path(sourced.document)], runtime)
    expect(() => applyCompositionDraftCommands(carved, [createShell(['rock:segment:0', 'rock:segment:3'])], runtime)).toThrow(/解绑|回填/)
    const shell = applyCompositionDraftCommands(prepared, [createShell(['rock:segment:0', 'rock:segment:3'])], runtime)
    const shellSource = applyCompositionDraftCommands(shell, [addSource], runtime)
    expect(() => applyCompositionDraftCommands(shellSource, [removeShell], runtime)).toThrow(/解绑|宿主表面/)
    const withPath = applyCompositionDraftCommands(shellSource, [path(shellSource.document)], runtime)
    expect(() => applyCompositionDraftCommands(withPath, [removeShell], runtime)).toThrow(/解绑|回填/)
    expect(withPath.document.attachmentSurfaces!['rock-face']).toEqual(shellSource.document.attachmentSurfaces!['rock-face'])
  })

  it('keeps the complete entry edge vertical and rejects paths that only exclude their source cliff', () => {
    const prepared = rock()
    const insufficient = applyCompositionDraftCommands(prepared, [createShell(['rock:segment:0'])], runtime)
    const sourced = applyCompositionDraftCommands(insufficient, [addSource], runtime)
    expect(() => applyCompositionDraftCommands(sourced, [path(sourced.document)], runtime)).toThrow(/入口|源崖|切口/)
    const complete = applyCompositionDraftCommands(prepared, [createShell(['rock:segment:0', 'rock:segment:3'])], runtime)
    const source = applyCompositionDraftCommands(complete, [addSource], runtime)
    const result = applyCompositionDraftCommands(source, [path(source.document)], runtime)
    expect(validateGeometry(result.document).errors).toEqual([])
    expect(supportSampleAt(result.document, floorId, { x: 11000, y: 6000 }, 'path-walk')).toMatchObject({ zMm: 1000, walkable: true, sourceConnectionId: 'mountain-path' })
    const travel = checkTerrainRoute(result.document, { floorId, pointsMm: [{ x: 5000, y: 6000 }, { x: 17000, y: 6000 }], widthMm: 1000 })
    expect(travel.ok, JSON.stringify(travel.issues)).toBe(true)
    expect(travel.connectionIds).toEqual(['mountain-path'])
    expect(savedShell(result.document)).toEqual(savedShell(complete.document))
  })

  it('finds the real outward side in selection and spatial queries and preserves its XYZ through local representation', () => {
    const prepared = applyCompositionDraftCommands(rock(), [createShell()], runtime), scene = prepared.document, p = sidePoint(scene)
    const query = { floorId, roles: ['surface'] as const, boundsMm: { x: p.x - 1, y: p.y - 1, width: 2, height: 2 } }
    expect(createAggregateSpatialSnapshot(scene, { audience: 'gm' }).query(query).some(row => row.entity.id === 'rock')).toBe(true)
    expect(hitTestAll(scene, p, 0)).toContain('rock')
    expect(selectInBounds(scene, query.boundsMm, 'intersect').ids).toContain('rock')
    expect(selectionGeometry(scene, 'rock').some(shape => shape.length === 3 && pointInPolygon(p, shape))).toBe(true)
    const grouped = applyCompositionDraftCommands(prepared, [{ type: 'createAggregateGroup', group: { id: 'rock-group', floorId, parentId: null,
      frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 1 }, members: [{ kind: 'terrainArea', id: 'rock' }], editLocked: false } }], runtime)
    const local = encodeSceneCoordinates(grouped.document), original = savedShell(grouped.document), encoded = savedShell(local)
    expect(encoded.verticesMm).not.toEqual(original.verticesMm)
    expect(encoded.recipe.direction).toEqual({ x: 1, y: 0 })
    for (const [id, vertex] of Object.entries(original.verticesMm)) expect(encoded.verticesMm[id].z).toBe(vertex.z)
    expect(encoded.sections).toEqual(original.sections)
    expect(encoded.faces).toEqual(original.faces)
    expect(decodeSceneCoordinates(local)).toEqual(grouped.document)
  })

  it('carries every saved side vertex and manual state through a rigid XY move without regenerating geometry', () => {
    const generated = applyCompositionDraftCommands(rock(), [createShell()], runtime), manual = cloneJson(generated)
    const oldShell = savedShell(manual.document)
    oldShell.sections[1].state = 'manual'; Object.values(oldShell.faces)[0].state = 'manual'
    oldShell.recipe.seed = 'saved-shape-keeps-its-real-results'
    const source = certifyCompositionContent(manual), prior = cloneJson(savedShell(source.document))
    const boundaryMm = source.document.terrainAreas.rock.boundaryMm.map(row => ({ ...cloneJson(row), positionMm: { x: row.positionMm.x + 300, y: row.positionMm.y + 200 } }))
    const result = applyCompositionDraftCommands(source, [{ type: 'updateTerrainArea', id: 'rock', changes: { boundaryMm } }], runtime), moved = savedShell(result.document)
    for (const [id, vertex] of Object.entries(prior.verticesMm)) expect(moved.verticesMm[id]).toEqual({ x: vertex.x + 300, y: vertex.y + 200, z: vertex.z })
    expect(moved.sections).toEqual(prior.sections)
    expect(moved.faces).toEqual(prior.faces)
    expect(moved.recipe).toEqual(prior.recipe)
    expect(result.historyIdentity.outdoorTokens.rock).toEqual(source.historyIdentity.outdoorTokens.rock)
    expect(validateGeometry(result.document).errors).toEqual([])
    const boundary = result.document.terrainAreas.rock.boundaryMm
    const rotated = applyCompositionDraftCommands(result, [{ type: 'updateTerrainArea', id: 'rock', changes: { boundaryMm: [...boundary.slice(2), ...boundary.slice(0, 2)] } }], runtime)
    expect(savedShell(rotated.document)).toEqual(moved)
    expect(rotated.historyIdentity.outdoorTokens.rock).toEqual(result.historyIdentity.outdoorTokens.rock)
  })

  it.each([0, 1, 2, 3] as const)('applies the actual natural-group command with translation and %i quarter turns exactly once', turns => {
    const generated = applyCompositionDraftCommands(rock(), [createShell()], runtime), manual = cloneJson(generated)
    savedShell(manual.document).sections[1].state = 'manual'
    Object.values(savedShell(manual.document).faces)[0].state = 'manual'
    savedShell(manual.document).recipe.seed = 'retain-saved-manual-mesh'
    const source = applyCompositionDraftCommands(certifyCompositionContent(manual), [{ type: 'createAggregateGroup', group: { id: 'rock-group', floorId, parentId: null,
      frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 1 }, members: [{ kind: 'terrainArea', id: 'rock' }], editLocked: false } }], runtime)
    const transform = (p: PointMm): PointMm => {
      const x = p.x - 12000, y = p.y - 9000
      const rotated = turns === 0 ? { x, y } : turns === 1 ? { x: -y, y: x } : turns === 2 ? { x: -x, y: -y } : { x: y, y: -x }
      return { x: rotated.x + 12300, y: rotated.y + 9200 }
    }
    const original = savedShell(source.document), expected = cloneJson(original)
    for (const point of expected.sourceBoundaryMm) point.positionMm = transform(point.positionMm)
    for (const vertex of Object.values(expected.verticesMm)) Object.assign(vertex, transform(vertex))
    expected.recipe.direction = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }][turns]
    let operationCost = 0
    const result = applyCompositionDraftCommands(source, [{ type: 'transformAggregateNatural', id: 'rock-group',
      offsetMm: { x: 300, y: 200 }, pivotMm: { x: 12000, y: 9000 }, quarterTurns: turns }], runtime, { onOperationCost: value => { operationCost = value } })
    expect(savedShell(result.document)).toEqual(expected)
    expect(result.document.terrainAreas.rock.boundaryMm).toEqual(source.document.terrainAreas.rock.boundaryMm.map(point => ({ ...point, positionMm: transform(point.positionMm) })))
    expect(result.historyIdentity.outdoorTokens.rock).toEqual(source.historyIdentity.outdoorTokens.rock)
    expect(operationCost).toBeGreaterThanOrEqual(Object.keys(original.verticesMm).length)
    expect(validateGeometry(result.document).errors).toEqual([])
    expect(decodeSceneCoordinates(encodeSceneCoordinates(result.document))).toEqual(result.document)
    expect(savedShell(source.document)).toEqual(original)
  })

  it('refuses any extra shape, manual-state or recipe rewrite hidden inside an already transformed shell', () => {
    const generated = applyCompositionDraftCommands(rock(), [createShell()], runtime)
    const grouped = applyCompositionDraftCommands(generated, [{ type: 'createAggregateGroup', group: { id: 'rock-group', floorId, parentId: null,
      frame: { translationMm: { x: 8000, y: 8000 }, quarterTurns: 1 }, members: [{ kind: 'terrainArea', id: 'rock' }], editLocked: false } }], runtime)
    const moved = cloneJson(grouped.document)
    applyNaturalAggregateCommand(moved, { type: 'transformAggregateNatural', id: 'rock-group', offsetMm: { x: 300, y: 200 }, pivotMm: { x: 12000, y: 9000 }, quarterTurns: 1 })
    const tamper = [
      (shell: RockShell) => { Object.values(shell.verticesMm)[0].z++ },
      (shell: RockShell) => { Object.values(shell.faces)[0].state = 'manual' },
      (shell: RockShell) => { shell.sections[0].state = 'manual' },
      (shell: RockShell) => { shell.recipe.seed = 'silently-regenerated' },
      (shell: RockShell) => { shell.recipe.widthMm++ },
    ]
    const original = canonicalJson(grouped)
    for (const change of tamper) {
      const candidate = cloneJson(moved)
      change(savedShell(candidate))
      expect(() => followRockShells(grouped.document, candidate)).toThrow(/同时改动|人工形体/)
    }
    expect(canonicalJson(grouped)).toBe(original)
  })

  it('preserves an irregular saved shell and manual records through an actual group move and quarter turn', () => {
    const boundaryMm = [{ x: 6000, y: 4000 }, { x: 18000, y: 4000 }, { x: 19800, y: 7000 },
      { x: 19000, y: 12500 }, { x: 14500, y: 15000 }, { x: 9500, y: 14000 }, { x: 6000, y: 11000 }]
    const initial = bundle().project
    initial.document.floors[floorId].boundsMm = { x: 0, y: 0, width: 24000, height: 24000 }
    let source = certifyCompositionContent(content(initial))
    source = applyCompositionDraftCommands(source, [{ ...createArea, boundaryMm } as CompositionCommand, makeRock], runtime)
    source = applyCompositionDraftCommands(source, [createShell(['rock:segment:0', 'rock:segment:6'])], runtime)
    const manual = cloneJson(source), saved = savedShell(manual.document)
    saved.sections[1].state = 'manual'; Object.values(saved.faces)[0].state = 'manual'
    source = applyCompositionDraftCommands(certifyCompositionContent(manual), [{ type: 'createAggregateGroup', group: { id: 'rock-group', floorId, parentId: null,
      frame: { translationMm: { x: 12000, y: 10000 }, quarterTurns: 0 }, members: [{ kind: 'terrainArea', id: 'rock' }], editLocked: false } }], runtime)
    const original = cloneJson(savedShell(source.document)), expected = cloneJson(original)
    const transform = (point: PointMm): PointMm => ({ x: 12000 - (point.y - 10000) + 300, y: 10000 + (point.x - 12000) + 200 })
    for (const point of expected.sourceBoundaryMm) point.positionMm = transform(point.positionMm)
    for (const point of Object.values(expected.verticesMm)) Object.assign(point, transform(point))
    expected.recipe.direction = { x: -1, y: 0 }
    const result = applyCompositionDraftCommands(source, [{ type: 'transformAggregateNatural', id: 'rock-group',
      offsetMm: { x: 300, y: 200 }, pivotMm: { x: 12000, y: 10000 }, quarterTurns: 1 }], runtime)
    expect(savedShell(result.document)).toEqual(expected)
    expect(result.historyIdentity.outdoorTokens.rock).toEqual(source.historyIdentity.outdoorTokens.rock)
    expect(validateGeometry(result.document).errors).toEqual([])
    expect(decodeSceneCoordinates(encodeSceneCoordinates(result.document))).toEqual(result.document)
    const p = sidePoint(result.document), actual = createRockShellSampler(expected).sample(p)!
    expect(supportSampleAt(result.document, floorId, p)).toMatchObject({ zMm: actual.zMm, normal: actual.normal, walkable: false, actualSurfaceId: actual.faceId })
    expect(hitTestAll(result.document, p, 0)).toContain('rock')
    expect(savedShell(source.document)).toEqual(original)
  })

  it('filters private actual side faces and a private cut before deriving player paint and spatial candidates', () => {
    const empty = certifyCompositionContent(content(bundle(true).project)), baseline = projectScene(empty.document, 'player', empty.appearance, { floorId })
    let privateRock = applyCompositionDraftCommands(empty, [{ ...createArea, visibility: 'gm' } as CompositionCommand], runtime)
    privateRock = applyCompositionDraftCommands(privateRock, [makeRock], runtime)
    privateRock = applyCompositionDraftCommands(privateRock, [createShell()], runtime)
    const gm = projectScene(privateRock.document, 'gm', privateRock.appearance, { floorId }), player = projectScene(privateRock.document, 'player', privateRock.appearance, { floorId })
    expect(gm.rocks![0].facets.length).toBeGreaterThan(0)
    expect(player.rocks).toEqual(baseline.rocks)
    expect(player.terrain).toEqual(baseline.terrain)
    expect(player.masks).toEqual(baseline.masks)
    expect(JSON.stringify(player)).not.toContain('rock-shell:')
    const p = sidePoint(privateRock.document)
    expect(createAggregateSpatialSnapshot(privateRock.document, { audience: 'player' }).query({ floorId, boundsMm: { ...p, width: 1, height: 1 } }).some(row => row.entity.id === 'rock')).toBe(false)
    let publicRock = applyCompositionDraftCommands(rock(), [createShell(['rock:segment:0', 'rock:segment:3'])], runtime)
    publicRock = applyCompositionDraftCommands(publicRock, [addSource], runtime)
    const before = projectScene(publicRock.document, 'player', publicRock.appearance, { floorId })
    const secretCut = applyCompositionDraftCommands(publicRock, [path(publicRock.document, 'gm')], runtime)
    const filtered = projectScene(secretCut.document, 'player', secretCut.appearance, { floorId })
    expect(filtered.rocks).toEqual(before.rocks)
    expect(filtered.terrain).toEqual(before.terrain)
    expect(filtered.connections).toEqual([])
    expect(JSON.stringify(filtered)).not.toMatch(/mountain-path|path-embed|path-walk/)
  })

  it('requires a private mask to cover the real outward side beyond the old top and decorative padding', () => {
    let value = certifyCompositionContent(content(bundle(true).project))
    value = applyCompositionDraftCommands(value, [{ ...createArea, visibility: 'gm' } as CompositionCommand], runtime)
    value = applyCompositionDraftCommands(value, [makeRock], runtime)
    value = applyCompositionDraftCommands(value, [{ ...createShell(), widthMm: 1400 } as CompositionCommand], runtime)
    const gm = projectScene(value.document, 'gm', value.appearance, { floorId }), padding = Math.max(1100, terrainDecorationPadding(value.document, gm.theme, floorId))
    const tight = cloneJson(value.document), top = terrainPoints(tight.terrainAreas.rock)
    const left = Math.min(...top.map(p => p.x)) - padding, right = Math.max(...top.map(p => p.x)) + padding
    const upper = Math.min(...top.map(p => p.y)) - padding, bottom = Math.max(...top.map(p => p.y)) + padding
    tight.regions['privacy-mask'].boundaryMm = [{ x: left, y: upper }, { x: right, y: upper }, { x: right, y: bottom }, { x: left, y: bottom }]
    expect(Object.values(savedShell(tight).verticesMm).some(p => p.x < left || p.x > right || p.y < upper || p.y > bottom)).toBe(true)
    const vertical = cloneJson(tight)
    delete vertical.terrainAreas.rock.rockBody!.shell
    expect(() => projectScene(vertical, 'player', value.appearance, { floorId })).not.toThrow()
    expect(() => projectScene(tight, 'player', value.appearance, { floorId })).toThrow(/遮罩|私密几何/)
  })

  it('adopts, undoes, redoes, removes and cold-reads the complete actual shell with monotonic history', async () => {
    const repository = new ProjectRepository({ name: `rock-shell-composition-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repository)
    const workspace = new Workspace(repository, { runtime, validation }); workspaces.push(workspace)
    await workspace.adoptNew(await fromBundle(bundle(), validation))
    await workspace.execute([createArea]); await workspace.execute([makeRock]); await workspace.execute([createShell()])
    const original = cloneJson(savedShell(workspace.getDocument()!)), originalToken = cloneJson(workspace.getState().project!.historyIdentity.outdoorTokens.rock)
    const originalPaint = projectScene(workspace.getDocument()!, 'gm', workspace.getState().project!.appearance, { floorId }).rocks
    let revision = workspace.getDocument()!.revision
    workspace.undo()
    expect(workspace.getDocument()!.terrainAreas.rock.rockBody!.shell).toBeUndefined()
    expect(workspace.getDocument()!.revision).toBeGreaterThan(revision); revision = workspace.getDocument()!.revision
    workspace.redo()
    expect(savedShell(workspace.getDocument()!)).toEqual(original)
    expect(workspace.getDocument()!.revision).toBeGreaterThan(revision)
    expect(workspace.getState().project!.historyIdentity.outdoorTokens.rock.topologyToken).not.toBe(originalToken.topologyToken)
    await workspace.execute([removeShell])
    expect(workspace.getDocument()!.terrainAreas.rock.rockBody!.shell).toBeUndefined()
    workspace.undo()
    expect(savedShell(workspace.getDocument()!)).toEqual(original)
    const checkpoint = workspace.checkpoint()
    await expect(workspace.execute([{ type: 'setTerrainElevation', id: 'rock', groundElevationMm: 3000 }])).rejects.toThrow(/刚性XY|高程/)
    expect(workspace.checkpoint()).toBe(checkpoint)
    await workspace.flush()
    const cold = (await repository.load(workspace.getDocument()!.sceneId))!
    expect(cold.project.document).toEqual(workspace.getDocument())
    expect(cold.project.historyIdentity).toEqual(workspace.getState().project!.historyIdentity)
    expect(savedShell(cold.project.document)).toEqual(original)
    expect(projectScene(cold.project.document, 'gm', cold.project.appearance, { floorId }).rocks).toEqual(originalPaint)
    expect(projectScene(cold.project.document, 'player', cold.project.appearance, { floorId }).rocks).toEqual(originalPaint)
    const manual = { ...cold, project: cloneJson(cold.project) }, retained = savedShell(manual.project.document)
    retained.sections[1].state = 'manual'; Object.values(retained.faces)[0].state = 'manual'; retained.recipe.seed = 'different-recipe-retains-actual-mesh'
    const read = await fromBundle(manual, validation)
    expect(savedShell(read.document)).toEqual(retained)
    const damaged = { ...cold, project: cloneJson(cold.project) }
    delete savedShell(damaged.project.document).verticesMm[Object.keys(original.verticesMm)[0]]
    await expect(fromBundle(damaged, validation)).rejects.toThrow(/侧壳|引用|完整|几何/)
  })
})
