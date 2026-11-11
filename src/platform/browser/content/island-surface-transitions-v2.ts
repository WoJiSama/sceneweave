import type { PointMm, SceneDocument, SurfaceOverlay } from '../../../shared/model/scene.js'
import type { VisualBoundary, VisualEdgeLook } from '../../../shared/visual/types.js'
import { geometryIdentityIds } from '../../../shared/commands/domain.js'
import { connectionFootprint, corridor, polygonInside, polygonsOverlap, terrainPoints } from '../../../shared/geometry/geometry.js'
import { cloneJson, canonicalJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { signedVisualArea } from '../../../shared/visual/geometry.js'

export const ISLAND_SURFACE_TRANSITIONS_V2_LIMITS = Object.freeze({ sourcePatches: 8, maxOpenGrassRuns: 16, newFragments: 4 })
const prefix = 'island-surface-v2-'
const areaIds = ['q1-low', 'q1-high'] as const
const patchIds = ['q1-west-grass', 'q1-south-grass', 'q1-north-moss', 'q1-east-moss', 'q1-south-east-moss',
  'q1-clearing-rock', 'q1-crown-rock', 'q1-eastern-rock'] as const
const originalCurveIds = Array.from({ length: 8 }, (_, index) => `detail-island-patch-${index + 1}`)
// An exact fixed-construction witness detects manual paint/curve changes. It is
// not a validation credential; the entire current model is checked on each call.
const sourceWitness = '6a1ac6ca8d0e7f7a2ee6ee937ea5b1c14229d3dfca8b85ef5a639f644dc27167'
const p = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const fixed = (points: PointMm[]) => signedVisualArea(points) < 0 ? [...points].reverse() : points
const mix = (a: PointMm, b: PointMm, t: number) => p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const fail = (): never => { throw new Error('草岩接缝2只用于确切的新建岩岛基线；不替换人工、私密、锁定或已应用的地表。') }

function assertSource(scene: SceneDocument): void {
  const visual = visualBase(scene), preset = scene.presetSnapshot
  if (!visual) return fail()
  if (!['sceneweave-detailed-island', 'sceneweave-natural-detail-island'].includes(preset.presetId)
    || preset.presetVersion !== 1 || scene.mapMode !== 'scene' || Object.keys(scene.floors).length !== 1
    || areaIds.some(id => !scene.terrainAreas[id]?.surfaceStyle)
    || Object.values(scene.terrainAreas).some(area => area.visibility !== 'public' || area.editLocked)
    || Object.values(scene.props).some(prop => prop.visibility !== 'public' || prop.editLocked)
    || Object.values(scene.terrainConnections).some(connection => connection.visibility !== 'public' || connection.editLocked)
    || Object.values(scene.userLayers).some(layer => layer.editLocked)) fail()
  if ([...geometryIdentityIds(scene)].some(id => id.startsWith(prefix))) fail()
  const witness = { surfaces: areaIds.map(id => scene.terrainAreas[id].surfaceStyle),
    boundaries: originalCurveIds.map(id => visual.boundaries[id]),
    looks: Object.values(visual.edgeLooks).filter(look => originalCurveIds.includes(look.boundaryId)).sort((a, b) => a.id.localeCompare(b.id)) }
  if (witness.boundaries.some(boundary => !boundary) || sha256Text(canonicalJson(witness)) !== sourceWitness) fail()
  for (const id of areaIds) {
    const layer = scene.userLayers[scene.entityLayers[id]], area = scene.terrainAreas[id]
    if (!layer || layer.floorId !== area.floorId) fail()
  }
}

/** Saved notches and tongues, not view-dependent noise. The original material
 * phase/scale/tint/opacity stay intact while the source silhouette gains local
 * protrusions and bare gaps. Resulting geometry still undergoes full checking. */
function transitionOutline(points: PointMm[], phase: number): PointMm[] {
  const ring = fixed(points), result: PointMm[] = []
  for (const [index, a] of ring.entries()) {
    const b = ring[(index + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y)
    result.push({ ...a })
    if (length < 220 || (index + phase) % 3 === 1) continue
    const outward = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length }
    const factor = [.11, -.085, .065, -.12][(index + phase) % 4]
    const amount = Math.sign(factor) * Math.min(240, length * Math.abs(factor))
    const first = mix(a, b, .34), second = mix(a, b, .59)
    result.push(p(first.x + outward.x * amount, first.y + outward.y * amount),
      p(second.x + outward.x * amount * .62, second.y + outward.y * amount * .62))
  }
  return fixed(result)
}
function safeEnvelope(scene: SceneDocument, areaId: string, envelope: PointMm[]): boolean {
  const owner = scene.terrainAreas[areaId]
  return polygonInside(envelope, terrainPoints(owner))
    && !Object.values(scene.terrainAreas).some(area => area.id !== owner.id && area.floorId === owner.floorId
      && area.coveragePriority >= owner.coveragePriority && polygonsOverlap(envelope, terrainPoints(area)))
    && !Object.values(scene.terrainConnections).some(connection => connection.floorId === owner.floorId && polygonsOverlap(envelope, connectionFootprint(connection)))
}
function addOpenGrass(scene: SceneDocument, areaId: string, patch: SurfaceOverlay, index: number): void {
  const visual = visualBase(scene)!, owner = scene.terrainAreas[areaId], layerId = 'visual-layer-details'
  const ring = patch.boundaryMm, candidates = ring.map((a, edge) => ({ a, b: ring[(edge + 1) % ring.length], edge }))
    .sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))
  let runs = 0
  const used: number[] = []
  for (const candidate of candidates) {
    if (runs === 2) break
    if (used.some(edge => Math.min((edge - candidate.edge + ring.length) % ring.length, (candidate.edge - edge + ring.length) % ring.length) < 3)) continue
    const start = mix(candidate.a, candidate.b, .18), end = mix(candidate.a, candidate.b, .75)
    const spanMm = Math.hypot(end.x - start.x, end.y - start.y)
    if (spanMm < 170) continue
    const widthMm = Math.min([85, 135, 190, 110, 155][(index + runs * 2) % 5], Math.floor(spanMm * .42))
    const repeatMm = 210 + index % 3 * 35
    // Include the full declared width, end caps and short blade paint padding.
    if (!safeEnvelope(scene, areaId, corridor(start, end, (widthMm + repeatMm) * 2, true))) continue
    const id = `${prefix}edge-${index + 1}-${runs + 1}`, lookId = `${id}-grass`
    const boundary: VisualBoundary = { id, floorId: owner.floorId, layerId, visibility: 'public', editLocked: false, closed: false,
      segments: [{ id: `${id}-segment`, start, end, control1: mix(start, end, 1 / 3), control2: mix(start, end, 2 / 3) }],
      sampleSpacingMm: 350, toleranceMm: 15, binding: { kind: 'decoration' } }
    const look: VisualEdgeLook = { id: lookId, floorId: owner.floorId, layerId, visibility: 'public', editLocked: false, boundaryId: id,
      kind: 'grass', side: index < 5 ? 'left' : 'right', widthMm, color: '#738350', accentColor: '#BBC28A', opacity: .56,
      intensity: .58, repeatMm, seed: `island-grass-transition-2-${index + 1}-${runs + 1}`, enabled: true }
    visual.boundaries[id] = boundary; visual.edgeLooks[lookId] = look
    used.push(candidate.edge); runs++
  }
}
function addFragment(scene: SceneDocument, areaId: string, patch: SurfaceOverlay, index: number): void {
  const ring = patch.boundaryMm
  for (let attempt = 0; attempt < ring.length; attempt++) {
    const a = ring[(attempt + index * 3) % ring.length], b = ring[(attempt + index * 3 + 1) % ring.length]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 200) continue
    const normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length }, middle = mix(a, b, .52)
    const radius = 100 + index * 15, center = p(middle.x + normal.x * (radius + 100), middle.y + normal.y * (radius + 100))
    const boundaryMm = fixed(Array.from({ length: 7 }, (_, vertex) => {
      const angle = vertex / 7 * Math.PI * 2, factor = [.78, 1, .85, .72, .94, .8, .88][(vertex + index) % 7]
      return p(center.x + Math.cos(angle) * radius * factor, center.y + Math.sin(angle) * radius * factor * .72)
    }))
    if (!safeEnvelope(scene, areaId, boundaryMm)) continue
    const overlays = scene.terrainAreas[areaId].surfaceStyle!.overlays
    overlays.push({ id: `${prefix}fragment-${index + 1}`, boundaryMm, paint: cloneJson(patch.paint), blendWidthMm: 65 + index * 15,
      renderOrder: Math.max(...overlays.map(value => value.renderOrder)) + 1 })
    return
  }
  throw new Error('草岩接缝2找不到避开真实台阶与高优先级地形的碎片范围。')
}

/** New-layout construction only. Full model validation surrounds this detached
 * recipe; resources, physical geometry and saved world material parameters are
 * preserved. It is intentionally not an open or regeneration hook. */
export function applyIslandSurfaceTransitionsV2(input: SceneDocument): SceneDocument {
  const checked = validateSceneDocument(input)
  if (!checked.ok) throw new Error(`草岩接缝2基线无效：${checked.errors.map(issue => issue.message).join('；')}`)
  assertSource(checked.document)
  const scene = cloneJson(checked.document), visual = visualBase(scene)!
  for (const id of originalCurveIds) { delete visual.edgeLooks[`${id}-grass`]; delete visual.boundaries[id] }
  const sourcePatches: { areaId: string; patch: SurfaceOverlay }[] = []
  for (const [index, id] of patchIds.entries()) {
    const areaId = index < 5 ? 'q1-low' : 'q1-high', patch = scene.terrainAreas[areaId].surfaceStyle!.overlays.find(value => value.id === id)!
    patch.boundaryMm = transitionOutline(patch.boundaryMm, index)
    patch.blendWidthMm = [120, 190, 150, 95, 170, 125, 105, 140][index]
    addOpenGrass(scene, areaId, patch, index)
    sourcePatches.push({ areaId, patch })
  }
  for (const [fragment, index] of [0, 2, 5, 7].entries()) {
    const source = sourcePatches[index]; addFragment(scene, source.areaId, source.patch, fragment)
  }
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(`草岩接缝2结果无效：${result.errors.map(issue => `${issue.entityId ?? ''}:${issue.message}`).join('；')}`)
  return result.document
}
