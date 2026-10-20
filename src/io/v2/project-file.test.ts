import { unzipSync, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../../core/seed'
import { exportProject } from '../project-file'
import { parseBoundedJson } from './json'
import { exportProjectV2, importProjectV2, inspectProjectVersionV2, PROJECT_LIMITS_V2, validateCompleteProjectV2 } from './project-file'
import { sha256Bytes } from './resources'
import { emptyProject, imageProject } from './test-fixtures'
import { inspectZipV2 } from './zip'

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const blob = (bytes: Uint8Array) => new Blob([bytes.slice().buffer])
async function unpack() { return unzipSync(new Uint8Array(await (await exportProjectV2(await imageProject())).arrayBuffer())) }
async function modifyManifest(change: (manifest: Record<string, unknown>) => void): Promise<Blob> {
  const files = await unpack(), manifest = JSON.parse(decode(files['manifest.json']))
  change(manifest)
  files['manifest.json'] = encode(JSON.stringify(manifest))
  return blob(zipSync(files))
}

beforeEach(() => {
  // Only Node's absent browser decoder is stubbed; schema, closure, CRC and hashes are real.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('v2 complete project package', () => {
  it('roundtrips geometry, adopted definition, resource and licenses without changing identity/revision', async () => {
    const project = await imageProject(); project.document.revision = 7
    const result = await importProjectV2(await exportProjectV2(project))
    expect(result.document).toEqual(project.document)
    expect(result.licenseBindings).toEqual(project.licenseBindings)
    expect(result.licenses).toEqual(project.licenses)
    const hash = Object.keys(project.assets)[0]
    expect(await result.assets[hash].blob.arrayBuffer()).toEqual(await project.assets[hash].blob.arrayBuffer())
    expect(await inspectProjectVersionV2(await exportProjectV2(project))).toBe(2)
    expect(await inspectProjectVersionV2(await exportProject(createHouse()))).toBe(1)
  })

  it('supports stored ZIP entries and geometry-only migrated complete projects', async () => {
    const project = emptyProject()
    const files = unzipSync(new Uint8Array(await (await exportProjectV2(project)).arrayBuffer()))
    expect((await importProjectV2(blob(zipSync(files, { level: 0 })))).document).toEqual(project.document)
  })

  it('refuses missing, extra or disallowed dependencies before decoder invocation', async () => {
    const project = await imageProject(), hash = Object.keys(project.assets)[0]
    const decodeBitmap = vi.mocked(createImageBitmap); decodeBitmap.mockClear()
    const missing = structuredClone(project); delete missing.assets[hash]
    await expect(validateCompleteProjectV2(missing)).rejects.toThrow('依赖缺失')
    const extra = structuredClone(project); extra.assets['0'.repeat(64)] = extra.assets[hash]
    await expect(validateCompleteProjectV2(extra)).rejects.toThrow('恰好覆盖')
    const forbidden = structuredClone(project); forbidden.document.assets['test-image'].origin.canEmbed = false
    await expect(validateCompleteProjectV2(forbidden)).rejects.toThrow('未获准嵌入')
    const incomplete = structuredClone(project); incomplete.licenseBindings.pop()
    await expect(validateCompleteProjectV2(incomplete)).rejects.toThrow('缺少许可绑定')
    const unusedLicense = structuredClone(project); unusedLicense.licenses['0'.repeat(64)] = { sha256: '0'.repeat(64), text: 'extra' }
    await expect(validateCompleteProjectV2(unusedLicense)).rejects.toThrow('许可文本必须恰好')
    expect(decodeBitmap).not.toHaveBeenCalled()
  })

  it('refuses license ambiguity, duplicate subjects and forged license bytes', async () => {
    const project = await imageProject()
    project.licenseBindings.push({ ...project.licenseBindings[0] })
    await expect(validateCompleteProjectV2(project)).rejects.toThrow('重复')
    project.licenseBindings.pop()
    const hash = Object.keys(project.licenses)[0]
    project.licenses[hash].text += 'changed'
    await expect(validateCompleteProjectV2(project)).rejects.toThrow('SHA-256')
  })

  it('rejects strict profile/versions, extra manifest fields and wrong revision', async () => {
    await expect(importProjectV2(await modifyManifest(manifest => { manifest.packageMode = 'references' }))).rejects.toThrow('完整工程')
    await expect(importProjectV2(await modifyManifest(manifest => { manifest.profile = 'm0-geometry' }))).rejects.toThrow('profile')
    await expect(importProjectV2(await modifyManifest(manifest => { manifest.unknown = true }))).rejects.toThrow('未知')
    await expect(importProjectV2(await modifyManifest(manifest => { manifest.revision = 99 }))).rejects.toThrow('revision')
    await expect(importProjectV2(await exportProject(createHouse()))).rejects.toThrow('字段')
  })

  it('rejects undeclared archive files, unsafe paths, hashes and actual image MIME mismatch', async () => {
    const files = await unpack()
    files['extra.txt'] = encode('extra')
    await expect(importProjectV2(blob(zipSync(files)))).rejects.toThrow('路径')
    delete files['extra.txt']
    const assetPath = Object.keys(files).find(path => path.startsWith('assets/'))!
    files[assetPath][20] ^= 1
    await expect(importProjectV2(blob(zipSync(files)))).rejects.toThrow('SHA-256')
    const renamed = await unpack()
    renamed['../scene.json'] = renamed['scene.json']; delete renamed['scene.json']
    await expect(importProjectV2(blob(zipSync(renamed)))).rejects.toThrow('路径')
  })

  it('rejects duplicate ZIP paths, local/central disagreement and CRC damage before adoption', async () => {
    const duplicate = zipSync({ 'manifest.json': encode('{}'), 'scene.json': encode('{}'), 'scene.jsox': encode('{}') }, { level: 0 })
    // The names have equal byte length, so both records can be made aliases without changing offsets.
    for (let offset = 0; offset < duplicate.length - 10; offset++) {
      if (decode(duplicate.subarray(offset, offset + 10)) === 'scene.jsox') duplicate[offset + 9] = 'n'.charCodeAt(0)
    }
    await expect(importProjectV2(blob(duplicate))).rejects.toThrow('重复路径')
    const stored = zipSync(await unpack(), { level: 0 })
    const view = new DataView(stored.buffer)
    const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    stored[dataStart] ^= 1
    await expect(importProjectV2(blob(stored))).rejects.toThrow('CRC')
    const renamed = zipSync(await unpack(), { level: 0 }); renamed[30] ^= 1
    await expect(importProjectV2(blob(renamed))).rejects.toThrow('本地路径')
  })

  it('rejects duplicate decoded JSON keys and cumulative JSON budgets', async () => {
    const files = await unpack()
    files['manifest.json'] = encode(decode(files['manifest.json']).replace('"containerVersion":2', '"containerVersion":1,"\\u0063ontainerVersion":2'))
    await expect(importProjectV2(blob(zipSync(files)))).rejects.toThrow('重复字段')
    expect(() => parseBoundedJson(encode('{"a":1,"\\u0061":2}'))).toThrow('重复字段')
    expect(() => parseBoundedJson(encode('[1]'), { values: PROJECT_LIMITS_V2.jsonValues - 1 })).toThrow('累计节点')
    expect(() => parseBoundedJson(encode('['.repeat(130) + '0' + ']'.repeat(130)))).toThrow('深度')
  })

  it('stops forged inflation before accepting output larger than a tiny declaration', async () => {
    const packed = new Uint8Array(await (await exportProjectV2(emptyProject())).arrayBuffer()), view = new DataView(packed.buffer)
    for (let cursor = 0; cursor < packed.length - 46; cursor++) {
      if (view.getUint32(cursor, true) === 0x02014b50 && decode(packed.subarray(cursor + 46, cursor + 56)) === 'scene.json') {
        const local = view.getUint32(cursor + 42, true)
        view.setUint32(cursor + 24, 10, true); view.setUint32(local + 22, 10, true)
        break
      }
    }
    // Import notices the manifest disagreement; direct bounded reading also stops actual overflow.
    await expect(importProjectV2(blob(packed))).rejects.toThrow('长度不一致')
    const bounded = await inspectZipV2(blob(packed))
    await expect(bounded.read('scene.json')).rejects.toThrow('实际展开量')
  })

  it('rejects cancellation without changing the input and does not export migration originals', async () => {
    const project = emptyProject(), original = encode(JSON.stringify(createHouse('migration-origin')))
    project.migrationSource = { sourceSchemaVersion: 1, sourceSceneId: 'migration-origin', sourceRevision: 0,
      sourceHash: await sha256Bytes(original), migratorVersion: 'test-1', migratedAt: '2026-10-20T00:00:00.000Z', original: blob(original) }
    const files = unzipSync(new Uint8Array(await (await exportProjectV2(project)).arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'scene.json'])
    const controller = new AbortController(); controller.abort()
    await expect(exportProjectV2(project, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(importProjectV2(blob(zipSync(files)), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(project.document.sceneId).toBe('package-v2')
  })
})
