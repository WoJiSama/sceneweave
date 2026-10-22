import { describe, expect, it } from 'vitest'
import { groupLayerSceneV3 } from '../v3/test-fixtures'
import { createHistoryIdentityV4 } from '../v4/identity'
import { advanceHistoryIdentityV5, createHistoryIdentityV5, mergeHistoryIdentitiesV5, migrateHistoryIdentityV4ToV5, toHistoryIdentityV4, validateHistoryIdentityV5 } from './identity'

describe('C3 persisted group and prop identities', () => {
  it('migrates V4 tokens and lineage unchanged and adds globally distinct fixed group tokens', () => {
    const document = groupLayerSceneV3(), old = createHistoryIdentityV4(document), identity = migrateHistoryIdentityV4ToV5(old, document)
    expect(identity.version).toBe(2)
    expect(identity.lineageId).toBe(old.lineageId)
    expect(identity.rootSceneId).toBe(old.rootSceneId)
    expect(identity.propTokens).toEqual(old.propTokens)
    expect(identity.prefabTokens.group).toBeTruthy()
    expect(Object.values(identity.propTokens)).not.toContain(identity.prefabTokens.group)
    expect(toHistoryIdentityV4(identity, document)).toEqual(old)
  })

  it('requires current group tokens and forbids cross-kind identities and reused tokens', () => {
    const document = groupLayerSceneV3(), identity = createHistoryIdentityV5(document)
    expect(() => validateHistoryIdentityV5({ ...identity, prefabTokens: {} }, document)).toThrow(/组合缺少/)
    expect(() => validateHistoryIdentityV5({ ...identity, prefabTokens: { group: identity.propTokens.item } }, document)).toThrow(/全局唯一/)
    expect(() => validateHistoryIdentityV5({ ...identity, prefabTokens: { ...identity.prefabTokens, item: 'different' } }, document)).toThrow(/不能重用/)
    expect(() => validateHistoryIdentityV5({ ...identity, prefabTokens: { ...identity.prefabTokens, 'blank-floor': 'different' } }, document)).toThrow(/身份冲突/)
  })

  it('retains deleted group tombstones and rejects ordinary group resurrection', () => {
    const document = groupLayerSceneV3(), identity = createHistoryIdentityV5(document), removed = structuredClone(document)
    delete removed.prefabInstances.group; delete removed.entityLayers.group
    const after = advanceHistoryIdentityV5(identity, document, removed)
    expect(after).toEqual(identity)
    expect(() => advanceHistoryIdentityV5(after, removed, document)).toThrow(/不能复用/)
    expect(advanceHistoryIdentityV5(after, removed, document, { allowResurrection: true })).toEqual(identity)
  })

  it('unions isolated branch tombstones and rejects same-ID different-token/lineage conflicts', () => {
    const document = groupLayerSceneV3(), current = createHistoryIdentityV5(document), historic = structuredClone(current)
    current.prefabTokens.laterDeleted = 'later-token'; historic.prefabTokens.oldDeleted = 'old-token'
    const merged = mergeHistoryIdentitiesV5(current, { ...document, sceneId: 'import-copy' }, historic, document)
    expect(merged.prefabTokens).toMatchObject({ laterDeleted: 'later-token', oldDeleted: 'old-token' })
    expect(current.prefabTokens.oldDeleted).toBeUndefined()
    historic.prefabTokens.group = 'conflict'
    expect(() => mergeHistoryIdentitiesV5(current, document, historic, document)).toThrow(/token 冲突/)
    historic.lineageId = 'foreign'
    expect(() => mergeHistoryIdentitiesV5(current, document, historic, document)).toThrow(/lineage/)
  })

  it('applies the shared identity budget to the sum of props and prefabs', () => {
    const document = groupLayerSceneV3(), identity = createHistoryIdentityV5(document)
    const deleted = Object.fromEntries(Array.from({ length: 65533 }, (_, i) => [`deleted-${i}`, `deleted-token-${i}`]))
    expect(() => validateHistoryIdentityV5({ ...identity, prefabTokens: { ...deleted, ...identity.prefabTokens } }, document)).toThrow(/总数超过 65536/)
  })

  it('strictly rejects unknown fields and accessors without reading them', () => {
    const document = groupLayerSceneV3(), identity = createHistoryIdentityV5(document)
    expect(() => validateHistoryIdentityV5({ ...identity, future: true }, document)).toThrow(/无效/)
    let reads = 0; const accessor = { ...identity }
    Object.defineProperty(accessor, 'prefabTokens', { enumerable: true, get: () => { reads++; return identity.prefabTokens } })
    expect(() => validateHistoryIdentityV5(accessor, document)).toThrow(/访问器/)
    expect(reads).toBe(0)
  })
})
