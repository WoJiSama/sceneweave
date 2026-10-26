import { createRefinedIslandProject } from '../../src/platform/browser/content/refined-island.js'
import { createRefinedInteriorProject } from '../../src/platform/browser/content/refined-interior.js'
import { fromBundle, toBundle } from '../../src/application/workspace/project.js'
import { createCompositionContent } from '../../src/shared/appearance/graph.js'
import { applyCompositionCommands } from '../../src/shared/appearance/commands.js'
import { inspectDependencies } from '../../src/shared/commands/dependencies.js'
import { propFootprint, supportedPolygon, supportSurfaceAt, pointInPolygon, roomPoints } from '../../src/shared/geometry/geometry.js'
import { assertDoorwayClearances } from '../../src/shared/geometry/doorway-clearance.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { projectContentHash } from '../../src/shared/project/validate.js'
import { sha256Bytes } from '../../src/shared/validation/hash.js'
import { canonicalJson, encodeUtf8 } from '../../src/shared/validation/json.js'
import { sampleVisualBoundary } from '../../src/shared/visual/geometry.js'
import { inspectVisualChanges, type VisualCommand } from '../../src/shared/visual/commands.js'
import { validation } from '../../src/platform/browser/runtime.js'
import type { Prop, SceneDocument, SurfaceRef, PointMm } from '../../src/shared/model/scene.js'
import type { ProjectData } from '../../src/shared/model/project.js'

const hashJson = (value: unknown) => sha256Bytes(encodeUtf8(canonicalJson(value)))
const encode = async (bytes: Uint8Array) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(new Blob([Uint8Array.from(bytes)]))
})
const now = '2026-10-26T00:00:00.000Z'
const count = (record: object) => Object.keys(record).length

function instance(scene: SceneDocument, id: string, definitionId: string, positionMm: PointMm, supportRef: SurfaceRef, scale: number, rotationDeg: number): Prop {
  const definition = scene.propDefinitions[definitionId], v = definition.defaultVisualBoundsMm, f = definition.defaultFootprintMm
  return { id, floorId: 'visual-floor', editLocked: false, visibility: 'public', definitionRef: { id: definitionId, version: definition.version }, appearance: { ...definition.defaultAppearance },
    positionMm: { ...positionMm }, rotationDeg, visualBoundsMm: { x: Math.round(v.x * scale), y: Math.round(v.y * scale), width: Math.round(v.width * scale), height: Math.round(v.height * scale) },
    footprintMm: { width: Math.round(f.width * scale), height: Math.round(f.height * scale) }, footprintOffsetMm: { x: 0, y: 0 },
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight, supportRef: { ...supportRef }, ...(supportRef.kind === 'room' ? { roomId: supportRef.id } : {}),
    renderLayer: definition.defaultRenderLayer, renderOrder: definition.defaultRenderLayer === 'ground' ? 1 : 0, shadowClass: definition.defaultShadowClass, shadowOverride: null }
}
function support(scene: SceneDocument, p: PointMm): SurfaceRef {
  const room = Object.values(scene.rooms).find(room => pointInPolygon(p, roomPoints(scene, room)))
  return room ? { kind: 'room', id: room.id } : supportSurfaceAt(scene, p, 'visual-floor')!
}
function reserveDoor(scene: SceneDocument, p: PointMm): boolean {
  // Rectangular, stricter-than-door calibration exclusions; no added blocking props are put in these zones.
  return Object.values(scene.openings).some(opening => {
    if (opening.kind !== 'door') return false
    const wall = scene.walls[opening.wallId], a = scene.vertices[opening.offsetReferenceVertexId], b = scene.vertices[wall.startVertexId === a.id ? wall.endVertexId : wall.startVertexId]
    const length = Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm), along = opening.offsetMm + opening.widthMm / 2
    const x = a.xMm + (b.xMm - a.xMm) * along / length, y = a.yMm + (b.yMm - a.yMm) * along / length
    return Math.abs(x - p.x) < 2100 && Math.abs(y - p.y) < 2100
  })
}

/** Tooling only: full original artwork/real pixels and deterministic complete-v2 workload, never a measured-page API. */
export async function prepareVisualV2Fixture(name: string) {
  const match = /^(study|island)-(500|2000)$/.exec(name)
  if (!match) throw new Error('Unknown visual-v2 performance fixture')
  const sample = match[1] as 'study' | 'island', target = Number(match[2]), base = sample === 'study' ? await createRefinedInteriorProject() : await createRefinedIslandProject()
  const baseBundle = toBundle(base), originalBytes = await exportProject(baseBundle, validation), scene = structuredClone(base.document)
  const originalScene = structuredClone(scene), originalPropCount = count(scene.props)
  scene.sceneId = `performance-visual-v2-${name}`; scene.title = `视觉v2 ${name} · 独立密度负载`; scene.revision = 0; scene.createdAt = scene.updatedAt = now
  const markerId = `visual-v2-${sample}-marker`, markerPoint = sample === 'study' ? { x: 12750, y: 15500 } : { x: 1100, y: 1100 }
  const markerDefinition = sample === 'study' ? 'refined-prop-interior-lantern-brass' : 'refined-prop-island-rock-tidepool'
  const marker = instance(scene, markerId, markerDefinition, markerPoint, support(scene, markerPoint), sample === 'study' ? 1.7 : .6, 0)
  // Marker is a normal existing image definition/physical instance, independent from every group.
  scene.props[marker.id] = marker; scene.entityLayers[marker.id] = 'visual-layer-props'
  if (sample === 'study') {
    const id = 'visual-v2-study-border', a = { x: 2500, y: 18100 }, b = { x: 10000, y: 18100 }
    scene.visual!.boundaries[id] = { id, floorId: 'visual-floor', layerId: 'visual-layer-details', editLocked: false, visibility: 'public', closed: false,
      segments: [{ id: `${id}-segment`, start: a, control1: { x: 5000, y: 17950 }, control2: { x: 7500, y: 18250 }, end: b }], sampleSpacingMm: 650, toleranceMm: 30, binding: { kind: 'decoration' } }
    const edgeId = `${id}-grass`
    scene.visual!.edgeLooks[edgeId] = { id: edgeId, floorId: 'visual-floor', layerId: 'visual-layer-details', editLocked: false, visibility: 'public', boundaryId: id, kind: 'grass', side: 'left', widthMm: 150,
      color: '#77876A', accentColor: '#B8BC93', opacity: .4, intensity: .5, repeatMm: 170, seed: 'visual-v2-study-border-v1', enabled: true }
  }
  const palette = sample === 'study' ? ['refined-prop-interior-tableware', 'refined-prop-interior-papers-books', 'refined-prop-interior-lantern-brass'] : ['refined-prop-island-debris-scree', 'refined-prop-island-debris-driftwood', 'refined-prop-island-shrub-scree-sedge']
  const step = target === 500 ? 680 : sample === 'island' ? 330 : 350, margin = 650, b = scene.exportBoundsMm
  let index = 0
  const scales: number[] = []
  // Row-major lattice is an explicit synthetic density fixture, not natural composition or a scatter seed.
  for (let y = b.y + margin; y < b.y + b.height - margin && count(scene.props) < target; y += step) {
    for (let x = b.x + margin; x < b.x + b.width - margin && count(scene.props) < target; x += step) {
      if (Math.abs(x - markerPoint.x) < 1200 && Math.abs(y - markerPoint.y) < 1200 || reserveDoor(scene, { x, y })) continue
      // Keep the bound coast's first-control edit independent from added-object support.
      if (sample === 'island' && x < 6000 && y > 3000 && y < 11000) continue
      const point = { x, y }, supportRef = support(scene, point), scale = .48 + index % 4 * .055
      if (!supportRef) continue
      const prop = instance(scene, `visual-v2-${sample}-dense-${String(index).padStart(4, '0')}`, palette[index % palette.length], point, supportRef, scale, index * 47 % 360)
      const safe = { ...prop, footprintMm: { width: prop.footprintMm.width + 700, height: prop.footprintMm.height + 700 } }
      if (!supportedPolygon(scene, propFootprint(safe), supportRef, prop.floorId)) continue
      scene.props[prop.id] = prop; scene.entityLayers[prop.id] = 'visual-layer-props'; scales.push(scale); index++
    }
  }
  if (count(scene.props) !== target) throw new Error(`Visual-v2 fixture grid exhausted at ${count(scene.props)}/${target}`)
  if (sample === 'study') assertDoorwayClearances(scene, Object.values(scene.openings).filter(value => value.kind === 'door').map(value => ({ openingId: value.id, minWidthMm: 1200, approachDepthMm: 1200 })))
  let serial = 0
  const context = { ids: { nextId: () => `visual-v2-${name}-token-${serial++}` }, clock: { now: () => now } }, content = createCompositionContent(scene, context)
  const licensePath = Object.keys(base.licenses).map(hash => `licenses/${hash}.txt`)
  if (licensePath.length !== 1) throw new Error('Expected the one exact independent original-art license')
  const data: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 2, ...content, assets: structuredClone(base.assets), licenses: structuredClone(base.licenses), authoringSources: structuredClone(base.authoringSources),
    licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: licensePath[0], embedding: 'allowed' })) }
  const project = await fromBundle({ project: data, resources: base.resources }, validation), bundle = toBundle(project), bytes = await exportProject(bundle, validation)
  const cold = await importProject(bytes, validation)
  if (projectContentHash(cold.project) !== projectContentHash(data)) throw new Error('Visual-v2 fixture cold package content differs')
  for (const [id, prop] of Object.entries(originalScene.props)) if (canonicalJson(scene.props[id]) !== canonicalJson(prop)) throw new Error(`Benchmark prop changed: ${id}`)
  const curveId = sample === 'study' ? 'visual-v2-study-border' : 'q1-coast', changedCurve = structuredClone(content.document.visual!.boundaries[curveId])
  changedCurve.segments[0].control1.x += 500
  const firstEdge = Object.values(content.document.visual!.edgeLooks).find(edge => edge.boundaryId === curveId)!
  const curveCommands: VisualCommand[] = [{ type: 'upsertVisualBoundary', boundary: changedCurve }, { type: 'upsertVisualEdgeLook', edgeLook: firstEdge }]
  // Validate the exact supported control delta and its genuine write budget before any UI measurement.
  const curveCandidate = applyCompositionCommands(content, curveCommands, context)
  await fromBundle({ project: { ...data, ...curveCandidate }, resources: base.resources }, validation)
  const curveImpact = inspectVisualChanges(content.document, curveCandidate.document, curveCommands)
  if (curveImpact.commandCost > 256 || canonicalJson(content.document.props) !== canonicalJson(curveCandidate.document.props)) throw new Error('Curve workload exceeded its write budget or changed ordinary props')
  const curves = Object.values(scene.visual!.boundaries), uniqueImages = Object.values(project.assets)
  const summary = { fixtureVersion: 'visual-v2-refined-load-v1', sample, propCount: target, originalPropCount, addedPropCount: target - originalPropCount,
    editablePropId: marker.id, selectionPointMm: markerPoint, worldBoundsMm: scene.exportBoundsMm, sceneId: scene.sceneId, projectSchemaVersion: 2, documentSchemaVersion: 2, visualVersion: 1,
    sourceBenchmark: sample === 'study' ? 'createRefinedInteriorProject' : 'createRefinedIslandProject', originalPropFieldsPreserved: true, originalBenchmarkPackageSha256: sha256Bytes(originalBytes),
    assetReferenceCount: count(scene.assets), materialDefinitionCount: count(scene.materials), propDefinitionCount: count(scene.propDefinitions), prefabDefinitionCount: count(scene.prefabDefinitions), prefabInstanceCount: count(scene.prefabInstances), scatterGroupCount: count(scene.scatterGroups),
    originalScatterMemberCount: Object.values(scene.scatterGroups).reduce((n, group) => n + Object.values(group.members).filter(member => member.propId).length, 0),
    curveCount: curves.length, curveSegmentCount: curves.reduce((n, curve) => n + curve.segments.length, 0), curveSamplePointCount: curves.reduce((n, curve) => n + sampleVisualBoundary(curve).points.length, 0), edgeLookCount: count(scene.visual!.edgeLooks),
    surfaceOverlayCount: [...Object.values(scene.rooms).map(room => room.floorStyle), ...Object.values(scene.terrainAreas).map(area => area.surfaceStyle)].reduce((n, style) => n + (style?.overlays.length ?? 0), 0),
    lightCount: count(scene.visual!.lights), fogCount: count(scene.visual!.fogs), filterCount: count(scene.visual!.filters), environment: scene.visual!.environment, sourceCount: count(project.authoringSources),
    uniqueImageCount: uniqueImages.length, uniqueImagePixels: uniqueImages.reduce((n, asset) => n + asset.pixelWidth * asset.pixelHeight, 0), uniqueImageEncodedBytes: uniqueImages.reduce((n, asset) => n + asset.sizeBytes, 0),
    density: { worldAreaSquareMetres: scene.exportBoundsMm.width * scene.exportBoundsMm.height / 1e6, propsPerSquareMetre: target / (scene.exportBoundsMm.width * scene.exportBoundsMm.height / 1e6), addedGridStepMm: step,
      addedScaleRange: [Math.min(...scales), Math.max(...scales)], paletteDefinitionIds: palette, method: 'Explicit persisted row-major independent props at 48–64.5% of original artwork size. This is synthetic ordinary/stress density, not a natural-layout or beauty sample. Original benchmark furniture, groups and all fields remain intact; door/marker/boundary reserves are excluded.' },
    curveEdit: { boundaryId: curveId, segment: 0, handle: 'control1', deltaMm: { x: 500, y: 0 }, binding: sample === 'study' ? 'decoration' : 'terrain',
      expandedWriteCost: curveImpact.commandCost, expectedAffectedIds: curveImpact.affectedIds, expectedChangedIds: curveImpact.changedIds,
      resetMode: 'Visible ordinary UI undo after every adopted control edit; preserves original bound point identities and geometry without a compensating topology rewrite. Unchanged support dependants are disclosed, and are not counted as changed writes.' },
    contentHash: projectContentHash(data), documentSha256: hashJson(scene), authoringSourcesSha256: hashJson(data.authoringSources), licenseBindings: data.licenseBindings.length,
    validation: 'Strict browser fromBundle/exportProject/importProject with original SVG normalization, actual image/SVG pixel hashes and complete exact license closure; no legacy conversion or measured-page API.' }
  return { fixture: { name, summary, base64: await encode(bytes), sizeBytes: bytes.length, sha256: sha256Bytes(bytes) }, benchmark: { sample, base64: await encode(originalBytes), sizeBytes: originalBytes.length, sha256: sha256Bytes(originalBytes) } }
}
