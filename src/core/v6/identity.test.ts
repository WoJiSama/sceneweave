import { describe, expect, it } from 'vitest'
import { scatterLayerSceneV3 } from '../v3/test-fixtures'
import { createHistoryIdentityV5 } from '../v5/identity'
import { reconcileTerrainBoundaryV3 } from '../v3/outdoor'
import { advanceHistoryIdentityV6, assertOutdoorContinuityV6, createHistoryIdentityV6, mergeIdentityRecordsV6, migrateHistoryIdentityV5ToV6, validateHistoryIdentityV6 } from './identity'

describe('C4 durable outdoor birth and topology identities', () => {
  it('migrates prop/prefab births and lineage unchanged and assigns globally distinct outdoor identities', () => {
    const document = scatterLayerSceneV3(), previous = createHistoryIdentityV5(document), result = migrateHistoryIdentityV5ToV6(previous, document)
    expect(result).toMatchObject({ version: 3, lineageId: previous.lineageId, rootSceneId: previous.rootSceneId, propTokens: previous.propTokens, prefabTokens: previous.prefabTokens })
    expect(result.outdoorTokens.domain.kind).toBe('terrainArea')
    expect(result.outdoorTokens['domain-point-0'].kind).toBe('terrainPoint')
    expect(result.outdoorTokens['domain-segment-0'].kind).toBe('terrainSegment')
    expect(result.outdoorTokens.scatter.kind).toBe('scatterGroup')
    expect(() => validateHistoryIdentityV6({ ...result, version: 2 }, document)).toThrow(/字段/)
  })

  it('keeps geometry edits continuous across serialization and permanently invalidates topology on edit and undo', () => {
    const before = scatterLayerSceneV3(), identity = createHistoryIdentityV6(before), moved = structuredClone(before)
    moved.terrainAreas.domain.boundaryMm[0].positionMm.x += 100
    const geometry = advanceHistoryIdentityV6(identity, before, moved)
    expect(geometry.outdoorTokens).toEqual(identity.outdoorTokens)
    assertOutdoorContinuityV6(JSON.parse(JSON.stringify(geometry)), identity, ['domain', 'domain-point-0', 'domain-segment-0'])
    const changed = structuredClone(moved)
    changed.terrainAreas.domain.boundaryMm[0].segmentId = 'fresh-segment'
    const topology = advanceHistoryIdentityV6(geometry, moved, changed)
    expect(topology.outdoorTokens.domain.token).toBe(identity.outdoorTokens.domain.token)
    expect(topology.outdoorTokens.domain.topologyToken).not.toBe(identity.outdoorTokens.domain.topologyToken)
    expect(() => assertOutdoorContinuityV6(topology, identity, ['domain'])).toThrow(/连续性/)
    const undo = advanceHistoryIdentityV6(topology, changed, before, { allowResurrection: true })
    expect(undo.outdoorTokens.domain.topologyHash).toBe(identity.outdoorTokens.domain.topologyHash)
    expect(() => assertOutdoorContinuityV6(undo, identity, ['domain'])).toThrow(/连续性/)
    expect(undo.outdoorTokens['fresh-segment']).toEqual(topology.outdoorTokens['fresh-segment'])
  })

  it.each([false, true])('retains directed topology after coordinate rows are cyclically reordered (reversed input: %s)', reverse => {
    const before = scatterLayerSceneV3(), identity = createHistoryIdentityV6(before), next = structuredClone(before)
    const ring = before.terrainAreas.domain.boundaryMm
    let coordinates = [...ring.slice(2), ...ring.slice(0, 2)].map(point => point.positionMm)
    if (reverse) coordinates = coordinates.reverse()
    next.terrainAreas.domain.boundaryMm = reconcileTerrainBoundaryV3(ring, coordinates)
    const actual = advanceHistoryIdentityV6(identity, before, next)
    expect(actual.outdoorTokens).toEqual(identity.outdoorTokens)
    expect(() => assertOutdoorContinuityV6(actual, identity, ring.flatMap(point => [point.id, point.segmentId]).concat('domain'))).not.toThrow()
  })

  it('invalidates continuity when an inserted coordinate splits a real segment even after removing it again', () => {
    const before = scatterLayerSceneV3(), identity = createHistoryIdentityV6(before), inserted = structuredClone(before)
    const ring = before.terrainAreas.domain.boundaryMm, [start, end] = ring
    const midpoint = { x: (start.positionMm.x + end.positionMm.x) / 2, y: (start.positionMm.y + end.positionMm.y) / 2 }
    inserted.terrainAreas.domain.boundaryMm = reconcileTerrainBoundaryV3(ring, [start.positionMm, midpoint, ...ring.slice(1).map(point => point.positionMm)])
    const changed = advanceHistoryIdentityV6(identity, before, inserted)
    expect(changed.outdoorTokens.domain.token).toBe(identity.outdoorTokens.domain.token)
    expect(() => assertOutdoorContinuityV6(changed, identity, ['domain'])).toThrow(/连续性/)
    const removed = structuredClone(inserted)
    removed.terrainAreas.domain.boundaryMm = reconcileTerrainBoundaryV3(inserted.terrainAreas.domain.boundaryMm, ring.map(point => point.positionMm))
    const final = advanceHistoryIdentityV6(changed, inserted, removed)
    expect(() => assertOutdoorContinuityV6(final, identity, ['domain'])).toThrow(/连续性/)
    expect(final.outdoorTokens.domain.topologyToken).not.toBe(changed.outdoorTokens.domain.topologyToken)
  })

  it('retains deleted outdoor tombstones and forbids ordinary reuse or cross-kind collisions', () => {
    const before = scatterLayerSceneV3(), identity = createHistoryIdentityV6(before), removed = structuredClone(before)
    delete removed.scatterGroups.scatter; delete removed.entityLayers.scatter
    const after = advanceHistoryIdentityV6(identity, before, removed)
    expect(after.outdoorTokens.scatter).toEqual(identity.outdoorTokens.scatter)
    expect(() => advanceHistoryIdentityV6(after, removed, before)).toThrow(/不能复用/)
    const resurrected = advanceHistoryIdentityV6(after, removed, before, { allowResurrection: true })
    expect(resurrected.outdoorTokens.scatter.token).toBe(identity.outdoorTokens.scatter.token)
    expect(resurrected.outdoorTokens.scatter.topologyToken).not.toBe(identity.outdoorTokens.scatter.topologyToken)
    const alias = structuredClone(identity); alias.propTokens.domain = 'distinct'
    expect(() => validateHistoryIdentityV6(alias, before)).toThrow(/ID重复/)
    const tokenAlias = structuredClone(identity); tokenAlias.outdoorTokens.domain.topologyToken = tokenAlias.propTokens.item
    expect(() => validateHistoryIdentityV6(tokenAlias, before)).toThrow(/全局唯一/)
  })

  it('merges branch tombstones while retaining current topology and refusing birth conflicts', () => {
    const document = scatterLayerSceneV3(), identity = createHistoryIdentityV6(document), branch = structuredClone(identity)
    branch.outdoorTokens.domain.topologyToken = 'branch-topology'
    branch.propTokens['old-deleted'] = 'old-birth'
    const result = mergeIdentityRecordsV6(identity, [branch])
    expect(result.outdoorTokens.domain).toEqual(identity.outdoorTokens.domain)
    expect(result.propTokens['old-deleted']).toBe('old-birth')
    expect(identity.propTokens['old-deleted']).toBeUndefined()
    branch.outdoorTokens.domain.token = 'different-birth'
    expect(() => mergeIdentityRecordsV6(identity, [branch])).toThrow(/出生身份冲突/)
  })

  it('enforces the shared 65536 identity cap and rejects accessors without evaluating them', () => {
    const document = scatterLayerSceneV3(), identity = createHistoryIdentityV6(document)
    const identities = Object.keys(identity.propTokens).length + Object.keys(identity.prefabTokens).length + Object.keys(identity.outdoorTokens).length
    identity.prefabTokens = Object.fromEntries(Array.from({ length: 65537 - identities }, (_, i) => [`deleted-${i}`, `birth-${i}`]))
    expect(() => validateHistoryIdentityV6(identity, document)).toThrow(/65536/)
    let reads = 0; const accessor = { ...identity }
    Object.defineProperty(accessor, 'outdoorTokens', { enumerable: true, get: () => { reads++; return identity.outdoorTokens } })
    expect(() => validateHistoryIdentityV6(accessor, document)).toThrow(/访问器/)
    expect(reads).toBe(0)
  })
})
