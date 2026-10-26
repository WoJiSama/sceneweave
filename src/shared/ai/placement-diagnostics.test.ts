import { describe, expect, it } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import type { AuthoringStart } from './authoring-protocol.js'
import { authoringProjectHash } from './authoring.js'
import { probeAuthoringPlacement } from './placement-diagnostics.js'
import { polygonDistance, polygonsOverlap } from '../geometry/geometry.js'
import { authoringPropVisualPolygon } from './plan-diagnostics.js'

function fixture() {
  const project = cloneJson(svgProjectFixture().bundle.project), scene = project.document, floorId = Object.keys(scene.floors)[0], layerId = scene.entityLayers.item
  const area = (id: string, left: number, top: number, right: number, bottom: number, priority: number) => ({ id, floorId, editLocked: false, visibility: 'public' as const,
    boundaryMm: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }].map((positionMm, index) => ({ id: `${id}-point-${index}`, segmentId: `${id}-segment-${index}`, positionMm })),
    groundElevationMm: priority * 500, coveragePriority: priority, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 })
  scene.terrainAreas.low = area('low', 1000, 1000, 11000, 11000, 1); scene.terrainAreas.high = area('high', 4000, 4000, 8000, 8000, 2)
  const start: AuthoringStart = { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), preparedAt: '2026-10-25T00:00:00.000Z', seed: 'b9f1f3bd-f028-43b8-865c-b09b0ea4357d', disclosure: 'complete-metadata/public-model', skill: { id: 'sceneweave-scene-authoring', version: 1 },
    scope: { targetIds: [], operations: [], placement: null, scene: { floorId, layerId, boundsMm: { x: 1000, y: 1000, width: 10000, height: 10000 }, entityIds: ['low', 'high'], definitionIds: ['definition'], prefabDefinitionIds: [], materialIds: [], operations: ['furnish'] } } }
  return { project, start }
}
describe('finite read-only public placement probe', () => {
  it('reports effective support and measured clearance, suggesting deterministic coordinates without writing a draft', () => {
    const { project, start } = fixture(), before = canonicalJson(project), ids = new Set(['low', 'high'])
    const query = { definitionId: 'definition', supportRef: { kind: 'terrainArea' as const, id: 'low' }, positionMm: { x: 6000, y: 6000 }, minimumClearanceMm: 150, limit: 5 }
    const result = probeAuthoringPlacement(project, start, ids, query)
    expect(result.tested).toMatchObject({ feasible: false, actualGroundSupport: { kind: 'terrainArea', id: 'high' }, selectedSupportFitsWholeFootprint: false })
    expect(result.candidates).toHaveLength(5)
    expect(result.candidates.every(candidate => candidate.feasible && candidate.clearanceMm >= 150 && candidate.actualGroundSupport?.id === 'low')).toBe(true)
    expect(probeAuthoringPlacement(project, start, ids, query)).toEqual(result)
    expect(canonicalJson(project)).toBe(before)
    expect(result.basis).toContain('authorized public subset')
  })
  it('keeps suggestions in the explicit bounds, excludes ungranted private geometry and refuses unknown definitions/supports', () => {
    const { project, start } = fixture(), ids = new Set(['low', 'high'])
    project.document.props.SECRET_GM = { ...cloneJson(project.document.props.item), id: 'SECRET_GM', visibility: 'gm', positionMm: { x: 2500, y: 2500 } }
    start.scope.scene!.boundsMm = { x: 1500, y: 1500, width: 2000, height: 2000 }
    const query = { definitionId: 'definition', supportRef: { kind: 'terrainArea' as const, id: 'low' }, positionMm: { x: 2500, y: 2500 }, minimumClearanceMm: 0 }
    const result = probeAuthoringPlacement(project, start, ids, query)
    expect(JSON.stringify(result)).not.toContain('SECRET_GM')
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every(candidate => candidate.insideFrozenBounds && candidate.positionMm.x >= 1500 && candidate.positionMm.x <= 3500)).toBe(true)
    expect(() => probeAuthoringPlacement(project, start, ids, { ...query, definitionId: 'private-definition' })).toThrow(/explicitly granted/)
    expect(() => probeAuthoringPlacement(project, start, new Set(['high']), query)).toThrow(/explicitly granted/)
  })
  it('returns a whole group with mutually clear image rectangles rather than multiple nearby overlapping single suggestions', () => {
    const { project, start } = fixture(), definition = project.document.propDefinitions.definition
    definition.defaultVisualBoundsMm = { x: -600, y: -400, width: 1200, height: 800 }
    const query = { definitionId: 'definition', supportRef: { kind: 'terrainArea' as const, id: 'low' }, positionMm: { x: 2500, y: 2500 }, rotationDeg: 30, minimumClearanceMm: 150, limit: 5 }
    const result = probeAuthoringPlacement(project, start, new Set(['low', 'high']), query)
    expect(result.candidates).toHaveLength(5)
    const polygons = result.candidates.map(candidate => authoringPropVisualPolygon({ ...project.document.props.item, positionMm: candidate.positionMm, rotationDeg: result.rotationDeg, visualBoundsMm: result.visualBoundsMm }))
    for (let index = 0; index < polygons.length; index++) for (const other of polygons.slice(index + 1)) {
      expect(polygonsOverlap(polygons[index], other)).toBe(false)
      expect(polygonDistance(polygons[index], other)).toBeGreaterThanOrEqual(150)
    }
    const edge = probeAuthoringPlacement(project, start, new Set(['low', 'high']), { ...query, positionMm: { x: 1300, y: 2500 }, rotationDeg: 0 })
    expect(edge.tested).toMatchObject({ feasible: false, selectedSupportFitsWholeFootprint: true, selectedSupportFitsWholeImage: false })
  })
})
