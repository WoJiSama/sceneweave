import { describe, expect, it } from 'vitest'
import { layerSceneV3, symbolPropV3 } from '../v3/test-fixtures'
import type { SceneDocumentV3 } from '../v3/types'
import { advanceHistoryIdentityV4, createHistoryIdentityV4, mergeHistoryIdentitiesV4, validateHistoryIdentityV4 } from './identity'
import { HISTORY_LIMITS_V4, type HistoryIdentityV4 } from './types'

function identityFor(scene: SceneDocumentV3): HistoryIdentityV4 {
  return { version: 1, lineageId: 'test-lineage', rootSceneId: scene.sceneId,
    propTokens: Object.fromEntries(Object.keys(scene.props).map(id => [id, `token:${id}`])) }
}
function withoutItem(scene: SceneDocumentV3): SceneDocumentV3 {
  const next = structuredClone(scene)
  delete next.props.item; delete next.entityLayers.item
  return next
}

describe('v4 persisted prop identity', () => {
  it('allocates a distinct token for every live prop and retains a separate lineage root', () => {
    const scene = layerSceneV3(), layerId = scene.entityLayers.item
    scene.props.other = symbolPropV3('other', 8000, 8000); scene.entityLayers.other = layerId
    const before = structuredClone(scene), identity = createHistoryIdentityV4(scene)
    expect(identity.version).toBe(1)
    expect(identity.rootSceneId).toBe(scene.sceneId)
    expect(identity.lineageId).toBeTruthy()
    expect(Object.keys(identity.propTokens).sort()).toEqual(['item', 'other'])
    expect(new Set(Object.values(identity.propTokens)).size).toBe(2)
    expect(scene).toEqual(before)
  })

  it('strictly clones the supplied identity and requires a token for every live prop', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    const validated = validateHistoryIdentityV4(identity, scene)
    expect(validated).toEqual(identity); expect(validated).not.toBe(identity)
    identity.propTokens.item = 'mutated-after-validation'
    expect(validated.propTokens.item).toBe('token:item')
    expect(() => validateHistoryIdentityV4({ ...identity, propTokens: {} }, scene)).toThrow(/缺少.*token/)
  })

  it('rejects unknown envelope semantics, invalid values and reserved keys', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    for (const invalid of [
      { ...identity, future: true }, { ...identity, version: 2 }, { ...identity, lineageId: '' },
      { ...identity, rootSceneId: '__proto__' }, { ...identity, propTokens: { item: '' } },
      { ...identity, propTokens: { item: 'x'.repeat(257) } }, { ...identity, propTokens: { item: { token: 'x' } } },
      JSON.parse('{"version":1,"lineageId":"lineage","rootSceneId":"root","propTokens":{"item":"item-token","__proto__":"bad"}}'),
    ]) expect(() => validateHistoryIdentityV4(invalid, scene)).toThrow()
  })

  it('rejects accessors, hidden and Symbol fields without reading an accessor', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    let reads = 0
    const accessor = { ...identity }
    Object.defineProperty(accessor, 'propTokens', { enumerable: true, get: () => { reads++; return identity.propTokens } })
    expect(() => validateHistoryIdentityV4(accessor, scene)).toThrow(/访问器/)
    expect(reads).toBe(0)
    const hidden = { ...identity }
    Object.defineProperty(hidden, 'extra', { enumerable: false, value: 1 })
    expect(() => validateHistoryIdentityV4(hidden, scene)).toThrow(/隐藏字段/)
    const symbol = { ...identity, [Symbol('hidden')]: 'value' }
    expect(() => validateHistoryIdentityV4(symbol, scene)).toThrow(/Symbol/)
    expect(() => validateHistoryIdentityV4(Object.assign(Object.create({ ancestor: true }), identity), scene)).toThrow(/普通 JSON/)
  })

  it('bounds allocated identities before accepting a record and forbids token reassignment', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    expect(() => validateHistoryIdentityV4({ ...identity, propTokens: { ...identity.propTokens, deleted: 'token:item' } }, scene)).toThrow(/全局唯一/)
    const allocated = Object.fromEntries(Array.from({ length: HISTORY_LIMITS_V4.identityProps }, (_, i) => [`deleted-${i}`, `deleted-token-${i}`]))
    expect(() => validateHistoryIdentityV4({ ...identity, propTokens: { ...allocated, item: 'token:item' } }, scene)).toThrow(/65536/)
  })

  it('forbids allocated prop IDs from colliding with current geometry, definitions or layers', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    for (const occupied of ['blank-floor', scene.sceneId, scene.entityLayers.item, Object.keys(scene.propDefinitions)[0]]) {
      expect(() => validateHistoryIdentityV4({ ...identity, propTokens: { ...identity.propTokens, [occupied]: `token:${occupied}` } }, scene)).toThrow(/身份冲突/)
    }
  })

  it('validates full scenes instead of trusting a frozen caller object', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    const invalid = Object.freeze({ ...scene, schemaVersion: 4 })
    expect(() => validateHistoryIdentityV4(identity, invalid as unknown as SceneDocumentV3)).toThrow(/场景无效/)
  })

  it('preserves deleted tombstones and allocates new props without modifying existing tokens', () => {
    const previous = layerSceneV3(), identity = identityFor(previous), next = withoutItem(previous)
    next.props.fresh = symbolPropV3('fresh', 8000, 8000); next.entityLayers.fresh = previous.entityLayers.item
    const advanced = advanceHistoryIdentityV4(identity, previous, next)
    expect(advanced.propTokens.item).toBe('token:item')
    expect(advanced.propTokens.fresh).toBeTruthy()
    expect(advanced.propTokens.fresh).not.toBe('token:item')
    expect(identity.propTokens).toEqual({ item: 'token:item' })
    expect(advanced.lineageId).toBe(identity.lineageId); expect(advanced.rootSceneId).toBe(identity.rootSceneId)
  })

  it('requires an explicit internal resurrection and keeps its original token', () => {
    const live = layerSceneV3(), deleted = withoutItem(live), identity = identityFor(live)
    expect(() => advanceHistoryIdentityV4(identity, deleted, live)).toThrow(/普通编辑不能复用/)
    expect(advanceHistoryIdentityV4(identity, deleted, live, { allowResurrection: true }).propTokens.item).toBe('token:item')
    const otherScene = { ...live, sceneId: 'another-scene' }
    expect(() => advanceHistoryIdentityV4(identity, live, otherScene)).toThrow(/同一场景/)
  })

  it('retains tombstone reservations when the next document uses other entity kinds', () => {
    const live = layerSceneV3(), deleted = withoutItem(live), identity = identityFor(live), next = structuredClone(deleted)
    next.regions.item = { id: 'item', floorId: 'blank-floor', editLocked: false, kind: 'terrain', visibility: 'public',
      boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }],
      blocksMovement: false, movementCostMultiplier: 1 }
    next.entityLayers.item = live.entityLayers.item
    expect(() => advanceHistoryIdentityV4(identity, deleted, next)).toThrow(/身份冲突/)
  })

  it('unions branch tombstones while accepting isolated scene copies from the same lineage', () => {
    const scene = layerSceneV3(), copy = { ...scene, sceneId: 'isolated-import' }, current = identityFor(scene)
    current.propTokens.currentDeleted = 'current-deleted-token'
    const historic = { ...identityFor(scene), propTokens: { item: 'token:item', oldDeleted: 'historic-deleted-token' } }
    const merged = mergeHistoryIdentitiesV4(current, copy, historic, scene)
    expect(merged.propTokens).toEqual({ item: 'token:item', currentDeleted: 'current-deleted-token', oldDeleted: 'historic-deleted-token' })
    expect(merged.rootSceneId).toBe(scene.sceneId)
    expect(current.propTokens).not.toHaveProperty('oldDeleted')
  })

  it('refuses different lineage/root and same-ID or cross-ID token conflicts', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    for (const historic of [
      { ...identity, lineageId: 'unrelated' }, { ...identity, rootSceneId: 'another-root' },
      { ...identity, propTokens: { item: 'different-item-token' } },
      { ...identity, propTokens: { item: 'token:item', deleted: 'token:item' } },
    ]) expect(() => mergeHistoryIdentitiesV4(identity, scene, historic, scene)).toThrow()
    const current = { ...identity, propTokens: { item: 'token:item', currentDeleted: 'branch-token' } }
    const historic = { ...identity, propTokens: { item: 'token:item', historicDeleted: 'branch-token' } }
    expect(() => mergeHistoryIdentitiesV4(current, scene, historic, scene)).toThrow(/全局唯一/)
  })

  it('treats legal inherited-looking IDs as own tombstones', () => {
    const scene = layerSceneV3(), identity = identityFor(scene)
    const historic = { ...identity, propTokens: { ...identity.propTokens, constructor: 'constructor-token', toString: 'to-string-token' } }
    const merged = mergeHistoryIdentitiesV4(identity, scene, historic, scene)
    expect(Object.hasOwn(merged.propTokens, 'constructor')).toBe(true)
    expect(Object.hasOwn(merged.propTokens, 'toString')).toBe(true)
    expect(merged.propTokens.constructor).toBe('constructor-token')
    expect(merged.propTokens.toString).toBe('to-string-token')
    expect(() => mergeHistoryIdentitiesV4(merged, scene, { ...historic, propTokens: { ...historic.propTokens, constructor: 'reused-token' } }, scene)).toThrow(/token 冲突/)
  })
})
