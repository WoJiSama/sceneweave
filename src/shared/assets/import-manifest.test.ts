import { describe, expect, it } from 'vitest'
import { encodeUtf8 } from '../validation/json.js'
import { ASSET_PACK_MANIFEST_LIMITS, assetDisplayNameFromPath, parseAssetPackManifest, validateAssetDisplayName, validateAssetPackManifest } from './import-manifest.js'

const manifest = () => ({
  format: 'sceneweave-asset-pack', schemaVersion: 1,
  pack: { id: 'woodland', name: '林地场景包', version: 1, style: '水彩', scenes: ['林间道路', '营地'] },
  licenses: [{ id: 'original', text: 'Original work.\nRedistribution and embedding permitted.', attribution: 'Author 原作者' }],
  items: [{ path: 'props/old_tree_01.png', name: ' 老树_01 ', kind: 'prop', widthMm: 2000, heightMm: 3000,
    footprintWidthMm: 400, footprintHeightMm: 500, rootAnchorMm: { x: 1000, y: 2800 }, footprintOffsetMm: { x: -20, y: 30 },
    renderLayer: 'canopy', shadowClass: 'vegetation', blocksMovement: true, blocksSight: false, licenseId: 'original', tags: ['树林', '树_01'] }],
})
const parse = (value: unknown) => parseAssetPackManifest(encodeUtf8(JSON.stringify(value)))

describe('asset display name contract', () => {
  it('derives the exact basename and removes only its final extension without interpretation', () => {
    expect(assetDisplayNameFromPath('woodland/老树_01.v2.PNG')).toBe('老树_01.v2')
    expect(assetDisplayNameFromPath('folder/ 草_002 .webp')).toBe(' 草_002 ')
    expect(assetDisplayNameFromPath('C:\\folder\\素材_009.svg')).toBe('素材_009')
    expect(assetDisplayNameFromPath('plain_name_007')).toBe('plain_name_007')
    expect(assetDisplayNameFromPath('.png')).toBe('')
    expect(assetDisplayNameFromPath('x'.repeat(121) + '.png')).toBe('x'.repeat(121))
    expect(assetDisplayNameFromPath('bad\u202ename.png')).toBe('bad\u202ename')
  })

  it('preserves whitespace, Unicode normalization, case, numbers and punctuation in a valid display name', () => {
    for (const name of ['  老树_01  ', 'cafe\u0301', 'CAFÉ', 'Tree (02).v1', '🌲'.repeat(120)]) expect(validateAssetDisplayName(name)).toBe(name)
  })

  it.each(['', ' \t ', 'x'.repeat(121), '🌲'.repeat(121), 'bad\nname', 'bad\u007fname', 'bad\u0085name', 'bad\u061cname', 'bad\u200fname', 'bad\u202ename', 'bad\u2066name', '\ud800', '\udfff'])('rejects an unusable display name %j at adoption', name => {
    expect(() => validateAssetDisplayName(name)).toThrow(/名称/)
  })
})

describe('strict raw asset-pack manifest', () => {
  it('captures independent immutable metadata with exact names and explicit physical defaults', () => {
    const input = manifest(), result = validateAssetPackManifest(input)
    expect(result.items[0].name).toBe(' 老树_01 ')
    expect(result.items[0]).toMatchObject({ footprintOffsetMm: { x: -20, y: 30 }, renderLayer: 'canopy', shadowClass: 'vegetation', blocksMovement: true })
    expect(result).not.toBe(input); expect(result.items[0]).not.toBe(input.items[0])
    input.items[0].name = 'changed'; input.items[0].rootAnchorMm.x = 1; input.licenses[0].text = 'changed'
    expect(result.items[0].name).toBe(' 老树_01 '); expect(result.items[0].rootAnchorMm!.x).toBe(1000)
    expect(result.licenses[0].text).toContain('Redistribution')
    for (const value of [result, result.pack, result.pack.scenes, result.licenses, result.licenses[0], result.items, result.items[0], result.items[0].tags, result.items[0].rootAnchorMm]) expect(Object.isFrozen(value)).toBe(true)
    expect(result.items[0]).not.toHaveProperty('canEmbed')
  })

  it('accepts material surface metadata without inventing any permission or review status', () => {
    const input = manifest()
    const material = { path: 'ground/grass.svg', name: '草 地_04', kind: 'material', widthMm: 1000, heightMm: 1000, licenseId: 'original', applicableSurfaces: ['room', 'terrain', 'path'] }
    const result = parse({ ...input, items: [material] })
    expect(result.items[0]).toEqual(material)
    expect(result).not.toHaveProperty('status'); expect(result.pack).not.toHaveProperty('approved')
  })

  it('does not invoke getters or accept hidden, symbol, prototype or undefined data', () => {
    let reads = 0
    const getter = Object.defineProperty(manifest(), 'pack', { enumerable: true, get() { reads++; return manifest().pack } })
    expect(() => validateAssetPackManifest(getter)).toThrow(/访问器/)
    const nested = manifest(); Object.defineProperty(nested.items[0], 'name', { enumerable: true, get() { reads++; return 'changed' } })
    expect(() => validateAssetPackManifest(nested)).toThrow(/访问器/)
    const hidden = manifest(); Object.defineProperty(hidden.pack, 'secret', { value: true })
    expect(() => validateAssetPackManifest(hidden)).toThrow(/隐藏/)
    const symbol = { ...manifest(), [Symbol('status')]: 'approved' }
    expect(() => validateAssetPackManifest(symbol)).toThrow(/Symbol/)
    expect(() => validateAssetPackManifest(Object.assign(Object.create({ inherited: true }), manifest()))).toThrow(/普通JSON/)
    expect(() => validateAssetPackManifest({ ...manifest(), unknown: undefined })).toThrow(/undefined/)
    expect(reads).toBe(0)
  })

  it.each(['canEmbed', 'status', 'P3', 'url', 'script', 'unknown'])('rejects unsupported root, license, pack and item field %s', field => {
    const input = manifest()
    for (const value of [
      { ...input, [field]: true }, { ...input, pack: { ...input.pack, [field]: true } },
      { ...input, licenses: [{ ...input.licenses[0], [field]: true }] }, { ...input, items: [{ ...input.items[0], [field]: true }] },
    ]) expect(() => parse(value)).toThrow(/字段|许可|主题包/)
  })

  it('requires supported metadata, complete inline licenses and existing license references', () => {
    const input = manifest()
    const invalid = [
      { ...input, schemaVersion: 2 }, { ...input, format: 'some-other-pack' },
      { ...input, pack: { ...input.pack, version: 0 } }, { ...input, pack: { ...input.pack, scenes: [] } },
      { ...input, licenses: [] }, { ...input, licenses: [input.licenses[0], input.licenses[0]] },
      { ...input, licenses: [{ ...input.licenses[0], text: '  ' }] },
      { ...input, items: [{ ...input.items[0], licenseId: 'not-in-manifest' }] },
      { ...input, items: [{ ...input.items[0], kind: 'prefab' }] },
      { ...input, items: [{ ...input.items[0], tags: ['tree', 'tree'] }] },
      { ...input, items: [{ ...input.items[0], sourceSha256: 'A'.repeat(64) }] },
      { ...input, items: [{ ...input.items[0], name: 'bad\u202ename' }] },
    ]
    for (const value of invalid) expect(() => parse(value)).toThrow(/素材包清单无效/)
  })

  it('checks integer dimensions, explicit prop footprint, anchor bounds, offsets and supported enum values', () => {
    const input = manifest(), item = input.items[0]
    const { footprintWidthMm: _width, ...missingFootprint } = item
    const changes = [missingFootprint, { ...item, widthMm: 0 }, { ...item, heightMm: 1.5 }, { ...item, widthMm: 1_000_001 },
      { ...item, rootAnchorMm: { x: 2001, y: 0 } }, { ...item, rootAnchorMm: { x: 0, y: 0, other: true } },
      { ...item, footprintOffsetMm: { x: 1_000_001, y: 0 } }, { ...item, blocksSight: 1 },
      { ...item, renderLayer: 'front' }, { ...item, shadowClass: 'cast' }, { ...item, applicableSurfaces: ['room'] }]
    for (const changed of changes) expect(() => parse({ ...input, items: [changed] })).toThrow(/尺寸|占地|根锚|布尔|渲染层|阴影|表面/)
    const material = { path: 'floor.png', name: 'floor', kind: 'material', widthMm: 1000, heightMm: 1000, licenseId: 'original' }
    for (const changed of [{ ...material, blocksMovement: false }, { ...material, footprintWidthMm: 100 },
      { ...material, applicableSurfaces: [] }, { ...material, applicableSurfaces: ['room', 'room'] }, { ...material, applicableSurfaces: ['roof'] }]) {
      expect(() => parse({ ...input, items: [changed] })).toThrow(/材质/)
    }
  })

  it.each(['../tree.png', '/tree.png', 'a\\tree.png', 'a//tree.png', 'a/./tree.png', 'a /tree.png', 'NUL.png', 'cafe\u0301.png', 'tree.txt'])('uses the portable supported-image path policy for %j', path => {
    const input = manifest()
    expect(() => parse({ ...input, items: [{ ...input.items[0], path }] })).toThrow(/路径|名称|PNG/)
  })

  it('rejects duplicate paths, directory case ambiguity, file-as-parent conflicts and excessive items', () => {
    const input = manifest(), item = input.items[0]
    for (const paths of [['a.png', 'a.png'], ['A.png', 'a.png'], ['Trees/a.png', 'trees/b.png'], ['a.png', 'a.png/b.png']]) {
      expect(() => parse({ ...input, items: paths.map(path => ({ ...item, path })) })).toThrow(/路径|冲突/)
    }
    expect(() => parse({ ...input, items: Array.from({ length: 65 }, (_, i) => ({ ...item, path: `${i}.png` })) })).toThrow(/64/)
  })

  it('rejects duplicate JSON keys, invalid UTF-8 and byte/depth/node overages before schema interpretation', () => {
    expect(() => parseAssetPackManifest(encodeUtf8('{"format":"sceneweave-asset-pack","format":"other"}'))).toThrow(/重复字段/)
    expect(() => parseAssetPackManifest(encodeUtf8('{"name":"a","\\u006eame":"b"}'))).toThrow(/重复字段/)
    expect(() => parseAssetPackManifest(new Uint8Array([0xff]))).toThrow(/UTF-8/)
    expect(() => parseAssetPackManifest(new Uint8Array(ASSET_PACK_MANIFEST_LIMITS.bytes + 1))).toThrow(/预算/)
    expect(() => parseAssetPackManifest(encodeUtf8('['.repeat(18) + '0' + ']'.repeat(18)))).toThrow(/深度/)
    expect(() => parseAssetPackManifest(encodeUtf8('[' + '0,'.repeat(ASSET_PACK_MANIFEST_LIMITS.jsonValues) + '0]'))).toThrow(/节点/)
  })
})
