import { visualBase } from '../visual/base.js'
import { describe, expect, it } from 'vitest'
import { compositionCandidateFixture } from '../../../tests/helpers/composition-candidates-fixture.js'
import { canonicalJson } from '../validation/json.js'
import { openingEndpoints, polygonsOverlap } from '../geometry/geometry.js'
import { applyAuthoringStep, replayAuthoring } from './authoring.js'
import { connectCompositionRooms, proposeAuthoringComposition } from './composition-candidates.js'
import { authoringPropVisualPolygon, inspectCompositionRepairs } from './plan-diagnostics.js'
import { sampleVisualBoundary, terrainBoundaryChain } from '../visual/geometry.js'
import type { AuthoringOperation } from './authoring-protocol.js'

describe('finite composition candidates reuse ordinary scene operations', () => {
  it.each(['beach', 'island', 'interior'] as const)('fully replays %s layouts and preserves the frozen input', recipe => {
    const start = compositionCandidateFixture(), initial = replayAuthoring(start, []), before = canonicalJson(start)
    const query = { kind: 'layout' as const, recipe, idPrefix: `candidate-${recipe}`, materialIds: { base: 'tile', primary: 'tile', secondary: 'tile' } }
    const result = proposeAuthoringComposition(initial.project, start, new Set(), query)
    const preview = applyAuthoringStep(start, initial.state, result.candidateOperations, 'candidate')
    const complete = connectCompositionRooms(preview.project, start, query, result.candidateOperations)
    const final = applyAuthoringStep(start, initial.state, complete, 'candidate')
    expect(final.state.operationCost).toBeGreaterThan(complete.length)
    expect(final.state.operationCost).toBeLessThan(180)
    expect(canonicalJson(start)).toBe(before)
    expect(result.appearance).toBe('unconfirmed')
    if (recipe === 'interior') {
      expect(Object.values(final.project.document.rooms)).toHaveLength(5)
      expect(Object.values(final.project.document.openings)).toHaveLength(5)
      expect(final.project.document.constraints.entranceOpeningIds).toEqual(['candidate-interior-entrance'])
      expect(Object.values(final.project.document.rooms).map(room => room.purpose).join(' ')).toContain('厨房')
    } else if (recipe === 'island') {
      expect(Object.values(final.project.document.terrainConnections)).toHaveLength(1)
      expect(new Set(Object.values(final.project.document.terrainAreas).map(area => area.groundElevationMm)).size).toBe(3)
    }
  })
  it('alternates real variants with mutually separated full images while reserving the activity rectangle', () => {
    const start = compositionCandidateFixture(), state = replayAuthoring(start, []).state, clear = { x: 7000, y: 6000, width: 6000, height: 6000 }
    const query = { kind: 'furnishing' as const, idPrefix: 'reef', definitionIds: ['definition', 'alternate'], supportRef: { kind: 'floor' as const, id: start.scope.scene!.floorId },
      positionMm: { x: 7000, y: 6500 }, count: 6, keepClearBoundsMm: [clear] }
    const result = proposeAuthoringComposition(start.project, start, new Set(), query), next = applyAuthoringStep(start, state, result.candidateOperations, 'reef')
    expect(result.candidateOperations).toHaveLength(6)
    const props = Object.values(next.project.document.props)
    expect(props.map(prop => prop.definitionRef!.id)).toEqual(['definition', 'alternate', 'definition', 'alternate', 'definition', 'alternate'])
    const reserved = [{ x: 7000, y: 6000 }, { x: 13000, y: 6000 }, { x: 13000, y: 12000 }, { x: 7000, y: 12000 }]
    for (let i = 0; i < props.length; i++) {
      const image = authoringPropVisualPolygon(props[i]); expect(polygonsOverlap(image, reserved)).toBe(false)
      for (const other of props.slice(i + 1)) expect(polygonsOverlap(image, authoringPropVisualPolygon(other))).toBe(false)
    }
    expect(proposeAuthoringComposition(start.project, start, new Set(), query)).toEqual(result)
  })
  it('binds the beach shared coast on both physical sides and fits the full normal shore band inside the grant', () => {
    const start = compositionCandidateFixture(); start.scope.visual!.operations.push('visualBoundary', 'visualEdge')
    const initial = replayAuthoring(start, []), proposal = proposeAuthoringComposition(start.project, start, new Set(), { kind: 'layout', recipe: 'beach', idPrefix: 'coast' })
    const built = applyAuthoringStep(start, initial.state, proposal.candidateOperations, 'land')
    const anchors = (proposal.details as { sharedCoastAnchorsMm: { x: number; y: number }[] }).sharedCoastAnchorsMm
    const water = built.project.document.terrainAreas['coast-water'], sand = built.project.document.terrainAreas['coast-sand']
    const at = (area: typeof water, point: { x: number; y: number }) => area.boundaryMm.find(value => value.positionMm.x === point.x && value.positionMm.y === point.y)!.id
    const first = anchors[0], last = anchors.at(-1)!
    const boundary: AuthoringOperation = { kind: 'visualBoundary', id: 'coast-shared', closed: false,
      segments: anchors.slice(0, -1).map((point, index) => ({ id: `coast-control-${index}`, start: point, control1: point, control2: anchors[index + 1], end: anchors[index + 1] })),
      sampleSpacingMm: 2500, toleranceMm: 200, binding: { kind: 'terrain', sides: [
        { areaId: water.id, startPointId: at(water, first), endPointId: at(water, last), reverse: false },
        { areaId: sand.id, startPointId: at(sand, last), endPointId: at(sand, first), reverse: true },
      ] } }
    const shore: AuthoringOperation = { kind: 'visualEdge', id: 'coast-foam', boundaryId: boundary.id, edgeKind: 'shore', side: 'right', widthMm: 500,
      color: '#FFFFFF', accentColor: '#DDD7B0', opacity: .8, intensity: 1, seed: 'coast-foam', repeatMm: 900, enabled: true }
    const final = applyAuthoringStep(start, built.state, [boundary, shore], 'shore'), curve = visualBase(final.project.document)!.boundaries[boundary.id]
    const sampled = sampleVisualBoundary(curve).points
    for (const side of curve.binding.kind === 'terrain' ? curve.binding.sides : []) {
      const chain = terrainBoundaryChain(final.project.document.terrainAreas[side.areaId], side, curve.closed).map(value => value.positionMm)
      expect(side.reverse ? chain.slice().reverse() : chain).toEqual(sampled)
    }
    expect(visualBase(final.project.document)!.edgeLooks['coast-foam'].widthMm).toBe(500)
    expect(final.state.operationCost).toBeLessThan(256)
    expect(replayAuthoring(start, final.state.steps)).toEqual(final)
  })
  it.each(['beach', 'island'] as const)('replays the alternate %s composition without changing the sampling or format contract', recipe => {
    const start = compositionCandidateFixture(), initial = replayAuthoring(start, [])
    const proposal = proposeAuthoringComposition(start.project, start, new Set(), { kind: 'layout', recipe, idPrefix: 'alternative', variant: 1 })
    const applied = applyAuthoringStep(start, initial.state, proposal.candidateOperations, 'alternate')
    expect(applied.project.schemaVersion).toBe(2)
    expect(applied.project.document.visual!.version).toBe(1)
    expect(Object.values(visualBase(applied.project.document)!.boundaries)).toHaveLength(0)
    expect(applied.state.operationCost).toBeGreaterThan(proposal.candidateOperations.length)
  })
  it('maps texture and light parameters to real operations, preserving aspect ratio and refusing ungranted targets', () => {
    const start = compositionCandidateFixture(), initial = replayAuthoring(start, [])
    const layout = proposeAuthoringComposition(start.project, start, new Set(), { kind: 'layout', recipe: 'island', idPrefix: 'land', materialIds: { base: 'tile', primary: 'tile', secondary: 'tile' } })
    const built = applyAuthoringStep(start, initial.state, layout.candidateOperations, 'land')
    const result = proposeAuthoringComposition(built.project, start, new Set(built.state.changedIds), { kind: 'style', surfaceIds: ['land-low'], includeEnvironment: true })
    const next = applyAuthoringStep(start, built.state, result.candidateOperations, 'style')
    expect(next.project.document.terrainAreas['land-low'].surfaceStyle!.base.tileSizeMm).toEqual({ width: 3200, height: 1600 })
    expect(visualBase(next.project.document)!.environment.lightDirectionDeg).toBe(65)
    expect(JSON.stringify(result.details)).toContain('lineWeightMm_requires_matching_fixed_art')
    expect(() => proposeAuthoringComposition(built.project, start, new Set(), { kind: 'style', surfaceIds: ['land-low'] })).toThrow(/授权/)
    expect(() => proposeAuthoringComposition(start.project, start, new Set(), { kind: 'furnishing', idPrefix: 'denied', supportRef: { kind: 'floor', id: start.scope.scene!.floorId }, definitionIds: ['PRIVATE_DEFINITION'], positionMm: { x: 4000, y: 4000 } })).toThrow(/授权/)
  })
  it('identifies exact authorised door and stair blockers while withholding private passages', () => {
    const start = compositionCandidateFixture(), initial = replayAuthoring(start, [])
    const query = { kind: 'layout' as const, recipe: 'interior' as const, idPrefix: 'inn' }
    const rooms = proposeAuthoringComposition(start.project, start, new Set(), query)
    const preview = applyAuthoringStep(start, initial.state, rooms.candidateOperations, 'rooms')
    const built = applyAuthoringStep(start, initial.state, connectCompositionRooms(preview.project, start, query, rooms.candidateOperations), 'rooms')
    const placed = applyAuthoringStep(start, built.state, [{ kind: 'furnish', id: 'blocker', definitionId: 'definition', supportRef: { kind: 'room', id: 'inn-common' }, positionMm: { x: 6000, y: 5000 } }], 'prop')
    const scene = placed.project.document, door = scene.openings['inn-entrance'], [a, b] = openingEndpoints(scene, door)
    scene.props.blocker.positionMm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const ids = new Set(placed.state.changedIds)
    const report = inspectCompositionRepairs(placed.project, ids)
    expect(report.passageClearance).toContainEqual({ kind: 'door', id: 'inn-entrance', widthMm: 1100, blockerIds: ['blocker'] })
    expect(report.suggestions).toContainEqual({ code: 'blocked_passage_clearance', ids: ['inn-entrance', 'blocker'], action: expect.stringContaining('complete passage width') })
    door.secret = true
    expect(JSON.stringify(inspectCompositionRepairs(placed.project, ids))).not.toContain('inn-entrance')
    const island = proposeAuthoringComposition(start.project, start, new Set(), { kind: 'layout', recipe: 'island', idPrefix: 'island' })
    const lands = applyAuthoringStep(start, initial.state, island.candidateOperations, 'land')
    const props = applyAuthoringStep(start, lands.state, [{ kind: 'furnish', id: 'stair-blocker', definitionId: 'definition', supportRef: { kind: 'terrainArea', id: 'island-high' }, positionMm: { x: 14000, y: 9000 } }], 'prop')
    props.project.document.props['stair-blocker'].positionMm = { ...props.project.document.terrainConnections['island-stairs'].to.positionMm }
    const stairs = inspectCompositionRepairs(props.project, new Set(props.state.changedIds)).passageClearance
    expect(stairs).toContainEqual({ kind: 'stairs', id: 'island-stairs', widthMm: 1350, blockerIds: ['stair-blocker'] })
  })
})
