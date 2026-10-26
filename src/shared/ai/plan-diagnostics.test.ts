import { describe, expect, it } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { diagnoseAuthoringProject, planForBrief, type AuthoringBrief } from './plan.js'
import { authoringProjectHash, authoringAssetPage, replayAuthoring } from './authoring.js'
import type { AuthoringStart } from './authoring-protocol.js'

const box = { x: 2000, y: 2000, width: 6000, height: 6000 }
function fixture() {
  const project = cloneJson(svgProjectFixture().bundle.project), scene = project.document
  project.schemaVersion = 2; scene.schemaVersion = 2; scene.visual = emptyVisualSystem()
  const prop = scene.props.item
  prop.blocksMovement = true; prop.positionMm = { x: 3000, y: 3000 }; prop.visualBoundsMm = { x: -2000, y: -2000, width: 4000, height: 4000 }; prop.footprintMm = { width: 100, height: 100 }
  return project
}
describe('immutable recipe evidence and actual image composition diagnostics', () => {
  it('uses rotated image bounds instead of tiny footprints while ignoring private and decorative overlap', () => {
    const project = fixture(), first = project.document.props.item
    project.document.props.second = { ...cloneJson(first), id: 'second', positionMm: { x: 3500, y: 3500 }, rotationDeg: 45 }
    project.document.props.secret = { ...cloneJson(first), id: 'secret', visibility: 'gm' }
    project.document.props.rug = { ...cloneJson(first), id: 'rug', blocksMovement: false, renderLayer: 'ground' }
    const report = diagnoseAuthoringProject(project, new Set(['item', 'second', 'secret', 'rug']))
    expect(report.composition.majorCount).toBe(2)
    expect(report.composition.excessivePairs).toContainEqual({ ids: ['item', 'second'], overlapOfSmallerImage: expect.any(Number) })
    expect(report.composition.excessivePairs[0].overlapOfSmallerImage).toBeGreaterThan(.5)
    expect(report.issues).toContainEqual({ code: 'authorized_major_image_overlap', ids: ['item', 'second'], severity: 'warning' })
    expect(JSON.stringify(report)).not.toContain('secret')
  })
  it('requires the explicit six metre region to remain walkable and free of the actual image, not only its anchor', () => {
    const project = fixture(), brief: AuthoringBrief = { recipe: 'beach', requirements: ['six metre clear space'], checks: [{ kind: 'clearArea', id: 'activity', floorId: Object.keys(project.document.floors)[0], boundsMm: box, minimumWidthMm: 6000, avoidVisual: true }] }
    const blocked = diagnoseAuthoringProject(project, new Set(['item']), brief)
    expect(blocked.evidence[0]).toMatchObject({ status: 'missing', evidenceIds: ['item'] })
    project.document.props.item.positionMm = { x: 11000, y: 11000 }
    const clear = diagnoseAuthoringProject(project, new Set(['item']), brief)
    expect(clear.evidence[0].status).toBe('supported')
    expect(clear.requirements[0].status).toBe('needs_human_review')
    project.document.regions.hazard = { id: 'hazard', floorId: Object.keys(project.document.floors)[0], editLocked: false, visibility: 'public', kind: 'hazard', boundaryMm: [{ x: 3000, y: 3000 }, { x: 4000, y: 3000 }, { x: 4000, y: 4000 }, { x: 3000, y: 4000 }], blocksMovement: true, movementCostMultiplier: 1 }
    expect(diagnoseAuthoringProject(project, new Set(['item', 'hazard']), brief).evidence[0]).toMatchObject({ status: 'missing', evidenceIds: ['hazard'] })
    expect(diagnoseAuthoringProject(project, new Set(['item']), brief).evidence[0].status).toBe('supported')
  })
  it('requires separate reef groups and actual room furniture/materials instead of claims or room names', () => {
    const project = fixture(), scene = project.document, floorId = Object.keys(scene.floors)[0]
    scene.props.item.visualBoundsMm = { x: -100, y: -100, width: 200, height: 200 }
    scene.rooms.kitchen = { id: 'kitchen', floorId, editLocked: false, boundaryVertexIds: [], purpose: '厨房 kitchen', visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0, floorStyle: null }
    const brief: AuthoringBrief = { recipe: 'interior', requirements: ['working kitchen'], checks: [
      { kind: 'propCount', id: 'reefs', definitionIds: ['definition'], minimum: 2, groups: [{ boundsMm: box, minimum: 1 }, { boundsMm: { ...box, x: 9000 }, minimum: 1 }] },
      { kind: 'roomRole', id: 'kitchen', purposeTerms: ['厨房'], definitionIds: ['definition'], minimumProps: 1 },
    ] }
    expect(diagnoseAuthoringProject(project, new Set(['item', 'kitchen']), brief).evidence.map(value => value.status)).toEqual(['missing', 'missing'])
    scene.props.item.supportRef = { kind: 'room', id: 'kitchen' }; scene.props.item.roomId = 'kitchen'
    scene.props.second = { ...cloneJson(scene.props.item), id: 'second', positionMm: { x: 11000, y: 4000 } }
    const result = diagnoseAuthoringProject(project, new Set(['item', 'second', 'kitchen']), brief)
    expect(result.evidence.map(value => value.status)).toEqual(['supported', 'supported'])
  })
  it('requires two actual terrain elevations and an open full width connection plus real enabled edge kinds', () => {
    const project = fixture(), scene = project.document, floorId = Object.keys(scene.floors)[0], common = { floorId, editLocked: false, visibility: 'public' as const }
    for (const [id, height] of [['low', 500], ['high', 2500]] as const) scene.terrainAreas[id] = { id, ...common, boundaryMm: [], groundElevationMm: height, coveragePriority: height, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.terrainConnections.stairs = { id: 'stairs', ...common, kind: 'stairs', from: { surfaceRef: { kind: 'terrainArea', id: 'low' }, positionMm: { x: 0, y: 0 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'high' }, positionMm: { x: 0, y: 1000 } }, widthMm: 1200, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
    const brief: AuthoringBrief = { recipe: 'island', requirements: ['two heights with stairs and grass/cliff'], checks: [
      { kind: 'elevationConnection', id: 'height', minimumLevels: 2, minimumDeltaMm: 1000, minimumWidthMm: 1000, connectionKinds: ['stairs'] },
      { kind: 'edgeKinds', id: 'edge', kinds: ['cliff', 'grass'] },
    ] }
    expect(diagnoseAuthoringProject(project, new Set(['low', 'high', 'stairs']), brief).evidence.map(value => value.status)).toEqual(['supported', 'missing'])
    scene.terrainConnections.stairs.blocksMovement = true
    expect(diagnoseAuthoringProject(project, new Set(['low', 'high', 'stairs']), brief).evidence[0].status).toBe('missing')
    scene.terrainConnections.stairs.blocksMovement = false
    expect(diagnoseAuthoringProject(project, new Set(['low', 'stairs']), brief).evidence[0].status).toBe('missing')
  })
  it('rejects evidence grants outside authorization and returns explicit rendered dimensions in the palette', () => {
    const project = cloneJson(svgProjectFixture().bundle.project), floorId = Object.keys(project.document.floors)[0], layerId = project.document.entityLayers.item
    const start: AuthoringStart = { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), seed: 'b9f1f3bd-f028-43b8-865c-b09b0ea4357d', preparedAt: '2026-10-25T00:00:00.000Z', disclosure: 'complete-metadata/public-model', skill: { id: 'sceneweave-scene-authoring', version: 1 },
      scope: { targetIds: [], operations: [], placement: null, scene: { floorId, layerId, boundsMm: { x: 0, y: 0, width: 12000, height: 12000 }, entityIds: [], definitionIds: ['definition'], materialIds: [], prefabDefinitionIds: [], operations: ['furnish'] } } }
    expect(authoringAssetPage(start, '', 1).assets[0]).toMatchObject({ imageWidthMm: project.document.propDefinitions.definition.defaultVisualBoundsMm.width, visualBoundsMm: expect.any(Object), footprintMm: expect.any(Object) })
    start.brief = { recipe: 'beach', requirements: ['three reefs'], checks: [{ kind: 'propCount', id: 'bad', definitionIds: ['private-definition'], minimum: 3 }] }
    expect(() => replayAuthoring(start, [])).toThrow(/未获授权/)
    start.brief.checks = [{ kind: 'clearArea', id: 'outside', floorId, boundsMm: { ...box, x: 15000 }, minimumWidthMm: 6000, avoidVisual: true }]
    expect(() => replayAuthoring(start, [])).toThrow(/冻结范围/)
    start.brief.checks = [{ kind: 'propCount', id: 'overlapping', definitionIds: ['definition'], minimum: 2, groups: [{ boundsMm: box, minimum: 1 }, { boundsMm: { ...box, x: 3000 }, minimum: 1 }] }]
    expect(() => replayAuthoring(start, [])).toThrow(/不可重叠/)
    expect(planForBrief({ recipe: 'island', requirements: ['two heights'] }).recipeGuidance.join(' ')).toContain('explicit stairs/ramp connection')
  })
  it('reports repeated-source concentration, sampled ground exposure and specific repairs without counting hidden props', () => {
    const project = fixture(), scene = project.document, first = scene.props.item, floorId = first.floorId
    scene.terrainAreas.land = { id: 'land', floorId, editLocked: false, visibility: 'public', boundaryMm: [{ x: 1000, y: 1000 }, { x: 7000, y: 1000 }, { x: 7000, y: 7000 }, { x: 1000, y: 7000 }].map((positionMm, i) => ({ id: `p${i}`, segmentId: `s${i}`, positionMm })),
      groundElevationMm: 500, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    const ids = new Set(['land', 'item'])
    for (let i = 1; i <= 4; i++) { const id = `same-${i}`; ids.add(id); scene.props[id] = { ...cloneJson(first), id, positionMm: { x: 3000 + i * 400, y: 3100 + i * 300 } } }
    scene.props.PRIVATE_HIDDEN_SHAPE = { ...cloneJson(first), id: 'PRIVATE_HIDDEN_SHAPE', visibility: 'gm' }; ids.add('PRIVATE_HIDDEN_SHAPE')
    const report = diagnoseAuthoringProject(project, ids)
    expect(report.repairs.concentratedRepeatedShapes[0]).toMatchObject({ count: 5, concentrated: true })
    expect(report.repairs.groundExposure[0].exposedSampleFraction).toBeLessThan(.4)
    expect(report.repairs.suggestions.map(value => value.code)).toContain('major_image_overlap')
    expect(report.repairs.suggestions.map(value => value.code)).toContain('low_sampled_ground_exposure')
    expect(JSON.stringify(report)).not.toContain('PRIVATE_HIDDEN_SHAPE')
    expect(report.repairs.appearance).toBe('unconfirmed')
  })
})
