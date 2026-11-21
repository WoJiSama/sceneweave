import { geometryIdentityIds } from '../commands/domain.js'
import { effectiveEditLocked, orderedLayers } from '../commands/layers.js'
import { corridor, pathPolygon, polygonInside, polygonsOverlap, propFootprint, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { createSupportQuery } from '../geometry/support-sample.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { Path, PointMm, Prop, SceneDocument, SurfaceRef, TerrainArea } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { isPathLampMember, isPipeFittingMember, PATH_ASSEMBLY_MEMBER_LIMIT, type FenceAssemblyCommand, type PathAssembly, type PathAssemblyCommand, type PathAssemblyRecipe } from './contracts.js'
import { bridgeDeckGeometry, bridgeNodeLamp, planPathSections, standardPathLamp, type SectionPart } from './layout.js'
import { assemblyMemberFingerprint, assemblyRouteFingerprint, fenceRouteFingerprint } from './validation.js'
import { fenceRoutePoints, planFenceSections, planFittingPathSections, sizeSection } from './fitted-layout.js'
import { resolvePathProp, resolvePathSection } from './sources.js'
import { visualBase } from '../visual/base.js'
import type { VisualBoundary } from '../visual/types.js'
import { PATH_ENDS, type DetachBridgeRoad, type MoveBridge } from './bridge-link-contracts.js'
import { assertBridgeUnlocked, planBridgeMove } from './bridge-links.js'
import { BRIDGE_FOLLOW_DISTANCE_MM, distance, offsetPoint, samePoint, subtract, translateBridgeSurfaceStyle } from './bridge-link-geometry.js'
import { isPipeBoundary, linkedPipes, occupiedPipePorts, pipeEnd, pipePortWorld, PIPE_PORTS, PIPE_SNAP_DISTANCE_MM, resolvePipePort } from './pipe-geometry.js'
import type { PipeLinks, SetPipeLink } from './pipe-contracts.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { placeBridgeApproaches, splitRoadForBridge } from './bridge-conversion.js'

function unlocked(scene: SceneDocument, entity: { id: string; editLocked: boolean; layerId?: string }): boolean {
  return !entity.editLocked && !scene.userLayers[entity.layerId ?? scene.entityLayers[entity.id]]?.editLocked
}

function placeBridgeDeck(scene: SceneDocument, path: Path, bridge: NonNullable<PathAssemblyCommand['bridge']>, points: PointMm[],
  deck: TerrainArea | undefined, allocate: () => string, layerId: string): TerrainArea {
  if (deck && (!unlocked(scene, deck) || (deck.groundElevationMm !== bridge.elevationMm || deck.visibility !== bridge.visibility)
    && effectiveEditLocked(scene, deck.id))) throw new Error('桥面或受影响的承托物件已锁定。')
  const priority = deck?.coveragePriority ?? Math.max(0, ...Object.values(scene.terrainAreas)
    .filter(area => area.floorId === path.floorId).map(area => area.coveragePriority)) + 1
  if (priority > 10000) throw new Error('当前 Floor 的覆盖优先级已经用尽。')
  const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y
  const boundaryMm = points.map((positionMm, index) => {
    const previous = deck?.boundaryMm.findIndex(row => samePoint(row.positionMm, positionMm)) ?? -1
    if (previous < 0 || !deck) return { id: allocate(), segmentId: allocate(), positionMm }
    const row = deck.boundaryMm[previous], end = deck.boundaryMm[(previous + 1) % deck.boundaryMm.length]
    return { id: row.id, segmentId: samePoint(end.positionMm, points[(index + 1) % points.length]) ? row.segmentId : allocate(), positionMm }
  })
  const target = { id: deck?.id ?? allocate(), floorId: path.floorId, editLocked: deck?.editLocked ?? false,
    visibility: bridge.visibility, groundElevationMm: bridge.elevationMm, boundaryMm, coveragePriority: priority,
    blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, surfaceStyle: deck?.surfaceStyle ?? null }
  scene.terrainAreas[target.id] = target
  scene.entityLayers[target.id] = deck ? scene.entityLayers[deck.id] : layerId
  return target
}

function isRetained(scene: SceneDocument, member: Extract<PathAssembly['members'][string], { state: 'placed' }>): boolean {
  const prop = scene.props[member.propId]
  return !prop || member.manualAppearance === true || !unlocked(scene, prop) || assemblyMemberFingerprint(prop, scene.entityLayers[prop.id]) !== member.fingerprint
    || Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === prop.id)
    || Object.values(scene.attachmentSurfaces ?? {}).some(row => row.owner.kind === 'prop' && row.owner.id === prop.id)
    || Object.values(scene.attachments ?? {}).some(row => row.child.kind === 'prop' && row.child.id === prop.id)
}

function removeProp(scene: SceneDocument, id: string) {
  delete scene.props[id]
  delete scene.entityLayers[id]
}

function assemblyIds(scene: SceneDocument, id: string, existing: boolean, context: PreparationContext) {
  const reserved = geometryIdentityIds(scene)
  for (const id of Object.keys(scene.userLayers)) reserved.add(id)
  if (!existing && reserved.has(id)) throw new Error('沿线对象 ID 已在当前工程使用。')
  reserved.add(id)
  return () => {
    const id = context.ids.nextId()
    if (reserved.has(id)) throw new Error('沿线装配分配了已使用的 ID。')
    reserved.add(id)
    return id
  }
}

/** One detached, fully validated scene transaction owns the route, solid deck and placed copies. */
export function applyPathAssembly(scene: SceneDocument, command: PathAssemblyCommand, context: PreparationContext, graph?: AppearanceGraph): void {
  const old = scene.paths[command.id], existing = old?.assembly
  const floor = scene.floors[command.floorId], recipe = cloneJson(command.recipe)
  if (!floor || old && old.floorId !== floor.id) throw new Error('沿线构件须与路线属于同一 Floor。')
  if (!command.bridge && !old || existing?.bridge && !command.bridge) throw new Error('请选择已有道路，或提供完整桥面设置。')
  if (recipe.structure && (!command.bridge || recipe.section.kind === 'none')) throw new Error('工业桥结构需要桥面和连续边梁源节。')
  if (old && !unlocked(scene, old)) throw new Error('路线或所在图层已锁定。')
  const layerId = old ? scene.entityLayers[old.id] : command.layerId ?? orderedLayers(scene, floor.id)[0]?.id
  const layer = layerId && scene.userLayers[layerId]
  if (!layer || layer.floorId !== floor.id || layer.editLocked || command.layerId && command.layerId !== layer.id) throw new Error('请选择同 Floor 的可编辑图层。')
  const allocate = assemblyIds(scene, command.id, !!old, context)
  if (command.roadRange && !old) throw new Error('请选择要转为桥梁的已有道路。')
  const split = command.roadRange && old ? splitRoadForBridge(scene, old, command) : undefined
  const path: Path = { ...(old ?? { id: command.id, floorId: floor.id, editLocked: false, visibility: 'public',
    supportRefs: [], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }),
    centerlineMm: cloneJson(split?.bridge ?? command.centerlineMm), widthMm: command.widthMm }
  if (command.widthSections === null) delete path.widthSections
  else if (command.widthSections) path.widthSections = cloneJson(command.widthSections)
  if (command.bridge && path.widthSections) throw new Error('转为桥梁前请先将这段道路设为等宽。')
  const members: PathAssembly['members'] = {}
  const assembly: PathAssembly = { version: 1, recipe, routeFingerprint: assemblyRouteFingerprint(path), members }
  path.assembly = assembly
  const bridge = command.bridge, geometry = bridge ? bridgeDeckGeometry(path, recipe.shoulderMm, recipe.structure?.bridgehead) : undefined
  if (bridge && geometry) {
    const previousDeck = existing?.bridge ? scene.terrainAreas[existing.bridge.deckId] : undefined
    const deck = placeBridgeDeck(scene, path, bridge, geometry.outline, previousDeck, allocate, layer.id)
    path.supportRefs = [{ kind: 'terrainArea', id: deck.id }]
    path.visibility = bridge.visibility
    assembly.bridge = { ...existing?.bridge, ...bridge, deckId: deck.id }
  }
  scene.paths[path.id] = path
  scene.entityLayers[path.id] = layer.id
  if (split && old) placeBridgeApproaches(scene, path, old, split, allocate)
  const visibility = createPublicVisibility(scene), publicPath = visibility.path(path.id)
  const section = sizeSection(resolvePathSection(scene, graph, recipe.section, publicPath), recipe.dimensions)
  const lamp = recipe.lamps && (recipe.lamps.ref ? resolvePathProp(scene, graph, recipe.lamps.ref) : recipe.structure ? bridgeNodeLamp() : standardPathLamp())
  const fit = !!recipe.structure || !!recipe.fit || recipe.section.kind === 'profile'
  const planned = fit ? planFittingPathSections(path, recipe, section, lamp, geometry?.landings) : planPathSections(path, recipe, section, lamp)
  const deck = assembly.bridge && scene.terrainAreas[assembly.bridge.deckId]
  const clear = [pathPolygon(path), ...(geometry?.landings ?? []).map(row => corridor(row.originMm, row.endMm, path.widthMm))]
  placeAssemblyMembers(scene, { floorId: floor.id, layerId: layer.id, publicAssembly: publicPath, recipe, existing,
    members, planned, allocate, support: deck ? { kind: 'terrainArea', id: deck.id } : undefined, clear,
    deck: deck ? terrainPoints(deck) : undefined })
}

export function moveBridge(scene: SceneDocument, command: MoveBridge): void {
  const { path, deck, links, feedback } = planBridgeMove(scene, command)
  const assembly = path.assembly!, bridge = assembly.bridge!, offset = command.offsetMm
  if (offset.x || offset.y) {
    const moved = new Set<string>()
    for (const member of Object.values(assembly.members)) {
      if (member.state !== 'placed') continue
      const prop = scene.props[member.propId], layerId = scene.entityLayers[prop.id]
      if (scene.userLayers[layerId]?.editLocked) throw new Error(`桥梁构件 ${prop.id} 的图层已锁定。`)
      const managed = assemblyMemberFingerprint(prop, layerId) === member.fingerprint
      prop.positionMm = offsetPoint(prop.positionMm, offset)
      if (managed) member.fingerprint = assemblyMemberFingerprint(prop, layerId)
      moved.add(prop.id)
    }
    for (const prop of Object.values(scene.props)) {
      if (moved.has(prop.id) || prop.supportRef.kind !== 'terrainArea' || prop.supportRef.id !== deck.id) continue
      if (!unlocked(scene, prop)) throw new Error(`桥面上的布置 ${prop.id} 已锁定。`)
      prop.positionMm = offsetPoint(prop.positionMm, offset)
    }
    if (path.surfaceStyle) path.surfaceStyle = translateBridgeSurfaceStyle(path.surfaceStyle, offset)
    if (deck.surfaceStyle) deck.surfaceStyle = translateBridgeSurfaceStyle(deck.surfaceStyle, offset)
    assembly.routeFingerprint = assemblyRouteFingerprint(path)
  }
  if (Object.keys(links).length) bridge.roadLinks = links
  else delete bridge.roadLinks
  scene.paths[path.id] = path
  scene.terrainAreas[deck.id] = deck
  for (const item of feedback) if (item.path) scene.paths[item.roadId] = item.path
}

export function detachBridgeRoad(scene: SceneDocument, command: DetachBridgeRoad): void {
  const { bridge } = assertBridgeUnlocked(scene, command.id)
  if (!bridge.roadLinks?.[command.end]) throw new Error('此桥头没有路端链接。')
  delete bridge.roadLinks[command.end]
  if (!Object.keys(bridge.roadLinks).length) delete bridge.roadLinks
}

export function removeIncomingBridgeLinks(scene: SceneDocument, pathId: string) {
  let cost = 0
  for (const path of Object.values(scene.paths)) {
    const links = path.assembly?.bridge?.roadLinks
    for (const end of PATH_ENDS) if (links?.[end]?.pathId === pathId) {
      detachBridgeRoad(scene, { type: 'detachBridgeRoad', id: path.id, end })
      cost++
    }
  }
  return cost
}

type AssemblyRecipe = Pick<PathAssemblyRecipe, 'section' | 'lamps' | 'dimensions' | 'fit'>
type MemberOwner = { recipe: AssemblyRecipe; members: PathAssembly['members'] }
interface Placement {
  floorId: string
  layerId: string
  publicAssembly: boolean
  recipe: AssemblyRecipe
  existing?: MemberOwner
  members: PathAssembly['members']
  planned: readonly SectionPart[]
  allocate: () => string
  support?: SurfaceRef
  clear?: PointMm[][]
  deck?: PointMm[]
}

function sectionIdentity(section: AssemblyRecipe['section'] | undefined) {
  return !section ? null : 'ref' in section ? [section.kind, section.ref]
    : section.kind === 'profile' ? [section.kind, section.profile] : [section.kind]
}

function placeAssemblyMembers(scene: SceneDocument, input: Placement): void {
  const { floorId, layerId, publicAssembly, recipe, existing, members, planned, allocate, clear, deck } = input
  const supportQuery = input.support ? undefined : createSupportQuery(scene, floorId)
  const visibility = createPublicVisibility(scene), managed = new Map<string, string>()
  const plannedKeys = new Set(planned.map(part => part.key)), prefixes = new Set(planned.map(part => part.key.split(':').slice(0, 3).join(':')))
  const sameSection = canonicalJson(sectionIdentity(existing?.recipe.section)) === canonicalJson(sectionIdentity(recipe.section))
  const sameLamp = canonicalJson(existing?.recipe.lamps?.ref ?? null) === canonicalJson(recipe.lamps?.ref ?? null)
  for (const [key, member] of Object.entries(existing?.members ?? {})) {
    if (member.state === 'removed' || isRetained(scene, member)) {
      if (!sameSection && key.includes(':section:') && !plannedKeys.has(key) && prefixes.has(key.split(':').slice(0, 3).join(':'))) {
        throw new Error('该路线有人工移动、删除或锁定的源节部件，新样式的部件无法逐一对应。请先在构件列表核对这些位置。')
      }
      members[key] = member
    } else managed.set(key, member.propId)
  }
  const occupiedRailSlots = new Map<string, boolean>()
  for (const key of plannedKeys) {
    const part = key.indexOf(':section:')
    if (part === -1) continue
    const slot = key.slice(0, part)
    if (!occupiedRailSlots.get(slot)) occupiedRailSlots.set(slot, members[key]?.state !== 'removed')
  }
  for (const { key, propTemplate } of planned) {
    if (Object.hasOwn(members, key)) continue
    if (key.endsWith(':lamp') && !managed.has(key) && occupiedRailSlots.get(key.slice(0, -5)) === false) continue
    const sameSource = key.includes(':section:') || isPipeFittingMember(key) ? sameSection : isPathLampMember(key) ? sameLamp : true
    const oldId = managed.get(key), id = oldId && sameSource ? oldId : allocate()
    const support = input.support ?? supportQuery?.rootAt(propTemplate.positionMm)
    if (!support) throw new Error('沿线构件位置没有可用承托面。')
    const supportingArea = support.kind === 'terrainArea' ? scene.terrainAreas[support.id] : undefined
    if (supportingArea && !unlocked(scene, supportingArea)) throw new Error('沿线构件的承托面已锁定。')
    const prop: Prop = { ...cloneJson(propTemplate), id, floorId, editLocked: false, supportRef: support,
      visibility: publicAssembly && visibility.surface(support) ? 'public' : 'gm' }
    const footprint = propFootprint(prop)
    const location = `(${prop.positionMm.x}, ${prop.positionMm.y}) mm`
    if (prop.blocksMovement && clear?.some(band => polygonsOverlap(footprint, band))) throw new Error(`${location} 的构件占地侵入设定的通行净宽。请增大边带宽度或调整构件占地。`)
    if (deck && !polygonInside(footprint, deck)) throw new Error(`${location} 的构件超出桥面承托。请加宽边带、收窄构件或调整转角。`)
    if (oldId && oldId === id) managed.delete(key)
    scene.props[id] = prop
    scene.entityLayers[id] = layerId
    members[key] = { state: 'placed', propId: id, fingerprint: assemblyMemberFingerprint(prop, layerId) }
  }
  for (const id of managed.values()) removeProp(scene, id)
  if (Object.keys(members).length > PATH_ASSEMBLY_MEMBER_LIMIT) throw new Error('保留的局部修改与新构件合计超过单条路线预算。')
}

export function applyFenceAssembly(scene: SceneDocument, command: FenceAssemblyCommand, context: PreparationContext, graph?: AppearanceGraph): void {
  if (scene.mapMode !== 'scene' || !scene.floors[command.floorId]) throw new Error('实体围栏须在场景楼层中绘制。')
  const boundaries = scene.visual.base.base.boundaries, old = boundaries[command.id]
  const layer = scene.userLayers[command.layerId]
  if (old && (!old.fence || old.floorId !== command.floorId || old.layerId !== command.layerId || !unlocked(scene, old))) throw new Error('请选择可编辑的实体围栏。')
  if (!layer || layer.floorId !== command.floorId || layer.editLocked) throw new Error('请选择同 Floor 的可编辑图层。')
  const allocate = assemblyIds(scene, command.id, !!old, context), recipe = cloneJson(command.recipe)
  const points = cloneJson(command.centerlineMm), closed = command.closed
  const line = closed ? [...points, points[0]] : points
  if (line.length > 33 || closed && points.length < 3) throw new Error('闭合围栏需要 3–32 个点。')
  if (closed && recipe.endClearanceMm) throw new Error('请用沿线开口设置闭合围栏的入口。')
  if (recipe.gaps?.some(gap => gap.side !== 'both')) throw new Error('实体围栏只有一条中心线，请对整条线设置开口。')
  if (recipe.section.kind === 'none') throw new Error('请选择围栏源节。')
  const members: PathAssembly['members'] = {}
  const boundary: VisualBoundary = { id: command.id, floorId: command.floorId, layerId: layer.id, visibility: command.visibility,
    editLocked: old?.editLocked ?? false, closed, binding: { kind: 'decoration' }, sampleSpacingMm: 20000, toleranceMm: 1,
    segments: line.slice(1).map((end, index) => {
      const start = line[index], prior = old?.segments[index]
      const lerp = (n: number) => ({ x: Math.round(start.x + (end.x - start.x) * n) || 0, y: Math.round(start.y + (end.y - start.y) * n) || 0 })
      return { id: prior?.id ?? allocate(), start, control1: lerp(1 / 3), control2: lerp(2 / 3), end }
    }) }
  boundary.fence = { version: 1, recipe, routeFingerprint: fenceRouteFingerprint(boundary), members,
    ...(old?.fence?.pipeLinks ? { pipeLinks: old.fence.pipeLinks } : {}) }
  const section = sizeSection(resolvePathSection(scene, graph, recipe.section, command.visibility === 'public'), recipe.dimensions)
  const lamp = recipe.lamps && (recipe.lamps.ref ? resolvePathProp(scene, graph, recipe.lamps.ref) : standardPathLamp())
  const planned = planFenceSections(points, closed, recipe, section, lamp)
  boundaries[command.id] = boundary
  placeAssemblyMembers(scene, { floorId: layer.floorId, layerId: layer.id, publicAssembly: command.visibility === 'public', recipe,
    existing: old?.fence, members, planned, allocate })
}

function updatePipeLinks(boundary: VisualBoundary, links: PipeLinks) {
  if (Object.keys(links).length) boundary.fence!.pipeLinks = links
  else delete boundary.fence!.pipeLinks
}

function reroutePipe(scene: SceneDocument, boundary: VisualBoundary, points: PointMm[], links: PipeLinks, context: PreparationContext, graph?: AppearanceGraph) {
  const next = { ...scene, props: { ...scene.props }, entityLayers: { ...scene.entityLayers }, visual: cloneJson(scene.visual) }
  const { id, floorId, layerId, closed, visibility } = boundary
  applyFenceAssembly(next, { type: 'setFenceAssembly', id, floorId, layerId, closed, visibility, centerlineMm: points, recipe: boundary.fence!.recipe }, context, graph)
  const actual = next.visual.base.base.boundaries[id]
  for (const member of Object.values(actual.fence!.members)) if (member.state === 'placed') {
    const prop = next.props[member.propId]
    if (prop !== scene.props[prop.id] && !supportedPolygon(next, propFootprint(prop), prop.supportRef, floorId)) throw new Error('管端调整后有部件失去完整承托。')
  }
  updatePipeLinks(actual, links)
  Object.assign(scene, { props: next.props, entityLayers: next.entityLayers, visual: next.visual })
}

export function setPipeLink(scene: SceneDocument, command: SetPipeLink, context: PreparationContext, graph?: AppearanceGraph) {
  const row = Object.hasOwn(scene.visual.base.base.boundaries, command.id) ? scene.visual.base.base.boundaries[command.id] : undefined
  if (!row?.fence || !isPipeBoundary(scene, row) || !unlocked(scene, row)) throw new Error('请选择一个可编辑的开放管线。')
  const links = { ...row.fence.pipeLinks }
  if (!command.target) {
    delete links[command.end]
    updatePipeLinks(row, links)
    return
  }
  if (links[command.end]) throw new Error('请先断开该管端已有的链接。')
  if (occupiedPipePorts(scene)(command.target)) throw new Error('设备管口已被管线占用。')
  if (row.fence.recipe.endClearanceMm) throw new Error('连接设备前请将管线端部留空设为 0。')
  const point = resolvePipePort(scene, row, command.target)
  if (!point || effectiveEditLocked(scene, command.target.propId) || distance(point, pipeEnd(row, command.end)) > PIPE_SNAP_DISTANCE_MM) {
    throw new Error('管口须位于同层并在 1.8 米接合范围内。')
  }
  const points = fenceRoutePoints(row)
  points[command.end === 'start' ? 0 : points.length - 1] = point
  links[command.end] = { ...command.target, restMm: point }
  reroutePipe(scene, row, points, links, context, graph)
}

type PipeDragLink = { pipeId: string; state: 'follow' | 'break' | 'attach'; from: PointMm; to: PointMm; route?: PointMm[] }

/** Settle the same actual endpoint and component placement for a drag and a command. */
function followPipe(scene: SceneDocument, id: string, context: PreparationContext, graph?: AppearanceGraph): PipeDragLink[] {
  const row = scene.visual.base.base.boundaries[id], links = { ...row.fence?.pipeLinks }
  const changes = PATH_ENDS.flatMap(end => {
    const link = links[end]
    if (!link) return []
    const from = pipeEnd(row, end), point = resolvePipePort(scene, row, link)
    if (point && samePoint(point, from)) return []
    return [{ end, from, point, canFollow: !!point && distance(point, link.restMm) <= BRIDGE_FOLLOW_DISTANCE_MM }]
  })
  if (!changes.length) return []
  if (!unlocked(scene, row)) throw new OperationRejected('locked_dependency', '相接管线或图层已锁定，请先解锁管线。')
  const points = fenceRoutePoints(row)
  for (const change of changes) {
    if (change.canFollow) points[change.end === 'start' ? 0 : points.length - 1] = change.point!
    else delete links[change.end]
  }
  if (changes.some(change => change.canFollow)) {
    try { reroutePipe(scene, row, points, links, context, graph) }
    catch {
      for (const change of changes) {
        change.canFollow = false
        delete links[change.end]
      }
      updatePipeLinks(row, links)
    }
  } else updatePipeLinks(row, links)
  return changes.map(({ from, point, canFollow }) => ({ pipeId: id, from, to: point ?? from,
    state: canFollow ? 'follow' : 'break', ...(canFollow ? { route: points } : {}) }))
}

export function followPipeLinks(scene: SceneDocument, context: PreparationContext, graph?: AppearanceGraph): number {
  let changed = 0
  for (const row of Object.values(scene.visual.base.base.boundaries)) {
    if (row.fence?.pipeLinks && followPipe(scene, row.id, context, graph).length) changed++
  }
  return changed
}

export function preparePipeDeviceDrag(scene: SceneDocument, id: string, context: PreparationContext, graph: AppearanceGraph, hiddenLayers: ReadonlySet<string>) {
  const device = scene.props[id], owned = linkedPipes(scene, id)
  const occupied = occupiedPipePorts(scene), visibility = createPublicVisibility(scene)
  const targets = Object.values(scene.visual.base.base.boundaries).filter(row => row.floorId === device.floorId && isPipeBoundary(scene, row)
    && !row.fence!.recipe.endClearanceMm && unlocked(scene, row) && !hiddenLayers.has(row.layerId)).flatMap(row => PATH_ENDS.flatMap(end => {
    if (row.fence!.pipeLinks?.[end]) return []
    const to = pipeEnd(row, end)
    return PIPE_PORTS.flatMap(port => {
      const target = { propId: id, port }, from = resolvePipePort(scene, row, target, visibility)
      return from && !occupied(target) ? [{ offsetMm: subtract(to, from), command: { type: 'setPipeLink', id: row.id, end, target } satisfies SetPipeLink, to }] : []
    })
  }))
  return (offsetMm: PointMm, snapDistanceMm: number) => {
    const propose = (offset: PointMm, snapped?: typeof targets[number], problem?: string) => {
      const point = offsetPoint(device.positionMm, offset), moved = { ...device, positionMm: point }
      const draft = { ...scene, visual: cloneJson(scene.visual), props: { ...scene.props, [id]: moved } }
      if ((offset.x || offset.y) && !supportedPolygon(draft, propFootprint(moved), moved.supportRef, moved.floorId)) throw new Error('设备在此处缺少完整承托。')
      const feedback = owned.flatMap(row => followPipe(draft, row.id, context, graph))
      if (snapped) {
        setPipeLink(draft, snapped.command, context, graph)
        feedback.push({ pipeId: snapped.command.id, state: 'attach', to: snapped.to, from: pipePortWorld(moved, snapped.command.target.port)!,
          route: fenceRoutePoints(draft.visual.base.base.boundaries[snapped.command.id]) })
      }
      return { offsetMm: offset, positionMm: point, feedback, attach: snapped?.command, problem }
    }
    const nearest = Math.min(snapDistanceMm, PIPE_SNAP_DISTANCE_MM)
    const snap = nearest > 0 ? targets.map(target => ({ target, distance: distance(target.offsetMm, offsetMm) }))
      .filter(row => row.distance <= nearest).sort((a, b) => a.distance - b.distance || a.target.command.id.localeCompare(b.target.command.id))[0]?.target : undefined
    if (snap) {
      try { return propose(snap.offsetMm, snap) }
      catch (error) { return propose(offsetMm, undefined, error instanceof Error ? error.message : String(error)) }
    }
    return propose(offsetMm)
  }
}

function assemblyOwners(scene: SceneDocument) {
  return [
    ...Object.values(scene.paths).flatMap(path => path.assembly ? [{ owner: path, assembly: path.assembly }] : []),
    ...Object.values(visualBase(scene)?.boundaries ?? {}).flatMap(boundary => boundary.fence ? [{ owner: boundary, assembly: boundary.fence }] : []),
  ]
}

export function removeFenceAssembly(scene: SceneDocument, id: string): void {
  const visual = scene.visual.base.base, boundary = visual.boundaries[id]
  if (!boundary?.fence || !unlocked(scene, boundary)) throw new Error('该围栏不存在或已锁定。')
  if (Object.values(visual.edgeLooks).some(row => row.boundaryId === id)
    || Object.values(scene.visual.base.materializedEdges).some(row => row.boundaryId === id)
    || Object.values(scene.visual.transitions).some(row => row.boundaryId === id)) throw new Error('请先移除这条线上的边带和地表过渡。')
  const visibility = createPublicVisibility(scene)
  for (const member of Object.values(boundary.fence.members)) if (member.state === 'placed') {
    const prop = scene.props[member.propId]
    if (!isRetained(scene, member)) removeProp(scene, member.propId)
    else if (prop && !visibility.prop(prop) && prop.visibility !== 'gm') {
      if (!unlocked(scene, prop)) throw new Error('保留的私密构件已锁定。')
      prop.visibility = 'gm'
    }
  }
  delete visual.boundaries[id]
}

export function retainPathMemberAppearance(scene: SceneDocument, ids: readonly string[]): void {
  const targets = new Set(ids)
  for (const { assembly } of assemblyOwners(scene)) {
    for (const member of Object.values(assembly.members)) {
      if (member.state === 'placed' && targets.has(member.propId)) member.manualAppearance = true
    }
  }
}

/** Generic prop deletion leaves a durable empty repeat slot. */
export function retainRemovedPathSlots(before: SceneDocument, after: SceneDocument): void {
  const previous = new Map(assemblyOwners(before).map(({ owner }) => [owner.id, owner]))
  for (const { owner, assembly } of assemblyOwners(after)) {
    for (const [key, member] of Object.entries(assembly.members)) {
      if (member.state === 'removed' || after.props[member.propId] || !before.props[member.propId]) continue
      const prior = previous.get(owner.id)
      if (prior && !unlocked(before, prior)) throw new Error('路线已锁定，不能删除它的沿线构件。')
      assembly.members[key] = { state: 'removed' }
    }
  }
}

export function removePathAssemblyEntities(scene: SceneDocument, path: Path): void {
  if (!path.assembly) return
  const bridge = path.assembly.bridge
  const visibility = createPublicVisibility(scene)
  for (const member of Object.values(path.assembly.members)) if (member.state === 'placed') {
    if (isRetained(scene, member)) {
      if (bridge && scene.props[member.propId]?.supportRef.id === bridge.deckId) throw new Error('请先处理桥面上手工调整、被引用或锁定的构件。')
      if (scene.props[member.propId] && !visibility.prop(scene.props[member.propId]) && scene.props[member.propId].visibility !== 'gm') {
        if (!unlocked(scene, scene.props[member.propId])) throw new Error('保留的私密构件已锁定。')
        scene.props[member.propId].visibility = 'gm'
      }
    } else removeProp(scene, member.propId)
  }
  if (bridge) {
    const deck = scene.terrainAreas[bridge.deckId]
    if (deck && !unlocked(scene, deck)) throw new Error('桥面已锁定。')
    delete scene.terrainAreas[bridge.deckId]
    delete scene.entityLayers[bridge.deckId]
  }
}
