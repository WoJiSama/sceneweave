import { z } from 'zod'
import data from './scenes-data.json'
import { loadFixedResources, type ContentLoadOptions } from './load-resources.js'
export type { ContentLoadProgress } from './load-resources.js'
import { runtime, validation } from '../runtime.js'
import type { ProjectData } from '../../../shared/model/project.js'
import { createHistoryIdentity } from '../../../shared/history/identity.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { captureJson, freezeJson } from '../../../shared/validation/json.js'
import { fromBundle, type EditableProject } from '../../../application/workspace/project.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'

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
  project.schemaVersion = 2
  project.document.schemaVersion = 2
  project.document.visual = emptyVisualSystem()
  project.historyIdentity = createHistoryIdentity(project.document, runtime)
  return complete(project, signal, onProgress)
}
