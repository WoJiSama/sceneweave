import polygonClipping, { type MultiPolygon } from 'polygon-clipping'
import type { MaterialPaint, PointMm, SceneDocument, SurfaceOverlay, TerrainArea } from '../model/scene.js'
import type { ExecutionBudget } from '../budget/task-budget.js'
import { terrainPoints, pointInPolygon } from '../geometry/geometry.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { SHORE_MATERIAL_IDS } from './shore-art.js'
import { visualBase } from './base.js'
import { sampleVisualBoundary, signedVisualArea } from './geometry.js'
import { VISUAL_LIMITS, type VisualBoundary, type VisualEdgeLook, type VisualSystem } from './types.js'

type Surface = 'rock' | 'grass' | 'water' | 'shallow' | 'sand' | 'other'
type PaletteKey = keyof typeof SHORE_MATERIAL_IDS
type Ring = PointMm[]
type RawRing = [number, number][]
type OverlayPiece = { points: Ring; blendWidthMm: number }
export interface ShoreSurfaceOptions { meter?: ExecutionBudget }
export const SHORE_SURFACE_LIMITS = Object.freeze({ overlaysPerArea: 128, pointsPerOverlay: 512 })
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const q = (p: PointMm): PointMm => ({ x: Math.round(p.x), y: Math.round(p.y) })
const token = (seed: string, kind: string, ...keys: (string | number)[]) => `shore-v1-${kind}-${sha256Text(canonicalJson([seed, ...keys])).slice(0, 24)}`
const signedArea = (points: Ring) => points.reduce((sum, point, i) => sum + point.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * point.y, 0) / 2
const rawRing = (ring: Ring): RawRing => ring.map(p => [p.x, p.y])
const edges = (area: TerrainArea) => terrainPoints(area).map((a, i, ring) => ({ a, b: ring[(i + 1) % ring.length], i }))
const fixedMaterialRoles: Record<string, Surface> = {
  [SHORE_MATERIAL_IDS.rockDry]: 'rock', [SHORE_MATERIAL_IDS.rockWet]: 'rock', [SHORE_MATERIAL_IDS.grass]: 'grass',
  [SHORE_MATERIAL_IDS.waterDeep]: 'water', [SHORE_MATERIAL_IDS.waterShallow]: 'shallow', [SHORE_MATERIAL_IDS.sandDry]: 'sand', [SHORE_MATERIAL_IDS.sandWet]: 'sand',
  'refined-material-island-material-strata': 'rock', 'refined-material-island-material-moss': 'grass', 'refined-material-island-material-shallows': 'shallow',
  'refined-material-coast-material-deep-water': 'water', 'refined-material-coast-material-wet-sand': 'sand', 'refined-material-coast-material-dry-sand': 'sand',
}
function materialRole(scene: SceneDocument, area: TerrainArea): Surface {
  const material = area.surfaceStyle && scene.materials[area.surfaceStyle.base.materialRef.id]
  if (!material) return 'other'
  if (Object.hasOwn(fixedMaterialRoles, material.id)) return fixedMaterialRoles[material.id]
  // A theme may contain words such as "苔岛" or "海岸" on every material.
  // Only exact semantic tags are a fallback; names/theme substrings are not.
  const tags = new Set(material.tags.map(tag => tag.trim().toLowerCase()))
  const has = (...values: string[]) => values.some(value => tags.has(value))
  if (has('shallow', 'shallows', 'shallow water', '浅水', '浅滩')) return 'shallow'
  if (has('water', 'sea', 'lake', 'river', 'pond', 'ocean', '海水', '深水', '湖水', '河水')) return 'water'
  if (has('sand', 'beach', '砂', '沙', '沙地', '湿沙', '干沙')) return 'sand'
  if (has('rock', 'stone', 'strata', 'cliff', '岩', '石', '岩石', '岩地')) return 'rock'
  if (has('grass', 'meadow', 'moss', 'forest', '草', '苔', '草地', '苔草', '森林')) return 'grass'
  return 'other'
}
function classify(scene: SceneDocument, area: TerrainArea): Surface {
  const role = materialRole(scene, area)
  if ((area.id === 'terrain-shallow' || area.id.startsWith('t9-shallow-')) && area.groundElevationMm === 200 && !area.blocksMovement) return 'shallow'
  if (role === 'water' || role === 'shallow') {
    // Earlier palettes reused a "shallows" picture for the whole sea. New5
    // chooses a saved paint from the actual generated role/elevation instead
    // of turning that old texture name into a claim about water depth/travel.
    const lowestWater = Math.min(...Object.values(scene.terrainAreas).filter(other => other.floorId === area.floorId && ['water', 'shallow'].includes(materialRole(scene, other))).map(other => other.groundElevationMm))
    if (area.id === 'terrain-sea' || area.id === 't9-sea' || area.blocksMovement && area.groundElevationMm === lowestWater) return 'water'
    if (!area.blocksMovement || role === 'shallow') return 'shallow'
    return 'water'
  }
  return role
}
function paint(scene: SceneDocument, key: PaletteKey, opacity = 1): MaterialPaint {
  const material = scene.materials[SHORE_MATERIAL_IDS[key]]
  if (!material) throw new Error(`新岸崖配方缺少固定材质：${key}。`)
  return { materialRef: { id: material.id, version: material.version }, tileSizeMm: cloneJson(material.defaultTileSizeMm),
    alignment: 'world', originMm: { x: 0, y: 0 }, rotationDeg: 0, tint: null, opacity }
}
function geometryEdges(raw: MultiPolygon): number { return raw.reduce((sum, polygon) => sum + polygon.reduce((n, ring) => n + Math.max(0, ring.length - 1), 0), 0) }
function rectangle(left: number, top: number, right: number, bottom: number): RawRing { return [[left, top], [right, top], [right, bottom], [left, bottom]] }
function outputPieces(raw: MultiPolygon, blendWidthMm: number, meter?: ExecutionBudget, depth = 0): OverlayPiece[] {
  if (depth > 16) throw new Error('新岸崖覆盖带洞拆分超过16层保护，不能隐式删洞或简化。')
  const result: OverlayPiece[] = []
  for (const polygon of raw) {
    if (polygon.length !== 1) {
      // Native overlays are simple rings. Split through a hole, preserving
      // both intersections; the overlap is inside the original union and
      // wider than the saved feather, so the split adds no visible end seam.
      const hole = polygon[1], xs = hole.map(p => p[0]), ys = hole.map(p => p[1]), axis = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1
      const values = hole.map(p => p[axis]), span = Math.max(...values) - Math.min(...values), cut = (Math.min(...values) + Math.max(...values)) / 2
      if (!(span > 0)) throw new Error('新岸崖覆盖的洞无法精确拆分。')
      const overlap = Math.min(Math.max(2, blendWidthMm * 3), span / 4), all = polygon.flat(), ax = all.map(p => p[0]), ay = all.map(p => p[1])
      const left = Math.floor(Math.min(...ax)) - 1, right = Math.ceil(Math.max(...ax)) + 1, top = Math.floor(Math.min(...ay)) - 1, bottom = Math.ceil(Math.max(...ay)) + 1
      const clips = axis === 0 ? [rectangle(left, top, cut + overlap, bottom), rectangle(cut - overlap, top, right, bottom)]
        : [rectangle(left, top, right, cut + overlap), rectangle(left, cut - overlap, right, bottom)]
      for (const clip of clips) {
        meter?.charge({ intersectionPairs: geometryEdges([polygon]) * 4 })
        result.push(...outputPieces(polygonClipping.intersection([polygon], [clip]), Math.min(blendWidthMm, Math.floor(overlap / 2)), meter, depth + 1))
      }
      continue
    }
    const points = polygon[0].map(([x, y]) => q({ x, y })).filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y)
    if (points.length > 1 && same(points[0], points.at(-1))) points.pop()
    if (points.length < 3 || Math.abs(signedArea(points)) < 1) continue
    if (points.length > SHORE_SURFACE_LIMITS.pointsPerOverlay) throw new Error('新岸崖覆盖超过每条512点保护。')
    result.push({ points: signedArea(points) < 0 ? points.reverse() : points, blendWidthMm })
  }
  return result
}
function clipToOwner(rings: Ring[], owner: TerrainArea, exclusions: TerrainArea[], blendWidthMm: number, meter?: ExecutionBudget): OverlayPiece[] {
  const inputs = rings.map(ring => ring.filter((point, i) => !i || !same(point, ring[i - 1]))).filter(ring => ring.length >= 3 && Math.abs(signedArea(ring)) >= 1)
  if (!inputs.length) return []
  const count = inputs.reduce((sum, ring) => sum + ring.length, 0)
  if (inputs.length > 1) meter?.charge({ intersectionPairs: count * count })
  let output: MultiPolygon = inputs.length === 1 ? [[rawRing(inputs[0])]] : polygonClipping.union([rawRing(inputs[0])], ...inputs.slice(1).map(ring => [rawRing(ring)]))
  const ownerRing = terrainPoints(owner)
  meter?.charge({ intersectionPairs: geometryEdges(output) * ownerRing.length })
  output = polygonClipping.intersection(output, [rawRing(ownerRing)])
  for (const other of exclusions) {
    const otherRing = terrainPoints(other)
    const count = geometryEdges(output)
    if (!count) break
    meter?.charge({ intersectionPairs: count * otherRing.length })
    output = polygonClipping.difference(output, [rawRing(otherRing)])
  }
  return outputPieces(output, blendWidthMm, meter)
}
function edgeFrame(area: TerrainArea, a: PointMm, b: PointMm) {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(length > 0)) throw new Error('新岸崖配方不能处理零长边。')
  const sign = signedVisualArea(terrainPoints(area)) > 0 ? 1 : -1
  const inward = { x: -(b.y - a.y) / length * sign, y: (b.x - a.x) / length * sign }
  const at = (p: PointMm, distance: number) => q({ x: p.x + inward.x * distance, y: p.y + inward.y * distance })
  return { inward, at, middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
}
/** A chunk owns joined neighboring strips, not independently feathered edge
 * stickers. Partial adjacent edges extend both caps by three feather widths. */
function continuousBand(area: TerrainArea, indices: number[], coastal: Set<number>, near: number, far: number, overlapMm: number): Ring[] {
  const all = edges(area), segments = indices.map(i => all[i]), first = segments[0], last = segments.at(-1)!
  const core = new Set(indices)
  for (const direction of [-1, 1]) {
    let remaining = overlapMm, i = ((direction < 0 ? first.i : last.i) + direction + all.length) % all.length
    while (remaining > 0 && coastal.has(i) && !core.has(i)) {
      const edge = all[i], length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y), used = Math.min(length, remaining), fraction = used / length
      if (direction < 0) segments.unshift({ ...edge, a: q({ x: edge.b.x + (edge.a.x - edge.b.x) * fraction, y: edge.b.y + (edge.a.y - edge.b.y) * fraction }) })
      else segments.push({ ...edge, b: q({ x: edge.a.x + (edge.b.x - edge.a.x) * fraction, y: edge.a.y + (edge.b.y - edge.a.y) * fraction }) })
      remaining -= used; i = (i + direction + all.length) % all.length
    }
  }
  const result: Ring[] = []
  for (const [index, segment] of segments.entries()) {
    const frame = edgeFrame(area, segment.a, segment.b)
    result.push([frame.at(segment.a, near), frame.at(segment.b, near), frame.at(segment.b, far), frame.at(segment.a, far)])
    const next = segments[index + 1]
    if (next && (segment.i + 1) % all.length === next.i && same(segment.b, next.a)) {
      const nextFrame = edgeFrame(area, next.a, next.b)
      result.push([frame.at(segment.b, near), nextFrame.at(next.a, near), nextFrame.at(next.a, far), frame.at(segment.b, far)])
    }
  }
  return result
}
function edgeGroups(indices: number[], count: number): number[][] {
  if (!indices.length) return []
  const selected = new Set(indices), firstGap = Array.from({ length: count }, (_, i) => i).find(i => !selected.has(i))
  const start = firstGap === undefined ? 0 : (firstGap + 1) % count, groups: number[][] = []
  let current: number[] = []
  for (let step = 0; step < count; step++) {
    const i = (start + step) % count
    if (selected.has(i)) current.push(i)
    if ((!selected.has(i) || current.length === 12 || step === count - 1) && current.length) { groups.push(current); current = [] }
  }
  return groups
}
function visibleOutside(scene: SceneDocument, owner: TerrainArea, a: PointMm, b: PointMm): TerrainArea | undefined {
  const { inward, middle } = edgeFrame(owner, a, b), sample = { x: middle.x - inward.x * 12, y: middle.y - inward.y * 12 }
  return Object.values(scene.terrainAreas).filter(area => area.id !== owner.id && area.floorId === owner.floorId && pointInPolygon(sample, terrainPoints(area)))
    .sort((x, y) => y.coveragePriority - x.coveragePriority || (scene.userLayers[scene.entityLayers[y.id]]?.order ?? 0) - (scene.userLayers[scene.entityLayers[x.id]]?.order ?? 0) || y.id.localeCompare(x.id))[0]
}
function straightBoundary(scene: SceneDocument, visual: VisualSystem, area: TerrainArea, selected: number[], seed: string) {
  if (!selected.length) return
  const ring = terrainPoints(area), wanted = new Set(selected), runs: number[][] = []
  if (selected.length === ring.length) runs.push(ring.map((_, i) => i))
  else {
    const first = ring.findIndex((_, i) => !wanted.has(i)), start = (first + 1) % ring.length
    for (let step = 0, run: number[] = []; step < ring.length; step++) {
      const i = (start + step) % ring.length
      if (wanted.has(i)) run.push(i)
      if ((!wanted.has(i) || step === ring.length - 1) && run.length) { runs.push(run); run = [] }
    }
  }
  for (const run of runs) {
    const chunks = Math.ceil(run.length / VISUAL_LIMITS.segmentsPerBoundary), size = Math.ceil(run.length / chunks)
    for (let offset = 0; offset < run.length; offset += size) {
      const indices = run.slice(offset, offset + size), start = indices[0], end = (indices.at(-1)! + 1) % ring.length
      const id = token(seed, 'boundary', area.id, start, end), closed = indices.length === ring.length
      if (visual.boundaries[id]) throw new Error('新岸崖边界身份已存在，不能覆盖已有编辑。')
      const boundary: VisualBoundary = { id, floorId: area.floorId, layerId: scene.entityLayers[area.id], visibility: area.visibility, editLocked: false,
        closed, segments: indices.map(i => ({ id: `${id}-s${i}`, start: cloneJson(ring[i]), control1: cloneJson(ring[i]), control2: cloneJson(ring[(i + 1) % ring.length]), end: cloneJson(ring[(i + 1) % ring.length]) })),
        sampleSpacingMm: 20000, toleranceMm: 1000, binding: { kind: 'terrain', sides: [{ areaId: area.id,
          startPointId: area.boundaryMm[start].id, endPointId: area.boundaryMm[end].id, reverse: false }] } }
      const expected = indices.map(i => ring[i]); if (!closed) expected.push(ring[end])
      if (!same(sampleVisualBoundary(boundary).points, expected)) throw new Error('新岸崖边界采样不能与实际轮廓逐点对应。')
      visual.boundaries[id] = boundary
    }
  }
}
function preserveRepresentation(scene: SceneDocument, boundaryId: string, kind: VisualEdgeLook['kind']): boolean {
  const legacy = scene.visual?.version === 3 ? scene.visual.base : undefined
  return !!legacy && Object.values(legacy.materializedEdges).some(row => row.boundaryId === boundaryId && row.kind === kind)
    || scene.visual?.version === 3 && Object.values(scene.visual.transitions).some(row => row.enabled && row.boundaryId === boundaryId && row.kind === (kind === 'grass' ? 'grassRock' : kind))
}

/** A frozen generation-5 recipe. It saves ordinary paints, overlays and looks;
 * the renderer never regenerates these choices or reinterprets old artwork. */
export function applyShoreSurfaceRecipe(document: SceneDocument, seed: string, options: ShoreSurfaceOptions = {}): SceneDocument {
  if (!seed || seed.length > 128) throw new Error('新岸崖配方需要1–128字符固定种子。')
  const scene = cloneJson(document), visual = visualBase(scene)
  if (!visual) throw new Error('新岸崖配方需要现存严格视觉系统。')
  const areas = Object.values(scene.terrainAreas).sort((a, b) => a.id.localeCompare(b.id))
  if (areas.some(area => area.visibility !== 'public')) throw new Error('新岸崖生成配方不能将私密地形烘入公开覆盖。')
  for (const key of Object.keys(SHORE_MATERIAL_IDS) as PaletteKey[]) paint(scene, key)
  options.meter?.charge({ candidateAttempts: 1, dependencyRefs: areas.length + 7 })
  const kinds = new Map(areas.map(area => [area.id, classify(scene, area)]))
  const water = areas.filter(area => kinds.get(area.id) === 'water' || kinds.get(area.id) === 'shallow')
  const isWater = (area: TerrainArea) => kinds.get(area.id) === 'water' || kinds.get(area.id) === 'shallow'
  const lowerLand = Math.min(...areas.filter(area => !isWater(area)).map(area => area.groundElevationMm))
  const newOverlays = new Map<string, number>()
  const add = (owner: TerrainArea, points: Ring | Ring[], key: PaletteKey, opacity: number, blendWidthMm: number, id: string, exclusions: TerrainArea[] = []) => {
    if (!owner.surfaceStyle || owner.editLocked || scene.userLayers[scene.entityLayers[owner.id]]?.editLocked) return
    const inputs = Array.isArray(points[0]) ? points as Ring[] : [points as Ring]
    for (const [index, piece] of clipToOwner(inputs, owner, exclusions, blendWidthMm, options.meter).entries()) {
      const ring = piece.points
      const overlayId = `${id}-${index}`
      if (owner.surfaceStyle.overlays.some(row => row.id === overlayId)) throw new Error('新岸崖覆盖身份已存在，不能覆盖已有编辑。')
      const count = (newOverlays.get(owner.id) ?? 0) + 1
      if (count > SHORE_SURFACE_LIMITS.overlaysPerArea) throw new Error('新岸崖配方超过每表面128条新增覆盖保护。')
      newOverlays.set(owner.id, count)
      const overlay: SurfaceOverlay = { id: overlayId, boundaryMm: ring, paint: paint(scene, key, opacity), blendWidthMm: piece.blendWidthMm,
        renderOrder: Math.max(-1, ...owner.surfaceStyle.overlays.map(row => row.renderOrder)) + 1 }
      owner.surfaceStyle.overlays.push(overlay)
    }
  }
  for (const area of areas) {
    if (!area.surfaceStyle || area.editLocked || scene.userLayers[scene.entityLayers[area.id]]?.editLocked) continue
    const kind = kinds.get(area.id)!, key = { rock: 'rockDry', grass: 'grass', water: 'waterDeep', shallow: 'waterShallow', sand: 'sandDry' }[kind as Exclude<Surface, 'other'>] as PaletteKey | undefined
    if (key) area.surfaceStyle.base = paint(scene, key)
  }
  for (const area of areas.filter(area => !isWater(area))) {
    if (area.editLocked || scene.userLayers[scene.entityLayers[area.id]]?.editLocked) continue
    const selected: number[] = [], coastalEdges: number[] = [], kind = kinds.get(area.id), ring = terrainPoints(area)
    const extent = { width: Math.max(...ring.map(p => p.x)) - Math.min(...ring.map(p => p.x)), height: Math.max(...ring.map(p => p.y)) - Math.min(...ring.map(p => p.y)) }
    const reef = Math.min(extent.width, extent.height) < 5000
    for (const { a, b, i } of edges(area)) {
      const outside = visibleOutside(scene, area, a, b)
      if (!outside) continue
      options.meter?.charge({ dependencyRefs: 1 })
      if (isWater(outside) || outside.groundElevationMm < area.groundElevationMm) selected.push(i)
      if (isWater(outside)) {
        coastalEdges.push(i)
      } else if (kind === 'grass' && kinds.get(outside.id) === 'rock' && i % 3 === 0) {
        const frame = edgeFrame(area, a, b), width = 210 + (i % 4) * 55
        add(area, [frame.at(a, 0), frame.at(b, 0), frame.at(b, width * .65), frame.at({ x: a.x * .6 + b.x * .4, y: a.y * .6 + b.y * .4 }, width), frame.at(a, width * .5)],
          'rockDry', .36, 130, token(seed, 'grass-rock', area.id, i))
      }
    }
    const coastal = new Set(coastalEdges)
    for (const group of edgeGroups(coastalEdges, ring.length)) {
      const id = token(seed, 'coast-chunk', area.id, group[0], group.at(-1)!)
      const bands = continuousBand(area, group, coastal, -70, -(reef ? 500 : 1400), 600)
      for (const target of water.filter(value => value.floorId === area.floorId)) {
        const excludes = areas.filter(value => value.floorId === area.floorId && !isWater(value) && value.coveragePriority > target.coveragePriority)
        // Opaque immutable world-phase tiles make overlapping chunk caps
        // idempotent in their interiors; only the saved outer feather blends.
        add(target, bands, 'waterShallow', 1, 190, `${id}-${target.id}`, excludes)
      }
      if (kind === 'rock' || kind === 'sand') add(area, continuousBand(area, group, coastal, 0, reef ? 120 : 240, 360),
        kind === 'sand' ? 'sandWet' : 'rockWet', .46, 100, `${id}-wet`)
    }
    const represented = Object.values(visual.boundaries).some(boundary => boundary.binding.kind === 'terrain' && boundary.binding.sides.some(side => side.areaId === area.id))
    if (!represented) straightBoundary(scene, visual, area, selected, seed)
  }
  for (const boundary of Object.values(visual.boundaries).sort((a, b) => a.id.localeCompare(b.id))) {
    if (boundary.binding.kind !== 'terrain' || boundary.editLocked || scene.userLayers[boundary.layerId]?.editLocked) continue
    const side = boundary.binding.sides[0], area = scene.terrainAreas[side.areaId]
    if (!area) continue
    const kind = kinds.get(area.id), ring = terrainPoints(area), inside = signedVisualArea(ring) > 0 !== side.reverse ? 'left' : 'right'
    const outward = inside === 'left' ? 'right' : 'left'
    const neighbors = edges(area).map(({ a, b }) => visibleOutside(scene, area, a, b)).filter((value): value is TerrainArea => !!value)
    const coastal = neighbors.some(isWater), hasDrop = neighbors.some(neighbor => neighbor.groundElevationMm < area.groundElevationMm)
    const desired: VisualEdgeLook['kind'][] = isWater(area) ? ['shore'] : [
      ...(hasDrop && !(kind === 'sand' && coastal) ? ['cliff' as const] : []),
      ...(coastal ? ['shore' as const] : kind === 'grass' ? ['grass' as const] : []),
    ]
    // A fresh sandy coast uses the existing soft shore representation. This
    // recipe never leaves an inherited rocky cliff face beside that choice.
    if (!hasDrop || kind === 'sand' && coastal) for (const look of Object.values(visual.edgeLooks)) if (look.boundaryId === boundary.id && look.kind === 'cliff'
      && !look.editLocked && !scene.userLayers[look.layerId]?.editLocked) look.enabled = false
    if (isWater(area)) for (const look of Object.values(visual.edgeLooks)) if (look.boundaryId === boundary.id && look.kind === 'grass'
      && !look.editLocked && !scene.userLayers[look.layerId]?.editLocked) look.enabled = false
    for (const lookKind of desired) {
      if (preserveRepresentation(scene, boundary.id, lookKind)) continue
      const previous = Object.values(visual.edgeLooks).find(look => look.boundaryId === boundary.id && look.kind === lookKind)
      if (previous?.editLocked || previous && scene.userLayers[previous.layerId]?.editLocked) continue
      const high = area.groundElevationMm > lowerLand, reef = Math.min(Math.max(...ring.map(p => p.x)) - Math.min(...ring.map(p => p.x)), Math.max(...ring.map(p => p.y)) - Math.min(...ring.map(p => p.y))) < 5000
      const id = previous?.id ?? token(seed, lookKind, boundary.id)
      const look: VisualEdgeLook = { id, floorId: boundary.floorId, layerId: boundary.layerId, visibility: boundary.visibility, editLocked: false,
        boundaryId: boundary.id, kind: lookKind, side: lookKind === 'grass' ? inside : isWater(area) ? inside : outward,
        widthMm: lookKind === 'cliff' ? reef ? 360 : high ? 1320 : 680 : lookKind === 'grass' ? 340 : kind === 'sand' ? 850 : 530,
        color: lookKind === 'cliff' ? '#65706F' : lookKind === 'grass' ? '#84A663' : '#87BFC2',
        accentColor: lookKind === 'cliff' ? '#D3C49A' : lookKind === 'grass' ? '#C2D28F' : '#D3E5D7',
        opacity: lookKind === 'cliff' ? .94 : lookKind === 'grass' ? .70 : .50,
        intensity: lookKind === 'shore' ? .22 : .72, repeatMm: lookKind === 'cliff' ? 320 : lookKind === 'grass' ? 270 : 1450,
        seed: token(seed, 'paint', boundary.id, lookKind), enabled: true }
      if (look.widthMm > sampleVisualBoundary(boundary).lengthMm / 2) throw new Error('新岸崖外观宽度超出原生边界长度保护。')
      visual.edgeLooks[id] = look
    }
  }
  let samples = 0, segments = 0, decorations = 0
  for (const boundary of Object.values(visual.boundaries)) { samples += sampleVisualBoundary(boundary).points.length; segments += boundary.segments.length }
  for (const look of Object.values(visual.edgeLooks)) { const length = sampleVisualBoundary(visual.boundaries[look.boundaryId]).lengthMm, count = Math.ceil(length / look.repeatMm); if (count > 1024) throw new Error('新岸崖外观超过单边1024次笔触保护。'); decorations += count }
  if (Object.keys(visual.boundaries).length > VISUAL_LIMITS.boundaries || Object.keys(visual.edgeLooks).length > VISUAL_LIMITS.edgeLooks
    || samples > VISUAL_LIMITS.totalSamples || segments > VISUAL_LIMITS.totalCurveSegments || decorations > 8192) throw new Error('新岸崖配方超过原生视觉记录、曲线或笔触保护。')
  visual.environment = { ambientColor: '#E8EBD9', ambientOpacity: .035, exposure: 1.02, lightDirectionDeg: 135,
    contactShadowMm: 180, contactShadowOpacity: .14 }
  return scene
}
