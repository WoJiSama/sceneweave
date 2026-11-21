import type { SceneCommand } from '../../shared/commands/commands.js'
import type { BoundsMm, PointMm, SceneDocument } from '../../shared/model/scene.js'
import type { AppearanceGraph } from '../../shared/model/appearance.js'
import { pointsBounds, type PlayerCoverageIssue } from '../../shared/projection/projection.js'
import { roomPoints } from '../../shared/geometry/geometry.js'
import { createPublicVisibility } from '../../shared/geometry/visibility.js'
import { propPaintPolygon, propPresentation } from '../../shared/appearance/presentation.js'
import { resolveFloorOutput } from '../../shared/floors/output.js'
import { coverageMaskCommands } from './privacy-mask-plan.js'
import polygonClipping from 'polygon-clipping'
import { playerMaskContains } from '../../shared/projection/player-mask.js'

export interface RoomPrivacyPublicImpact {
  kind: 'room' | 'prop'
  id: string
  label: string
  coveredBoundsMm: BoundsMm[]
  fullyHidden: boolean
}

/** Session-only authoring evidence; never serialized into the project. */
export interface BuildingPrivacyRequest {
  floorId: string
  coverageIssues?: readonly PlayerCoverageIssue[]
}
export interface BuildingPrivacyReview {
  floorId: string
  coverageIssues: readonly PlayerCoverageIssue[]
  publicImpacts: readonly RoomPrivacyPublicImpact[]
}

export type BuildingPreviewRequest = (commands: SceneCommand[], description: string, privacy?: BuildingPrivacyRequest, onFailure?: (error: unknown) => void) => void

function intersection(a: BoundsMm, b: BoundsMm): BoundsMm | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}
const corners = ({ x, y, width, height }: BoundsMm): PointMm[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
const polygon = (points: PointMm[]) => [points.map(p => [p.x, p.y] as [number, number])]

export function inspectRoomPrivacyPublicImpacts(scene: SceneDocument, appearance: AppearanceGraph | undefined, floorId: string, masks: readonly BoundsMm[], preservePublicRooms: readonly boolean[] = []): RoomPrivacyPublicImpact[] {
  if (!masks.length) return []
  const output = resolveFloorOutput(scene, floorId).boundsMm
  const visibility = createPublicVisibility(scene), impacts: RoomPrivacyPublicImpact[] = []
  const publicRooms = Object.values(scene.rooms).filter(room => room.floorId === floorId && visibility.room(room.id)).map(room => roomPoints(scene, room))
  const visibleMasks = masks.flatMap((mask, index) => {
    const box = intersection(mask, output)
    if (!box) return []
    const shape = polygon(corners(box))
    return [{ shape: preservePublicRooms[index] && publicRooms.length ? polygonClipping.difference(shape, ...publicRooms.map(polygon)) : [shape] }]
  })
  const covered = (points: PointMm[]) => {
    return visibleMasks.flatMap(mask => polygonClipping.intersection(polygon(points), mask.shape).flatMap(part => {
      const points = part.flat().map(([x, y]) => ({ x, y }))
      return points.length ? [pointsBounds(points)] : []
    }))
  }
  for (const room of Object.values(scene.rooms)) {
    if (room.floorId !== floorId || !visibility.room(room.id)) continue
    const coveredBoundsMm = covered(roomPoints(scene, room))
    if (coveredBoundsMm.length) impacts.push({ kind: 'room', id: room.id, label: room.purpose || room.id, coveredBoundsMm, fullyHidden: false })
  }
  for (const prop of Object.values(scene.props)) {
    if (prop.floorId !== floorId || !visibility.prop(prop)) continue
    const polygon = propPaintPolygon(prop, appearance ? propPresentation(appearance, prop.id) : undefined)
    const fullyHidden = playerMaskContains(prop.positionMm, masks.map(corners), masks.map((_, index) => preservePublicRooms[index] ? publicRooms : []))
    const coveredBoundsMm = fullyHidden ? [intersection(output, pointsBounds(polygon))].flatMap(box => box ?? []) : covered(polygon)
    if (coveredBoundsMm.length) impacts.push({ kind: 'prop', id: prop.id, label: prop.definitionRef ? scene.propDefinitions[prop.definitionRef.id]?.name || prop.id : prop.id, coveredBoundsMm, fullyHidden })
  }
  return impacts
}

/** Recompute review evidence from the validated candidate. */
export function reviewBuildingPrivacy(before: SceneDocument, after: SceneDocument, appearance: AppearanceGraph, commands: readonly SceneCommand[], requested?: BuildingPrivacyRequest): BuildingPrivacyReview | undefined {
  const changedMasks = commands.filter(command => command.type === 'upsertManualMask' || command.type === 'deleteManualMask')
  const floors = new Set(changedMasks.map(command => command.type === 'upsertManualMask' ? command.floorId : before.regions[command.id]?.floorId).filter(Boolean))
  if (requested) floors.add(requested.floorId)
  if (!floors.size) return undefined
  if (floors.size !== 1) throw new Error('请按楼层分别预览固定遮罩，并核对各层玩家图。')
  const floorId = [...floors][0]!
  const ids = new Set(changedMasks.flatMap(command => command.type === 'upsertManualMask' ? [command.id] : []))
  const masks = [...ids].map(id => after.regions[id]).filter(mask => mask?.kind === 'manualMask' && mask.floorId === floorId)
  const publicImpacts = inspectRoomPrivacyPublicImpacts(after, appearance, floorId, masks.map(mask => pointsBounds(mask.boundaryMm)), masks.map(mask => mask.preservePublicRooms ?? false))
  return { floorId, coverageIssues: requested?.coverageIssues ?? [], publicImpacts }
}

/** Repair keeps the rejected edits in the same atomic proposal. */
export function coverageRepairCommands(scene: SceneDocument, commands: readonly SceneCommand[], issues: readonly PlayerCoverageIssue[], floorId: string, layerId: string, nextMaskId: () => string): SceneCommand[] {
  if (scene.userLayers[layerId]?.floorId !== floorId || scene.userLayers[layerId].editLocked) throw new Error('请先选择此楼层未锁定的绘制图层。')
  const masks = coverageMaskCommands(issues, floorId, layerId, nextMaskId, undefined, true)
  if (!masks.length) throw new Error('当前没有需要补齐的遮罩。')
  return [...commands, ...masks]
}
