import { bridgeArtName } from '../../shared/path-assembly/profiles'
import type { SceneDocument } from '../../shared/model/scene'
import { isCanvasGround } from '../../shared/model/canvas-ground'
import { visualBase } from '../../shared/visual/base'
import { LIGHT_LABELS } from '../../shared/visual/light-geometry'
import type { EditableProject } from '../../application/workspace/project'

export const propName = (project: EditableProject, id: string) => {
  const prop = project.document.props[id]
  return prop.definitionRef ? project.document.propDefinitions[prop.definitionRef.id].name : `符号物件 · ${id}`
}
export const groupName = (project: EditableProject, id: string) => project.document.prefabDefinitions[project.document.prefabInstances[id].definitionRef.id].name

const meters = (value: number) => `${Number((value / 1000).toFixed(3))} m`
const text = (value: string | undefined) => value?.trim().replace(/\s+/g, ' ') ?? ''

/** Readable UI names only. IDs and all relationships remain unchanged. */
export function createEntityLabeler(scene: SceneDocument, terrainElevation = meters): (id: string) => string {
  const labels = new Map<string, string>()
  const name = (id: string) => labels.get(id) ?? id
  const numbered = <T extends { id: string }>(items: Record<string, T> | undefined, kind: string, describe?: (item: T) => string) => {
    Object.values(items ?? {}).forEach((item, index) => labels.set(item.id, text(describe?.(item)) || `${kind} ${index + 1}`))
  }
  numbered(scene.floors, '基础地面', item => item.name)
  numbered(scene.userLayers, '图层', item => item.name)
  numbered(scene.propDefinitions, '物件素材', item => item.name)
  numbered(scene.materials, '材质', item => item.name)
  numbered(scene.prefabDefinitions, '组合素材', item => item.name)
  numbered(scene.rooms, '房间', item => item.purpose)
  numbered(scene.props, '物件', item => item.definitionRef ? name(item.definitionRef.id) : item.appearance.kind === 'symbol' ? item.appearance.bridgeArt ? bridgeArtName(item.appearance.bridgeArt)
    : ({ table: '桌子', chair: '椅子', shelf: '架子', rug: '地毯', crate: '木箱' })[item.appearance.symbol] : '')
  numbered(scene.prefabInstances, '组合', item => name(item.definitionRef.id))
  const visual = visualBase(scene)
  const shores = new Set<string>(), cliffs = new Set<string>(), cliffAreas = new Set<string>(), reefAreas = new Set<string>()
  const connectedTerrain = new Set(Object.values(scene.terrainConnections).flatMap(({ from, to }) =>
    [from.surfaceRef, to.surfaceRef].filter(ref => ref.kind === 'terrainArea').map(ref => ref.id)))
  for (const look of Object.values(visual?.edgeLooks ?? {})) {
    if (look.kind === 'shore') shores.add(look.boundaryId)
    if (look.kind === 'cliff') cliffs.add(look.boundaryId)
  }
  for (const boundary of Object.values(visual?.boundaries ?? {})) {
    if (boundary.binding.kind !== 'terrain' || !cliffs.has(boundary.id)) continue
    for (const side of boundary.binding.sides) {
      cliffAreas.add(side.areaId)
      const area = scene.terrainAreas[side.areaId]
      if (boundary.closed && shores.has(boundary.id) && area?.relief && !area.waterSurface && !connectedTerrain.has(side.areaId)) reefAreas.add(side.areaId)
    }
  }
  numbered(scene.terrainAreas, '地形', item => {
    const material = item.surfaceStyle ? name(item.surfaceStyle.base.materialRef.id) : '未铺装地形'
    const elevation = terrainElevation(item.groundElevationMm)
    if (isCanvasGround(item)) return `基础地面 · 高程 ${elevation}`
    const landform = reefAreas.has(item.id) ? '礁石' : cliffAreas.has(item.id) ? '崖壁地形' : ''
    return landform ? `${landform} · ${elevation} · ${material}` : `${material} · 高程 ${elevation}`
  })
  numbered(scene.paths, '道路', item => `${item.surfaceStyle ? name(item.surfaceStyle.base.materialRef.id) : ''}${item.assembly?.bridge ? '桥梁' : '道路'} · 净宽 ${meters(item.widthMm)}`)
  numbered(scene.regions, '区域', item => item.kind === 'partition' ? item.name ?? '编辑分区' : ({ hazard: '危险区域', terrain: '用途区域', manualMask: '玩家遮罩' })[item.kind])
  numbered(scene.notes, '注记', item => text(item.title) || text(item.text).slice(0, 50))

  const wallByEdge = new Map<string, string>()
  const edgeKey = (a: string, b: string) => JSON.stringify([a, b].sort())
  for (const wall of Object.values(scene.walls)) wallByEdge.set(edgeKey(wall.startVertexId, wall.endVertexId), wall.id)
  const wallRooms = new Map<string, { roomId: string; edge: number }[]>()
  const vertexRooms = new Map<string, { roomId: string; point: number }[]>()
  for (const room of Object.values(scene.rooms)) room.boundaryVertexIds.forEach((id, index, ids) => {
    vertexRooms.set(id, [...(vertexRooms.get(id) ?? []), { roomId: room.id, point: index + 1 }])
    const wallId = wallByEdge.get(edgeKey(id, ids[(index + 1) % ids.length]))
    if (wallId) wallRooms.set(wallId, [...(wallRooms.get(wallId) ?? []), { roomId: room.id, edge: index + 1 }])
  })
  numbered(scene.walls, '独立墙体', wall => {
    const rooms = wallRooms.get(wall.id)
    return rooms?.length ? `${rooms.map(value => name(value.roomId)).join(' / ')} · ${rooms.length > 1 ? '共享墙' : '墙'} ${rooms[0].edge}` : ''
  })
  numbered(scene.vertices, '建筑顶点', vertex => {
    const rooms = vertexRooms.get(vertex.id)
    return rooms?.length ? `${rooms.map(value => name(value.roomId)).join(' / ')} · 顶点 ${rooms[0].point}` : `建筑顶点 · ${meters(vertex.xMm)}, ${meters(vertex.yMm)}`
  })
  const openingCounts = new Map<string, number>()
  numbered(scene.openings, '门窗', opening => {
    const index = (openingCounts.get(opening.wallId) ?? 0) + 1
    openingCounts.set(opening.wallId, index)
    return `${name(opening.wallId)} · ${opening.kind === 'door' ? '门' : '窗'} ${index}`
  })
  for (const area of Object.values(scene.terrainAreas)) area.boundaryMm.forEach((point, index) => {
    labels.set(point.id, `${name(area.id)} · 轮廓点 ${index + 1}`)
    labels.set(point.segmentId, `${name(area.id)} · 边段 ${index + 1}`)
  })
  numbered(scene.pathAttachments, '门路关联', row => `${name(row.openingId)} → ${name(row.pathId)}`)
  numbered(scene.terrainEdges, '地形边缘', edge => `${name(edge.source.areaId)} · ${edge.shoreline ? '岸线' : edge.kind === 'cliff' ? '崖边' : '材质交界'}`)
  numbered(scene.terrainConnections, '高差连接', connection => {
    if (connection.terrainInlay?.groundOnly) return '开挖后的地形'
    const { from, to } = connection
    const startArea = from.surfaceRef.kind === 'terrainArea' ? scene.terrainAreas[from.surfaceRef.id] : undefined
    const endArea = to.surfaceRef.kind === 'terrainArea' ? scene.terrainAreas[to.surfaceRef.id] : undefined
    if (connection.kind === 'stairs' && connection.route?.stairStyle === 'naturalRock' && startArea && endArea) {
      return `台阶 · ${meters(startArea.groundElevationMm)} → ${meters(endArea.groundElevationMm)}`
    }
    return `${connection.kind === 'stairs' ? '台阶' : '坡道'} · ${name(from.surfaceRef.id)} → ${name(to.surfaceRef.id)}`
  })
  numbered(scene.scatterGroups, '散布组', group => {
    const palette = [...new Set(group.palette.map(item => name(item.propDefinitionRef.id)))].join('、')
    const domainId = group.domain.kind === 'area' ? group.domain.areaId : group.domain.kind === 'path' ? group.domain.pathId : group.domain.edgeId
    return `${palette || '物件'}散布 · ${name(domainId)}`
  })
  numbered(scene.decorations, '装饰', item => name(item.definitionRef.id))
  numbered(scene.decorationClusters, '簇状布景', group => `${group.canopyRule ? '树冠布景' : '簇状布景'} · ${name(group.supportRef.id)}`)
  numbered(scene.surfaceRules, '地表规则', rule => `${({ material: '地面铺装', trees: '树木分布', shrubs: '灌木分布', grass: '草地分布' })[rule.field]} · ${name(rule.supportRef.id)}`)

  if (visual) {
    numbered(visual.boundaries, '装饰曲线', boundary => boundary.binding.kind === 'terrain' ? `${boundary.binding.sides.map(side => name(side.areaId)).join(' / ')} · 边界曲线` : boundary.binding.kind === 'path' ? `${name(boundary.binding.pathId)} · 路线曲线` : '')
    numbered(visual.edgeLooks, '边带效果', look => `${({ shore: '岸线', cliff: '崖面', grass: '草沿', path: '路沿', fence: '围栏' })[look.kind]} · ${name(look.boundaryId)}`)
    numbered(visual.lights, '灯光', light => {
      const shape = light.shape, type = LIGHT_LABELS[shape?.kind ?? 'point']
      const host = shape?.kind === 'window' ? shape.openingId : shape?.kind === 'area' ? shape.source.id
        : shape?.kind === 'line' && shape.source.kind === 'path' ? shape.source.pathId : undefined
      return `${type} · ${host ? labels.get(host) ?? '宿主已失效' : `${meters(light.positionMm.x)}, ${meters(light.positionMm.y)}`}`
    })
    numbered(visual.fogs, '区域雾')
    numbered(visual.filters, '滤镜', filter => `${({ neutral: '中性', warm: '暖色', cool: '冷色', aged: '旧纸', moonlight: '月色' })[filter.preset]}滤镜`)
    labels.set('visual-environment', '环境光与阴影')
  }
  numbered(scene.visual?.base.materializedEdges, '地形边缘细节')
  numbered(scene.visual?.transitions, '地形过渡', transition => `${({ shore: '海岸过渡', riverMouth: '河口过渡', grassRock: '草岩过渡', forestEdge: '林缘过渡', cliff: '崖面过渡', pathShoulder: '路肩过渡' })[transition.kind]} · ${name(transition.boundaryId)}`)
  const regional = scene.regional
  if (regional) {
    numbered(regional.symbolDefinitions, '地图图符', item => item.name)
    numbered(regional.areas, '区域地貌', area => ({ land: '区域陆地', water: '区域水域', forest: '区域森林', hill: '区域丘陵' })[area.kind])
    numbered(regional.lines, '区域路线', line => ({ river: '区域河流', ridge: '区域山脊', road: '区域道路' })[line.kind])
    numbered(regional.landmarks, '区域地标', landmark => landmark.name)
    numbered(regional.symbols, '地图图符', symbol => name(symbol.definitionRef.id))
    labels.set(regional.profile.id, '区域地图样式')
  }
  return name
}

export function entityLabel(scene: SceneDocument, id: string): string {
  return createEntityLabeler(scene)(id)
}
