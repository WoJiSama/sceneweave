/** Independent one-time reader of historical personal-library capsules. */
import type { CompleteValidationOptions } from '../ports/resources.js'
import type { ProjectBundle } from '../model/project.js'
import { checkCancelled } from '../ports/resources.js'
import { inspectZip } from '../project/zip.js'
import { parseBoundedJson } from '../project/json.js'
import { readProjectManifest } from '../project/file.js'
import { sha256Bytes, decodeUtf8 } from '../project/binary.js'
import { createMemoryResources, validateProjectBundle } from '../project/resources.js'
import { readLegacyDevelopmentProject, convertDevelopmentProject } from './development-project.js'
import { projectSourceRecords } from '../project/source-resources.js'

export async function readDevelopmentCapsule(input: Uint8Array, options: CompleteValidationOptions): Promise<ProjectBundle> {
  const zip = inspectZip(input, options.signal), budget = { values: 0 }
  const raw = parseBoundedJson(await zip.read('manifest.json'), budget) as { schemaVersion?: unknown }
  if (!raw || !Number.isSafeInteger(raw.schemaVersion) || Number(raw.schemaVersion) < 1 || Number(raw.schemaVersion) > 8) throw new Error('旧素材胶囊版本无效。')
  // Reuse current manifest path/role/size policy, never its normal project reader.
  const manifest = readProjectManifest({ ...raw, schemaVersion: 1 })
  if (manifest.packageMode !== 'complete') throw new Error('个人素材胶囊不能携带历史包。')
  const paths = new Set(['manifest.json', ...manifest.entries.map(row => row.path)])
  if (paths.size !== zip.entries.size || [...paths].some(path => !zip.entries.has(path))) throw new Error('旧胶囊含未声明或缺失路径。')
  const files = new Map<string, Uint8Array>(), resources = new Map<string, Uint8Array>()
  const licenses: Record<string, { sha256: string; text: string }> = {}
  for (const entry of manifest.entries) {
    checkCancelled(options.signal)
    const bytes = await zip.read(entry.path)
    if (zip.entries.get(entry.path)!.expanded !== entry.sizeBytes || bytes.length !== entry.sizeBytes || sha256Bytes(bytes) !== entry.sha256) throw new Error('旧胶囊真实长度/hash不符。')
    files.set(entry.path, bytes)
    if (entry.role === 'asset' || entry.role === 'source') {
      if (resources.has(entry.sha256)) throw new Error('旧胶囊资源重复。')
      resources.set(entry.sha256, bytes)
      if (entry.role === 'asset' && (manifest.assetRecords[entry.sha256]?.sizeBytes !== bytes.length || manifest.assetRecords[entry.sha256]?.mimeType !== entry.mimeType)) throw new Error('旧胶囊资源元数据不符。')
    } else if (entry.role === 'license') licenses[entry.sha256] = { sha256: entry.sha256, text: decodeUtf8(bytes) }
  }
  const json = (name: string) => { const bytes = files.get(name); if (!bytes) throw new Error('旧胶囊缺少完整JSON。'); return parseBoundedJson(bytes, budget) }
  const legacy = readLegacyDevelopmentProject({ format: manifest.format, schemaVersion: raw.schemaVersion,
    document: json('scene.json'), historyIdentity: json('identity.json'), appearance: json('appearance.json'), authoringSources: json('sources.json'),
    assets: manifest.assetRecords, licenses, licenseBindings: manifest.licenseBindings })
  if (legacy.document.sceneId !== manifest.sceneId || legacy.document.revision !== manifest.revision) throw new Error('旧胶囊场景身份不符。')
  const project = convertDevelopmentProject(legacy)
  const used = new Set([...Object.keys(project.assets), ...projectSourceRecords(project).keys()])
  if (used.size !== resources.size || [...resources.keys()].some(hash => !used.has(hash))) throw new Error('旧胶囊资源闭包不精确。')
  return validateProjectBundle({ project, resources: createMemoryResources(resources) }, options)
}
