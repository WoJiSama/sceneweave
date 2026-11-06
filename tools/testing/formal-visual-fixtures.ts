/** Preparation only. Never imported by the production app or a measured page. */
import { createRefinedInteriorProject } from '../../src/platform/browser/content/refined-interior.js'
import { createRefinedIslandProject } from '../../src/platform/browser/content/refined-island.js'
import { createRefinedCoastProject } from '../../src/platform/browser/content/refined-coast.js'
import { createMixedBlankProject } from '../../src/platform/browser/content/factories.js'
import { validation } from '../../src/platform/browser/runtime.js'
import { prepareMixedProject } from '../../src/application/workspace/mixed.js'
import { fromBundle, toBundle, type EditableProject } from '../../src/application/workspace/project.js'
import { prepareCompositionCommands } from '../../src/application/workspace/prepare.js'
import { syncAppearanceGraph } from '../../src/shared/appearance/graph.js'
import { createHistoryIdentity } from '../../src/shared/history/identity.js'
import { defaultMixedInput } from '../../src/shared/generation/domains/mixed/index.js'
import { taskBudgetProfile } from '../../src/shared/budget/task-budget.js'
import { selectManualTransactionBudget } from '../../src/shared/budget/command-budget.js'
import { effectivePropShadow, nearSidePaintEnvelope, propPaintPolygon, propPresentation } from '../../src/shared/appearance/presentation.js'
import { projectScene, pointsBounds, shadowPadding } from '../../src/shared/projection/projection.js'
import { visualBase } from '../../src/shared/visual/base.js'
import { detachChangedOutputs } from '../../src/shared/terrain-generation/integrity.js'
import { pauseChangedCompositions } from '../../src/shared/terrain-generation/composition-lifecycle.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { projectContentHash } from '../../src/shared/project/validate.js'
import { sha256Bytes } from '../../src/shared/validation/hash.js'
import { canonicalJson, captureJson } from '../../src/shared/validation/json.js'
import type { BoundsMm, Prop, SceneDocument } from '../../src/shared/model/scene.js'
import type { SceneCommand } from '../../src/shared/commands/commands.js'

export type FormalVisualKind = 'interior' | 'island' | 'coast' | 'mixed'
const stamp = '2026-11-06T00:00:00.000Z'
const point = (x: number, y: number) => ({ x, y })
const contextFor = (kind: FormalVisualKind) => {
  let sequence = 0
  return { ids: { nextId: () => `formal-visual-${kind}-identity-${sequence++}` }, clock: { now: () => stamp } }
}
const count = (value: object) => Object.keys(value).length

async function replaceDocument(base: EditableProject, document: SceneDocument, kind: FormalVisualKind) {
  // Root identity freezing is not an authored-content edit. Actual manual
  // changes use the production provenance lifecycle without rebuilding results.
  const before = captureJson(base.document)
  before.sceneId = document.sceneId; before.revision = document.revision
  before.createdAt = document.createdAt; before.updatedAt = document.updatedAt
  if (canonicalJson(before) !== canonicalJson(document)) {
    detachChangedOutputs(before, document)
    pauseChangedCompositions(before, document)
  }
  const content = syncAppearanceGraph({ document, historyIdentity: createHistoryIdentity(document, contextFor(kind)), appearance: captureJson(base.appearance) }, base.document)
  return fromBundle(toBundle({ ...base, ...content }), validation)
}

function mask(scene: SceneDocument, prop: Prop, base: EditableProject, kind: FormalVisualKind) {
  const layerId = scene.entityLayers[prop.id], floor = scene.floors[prop.floorId].boundsMm
  const theme = scene.activeStyleThemeRef ? scene.styleThemes[scene.activeStyleThemeRef.id] : undefined
  const presentation = propPresentation(base.appearance, prop.id)
  const shadow = effectivePropShadow(prop, presentation, theme?.shadowPresets[prop.shadowClass])
  const visual = visualBase(scene)
  const contact = presentation?.mode === 'nearSide' && shadow && visual?.environment.contactShadowOpacity ? visual.environment.contactShadowMm : null
  const envelope = nearSidePaintEnvelope(prop, presentation, shadow, visual?.environment.lightDirectionDeg, contact)
    ?? pointsBounds(propPaintPolygon(prop, presentation))
  // Reserve both directions of the private 250mm movement plus the real shadow.
  const padding = Math.ceil(shadowPadding(shadow) + 600)
  const x = Math.max(floor.x, Math.floor(envelope.x - padding)), y = Math.max(floor.y, Math.floor(envelope.y - padding))
  const right = Math.min(floor.x + floor.width, Math.ceil(envelope.x + envelope.width + padding))
  const bottom = Math.min(floor.y + floor.height, Math.ceil(envelope.y + envelope.height + padding))
  const id = `formal-visual-${kind}-fixed-private-mask`
  scene.regions[id] = { id, floorId: prop.floorId, editLocked: false, visibility: 'gm', kind: 'manualMask', blocksMovement: false, movementCostMultiplier: 1,
    boundaryMm: [point(x, y), point(right, y), point(right, bottom), point(x, bottom)] }
  scene.entityLayers[id] = layerId
  return id
}

const cropOrigins: Record<FormalVisualKind, { name: string; x: number; y: number }[]> = {
  interior: [{ name: 'door-and-shared-wall', x: 5500, y: 4500 }, { name: 'furniture-material-group', x: 15000, y: 11000 },
    { name: 'north-corner', x: 17000, y: 4000 }, { name: 'terrace-edge', x: 3000, y: 13000 }],
  island: [{ name: 'concave-shore', x: 2000, y: 7000 }, { name: 'convex-shore', x: 16500, y: 9000 },
    { name: 'stairs-and-landing', x: 6500, y: 6900 }, { name: 'rock-grass-group', x: 12000, y: 6500 }],
  coast: [{ name: 'concave-tidal-shore', x: 3500, y: 6500 }, { name: 'convex-tidal-shore', x: 8000, y: 6500 },
    { name: 'western-reef-group', x: 1000, y: 3500 }, { name: 'dry-wet-sand-group', x: 16500, y: 10500 }],
  mixed: [{ name: 'building-ground', x: 17000, y: 13500 }, { name: 'forest-material-group', x: 10000, y: 7500 },
    { name: 'forest-transition', x: 24000, y: 17000 }, { name: 'route-and-context', x: 18000, y: 8000 }],
}

async function packageProject(project: EditableProject) {
  const bundle = toBundle(project), bytes = await exportProject(bundle, validation)
  const cold = await importProject(bytes, validation)
  if (projectContentHash(cold.project) !== projectContentHash(bundle.project)) throw new Error('Formal visual package cold-read content mismatch.')
  return { bytes, sha256: await sha256Bytes(bytes) }
}

async function structureControl(project: EditableProject, kind: FormalVisualKind) {
  if (kind === 'coast') {
    const original = visualBase(project.document)!.boundaries['q2-coast-shoreline']
    const failures: string[] = []
    for (const delta of [100, -100, 50, -50, 10, -10]) {
      const boundary = captureJson(original)
      boundary.segments[2].control1.y += delta
      try {
        const changed = await prepareCompositionCommands(project, [{ type: 'upsertVisualBoundary', boundary }],
          { runtime: contextFor(kind), validation, baseline: project, budget: selectManualTransactionBudget(project.document, 1, 1) })
        return { kind: 'visualBoundary' as const, id: original.id, beforeMm: original.segments[2].control1.y,
          afterMm: boundary.segments[2].control1.y, segmentIndex: 2, expectedDocument: changed.document }
      } catch (error) { failures.push(String(error)) }
    }
    throw new Error(`No legal real shared shore edit: ${failures.join('; ')}`)
  }
  const candidates = [
    ...Object.values(project.document.walls).filter(row => !row.editLocked).slice(0, 8).flatMap(row => [100, -50].map(delta => ({
      kind: 'wall' as const, id: row.id, beforeMm: row.thicknessMm, afterMm: row.thicknessMm + delta,
      command: { type: 'setWallThickness', id: row.id, thicknessMm: row.thicknessMm + delta } as SceneCommand }))),
    ...Object.values(project.document.terrainConnections).filter(row => !row.editLocked).slice(0, 8).flatMap(row => [100, -100].map(delta => ({
      kind: 'connection' as const, id: row.id, beforeMm: row.widthMm, afterMm: row.widthMm + delta,
      command: { type: 'updateTerrainConnection', id: row.id, changes: { widthMm: row.widthMm + delta } } as SceneCommand }))),
  ]
  const failures: string[] = []
  for (const candidate of candidates) {
    try {
      await prepareCompositionCommands(project, [candidate.command], { runtime: contextFor(kind), validation, baseline: project,
        budget: selectManualTransactionBudget(project.document, 1, 1) })
      const { command: _command, ...control } = candidate
      return control
    } catch (error) { failures.push(String(error)) }
  }
  throw new Error(`No legal real structural edit for ${kind}: ${failures.join('; ')}`)
}

export async function prepareFormalVisualFixture(kind: FormalVisualKind) {
  const context = contextFor(kind)
  let base: EditableProject
  if (kind === 'interior') base = await createRefinedInteriorProject()
  else if (kind === 'island') base = await createRefinedIslandProject()
  else if (kind === 'coast') base = await createRefinedCoastProject()
  else {
    const blank = await createMixedBlankProject('forest', { title: '森林与建筑混合 · 正式视觉样本', widthMm: 40000, heightMm: 30000,
      preset: 'narrative', sceneId: 'formal-visual-mixed', now: stamp })
    base = (await prepareMixedProject(blank, defaultMixedInput(blank.document, 'forest', 'formal-visual-mixed-fixed'),
      { runtime: context, validation, profile: taskBudgetProfile('expanded'), nowMilliseconds: () => 0 })).project
  }
  const document = captureJson(base.document)
  document.sceneId = `formal-visual-${kind}`; document.revision = 0; document.createdAt = stamp; document.updatedAt = stamp
  // Ordinary authored/generated benchmark stays separate from the privacy QA deformation.
  const art = await replaceDocument(base, captureJson(document), kind)
  const owned = new Set([...Object.values(document.prefabInstances), ...Object.values(document.scatterGroups)].flatMap(group => Object.values(group.members).flatMap(member => member.propId ?? [])))
  for (const cluster of Object.values(document.decorationClusters)) for (const member of Object.values(cluster.members)) if (member.kind === 'prop' && member.entityId) owned.add(member.entityId)
  const independent = Object.values(document.props).filter(prop => !prop.editLocked && !owned.has(prop.id) && !document.userLayers[document.entityLayers[prop.id]].editLocked)
  if (independent.length < 2) throw new Error(`${kind} needs two genuinely independent editable Props.`)
  // One existing small independent Prop becomes the private sentinel; authored geometry/resources stay intact.
  const ordered = independent.sort((a, b) => a.visualBoundsMm.width * a.visualBoundsMm.height - b.visualBoundsMm.width * b.visualBoundsMm.height)
  const privateProp = ordered[0]; privateProp.visibility = 'gm'
  const privateMaskId = mask(document, privateProp, base, kind)
  const noteId = `formal-visual-${kind}-private-note`
  document.notes[noteId] = { id: noteId, floorId: privateProp.floorId, editLocked: false, visibility: 'gm', kind: 'note',
    text: 'FORMAL_VISUAL_PRIVATE_SENTINEL', anchor: { type: 'entity', entityKind: 'prop', entityId: privateProp.id } }
  document.entityLayers[noteId] = document.entityLayers[privateProp.id]
  const effect = await replaceDocument(base, document, kind)
  projectScene(effect.document, 'player', effect.appearance)
  let pair: EditableProject | undefined
  const movementFailures: string[] = []
  for (const [x, y] of [[250, 0], [-250, 0], [0, 250], [0, -250]]) {
    try {
      const moved = await prepareCompositionCommands(effect, [{ type: 'updateProp', id: privateProp.id,
        changes: { positionMm: point(privateProp.positionMm.x + x, privateProp.positionMm.y + y) } }],
      { runtime: contextFor(kind), validation, baseline: effect, budget: selectManualTransactionBudget(effect.document, 1, 1) })
      projectScene(moved.document, 'player', moved.appearance)
      pair = moved; break
    } catch (error) { movementFailures.push(String(error)) }
  }
  if (!pair) throw new Error(`Private pair has no legal supported movement: ${movementFailures.join('; ')}`)
  if (canonicalJson(effect.document.regions[privateMaskId]) !== canonicalJson(pair.document.regions[privateMaskId])) throw new Error('Private mask moved.')
  const publicBefore = projectScene(effect.document, 'player', effect.appearance), publicAfter = projectScene(pair.document, 'player', pair.appearance)
  if (canonicalJson(publicBefore).includes('FORMAL_VISUAL_PRIVATE_SENTINEL') || canonicalJson(publicAfter).includes('FORMAL_VISUAL_PRIVATE_SENTINEL')) throw new Error('Private note leaked into projection.')
  const neutralDocument = captureJson(effect.document), neutralVisual = visualBase(neutralDocument)!
  for (const row of [...Object.values(neutralVisual.lights), ...Object.values(neutralVisual.fogs), ...Object.values(neutralVisual.filters)]) row.enabled = false
  neutralVisual.environment.ambientOpacity = 0; neutralVisual.environment.exposure = 1
  const neutral = await replaceDocument(effect, neutralDocument, kind)
  const artNeutralDocument = captureJson(art.document), artNeutralVisual = visualBase(artNeutralDocument)!
  for (const row of [...Object.values(artNeutralVisual.lights), ...Object.values(artNeutralVisual.fogs), ...Object.values(artNeutralVisual.filters)]) row.enabled = false
  artNeutralVisual.environment.ambientOpacity = 0; artNeutralVisual.environment.exposure = 1
  const artNeutral = await replaceDocument(art, artNeutralDocument, kind)
  const structure = await structureControl(effect, kind)
  // Preflight public edit on the same supported command path before freezing input.
  let editablePropId: string | undefined
  for (const prop of ordered.slice(1)) {
    try {
      await prepareCompositionCommands(effect, [{ type: 'updateProp', id: prop.id, changes: { positionMm: point(prop.positionMm.x + 1, prop.positionMm.y) } }],
        { runtime: contextFor(kind), validation, baseline: effect, budget: selectManualTransactionBudget(effect.document, 1, 1) })
      editablePropId = prop.id; break
    } catch { /* A frozen sample must select a legal supported public edit. */ }
  }
  if (!editablePropId) throw new Error(`${kind} has no legal public 1mm edit.`)
  const views = []
  for (const crop of cropOrigins[kind]) {
    const original = art.document.exportBoundsMm
    const cropBoundsMm = { x: crop.x, y: crop.y, width: 4000, height: 3000 }
    const boundsMm = { x: Math.max(original.x, Math.min(crop.x - 6000, original.x + original.width - 16000)),
      y: Math.max(original.y, Math.min(crop.y - 4500, original.y + original.height - 12000)), width: 16000, height: 12000 }
    if (crop.x < boundsMm.x || crop.y < boundsMm.y || crop.x + 4000 > boundsMm.x + 16000 || crop.y + 3000 > boundsMm.y + 12000) throw new Error('Invalid fixed world crop.')
    const viewDocument = captureJson(art.document); viewDocument.exportBoundsMm = boundsMm
    const view = await replaceDocument(art, viewDocument, kind)
    views.push({ name: crop.name, boundsMm, cropBoundsMm, ...(await packageProject(view)),
      provenance: { beforeGenerationSha256: sha256Bytes(new TextEncoder().encode(canonicalJson(art.document.generation))),
        afterGenerationSha256: sha256Bytes(new TextEncoder().encode(canonicalJson(view.document.generation))),
        method: 'Existing detachChangedOutputs/pauseChangedCompositions reconcile changed-input receipts; all source snapshots and geometry remain preserved; no generation.' },
      method: 'Derived complete project changes exportBoundsMm and required generation provenance bookkeeping only; normal UI 4096x3072 render, exact native 1024x768 crop at 256px/m, no resampling.' })
  }
  return { variants: { art: await packageProject(art), artNeutral: await packageProject(artNeutral), effect: await packageProject(effect), neutral: await packageProject(neutral), privatePair: await packageProject(pair) }, views,
    controls: { editablePropId, privatePropId: privateProp.id, privateMaskId, privateNoteId: noteId, structure },
    summary: { format: 'sceneweave-formal-visual-fixture', version: 1, kind, mixedSeed: kind === 'mixed' ? 'formal-visual-mixed-fixed' : null,
      schemaVersion: effect.document.schemaVersion, historyIdentityVersion: effect.historyIdentity.version, appearanceVersion: effect.appearance.version,
      exportBoundsMm: effect.document.exportBoundsMm, entities: Object.fromEntries(['props', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'decorations', 'decorationClusters'].map(key => [key, count(effect.document[key as keyof SceneDocument] as object)])),
      assets: count(effect.assets), sources: count(effect.authoringSources), licenses: count(effect.licenses), contentHash: projectContentHash(toBundle(effect).project),
      modificationsToAuthoredBase: ['Frozen root identity and timestamps', 'One existing small independent Prop visibility set to GM', 'One fixed world private mask and anchored GM sentinel note'],
      art: { modificationsToAuthoredBase: ['Frozen root identity and timestamps only'], contentHash: projectContentHash(toBundle(art).project),
        neutralContentHash: projectContentHash(toBundle(artNeutral).project),
        scope: 'Ordinary original benchmark and matching artNeutral for human art review; contain no privacy QA sentinel/mask additions. All four fixed world views derive from art.' },
      neutral: 'Lights/fog/filters disabled; ambientOpacity=0 and exposure=1; contact shadows, geometry, materials, physical properties unchanged.',
      worldCrops: views.map(({ name, cropBoundsMm }) => ({ name, boundsMm: cropBoundsMm, width: 1024, height: 768, pixelsPerMetre: 256 })),
      scope: 'art/artNeutral and four art views are ordinary original benchmarks; effect/neutral/privatePair are explicitly privacy QA deformations. Three refined art benchmarks plus mixed representative technical workflows; legacy VIS01/02 rectangular inputs are separate. No real model, six-family terrain matrix, external VTT import, human art acceptance or P3 signoff.' } }
}
