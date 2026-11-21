import { createPublicVisibility } from '../geometry/visibility.js'
import type { Issue, PointMm, Prop, PropTemplate, SceneDocument } from '../model/scene.js'
import type { VisualBoundary } from '../visual/types.js'
import { visualBase } from '../visual/base.js'
import { PIPE_PORTS } from '../validation/primitives.js'
import { PATH_ENDS, type PathEnd } from './bridge-link-contracts.js'
import { BRIDGE_FOLLOW_DISTANCE_MM, distance, samePoint } from './bridge-link-geometry.js'
import type { SetPipeLink } from './pipe-contracts.js'

type PortRef = NonNullable<SetPipeLink['target']>
export type PipePort = PortRef['port']
export { PIPE_PORTS }
export const PIPE_SNAP_DISTANCE_MM = 1800
export const pipePortLabels = { inlet: '进水口', outlet: '出水口' }
export const pipeEnd = (boundary: VisualBoundary, end: PathEnd) => end === 'start' ? boundary.segments[0].start : boundary.segments.at(-1)!.end
const portKey = ({ propId, port }: PortRef) => JSON.stringify([propId, port])

export function isCoolantPipeSection(parts: readonly { propTemplate: PropTemplate }[]): boolean {
  const source = parts.length === 1 ? parts[0].propTemplate : undefined
  return source?.appearance.kind === 'symbol' && source.appearance.bridgeArt === 'coolantPipe'
    && source.rotationDeg === 0 && !source.positionMm.x && !source.positionMm.y && !source.appearance.mirrorY
}

export function isPipeBoundary(scene: SceneDocument, boundary: VisualBoundary): boolean {
  const section = boundary.fence?.recipe.section
  if (!section || boundary.closed) return false
  if (section.kind === 'profile') return section.profile === 'coolantPipe'
  if (!boundary.fence?.recipe.fit) return false
  if (section.kind === 'prefab') return isCoolantPipeSection(scene.prefabDefinitions[section.ref.id]?.members ?? [])
  const appearance = section.kind === 'prop' ? scene.propDefinitions[section.ref.id]?.defaultAppearance : undefined
  return appearance?.kind === 'symbol' && appearance.bridgeArt === 'coolantPipe' && !appearance.mirrorY
}

export function pipePortWorld(prop: Pick<Prop, 'positionMm' | 'rotationDeg' | 'pipePorts'>, port: PortRef['port']): PointMm | undefined {
  const local = prop.pipePorts?.[port]
  if (!local) return undefined
  const theta = prop.rotationDeg * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta)
  return { x: Math.round(prop.positionMm.x + local.x * cos - local.y * sin) || 0,
    y: Math.round(prop.positionMm.y + local.x * sin + local.y * cos) || 0 }
}

export function resolvePipePort(scene: SceneDocument, boundary: VisualBoundary, target: PortRef, visible = createPublicVisibility(scene)) {
  const prop = Object.hasOwn(scene.props, target.propId) ? scene.props[target.propId] : undefined
  if (!prop || prop.floorId !== boundary.floorId || boundary.visibility === 'public' && !visible.prop(prop)) return undefined
  if (Object.values(boundary.fence?.members ?? {}).some(member => member.state === 'placed' && member.propId === prop.id)) return undefined
  return pipePortWorld(prop, target.port)
}

export function occupiedPipePorts(scene: SceneDocument) {
  const occupied = new Set<string>()
  for (const boundary of Object.values(visualBase(scene)?.boundaries ?? {})) for (const end of PATH_ENDS) {
    const link = boundary.fence?.pipeLinks?.[end]
    if (link) occupied.add(portKey(link))
  }
  return (target: PortRef) => occupied.has(portKey(target))
}

export function linkedPipes(scene: SceneDocument, propId: string): VisualBoundary[] {
  return Object.values(visualBase(scene)?.boundaries ?? {}).filter(row => PATH_ENDS.some(end => row.fence?.pipeLinks?.[end]?.propId === propId))
}

export function nearbyPipePorts(scene: SceneDocument, boundary: VisualBoundary, end: PathEnd): PortRef[] {
  const occupied = occupiedPipePorts(scene), visibility = createPublicVisibility(scene), point = pipeEnd(boundary, end)
  return Object.values(scene.props).filter(prop => prop.pipePorts).flatMap(prop => PIPE_PORTS.flatMap(port => {
    const target = { propId: prop.id, port }, actual = resolvePipePort(scene, boundary, target, visibility)
    return actual && !occupied(target) && distance(actual, point) <= PIPE_SNAP_DISTANCE_MM ? [target] : []
  }))
}

export function inspectPipeLinks(scene: SceneDocument): Issue[] {
  const boundaries = Object.values(visualBase(scene)?.boundaries ?? {}).filter(row => row.fence?.pipeLinks)
  if (!boundaries.length) return []
  const issues: Issue[] = [], occupied = new Set<string>(), visibility = createPublicVisibility(scene)
  for (const row of boundaries) for (const end of PATH_ENDS) {
    const link = row.fence!.pipeLinks![end]
    if (!link) continue
    const point = resolvePipePort(scene, row, link, visibility), key = portKey(link)
    if (!isPipeBoundary(scene, row) || occupied.has(key) || !point || !samePoint(point, pipeEnd(row, end)) || distance(point, link.restMm) > BRIDGE_FOLLOW_DISTANCE_MM) {
      issues.push({ code: 'PIPE_LINK', entityId: row.id, message: `${end === 'start' ? '起点' : '终点'}管口缺失、被占用或超出跟随范围。` })
    }
    occupied.add(key)
  }
  return issues
}
