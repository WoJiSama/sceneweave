import { effectiveEditLocked, effectiveLayerLocked } from '../commands/layers.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { polygonsOverlap, propFootprint, terrainPoints } from '../geometry/geometry.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { Path, PointMm, SceneDocument } from '../model/scene.js'
import { canonicalJson } from '../validation/json.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { PATH_ENDS, type BridgeRoadLink, type MoveBridge, type PathEnd } from './bridge-link-contracts.js'
import { approachEndpoint, BRIDGE_FOLLOW_DISTANCE_MM, compatible, distance, facesRoad, hasContinuousBridgeApproach,
  offsetPoint, pathEndPosition, samePoint, subtract, withBridgeApproach } from './bridge-link-geometry.js'
import { isRetainedAssemblyMember } from './member-protection.js'
import { planBoundPlatformFence } from './platform-fence-binding.js'

type Bridge = NonNullable<NonNullable<Path['assembly']>['bridge']>
const MAX_SNAP_DISTANCE_MM = 1200

function ownerAt(scene: SceneDocument, pathId: string, end: PathEnd) {
  return Object.values(scene.paths).some(path => PATH_ENDS.some(port => {
    const link = path.assembly?.bridge?.roadLinks?.[port]
    return link?.pathId === pathId && link.end === end
  })) || Object.values(scene.pathAttachments ?? {}).some(row => row.pathId === pathId)
}

type BridgeDragLink = { state: 'follow' | 'break' | 'attach'; roadId: string; end: PathEnd; from: PointMm; to: PointMm; path?: Path }

export function assertBridgeUnlocked(scene: SceneDocument, id: string): { path: Path; deck: SceneDocument['terrainAreas'][string]; bridge: Bridge } {
  const path = Object.hasOwn(scene.paths, id) ? scene.paths[id] : undefined, bridge = path?.assembly?.bridge
  const deck = bridge && scene.terrainAreas[bridge.deckId]
  if (!path || !bridge || !deck) throw new Error('请选择一座有真实桥面的桥。')
  if (path.editLocked || deck.editLocked || effectiveLayerLocked(scene, path.id) || effectiveLayerLocked(scene, deck.id)) {
    throw new OperationRejected('locked_dependency', '桥或桥面的图层已锁定。')
  }
  return { path, deck, bridge }
}

/** This is the same plan used by the editor gesture and the owned command. */
export function planBridgeMove(scene: SceneDocument, command: MoveBridge, graph?: AppearanceGraph) {
  const source = assertBridgeUnlocked(scene, command.id)
  const { bridge } = source
  const translated = (point: PointMm) => offsetPoint(point, command.offsetMm)
  const path = { ...source.path, centerlineMm: source.path.centerlineMm.map(translated) }
  const deck = { ...source.deck, boundaryMm: source.deck.boundaryMm.map(point => ({ ...point, positionMm: translated(point.positionMm) })) }
  const bounds = scene.floors[path.floorId].boundsMm
  if (deck.boundaryMm.some(({ positionMm: p }) => p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height)) {
    throw new Error('桥面越出本楼层范围。')
  }
  const spatial = { ...scene, paths: { ...scene.paths, [path.id]: path }, terrainAreas: { ...scene.terrainAreas, [deck.id]: deck } }
  if (command.offsetMm.x || command.offsetMm.y) {
    const outline = terrainPoints(deck), members = new Set(Object.values(path.assembly!.members).flatMap(member => member.state === 'placed' ? [member.propId] : []))
    const attached = new Set(Object.values(scene.attachments ?? {}).flatMap(row => row.child.kind === 'prop' ? [row.child.id] : []))
    const fences = new Map(Object.values(scene.visual.base.base.boundaries).flatMap(row => row.fence?.platformBinding && row.floorId === path.floorId
      ? Object.values(row.fence.members).flatMap(member => member.state === 'placed' ? [[member.propId, { row, member }] as const] : []) : []))
    const refitted = new Map<string, boolean>()
    for (const prop of Object.values(scene.props)) {
      if (prop.floorId !== path.floorId || members.has(prop.id) || attached.has(prop.id) || prop.supportRef.id === deck.id) continue
      const support = prop.supportRef.kind === 'terrainArea' ? scene.terrainAreas[prop.supportRef.id] : undefined
      if (support && support.coveragePriority > deck.coveragePriority) continue
      if (!polygonsOverlap(outline, propFootprint(prop))) continue
      const fence = fences.get(prop.id)
      if (fence) {
        const { row } = fence, assembly = row.fence!
        if (row.editLocked || scene.userLayers[row.layerId]?.editLocked || prop.editLocked || effectiveLayerLocked(scene, prop.id)) {
          throw new OperationRejected('locked_dependency', `桥面会覆盖已锁定的护栏构件 ${prop.id} 的承托。`)
        }
        if (isRetainedAssemblyMember(scene, fence.member, graph)) {
          throw new OperationRejected('invalid_geometry', `桥面会覆盖保留构件 ${prop.id} 的承托。请先移开这件构件。`)
        }
        if (!refitted.has(row.id)) {
          const next = planBoundPlatformFence(spatial, { ...row, recipe: assembly.recipe }, assembly.platformBinding!)
          refitted.set(row.id, canonicalJson(next.route.gaps) !== canonicalJson(assembly.recipe.gaps ?? []))
        }
        // Managed repeats will be re-seated by the current atomic command.
        if (refitted.get(row.id)) continue
      }
      throw new Error('桥面会覆盖原有物件的承托。请调整放置位置。')
    }
  }
  const links: Partial<Record<PathEnd, BridgeRoadLink>> = {}, feedback: BridgeDragLink[] = []
  for (const bridgeEnd of PATH_ENDS) {
    const link = bridge.roadLinks?.[bridgeEnd]
    if (!link) continue
    const current = spatial.paths[link.pathId]
    const from = pathEndPosition(path, bridgeEnd), to = pathEndPosition(current, link.end)
    const moved = withBridgeApproach(path, bridgeEnd, current, link.end, true), point = pathEndPosition(moved, link.end)
    if (samePoint(point, to) || !effectiveEditLocked(scene, current.id) && distance(link.restMm, point) <= BRIDGE_FOLLOW_DISTANCE_MM &&
        facesRoad(path, bridgeEnd, moved, link.end, point, true) && hasContinuousBridgeApproach(spatial, path, bridgeEnd, moved, link.end)) {
      links[bridgeEnd] = link
      spatial.paths[current.id] = moved
      feedback.push({ state: 'follow', roadId: current.id, end: link.end, from, to: point, path: moved })
    } else feedback.push({ state: 'break', roadId: current.id, end: link.end, from, to })
  }
  if (command.attach) {
    const { pathId, end, bridgeEnd } = command.attach
    const road = spatial.paths[pathId]
    const visibility = createPublicVisibility(scene)
    if (bridge.roadLinks?.[bridgeEnd] || ownerAt(scene, pathId, end) || !compatible(path, road) || effectiveEditLocked(scene, pathId)
        || visibility.path(road.id) !== visibility.path(path.id)) {
      throw new Error('路端或桥头已占用、锁定，或不在同一楼层和受众范围。')
    }
    const restMm = pathEndPosition(road, end), point = approachEndpoint(path, bridgeEnd, road), aligned = withBridgeApproach(path, bridgeEnd, road, end, false)
    if (!samePoint(point, restMm) || !facesRoad(path, bridgeEnd, road, end, restMm)
        || aligned.centerlineMm.length > 256 || !hasContinuousBridgeApproach(spatial, path, bridgeEnd, aligned, end)) {
      throw new Error('桥头到路端须有连续的同高承托，路端朝向须与桥头相容。')
    }
    links[bridgeEnd] = { pathId, end, restMm }
    feedback.push({ state: 'attach', roadId: pathId, end, from: pathEndPosition(path, bridgeEnd), to: restMm, path: aligned })
  }
  return { path, deck, links, feedback }
}

export function prepareBridgeDrag(scene: SceneDocument, id: string, exclude: ReadonlySet<string> = new Set(), graph?: AppearanceGraph) {
  const { path, bridge } = assertBridgeUnlocked(scene, id)
  const visible = createPublicVisibility(scene)
  const roads = Object.values(scene.paths), occupied = new Map<string, Set<PathEnd>>()
  for (const candidate of roads) for (const end of PATH_ENDS) {
    const link = candidate.assembly?.bridge?.roadLinks?.[end]
    if (link) occupied.set(link.pathId, new Set([...(occupied.get(link.pathId) ?? []), link.end]))
  }
  const doors = new Set(Object.values(scene.pathAttachments ?? {}).map(row => row.pathId)), publicBridge = visible.path(id)
  const candidates = roads.filter(road => !exclude.has(road.id) && !doors.has(road.id) && compatible(path, road)
    && !road.editLocked && !effectiveLayerLocked(scene, road.id) && visible.path(road.id) === publicBridge)
    .flatMap(road => PATH_ENDS.flatMap(end => occupied.get(road.id)?.has(end) ? [] : PATH_ENDS.flatMap(bridgeEnd => {
      const point = pathEndPosition(road, end)
      return bridge.roadLinks?.[bridgeEnd] || !facesRoad(path, bridgeEnd, road, end, point) ? [] : [{
        attach: { pathId: road.id, end, bridgeEnd }, offsetMm: subtract(point, approachEndpoint(path, bridgeEnd, road)),
      }]
    })))
  return (offsetMm: PointMm, snapDistanceMm: number): ReturnType<typeof planBridgeMove> & { command: MoveBridge; snapProblem?: string } => {
    const command: MoveBridge = { type: 'moveBridge', id, offsetMm }
    const near = Math.min(snapDistanceMm, MAX_SNAP_DISTANCE_MM)
    let closest = near, snap: typeof candidates[number] | undefined
    for (const candidate of candidates) {
      const distanceMm = distance(candidate.offsetMm, offsetMm)
      if (near > 0 && distanceMm <= closest) { closest = distanceMm; snap = candidate }
    }
    if (snap) {
      const snapped = { ...command, ...snap }
      try { return { command: snapped, ...planBridgeMove(scene, snapped, graph) } }
      catch (error) { return { command, ...planBridgeMove(scene, command, graph), snapProblem: error instanceof Error ? error.message : String(error) } }
    }
    return { command, ...planBridgeMove(scene, command, graph) }
  }
}
