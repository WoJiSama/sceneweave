import { describe, expect, it } from 'vitest'
import { catalogCategory, catalogSizeLabel } from './catalog-categories'

describe('catalog browsing categories', () => {
  it('distinguishes surface textures from placeable vegetation and rocks', () => {
    expect(catalogCategory({ name: '簇生草地', publisherTags: ['植被'], identity: { kind: 'material' } })).toBe('ground')
    expect(catalogCategory({ name: '冷却玄武岩', publisherTags: ['岩石'], identity: { kind: 'material' } })).toBe('ground')
    expect(catalogCategory({ name: '阔叶树冠', publisherTags: [], identity: { kind: 'prop' } })).toBe('vegetation')
    expect(catalogCategory({ name: '气孔玄武岩块', publisherTags: [], identity: { kind: 'prop' } })).toBe('rocks')
    expect(catalogCategory({ name: '浅灰墙石', publisherTags: [], identity: { kind: 'material' } })).toBe('building')
  })

  it('uses the object purpose rather than a material or theme in its name', () => {
    expect(catalogCategory({ name: '铜色桌灯', publisherTags: ['家具'], identity: { kind: 'prop' } })).toBe('props')
    expect(catalogCategory({ name: '灰石炉台', publisherTags: ['石制'], identity: { kind: 'prop' } })).toBe('furniture')
    expect(catalogCategory({ name: '石圈短焰营火', publisherTags: [], identity: { kind: 'prop' } })).toBe('props')
    expect(catalogCategory({ name: '露台一桌两椅', publisherTags: ['露台'], identity: { kind: 'prefab' } })).toBe('furniture')
    expect(catalogCategory({ name: '旧铁围栏短段', publisherTags: [], identity: { kind: 'prop' } })).toBe('building')
  })

  it('accepts descriptive tags while keeping unknown imported content discoverable', () => {
    expect(catalogCategory({ name: '自制素材 A', publisherTags: ['植被'], identity: { kind: 'prop' } })).toBe('vegetation')
    expect(catalogCategory({ name: '自制素材 B', publisherTags: [], identity: { kind: 'prop' } }, ['岩石'])).toBe('rocks')
    expect(catalogCategory({ name: '星图标记', publisherTags: ['原创'], identity: { kind: 'prop' } })).toBe('other')
  })

  it('shows dimensions in meters without losing millimeter precision', () => {
    expect(catalogSizeLabel(1200, 650)).toBe('1.2 × 0.65 m')
    expect(catalogSizeLabel(1, 254)).toBe('0.001 × 0.254 m')
  })
})
