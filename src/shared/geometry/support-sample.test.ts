import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { createCarvedStrip, type CarvedRockHost } from '../carved-rock/index.js'
import type { Prop, SceneDocument, TerrainArea } from '../model/scene.js'
import { connectionFootprint, pointOnSurface, supportedPolygon, supportSurfaceAt, validateGeometry, validatePropGeometry } from './geometry.js'
import { createSupportQuery, levelGroundPolygon, supportSampleAt } from './support-sample.js'
import { assertTerrainConnectionClearances, checkTerrainRoute, checkTerrainTravel } from './terrain-travel.js'
import { deriveAggregatePortGeometry } from '../aggregates/ports.js'
import { createHistoryIdentity, createHistoryIdentityTrace } from '../history/identity.js'
import { applyAttachmentCommand, createEmbeddedAttachmentPlan, syncNewAttachmentProofs, type AttachmentSurface } from '../attachments/index.js'
import { cloneJson } from '../validation/json.js'
import { materializeTerrainTransition } from '../visual/transition.js'
import { emptyVisualSystem } from '../visual/types.js'
import { createAppearanceGraph, addPropAppearanceSource } from '../appearance/graph.js'
import { createTerrainDressingCatalogDocument, TERRAIN_DRESSING_ART, terrainDressingDefinitionId } from '../../platform/browser/content/terrain-dressing-catalog.js'
import { planTerrainDressing } from '../visual/terrain-dressing.js'
import { createPublicVisibility, publicTerrainView } from './visibility.js'

const floorId = 'visual-floor'
const rect = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
function fixture(startX = 6000): SceneDocument {
  const scene = createRefinedBlankDocument('coast', { title: 'actual carved support', widthMm: 24000, heightMm: 18000, preset: 'narrative', sceneId: 'actual-cut', now: '2026-11-16T00:00:00.000Z' })
  const rock: TerrainArea & CarvedRockHost = { id: 'rock', floorId, editLocked: false, visibility: 'public', groundElevationMm: 2000, rockBody: { baseElevationMm: -500 }, coveragePriority: 1,
    boundaryMm: rect(6000, 4000, 14000, 10000).map((positionMm, i) => ({ id: 'rock-p' + i, segmentId: 'rock-s' + i, positionMm })), surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  let sequence = 0
  const strip = createCarvedStrip(rock, { attachmentId: 'embed', walkSurfaceId: 'walk', sourceSegmentIds: ['rock-s0'], cutSide: 'right', widthMm: 1000,
    pointsMm: [{ x: startX, y: 6000, z: 0 }, { x: 18000, y: 6000, z: 2000 }] }, { ids: { nextId: () => 'cut-' + ++sequence } })
  scene.terrainAreas.rock = rock
  scene.terrainConnections.ramp = { id: 'ramp', floorId, editLocked: false, visibility: 'public', kind: 'ramp', widthMm: 1000, carvedStrip: strip,
    from: { surfaceRef: { kind: 'floor', id: floorId }, positionMm: { x: startX, y: 6000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'rock' }, positionMm: { x: 18000, y: 6000 } }, openingId: null, blocksMovement: false, movementCostMultiplier: 1.2, surfaceStyle: null }
  return scene
}
const item = (positionMm: { x: number; y: number }, footprint = 300): Prop => ({ id: 'item', floorId, editLocked: false, definitionRef: null, appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 },
  visualBoundsMm: { x: -footprint / 2, y: -footprint / 2, width: footprint, height: footprint }, positionMm, rotationDeg: 0, footprintMm: { width: footprint, height: footprint }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false,
  visibility: 'public', supportRef: { kind: 'terrainArea', id: 'rock' }, renderLayer: 'object', renderOrder: 0, shadowClass: 'none', shadowOverride: null })

function withRealAttachmentProofs(scene: SceneDocument) {
  const ramp = scene.terrainConnections.ramp; delete scene.terrainConnections.ramp
  scene.entityLayers.rock = 'visual-layer-ground'
  let serial = 0
  const runtime = { ids: { nextId: () => 'proof-' + ++serial }, clock: { now: () => scene.updatedAt } }
  let identity = createHistoryIdentity(scene, runtime), before = cloneJson(scene), trace = createHistoryIdentityTrace(identity, before, runtime)
  applyAttachmentCommand(scene, { type: 'addAttachmentSurface', id: 'source-face', owner: { kind: 'terrainArea', id: 'rock' }, feature: { kind: 'rockSourceFace', sourceSegmentIds: ['rock-s0'] }, capabilities: ['embed'] }, runtime, identity)
  syncNewAttachmentProofs(before, scene, trace.capture(scene)); identity = trace.finish(scene)
  before = cloneJson(scene); trace = createHistoryIdentityTrace(identity, before, runtime)
  scene.terrainConnections.ramp = ramp; scene.entityLayers.ramp = 'visual-layer-ground'
  scene.attachmentSurfaces!.walk = { id: 'walk', owner: { kind: 'terrainConnection', id: 'ramp' }, feature: { kind: 'carvedWalk', faceIds: [...ramp.carvedStrip!.walkFaceIds] }, capabilities: ['support', 'walk'] } as AttachmentSurface
  const plan = createEmbeddedAttachmentPlan(scene, { id: 'embed', connectionId: 'ramp', surfaceIds: ['source-face'], follow: 'fixed', managedScope: 'wholeStrip', anchorState: 'managed' }, identity)
  ;(scene.attachments ??= {}).embed = plan.attachment
  syncNewAttachmentProofs(before, scene, trace.capture(scene)); trace.finish(scene)
  return scene
}

describe('actual carved ground support and complete-width travel', () => {
  it('rejects room support from another Floor even when its footprint and root coordinates coincide', () => {
    const scene = fixture(), p = { x: 12000, y: 9000 }, polygon = rect(11500, 8500, 1000, 1000)
    scene.floors.other = { ...cloneJson(scene.floors[floorId]), id: 'other' }
    const boundaryVertexIds = polygon.map((point, i) => {
      const id = 'other-room-v' + i
      scene.vertices[id] = { id, floorId: 'other', editLocked: false, xMm: point.x, yMm: point.y }
      return id
    })
    scene.rooms.other = { id: 'other', floorId: 'other', editLocked: false, boundaryVertexIds, purpose: 'other Floor',
      visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'terrainArea', id: 'rock' }, groundElevationMm: 2000, floorStyle: null }
    const ref = { kind: 'room' as const, id: 'other' }, prop = { ...item(p), supportRef: ref }
    expect(pointOnSurface(scene, p, ref, floorId)).toBe(false)
    expect(supportedPolygon(scene, polygon, ref, floorId)).toBe(false)
    expect(validatePropGeometry(scene, [prop]).some(issue => issue.code === 'PROP_SUPPORT')).toBe(true)
  })

  it('returns root identity separately from interpolated height, slope and apron capability', () => {
    const scene = fixture(), p = { x: 12000, y: 6000 }
    expect(supportSurfaceAt(scene, p, floorId)).toEqual({ kind: 'terrainArea', id: 'rock' })
    const sample = supportSampleAt(scene, floorId, p)!
    expect(sample).toMatchObject({ rootSupportRef: { kind: 'terrainArea', id: 'rock' }, actualSurfaceId: 'walk', zMm: 1000, walkable: true, sourceConnectionId: 'ramp' })
    expect(sample.normal.x).toBeLessThan(0)
    expect(sample.normal.z).toBeGreaterThan(.9)
    expect(supportSampleAt(scene, floorId, { x: 12000, y: 4500 })).toMatchObject({ zMm: 1000, walkable: false, sourceConnectionId: 'ramp' })
    expect(supportSampleAt(scene, floorId, { x: 12000, y: 7000 })).toMatchObject({ zMm: 2000, walkable: true })
    expect(supportSampleAt(scene, floorId, p, 'unselected-missing-surface')).toBeNull()
  })

  it('accepts a real full-width floor landing at the host boundary and traverses the whole continuous ramp', () => {
    const scene = fixture()
    expect(validateGeometry(scene).errors).toEqual([])
    expect(checkTerrainTravel(scene, { floorId, from: { x: 5000, y: 6000 }, to: { x: 19000, y: 6000 }, widthMm: 1000 })).toEqual({ ok: true, issues: [] })
    const route = checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 5000, y: 6000 }, { x: 19000, y: 6000 }], widthMm: 1000 })
    expect(route.ok).toBe(true)
    expect(route.connectionIds).toEqual(['ramp'])
    expect(route.supportRefs).toEqual([{ kind: 'floor', id: floorId }, { kind: 'terrainArea', id: 'rock' }])
    expect(() => assertTerrainConnectionClearances(scene, [{ connectionId: 'ramp', minWidthMm: 1000, approachDepthMm: 1000 }])).not.toThrow()
    expect(connectionFootprint(scene.terrainConnections.ramp)).toHaveLength(4)
  })

  it('refuses a same-height metadata endpoint whose full floor approach is actually inside rock', () => {
    const scene = fixture(7000)
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'CARVED_CONNECTION_APPROACH')).toBe(true)
  })

  it('enters from the actual selected cliff through a level full-width landing before climbing along it', () => {
    const scene = fixture(), rock = scene.terrainAreas.rock as TerrainArea & CarvedRockHost
    let sequence = 0
    const strip = createCarvedStrip(rock, { attachmentId: 'embed', walkSurfaceId: 'walk', sourceSegmentIds: ['rock-s0'], cutSide: 'right', widthMm: 1000,
      pointsMm: [{ x: 8500, y: 4000, z: 0 }, { x: 8500, y: 6000, z: 0 }, { x: 18000, y: 6000, z: 2000 }] }, { ids: { nextId: () => 'entry-' + ++sequence } })
    scene.terrainConnections.ramp.carvedStrip = strip
    scene.terrainConnections.ramp.from.positionMm = { x: 8500, y: 4000 }
    expect(validateGeometry(scene).errors).toEqual([])
    expect(checkTerrainRoute(scene, { floorId, pointsMm: [{ x: 8500, y: 3000 }, { x: 8500, y: 6000 }, { x: 19000, y: 6000 }], widthMm: 1000 }).ok).toBe(true)
    expect(checkTerrainTravel(scene, { floorId, from: { x: 7000, y: 3000 }, to: { x: 7000, y: 6000 }, widthMm: 500 }).ok).toBe(false)
  })

  it('cannot cross the real inner cut wall using the shared root ID', () => {
    const scene = fixture()
    const result = checkTerrainTravel(scene, { floorId, from: { x: 12000, y: 6000 }, to: { x: 12000, y: 8000 }, widthMm: 200 })
    expect(result.ok).toBe(false)
    expect(result.issues.some(issue => issue.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)
    // The actual full-width strip remains walkable while the untouched cliff
    // away from its landing still requires a height connection.
    expect(checkTerrainTravel(scene, { floorId, from: { x: 5000, y: 8000 }, to: { x: 8000, y: 8000 }, widthMm: 200 }).ok).toBe(false)
  })

  it('checks an apron sliver reached only by the outside of the requested full-width band', () => {
    const scene = fixture()
    expect(checkTerrainTravel(scene, { floorId, from: { x: 8000, y: 5600 }, to: { x: 16000, y: 5600 }, widthMm: 200 }).ok).toBe(true)
    expect(checkTerrainTravel(scene, { floorId, from: { x: 8000, y: 5600 }, to: { x: 16000, y: 5600 }, widthMm: 220 }).issues.some(issue => issue.code === 'TERRAIN_NOT_WALKABLE')).toBe(true)
    expect(checkTerrainTravel(scene, { floorId, from: { x: 8000, y: 6000 }, to: { x: 16000, y: 6000 }, widthMm: 1001 }).ok).toBe(false)
  })

  it('rejects flat prop and room-style polygons over any actual lowered/slope fragment even when all corners miss it', () => {
    const scene = fixture(), ref = { kind: 'terrainArea' as const, id: 'rock' }
    expect(pointOnSurface(scene, { x: 12000, y: 6000 }, ref, floorId)).toBe(false)
    expect(supportedPolygon(scene, rect(8000, 5000, 8000, 3000), ref, floorId)).toBe(false)
    expect(validatePropGeometry(scene, [item({ x: 12000, y: 6000 })]).map(issue => issue.code)).toContain('PROP_SUPPORT')
    expect(validatePropGeometry(scene, [item({ x: 12000, y: 8000 })])).toEqual([])
    const topPoint = { x: 18000, y: 6000 }
    expect(supportSampleAt(scene, floorId, topPoint)?.zMm).toBe(2000)
    expect(pointOnSurface(scene, topPoint, ref, floorId)).toBe(false)
    const interiorCut = fixture(7000), enclosing = rect(6500, 4500, 12500, 3500)
    expect(enclosing.every(point => pointOnSurface(interiorCut, point, ref, floorId))).toBe(true)
    expect(supportedPolygon(interiorCut, enclosing, ref, floorId)).toBe(false)
  })

  it('keeps complete physical blockers and closed/blocked connection state authoritative', () => {
    const scene = fixture()
    scene.regions.block = { id: 'block', floorId, editLocked: false, visibility: 'public', kind: 'hazard', boundaryMm: rect(11900, 6400, 200, 200), blocksMovement: true, movementCostMultiplier: 1 }
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'CONNECTION_OBSTACLE')).toBe(true)
    delete scene.regions.block
    scene.terrainConnections.ramp.blocksMovement = true
    expect(checkTerrainTravel(scene, { floorId, from: { x: 5000, y: 6000 }, to: { x: 19000, y: 6000 }, widthMm: 1000 }).ok).toBe(false)
  })

  it('refuses room ends, old route coexistence, wrong kind and invalid rock height', () => {
    const scene = fixture()
    scene.terrainConnections.ramp.kind = 'stairs'
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'CARVED_STRIP_INVALID')).toBe(true)
    scene.terrainConnections.ramp.kind = 'ramp'
    scene.terrainConnections.ramp.from.surfaceRef = { kind: 'room', id: 'missing' }
    expect(validateGeometry(scene).errors.length).toBeGreaterThan(0)
    scene.terrainAreas.rock.rockBody!.baseElevationMm = 2000
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'ROCK_BODY_HEIGHT')).toBe(true)
  })

  it('captures query geometry per operation and observes edits in the next operation', () => {
    const scene = fixture(), first = createSupportQuery(scene, floorId), p = { x: 12000, y: 6000 }
    expect(first.sample(p)?.zMm).toBe(1000)
    delete scene.terrainConnections.ramp
    expect(first.sample(p)?.zMm).toBe(1000)
    expect(createSupportQuery(scene, floorId).sample(p)?.zMm).toBe(2000)
  })

  it('derives complete aggregate ramp ports from the actual strip endpoints', () => {
    const scene = withRealAttachmentProofs(fixture())
    scene.aggregateCoordinates = { encoding: 'world', groups: { group: { id: 'group', floorId, parentId: null, editLocked: false, frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'terrainConnection', id: 'ramp' }] } } }
    const base = { id: 'port', groupId: 'group' }
    expect(deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'from' } })).toMatchObject({ positionMm: { x: 6000, y: 6000 }, elevationMm: 0, directionDeg: 180, currentlyPassable: true })
    expect(deriveAggregatePortGeometry(scene, { ...base, endpoint: { kind: 'terrainConnection', id: 'ramp', end: 'to' } })).toMatchObject({ positionMm: { x: 18000, y: 6000 }, elevationMm: 2000, directionDeg: 0, currentlyPassable: true })
  })

  it('keeps unrelated flat-road contact legal while refusing full bands intersecting any saved cut', () => {
    const scene = fixture(), refs = [{ kind: 'terrainArea' as const, id: 'rock' }]
    expect(levelGroundPolygon(scene, floorId, rect(8000, 8000, 8000, 1000), refs, 2000)).toBe(true)
    expect(levelGroundPolygon(scene, floorId, rect(8000, 6000, 8000, 1000), refs, 2000)).toBe(false)
    expect(levelGroundPolygon(scene, floorId, rect(8000, 4500, 8000, 200), refs, 2000)).toBe(false)
  })

  it('rejects internal actual-geometry IDs colliding with scene and attachment records', () => {
    const scene = fixture(), strip = cloneJson(scene.terrainConnections.ramp.carvedStrip!)
    const old = strip.stations[0].centerVertexId
    strip.verticesMm[floorId] = strip.verticesMm[old]; delete strip.verticesMm[old]
    for (const row of strip.stations) if (row.centerVertexId === old) row.centerVertexId = floorId
    for (const row of Object.values(strip.faces)) row.vertexIds = row.vertexIds.map(id => id === old ? floorId : id) as [string, string, string]
    scene.terrainConnections.ramp.carvedStrip = strip
    expect(validateGeometry(scene).errors.some(issue => issue.code === 'CARVED_STRIP_ID' && issue.entityId === floorId)).toBe(true)
  })

  it('rejects a constant-height transition only when its final local polygons touch actual cut geometry', () => {
    const scene = fixture(), material = Object.values(scene.materials)[0]
    material.name = 'rock'; material.tags = ['rock']
    scene.terrainAreas.rock.surfaceStyle = { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
    const bind = (y: number) => {
      const a = { x: 8000, y }, b = { x: 16000, y }
      scene.paths.path = { id: 'path', floorId, editLocked: false, visibility: 'public', centerlineMm: [a, b], widthMm: 200, supportRefs: [{ kind: 'terrainArea', id: 'rock' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
      scene.visual = { version: 3, base: { version: 2, base: { ...emptyVisualSystem(), boundaries: { edge: { id: 'edge', floorId, layerId: 'visual-layer-ground', visibility: 'public', editLocked: false, closed: false, segments: [{ id: 'edge-s', start: a, control1: a, control2: b, end: b }], sampleSpacingMm: 1000, toleranceMm: 10, binding: { kind: 'path', pathId: 'path' } } } }, materializedEdges: {} }, transitions: {} }
      return { id: 'transition', boundaryId: 'edge', kind: 'pathShoulder' as const, side: 'both' as const, widthMm: 200, clipMm: { x: 7500, y: y - 300, width: 9000, height: 600 } }
    }
    expect(() => materializeTerrainTransition(scene, bind(6000))).toThrow(/实际输出触及山路或切口/)
    expect(materializeTerrainTransition(scene, bind(9000)).polygons.length).toBeGreaterThan(0)
  })

  it('preserves unrelated terrain dressing while excluding both walk and apron and avoiding secret-dependent public patterns', () => {
    const scene = withRealAttachmentProofs(fixture())
    const other = cloneJson(scene.terrainAreas.rock); other.id = 'other'; delete other.rockBody
    other.boundaryMm = rect(6000, 14500, 14000, 2500).map((positionMm, i) => ({ id: 'other-p' + i, segmentId: 'other-s' + i, positionMm }))
    scene.terrainAreas.other = other; scene.entityLayers.other = 'visual-layer-ground'
    const content = { document: scene, appearance: createAppearanceGraph(scene) }, catalog = createTerrainDressingCatalogDocument()
    Object.assign(content.document.assets, catalog.assets); Object.assign(content.document.propDefinitions, catalog.propDefinitions)
    for (const art of TERRAIN_DRESSING_ART) {
      const def = content.document.propDefinitions[terrainDressingDefinitionId(art.key)]
      addPropAppearanceSource(content.appearance, { definitionRef: { id: def.id, version: def.version }, appearance: def.defaultAppearance, visualBoundsMm: def.defaultVisualBoundsMm, shadowClass: def.defaultShadowClass, shadowOverride: null }, null, art.presentation)
    }
    const request = { sceneId: scene.sceneId, floorId, seed: 'actual-cut-dressing' }, plan = planTerrainDressing(content, request)
    expect(plan.report.notes.some(note => note.includes('已有实际岩体切口'))).toBe(true)
    expect(plan.commands.some(command => command.type === 'createScatter' && command.domain.kind === 'area' && command.domain.areaId === 'rock')).toBe(true)
    expect(plan.commands.some(command => command.type === 'upsertScatterExclusion' && command.exclusion.boundaryMm.some(point => point.y < 4000))).toBe(true)
    content.document.terrainConnections.ramp.visibility = 'gm'
    const hidden = planTerrainDressing(content, request)
    expect(hidden.commands.some(command => command.type === 'createScatter' && command.domain.kind === 'area' && command.domain.areaId === 'rock')).toBe(false)
    expect(hidden.commands.some(command => command.type === 'createScatter' && command.domain.kind === 'area' && command.domain.areaId === 'other')).toBe(true)
  })

  it('filters a secret cut before public support/travel and keeps only complete public surface/relation ownership', () => {
    const scene = withRealAttachmentProofs(fixture()), p = { x: 12000, y: 6000 }
    expect(publicTerrainView(scene).terrainConnections.ramp).toBeDefined()
    scene.terrainConnections.ramp.visibility = 'gm'
    const publicView = publicTerrainView(scene)
    expect(publicView.terrainConnections.ramp).toBeUndefined()
    expect(publicView.attachmentSurfaces!.walk).toBeUndefined()
    expect(publicView.attachments!.embed).toBeUndefined()
    expect(publicView.attachmentSurfaces!['source-face']).toBeDefined()
    expect(supportSampleAt(publicView, floorId, p)).toMatchObject({ actualSurfaceId: 'terrainArea:rock', zMm: 2000 })
    expect(supportSampleAt(scene, floorId, p)?.zMm).toBe(1000)
    expect(checkTerrainTravel(publicView, { floorId, from: { x: 8000, y: 5000 }, to: { x: 16000, y: 7000 }, widthMm: 200 }).ok).toBe(true)
    const hiddenHost = withRealAttachmentProofs(fixture()); hiddenHost.terrainAreas.rock.visibility = 'gm'
    expect(createPublicVisibility(hiddenHost).terrainConnection('ramp')).toBe(false)
    expect(publicTerrainView(hiddenHost).terrainConnections.ramp).toBeUndefined()
  })

  it('inherits prop privacy through the entire selected attachment ancestry and fails closed on cycles', () => {
    const scene = fixture(); delete scene.terrainConnections.ramp
    scene.props.host = { ...item({ x: 10000, y: 9000 }), id: 'host', visibility: 'gm' }
    scene.props.child = { ...item({ x: 10000, y: 9000 }), id: 'child' }
    scene.props.grandchild = { ...item({ x: 10000, y: 9000 }), id: 'grandchild' }
    const surface = (id: string, ownerId: string) => ({ id, owner: { kind: 'prop', id: ownerId }, feature: { kind: 'propTop', polygonLocalMm: rect(-300, -300, 600, 600), heightLocalMm: 1000 }, capabilities: ['support'], proofs: { lineageId: 'lineage', owner: { birthToken: 'birth' } } }) as AttachmentSurface
    scene.attachmentSurfaces = { hostTop: surface('hostTop', 'host'), childTop: surface('childTop', 'child') }
    const relation = (id: string, childId: string, surfaceId: string) => ({ id, mode: 'support', child: { kind: 'prop', id: childId }, surfaceId }) as NonNullable<SceneDocument['attachments']>[string]
    scene.attachments = { childRelation: relation('childRelation', 'child', 'hostTop'), grandchildRelation: relation('grandchildRelation', 'grandchild', 'childTop') }
    expect(createPublicVisibility(scene).prop(scene.props.grandchild)).toBe(false)
    expect(publicTerrainView(scene).props).toEqual({})
    scene.props.host.visibility = 'public'
    expect(createPublicVisibility(scene).prop(scene.props.grandchild)).toBe(true)
    scene.attachments.cycle = relation('cycle', 'host', 'childTop')
    expect(createPublicVisibility(scene).prop(scene.props.grandchild)).toBe(false)
  })
})
