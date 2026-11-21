import { effectiveEditLocked, effectiveLayerLocked } from '../commands/layers.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import { polygonsOverlap, propFootprint, terrainPoints } from '../geometry/geometry.js'
import type { Path, PointMm, SceneDocument } from '../model/scene.js'
import { OperationRejected } from '../validation/operation-rejection.js'
import { PATH_ENDS, type BridgeRoadLink, type MoveBridge, type PathEnd } from './bridge-link-contracts.js'
import { approachEndpoint, BRIDGE_FOLLOW_DISTANCE_MM, compatible, distance, facesRoad, hasLevelApproach,
  offsetPoint, pathEndPosition, samePoint, subtract, withBridgeApproach } from './bridge-link-geometry.js'

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
export function planBridgeMove(scene: SceneDocument, command: MoveBridge) {
  const source = assertBridgeUnlocked(scene, command.id)
  const { bridge } = source
  const translated = (point: PointMm) => offsetPoint(point, command.offsetMm)
  const path = { ...source.path, centerlineMm: source.path.centerlineMm.map(translated) }
  const deck = { ...source.deck, boundaryMm: source.deck.boundaryMm.map(point => ({ ...point, positionMm: translated(point.positionMm) })) }
  const bounds = scene.floors[path.floorId].boundsMm
  if (deck.boundaryMm.some(({ positionMm: p }) => p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height)) {
    throw new Error('桥面越出本楼层范围。')
  }
  if (command.offsetMm.x || command.offsetMm.y) {
    const outline = terrainPoints(deck), members = new Set(Object.values(path.assembly!.members).flatMap(member => member.state === 'placed' ? [member.propId] : []))
    const attached = new Set(Object.values(scene.attachments ?? {}).flatMap(row => row.child.kind === 'prop' ? [row.child.id] : []))
    for (const prop of Object.values(scene.props)) {
      if (prop.floorId !== path.floorId || members.has(prop.id) || attached.has(prop.id) || prop.supportRef.id === deck.id) continue
      const support = prop.supportRef.kind === 'terrainArea' ? scene.terrainAreas[prop.supportRef.id] : undefined
      if (support && support.coveragePriority > deck.coveragePriority) continue
      if (polygonsOverlap(outline, propFootprint(prop))) throw new Error('桥面会覆盖原有物件的承托。请调整放置位置。')
    }
  }
  const spatial = { ...scene, paths: { ...scene.paths, [path.id]: path }, terrainAreas: { ...scene.terrainAreas, [deck.id]: deck } }
  const links: Partial<Record<PathEnd, BridgeRoadLink>> = {}, feedback: BridgeDragLink[] = []
  for (const bridgeEnd of PATH_ENDS) {
    const link = bridge.roadLinks?.[bridgeEnd]
    if (!link) continue
    const current = spatial.paths[link.pathId]
    const from = pathEndPosition(path, bridgeEnd), to = pathEndPosition(current, link.end)
    const moved = withBridgeApproach(path, bridgeEnd, current, link.end, true), point = pathEndPosition(moved, link.end)
    if (samePoint(point, to) || !effectiveEditLocked(scene, current.id) && distance(link.restMm, point) <= BRIDGE_FOLLOW_DISTANCE_MM &&
        facesRoad(path, bridgeEnd, moved, link.end, point, true) && hasLevelApproach(spatial, moved, bridge.elevationMm)) {
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
        || aligned.centerlineMm.length > 256 || !hasLevelApproach(spatial, aligned, bridge.elevationMm)) {
      throw new Error('路端需要与桥头同高、朝向相容且保持整幅承托。')
    }
    links[bridgeEnd] = { pathId, end, restMm }
    feedback.push({ state: 'attach', roadId: pathId, end, from: pathEndPosition(path, bridgeEnd), to: restMm, path: aligned })
  }
  return { path, deck, links, feedback }
}

export function prepareBridgeDrag(scene: SceneDocument, id: string, exclude: ReadonlySet<string> = new Set()) {
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
      try { return { command: snapped, ...planBridgeMove(scene, snapped) } }
      catch (error) { return { command, ...planBridgeMove(scene, command), snapProblem: error instanceof Error ? error.message : String(error) } }
    }
    return { command, ...planBridgeMove(scene, command) }
  }
}
