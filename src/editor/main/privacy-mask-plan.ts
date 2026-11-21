import type { AppearanceGraph } from '../../shared/model/appearance.js'
import type { SceneDocument } from '../../shared/model/scene.js'
import type { AnnotationCommand } from '../../shared/commands/annotations.js'
import { getPlayerCoverageDiagnostics, pointsBounds, type PlayerCoverageIssue } from '../../shared/projection/projection.js'
import { missingCoverageBounds } from '../../shared/projection/privacy-coverage.js'
import { privacyMaskRectangles } from './privacy-mask-rectangles.js'

type UpsertMask = Extract<AnnotationCommand, { type: 'upsertManualMask' }>

export function coverageMaskCommands(issues: readonly PlayerCoverageIssue[], floorId: string, layerId: string | undefined, nextId: () => string, reuseId?: string, preservePublicRooms = false): UpsertMask[] {
  if (issues.some(issue => issue.floorId !== floorId)) throw new Error('请在各自楼层分别补齐遮罩。')
  const needed = privacyMaskRectangles(issues.flatMap(issue => issue.missingBoundsMm))
    .sort((a, b) => b.width * b.height - a.width * a.height || a.x - b.x || a.y - b.y)
  return needed.map((boundsMm, index) => ({
    type: 'upsertManualMask', id: index === 0 && reuseId !== undefined ? reuseId : nextId(), floorId, boundsMm,
    ...(layerId === undefined ? {} : { layerId }),
    ...(preservePublicRooms ? { preservePublicRooms: true } : {}),
  }))
}

export function planMaskRefit(scene: SceneDocument, appearance: AppearanceGraph | undefined, maskId: string, nextId: () => string) {
  const mask = scene.regions[maskId]
  if (mask?.kind !== 'manualMask') throw new Error('请选择固定遮罩。')
  const { floorId } = mask
  if (getPlayerCoverageDiagnostics(scene, appearance, { floorId }).length) throw new Error('请先补齐此楼层现有的保密缺口。')
  // Exclude this mask from the coverage calculation while keeping its note anchors resolvable.
  const { preservePublicRooms: _mode, ...plainMask } = mask
  const withoutMask = { ...scene, regions: { ...scene.regions, [maskId]: { ...plainMask, kind: 'terrain' as const, visibility: 'public' as const } } }
  const issues = getPlayerCoverageDiagnostics(withoutMask, appearance, { floorId })
  const commands = coverageMaskCommands(issues, floorId, scene.entityLayers[maskId], nextId, maskId, mask.preservePublicRooms)
  if (!commands.length) throw new Error('其他遮罩已覆盖此处必要范围。可以使用「预览删除遮罩」检查移除后的画面。')
  const original = pointsBounds(mask.boundaryMm)
  if (!missingCoverageBounds(original, commands.map(command => command.boundsMm)).length) throw new Error('这块遮罩已经收紧到当前所需的范围。')
  return { commands, floorId }
}
