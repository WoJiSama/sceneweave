import { describe, expect, it } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import type { AuthoringStart } from './authoring-protocol.js'
import type { PointMm } from '../model/scene.js'
import { authoringProjectHash, applyAuthoringStep, replayAuthoring } from './authoring.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { emptyVisualSystem } from '../visual/types.js'
import { proposeAuthoringTerrainBoundary } from './visual-authoring.js'
import { inspectIslandBoundaryProposal } from './island-composition.js'
import { planForBrief } from './plan.js'

const asymmetricRing: PointMm[] = [{ x: 6000, y: 5000 }, { x: 11000, y: 4000 }, { x: 15000, y: 6000 }, { x: 12000, y: 8000 },
  { x: 15500, y: 11000 }, { x: 12000, y: 14500 }, { x: 6500, y: 13000 }, { x: 7500, y: 9000 }]
function fixture(points = asymmetricRing) {
  const project = cloneJson(svgProjectFixture().bundle.project), scene = project.document
  project.schemaVersion = 2; scene.schemaVersion = 2; scene.visual = emptyVisualSystem()
  const floorId = Object.keys(scene.floors)[0], layerId = scene.entityLayers.item, boundsMm = scene.floors[floorId].boundsMm
  const source: AuthoringStart = { schemaVersion: 1, project, baseContentHash: authoringProjectHash(project), preparedAt: '2026-10-25T00:00:00.000Z', seed: '70859a22-1bd4-45e3-9a82-96dc5da14af3',
    disclosure: 'complete-metadata/public-model', skill: { id: 'sceneweave-scene-authoring', version: 1 }, scope: { targetIds: [], operations: [], placement: null,
      scene: { floorId, layerId, boundsMm, entityIds: [], definitionIds: [], prefabDefinitionIds: [], materialIds: [], operations: ['terrain'] },
      visual: { floorId, layerId, boundsMm, entityIds: [], definitionIds: [], materialIds: [], operations: ['visualBoundary'] } } }
  const built = applyAuthoringStep(source, replayAuthoring(source, []).state, [{ kind: 'terrain', id: 'real-land', boundaryMm: points, groundElevationMm: 800 }], 'land')
  const allowed = new Set(built.state.changedIds), scope = source.scope.visual!
  const proposal = proposeAuthoringTerrainBoundary(built.project, scope, allowed, { areaId: 'real-land', boundaryId: 'real-coast' })
  return { source, project: built.project, state: built.state, allowed, scope, proposal }
}

describe('finite authorised island boundary shape review', () => {
  it('measures real asymmetric concave anchors and the fixed sampled candidate without editing them or awarding appearance approval', () => {
    const subject = fixture(), operation = subject.proposal.candidateOperation, before = canonicalJson({ project: subject.project, state: subject.state, operation })
    const review = inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, operation)
    expect(review).toMatchObject({ sourceAnchorCount: 8, anchorsPreserved: true, appearance: 'unconfirmed' })
    expect(review.sourceCorners.concave).toBeGreaterThan(0)
    expect(review.sourceCorners.convex).toBeGreaterThan(0)
    expect(review.candidateCorners.concave).toBeGreaterThan(0)
    expect(Object.values(review.sourceAxisMismatchRatio).every(value => value > .01)).toBe(true)
    expect(review.sampledOutlineChangeMm.maxOutward).toBeGreaterThan(0)
    expect(review.sampledOutlineChangeMm.maxInward).toBeGreaterThan(0)
    expect(operation.segments.map(segment => segment.start)).toEqual(asymmetricRing)
    expect(review.basis).toContain('No aesthetic')
    expect(inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, operation)).toEqual(review)
    expect(canonicalJson({ project: subject.project, state: subject.state, operation })).toBe(before)
    const edit = applyAuthoringStep(subject.source, subject.state, [operation], 'explicit-coast')
    expect(edit.project.document.visual!.boundaries['real-coast'].segments).toEqual(operation.segments)
  })

  it('flags a symmetric four-anchor ring honestly instead of claiming smoothing created an irregular coastline', () => {
    const subject = fixture([{ x: 7000, y: 10000 }, { x: 11000, y: 7000 }, { x: 15000, y: 10000 }, { x: 11000, y: 13000 }])
    const review = inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, subject.proposal.candidateOperation)
    expect(review.sourceAxisMismatchRatio).toEqual({ leftRight: 0, topBottom: 0, halfTurn: 0 })
    expect(review.warnings).toEqual(expect.arrayContaining(['few_source_anchors', 'source_axis_symmetry', 'source_has_no_concave_corner']))
    expect(review.candidateToSourceAreaRatio).toBeGreaterThan(1)
    expect(review.guidance).toContain('cannot invent an asymmetric bay')
    expect(review.sampledOutlineChangeMm.maxInward).toBe(0)
  })

  it('never reads unrelated private geometry and rejects private, ungranted or forged source-anchor candidates', () => {
    const subject = fixture(), operation = subject.proposal.candidateOperation
    const before = inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, operation)
    const hidden = cloneJson(subject.project.document.terrainAreas['real-land'])
    hidden.id = 'PRIVATE_TERRAIN_SHOULD_NOT_APPEAR'; hidden.visibility = 'gm'
    subject.project.document.terrainAreas[hidden.id] = hidden
    expect(inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, operation)).toEqual(before)
    expect(JSON.stringify(before)).not.toContain('PRIVATE_')
    expect(() => inspectIslandBoundaryProposal(subject.project, subject.scope, new Set(), operation)).toThrow(/明确授权/)
    const forged = cloneJson(operation); forged.segments[0].start.x += 1
    expect(() => inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, forged)).toThrow(/真实锚点/)
    const outside = cloneJson(subject.scope); outside.boundsMm = { x: 1000, y: 1000, width: 1000, height: 1000 }
    expect(() => inspectIslandBoundaryProposal(subject.project, outside, subject.allowed, operation)).toThrow()
    subject.project.document.terrainAreas['real-land'].visibility = 'gm'
    expect(() => inspectIslandBoundaryProposal(subject.project, subject.scope, subject.allowed, operation)).toThrow(/公开/)
  })

  it('keeps the island recipe grounded in granted variants, material overlays and neutral human appearance review', () => {
    const recipe = planForBrief({ recipe: 'island', requirements: ['Readable rocky island'] }).recipeGuidance.join(' ')
    for (const phrase of ['asymmetric anchors', 'visibly exposed rock shelf', 'shapeReview', 'bounded rock-in-grass', 'three genuinely different tree silhouettes', 'legacy blank', 'only one tree/rock source', 'neutral/effects-off']) expect(recipe).toContain(phrase)
    expect(recipe).toContain('under an explicit terrainUpdate grant')
    expect(recipe).toContain('geometry alone cannot verify')
    expect(recipe).toContain('instead of inventing a key')
  })
})
