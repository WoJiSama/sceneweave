import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createHouse } from '../core/seed'
import { exportProject, importProject, readProjectV1, PROJECT_LIMITS } from './project-file'

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const asBlob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer])
async function unpack() { return unzipSync(new Uint8Array(await (await exportProject(createHouse())).arrayBuffer())) }
async function packSceneText(text: string): Promise<Blob> {
  const entries = await unpack()
  const manifest = JSON.parse(decode(entries['manifest.json']))
  const scene = JSON.parse(text)
  const bytes = encode(text)
  manifest.sceneId = scene.sceneId
  manifest.entries[0].sizeBytes = bytes.length
  manifest.entries[0].sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  entries['manifest.json'] = encode(JSON.stringify(manifest))
  entries['scene.json'] = bytes
  return asBlob(zipSync(entries))
}

/** Only used to verify that duplicate paths are rejected before payload decoding. */
function duplicatePathZip(): Blob {
  const name = encode('scene.json'), data = encode('{}')
  const localLength = 30 + name.length + data.length
  const centralLength = 46 + name.length
  const bytes = new Uint8Array(localLength * 2 + centralLength * 2 + 22)
  const view = new DataView(bytes.buffer)
  const write16 = (offset: number, value: number) => view.setUint16(offset, value, true)
  const write32 = (offset: number, value: number) => view.setUint32(offset, value, true)
  for (let index = 0; index < 2; index++) {
    const local = index * localLength, central = localLength * 2 + index * centralLength
    write32(local, 0x04034b50); write16(local + 4, 20)
    write32(local + 18, data.length); write32(local + 22, data.length); write16(local + 26, name.length)
    bytes.set(name, local + 30); bytes.set(data, local + 30 + name.length)
    write32(central, 0x02014b50); write16(central + 6, 20)
    write32(central + 20, data.length); write32(central + 24, data.length)
    write16(central + 28, name.length); write32(central + 42, local)
    bytes.set(name, central + 46)
  }
  const end = bytes.length - 22
  write32(end, 0x06054b50); write16(end + 8, 2); write16(end + 10, 2)
  write32(end + 12, centralLength * 2); write32(end + 16, localLength * 2)
  return asBlob(bytes)
}

describe('.sceneweave M0 project container', () => {
  it('reads the exact source identity and revision before explicit migration', async () => {
    const source = createHouse('migration-original')
    source.revision = 42
    expect(await readProjectV1(await exportProject(source))).toEqual(source)
    const fork = await importProject(await exportProject(source))
    expect(fork.sceneId).not.toBe(source.sceneId)
    expect(fork.revision).toBe(0)
  })
  it('roundtrips full secret-bearing geometry into an independent new scene', async () => {
    const original = createHouse()
    original.revision = 17
    const before = structuredClone(original)
    const result = await importProject(await exportProject(original))
    expect(result.sceneId).not.toBe(original.sceneId)
    expect(result.revision).toBe(0)
    expect(result).toEqual({ ...original, sceneId: result.sceneId, revision: 0, createdAt: result.createdAt, updatedAt: result.updatedAt })
    expect(original).toEqual(before)
  })

  it('roundtrips the core contract maximum 256-character scene ID', async () => {
    const original = createHouse('a'.repeat(256))
    const imported = await importProject(await exportProject(original))
    expect(imported.sceneId).not.toBe(original.sceneId)
    expect(imported.title).toBe(original.title)
    expect(imported.props).toEqual(original.props)
  })

  it('supports standard uncompressed ZIP records as well as deflate', async () => {
    const entries = await unpack()
    expect((await importProject(asBlob(zipSync(entries, { level: 0 })))).title).toBe('雾灯宅')
  })

  it('rejects a modified scene even when its ZIP CRC was recomputed', async () => {
    const entries = await unpack()
    entries['scene.json'] = encode(decode(entries['scene.json']).replace('雾灯宅', '外来修改'))
    await expect(importProject(asBlob(zipSync(entries)))).rejects.toThrow('SHA-256')
  })

  it('rejects unknown container versions and manifest fields', async () => {
    const entries = await unpack()
    const manifest = JSON.parse(decode(entries['manifest.json']))
    manifest.containerVersion = 2
    entries['manifest.json'] = encode(JSON.stringify(manifest))
    await expect(importProject(asBlob(zipSync(entries)))).rejects.toThrow('版本')
    manifest.containerVersion = 1
    manifest.unknown = true
    entries['manifest.json'] = encode(JSON.stringify(manifest))
    await expect(importProject(asBlob(zipSync(entries)))).rejects.toThrow('未知')
  })

  it('rejects duplicate JSON keys, including Unicode escaped aliases', async () => {
    const scene = createHouse()
    const text = JSON.stringify(scene).replace('"title":"雾灯宅"', '"title":"雾灯宅","\\u0074itle":"ambiguous"')
    await expect(importProject(await packSceneText(text))).rejects.toThrow('重复字段')
  })

  it('rejects duplicate manifest keys before JSON.parse discards one', async () => {
    const entries = await unpack()
    entries['manifest.json'] = encode(decode(entries['manifest.json']).replace('"containerVersion":1', '"containerVersion":2,"containerVersion":1'))
    await expect(importProject(asBlob(zipSync(entries)))).rejects.toThrow('重复字段')
  })

  it('rejects unknown document fields and damaged geometry', async () => {
    const scene = createHouse() as ReturnType<typeof createHouse> & { unknown?: boolean }
    scene.unknown = true
    await expect(importProject(await packSceneText(JSON.stringify(scene)))).rejects.toThrow()
    delete scene.unknown
    scene.walls['w-0a'].endVertexId = 'nonexistent'
    await expect(importProject(await packSceneText(JSON.stringify(scene)))).rejects.toThrow()
  })

  it('rejects multiple floors and nonempty assets rather than dropping them', async () => {
    const scene = createHouse()
    scene.floors['f-other'] = { ...scene.floors['f-a1'], id: 'f-other' }
    await expect(exportProject(scene)).rejects.toThrow()
    delete scene.floors['f-other']
    scene.props['p-a1'].assetId = 'missing-asset'
    await expect(exportProject(scene)).rejects.toThrow()
  })

  it.each(['../scene.json', '/scene.json', 'C:/scene.json', 'nested.zip'])('rejects unsupported or unsafe entry path %s', async path => {
    const entries = await unpack()
    entries[path] = entries['scene.json']
    delete entries['scene.json']
    await expect(importProject(asBlob(zipSync(entries)))).rejects.toThrow()
  })

  it('rejects extra entries before inflation', async () => {
    const entries = await unpack()
    entries['other.txt'] = encode('extra')
    await expect(importProject(asBlob(zipSync(entries)))).rejects.toThrow('两个条目')
  })

  it('rejects duplicate ZIP paths before either payload is decoded', async () => {
    await expect(importProject(duplicatePathZip())).rejects.toThrow('重复路径')
  })

  it('rejects a file that exceeds the compressed input budget', async () => {
    await expect(importProject(new Blob([new ArrayBuffer(PROJECT_LIMITS.compressedBytes + 1)]))).rejects.toThrow('5 MiB')
  })

  it('rejects an inflated-size declaration over budget before decompression', async () => {
    const packed = new Uint8Array(await (await exportProject(createHouse())).arrayBuffer())
    const view = new DataView(packed.buffer)
    for (let cursor = 0; cursor < packed.length - 46; cursor++) {
      if (view.getUint32(cursor, true) === 0x02014b50 && decode(packed.subarray(cursor + 46, cursor + 56)) === 'scene.json') {
        view.setUint32(cursor + 24, PROJECT_LIMITS.sceneBytes + 1, true)
        break
      }
    }
    await expect(importProject(asBlob(packed))).rejects.toThrow('预算')
  })

  it('stops inflation when actual output exceeds a forged small declaration', async () => {
    const packed = new Uint8Array(await (await exportProject(createHouse())).arrayBuffer())
    const view = new DataView(packed.buffer)
    for (let cursor = 0; cursor < packed.length - 46; cursor++) {
      if (view.getUint32(cursor, true) === 0x02014b50 && decode(packed.subarray(cursor + 46, cursor + 56)) === 'scene.json') {
        const local = view.getUint32(cursor + 42, true)
        view.setUint32(cursor + 24, 10, true)
        view.setUint32(local + 22, 10, true)
        break
      }
    }
    await expect(importProject(asBlob(packed))).rejects.toThrow('实际展开量')
  })

  it('rejects corrupted payload CRC and disagreement between local and central paths', async () => {
    const entries = await unpack()
    const packed = zipSync(entries, { level: 0 })
    const view = new DataView(packed.buffer)
    const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    packed[dataStart] ^= 1
    await expect(importProject(asBlob(packed))).rejects.toThrow('CRC')
    const renamed = zipSync(entries, { level: 0 })
    renamed[30] = 'x'.charCodeAt(0)
    await expect(importProject(asBlob(renamed))).rejects.toThrow('路径')
  })

  it('rejects trailing data and truncated files', async () => {
    const packed = new Uint8Array(await (await exportProject(createHouse())).arrayBuffer())
    const trailing = new Uint8Array(packed.length + 1)
    trailing.set(packed)
    await expect(importProject(asBlob(trailing))).rejects.toThrow()
    await expect(importProject(asBlob(packed.subarray(0, packed.length - 5)))).rejects.toThrow()
  })
})
