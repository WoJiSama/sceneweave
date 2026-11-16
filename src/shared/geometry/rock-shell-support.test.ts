import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCarvedStrip } from '../carved-rock/index.js'
import { createRockShellSampler, generateRockShell, type RockShellHost } from '../rock-shell/index.js'
import type { PointMm, Prop, SceneDocument, TerrainArea } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { pointInPolygon, pointOnSurface, supportedPolygon, supportSurfaceAt, terrainPoints, validateGeometry, validatePropGeometry } from './geometry.js'
import { createSupportQuery, levelGroundPolygon, supportSampleAt } from './support-sample.js'
import { checkTerrainRoute, checkTerrainTravel } from './terrain-travel.js'

const floorId = 'visual-floor'
const rect = (x: number, y: number, width: number, height: number): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
let serial = 0
const ids = { nextId: () => 'shell-support-' + ++serial }
const intent = (excludedSegmentIds: string[] = []) => ({ footSurfaceRef: { kind: 'floor' as const, id: floorId }, footElevationMm: 0, widthMm: 1000, direction: { x: 0, y: 1 }, seed: 'actual-shell', excludedSegmentIds })
function host(id: string, points = rect(6000, 4000, 14000, 10000)): TerrainArea & RockShellHost {
  return { id, floorId, editLocked: false, visibility: 'public', groundElevationMm: 2000, rockBody: { baseElevationMm: -500 }, coveragePriority: 1,
    boundaryMm: points.map((positionMm, i) => ({ id: id + '-p' + i, segmentId: id + '-s' + i, positionMm })), surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
}
function fixture(excludedSegmentIds: string[] = []): SceneDocument {
  const scene = createRefinedBlankDocument('coast', { title: 'actual rock shell support', widthMm: 24000, heightMm: 18000, preset: 'narrative', sceneId: 'actual-shell', now: '2026-11-16T00:00:00.000Z' })
  const rock = host('rock')
  rock.rockBody!.shell = generateRockShell(rock, intent(excludedSegmentIds), { ids })
  scene.terrainAreas.rock = rock
  return scene
}
function sidePoint(scene: SceneDocument): PointMm {
  const rock = scene.terrainAreas.rock, sampler = createRockShellSampler(rock.rockBody!.shell!)
  for (const face of sampler.triangles) {
    const p = { x: Math.round(face.verticesMm.reduce((n, v) => n + v.x, 0) / 3), y: Math.round(face.verticesMm.reduce((n, v) => n + v.y, 0) / 3) }
    if (!pointInPolygon(p, terrainPoints(rock)) && sampler.sample(p)) return p
  }
  throw new Error('fixture must contain a real projected side face')
}
const item = (positionMm: PointMm, supportRef: Prop['supportRef']): Prop => ({ id: 'item', floorId, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
  positionMm, rotationDeg: 0, footprintMm: { width: 20, height: 20 }, footprintOffsetMm: { x: 0, y: 0 }, visualBoundsMm: { x: -10, y: -10, width: 20, height: 20 }, blocksMovement: false, blocksSight: false,
  visibility: 'public', supportRef, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null })

describe('persistent rock shell physical support', () => {
  it('keeps the original top ring and returns the shell owner with its actual height and normal', () => {
    const scene = fixture(), p = sidePoint(scene), rock = scene.terrainAreas.rock, actual = createRockShellSampler(rock.rockBody!.shell!).sample(p)!
    expect(terrainPoints(rock)).toEqual(rect(6000, 4000, 14000, 10000))
    expect(validateGeometry(scene).errors).toEqual([])
    expect(supportSurfaceAt(scene, p, floorId)).toEqual({ kind: 'terrainArea', id: 'rock' })
    expect(supportSampleAt(scene, floorId, p)).toMatchObject({ rootSupportRef: { kind: 'terrainArea', id: 'rock' }, actualSurfaceId: actual.faceId, zMm: actual.zMm, normal: actual.normal, walkable: false, sourceRockShellAreaId: 'rock' })
    expect(supportSampleAt(scene, floorId, { x: 12000, y: 9000 })).toMatchObject({ actualSurfaceId: 'terrainArea:rock', zMm: 2000, walkable: true })
  })

  it('rejects ordinary props and level roads on the side regardless of a floor or host root claim', () => {
    const scene = fixture(), p = sidePoint(scene)
    for (const ref of [{ kind: 'floor' as const, id: floorId }, { kind: 'terrainArea' as const, id: 'rock' }]) {
      expect(pointOnSurface(scene, p, ref, floorId)).toBe(false)
      expect(supportedPolygon(scene, rect(p.x - 10, p.y - 10, 20, 20), ref, floorId)).toBe(false)
      expect(validatePropGeometry(scene, [item(p, ref)]).some(issue => issue.code === 'PROP_SUPPORT')).toBe(true)
      expect(levelGroundPolygon(scene, floorId, rect(p.x - 10, p.y - 10, 20, 20), [ref], 0)).toBe(false)
    }
    expect(supportedPolygon(scene, rect(8000, 8000, 2000, 2000), { kind: 'terrainArea', id: 'rock' }, floorId)).toBe(true)
  })

  it('checks complete floor support when all polygon corners miss an enclosed outward shell', () => {
    const scene = fixture(), polygon = rect(4000, 14100, 18000, 2000), ref = { kind: 'floor' as const, id: floorId }
    expect(polygon.every(point => pointOnSurface(scene, point, ref, floorId))).toBe(true)
    expect(supportedPolygon(scene, polygon, ref, floorId)).toBe(false)
    scene.paths.path = { id: 'path', floorId, editLocked: false, visibility: 'public', centerlineMm: [{ x: 4000, y: 14500 }, { x: 22000, y: 14500 }], widthMm: 100, supportRefs: [ref], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'PATH_SUPPORT')).toBe(true)
    delete scene.paths.path
    const boundaryVertexIds = polygon.map((point, i) => {
      const id = 'room-v' + i
      scene.vertices[id] = { id, floorId, xMm: point.x, yMm: point.y, editLocked: false }
      return id
    })
    scene.rooms.room = { id: 'room', floorId, editLocked: false, boundaryVertexIds, purpose: 'shell support must reject', visibility: 'public', accessExpectation: 'unspecified', supportRef: ref, groundElevationMm: 0, floorStyle: null }
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'ROOM_SUPPORT' && issue.entityId === 'room')).toBe(true)
  })

  it('treats side faces as nonwalkable in full-width travel and retains normal floor travel', () => {
    const scene = fixture(), p = sidePoint(scene)
    expect(checkTerrainTravel(scene, { floorId, from: p, to: { x: p.x + 30, y: p.y }, widthMm: 20 }).issues.some(issue => issue.code === 'TERRAIN_NOT_WALKABLE')).toBe(true)
    expect(checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 2000, y: 2000 }, { x: 22000, y: 2000 }], widthMm: 500 }).ok).toBe(true)
  })

  it('validates the true outer footprint against floor bounds and other terrain at any priority', () => {
    const scene = fixture(), outside = cloneJson(scene), p = sidePoint(scene)
    outside.floors[floorId].boundsMm = { x: 6000, y: 4000, width: 14000, height: 10000 }
    expect(validateGeometry(outside).errors.some(issue => issue.code === 'OUTSIDE_FLOOR' && issue.entityId === 'rock')).toBe(true)
    const low: TerrainArea = host('low', rect(p.x - 10, p.y - 10, 20, 20)); delete low.rockBody; low.groundElevationMm = 0; low.coveragePriority = 0
    scene.terrainAreas.low = low
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'ROCK_SHELL_TERRAIN_OVERLAP')).toBe(true)
  })

  it('rejects two real shells intersecting while their authored top rings stay separate', () => {
    const scene = fixture(), other = host('other', rect(1000, 4000, 4900, 10000))
    other.rockBody!.shell = generateRockShell(other, intent(), { ids })
    scene.terrainAreas.other = other
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'ROCK_SHELL_OVERLAP')).toBe(true)
  })

  it('rejects shell face identities colliding with another live scene entity', () => {
    const scene = fixture(), shell = cloneJson(scene.terrainAreas.rock.rockBody!.shell!), faceId = Object.keys(shell.faces)[0]
    shell.faces.item = { ...shell.faces[faceId], id: 'item' }; delete shell.faces[faceId]
    scene.terrainAreas.rock.rockBody!.shell = shell
    scene.props.item = item({ x: 12000, y: 9000 }, { kind: 'terrainArea', id: 'rock' })
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'ROCK_SHELL_ID' && issue.entityId === 'item')).toBe(true)
  })

  it('keeps a saved carved route and its original boundary entrance intact beside excluded shell edges', () => {
    const scene = fixture(['rock-s0', 'rock-s3']), rock = scene.terrainAreas.rock as TerrainArea & RockShellHost
    const strip = createCarvedStrip(rock, { attachmentId: 'embed', walkSurfaceId: 'walk', sourceSegmentIds: ['rock-s0'], cutSide: 'right', widthMm: 1000,
      pointsMm: [{ x: 6000, y: 6000, z: 0 }, { x: 18000, y: 6000, z: 2000 }] }, { ids })
    scene.terrainConnections.ramp = { id: 'ramp', floorId, editLocked: false, visibility: 'public', kind: 'ramp', widthMm: 1000, carvedStrip: strip,
      from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: { x: 6000, y: 6000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'rock' }, positionMm: { x: 18000, y: 6000 } }, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    expect(validateGeometry(scene).errors).toEqual([])
    expect(checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 5000, y: 6000 }, { x: 19000, y: 6000 }], widthMm: 1000 }).ok).toBe(true)
    expect(createSupportQuery(scene, floorId).sample({ x: 5500, y: 6000 })).toMatchObject({ rootSupportRef: { kind: 'floor', id: floorId }, zMm: 0, walkable: true })
    const forged = cloneJson(scene)
    forged.terrainAreas.rock.rockBody!.shell!.recipe.excludedSegmentIds = []
    expect(validateGeometry(forged).errors.some(issue => issue.code === 'ROCK_SHELL_CUT_CLEARANCE')).toBe(true)
  })
})
