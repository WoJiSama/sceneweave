import { z } from 'zod'
import data from './scenes-data.json'
import { loadFixedResources, type ContentLoadOptions } from './load-resources.js'
export type { ContentLoadProgress } from './load-resources.js'
import { runtime, validation } from '../runtime.js'
import type { ProjectData } from '../../../shared/model/project.js'
import { createHistoryIdentity } from '../../../shared/history/identity.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { canonicalJson, captureJson, freezeJson } from '../../../shared/validation/json.js'
import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { toCurrentSceneDocument } from '../../../shared/model/current-scene.js'
import { projectResourceHashes } from '../../../shared/project/source-resources.js'
import { namespaceMixedInteriorCatalogue } from './mixed-palette.js'

export type SampleKind = 'study' | 'island' | 'outpost' | 'calibration' | 'graveyard' | 'volcano'
export const BLANK_PRESETS = [
  { id: 'investigation', name: '调查', gridSizeMm: 1000, snapMm: 100, gridVisible: false, display: 'm', distanceMode: 'metric' },
  { id: 'tactical', name: '战术', gridSizeMm: 1524, snapMm: 254, gridVisible: true, display: 'ft', distanceMode: 'grid' },
  { id: 'narrative', name: '叙事', gridSizeMm: 1000, snapMm: 100, gridVisible: false, display: 'm', distanceMode: 'abstract' },
] as const
export interface BlankOptions { title: string; widthMm: number; heightMm: number; preset: typeof BLANK_PRESETS[number]['id']; gridVisible?: boolean; sceneId?: string; now?: string }
const side = z.number().int().min(1000).max(200000)
const optionsSchema = z.object({ title: z.string().trim().min(1).max(120), widthMm: side, heightMm: side,
  preset: z.enum(['investigation', 'tactical', 'narrative']), gridVisible: z.boolean().optional(),
  sceneId: z.string().min(1).max(256).refine(value => value !== '__proto__').optional(), now: z.string().datetime().optional(),
}).strict().refine(value => Math.max(value.widthMm, value.heightMm) / Math.min(value.widthMm, value.heightMm) <= 20, '画布长宽比最多为20:1。')
const fixed = freezeJson(captureJson(data))

async function complete(project: ProjectData, signal?: AbortSignal, onProgress?: ContentLoadOptions['onProgress']): Promise<EditableProject> {
  signal?.throwIfAborted()
  const bytes = await loadFixedResources(project.assets, fixed.paths as Record<string, string>, fixed.embedded as Record<string, string>, { signal, onProgress })
  signal?.throwIfAborted()
  onProgress?.({ phase: 'validation', completed: 0, total: bytes.size })
  const editable = await fromBundle({ project, resources: createMemoryResources(bytes) }, { ...validation, signal })
  signal?.throwIfAborted()
  onProgress?.({ phase: 'validation', completed: bytes.size, total: bytes.size })
  signal?.throwIfAborted()
  return editable
}

/** Native fixed templates were independently extracted and pixel-validated; no old factory runs in the editor. */
export async function createSampleProject(sample: SampleKind, signal?: AbortSignal, onProgress?: ContentLoadOptions['onProgress']): Promise<EditableProject> {
  if (!['study', 'island', 'outpost', 'calibration', 'graveyard', 'volcano'].includes(sample)) throw new Error('未知样板。')
  const project = captureJson(fixed.scenes[sample]) as unknown as ProjectData, now = runtime.clock.now()
  Object.assign(project.document, { sceneId: runtime.ids.nextId(), revision: 0, createdAt: now, updatedAt: now })
  project.schemaVersion = 1
  project.document = toCurrentSceneDocument(project.document)
  project.appearance = { ...project.appearance, version: 2, presentations: Object.fromEntries(Object.values(project.appearance.sources).filter(source => source.kind === 'prop').map(source => [source.id, { mode: 'topDown' as const, rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround' as const, groundShadowMm: null }])) }
  project.historyIdentity = createHistoryIdentity(project.document, runtime)
  return complete(project, signal, onProgress)
}

/** Same 34-image/37-item preinstallation and creation bounds as the previous primary workspace. */
export async function createBlankProject(input: BlankOptions, signal?: AbortSignal, onProgress?: ContentLoadOptions['onProgress']): Promise<EditableProject> {
  const options = optionsSchema.parse(captureJson(input)), preset = BLANK_PRESETS.find(value => value.id === options.preset)!
  const project = captureJson(fixed.scenes.blank) as unknown as ProjectData, now = options.now ?? runtime.clock.now()
  const bounds = { x: 0, y: 0, width: options.widthMm, height: options.heightMm }, floor = Object.values(project.document.floors)[0]
  Object.assign(project.document, { sceneId: options.sceneId ?? runtime.ids.nextId(), revision: 0, title: options.title, createdAt: now, updatedAt: now, exportBoundsMm: { ...bounds } })
  floor.boundsMm = { ...bounds }
  project.document.units = { world: 'mm', display: preset.display, gridSizeMm: preset.gridSizeMm, snapMm: preset.snapMm, gridVisible: options.gridVisible ?? preset.gridVisible }
  project.document.presetSnapshot = { presetId: preset.id, presetVersion: 1, distanceMode: preset.distanceMode, source: `Sceneweave 通用${preset.name}偏好；非官方规则`, gridSizeMm: preset.gridSizeMm }
  project.schemaVersion = 1
  project.document = toCurrentSceneDocument(project.document)
  project.appearance = { ...project.appearance, version: 2, presentations: Object.fromEntries(Object.values(project.appearance.sources).filter(source => source.kind === 'prop').map(source => [source.id, { mode: 'topDown' as const, rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround' as const, groundShadowMm: null }])) }
  project.historyIdentity = createHistoryIdentity(project.document, runtime)
  return complete(project, signal, onProgress)
}

/** An empty current project carrying only the exact existing volcanic palette.
 * Sample geometry, generated records, props and sample appearance never enter it. */
export async function createVolcanoBlankProject(input: BlankOptions, signal?: AbortSignal, onProgress?: ContentLoadOptions['onProgress']): Promise<EditableProject> {
  const options = optionsSchema.parse(captureJson(input)), preset = BLANK_PRESETS.find(value => value.id === options.preset)!
  signal?.throwIfAborted()
  const project = captureJson(fixed.scenes.blank) as unknown as ProjectData
  const palette = fixed.scenes.volcano as unknown as ProjectData, now = options.now ?? runtime.clock.now()
  const document = toCurrentSceneDocument(project.document)
  const bounds = { x: 0, y: 0, width: options.widthMm, height: options.heightMm }
  Object.assign(document, { sceneId: options.sceneId ?? runtime.ids.nextId(), revision: 0, title: options.title, createdAt: now, updatedAt: now, exportBoundsMm: { ...bounds } })
  Object.values(document.floors)[0].boundsMm = { ...bounds }
  document.units = { world: 'mm', display: preset.display, gridSizeMm: preset.gridSizeMm, snapMm: preset.snapMm, gridVisible: options.gridVisible ?? preset.gridVisible }
  document.presetSnapshot = { presetId: preset.id, presetVersion: 1, distanceMode: preset.distanceMode, source: `Sceneweave 通用${preset.name}偏好；固定火山素材空白基底；非官方规则`, gridSizeMm: preset.gridSizeMm }
  document.assets = {}; document.materials = {}; document.propDefinitions = {}; document.prefabDefinitions = {}; document.styleThemes = {}; document.activeStyleThemeRef = null
  project.assets = {}; project.licenses = {}; project.licenseBindings = []; project.authoringSources = {}
  const subjects = new Set<string>()
  for (const id of ['content-m-basalt', 'content-m-volcanic-ash', 'content-m-lava', 'content-m-lava-hot']) {
    const material = palette.document.materials[id]
    if (!material || material.version !== 1 || !material.textureAssetId) throw new Error('固定火山材质缺失或版本不同。')
    const asset = palette.document.assets[material.textureAssetId], record = asset && palette.assets[asset.sha256]
    if (!asset || !record) throw new Error('固定火山素材闭包缺失。')
    document.materials[id] = captureJson(material); document.assets[asset.id] = captureJson(asset)
    project.assets[asset.sha256] = captureJson(record)
    subjects.add(`material:${id}`); subjects.add(`asset:${asset.id}`)
  }
  for (const binding of palette.licenseBindings) if (subjects.has(`${binding.subjectKind}:${binding.subjectId}`)) {
    const hash = binding.licensePath.slice('licenses/'.length, -'.txt'.length), license = palette.licenses[hash]
    if (!license) throw new Error('固定火山许可文本缺失。')
    project.licenseBindings.push(captureJson(binding)); project.licenses[hash] = captureJson(license)
  }
  Object.assign(project, createCompositionContent(document, runtime), { schemaVersion: 1 })
  return complete(project, signal, onProgress)
}

/** Merge independently validated fixed catalogues into one empty project. No
 * scene geometry, instance source, history or sample ownership is transferred. */
export async function createMixedBlankProject(environment: 'forest' | 'volcano', input: BlankOptions, signal?: AbortSignal): Promise<EditableProject> {
  const options = optionsSchema.parse(captureJson(input))
  if (environment !== 'forest' && environment !== 'volcano') throw new Error('混合场景暂支持森林或火山。')
  signal?.throwIfAborted()
  const { createRefinedBlankProject } = await import('./refined-blank.js')
  const interior = await createRefinedBlankProject('interior', options, signal)
  const outdoor = environment === 'volcano' ? await createVolcanoBlankProject(options, signal)
    : await (await import('./shore-blank.js')).createShoreBlankProject('island', options, signal, true, true)
  signal?.throwIfAborted()
  const { resources: _resources, ...metadata } = interior
  const project = captureJson(metadata) as ProjectData
  namespaceMixedInteriorCatalogue(project)
  const merge = <T>(target: Record<string, T>, source: Record<string, T>) => {
    for (const [id, value] of Object.entries(source)) {
      if (Object.hasOwn(target, id) && canonicalJson(target[id]) !== canonicalJson(value)) throw new Error(`混合固定素材身份冲突：${id}`)
      target[id] = captureJson(value)
    }
  }
  for (const key of ['assets', 'materials', 'propDefinitions', 'prefabDefinitions', 'styleThemes'] as const) {
    merge(project.document[key] as Record<string, unknown>, outdoor.document[key])
  }
  merge(project.assets, outdoor.assets); merge(project.licenses, outdoor.licenses); merge(project.authoringSources, outdoor.authoringSources)
  const bindingBySubject = new Map(project.licenseBindings.map(row => [`${row.subjectKind}:${row.subjectId}`, row]))
  for (const row of outdoor.licenseBindings) {
    const key = `${row.subjectKind}:${row.subjectId}`, existing = bindingBySubject.get(key)
    if (existing && canonicalJson(existing) !== canonicalJson(row)) throw new Error(`混合固定许可绑定冲突：${key}`)
    if (!existing) { const captured = captureJson(row); bindingBySubject.set(key, captured); project.licenseBindings.push(captured) }
  }
  const bytes = new Map<string, Uint8Array>()
  for (const source of [interior, outdoor]) for (const hash of projectResourceHashes(source)) {
    signal?.throwIfAborted()
    const value = await source.resources.read(hash), previous = bytes.get(hash)
    if (previous && (previous.length !== value.length || previous.some((byte, index) => byte !== value[index]))) throw new Error('混合资源同hash字节不一致。')
    bytes.set(hash, value)
  }
  Object.assign(project, createCompositionContent(project.document, runtime))
  signal?.throwIfAborted()
  return fromBundle({ project, resources: createMemoryResources(bytes) }, { ...validation, signal })
}
