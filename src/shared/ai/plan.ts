import { z } from 'zod'
import type { ProjectData } from '../model/project.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { corridor, openingEndpoints, polygonsOverlap, propFootprint } from '../geometry/geometry.js'
import { inspectBriefEvidence, inspectCompositionRepairs, inspectVisualComposition } from './plan-diagnostics.js'

const id = z.string().min(1).max(256)
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const bounds = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
const ids = z.array(id).min(1).max(16).refine(values => new Set(values).size === values.length)
export const AuthoringEvidenceCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clearArea'), id, floorId: id, boundsMm: bounds,
    minimumWidthMm: integer.positive(), avoidVisual: z.boolean() }).strict(),
  z.object({ kind: z.literal('propCount'), id, definitionIds: ids, minimum: z.number().int().min(1).max(64),
    groups: z.array(z.object({ boundsMm: bounds, minimum: z.number().int().min(1).max(16) }).strict()).max(8).optional() }).strict(),
  z.object({ kind: z.literal('elevationConnection'), id, minimumLevels: z.number().int().min(2).max(8), minimumDeltaMm: integer.positive(),
    minimumWidthMm: integer.positive(), connectionKinds: z.array(z.enum(['stairs', 'ramp'])).min(1).max(2) }).strict(),
  z.object({ kind: z.literal('roomRole'), id, purposeTerms: z.array(z.string().trim().min(1).max(40)).min(1).max(4),
    definitionIds: ids, minimumProps: z.number().int().min(1).max(32), materialId: id.optional() }).strict(),
  z.object({ kind: z.literal('edgeKinds'), id, kinds: z.array(z.enum(['shore', 'cliff', 'grass', 'path', 'fence'])).min(1).max(5) }).strict(),
])
export type AuthoringEvidenceCheck = z.infer<typeof AuthoringEvidenceCheckSchema>
export const AuthoringPhaseSchema = z.enum(['layout', 'surfaces', 'boundaries', 'furnishing', 'atmosphere', 'review'])
export const AuthoringBriefSchema = z.object({ recipe: z.enum(['beach', 'island', 'interior', 'custom']),
  requirements: z.array(z.string().trim().min(1).max(300)).min(1).max(16),
  requiredDefinitionIds: z.array(id).max(32).refine(values => new Set(values).size === values.length).optional(),
  checks: z.array(AuthoringEvidenceCheckSchema).max(16).refine(values => new Set(values.map(value => value.id)).size === values.length).optional(),
  style: z.object({ palette: z.array(z.string().regex(/^#[a-f0-9]{6}$/i)).min(1).max(8),
    lineWeightMm: z.number().int().min(1).max(200), textureScaleMm: z.number().int().min(10).max(20000),
    detailDensity: z.number().finite().min(0).max(1), lightDirectionDeg: z.number().finite().min(0).lt(360) }).strict().optional(),
}).strict()
export type AuthoringBrief = z.infer<typeof AuthoringBriefSchema>
export type AuthoringPhase = z.infer<typeof AuthoringPhaseSchema>
export const AuthoringPlanStateSchema = z.object({ phase: AuthoringPhaseSchema,
  requirements: z.array(z.object({ index: z.number().int().min(0).max(15), state: z.enum(['pending', 'claimed', 'unsupported']),
    evidenceIds: z.array(id).max(16).refine(values => new Set(values).size === values.length), note: z.string().max(300).optional() }).strict()).max(16),
}).strict()
export type AuthoringPlanState = z.infer<typeof AuthoringPlanStateSchema>
export const authoringPhases = ['layout', 'surfaces', 'boundaries', 'furnishing', 'atmosphere', 'review'] as const
const recipeGuidance = {
  beach: ['For a new layout, sceneweave_propose_composition kind=layout recipe=beach returns real shared coast anchors, a sand/water candidate, clear activity bounds and three reef-group centres. Read the granted palette and provide its actual material IDs. Review the full preview and edit its ordinary operations explicitly. The tool does not invent permission or adopt anything.',
    'For a 24x18m beach, reserve the explicitly checked 6m activity rectangle before placing props. Keep every real image rectangle out of that space.',
    'Create water and sand first. Read real point IDs once, then bind one shared continuous shoreline and one narrow shore look. Two terrain sides follow opposite directions.',
    'Build three spatially separated reef groups using the small granted rock art; use visualBoundsMm for spacing. Add modest shrubs/shells near the edges. Never substitute giant overlapping tree canopies for detail.',
    'Use concise stable IDs such as beach-water, beach-sand, beach-coast, reef-west-1/reef-centre-1/reef-east-1. IDs are choices, not extra authorisation.'],
  island: ['Create a water base plus two real land elevations and an explicit stairs/ramp connection before atmospheric decoration. Different drawing order is not a second elevation.',
    'For new land use sceneweave_propose_composition kind=layout recipe=island with an unused idPrefix and actual granted base/primary/secondary material IDs. Its finite asymmetric bay/headland and stair candidate is fully previewed and does not write the draft. It is one option, not a mandated final design. For an existing island, preserve its authorised anchors and choose only the explicitly granted correction.',
    'A compact 24x18m island can use a low rock shelf around a higher grass crown, with a straight shared step approach. For new authorised terrain, choose 6–10 intentional asymmetric anchors: vary the headlands, include a shallow bay and leave one broad activity area. Do not default to a cardinal diamond or concentric regular ellipses. Existing rings are not permission to move anchors; modify them only under an explicit terrainUpdate grant.',
    'Leave a visibly exposed rock shelf around the crown and a readable cliff face below the crest, with clear stair landings. Account for the actual edge-band width and prop image bounds. Cliff exposure and neutral tier readability still require appearance review; geometry alone cannot verify them.',
    'Before smoothing a small land ring, call sceneweave_propose_boundary for each authorized terrain. Review shapeReview, the actual expanded cost, area and concavity; copy its candidateOperation in an explicit edit. ShapeReview measures source-axis symmetry and sampled outline changes, not beauty. The proposal preserves real anchors and cannot invent a missing bay or grant scope. Defaults of 2500mm spacing/200mm tolerance preserve budget; do not tighten both rings to 1000mm without measuring their actual cost.',
    'Bind a closed coast to actual low-land points and a second curve to high-land points. Tangents at cardinal points should follow the perimeter, not point through the centre and create an inward star. Use visualEdge(boundaryId) for cliff/grass/shore; never replace a real height connection with a stair image.',
    'Give both land levels compatible fixed base materials at real world tile sizes. Where visualSurface and the materials are granted, add a few explicit bounded rock-in-grass and grass/soil-on-rock overlays, with world phase and restrained feathering. Preserve each physical support and elevation; an overlay is not a passage. If the material/operation is absent, report the missing finish instead of inventing a key or changing sources.',
    'Browse the actually granted palette. When available, distribute three genuinely different tree silhouettes and three rock silhouettes plus two shrub variants in small uneven groups, leaving ground and cliff visible. Rotation is not a new silhouette; fixed props cannot be resized implicitly. A legacy blank may provide only one tree/rock source: use only those real sources, keep groups sparse and state that the requested variant richness remains unavailable.',
    'After curves, probe each granted tree/rock/shrub definition and explicit support with limit set to its small group count. Candidate positions are mutually clear at the returned rotation: adopt them unchanged in a later furnishing step. Probe subsequent kinds after earlier props exist; an old suggestion is not valid after the layout changes.',
    'Keep real image bounds separated and reveal substantial ground/cliff surface. If the support cannot fit the requested group, revise the authorized terrain before using more requests on failed guesses. Keep valid edges and local light/fog/filter independent of a failing furnishing step.',
    'Use sparse local light, thin local fog and gentle enabled/disableable filters only after the shape, tiers, material transitions and furnishing exist. Do not hide seams or flatten cliff contrast with heavy global colour or fog. Request a neutral/effects-off appearance comparison; never claim to have inspected an image when the channel has no verified image input.'],
  interior: ['For a new interior, sceneweave_propose_composition kind=layout recipe=interior returns five purpose-specific rooms and, when granted, a real connected door tree plus an exterior entrance using native generated wall IDs. Review the candidate and full cost; adopt only its ordinary operations. Do not use it to replace an existing interior implicitly.',
    'Build a wooden inn with a common room/kitchen and a side guest room. Put the required kitchen and guest role terms in room purpose, then supply actual editable stove/counter/cupboard and bed/furniture.',
    'Adjacent rooms share exact wall endpoints and one unique divider. Read generated walls/vertices once; add one exterior entrance door and one divider door, then mark only the exterior door as entrance.',
    'Apply wood floor and appropriate stone/wood wall materials separately. Lay out a dining table/chairs, a compact kitchen band and side-room bed/shelf, leaving doors and circulation clear.',
    'Rug/clutter may intentionally sit below/on tables; keep major furniture image bounds distinct. Put warm local lights by actual lanterns and use limited local atmosphere.'],
  custom: ['Follow the explicit immutable requirements and evidence checks; do not infer additional scope from their names.'],
} as const
export const planForBrief = (brief?: AuthoringBrief) => ({ recipe: brief?.recipe ?? 'custom', immutableRequirements: brief?.requirements ?? [],
  style: brief?.style ?? null, evidenceChecks: brief?.checks ?? [], recipeGuidance: recipeGuidance[brief?.recipe ?? 'custom'],
  requestPlan: 'Use the actual remainingModelRequests, remainingToolCalls and remainingExecutionMs in tool receipts; a task may have a smaller explicit budget than the product ceiling. Reserve one complete model round for a text-only final reply after full check and diagnosis. With only two requests remaining, do final checks together now; do not spend either request merely acknowledging a plan stage. Prefer sceneweave_apply_stage once for each named phase (layout, surfaces, boundaries, furnishing, atmosphere, review), grouping up to 48 operations; the server validates <=16-operation ledger chunks together and installs only the full valid batch. Combine independent read-only calls with a stage plan, then diagnose after the complete batch. Calls execute in order; a later edit cannot use unseen coordinates from an earlier probe. Read generated anchors once; do not reread unchanged summaries. Keep at least 24 expanded operations for furniture/effects and measure every physical curve. Use visualEdge with boundaryId, not obsolete segment IDs after resampling. Probe supports before furnishing, reusing feasible positions and rotation exactly. A composition furnishing candidate can alternate actual fixed variants and preserve explicit clear regions; it still needs a later normal edit on the same baseline. Curve failures at a connection require a smaller outward bulge or an explicit authorized layout correction. After diagnosis, resolve only authorised missing requirements within budget. If a closeout receipt appears, inspect its completed steps and missing requirements, then let the browser review the draft; do not claim appearance verification or adoption. The final text must name remaining, unsupported and unreviewed items honestly; stopped/completed conversation is not evidence that the brief or adoption passed.',
  styleExecution: 'Use sceneweave_propose_composition kind=style for actual tile-size, granted edge/prop palette and light-direction operations. Line weight cannot rewrite existing bitmap art; report it unsupported unless a matching fixed definition or explicitly authorised new restricted SVG version is used. Detail density affects bounded furnishing candidate count, not an unbounded scatter or permission to fill clear regions.', stages: [
    { phase: 'layout', instruction: 'Build the authorised editable rooms/terrain and explicit passages before decoration.' },
    { phase: 'surfaces', instruction: 'Choose granted compatible materials; preserve physical tile size, alignment and the original fixed sources.' },
    { phase: 'boundaries', instruction: 'Use shared boundary/edge tools for continuous seams; account for the full visual band and physical impact.' },
    { phase: 'furnishing', instruction: 'Place only the permitted editable members; keep door approaches clear and preserve manual scatter records.' },
    { phase: 'atmosphere', instruction: 'Apply only the granted local lights, fog and filters; do not infer physical height or visibility from appearance.' },
    { phase: 'review', instruction: 'Check actual entities, missing requirements, geometry, remaining budget and optional explicitly disclosed public screenshots. Human appearance review is still required.' },
  ] })

/** Inspect only the public, explicitly granted entity IDs. User prose is never reported as verified. */
export function diagnoseAuthoringProject(project: ProjectData, ids: ReadonlySet<string>, brief?: AuthoringBrief) {
  const scene = project.document, visible = createPublicVisibility(scene)
  const rooms = Object.values(scene.rooms).filter(room => ids.has(room.id) && visible.room(room.id))
  const terrain = Object.values(scene.terrainAreas).filter(area => ids.has(area.id) && visible.terrainArea(area.id))
  const props = Object.values(scene.props).filter(prop => ids.has(prop.id) && visible.prop(prop))
  const walls = Object.values(scene.walls).filter(wall => ids.has(wall.id))
  const openings = Object.values(scene.openings).filter(opening => ids.has(opening.id) && !opening.secret)
  const paths = Object.values(scene.paths).filter(path => ids.has(path.id) && visible.path(path.id))
  const missingDefinitions = (brief?.requiredDefinitionIds ?? []).filter(id => !props.some(prop => prop.definitionRef?.id === id))
  const issues: { code: string; ids: string[]; severity: 'warning' | 'missing' }[] = []
  const unpainted = [...rooms.filter(room => !room.floorStyle), ...terrain.filter(area => !area.surfaceStyle), ...walls.filter(wall => !wall.topStyle)]
  if (unpainted.length) issues.push({ code: 'surfaces_without_material', ids: unpainted.map(value => value.id), severity: 'warning' })
  if (rooms.length && !openings.some(opening => opening.kind === 'door')) issues.push({ code: 'building_has_no_authorized_door', ids: rooms.map(value => value.id), severity: 'missing' })
  if (rooms.length && !scene.constraints.entranceOpeningIds.some(id => ids.has(id))) issues.push({ code: 'building_has_no_explicit_entrance', ids: [], severity: 'missing' })
  if (missingDefinitions.length) issues.push({ code: 'required_furniture_missing', ids: missingDefinitions, severity: 'missing' })
  const conflictingProps = new Set<string>(), obstructedDoors = new Set<string>()
  for (let index = 0; index < props.length; index++) {
    const prop = props[index]
    if (!prop.blocksMovement) continue
    const footprint = propFootprint(prop)
    for (const other of props.slice(index + 1)) if (other.blocksMovement && other.floorId === prop.floorId
      && other.supportRef.kind === prop.supportRef.kind && other.supportRef.id === prop.supportRef.id
      && polygonsOverlap(footprint, propFootprint(other))) { conflictingProps.add(prop.id); conflictingProps.add(other.id) }
    for (const opening of openings.filter(value => value.kind === 'door' && value.floorId === prop.floorId)) {
      const wall = scene.walls[opening.wallId]
      if (wall && polygonsOverlap(footprint, corridor(...openingEndpoints(scene, opening), Math.max(1000, wall.thicknessMm)))) obstructedDoors.add(opening.id)
    }
  }
  if (conflictingProps.size) issues.push({ code: 'authorized_blocking_furniture_overlap', ids: [...conflictingProps].sort(), severity: 'warning' })
  if (obstructedDoors.size) issues.push({ code: 'authorized_door_approach_blocked_500mm', ids: [...obstructedDoors].sort(), severity: 'warning' })
  const visual = scene.visual
  const count = (values: Record<string, { id: string; visibility: string }> | undefined) => Object.values(values ?? {}).filter(value => ids.has(value.id) && value.visibility === 'public').length
  const composition = inspectVisualComposition(project, props, ids)
  if (composition.excessivePairs.length) issues.push({ code: 'authorized_major_image_overlap', ids: [...new Set(composition.excessivePairs.flatMap(pair => pair.ids))].sort(), severity: 'warning' })
  if (composition.oversizedIds.length) issues.push({ code: 'authorized_image_dominates_surface', ids: composition.oversizedIds, severity: 'warning' })
  const evidence = inspectBriefEvidence(project, ids, brief?.checks ?? [])
  for (const check of evidence.filter(value => value.status !== 'supported')) issues.push({ code: `brief_${check.kind}_missing`, ids: check.evidenceIds, severity: 'missing' })
  return { counts: { rooms: rooms.length, terrain: terrain.length, walls: walls.length, doors: openings.filter(value => value.kind === 'door').length,
    props: props.length, paths: paths.length, boundaries: count(visual?.boundaries), edgeLooks: count(visual?.edgeLooks), lights: count(visual?.lights), fogs: count(visual?.fogs), filters: count(visual?.filters) },
    issues, composition, repairs: inspectCompositionRepairs(project, ids, brief), evidence, requirements: (brief?.requirements ?? []).map((description, index) => ({ requirement: index + 1, description, status: 'needs_human_review' as const })),
    visualInput: 'No screenshot is implied by this structural report.', physicalValidation: 'Finite geometry/locks/dependencies only; not a global pathfinding proof.',
    completion: issues.some(issue => issue.severity === 'missing') ? 'incomplete' : 'structure_checked_appearance_unconfirmed' }
}
