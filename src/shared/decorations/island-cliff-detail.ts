import type { MaterializedEdge } from '../terrain-generation/contracts.js'
import { materializedEdgeSchema } from '../terrain-generation/contracts.js'
import { materializedBoundaryHash } from '../terrain-generation/integrity.js'
import type { PointMm } from '../model/scene.js'
import type { VisualBoundary, VisualEdgeLook } from '../visual/types.js'
import type { SceneCommand } from '../commands/commands.js'
import type { SceneDocument } from '../model/scene.js'
import { assertSimpleVisualPolyline, sampleVisualBoundary, visualSampleAtDistance } from '../visual/geometry.js'
import { canonicalJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'
import { visualBase } from '../visual/base.js'
import { getLegacyVisual } from '../terrain-generation/composition-contracts.js'
import { geometryIdentityIds } from '../commands/domain.js'
import { createPublicVisibility } from '../geometry/visibility.js'

const unit = (seed: string, index: number, channel: number) => Number.parseInt(sha256Text(canonicalJson([seed, index, channel])).slice(0, 13), 16) / 0x10000000000000
const integerPoint = (value: PointMm): PointMm => ({ x: Math.round(value.x), y: Math.round(value.y) })

function midToneCliffFill(color: string, opacity: number): string {
  const source = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
  const limestone = [0xC8, 0xBE, 0xA8], luminance = (rgb: number[]) => rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722
  const current = luminance(source), target = luminance(limestone)
  if (current >= 150 || target <= current) return color
  const amount = Math.min(.6, (150 - current) / (target - current) + Math.max(0, opacity - .7) * .08)
  const lifted = source.map((channel, index) => Math.round(channel + (limestone[index]! - channel) * amount))
  return `#${lifted.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function hasIslandCliffDetail(scene: SceneDocument): boolean {
  const visible = createPublicVisibility(scene)
  const crown = Object.values(scene.terrainAreas).filter(area => visible.terrainArea(area.id))
    .sort((a, b) => b.groundElevationMm - a.groundElevationMm || a.id.localeCompare(b.id))[0]
  const visual = visualBase(scene), legacy = getLegacyVisual(scene)
  return !!crown && !!visual && !!legacy && Object.values(legacy.materializedEdges).some(edge => {
    const boundary = visual.boundaries[edge.boundaryId]
    return edge.kind === 'cliff' && edge.visibility === 'public' && boundary?.binding.kind === 'terrain'
      && boundary.binding.sides.some(side => side.areaId === crown.id)
  })
}

/** Saved island-only relief: one joined face, broken strata, and finite erosion cuts. */
export function createIslandCliffDetailEdge(boundary: VisualBoundary, look: VisualEdgeLook, id: string): MaterializedEdge {
  if (look.kind !== 'cliff' || look.boundaryId !== boundary.id || look.floorId !== boundary.floorId) {
    throw new Error('岩岛崖面细节须使用同Floor崖边及其原曲线。')
  }
  if (!look.enabled || look.editLocked || !Number.isSafeInteger(look.widthMm) || look.widthMm <= 0 || look.side === 'both') throw new Error('岩岛崖面细节需要可写、已启用的单侧崖边。')
  if (look.visibility !== 'public' || boundary.visibility !== 'public') throw new Error('岩岛公开崖面细节不得使用私密来源。')
  const sampled = sampleVisualBoundary(boundary)
  if (!(sampled.lengthMm > 0)) throw new Error('岩岛崖面细节需要非零长度的崖线。')
  const sign = look.side === 'left' ? 1 : -1
  const phase = unit(look.seed, 0, 101) * Math.PI * 2
  const offset = (sample: ReturnType<typeof visualSampleAtDistance>, fraction: number): PointMm => integerPoint({
    x: sample.positionMm.x + sample.normal.x * sign * look.widthMm * fraction,
    y: sample.positionMm.y + sample.normal.y * sign * look.widthMm * fraction,
  })
  const sourceSamples = sampled.closed ? sampled.samples.slice(0, -1) : sampled.samples
  const faceSamples = sourceSamples.length <= 256 ? sourceSamples
    : Array.from({ length: 256 }, (_, index) => visualSampleAtDistance(sampled, sampled.lengthMm * index / (sampled.closed ? 256 : 255)))
  const face = [...faceSamples.map(sample => integerPoint(sample.positionMm)), ...faceSamples.map(sample => offset(sample, 1)).reverse()]
  assertSimpleVisualPolyline(face, true)

  const edgeId = id, strokes: MaterializedEdge['strokes'] = []
  const addStroke = (key: string, pointsMm: PointMm[], widthMm: number, color: string, opacity: number) => {
    const compact = pointsMm.filter((point, index) => index === 0 || point.x !== pointsMm[index - 1]!.x || point.y !== pointsMm[index - 1]!.y)
    if (compact.length < 2) return
    strokes.push({ id: `${edgeId}:${key}`, pointsMm: compact, widthMm: Math.max(1, Math.round(widthMm)), color, opacity })
  }
  // Eight broken shelves cover the complete arc. Their alternating light/dark
  // bands retain the saved face width, rather than replacing its silhouette.
  const shelfCount = 8, sectorMm = sampled.lengthMm / shelfCount, spanMm = sectorMm * .86
  for (let row = 0; row < shelfCount; row++) {
    const light = row % 2 !== 0, fraction = light ? .62 : .29
    const start = sectorMm * (row + .07)
    const pointCount = row % 2 === 0 ? 2 : 3
    const points = Array.from({ length: pointCount }, (_, index) => {
      const distance = start + spanMm * index / (pointCount - 1)
      const sample = visualSampleAtDistance(sampled, distance)
      const cell = Math.floor(distance / Math.max(1, look.repeatMm))
      const brokenFraction = fraction + Math.sin(distance / Math.max(240, look.repeatMm) * Math.PI * 2 + phase + row) * .018
        + (unit(look.seed, cell, 110 + row) - .5) * .018
      return offset(sample, Math.max(.08, Math.min(.94, brokenFraction)))
    })
    addStroke(`stratum-${row}`, points, Math.max(24, look.widthMm * (light ? .09 : .13)), light ? look.accentColor : '#34443B', light ? .54 : .48)
  }
  const driftMm = Math.min(120, Math.max(12, Math.round(look.widthMm * .06)))
  for (let index = 0; index < 2; index++) {
    const drift = Math.min(driftMm, sampled.lengthMm * .2)
    const margin = sampled.closed ? 0 : drift
    const center = margin + unit(look.seed, index, 103) * Math.max(0, sampled.lengthMm - margin * 2)
    const start = .2 + unit(look.seed, index, 104) * .42
    const reach = .18 + unit(look.seed, index, 105) * .16
    const crack = [
      offset(visualSampleAtDistance(sampled, center - drift), start),
      offset(visualSampleAtDistance(sampled, center), start + reach),
      offset(visualSampleAtDistance(sampled, center + drift), start + reach * .55),
    ]
    addStroke(`fracture-${index}`, crack, Math.max(28, look.widthMm * .035), '#34443B', .72)
  }

  const edge = { id: edgeId, floorId: boundary.floorId, layerId: look.layerId, visibility: 'public' as const, editLocked: false,
    boundaryId: boundary.id, inputHash: materializedBoundaryHash(boundary), kind: 'cliff' as const, polygons: [face], strokes, materialRef: null,
    fillColor: midToneCliffFill(look.color, look.opacity), opacity: look.opacity }
  return materializedEdgeSchema.parse(edge)
}

/** One explicit, bounded candidate for the highest public island crown. */
export function buildIslandCliffDetailCommands(scene: SceneDocument, options: { nextId: () => string }): { commands: SceneCommand[]; report: string } {
  if (scene.visual?.version !== 3) throw new Error('岩岛崖面细化需要完整视觉场景。')
  const visual = visualBase(scene), legacy = getLegacyVisual(scene), crown = Object.values(scene.terrainAreas)
    .filter(area => area.floorId === Object.values(scene.floors)[0]?.id).sort((a, b) => b.groundElevationMm - a.groundElevationMm)[0]
  if (!visual || !legacy || !crown) throw new Error('岩岛缺少完整视觉系统或高台支撑。')
  if (!createPublicVisibility(scene).terrainArea(crown.id)) throw new Error('最高高台对玩家不可见，不能创建公开崖面细节。')
  if (crown.editLocked || scene.userLayers[scene.entityLayers[crown.id]]?.editLocked) throw new Error('高台支撑或图层已锁定。')
  const reserved = geometryIdentityIds(scene)
  for (const id of Object.keys(scene.userLayers)) reserved.add(id)
  const byBoundary = new Map<string, VisualEdgeLook[]>()
  for (const look of Object.values(visual.edgeLooks).filter(value => value.kind === 'cliff' && value.enabled && value.visibility === 'public')) {
    const boundary = visual.boundaries[look.boundaryId]
    if (boundary?.visibility !== 'public' || boundary.binding.kind !== 'terrain' || !boundary.binding.sides.some(side => side.areaId === crown.id)) continue
    const values = byBoundary.get(boundary.id) ?? []
    values.push(look); byBoundary.set(boundary.id, values)
  }
  if (!byBoundary.size) {
    if (Object.values(legacy.materializedEdges).some(edge => edge.kind === 'cliff' && edge.visibility === 'public')) throw new Error('公开崖面已物化；不能重复追加细节。')
    throw new Error('高台没有可用的公开崖面边带。')
  }
  const commands: SceneCommand[] = []
  for (const [boundaryId, looks] of [...byBoundary.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.values(legacy.materializedEdges).some(edge => edge.boundaryId === boundaryId && edge.kind === 'cliff')) throw new Error('高台崖面已有物化记录；请编辑或明确移除后重建。')
    const boundary = visual.boundaries[boundaryId], look = [...looks].sort((a, b) => a.id.localeCompare(b.id))[0]!
    if (boundary.editLocked || scene.userLayers[boundary.layerId]?.editLocked) throw new Error('高台崖面曲线或图层已锁定。')
    if (looks.some(item => item.editLocked || scene.userLayers[item.layerId]?.editLocked)) throw new Error('高台崖面外观或图层已锁定。')
    if (looks.some(item => item.side === 'both') && !looks.some(item => item.side !== 'both')) throw new Error('高台崖面需有明确的单侧外观才能安全物化。')
    const source = looks.find(item => item.side !== 'both') ?? look
    const id = options.nextId()
    if (!id || id.length > 256 || reserved.has(id) || id === '__proto__') throw new Error('崖面细节须使用全新几何身份。')
    reserved.add(id)
    const edge = createIslandCliffDetailEdge(boundary, source, id)
    if (edge.strokes.some(stroke => reserved.has(stroke.id))) throw new Error('崖面笔触ID与工程已有身份冲突。')
    for (const stroke of edge.strokes) reserved.add(stroke.id)
    for (const item of looks) commands.push({ type: 'upsertVisualEdgeLook', edgeLook: { ...item, enabled: false } })
    commands.push({ type: 'upsertMaterializedEdge', edge })
  }
  return { commands, report: `高台${byBoundary.size}条公开崖线改为贴合原曲线的全周明暗层纹与局部裂隙；同一事务关闭原崖带，完整检查来源、锁、ID及256项预算。` }
}
