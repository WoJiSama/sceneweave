import type { SceneDocument } from '../model/scene.js'
import type { SceneCommand } from '../commands/commands.js'
import { visualBase } from './base.js'
import { sampleVisualBoundary, terrainBoundaryChain } from './geometry.js'
import { VISUAL_LIMITS, type VisualBoundary, type VisualEdgeLook } from './types.js'

export type TerrainCliffProfile = NonNullable<VisualEdgeLook['renderProfile']>
/** Existing, explicitly saved algorithms. Names describe current behaviour;
 * this catalogue is not a claim that reference-island visual QA has passed. */
export const TERRAIN_CLIFF_STYLES = [
  { value: 'rockRelief2', label: '层岩 · 分段色面' },
  { value: 'rockRelief3', label: '疏层岩纹 · 低对比岩片' },
  { value: 'rockRelief4', label: '受光岩面 · 深浅层次' },
  { value: 'rockRelief5', label: '连续崖面 · 近侧深远侧浅' },
  { value: 'rockRelief6', label: '高差岩坡 · 多层崖面衔接' },
  { value: 'rockRelief7', label: '自然断岩 · 不规则折面' },
  { value: 'rockRelief8', label: '错落层岩 · 岩台与短立面' },
  { value: 'rockRelief9', label: '断层岩体 · 台地与陡壁' },
  { value: 'rockRelief10', label: '层状断岩 · 岩床与石缝' },
  { value: 'rockRelief11', label: '风化断岩 · 错落岩壁与坡脚' },
  { value: 'rockRelief12', label: '断续露岩 · 岩层与草坡相接' },
] as const satisfies readonly { value: TerrainCliffProfile; label: string }[]

export function terrainCliffBindings(scene: SceneDocument, areaId: string) {
  const visual = visualBase(scene)
  return Object.values(visual?.boundaries ?? {}).filter(boundary => boundary.binding.kind === 'terrain'
    && boundary.binding.sides.some(side => side.areaId === areaId))
    .map(boundary => ({ boundary, looks: Object.values(visual?.edgeLooks ?? {}).filter(look => look.boundaryId === boundary.id && look.kind === 'cliff') }))
}

export interface TerrainCliffStyleRequest {
  areaId: string
  profile: TerrainCliffProfile
  /** Absent covers all of this area's bound edges and creates missing ones.
   * A specific boundary only updates/creates its look, keeping its full scope. */
  boundaryId?: string
}

/** Creates an ordinary command proposal, never edits the supplied document.
 * Missing bindings follow exact existing vertices: no smoothing, resampling,
 * source identity replacement, implicit support rebinding or new format.
 * Full domain/dependency/lock/resource validation still belongs to adoption. */
export function terrainCliffStyleCommands(scene: SceneDocument, request: TerrainCliffStyleRequest, nextId: () => string): SceneCommand[] {
  const area = Object.hasOwn(scene.terrainAreas, request.areaId) ? scene.terrainAreas[request.areaId] : undefined
  if (scene.mapMode !== 'scene' || !area) throw new Error('请选择当前场景中的完整地形。')
  if (!TERRAIN_CLIFF_STYLES.some(style => style.value === request.profile)) throw new Error('不支持此崖壁画法。')
  const layer = scene.userLayers[scene.entityLayers[area.id]], visual = visualBase(scene)
  if (!visual || !layer || layer.floorId !== area.floorId) throw new Error('当前地形缺少有效视觉系统或所属图层。')
  if (area.editLocked || layer.editLocked) throw new Error('地形或所属图层已锁定。')
  const bindings = terrainCliffBindings(scene, area.id)
  if (request.boundaryId && !bindings.some(item => item.boundary.id === request.boundaryId)) throw new Error('所选崖壁范围已失效，请重新选择。')
  const commands: SceneCommand[] = []
  const used = new Set<string>()
  // Identity collisions are finally checked by ordinary command validation.
  const fresh = () => {
    const id = nextId()
    if (!id || id === '__proto__' || used.has(id)) throw new Error('崖壁候选需要独立的新身份。')
    used.add(id); return id
  }
  const targets = request.boundaryId ? bindings.filter(item => item.boundary.id === request.boundaryId) : bindings
  for (const { boundary, looks } of targets) {
    if (boundary.editLocked || scene.userLayers[boundary.layerId]?.editLocked) throw new Error('崖壁绑定曲线或所属图层已锁定。')
    for (const look of looks) {
      if (look.editLocked || scene.userLayers[look.layerId]?.editLocked) throw new Error('崖壁外观或所属图层已锁定。')
      if (look.renderProfile !== request.profile) commands.push({ type: 'upsertVisualEdgeLook', edgeLook: { ...look, renderProfile: request.profile } })
    }
    if (!looks.length) addLook(boundary)
  }
  function addLook(boundary: VisualBoundary) {
    const length = sampleVisualBoundary(boundary).lengthMm
    const widthMm = Math.min(1200, Math.floor(length / 2))
    if (widthMm < 1) throw new Error('当前边段过短，无法生成崖壁。')
    const id = fresh()
    commands.push({ type: 'upsertVisualEdgeLook', edgeLook: { id, floorId: boundary.floorId, layerId: boundary.layerId,
      visibility: boundary.visibility, editLocked: false, boundaryId: boundary.id, kind: 'cliff', side: 'both', widthMm,
      color: '#718098', accentColor: '#D4C19D', opacity: 1, intensity: .8, seed: id, repeatMm: Math.max(350, Math.ceil(length / 512)),
      enabled: true, renderProfile: request.profile } })
  }
  if (!request.boundaryId) {
    const ring = area.boundaryMm, owned = new Set<string>()
    for (const { boundary } of bindings) if (boundary.binding.kind === 'terrain') for (const side of boundary.binding.sides.filter(side => side.areaId === area.id)) {
      const chain = terrainBoundaryChain(area, side, boundary.closed)
      for (const p of chain.slice(0, boundary.closed ? undefined : -1)) owned.add(p.segmentId)
    }
    // Begin after an owned edge, so a free chain that wraps row zero is still
    // treated as one explicit chain. Existing bound geometry is never upserted.
    const pivot = ring.findIndex(point => owned.has(point.segmentId)), free: number[][] = []
    let active: number[] = []
    for (let step = 0; step < ring.length; step++) {
      const i = (pivot + 1 + step) % ring.length
      if (owned.has(ring[i].segmentId)) { if (active.length) free.push(active); active = [] }
      else active.push(i)
    }
    if (active.length) free.push(active)
    for (const chain of free) for (let start = 0; start < chain.length; start += VISUAL_LIMITS.segmentsPerBoundary) {
      const indices = chain.slice(start, start + VISUAL_LIMITS.segmentsPerBoundary), closed = indices.length === ring.length
      const first = ring[indices[0]], last = ring[(indices.at(-1)! + 1) % ring.length]
      const side = { areaId: area.id, startPointId: first.id, endPointId: last.id, reverse: false }
      const boundary: VisualBoundary = { id: fresh(), floorId: area.floorId, layerId: layer.id, visibility: area.visibility, editLocked: false,
        closed, sampleSpacingMm: 20_000, toleranceMm: 1,
        binding: { kind: 'terrain', sides: [side] },
        segments: indices.map(i => {
          const a = ring[i].positionMm, b = ring[(i + 1) % ring.length].positionMm
          if (Math.hypot(a.x - b.x, a.y - b.y) > 20_000) throw new Error('当前轮廓含超过20米的未绑定边段，需先明确细分；样式不会自动改变轮廓。')
          return { id: fresh(), start: { ...a }, control1: { ...a }, control2: { ...b }, end: { ...b } }
        }) }
      const sampled = sampleVisualBoundary(boundary).points
      const expected = terrainBoundaryChain(area, side, boundary.closed)
      if (sampled.length !== expected.length || sampled.some((p, i) => p.x !== expected[i].positionMm.x || p.y !== expected[i].positionMm.y)) throw new Error('无法在保持原轮廓的条件下生成崖壁绑定。')
      commands.push({ type: 'upsertVisualBoundary', boundary }); addLook(boundary)
    }
  }
  if (commands.length > 256) throw new Error('崖壁候选超过单笔256条命令预算，请明确较小的边段范围。')
  return commands
}
