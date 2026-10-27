import type { ProjectData } from '../model/project.js'
import { LAYER_ENTITY_COLLECTIONS, type SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { addSurfaceAppearanceSource, resolveAppearance, surfaceStyle, syncAppearanceGraph } from '../appearance/graph.js'
import { advanceHistoryIdentity } from '../history/identity.js'
import { validateProjectData } from '../project/validate.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { visualBase } from '../visual/base.js'
import { generateTerrainDocument } from '../terrain-generation/generate.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { prepareTerrainEdit } from '../terrain-generation/edit.js'
import { prepareRegionalAuthoring, prepareRegionalEdit, prepareRegionalDrillDown, regionalAuthorizedSubsetHash } from '../terrain-generation/regional-authoring.js'
import { terrainCommandCost } from '../terrain-generation/cost.js'
import { regionalEntityVisibility } from '../terrain-generation/integrity.js'
import { assertPublicSceneEntity } from './scene-authoring.js'
import { assertTerrainExtendedEntity, boundsContains, terrainExtendedEntity } from './terrain-context.js'
import { TerrainAuthoringOperationSchema, type TerrainAuthoringOperation } from './terrain-protocol.js'
import type { SceneAuthoringScope } from './authoring-protocol.js'

/** All private/ungranted dependency failures share one value, without diagnostic hints. */
export class TerrainAuthoringRestrictedError extends Error {
  constructor() { super('地形候选存在未授权依赖，此步骤未采用。'); this.name = 'TerrainAuthoringRestrictedError' }
}
const restricted = (): never => { throw new TerrainAuthoringRestrictedError() }
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
function entities(scene: SceneDocument): Map<string, { id: string; floorId?: string; layerId?: string; visibility?: string; editLocked?: boolean }> {
  const visual = visualBase(scene)
  const collections = [...LAYER_ENTITY_COLLECTIONS.map(key => scene[key]), ...Object.values({ boundaries: visual?.boundaries, edgeLooks: visual?.edgeLooks, lights: visual?.lights, fogs: visual?.fogs, filters: visual?.filters,
    materializedEdges: scene.visual?.version === 2 ? scene.visual.materializedEdges : undefined, areas: scene.regional?.areas, lines: scene.regional?.lines, landmarks: scene.regional?.landmarks, symbols: scene.regional?.symbols })]
  return new Map(collections.flatMap(rows => Object.values(rows ?? {})).map(row => [row.id, row]))
}
function assertGrant(project: ProjectData, scope: SceneAuthoringScope, allowed: ReadonlySet<string>) {
  // Conservative first release: a complete public dependency closure is required.
  // A hidden/ungranted row rejects with the same fixed error before any search,
  // so its geometry cannot steer a public candidate, cost or identifier list.
  for (const [id, row] of entities(project.document)) {
    if (!allowed.has(id) || row.visibility === 'gm' || row.editLocked || project.document.userLayers[row.layerId ?? project.document.entityLayers[id]]?.editLocked) restricted()
    try {
      if (terrainExtendedEntity(project.document, id)) assertTerrainExtendedEntity(project, scope, id)
      else assertPublicSceneEntity(project, scope, id)
    } catch { restricted() }
  }
  for (const collection of [project.document.generation?.rules, project.document.generation?.constraints, project.document.generation?.intents, project.document.generation?.exclusions]) {
    for (const row of Object.values(collection ?? {})) if (row.visibility !== 'public' || 'editLocked' in row && row.editLocked) restricted()
  }
  if (Object.values(project.document.generation?.sourceLinks ?? {}).some(link => link.inherited.some(row => row.visibility !== 'public'))) restricted()
}
function assertOutputs(before: ProjectData, document: SceneDocument, scope: SceneAuthoringScope, allowed: ReadonlySet<string>) {
  const original = entities(before.document), layerIds = new Set([scope.layerId, ...(scope.generationLayerIds ?? [])])
  for (const [id, row] of entities(document)) {
    if (same(original.get(id), row)) continue
    if (original.has(id) && !allowed.has(id) || row.visibility === 'gm' || row.editLocked || row.floorId !== scope.floorId || !layerIds.has(row.layerId ?? document.entityLayers[id])) restricted()
    try {
      if (terrainExtendedEntity(document, id)) assertTerrainExtendedEntity({ ...before, document }, scope, id)
      else assertPublicSceneEntity({ ...before, document }, scope, id)
    } catch { restricted() }
  }
  for (const prop of Object.values(document.props)) if (prop.definitionRef && !scope.definitionIds.includes(prop.definitionRef.id)) restricted()
  for (const area of [...Object.values(document.terrainAreas), ...Object.values(document.paths)]) for (const paint of area.surfaceStyle ? [area.surfaceStyle.base, ...area.surfaceStyle.overlays.map(row => row.paint)] : []) if (!scope.materialIds.includes(paint.materialRef.id)) restricted()
  for (const row of [...Object.values(document.regional?.landmarks ?? {}), ...Object.values(document.regional?.symbols ?? {})]) if (!scope.regionalDefinitionIds?.includes(row.definitionRef.id)) restricted()
  if (!same(document.exportBoundsMm, before.document.exportBoundsMm) || !same(document.floors, before.document.floors) || !same(document.userLayers, before.document.userLayers) || document.sceneId !== before.document.sceneId) restricted()
}
function finish(project: ProjectData, document: SceneDocument, context: PreparationContext) {
  const appearance = cloneJson(project.appearance)
  for (const [id, sourceId] of Object.entries(appearance.surfaceSources)) {
    const before = surfaceStyle(project.document, id), after = surfaceStyle(document, id)
    if (!before || !after || same(before, after)) continue
    const source = appearance.sources[sourceId]
    // Never bake active effective adjustments into a new fixed source.
    if (source?.kind !== 'surface' || !same(before, source.snapshot)) restricted()
    appearance.surfaceSources[id] = addSurfaceAppearanceSource(appearance, after, sourceId)
  }
  const historyIdentity = advanceHistoryIdentity(project.historyIdentity, project.document, document, context)
  const content = resolveAppearance(syncAppearanceGraph({ document, historyIdentity, appearance }))
  if (!same(content.document, document)) restricted()
  return validateProjectData({ ...project, ...content })
}
export function applyTerrainAuthoringOperation(project: ProjectData, scope: SceneAuthoringScope, raw: TerrainAuthoringOperation, context: PreparationContext, allowed: ReadonlySet<string>) {
  const operation = TerrainAuthoringOperationSchema.parse(raw), before = project.document
  if (project.schemaVersion !== 3 || before.schemaVersion !== 3 || !scope.operations.includes(operation.kind)) restricted()
  assertGrant(project, scope, allowed)
  let document: SceneDocument, cost: number
  if (operation.kind === 'terrainGenerate') {
    const request = operation.request
    if (before.mapMode !== 'scene' || before.visual?.version !== 2 || entities(before).size || Object.values(before.generation ?? {}).some(value => typeof value === 'object' && value !== null && Object.keys(value).length)
      || !boundsContains(scope.boundsMm, before.exportBoundsMm) || request.sceneId !== before.sceneId) restricted()
    const blank = cloneJson(before); blank.schemaVersion = 2; blank.visual = cloneJson(visualBase(before)!); delete blank.generation; delete blank.regional; delete blank.mapMode
    const result = composeTerrainDocument(blank, generateTerrainDocument(blank, request), context.ids.nextId())
    document = result.document; cost = terrainCommandCost(before, document).total
  } else if (operation.kind === 'terrainEdit') {
    const request = operation.request
    if (request.sceneId !== before.sceneId || request.floorId !== scope.floorId || !boundsContains(scope.boundsMm, request.scopeMm)) restricted()
    if (request.kind === 'brush' && request.materialRef && !scope.materialIds.includes(request.materialRef.id)) restricted()
    const result = prepareTerrainEdit(before, request); document = result.document; cost = result.cost.total
  } else if (operation.kind === 'regionalGenerate') {
    const request = operation.request
    if (request.sceneId !== before.sceneId || entities(before).size || request.operations?.length || request.selectionMm || !boundsContains(scope.boundsMm, before.exportBoundsMm)
      || request.floorId && request.floorId !== scope.floorId || request.layerId && request.layerId !== scope.layerId) restricted()
    const blank = cloneJson(before)
    if (blank.mapMode === 'scene' && blank.visual?.version === 2) { blank.schemaVersion = 2; blank.visual = cloneJson(blank.visual.base); delete blank.generation; delete blank.regional; delete blank.mapMode }
    const result = prepareRegionalAuthoring(blank, { ...request, floorId: scope.floorId, layerId: scope.layerId }); document = result.document; cost = terrainCommandCost(before, document).total
  } else {
    const request = operation.request
    if (request.sceneId !== before.sceneId) restricted()
    const result = prepareRegionalEdit(before, request); document = result.document; cost = Math.max(1, result.cost.total)
  }
  assertOutputs(project, document, scope, allowed)
  const next = finish(project, document, context), previous = entities(before), current = entities(document)
  const writeIds = [...new Set([...previous.keys(), ...current.keys()])].filter(id => !same(previous.get(id), current.get(id))).sort()
  return { project: next, cost: Math.max(1, cost), readIds: [...new Set([scope.floorId, scope.layerId, ...allowed, ...scope.definitionIds, ...scope.materialIds])].sort(), writeIds, createdIds: writeIds.filter(id => !previous.has(id)) }
}
/** Independent public-only candidate; this does not change the task's main scene. */
export function regionalSceneCandidate(project: ProjectData, scope: SceneAuthoringScope, allowed: ReadonlySet<string>, request: Parameters<typeof prepareRegionalDrillDown>[1]) {
  if (!scope.operations.includes('regionalEdit')) restricted()
  const raw = request as { includePrivate?: boolean; selectionMm?: Parameters<typeof boundsContains>[1] }
  if (raw.includePrivate || !raw.selectionMm || !boundsContains(scope.boundsMm, raw.selectionMm)) restricted()
  const scene = cloneJson(project.document)
  if (!scene.regional) restricted()
  const regional = scene.regional!
  const authorizedDefinitionIds = new Set(scope.regionalDefinitionIds ?? [])
  const selectedDefinitionIds = new Set<string>()
  for (const [key, kind] of [['areas', 'area'], ['lines', 'line'], ['landmarks', 'landmark'], ['symbols', 'symbol']] as const) {
    const rows = regional[key]
    const selected = Object.fromEntries(Object.entries(rows).filter(([id]) => allowed.has(id) && regionalEntityVisibility(project.document, kind, id) === 'public'))
    if (key === 'landmarks') {
      for (const landmark of Object.values(selected)) {
        const definition = regional.symbolDefinitions[landmark.definitionRef.id]
        if (!authorizedDefinitionIds.has(landmark.definitionRef.id) || !definition?.origin.canEmbed || definition.version !== landmark.definitionRef.version) restricted()
        selectedDefinitionIds.add(landmark.definitionRef.id)
        // An area relation is useful only when the source area is in the
        // explicit grant. Otherwise it would disclose an unselected source.
        if (landmark.areaId && !allowed.has(landmark.areaId)) landmark.areaId = null
      }
    } else if (key === 'symbols') {
      for (const symbol of Object.values(selected)) {
        const definition = regional.symbolDefinitions[symbol.definitionRef.id]
        if (!authorizedDefinitionIds.has(symbol.definitionRef.id) || !definition?.origin.canEmbed || definition.version !== symbol.definitionRef.version) restricted()
        selectedDefinitionIds.add(symbol.definitionRef.id)
        if (symbol.sourceRef && !allowed.has(symbol.sourceRef.id)) symbol.sourceRef = null
      }
    }
    Object.assign(regional, { [key]: selected })
  }
  // The regional definition catalog is itself part of the source snapshot.
  // Keep only definitions referenced by selected, explicitly authorized rows;
  // unselected fixed definitions must not influence the candidate hash.
  regional.symbolDefinitions = Object.fromEntries(Object.entries(regional.symbolDefinitions).filter(([id]) => selectedDefinitionIds.has(id)))
  // Rebuild only the public generation snapshot. Full source hashes remain private.
  const generation = scene.generation!
  generation.rules = {}; generation.ownership = {}; generation.checks = {}; generation.intents = {}; generation.exclusions = {}; generation.sourceLinks = {}
  // Only ports referenced by selected, authorized lines are part of their
  // dependency closure. Other public constraints are not implicitly granted.
  const selectedPortIds = new Set(Object.values(regional.lines).flatMap(line => line.portIds))
  const constraintAuthorized = (id: string, value: (typeof generation.constraints)[string]) => {
    if (value.visibility !== 'public') return false
    if (value.kind === 'port') return selectedPortIds.has(id)
    return 'target' in value && allowed.has(value.target.entityId)
  }
  generation.constraints = Object.fromEntries(Object.entries(generation.constraints).filter(([id, value]) => constraintAuthorized(id, value)))
  const result = prepareRegionalDrillDown(scene, request)
  // This AI-only candidate has a narrower source grant than the complete local
  // drill-down flow. Bind its lineage hash to exactly the source snapshot that
  // was copied, without hashing unrelated parent document or catalog data.
  const link = result.sourceLink
  link.sourceContentHash = regionalAuthorizedSubsetHash(scene, link)
  result.document.generation!.sourceLinks[link.id].sourceContentHash = link.sourceContentHash
  result.hash = sha256Text(canonicalJson({ request: result.request, document: result.document, cost: result.cost }))
  return result
}
