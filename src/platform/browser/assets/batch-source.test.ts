import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { ASSET_PACK_MANIFEST_FILENAME, ASSET_PACK_MANIFEST_LIMITS } from '../../../shared/assets/import-manifest.js'
import { inspectBoundedZip, inspectZip } from '../../../shared/project/zip.js'
import { ASSET_BATCH_LIMITS, collectAssetFiles } from './batch-source.js'

const bytes = (text = 'not yet decoded') => new Uint8Array(encodeUtf8(text))
const image = (name = 'tree.png') => new File([bytes()], name, { type: 'image/png' })
const archive = (files: Record<string, Uint8Array>, level: 0 | 6 = 0) => new File([zipSync(files, { level }).buffer as ArrayBuffer], 'assets.zip', { type: 'application/zip' })
const folderFile = (path: string) => Object.defineProperty(image(path.split('/').at(-1)), 'webkitRelativePath', { value: path, configurable: true }) as File
const repeatedBlob = (mebibytes: number, type = 'image/png') => new Blob(Array.from({ length: mebibytes }, () => new Blob([new Uint8Array(1024 * 1024)])), { type })
const packManifest = (items: Record<string, unknown>[] = [{ path: 'tree.png', name: ' 老树_01 ', kind: 'prop', widthMm: 2000, heightMm: 3000,
  footprintWidthMm: 400, footprintHeightMm: 500, rootAnchorMm: { x: 1000, y: 2800 }, licenseId: 'original' }]) => ({
  format: 'sceneweave-asset-pack', schemaVersion: 1,
  pack: { id: 'forest', name: '森林包', version: 1, style: '水彩', scenes: ['营地'] },
  licenses: [{ id: 'original', text: 'Original work. Embedding permitted.', attribution: '作者' }], items,
})
const packBytes = (value: unknown = packManifest()) => bytes(JSON.stringify(value))
const fileAt = (path: string, content: Uint8Array) => Object.defineProperty(new File([content.buffer as ArrayBuffer], path.split('/').at(-1)!), 'webkitRelativePath', { value: path }) as File

describe('owned batch source selection', () => {
  it('collects supported files and reports sidecars without pretending image/SVG content was decoded', async () => {
    const input = [image(), new File([bytes('<svg/>')], 'grass.SVG', { type: 'application/octet-stream' }), new File([bytes('MIT')], 'LICENSE.txt')]
    const result = await collectAssetFiles(input)
    expect(result.source).toBe('files')
    expect(result.entries.map(row => [row.path, row.format, row.file.type])).toEqual([
      ['tree.png', 'raster', 'image/png'], ['grass.SVG', 'svg', 'image/svg+xml'],
    ])
    expect(result.skipped).toMatchObject([{ path: 'LICENSE.txt' }])
    expect(result.totalBytes).toBe(input[0].size + input[1].size)
    expect(result.inputBytes).toBe(result.totalBytes + input[2].size)
    expect(result.entries[0].file).not.toBe(input[0])
    expect(new Uint8Array(await result.entries[0].file.arrayBuffer())).toEqual(bytes())
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.entries)).toBe(true)
    expect(result.entries.every(Object.isFrozen)).toBe(true)
  })

  it('captures native content and File metadata before await and never invokes overridden file accessors/methods', async () => {
    const original = archive({ 'tree.png': bytes(), 'LICENSE.txt': bytes('MIT') })
    let calls = 0
    Object.defineProperties(original, {
      name: { get() { calls++; throw new Error('name getter') } },
      size: { get() { calls++; throw new Error('size getter') } },
      type: { get() { calls++; throw new Error('type getter') } },
      slice: { get() { calls++; throw new Error('slice getter') } },
      arrayBuffer: { get() { calls++; throw new Error('arrayBuffer getter') } },
    })
    const input: Blob[] = [original], pending = collectAssetFiles(input, { source: 'zip' })
    input[0] = new Blob([bytes('changed')])
    const result = await pending
    expect(result.entries.map(row => row.path)).toEqual(['tree.png'])
    expect(calls).toBe(0)
  })

  it('uses explicit relative paths and permits equal basenames in different real folders', async () => {
    const result = await collectAssetFiles([folderFile('grove/a.png'), folderFile('rock/a.png')], { source: 'folder' })
    expect(result.entries.map(row => row.path)).toEqual(['grove/a.png', 'rock/a.png'])
    expect(new Set(result.entries.map(row => row.key)).size).toBe(2)
  })

  it.each(['../x.png', '/x.png', 'C:/x.png', 'a\\b.png', 'a//b.png', 'a/./b.png', 'a/../b.png', 'a /b.png', 'a./b.png', 'NUL.png', 'a\u0000.png', 'caf\u0065\u0301.png'])('rejects unsafe or ambiguous native path %j', async path => {
    await expect(collectAssetFiles([folderFile(path)], { source: 'folder' })).rejects.toThrow(/路径|名称/)
  })

  it('rejects duplicate, case-ambiguous and file-as-parent relationships', async () => {
    for (const paths of [['A.png','a.png'], ['Trees/a.png','trees/b.png'], ['a.png','a.png/b.png']]) {
      await expect(collectAssetFiles(paths.map(folderFile), { source: 'folder' })).rejects.toThrow(/路径|冲突/)
    }
  })

  it('rejects pseudo files, sparse lists and accessors without invoking them', async () => {
    let calls = 0
    const list = [image()]
    Object.defineProperty(list, '0', { enumerable: true, get() { calls++; return image() } })
    await expect(collectAssetFiles(list)).rejects.toThrow(/访问器/)
    await expect(collectAssetFiles([{ name: 'tree.png' }] as unknown as Blob[])).rejects.toThrow(/实际/)
    await expect(collectAssetFiles(new Array<Blob>(1))).rejects.toThrow(/稀疏/)
    const file = image()
    Object.defineProperty(file, 'webkitRelativePath', { get() { calls++; return '../tree.png' } })
    await expect(collectAssetFiles([file], { source: 'folder' })).rejects.toThrow(/访问器/)
    const options = Object.defineProperty({}, 'source', { enumerable: true, get() { calls++; return 'zip' } })
    await expect(collectAssetFiles([image()], options)).rejects.toThrow(/访问器/)
    expect(calls).toBe(0)
  })

  it('checks count and native byte budgets before any normalization or decoding', async () => {
    await expect(collectAssetFiles(Array.from({ length: 65 }, (_, i) => image(`${i}.png`)))).rejects.toThrow(/64项/)
    await expect(collectAssetFiles([repeatedBlob(65)])).rejects.toThrow(/64MiB/)
    await expect(collectAssetFiles([repeatedBlob(21)])).rejects.toThrow(/20MiB/)
    await expect(collectAssetFiles([new Blob([new Uint8Array(ASSET_BATCH_LIMITS.svgBytes + 1)], { type: 'image/svg+xml' })])).rejects.toThrow(/1MiB/)
    await expect(collectAssetFiles([new File([], 'empty.png')])).rejects.toThrow(/为空/)
  })

  it('aborts before input capture and during asynchronous ZIP reading', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(collectAssetFiles([image()], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const second = new AbortController(), pending = collectAssetFiles([archive({ 'one.png': bytes(), 'two.webp': bytes() })], { source: 'zip', signal: second.signal })
    second.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('raw asset-pack manifest collection', () => {
  it('accepts a folder-root manifest and fills immutable draft metadata without confirming permission', async () => {
    const metadata = packBytes(), result = await collectAssetFiles([
      fileAt(`forest/${ASSET_PACK_MANIFEST_FILENAME}`, metadata), fileAt('forest/tree.png', bytes()), fileAt('forest/README.txt', bytes('instructions')),
    ], { source: 'folder' })
    expect(result.entries[0].path).toBe('forest/tree.png')
    expect(result.entries[0].metadata?.name).toBe(' 老树_01 ')
    expect(result.entries[0].metadata).toBe(result.manifest!.items[0])
    expect(result.entries[0].license).toBe(result.manifest!.licenses[0])
    expect(result.entries[0].license?.attribution).toBe('作者')
    expect(result.entries[0].license).not.toHaveProperty('canEmbed')
    expect(result.skipped.map(row => row.path)).toEqual(['forest/README.txt'])
    expect(result.totalBytes).toBe(bytes().length + metadata.length)
    expect(result.inputBytes).toBe(result.totalBytes + bytes('instructions').length)
    expect(Object.isFrozen(result.entries[0].metadata)).toBe(true); expect(Object.isFrozen(result.entries[0].license)).toBe(true)
  })

  it.each(['', 'forest/'] as const)('maps ZIP manifest paths relative to its directory %j', async root => {
    const value = packManifest([{ ...packManifest().items[0], path: 'props/tree.png', sourceSha256: sha256Bytes(bytes('original image bytes')) }])
    const result = await collectAssetFiles([archive({ [`${root}${ASSET_PACK_MANIFEST_FILENAME}`]: packBytes(value), [`${root}props/tree.png`]: bytes('original image bytes') }, 6)], { source: 'zip' })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].metadata?.path).toBe('props/tree.png')
    expect(result.entries[0].metadata?.sourceSha256).toBe(sha256Bytes(bytes('original image bytes')))
    expect(new Uint8Array(await result.entries[0].file.arrayBuffer())).toEqual(bytes('original image bytes'))
    expect(result.totalBytes).toBe(packBytes(value).length + bytes('original image bytes').length)
  })

  it('keeps no-manifest collection behavior and accepts a manifest selected with native files', async () => {
    const without = await collectAssetFiles([image()])
    expect(without.manifest).toBeUndefined(); expect(without.entries[0].metadata).toBeUndefined(); expect(without.entries[0].license).toBeUndefined()
    const withManifest = await collectAssetFiles([new File([packBytes().buffer as ArrayBuffer], ASSET_PACK_MANIFEST_FILENAME), image()])
    expect(withManifest.entries[0].metadata?.name).toBe(' 老树_01 ')
  })

  it('requires the exact manifest filename and permits only one at a common material root', async () => {
    await expect(collectAssetFiles([archive({ 'Sceneweave-assets.json': packBytes(), 'tree.png': bytes() })], { source: 'zip' })).rejects.toThrow(/精确/)
    await expect(collectAssetFiles([archive({ [`one/${ASSET_PACK_MANIFEST_FILENAME}`]: packBytes(), [`two/${ASSET_PACK_MANIFEST_FILENAME}`]: packBytes(), 'tree.png': bytes() })], { source: 'zip' })).rejects.toThrow(/一份/)
    await expect(collectAssetFiles([archive({ [`forest/${ASSET_PACK_MANIFEST_FILENAME}`]: packBytes(), 'tree.png': bytes() })], { source: 'zip' })).rejects.toThrow(/不存在/)
  })

  it('requires exact one-to-one mapping of every collected supported image including SVG', async () => {
    const declared = { [ASSET_PACK_MANIFEST_FILENAME]: packBytes(), 'tree.png': bytes() }
    await expect(collectAssetFiles([archive({ ...declared, 'extra.svg': bytes('<svg/>') })], { source: 'zip' })).rejects.toThrow(/未列出/)
    await expect(collectAssetFiles([archive({ [ASSET_PACK_MANIFEST_FILENAME]: packBytes() })], { source: 'zip' })).rejects.toThrow(/不存在/)
    await expect(collectAssetFiles([archive({ [ASSET_PACK_MANIFEST_FILENAME]: packBytes(), 'Tree.png': bytes() })], { source: 'zip' })).rejects.toThrow(/大小写/)
    const repeated = packManifest([packManifest().items[0], packManifest().items[0]])
    await expect(collectAssetFiles([archive({ ...declared, [ASSET_PACK_MANIFEST_FILENAME]: packBytes(repeated) })], { source: 'zip' })).rejects.toThrow(/重复/)
    const nonimage = packManifest([{ ...packManifest().items[0], path: 'README.txt' }])
    await expect(collectAssetFiles([archive({ ...declared, [ASSET_PACK_MANIFEST_FILENAME]: packBytes(nonimage), 'README.txt': bytes('text') })], { source: 'zip' })).rejects.toThrow(/PNG/)
  })

  it('compares the optional SHA-256 with original source bytes and rejects any mismatch', async () => {
    const value = packManifest([{ ...packManifest().items[0], sourceSha256: sha256Bytes(bytes('expected bytes')) }])
    for (const source of ['files', 'zip'] as const) {
      const selected = source === 'zip' ? [archive({ [ASSET_PACK_MANIFEST_FILENAME]: packBytes(value), 'tree.png': bytes('different bytes') })]
        : [new File([packBytes(value).buffer as ArrayBuffer], ASSET_PACK_MANIFEST_FILENAME), image()]
      await expect(collectAssetFiles(selected, { source })).rejects.toThrow(/原始字节.*SHA-256/)
    }
  })

  it('does not accept approval flags, duplicate JSON keys or unknown license references through a manifest', async () => {
    const value = packManifest(), invalid = [packBytes({ ...value, canEmbed: true }), packBytes({ ...value, licenses: [{ ...value.licenses[0], status: 'approved' }] }),
      packBytes(packManifest([{ ...value.items[0], licenseId: 'missing' }])), bytes('{"format":"sceneweave-asset-pack","\\u0066ormat":"other"}')]
    for (const metadata of invalid) await expect(collectAssetFiles([archive({ [ASSET_PACK_MANIFEST_FILENAME]: metadata, 'tree.png': bytes() })], { source: 'zip' })).rejects.toThrow(/素材包清单无效/)
  })

  it('enforces the separate manifest bound and counts it in the 64MiB source total', async () => {
    const oversized = new Uint8Array(ASSET_PACK_MANIFEST_LIMITS.bytes + 1)
    await expect(collectAssetFiles([new File([oversized], ASSET_PACK_MANIFEST_FILENAME), image()])).rejects.toThrow(/256KiB/)
    await expect(collectAssetFiles([archive({ [ASSET_PACK_MANIFEST_FILENAME]: oversized, 'tree.png': bytes() }, 6)], { source: 'zip' })).rejects.toThrow(/预算/)
    const item = packManifest().items[0], value = packManifest(Array.from({ length: 4 }, (_, i) => ({ ...item, path: `${i}.png` })))
    const zipped = zipSync({ [ASSET_PACK_MANIFEST_FILENAME]: packBytes(value), '0.png': bytes(), '1.png': bytes(), '2.png': bytes(), '3.png': bytes() }, { level: 0 }), view = new DataView(zipped.buffer)
    // Only declarations are needed: admission must reject before decompression.
    for (let offset = 0; offset < zipped.length - 46; offset++) {
      const signature = view.getUint32(offset, true), local = signature === 0x04034b50, central = signature === 0x02014b50
      if (!local && !central) continue
      const nameStart = offset + (local ? 30 : 46), nameLength = view.getUint16(offset + (local ? 26 : 28), true)
      if (nameLength === 5 && zipped[nameStart] >= 48 && zipped[nameStart] <= 51
        && zipped[nameStart + 1] === 46 && zipped[nameStart + 2] === 112 && zipped[nameStart + 3] === 110 && zipped[nameStart + 4] === 103) {
        view.setUint32(offset + (local ? 22 : 24), 16 * 1024 * 1024, true)
      }
    }
    await expect(collectAssetFiles([new Blob([new Uint8Array(zipped)])], { source: 'zip' })).rejects.toThrow(/64MiB/)
  })

  it('still reads skipped ZIP sidecars and checks their CRC before returning manifest-backed drafts', async () => {
    const marker = bytes('unique manifest sidecar contents'), file = archive({ [ASSET_PACK_MANIFEST_FILENAME]: packBytes(), 'tree.png': bytes(), 'README.txt': marker })
    const changed = new Uint8Array(await file.arrayBuffer())
    const index = changed.findIndex((_, i) => marker.every((byte, offset) => changed[i + offset] === byte))
    expect(index).toBeGreaterThan(0); changed[index] ^= 1
    await expect(collectAssetFiles([new Blob([changed])], { source: 'zip' })).rejects.toThrow(/CRC/)
  })
})

describe('bounded asset ZIP reader', () => {
  it('accepts one material without requiring a complete-project manifest', async () => {
    const result = await collectAssetFiles([archive({ 'only.png': bytes() })], { source: 'zip' })
    expect(result.entries.map(row => row.path)).toEqual(['only.png'])
  })

  it.each([0, 6] as const)('verifies empty directories and all records at compression level %s', async level => {
    const result = await collectAssetFiles([archive({ 'tree/': new Uint8Array(), 'tree/a.png': bytes('pixels'), 'tree/source.svg': bytes('<svg/>'), 'LICENSE.txt': bytes('MIT') }, level)], { source: 'zip' })
    expect(result.entries.map(row => row.path)).toEqual(['tree/a.png', 'tree/source.svg'])
    expect(result.skipped.map(row => row.path)).toEqual(['LICENSE.txt'])
    expect(result.expandedBytes).toBe(bytes('pixels<svg/>MIT').length)
  })

  it.each(['../tree.png', '/tree.png', 'a\\tree.png', 'a//tree.png', 'con/tree.png'])('rejects a malicious ZIP path %j even when not selected', async path => {
    await expect(collectAssetFiles([archive({ 'good.png': bytes(), [path]: bytes('bad') })], { source: 'zip' })).rejects.toThrow(/路径|名称/)
  })

  it('rejects inconsistent directory data and empty non-directory files', async () => {
    await expect(collectAssetFiles([archive({ 'tree/': bytes('not a directory'), 'tree/a.png': bytes() })], { source: 'zip' })).rejects.toThrow(/预算/)
    await expect(collectAssetFiles([archive({ 'README.txt': new Uint8Array(), 'tree.png': bytes() })], { source: 'zip' })).rejects.toThrow(/预算/)
    const missingStream = zipSync({ 'tree/': new Uint8Array() }, { level: 0 }), view = new DataView(missingStream.buffer)
    view.setUint16(8, 8, true)
    const central = view.getUint32(missingStream.length - 6, true)
    view.setUint16(central + 10, 8, true)
    await expect(collectAssetFiles([new Blob([new Uint8Array(missingStream)])], { source: 'zip' })).rejects.toThrow(/deflate流缺失/)
  })

  it('does not let an ignored sidecar hide a CRC failure', async () => {
    const marker = bytes('unique README sidecar contents'), file = archive({ 'tree.png': bytes(), 'README.txt': marker })
    const changed = new Uint8Array(await file.arrayBuffer())
    const index = changed.findIndex((_, i) => marker.every((byte, offset) => changed[i + offset] === byte))
    expect(index).toBeGreaterThan(0); changed[index] ^= 1
    await expect(collectAssetFiles([new Blob([changed])], { source: 'zip' })).rejects.toThrow(/CRC/)
  })

  it('does not waive CRC verification for an opted-in empty directory', async () => {
    const zipped = zipSync({ 'tree/': new Uint8Array(), 'tree/a.png': bytes() }, { level: 0 }), view = new DataView(zipped.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    view.setUint32(14, 1, true)
    let central = 0
    while (central < zipped.length - 4 && view.getUint32(central, true) !== 0x02014b50) central++
    expect(central).toBeLessThan(zipped.length - 4)
    view.setUint32(central + 16, 1, true)
    await expect(collectAssetFiles([new Blob([new Uint8Array(zipped)])], { source: 'zip' })).rejects.toThrow(/CRC/)
  })

  it('rejects aggregate declared expansion before reading even a small compressed payload', async () => {
    const zipped = zipSync(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`${i}.txt`, bytes()])), { level: 0 }), view = new DataView(zipped.buffer)
    for (let offset = 0; offset < zipped.length - 30; offset++) {
      const signature = view.getUint32(offset, true)
      if (signature === 0x04034b50) view.setUint32(offset + 22, 20 * 1024 * 1024, true)
      if (signature === 0x02014b50) view.setUint32(offset + 24, 20 * 1024 * 1024, true)
    }
    await expect(collectAssetFiles([new Blob([new Uint8Array(zipped)])], { source: 'zip' })).rejects.toThrow(/128MiB/)
  })

  it('rejects case ambiguity, file-parent conflicts and excess candidate/entry counts before extracting', async () => {
    const ambiguous: Record<string, Uint8Array>[] = [{ 'A.png': bytes(), 'a.png': bytes() }, { 'Trees/a.png': bytes(), 'trees/b.png': bytes() }, { 'a.png': bytes(), 'a.png/x.svg': bytes() }]
    for (const files of ambiguous) {
      await expect(collectAssetFiles([archive(files)], { source: 'zip' })).rejects.toThrow(/路径|冲突/)
    }
    await expect(collectAssetFiles([archive(Object.fromEntries(Array.from({length:65},(_,i)=>[`${i}.png`,bytes()])))],{source:'zip'})).rejects.toThrow(/64项/)
    await expect(collectAssetFiles([archive(Object.fromEntries(Array.from({length:513},(_,i)=>[`${i}.txt`,bytes()])))],{source:'zip'})).rejects.toThrow(/512/)
  })

  it('keeps the default complete-project ZIP rejection contracts unchanged', () => {
    const one = zipSync({ 'only.png': bytes() }), dirs = zipSync({ 'folder/': new Uint8Array(), 'folder/a.png': bytes() })
    expect(() => inspectZip(one)).toThrow(/条目数量/)
    expect(() => inspectZip(dirs)).toThrow(/路径/)
    const policy = { pathBudget: () => 20 * 1024 * 1024, requiredPaths: [], documentPath: () => false }
    expect(() => inspectBoundedZip(one, policy)).toThrow(/条目数量/)
    expect(() => inspectBoundedZip(dirs, policy)).toThrow(/预算/)
  })
})
