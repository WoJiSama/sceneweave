import { describe, expect, it } from 'vitest'
import { normalizeCatalogText, validateCatalogOrganization } from './organization'

describe('catalog personal organization', () => {
  it('preserves display labels while normalizing comparisons and rejecting ambiguous/internal tags', () => {
    expect(normalizeCatalogText('  ＢＬＵＥ   Chair ')).toBe('blue chair')
    expect(validateCatalogOrganization({ tags: [' ＢＬＵＥ Chair '], colors: ['蓝', '灰'], favorite: true }).tags).toEqual([' ＢＬＵＥ Chair '])
    expect(() => validateCatalogOrganization({ tags: ['Chair', ' ＣＨＡＩＲ '], colors: [], favorite: false })).toThrow('重复')
    expect(() => validateCatalogOrganization({ tags: ['ＳＣＥＮＥＷＥＡＶＥ:retained'], colors: [], favorite: false })).toThrow('保留')
    expect(() => validateCatalogOrganization({ tags: ['chair\n'], colors: [], favorite: false })).toThrow('控制')
    expect(() => validateCatalogOrganization({ tags: ['𠮷'.repeat(41)], colors: [], favorite: false })).toThrow('40')
    expect(() => validateCatalogOrganization({ tags: [], colors: ['蓝', '蓝'], favorite: false })).toThrow('重复')
  })

  it('rejects hidden/accessor/unknown fields before evaluating any caller accessor', () => {
    let called = false
    const input = Object.defineProperty({ tags: [], colors: [], favorite: false }, 'hidden', { get() { called = true; return 1 } })
    expect(() => validateCatalogOrganization(input)).toThrow()
    expect(called).toBe(false)
    expect(() => validateCatalogOrganization({ tags: [], colors: [], favorite: false, sceneId: 'not allowed' })).toThrow()
  })
})
