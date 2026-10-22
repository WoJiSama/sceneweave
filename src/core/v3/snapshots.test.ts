import { describe, expect, it } from 'vitest'
import { isCertifiedSceneSnapshotV2 } from '../v2/snapshots'
import { toGeometryDocumentV2 } from './geometry-view'
import { applySnapshotCommandsV3 } from './commands'
import { isCertifiedSceneSnapshotV3, reviseSceneSnapshotV3, validateSceneSnapshotV3 } from './snapshots'
import { layerSceneV3, STAMP_V3, symbolPropV3 } from './test-fixtures'
import { hitTestAllV2 } from '../../editor/v2/selection'

describe('v3 runtime-only snapshot certification', () => {
  it('detaches, deep-freezes and certifies only returned validated identities', () => {
    const input = layerSceneV3(), checked = validateSceneSnapshotV3(input)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(isCertifiedSceneSnapshotV3(input)).toBe(false)
    expect(isCertifiedSceneSnapshotV3(checked.document)).toBe(true)
    expect(Object.isFrozen(checked.document.props.item.positionMm)).toBe(true)
    input.props.item.positionMm.x = 6000
    expect(checked.document.props.item.positionMm.x).toBe(4000)
    expect(validateSceneSnapshotV3(checked.document)).toBe(checked)
  })

  it('validates domain views independently, separates effective locks and observes shallow-frozen caller mutations', () => {
    const input = layerSceneV3(), layerId = input.entityLayers.item
    input.userLayers[layerId].editLocked = true
    const checked = validateSceneSnapshotV3(input)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    const actual = toGeometryDocumentV2(checked.document), effective = toGeometryDocumentV2(checked.document, { effectiveLocks: true })
    expect(isCertifiedSceneSnapshotV2(actual)).toBe(true)
    expect(actual.props.item.editLocked).toBe(false); expect(effective.props.item.editLocked).toBe(true)
    expect(actual).not.toHaveProperty('userLayers'); expect(actual.schemaVersion).toBe(2)
    expect(toGeometryDocumentV2(checked.document)).toBe(actual)
    Object.freeze(input)
    const first = toGeometryDocumentV2(input)
    input.props.item.positionMm.x = 7000
    expect(toGeometryDocumentV2(input).props.item.positionMm.x).toBe(7000)
    expect(first.props.item.positionMm.x).toBe(4000)
  })

  it('reuses no-op native candidates and strictly validates revision metadata without mutating history', () => {
    const source = validateSceneSnapshotV3(layerSceneV3())
    if (!source.ok) throw new Error(JSON.stringify(source.errors))
    expect(applySnapshotCommandsV3(source.document, [])).toBe(source.document)
    expect(applySnapshotCommandsV3(source.document, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 4000, y: 4000 } } }])).toBe(source.document)
    const revised = reviseSceneSnapshotV3(source.document, 2, STAMP_V3)
    expect(revised.revision).toBe(2); expect(revised.props).toBe(source.document.props)
    expect(() => reviseSceneSnapshotV3(source.document, Number.MAX_SAFE_INTEGER + 1, STAMP_V3)).toThrow(/安全整数/)
    expect(() => reviseSceneSnapshotV3(source.document, 3, 'bad')).toThrow()
    expect(source.document.revision).toBe(0)
  })

  it('encodes native prop layer order in a separate certified picking view without changing source render orders', () => {
    const input = layerSceneV3(), baseline = input.entityLayers.item
    input.userLayers.top = { id: 'top', floorId: 'blank-floor', name: 'Top', order: 1, editLocked: false }
    input.props.item.renderOrder = 100
    for (const id of ['higher', 'canopy', 'ground']) { input.props[id] = symbolPropV3(id); input.entityLayers[id] = 'top' }
    input.props.canopy.renderLayer = 'canopy'; input.props.ground.renderLayer = 'ground'
    input.props.higher.renderOrder = 0
    const checked = validateSceneSnapshotV3(input)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    const actual = toGeometryDocumentV2(checked.document), ordered = toGeometryDocumentV2(checked.document, { layerOrder: true })
    expect(hitTestAllV2(actual, { x: 4000, y: 4000 }, 0)).toEqual(['canopy', 'item', 'higher', 'ground'])
    expect(hitTestAllV2(ordered, { x: 4000, y: 4000 }, 0)).toEqual(['canopy', 'higher', 'item', 'ground'])
    expect(checked.document.props.item.renderOrder).toBe(100); expect(checked.document.entityLayers.item).toBe(baseline)
    expect(toGeometryDocumentV2(checked.document, { layerOrder: true })).toBe(ordered)
    expect(toGeometryDocumentV2(checked.document, { effectiveLocks: true, layerOrder: true })).not.toBe(ordered)
    expect(isCertifiedSceneSnapshotV2(ordered)).toBe(true)
  })
})
