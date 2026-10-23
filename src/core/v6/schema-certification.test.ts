import { describe, expect, it } from 'vitest'
import { isCertifiedSceneSnapshotV3 } from '../v3/snapshots'
import { compositionFixtureV6 } from './test-fixtures'
import { certifyCompositionContentV6, getCertifiedCompositionContentV6, reviseCompositionContentV6, validateCompositionContentV6, validateCompositionDraftV6 } from './schema'

describe('owned immutable v6 content certificates', () => {
  it('detaches all JSON before certification and reuses only the exact three objects', () => {
    const input = compositionFixtureV6(), certified = certifyCompositionContentV6(input)
    expect(certified).toEqual(input)
    expect(certified.document).not.toBe(input.document)
    expect(isCertifiedSceneSnapshotV3(certified.document)).toBe(true)
    expect(Object.isFrozen(certified.document.props.item.positionMm)).toBe(true)
    expect(Object.isFrozen(certified.historyIdentity.propTokens)).toBe(true)
    expect(Object.isFrozen(certified.appearance.propSources)).toBe(true)
    expect(validateCompositionContentV6({ ...certified })).toBe(certified)
    expect(validateCompositionDraftV6({ ...certified })).toBe(certified)
    expect(certifyCompositionContentV6(certified)).toBe(certified)
    input.document.props.item.positionMm.x += 100
    input.historyIdentity.propTokens.item = 'changed'
    input.appearance.propSources.item = 'missing'
    expect(certified.document.props.item.positionMm.x).not.toBe(input.document.props.item.positionMm.x)
    expect(getCertifiedCompositionContentV6(input)).toBeUndefined()
    expect(() => validateCompositionContentV6(input)).toThrow()
  })

  it('fully validates caller-frozen data and rejects a modified clone or mixed identity', () => {
    const certified = certifyCompositionContentV6(compositionFixtureV6())
    const fake = structuredClone(certified)
    fake.document.props.item.appearance.opacity = .25
    Object.freeze(fake)
    expect(getCertifiedCompositionContentV6(fake)).toBeUndefined()
    expect(() => certifyCompositionContentV6(fake)).toThrow('不一致')
    const invalidGeometry = structuredClone(certified)
    invalidGeometry.document.props.item.positionMm.x = -1_000_000_000
    Object.freeze(invalidGeometry.document)
    expect(() => certifyCompositionContentV6(invalidGeometry)).toThrow()
    const identity = structuredClone(certified.historyIdentity)
    delete identity.propTokens.item
    expect(() => validateCompositionContentV6({ ...certified, historyIdentity: identity })).toThrow('身份')
    const external = structuredClone(certified)
    expect(validateCompositionContentV6(external)).toEqual(certified)
    expect(getCertifiedCompositionContentV6(external)).toBeUndefined()
  })

  it('does not let a certificate hide extra, accessor, symbol or non-enumerable wrapper fields', () => {
    const certified = certifyCompositionContentV6(compositionFixtureV6())
    const wrappers = [
      { ...certified, unknown: true },
      { ...certified, [Symbol('ignored')]: true },
      Object.defineProperty({ ...certified }, 'document', { get: () => certified.document, enumerable: true }),
      Object.defineProperty({ ...certified }, 'appearance', { value: certified.appearance, enumerable: false }),
    ]
    for (const wrapper of wrappers) {
      expect(getCertifiedCompositionContentV6(wrapper)).toBeUndefined()
      expect(() => validateCompositionContentV6(wrapper)).toThrow()
    }
  })

  it('derives only strict revision metadata and validates the independent identity union', () => {
    const current = certifyCompositionContentV6(compositionFixtureV6()), identity = structuredClone(current.historyIdentity)
    identity.propTokens.deleted = 'historic-tombstone'
    const revised = reviseCompositionContentV6(current, current.document.revision + 1, '2026-10-23T00:00:00.000Z', identity)
    expect(revised.document.props).toBe(current.document.props)
    expect(revised.appearance).toBe(current.appearance)
    expect(revised.document.revision).toBe(current.document.revision + 1)
    expect(revised.historyIdentity.propTokens.deleted).toBe('historic-tombstone')
    identity.propTokens.deleted = 'mutated-later'
    expect(revised.historyIdentity.propTokens.deleted).toBe('historic-tombstone')
    expect(validateCompositionContentV6(revised)).toBe(revised)
    expect(() => reviseCompositionContentV6(current, -1, 'invalid')).toThrow()
    delete identity.propTokens.item
    expect(() => reviseCompositionContentV6(current, 10, '2026-10-23T00:00:00.000Z', identity)).toThrow('身份')
  })
})
