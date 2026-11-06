import { describe, expect, it } from 'vitest'
import { fixture as workspaceFixture } from '../../application/workspace/test-fixtures.js'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import type { PointMm, SceneDocument } from '../model/scene.js'
import { cloneJson } from '../validation/json.js'
import { sampleConnectionRoute } from './connection-route.js'
import { connectionFootprint, corridor, polygonsOverlap, propFootprint, validateGeometry, validatePropGeometry, validatePropMoveGeometry } from './geometry.js'

const point = (x: number, y: number): PointMm => ({ x, y })

function expectEquivalent(baseline: SceneDocument, candidate: SceneDocument, changedIds: string[]) {
  const before = validateGeometry(baseline)
  expect(before.errors).toEqual([])
  const result = validatePropMoveGeometry(candidate, changedIds, before.warnings)
  expect(result).toEqual(validateGeometry(candidate))
  return { before, result }
}

function curvedFixture(): SceneDocument {
  const base = createRefinedBlankDocument('island', { sceneId: 'prop-derivation-curve', title: 'Curved route derivation',
    widthMm: 24000, heightMm: 18000, preset: 'narrative', now: '2026-11-06T00:00:00.000Z' })
  const scene = emptyCompositionDocument(base)
  scene.terrainAreas.high = { id: 'high', floorId: 'visual-floor', editLocked: false, visibility: 'public',
    boundaryMm: [point(10000, 0), point(24000, 0), point(24000, 18000), point(10000, 18000)]
      .map((positionMm, i) => ({ id: `high-point-${i}`, segmentId: `high-segment-${i}`, positionMm })),
    groundElevationMm: 1800, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  const routeSource = { version: 1 as const, kind: 'cubic' as const,
    segments: [{ id: 'curved-route-segment', start: point(6000, 10000), end: point(14000, 10000), control1: point(6000, 2000), control2: point(14000, 2000) }],
    sampleSpacingMm: 800, toleranceMm: 20, stairStyle: 'stone' as const, treadDepthMm: 250 }
  scene.terrainConnections.stairs = { id: 'stairs', floorId: 'visual-floor', editLocked: false, visibility: 'public', kind: 'stairs',
    from: { surfaceRef: { kind: 'floor', id: 'visual-floor' }, positionMm: point(6000, 10000) },
    to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: point(14000, 10000) },
    widthMm: 1000, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null,
    route: { ...routeSource, centerlineMm: sampleConnectionRoute(routeSource) } }
  const template = workspaceFixture().project.document.props.item
  scene.props.blocker = { ...cloneJson(template), id: 'blocker', floorId: 'visual-floor', supportRef: { kind: 'floor', id: 'visual-floor' },
    positionMm: point(1000, 1000), rotationDeg: 0, footprintMm: { width: 200, height: 200 }, footprintOffsetMm: point(0, 0),
    visualBoundsMm: { x: -100, y: -100, width: 200, height: 200 }, blocksMovement: true }
  scene.entityLayers.high = 'visual-layer-ground'; scene.entityLayers.stairs = 'visual-layer-ground'; scene.entityLayers.blocker = 'visual-layer-props'
  return scene
}

describe('proven position-only prop geometry derivation', () => {
  it('matches complete geometry for an actual move/rotation and independently copies unchanged draft warnings', () => {
    const baseline = workspaceFixture({ building: true }).project.document
    const candidate = cloneJson(baseline)
    candidate.props.item.positionMm = point(5000, 5500); candidate.props.item.rotationDeg = 37
    const { before, result } = expectEquivalent(baseline, candidate, ['item'])
    expect(result.errors).toEqual([])
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'DRAFT_ACCESS', entityId: 'room' }))
    expect(result.warnings).not.toBe(before.warnings)
    expect(result.warnings[0]).not.toBe(before.warnings[0])
    result.warnings[0].message = 'caller-local warning'
    expect(before.warnings[0].message).not.toBe('caller-local warning')
  })

  it('checks the complete rotated offset footprint against the unchanged room support', () => {
    const baseline = workspaceFixture({ building: true }).project.document
    const prop = baseline.props.item
    prop.supportRef = { kind: 'room', id: 'room' }; prop.roomId = 'room'
    prop.positionMm = point(9650, 9500); prop.rotationDeg = 180
    prop.footprintMm = { width: 800, height: 200 }; prop.footprintOffsetMm = point(400, 0)
    prop.visualBoundsMm = { x: -100, y: -100, width: 200, height: 200 }
    const candidate = cloneJson(baseline)
    candidate.props.item.rotationDeg = 90
    const { result } = expectEquivalent(baseline, candidate, ['item'])
    expect(result.errors).toEqual([{ code: 'PROP_SUPPORT', message: '完整旋转占地须位于声明的有效支撑面内。', entityId: 'item' }])
  })

  it('preserves full validation error order for physical bounds, visual bounds and support failures', () => {
    const baseline = workspaceFixture().project.document
    const prop = baseline.props.item
    prop.positionMm = point(10000, 3000); prop.footprintMm = { width: 800, height: 200 }; prop.footprintOffsetMm = point(500, 0)
    prop.visualBoundsMm = { x: -300, y: -100, width: 600, height: 200 }
    const candidate = cloneJson(baseline)
    candidate.props.item.positionMm.x = 19900
    const { result } = expectEquivalent(baseline, candidate, ['item'])
    expect(result.errors.map(issue => issue.code)).toEqual(['OUTSIDE_FLOOR', 'OUTSIDE_FLOOR', 'PROP_SUPPORT'])
    expect(validatePropGeometry(candidate, [candidate.props.item])).toEqual(result.errors)
  })

  it('rejects entry into higher-priority terrain without changing the declared support', () => {
    const baseline = curvedFixture(), candidate = cloneJson(baseline)
    candidate.props.blocker.positionMm = point(12000, 14000)
    const { result } = expectEquivalent(baseline, candidate, ['blocker'])
    expect(result.errors.map(issue => issue.code)).toEqual(['PROP_SUPPORT'])
  })

  it('rechecks new blocking footprints against the actual curved connection instead of its endpoint chord', () => {
    const baseline = curvedFixture(), candidate = cloneJson(baseline), prop = candidate.props.blocker
    prop.positionMm = point(9800, 4000); prop.rotationDeg = 45
    const connection = candidate.terrainConnections.stairs
    expect(polygonsOverlap(connectionFootprint(connection), propFootprint(prop))).toBe(true)
    expect(polygonsOverlap(corridor(connection.from.positionMm, connection.to.positionMm, connection.widthMm), propFootprint(prop))).toBe(false)
    const { result } = expectEquivalent(baseline, candidate, ['blocker'])
    expect(result.errors).toEqual([{ code: 'CONNECTION_OBSTACLE', message: '连接净宽带被物件占地阻挡。', entityId: 'stairs' }])
    // The same geometry with a nonblocking prop never gains blocking semantics.
    const nonblockingBaseline = cloneJson(baseline), nonblockingCandidate = cloneJson(candidate)
    nonblockingBaseline.props.blocker.blocksMovement = false; nonblockingCandidate.props.blocker.blocksMovement = false
    expect(expectEquivalent(nonblockingBaseline, nonblockingCandidate, ['blocker']).result.errors).toEqual([])
  })

  it('keeps current prop record order when changed IDs are duplicated or reordered', () => {
    const baseline = curvedFixture(), first = baseline.props.blocker
    baseline.props.second = { ...cloneJson(first), id: 'second', positionMm: point(2000, 1000) }
    baseline.entityLayers.second = baseline.entityLayers.blocker
    const candidate = cloneJson(baseline)
    candidate.props.blocker.positionMm = point(9800, 4000)
    candidate.props.second.positionMm = point(9600, 4100)
    const { result } = expectEquivalent(baseline, candidate, ['second', 'blocker', 'second'])
    expect(result.errors).toHaveLength(2)
  })
})
