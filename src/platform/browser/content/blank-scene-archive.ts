import archive, { development } from 'virtual:sceneweave-blank-scene'
import type { ProjectData } from '../../../shared/model/project.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { inspectBoundedZip } from '../../../shared/project/zip.js'
import { downloadBlankScene } from './blank-scene-download.js'
import { captureJson } from '../../../shared/validation/json.js'
import { loadFixedResources, type ContentLoadOptions } from './load-resources.js'

export async function loadStarterBlankContent(signal?: AbortSignal, onProgress?: ContentLoadOptions['onProgress'],
  preloadedArchive?: Promise<Uint8Array>) {
  if (import.meta.env.PROD) return loadBlankSceneArchive(signal, onProgress, preloadedArchive)
  const project = captureJson(development.project)
  const resources = await loadFixedResources(project.assets, development.paths, {}, { signal, onProgress })
  return { project, resources }
}

export async function loadBlankSceneArchive(signal?: AbortSignal, onProgress?: ContentLoadOptions['onProgress'],
  preloadedArchive?: Promise<Uint8Array>) {
  signal?.throwIfAborted()
  onProgress?.({ phase: 'resources', completed: 0, total: 1 })
  const bytes = await (preloadedArchive ?? downloadBlankScene(signal))
  signal?.throwIfAborted()
  if (bytes.byteLength !== archive.bytes || sha256Bytes(bytes) !== archive.sha256) throw new Error('空白场景素材包不完整或摘要不一致。')
  const zip = inspectBoundedZip(bytes, {
    pathBudget: name => name === 'template.json' ? PACKAGE_LIMITS.sceneBytes : /^assets\/[a-f0-9]{64}\.png$/.test(name) ? PACKAGE_LIMITS.imageBytes : 0,
    requiredPaths: ['template.json'],
    documentPath: name => name === 'template.json',
  }, signal)
  const project = parseBoundedJson(await zip.read('template.json')) as ProjectData
  const assets = Object.entries(project.assets)
  if (assets.length + 1 !== zip.entries.size || assets.length > PACKAGE_LIMITS.uniqueImages) throw new Error('空白场景素材包条目不完整。')
  const resources = new Map<string, Uint8Array>()
  for (const [hash, record] of assets) {
    const bytes = await zip.read(`assets/${hash}.png`)
    if (bytes.byteLength !== record.sizeBytes) throw new Error('空白场景素材实际字节长度不匹配。')
    resources.set(hash, bytes)
  }
  signal?.throwIfAborted()
  onProgress?.({ phase: 'resources', completed: 1, total: 1 })
  return { project, resources }
}
