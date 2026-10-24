import type { ProjectData } from '../model/project.js'
import type { Prop, BoundsMm, PointMm, SceneDocument, SurfaceRef } from '../model/scene.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { propFootprint, polygonsOverlap, pointInPolygon } from '../geometry/geometry.js'
import { normalizeStaticSvg } from './svg.js'
import type { AuthoringStart, AuthoringScope, ArtworkOperation } from './authoring-protocol.js'

export const ARTWORK_SKILL = Object.freeze({ id: 'sceneweave-artwork-authoring' as const, version: 1 as const,
  instructions: 'Create or revise static SVG and harmonize only frozen public target props, explicitly selected prefab members, or an explicitly bounded range. '
    + 'Use svg operations with a finite static SVG subset (svg/g/path/rect/circle/ellipse/line/polyline/polygon, solid fill/stroke); no scripts, URLs, images, text, filters, animation or CSS. '
    + 'Use style operations for tint, brightness and opacity. Preserve the physical size, footprint, support, passage, locks, secrets, and manual member records. '
    + 'SVG and style are deferred artwork recipes: the browser independently generates and verifies actual PNG pixels, immutable source versions and licences. '
    + 'Read targets first, work in small atomic steps, check the draft, and explain the change for human review. Never claim the main project changed before local adoption.' })
function deny(message: string): never { throw new Error(`AI素材范围无效：${message}`) }
const within = (b: BoundsMm, points: PointMm[]) => points.every(p => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)
export function artworkVisualPoints(prop: Prop): PointMm[] {
  const b = prop.visualBoundsMm, a = prop.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]]
    .map(([x, y]) => ({ x: prop.positionMm.x + x * c - y * s, y: prop.positionMm.y + x * s + y * c }))
}
function publicSupport(scene: SceneDocument, ref: SurfaceRef, read: Set<string>): void {
  if (!createPublicVisibility(scene).surface(ref) || effectiveEditLocked(scene, ref.id)) deny('支撑或图层不公开/已锁定。')
  read.add(ref.id)
  if (ref.kind === 'room') {
    const room = scene.rooms[ref.id]
    publicSupport(scene, room.supportRef, read)
    for (const wall of Object.values(scene.walls)) if (room.boundaryVertexIds.includes(wall.startVertexId) && room.boundaryVertexIds.includes(wall.endVertexId)) {
      for (const id of [wall.id, wall.startVertexId, wall.endVertexId, ...Object.values(scene.openings).filter(o => o.wallId === wall.id).map(o => o.id)]) {
        if (effectiveEditLocked(scene, id)) deny('支撑建筑的真实依赖已锁定。')
        read.add(id)
      }
    }
  }
}
export function assertArtworkProp(project: ProjectData, id: string, bounds?: BoundsMm): Set<string> {
  const scene = project.document, prop = Object.hasOwn(scene.props, id) && scene.props[id], read = new Set<string>()
  if (!prop || !createPublicVisibility(scene).prop(prop) || effectiveEditLocked(scene, id)) deny('只接受公开且未锁定的物件。')
  publicSupport(scene, prop.supportRef, read)
  if (prop.roomId) publicSupport(scene, { kind: 'room', id: prop.roomId }, read)
  const points = artworkVisualPoints(prop), footprint = propFootprint(prop)
  if (bounds && (!within(bounds, points) || !within(bounds, footprint))) deny('实际图像或占地超出明确范围。')
  for (const mask of Object.values(scene.regions).filter(v => v.kind === 'manualMask')) for (const shape of [points, footprint]) {
    if (polygonsOverlap(shape, mask.boundaryMm) || shape.some(p => pointInPolygon(p, mask.boundaryMm)) || mask.boundaryMm.some(p => pointInPolygon(p, shape))) deny('素材范围不能包含玩家遮罩。')
  }
  read.add(id); read.add(scene.entityLayers[id]); read.add(prop.floorId)
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) if (Object.values(group.members).some(m => m.propId === id)) {
    if (effectiveEditLocked(scene, group.id)) deny('组合或散布已锁定。')
    read.add(group.id)
  }
  let sourceId: string | null = project.appearance.propSources[id]
  while (sourceId) {
    read.add(sourceId)
    const source: import('../model/appearance.js').AppearanceSource | undefined = project.appearance.sources[sourceId]
    if (!source || source.kind !== 'prop') deny('固定来源链缺失。')
    const definition = source.snapshot.definitionRef && scene.propDefinitions[source.snapshot.definitionRef.id]
    if (definition) { if (!definition.origin.canEmbed) deny('原件不可嵌入。'); read.add(definition.id) }
    if (source.snapshot.appearance.kind === 'image') {
      const asset = scene.assets[source.snapshot.appearance.assetId]
      if (!asset?.origin.canEmbed) deny('原件图片不可嵌入。')
      read.add(asset.id); read.add(asset.sha256)
      const svg = project.authoringSources[asset.id]
      if (svg) { read.add(svg.sourceSha256); read.add(svg.normalizedSha256) }
    }
    sourceId = source.parentSourceId
  }
  for (const binding of project.licenseBindings) if (read.has(binding.subjectId)) { read.add(binding.licenseRef); read.add(binding.licensePath) }
  return read
}
/** Frozen explicit expansion; no geometric search is performed by a model tool. */
export function artworkTargetIds(project: ProjectData, scope: AuthoringScope): string[] {
  const artwork = scope.artwork
  if (!artwork) return []
  const targets = new Set<string>()
  if (artwork.mode === 'single' && artwork.targetIds.length > 1) deny('单件模式最多一件物件。')
  if (artwork.mode === 'prefab') {
    if (artwork.targetIds.length !== 1) deny('组合模式须明确选择一个组合。')
    const group = project.document.prefabInstances[artwork.targetIds[0]]
    if (!group || group.visibility !== 'public' || effectiveEditLocked(project.document, group.id)) deny('组合不存在、私密或锁定。')
    Object.values(group.members).forEach(member => { if (member.propId !== null) targets.add(member.propId) })
  } else artwork.targetIds.forEach(id => targets.add(id))
  if (!targets.size && !artwork.includeNewProps) deny('须明确选择外观目标。')
  if (artwork.mode === 'range' && !artwork.boundsMm) deny('局部范围须明确边界。')
  if (artwork.includeNewProps && !scope.placement && !scope.scene) deny('本任务新物件须先授权放置或场景范围。')
  targets.forEach(id => assertArtworkProp(project, id, artwork.boundsMm))
  return [...targets].sort()
}
export function checkArtworkOperation(project: ProjectData, start: AuthoringStart, operation: ArtworkOperation, createdIds: ReadonlySet<string>, svgTargets: ReadonlySet<string> = new Set()) {
  const grant = start.scope.artwork
  if (!grant?.operations.includes(operation.kind)) deny('此素材操作未授权。')
  const allowed = new Set(artworkTargetIds(start.project, start.scope)), ids = operation.kind === 'svg' ? [operation.id] : operation.ids
  const read = new Set<string>(), write = new Set<string>()
  for (const id of ids) {
    if (!allowed.has(id) && !(grant.includeNewProps && createdIds.has(id))) deny('目标不在冻结外观范围。')
    for (const dependency of assertArtworkProp(project, id, grant.boundsMm)) read.add(dependency)
    write.add(id)
    for (const group of [...Object.values(project.document.prefabInstances), ...Object.values(project.document.scatterGroups)]) if (Object.values(group.members).some(m => m.propId === id)) write.add(group.id)
    if (operation.kind === 'style' && (operation.tint !== undefined || operation.brightness !== undefined)) {
      const source = project.appearance.sources[project.appearance.propSources[id]]
      if (!svgTargets.has(id) && (source?.kind !== 'prop' || source.snapshot.appearance.kind !== 'image')) deny('调色/亮度须使用实际图片素材；符号可先制作SVG。')
    }
  }
  if (operation.kind === 'svg') normalizeStaticSvg(operation.sourceSvg)
  // This fixed upper bound reserves every source/asset/definition/binding and
  // adjustment row before platform materialization. Repetition consumes it too.
  const cost = operation.kind === 'svg' ? 9 : ids.length * ((operation.tint !== undefined ? 1 : 0) + (operation.brightness !== undefined ? 1 : 0) + (operation.opacity !== undefined ? 1 : 0) + (operation.tint !== undefined || operation.brightness !== undefined ? 3 : 0))
  return { readIds: [...read], writeIds: [...write], cost }
}
