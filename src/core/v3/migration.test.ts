import { describe, expect, it } from 'vitest'
import { migrateSceneV2 } from './migration'
import { groupLayerSceneV3, layerSourceV2, STAMP_V3 } from './test-fixtures'
import { geometryDocumentForValidationV3 } from './domain'

describe('v2 to v3 complete document copy', () => {
  it('preserves all source semantics, IDs, fixed definitions and render orders', () => {
    const source = layerSourceV2(), before = structuredClone(source)
    source.revision = 37; source.props.item.visibility = 'gm'; source.props.item.editLocked = true; source.props.item.renderOrder = 919
    const snapshot = structuredClone(source), next = migrateSceneV2(source, { sceneId: 'copy', now: STAMP_V3 })
    expect(source).toEqual(snapshot)
    expect(next).toMatchObject({ schemaVersion: 3, sceneId: 'copy', revision: 0, title: source.title, createdAt: STAMP_V3, updatedAt: STAMP_V3 })
    const comparison = geometryDocumentForValidationV3(next)
    expect({ ...comparison, sceneId: source.sceneId, revision: source.revision, createdAt: source.createdAt, updatedAt: source.updatedAt }).toEqual(source)
    expect(Object.values(next.userLayers)).toEqual([{ id: next.entityLayers.item, floorId: 'blank-floor', name: '默认图层', order: 0, editLocked: false }])
    next.props.item.positionMm.x = 5000
    expect(source.props.item.positionMm).toEqual(before.props.item.positionMm)
  })

  it('preserves removed group keys and manual overrides as complete records', () => {
    const next = groupLayerSceneV3()
    expect(next.prefabInstances.group.members.removed).toEqual({ propId: null, overrideFields: ['rotationDeg'] })
    expect(next.prefabInstances.group.members.left.overrideFields).toEqual(['positionMm'])
    expect(next.entityLayers.group).toBe(next.entityLayers.left)
    expect(next.entityLayers).not.toHaveProperty('removed')
  })

  it('rejects same identity, unsupported source versions and invalid options', () => {
    const source = layerSourceV2()
    expect(() => migrateSceneV2(source, { sceneId: source.sceneId })).toThrow(/独立/)
    expect(() => migrateSceneV2({ ...source, schemaVersion: 3 })).toThrow(/迁移失败/)
    expect(() => migrateSceneV2(source, { sceneId: '__proto__' })).toThrow(/校验失败/)
    expect(() => migrateSceneV2(source, { now: 'bad-date' })).toThrow(/校验失败/)
  })
})
