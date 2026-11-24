import { connectionArcFrame } from '../geometry/connection-route.js'
import { ROUTE_FRACTION } from '../geometry/route-width.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { Path, PointMm, SceneDocument } from '../model/scene.js'
import { visualBase } from '../visual/base.js'
import { PATH_ENDS, type BridgeRoadLink, type PathEnd } from './bridge-link-contracts.js'
import { facesRoad, hasContinuousBridgeApproach, pathEndPosition, samePoint, withBridgeApproach } from './bridge-link-geometry.js'
import type { PathAssemblyCommand } from './contracts.js'
import { cloneJson } from '../validation/json.js'

export function bridgeConversionReason(scene: SceneDocument, road: Path): string | undefined {
  if (road.roadSurface) return '已塑形的道路含路肩与地面接合。跨越水面请单独绘制桥梁。'
  if (road.assembly || road.widthSections || road.staircase) return '请选择等宽且尚未布置阶梯和沿线构件的道路。'
  const id = road.id
  if (road.visibility === 'public' && !createPublicVisibility(scene).path(id)) return '道路使用了主持人支撑面。请先把道路设为仅主持人可见。'
  if (Object.values(scene.pathAttachments ?? {}).some(relation => relation.pathId === id)
      || Object.values(scene.paths).some(path => PATH_ENDS.some(end => path.assembly?.bridge?.roadLinks?.[end]?.pathId === id))
      || Object.values(scene.scatterGroups).some(group => group.domain.kind === 'path' && group.domain.pathId === id)
      || Object.values(visualBase(scene)?.boundaries ?? {}).some(row => row.binding.kind === 'path' && row.binding.pathId === id)
      || Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === id)
      || scene.constraints.pathChecks.some(check => [check.from, check.to].some(anchor => anchor.type === 'entity' && anchor.entityId === id))) {
    return '这条道路仍有链接、布置或注记依赖。请先处理依赖，再选择要转为桥的路段。'
  }
}

export function splitRoadForBridge(scene: SceneDocument, road: Path, command: PathAssemblyCommand) {
  const reason = bridgeConversionReason(scene, road)
  if (reason) throw new Error(reason)
  if (!command.bridge || !command.roadRange || command.bridge.visibility !== road.visibility) throw new Error('转为桥梁须保留原道路的受众。')
  if (command.centerlineMm.length !== road.centerlineMm.length || command.centerlineMm.some((point, index) => !samePoint(point, road.centerlineMm[index]))) {
    throw new Error('道路路线已变化，请在当前路线重新选择桥段。')
  }
  const frame = connectionArcFrame(road.centerlineMm)
  const rounded = ({ x, y }: PointMm) => ({ x: Math.round(x) || 0, y: Math.round(y) || 0 })
  const slice = (start: number, end: number) => [rounded(frame.at(start)), ...road.centerlineMm.filter((_, index) => frame.distances[index] > start && frame.distances[index] < end), rounded(frame.at(end))]
  const from = command.roadRange.startPpm / ROUTE_FRACTION * frame.length, to = command.roadRange.endPpm / ROUTE_FRACTION * frame.length
  return { bridge: slice(from, to), before: from ? slice(0, from) : undefined, after: to < frame.length ? slice(to, frame.length) : undefined }
}

export function placeBridgeApproaches(scene: SceneDocument, bridge: Path, source: Path, split: ReturnType<typeof splitRoadForBridge>, allocate: () => string) {
  const structure = bridge.assembly!.bridge!, links: Partial<Record<PathEnd, BridgeRoadLink>> = {}
  for (const bridgeEnd of PATH_ENDS) {
    const centerlineMm = bridgeEnd === 'start' ? split.before : split.after
    if (!centerlineMm) continue
    const id = allocate(), end = bridgeEnd === 'start' ? 'end' : 'start'
    const surfaceStyle = cloneJson(source.surfaceStyle)
    for (const overlay of surfaceStyle?.overlays ?? []) overlay.id = allocate()
    const approach = withBridgeApproach(bridge, bridgeEnd, { ...source, id, centerlineMm, surfaceStyle }, end, false)
    const point = pathEndPosition(approach, end)
    if (approach.centerlineMm.length > 256 || !facesRoad(bridge, bridgeEnd, approach, end, point, true) || !hasContinuousBridgeApproach(scene, bridge, bridgeEnd, approach, end)) {
      throw new Error('此处引道太短、转向过急或桥头到路端缺少连续同高承托。请选择留有同高接入空间的路段。')
    }
    scene.paths[id] = approach
    scene.entityLayers[id] = scene.entityLayers[bridge.id]
    links[bridgeEnd] = { pathId: id, end, restMm: point }
  }
  if (Object.keys(links).length) structure.roadLinks = links
}
