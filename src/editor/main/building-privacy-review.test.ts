import { describe, expect, it } from 'vitest'
import { createVisualBlankDocument } from '../../platform/browser/content/visual-samples.js'
import { applyCommands, type SceneCommand } from '../../shared/commands/commands.js'
import { createAppearanceGraph } from '../../shared/appearance/graph.js'
import type { PlayerCoverageIssue } from '../../shared/projection/projection.js'
import { coverageRepairCommands, reviewBuildingPrivacy } from './building-privacy-review.js'
import { planMaskRefit } from './privacy-mask-plan.js'
import { getPlayerCoverageDiagnostics, pointsBounds } from '../../shared/projection/projection.js'

describe('privacy repair proposal', () => {
  const issue: PlayerCoverageIssue = { entityKind: 'room', entityId: 'secret', floorId: 'visual-floor', requiredBoundsMm: { x: -1.2, y: 3.4, width: 20.1, height: 30.2 },
    missingBoundsMm: [{ x: -1.2, y: 3.4, width: 2.1, height: 30.2 }, { x: 11.2, y: 14.3, width: 7.7, height: 19.3 }] }
  const scene = () => createVisualBlankDocument({ title: '修复候选', widthMm: 18000, heightMm: 12000, preset: 'narrative' })
  it('keeps the rejected commands and rounds each fractional gap separately to world millimetres', () => {
    const source = scene(), before = JSON.stringify(source)
    const commands: SceneCommand[] = [{ type: 'deleteManualMask', id: 'original-mask' }]
    let id = 0
    const result = coverageRepairCommands(source, commands, [issue], issue.floorId, 'visual-layer-ground', () => `repair-${++id}`)
    expect(result).toEqual([...commands,
      { type: 'upsertManualMask', id: 'repair-1', floorId: issue.floorId, layerId: 'visual-layer-ground', boundsMm: { x: 11, y: 14, width: 8, height: 20 }, preservePublicRooms: true },
      { type: 'upsertManualMask', id: 'repair-2', floorId: issue.floorId, layerId: 'visual-layer-ground', boundsMm: { x: -2, y: 3, width: 3, height: 31 }, preservePublicRooms: true },
    ])
    expect(commands).toEqual([{ type: 'deleteManualMask', id: 'original-mask' }])
    expect(JSON.stringify(source)).toBe(before)
  })
  it('refuses no issue, a different floor and a locked or unrelated layer', () => {
    const source = scene(), repair = (issues: PlayerCoverageIssue[], layer = 'visual-layer-ground') => coverageRepairCommands(source, [], issues, issue.floorId, layer, () => 'repair-mask')
    expect(() => repair([])).toThrow()
    expect(() => repair([{ ...issue, floorId: 'other-floor' }])).toThrow(/楼层/)
    expect(() => repair([issue], 'missing-layer')).toThrow(/图层/)
    source.userLayers['visual-layer-ground'].editLocked = true
    expect(() => repair([issue])).toThrow(/图层/)
  })
  it('reports actual separate overlaps with public content from the candidate', () => {
    let sequence = 0
    const context = { clock: { now: () => '2026-11-18T00:00:00.000Z' }, ids: { nextId: () => `review-${++sequence}` } }
    const before = applyCommands(scene(), [{ type: 'createRoom', id: 'public', floorId: 'visual-floor', layerId: 'visual-layer-ground',
      boundaryMm: [{ x: 3000, y: 3000 }, { x: 7000, y: 3000 }, { x: 7000, y: 7000 }, { x: 3000, y: 7000 }], purpose: '公开大厅', thicknessMm: 200 }], context)
    const command: SceneCommand = { type: 'upsertManualMask', id: 'candidate-mask', floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 5000, y: 5000, width: 4000, height: 4000 } }
    const second = { ...command, id: 'second-mask', boundsMm: { x: 3000, y: 3000, width: 400, height: 500 } }
    const after = applyCommands(before, [command, second], context)
    const result = reviewBuildingPrivacy(before, after, createAppearanceGraph(after), [command, second], { floorId: 'visual-floor' })!
    expect(result.publicImpacts).toEqual([{ kind: 'room', id: 'public', label: '公开大厅', fullyHidden: false,
      coveredBoundsMm: [{ x: 5000, y: 5000, width: 2000, height: 2000 }, second.boundsMm] }])
    expect(reviewBuildingPrivacy(before, before, createAppearanceGraph(before), [])).toBeUndefined()
    expect(() => reviewBuildingPrivacy(before, after, createAppearanceGraph(after), [command, { ...command, floorId: 'other-floor' }])).toThrow(/按楼层/)
  })
  it('refits a stored broad mask in place and preserves the complete coverage check', () => {
    let sequence = 0
    const context = { clock: { now: () => '2026-11-18T00:00:00.000Z' }, ids: { nextId: () => `refit-${++sequence}` } }
    const floorId = 'visual-floor', layerId = 'visual-layer-ground'
    const before = applyCommands(scene(), [
      { type: 'createRoom', id: 'public', floorId, layerId, purpose: '公开大厅', thicknessMm: 200,
        boundaryMm: [{ x: 3000, y: 3000 }, { x: 7000, y: 3000 }, { x: 7000, y: 7000 }, { x: 3000, y: 7000 }] },
      { type: 'createRoom', id: 'secret', floorId, layerId, purpose: '密室', thicknessMm: 200,
        boundaryMm: [{ x: 7000, y: 3000 }, { x: 11000, y: 3000 }, { x: 11000, y: 7000 }, { x: 7000, y: 7000 }] },
      { type: 'upsertManualMask', id: 'old', floorId, layerId, boundsMm: { x: 6000, y: 2000, width: 6000, height: 6000 } },
      { type: 'updateRoom', id: 'secret', changes: { visibility: 'gm' } },
    ], context)
    const original = pointsBounds(before.regions.old.boundaryMm)
    const { commands } = planMaskRefit(before, undefined, 'old', context.ids.nextId)
    const after = applyCommands(before, commands, context)
    expect(commands[0].id).toBe('old')
    const refittedArea = commands.reduce((area, command) => area + command.boundsMm.width * command.boundsMm.height, 0)
    expect(refittedArea).toBeLessThan(original.width * original.height)
    expect(pointsBounds(before.regions.old.boundaryMm)).toEqual(original)
    expect(after.rooms).toEqual(before.rooms)
    expect(getPlayerCoverageDiagnostics(after)).toEqual([])
  })
})
