// Separate tooling page only. Never imported by the product or exposed by its build.
import { importProject } from '../../src/shared/project/file.js'
import { validateProjectData, PROJECT_DATA_LIMITS } from '../../src/shared/project/validate.js'
import { validateProjectBundle } from '../../src/shared/project/resources.js'
import { validateSceneSnapshot } from '../../src/shared/validation/snapshots.js'
import { JSON_LIMITS, canonicalJson, encodeUtf8 } from '../../src/shared/validation/json.js'
import { sha256Bytes } from '../../src/shared/validation/hash.js'
import { HISTORY_LIMITS } from '../../src/shared/model/history.js'
import { projectScene } from '../../src/shared/projection/projection.js'
import { hitTestLayers, selectInBoundsLayers } from '../../src/editor/native-canvas/layer-selection.js'
import { createEditorRenderPlan, EDITOR_OUTLINE_THRESHOLD_PX, EDITOR_FULL_THRESHOLD_PX } from '../../src/platform/browser/render/editor-render-plan.js'
import { createBrowserImagePort } from '../../src/platform/browser/images/adapter.js'
import { createBrowserSvgPort } from '../../src/platform/browser/ai/svg-port.js'
import type { BoundsMm, PointMm, SceneDocument } from '../../src/shared/model/scene.js'
import type { ProjectData } from '../../src/shared/model/project.js'

interface Configuration {
  fixtureUrl: string
  sample: string
  targetProps: number | null
  markerId: string
  markerPoint: PointMm
  repetitions: number
  warmQueries: number
}
const validation = { images: createBrowserImagePort(), svg: createBrowserSvgPort() }
const count = (record: object | undefined) => Object.keys(record ?? {}).length
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const hashJson = (value: unknown) => sha256Bytes(jsonBytes(value))
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

// Tool-owned JSON only. This counts precisely the values counted by inspectJsonInput,
// including each object/array and the root; object keys do not count as values.
function shape(value: unknown) {
  let values = 0, depth = 0
  const pending: [unknown, number][] = [[value, 0]]
  while (pending.length) {
    const [item, level] = pending.pop()!
    values++; depth = Math.max(depth, level)
    if (item !== null && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, level + 1])
  }
  return { bytes: jsonBytes(value).length, values, depth }
}
function identityCounts(project: ProjectData) {
  const identity = project.historyIdentity
  const pools = { props: count(identity.propTokens), prefabs: count(identity.prefabTokens), outdoor: count(identity.outdoorTokens),
    generation: count(identity.generationTokens), regional: count(identity.regionalTokens), presentation: count(identity.presentationTokens), terrain: count(identity.terrainTokens) }
  return { ...pools, total: Object.values(pools).reduce((sum, value) => sum + value, 0) }
}
function extendDensity(base: ProjectData, target: number, sample: string) {
  const project = structuredClone(base), scene = project.document
  const before = count(scene.props)
  if (!Number.isSafeInteger(target) || target <= before || target > 32_000) throw new Error('Higher candidates must exceed the base and remain at most 32000 in this diagnostic')
  const grouped = new Set([...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)].flatMap(group => Object.values(group.members).flatMap(member => member.propId ? [member.propId] : [])))
  const sources = Object.values(scene.props).filter(prop => prop.id.includes('-dense-') && !prop.blocksMovement && !prop.blocksSight && !grouped.has(prop.id)
    && !project.appearance.instanceAdjustments[prop.id]?.length && project.appearance.propSources[prop.id])
  if (!sources.length) throw new Error('No exact nonblocking independent dense source is available')
  for (let index = before; index < target; index++) {
    const source = sources[(index - before) % sources.length], id = `capacity-${sample}-${target}-${index}`
    if (Object.hasOwn(scene.props, id) || Object.hasOwn(project.historyIdentity.propTokens, id)) throw new Error('Diagnostic identity collision')
    scene.props[id] = { ...structuredClone(source), id }
    scene.entityLayers[id] = scene.entityLayers[source.id]
    project.historyIdentity.propTokens[id] = `capacity-birth-${sample}-${target}-${index}`
    project.appearance.propSources[id] = project.appearance.propSources[source.id]
  }
  return { project, synthesis: { baseProps: before, addedProps: target - before, sourceProps: sources.length,
    method: 'Exact nonblocking independent dense props repeated at their original supported positions, with fresh IDs/births and the exact fixed appearance source. Original entities, sources, artwork, licenses, physical fields and support remain intact. This intentionally increases overlap, not playable area.',
    productTransaction: false, commandBudgetBypassed: false,
    limitation: 'Offline load synthesis is not an editor transaction and does not prove creation through a product command or adoption budget.' } }
}
function certifiedScene(input: SceneDocument) {
  const result = validateSceneSnapshot(input)
  if (!result.ok) throw new Error(result.errors.map(error => error.message).join('; '))
  return result.document
}
function quarter(bounds: BoundsMm): BoundsMm {
  return { x: bounds.x + bounds.width / 4, y: bounds.y + bounds.height / 4, width: bounds.width / 2, height: bounds.height / 2 }
}

export async function runInteractionCapacityDiagnostic(config: Configuration) {
  const timings: Record<string, number[]> = {}
  const phase = async (name: string) => {
    const report = Reflect.get(globalThis, '__sceneweaveCapacityPhase') as undefined | ((name: string) => Promise<void>)
    if (report) await report(name)
  }
  async function timed<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
    await phase(name)
    const start = performance.now()
    try { return await operation() }
    finally { (timings[name] ??= []).push(performance.now() - start) }
  }
  await phase('fixture-fetch')
  const response = await fetch(config.fixtureUrl)
  if (!response.ok) throw new Error('Fixture fetch failed')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const bundle = await timed('package-import-full-resources', () => importProject(bytes, validation))
  await phase('candidate-preparation')
  const originalHash = hashJson(bundle.project)
  const extended = config.targetProps ? extendDensity(bundle.project, config.targetProps, config.sample) : null
  const input = extended?.project ?? structuredClone(bundle.project)
  const projectShape = shape(input), documentShape = shape(input.document), births = identityCounts(input)
  const inputHash = hashJson(input)
  const counts = { props: count(input.document.props), prefabs: count(input.document.prefabInstances), scatters: count(input.document.scatterGroups),
    appearances: count(input.appearance.sources), assets: count(input.assets), sources: count(input.authoringSources), licenseBindings: input.licenseBindings.length, births }
  const limits = { json: JSON_LIMITS, project: PROJECT_DATA_LIMITS, identityBirthsAndTombstones: HISTORY_LIMITS.identityProps,
    commandBudget: 256, outlineThresholdPx: EDITOR_OUTLINE_THRESHOLD_PX, fullThresholdPx: EDITOR_FULL_THRESHOLD_PX }
  let checked: ProjectData | undefined
  try {
    for (let index = 0; index < config.repetitions; index++) checked = await timed('metadata-validation-public', () => validateProjectData(input))
  } catch (error) {
    if (!extended) throw error
    return { status: 'rejected', rejectionStage: 'metadata-validation-public', error: errorText(error), counts, projectShape, documentShape, limits,
      timings, inputHash, originalHash, synthesis: extended.synthesis, inputUnchanged: hashJson(input) === inputHash,
      originalUnchanged: hashJson(bundle.project) === originalHash, resourceClosureVerified: 'Base fixture only; rejected candidate has no complete-validation result.' }
  }
  // Full bytes, source raster pixels, image pixels and license validation remains
  // public, even though this candidate reuses the exact base resource port.
  const complete = await timed('candidate-full-resources', () => validateProjectBundle({ project: checked!, resources: bundle.resources }, validation))
  let sceneInput = structuredClone(checked!.document)
  const scene = await timed('scene-certification-for-point-index', () => certifiedScene(sceneInput))
  const hit = hitTestLayers(scene)
  const coldPoint = await timed('selection-point-cold-index', () => hit(scene, config.markerPoint, 0))
  if (!coldPoint.includes(config.markerId)) throw new Error('Cold point selection lost the actual image marker')
  const pointQueries = Array.from({ length: config.warmQueries }, (_, index) => index % 3 === 0 ? config.markerPoint : {
    x: scene.exportBoundsMm.x + scene.exportBoundsMm.width * ((index * 37 % 97) + .5) / 97,
    y: scene.exportBoundsMm.y + scene.exportBoundsMm.height * ((index * 53 % 89) + .5) / 89,
  })
  const warmPointCounts: number[] = []
  for (const point of pointQueries) warmPointCounts.push((await timed('selection-point-warm', () => hit(scene, point, 0))).length)
  sceneInput = structuredClone(checked!.document)
  const boundsScene = await timed('scene-certification-for-bounds-index', () => certifiedScene(sceneInput))
  const select = selectInBoundsLayers(boundsScene), smallBounds = quarter(scene.exportBoundsMm)
  const coldBounds = await timed('selection-bounds-cold-index', () => select(boundsScene, scene.exportBoundsMm, 'intersect'))
  const warmBoundsCounts: number[] = []
  for (let index = 0; index < config.repetitions; index++) warmBoundsCounts.push((await timed('selection-bounds-warm-quarter', () => select(boundsScene, smallBounds, 'intersect'))).ids.length)
  const gm = await timed('projection-gm', () => projectScene(scene, 'gm', checked!.appearance))
  const player = await timed('projection-player', () => projectScene(scene, 'player', checked!.appearance))
  const plans = []
  for (const [view, bounds] of [['full', gm.bounds], ['quarter-area', quarter(gm.bounds)]] as const) for (const scale of [.005, .02, .08]) {
    let plan
    for (let index = 0; index < config.repetitions; index++) plan = await timed(`render-plan-${view}-${scale}`, () => createEditorRenderPlan(gm, { viewBoundsMm: bounds, screenScalePxPerMm: scale }))
    if (plan!.props.length + plan!.omittedPropCount !== gm.props.length || Object.values(plan!.detailCounts).reduce((sum, value) => sum + value, 0) !== plan!.props.length) throw new Error('Render plan counts do not preserve the projected workload')
    plans.push({ view, screenScalePxPerMm: scale, projectedProps: gm.props.length, visibleProps: plan!.props.length, omittedProps: plan!.omittedPropCount, details: plan!.detailCounts, boundsMm: plan!.boundsMm })
  }
  await phase('integrity-check')
  const contentHash = sha256Bytes(encodeUtf8(canonicalJson(input)))
  if (sha256Bytes(encodeUtf8(canonicalJson(complete.project))) !== contentHash || hashJson(input) !== inputHash || hashJson(bundle.project) !== originalHash) throw new Error('Diagnostic changed project contents')
  return { status: 'validated-diagnostic', counts, projectShape, documentShape, limits, inputHash, originalHash, contentHash,
    inputUnchanged: true, originalUnchanged: true, resourceClosureVerified: 'Public full resource validation of the candidate, including real source/image pixels and licenses.',
    synthesis: extended?.synthesis ?? null, timings,
    selection: { markerId: config.markerId, coldPointCount: coldPoint.length, markerIncluded: true, warmPointCounts,
      coldBounds: { selected: coldBounds.ids.length, excludedLocked: coldBounds.excludedLocked, excludedHidden: coldBounds.excludedHidden }, warmQuarterBoundsCounts: warmBoundsCounts },
    projection: { gmProps: gm.props.length, playerProps: player.props.length, gmAssets: gm.assetIds.length, playerAssets: player.assetIds.length }, plans,
    limitation: 'Pure source-module diagnostic. Selection timings include the native layer wrapper and real geometry/index; render plans include culling/LOD planning but no raster draw, React layer panel, UI event-to-paint, persistence/history, export or formal capacity acceptance.' }
}
