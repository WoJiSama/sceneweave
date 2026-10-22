import { describe, expect, it } from 'vitest'
import { validateSceneSnapshotV2 } from '../../core/v2/snapshots'
import { createBlankDocumentV2 } from './blank-project'
import { summarizeSelectionV2 } from './selection-summary'
import type { PropV2, SceneDocumentV2 } from '../../core/v2/types'

const prop = (id: string, x: number, y: number): PropV2 => ({ id, floorId: 'blank-floor', editLocked: false, definitionRef: null,
  appearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, visualBoundsMm: { x: -50, y: -40, width: 100, height: 80 },
  positionMm: { x, y }, rotationDeg: 0, footprintMm: { width: 100, height: 100 }, footprintOffsetMm: { x: 0, y: 0 },
  blocksMovement: false, blocksSight: false, supportRef: { kind: 'floor', id: 'blank-floor' }, visibility: 'public', renderLayer: 'object', renderOrder: 0,
  shadowClass: 'none', shadowOverride: null })

function scene(): SceneDocumentV2 {
  const value = createBlankDocumentV2({ title: 'summary', widthMm: 10000, heightMm: 8000, preset: 'investigation', sceneId: 'summary', now: '2026-10-21T00:00:00.000Z' })
  value.props.a = prop('a', 1000, 2000); value.props.b = prop('b', 3000, 4000); value.props.b.editLocked = true
  return value
}

describe('selection summary', () => {
  it('returns lightweight types, effective locks, bounds and budget without mutating the document', () => {
    const document = scene(), before = structuredClone(document)
    const result = summarizeSelectionV2(document, ['a', 'b', 'a', 'missing'])
    expect(result).toEqual({ ids: ['a', 'b'], count: 2, typeCounts: { prop: 2 }, effectiveLockedCount: 1,
      boundsMm: { x: 950, y: 1960, width: 2100, height: 2080 }, overCommandBudget: false })
    expect(document).toEqual(before)
  })

  it('normalizes prefab units and reports over-budget selections without checking action reasons', () => {
    const document = scene()
    document.prefabInstances.group = { id: 'group', floorId: 'blank-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'def', version: 1 }, anchorMm: { x: 0, y: 0 }, rotationDeg: 0,
      members: { a: { propId: 'a', overrideFields: [] } } }
    expect(summarizeSelectionV2(document, ['a', 'group'], false)).toMatchObject({ ids: ['group'], count: 1, typeCounts: { prefabInstance: 1 } })
    document.prefabInstances = {}
    for (let i = 0; i < 260; i++) document.props[`p${i}`] = prop(`p${i}`, 500 + i * 10, 600)
    const checked = validateSceneSnapshotV2(document)
    if (!checked.ok) throw new Error('fixture invalid')
    const result = summarizeSelectionV2(checked.document, Object.keys(checked.document.props))
    expect(result.count).toBeGreaterThan(256)
    expect(result.overCommandBudget).toBe(true)
  })
})
