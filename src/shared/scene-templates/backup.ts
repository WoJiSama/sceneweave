import { zipSync } from 'fflate'
import { z } from 'zod'
import type { CompleteValidationOptions } from '../ports/resources.js'
import { checkCancelled } from '../ports/resources.js'
import { captureBytes, sha256Bytes } from '../project/binary.js'
import { inspectBoundedZip } from '../project/zip.js'
import { parseBoundedJson } from '../project/json.js'
import { encodeUtf8 } from '../validation/json.js'
import { captureSceneTemplateEntries, loadSceneTemplate, SCENE_TEMPLATE_LIMITS, type SceneTemplateEntry } from './content.js'

const manifestSchema = z.object({ format: z.literal('sceneweave-scene-template-library'), schemaVersion: z.literal(1), entries: z.array(z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(80) }).strict()).min(1).max(32) }).strict()
export async function exportSceneTemplateBackup(entries: readonly SceneTemplateEntry[], validation: CompleteValidationOptions): Promise<Uint8Array> {
  if (!entries.length || entries.length > 32) throw new Error('请选择1–32个模板备份。')
  const captured = captureSceneTemplateEntries(entries)
  if (new Set(captured.map(row => row.key)).size !== captured.length || captured.reduce((sum, row) => sum + row.bytes.length, 0) > 64 * 1024 * 1024) throw new Error('模板备份重复或超过64MiB。')
  const files: Record<string, Uint8Array> = {}
  for (const row of captured) {
    if (sha256Bytes(row.bytes) !== row.key || (await loadSceneTemplate(row.bytes, validation)).project.document.title !== row.name) throw new Error('模板实际内容与条目不符。')
    files[`${row.key}.sceneweave`] = row.bytes
  }
  files['templates.json'] = encodeUtf8(JSON.stringify(manifestSchema.parse({ format: 'sceneweave-scene-template-library', schemaVersion: 1, entries: captured.map(({ key, name }) => ({ key, name })) })))
  checkCancelled(validation.signal)
  return zipSync(files, { level: 0 })
}
export async function importSceneTemplateBackup(input: Uint8Array, validation: CompleteValidationOptions): Promise<SceneTemplateEntry[]> {
  const bytes = captureBytes(input, 65 * 1024 * 1024), zip = inspectBoundedZip(bytes, { requiredPaths: ['templates.json'], documentPath: name => name === 'templates.json',
    pathBudget: name => { if (name === 'templates.json') return 32768; if (/^[a-f0-9]{64}\.sceneweave$/.test(name)) return SCENE_TEMPLATE_LIMITS.bytes; throw new Error('模板备份含未知路径。') } }, validation.signal)
  const manifest = manifestSchema.parse(parseBoundedJson(await zip.read('templates.json')))
  if (new Set(manifest.entries.map(row => row.key)).size !== manifest.entries.length || zip.entries.size !== manifest.entries.length + 1) throw new Error('模板备份清单与条目不符。')
  const entries: SceneTemplateEntry[] = []; let total = 0
  for (const row of manifest.entries) {
    const bytes = await zip.read(`${row.key}.sceneweave`)
    if ((total += bytes.length) > 64 * 1024 * 1024 || sha256Bytes(bytes) !== row.key || (await loadSceneTemplate(bytes, validation)).project.document.title !== row.name) throw new Error('模板备份实际字节、名称或预算不符。')
    entries.push({ ...row, bytes })
  }
  checkCancelled(validation.signal); return entries
}
