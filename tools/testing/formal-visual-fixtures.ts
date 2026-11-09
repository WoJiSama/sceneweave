/** Preparation only. Never imported by the production app or a measured page. */
import { createRefinedInteriorProject } from '../../src/platform/browser/content/refined-interior.js'
import { createRefinedIslandProject } from '../../src/platform/browser/content/refined-island.js'
import { createRefinedCoastProject } from '../../src/platform/browser/content/refined-coast.js'
import { createShoreBlankProject } from '../../src/platform/browser/content/shore-blank.js'
import { prepareTerrainProject } from '../../src/application/workspace/terrain.js'
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
import { getLegacyGeneration } from '../../src/shared/terrain-generation/composition-contracts.js'
import { connectionFootprint, terrainPoints } from '../../src/shared/geometry/geometry.js'
import { terrainVariantV2DefinitionId } from '../../src/shared/visual/terrain-variant-v2-specs.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { projectContentHash } from '../../src/shared/project/validate.js'
import { sha256Bytes } from '../../src/shared/validation/hash.js'
import { canonicalJson, captureJson } from '../../src/shared/validation/json.js'
import type { BoundsMm, Prop, SceneDocument } from '../../src/shared/model/scene.js'
import type { SceneCommand } from '../../src/shared/commands/commands.js'

export type FormalVisualKind = 'interior' | 'island' | 'coast' | 'mixed' | 'current-island'
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

interface FormalVisualCrop {
  name: string; x: number; y: number; targetIds: string[]; framingBasis: string
}
// Frozen after reading the actual fixtures-second ordinary art archives. These
// are geometry-selected observations, not a claim that the art has passed review.
const mixedRoomId = 'interior-5e356ab4ff6b517b90cb862ba8b91f8a85d7f83d'
const cropOrigins: Record<Exclude<FormalVisualKind, 'current-island'>, FormalVisualCrop[]> = {
  interior: [
    { name: 'bedroom-door-and-shared-wall', x: 12500, y: 5900,
      targetIds: ['q2-door-bedroom', 'q2-wall-vertical-2-0', 'q2-bedroom', 'q2-hall'],
      framingBasis: 'Door endpoints (14500,6700)-(14500,8100) and the 350mm shared wall at x=14500 lie inside the 4000x3000mm frame, showing the complete doorway and both room sides.' },
    { name: 'study-desk-and-papers', x: 16000, y: 13000,
      targetIds: ['q2-desk-writing-35', 'q2-papers-books-37', 'q2-lantern-brass-38', 'q2-chair-cushion-36'],
      framingBasis: 'Rotated image AABBs in mm: desk [16850,13675,19150,14925], papers [17324,13968,18377,14732], lantern [18500,14060,18900,14540], chair [17560,14930,18440,15870]. All four complete image bounds fit the frame.' },
    { name: 'northwest-wall-corner-and-stove', x: 1400, y: 1800,
      targetIds: ['q2-wall-north-0', 'q2-wall-vertical-0-0', 'q2-stove-masonry-1'],
      framingBasis: 'The two 350mm walls meet at (2000,2000). Stove image AABB [2800,2975,4800,4725] fits completely inside [1400,1800,5400,4800].' },
    { name: 'south-entry-and-yard', x: 10800, y: 15500,
      targetIds: ['q2-entry', 'q2-wall-south-1', 'q2-hall', 'q2-yard'],
      framingBasis: 'Entry endpoints (11950,17000)-(13550,17000), the 350mm south wall and the real hall/yard contact all lie in frame. This source contains a yard, not a raised terrace.' },
  ],
  island: [
    { name: 'north-bay-concave-shore', x: 8700, y: 3300,
      targetIds: ['q1-coast', 'q1-low', 'q1-water'],
      framingBasis: 'The closed coast segments 2/3 share the inward bay point (10500,4900), between (7800,3400) and (14300,2400). Frame includes this bay and both water/low-terrain sides.' },
    { name: 'north-cape-convex-shore', x: 12300, y: 1200,
      targetIds: ['q1-coast', 'q1-low', 'q1-water', 'q1-north-moss'],
      framingBasis: 'Closed coast segments 3/4 meet at the outward north cape (14300,2400); sampled low-terrain minimum y=2354. Frame includes cape, north moss coverage and sea.' },
    { name: 'stairs-and-two-landings', x: 6750, y: 6900,
      targetIds: ['q1-stairs', 'q1-low', 'q1-high', 'q1-crown'],
      framingBasis: 'Stair endpoints (7300,8400)/(10200,8400), width 1500mm, yield a complete corridor x=7300..10200,y=7650..9150. Frame leaves 550mm before/after endpoints and includes both real supporting surfaces.' },
    { name: 'tree-rock-grass-group', x: 9450, y: 5100,
      targetIds: ['q1-tree-north-asym-1', 'q1-rock-layered-shelf-18', 'q1-shrub-scree-sedge-33', 'q1-high'],
      framingBasis: 'Rotated image AABBs in mm: tree [9780,5358,12421,7843], layered rock [12112,5893,13087,6506], sedge [11383,6017,12617,7183]. All three complete bounds fit the frame.' },
  ],
  coast: [
    { name: 'west-bay-sand-water', x: 4400, y: 7300,
      targetIds: ['q2-coast-shoreline', 'q2-coast-sand', 'q2-coast-water', 'q2-coast-wet-belt', 'q2-coast-shallow-belt', 'q2-coast-tide'],
      framingBasis: 'Shared shoreline segments 1/2 meet at the landward bay (6200,8800). The same sampled chain binds sand/water; frame includes that seam and the near-edge wet-sand/shallow-water coverage, without claiming the complete wide bands fit.' },
    { name: 'central-cape-sand-water', x: 8300, y: 6300,
      targetIds: ['q2-coast-shoreline', 'q2-coast-sand', 'q2-coast-water', 'q2-coast-wet-belt', 'q2-coast-shallow-belt', 'q2-coast-tide'],
      framingBasis: 'Shared shoreline segments 2/3 meet at the seaward cape (10000,7600). Frame spans the actual sand/water seam and its tide edge on both physical terrain sides.' },
    { name: 'western-split-and-shelf-reefs', x: 300, y: 3300,
      targetIds: ['q2-coast-reef-split-1', 'q2-coast-reef-shelf-2', 'q2-coast-water'],
      framingBasis: 'Rotated image AABBs in mm: split reef [1241,3775,3659,5925], shelf reef [404,3781,1796,5259], both complete in frame. The adjacent pool reef extends to x=4556 and is deliberately not claimed as a complete third reef.' },
    { name: 'driftwood-shell-material-group', x: 2900, y: 11800,
      targetIds: ['q2-coast-driftwood-41', 'q2-coast-shell-fan-45', 'q2-coast-shell-fan-48', 'q2-coast-shell-spiral-46', 'q2-coast-wrack-43', 'q2-coast-sand'],
      framingBasis: 'Rotated image AABBs in mm: driftwood [3703,12489,6098,14112], fan45 [3796,13436,4244,13764], fan48 [3222,12696,3758,13164], spiral [4443,13695,4757,14025], wrack [3677,12432,4723,12968]. All complete bounds fit the sand-supported frame.' },
  ],
  mixed: [
    { name: 'north-door-route-contact', x: 27000, y: 3900,
      targetIds: ['interior-a301b9df390d2a46109843ea051beb94ab2b3363', `${mixedRoomId}:wall:0`, mixedRoomId, 'mixed-d822581002324a5a02dc13baf6f9e5de'],
      framingBasis: 'The only door endpoints are (28300,5500)-(29700,5500), north wall thickness 200mm. The connecting path has centerline y=4899 and width 1000mm. Frame contains the complete doorway, wall and real exterior route contact.' },
    { name: 'southeast-furniture-south-wall', x: 29850, y: 10000,
      targetIds: ['interior-12b59710e7fd0e904b184b4a146405570218e9d8', 'interior-37738d4b95553d23bca2827bf250c02d1ad17179', 'interior-c705019ad4cfc99681de0b60ef0d06d60757c520', `${mixedRoomId}:wall:2`],
      framingBasis: 'Image AABBs in mm: table [32200,11100,33700,12600], chair [32880,10200,33700,11100], cupboard [29963,11600,31813,12600], all complete in frame. South wall y=12800 plus/minus100mm also fits; the east-wall corner is not the target.' },
    { name: 'forest-tree-root-ground', x: 20800, y: 17100,
      targetIds: ['forest-792be3dd5774530c04e13c45855704c2', 'mixed-7c2bebfd7ae4fb911640475e77524c93'],
      framingBasis: 'Tree world root is (22224,19004). Its actual fixed nearSide rootAnchor=(0,521) yields image AABB [21574,17758,22874,19208], completely inside frame, with real ground support. No material transition or distinct tree-variant group is asserted.' },
    { name: 'forest-path-junction', x: 2000, y: 18000,
      targetIds: ['forest-b38e90614106ead9a50cc4c42cd61351', 'mixed-d822581002324a5a02dc13baf6f9e5de'],
      framingBasis: 'Forest path width1200mm and connecting path width1000mm share endpoint (3200,19500). Their true line segments diverge east/north inside frame, showing the actual junction rather than an invented vegetation transition.' },
  ],
}

function currentIslandCrops(project: EditableProject): FormalVisualCrop[] {
  const scene = project.document, stairs = Object.values(scene.terrainConnections).find(row => row.route?.stairStyle === 'naturalRock')
  const tree = Object.values(scene.props).find(row => row.definitionRef?.id === terrainVariantV2DefinitionId('tree-highland-copse'))
  const coast = visualBase(scene)!.boundaries['terrain-coast-curve'], high = scene.terrainAreas['terrain-high']
  if (!stairs || !tree || !coast || !high) throw new Error('Current island must contain its real natural-rock route, highland tree, coast and high ground.')
  const centered = (name: string, bounds: BoundsMm, targetIds: string[], framingBasis: string): FormalVisualCrop => ({ name,
    x: Math.max(scene.exportBoundsMm.x, Math.min(Math.round(bounds.x + bounds.width / 2 - 2000), scene.exportBoundsMm.x + scene.exportBoundsMm.width - 4000)),
    y: Math.max(scene.exportBoundsMm.y, Math.min(Math.round(bounds.y + bounds.height / 2 - 1500), scene.exportBoundsMm.y + scene.exportBoundsMm.height - 3000)), targetIds, framingBasis })
  const stairBounds = pointsBounds(connectionFootprint(stairs))
  if (stairBounds.width > 3400 || stairBounds.height > 2400) throw new Error('Selected natural-rock stairs do not fit the fixed native crop with real landing context.')
  const treeBounds = pointsBounds(propPaintPolygon(tree, propPresentation(project.appearance, tree.id)))
  const coastPoints = scene.terrainAreas['terrain-low'].boundaryMm.map(row => row.positionMm), north = [...coastPoints].sort((a, b) => a.y - b.y || a.x - b.x)[0]
  const highPoints = terrainPoints(high), east = [...highPoints].sort((a, b) => b.x - a.x || a.y - b.y)[0]
  return [
    centered('natural-rock-stairs-and-two-landings', stairBounds, [stairs.id, stairs.from.surfaceRef.id, stairs.to.surfaceRef.id],
      `Actual algorithm7 naturalRock corridor bounds ${canonicalJson(stairBounds)}; full route and at least 300mm landing context fit the 4000x3000mm frame.`),
    centered('highland-tree-root-and-ground', treeBounds, [tree.id, tree.supportRef.id],
      `Actual algorithm7 compact highland tree fixed nearSide image bounds ${canonicalJson(treeBounds)}, including its root and real support.`),
    centered('current-shore-material-transition', { ...north, width: 0, height: 0 }, ['terrain-coast-curve', 'terrain-low', 'terrain-water'],
      `Actual generated coast northern sample ${canonicalJson(north)} and both adjacent materials; no full-island coverage is asserted.`),
    centered('current-highland-cliff-and-grass', { ...east, width: 0, height: 0 }, ['terrain-high', 'terrain-low'],
      `Actual generated highland eastern sample ${canonicalJson(east)} and its grass/cliff contact; no synthetic fixture geometry added.`),
  ]
}

function currentIslandEvidence(project: EditableProject) {
  const generation = getLegacyGeneration(project.document), recipes = Object.values(generation?.recipes ?? {}).filter(row => row.algorithmId === 'terrain-scene')
  const stairs = Object.values(project.document.terrainConnections).filter(row => row.kind === 'stairs')
  const trees = Object.values(project.document.props).filter(row => row.definitionRef?.id === terrainVariantV2DefinitionId('tree-highland-copse'))
  if (!recipes.length || recipes.some(row => row.algorithmVersion !== 7 || row.recipeVersion !== 7)
    || !stairs.length || stairs.some(row => row.route?.stairStyle !== 'naturalRock') || !trees.length) throw new Error('Current visual input did not consume algorithm7, naturalRock and compact highland vegetation.')
  return { source: 'createShoreBlankProject(includeTerrainVariants=true, includeTerrainVariantV2=true) -> prepareTerrainProject(algorithmVersion=7)',
    seed: 'terrain-v6-closure-20261104', algorithmVersion: 7, rendererBranch: 'drawRoutedConnectionBody/naturalRock',
    recipes: recipes.map(row => ({ id: row.id, algorithmId: row.algorithmId, algorithmVersion: row.algorithmVersion, recipeVersion: row.recipeVersion })),
    stairs: stairs.map(row => ({ id: row.id, route: captureJson(row.route!), from: row.from, to: row.to, widthMm: row.widthMm })),
    trees: trees.map(row => {
      const sourceId = project.appearance.propSources[row.id], source = project.appearance.sources[sourceId], presentation = project.appearance.presentations?.[sourceId]
      if (source?.kind !== 'prop' || source.snapshot.definitionRef?.id !== row.definitionRef!.id || presentation?.mode !== 'nearSide') throw new Error('Highland tree did not consume its fixed presentation source.')
      return { id: row.id, definitionRef: row.definitionRef, sourceId, presentation: captureJson(presentation),
        assetId: row.appearance.kind === 'image' ? row.appearance.assetId : null }
    }),
  }
}

/** 256px/m = 32px/125mm. Keep the approved integer-mm crop fixed while
 * choosing a complete derived view whose crop offset lands on native pixels. */
function alignedViewOrigin(cropStart: number, cropSize: number, worldStart: number, worldSize: number, viewSize: number, preferredInset: number): number {
  const minimum = Math.max(worldStart, cropStart + cropSize - viewSize)
  const maximum = Math.min(worldStart + worldSize - viewSize, cropStart)
  const firstStep = Math.ceil((cropStart - maximum) / 125), lastStep = Math.floor((cropStart - minimum) / 125)
  if (minimum > maximum || firstStep > lastStep) throw new Error('No in-bounds native-pixel-aligned view can contain the fixed world crop.')
  const preferred = Math.max(minimum, Math.min(cropStart - preferredInset, maximum))
  const step = Math.max(firstStep, Math.min(Math.round((cropStart - preferred) / 125), lastStep))
  return cropStart - step * 125
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
  else if (kind === 'current-island') {
    const blank = await createShoreBlankProject('island', { title: '当前算法7岩岛 · 正式成图输入', sceneId: `formal-visual-${kind}`, now: stamp,
      widthMm: 24000, heightMm: 18000, preset: 'narrative', gridVisible: false }, undefined, true, true)
    base = (await prepareTerrainProject(blank, { sceneId: blank.document.sceneId, kind: 'island', seed: 'terrain-v6-closure-20261104',
      widthMm: 24000, heightMm: 18000, algorithmVersion: 7, budgetProfileId: 'standard', quality: 'standard' },
    { runtime: context, validation, budget: taskBudgetProfile('standard'), birthToken: 'formal-visual-current-island-birth' })).project
  }
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
  const currentCapabilities = kind === 'current-island' ? currentIslandEvidence(art) : undefined
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
  for (const crop of kind === 'current-island' ? currentIslandCrops(art) : cropOrigins[kind]) {
    const original = art.document.exportBoundsMm
    const cropBoundsMm = { x: crop.x, y: crop.y, width: 4000, height: 3000 }
    const boundsMm = { x: alignedViewOrigin(crop.x, 4000, original.x, original.width, 16000, 6000),
      y: alignedViewOrigin(crop.y, 3000, original.y, original.height, 12000, 4500), width: 16000, height: 12000 }
    if (crop.x < boundsMm.x || crop.y < boundsMm.y || crop.x + 4000 > boundsMm.x + 16000 || crop.y + 3000 > boundsMm.y + 12000) throw new Error('Invalid fixed world crop.')
    if (boundsMm.x < original.x || boundsMm.y < original.y || boundsMm.x + 16000 > original.x + original.width || boundsMm.y + 12000 > original.y + original.height) throw new Error('Derived view exceeds the original full export bounds.')
    const viewDocument = captureJson(art.document); viewDocument.exportBoundsMm = boundsMm
    const view = await replaceDocument(art, viewDocument, kind)
    views.push({ name: crop.name, boundsMm, cropBoundsMm, targetIds: [...crop.targetIds], framingBasis: crop.framingBasis, ...(await packageProject(view)),
      pixelAlignment: { worldPeriodMm: 125, pixelsPerPeriod: 32,
        sourceRectPx: [(crop.x - boundsMm.x) / 125 * 32, (crop.y - boundsMm.y) / 125 * 32, 1024, 768] },
      provenance: { beforeGenerationSha256: sha256Bytes(new TextEncoder().encode(canonicalJson(art.document.generation))),
        afterGenerationSha256: sha256Bytes(new TextEncoder().encode(canonicalJson(view.document.generation))),
        method: 'Existing detachChangedOutputs/pauseChangedCompositions reconcile changed-input receipts; all source snapshots and geometry remain preserved; no generation.' },
      method: 'Derived complete project changes exportBoundsMm and required generation provenance bookkeeping only; normal UI 4096x3072 render, exact native 1024x768 crop at 256px/m, no resampling.' })
  }
  return { variants: { art: await packageProject(art), artNeutral: await packageProject(artNeutral), effect: await packageProject(effect), neutral: await packageProject(neutral), privatePair: await packageProject(pair) }, views,
    controls: { editablePropId, privatePropId: privateProp.id, privateMaskId, privateNoteId: noteId, structure },
    summary: { format: 'sceneweave-formal-visual-fixture', version: 1, kind, mixedSeed: kind === 'mixed' ? 'formal-visual-mixed-fixed' : null,
      ...(currentCapabilities ? { currentCapabilities } : {}),
      schemaVersion: effect.document.schemaVersion, historyIdentityVersion: effect.historyIdentity.version, appearanceVersion: effect.appearance.version,
      exportBoundsMm: effect.document.exportBoundsMm, entities: Object.fromEntries(['props', 'rooms', 'walls', 'openings', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'decorations', 'decorationClusters'].map(key => [key, count(effect.document[key as keyof SceneDocument] as object)])),
      assets: count(effect.assets), sources: count(effect.authoringSources), licenses: count(effect.licenses), contentHash: projectContentHash(toBundle(effect).project),
      modificationsToAuthoredBase: ['Frozen root identity and timestamps', 'One existing small independent Prop visibility set to GM', 'One fixed world private mask and anchored GM sentinel note'],
      art: { modificationsToAuthoredBase: ['Frozen root identity and timestamps only'], contentHash: projectContentHash(toBundle(art).project),
        neutralContentHash: projectContentHash(toBundle(artNeutral).project),
        scope: 'Ordinary original benchmark and matching artNeutral for human art review; contain no privacy QA sentinel/mask additions. All four fixed world views derive from art.' },
      neutral: 'Lights/fog/filters disabled; ambientOpacity=0 and exposure=1; contact shadows, geometry, materials, physical properties unchanged.',
      worldCrops: views.map(({ name, cropBoundsMm, targetIds, framingBasis }) => ({ name, boundsMm: cropBoundsMm, width: 1024, height: 768, pixelsPerMetre: 256, targetIds, framingBasis })),
      scope: kind === 'current-island'
        ? 'Separate current algorithm7 production materialization and naturalRock/compact-tree consumption evidence; original authored island remains an unchanged regression input. Art/neutral/crops do not grant human art acceptance or P3 signoff.'
        : 'art/artNeutral and four art views are ordinary original benchmarks; effect/neutral/privatePair are explicitly privacy QA deformations. Three refined art benchmarks plus mixed representative technical workflows; legacy VIS01/02 rectangular inputs are separate. No real model, six-family terrain matrix, external VTT import, human art acceptance or P3 signoff.' } }
}
