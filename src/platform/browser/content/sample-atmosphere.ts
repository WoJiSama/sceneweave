import { applyCommands, type SceneCommand } from '../../../shared/commands/commands.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { canonicalJson, freezeJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { visualBase } from '../../../shared/visual/base.js'
import { emptyVisualSystem, type VisualEnvironment, type VisualFilter, type VisualFog } from '../../../shared/visual/types.js'

/** Construction recipes are separate from the five editable atmosphere presets.
 * Their complete parameters persist in the new sample, never in an open hook. */
export const SAMPLE_ATMOSPHERE_PROFILES = freezeJson({
  'outpost-daylight': {
    name: '哨站清朗日光', version: 1,
    environment: { ambientColor: '#FFF8E9', ambientOpacity: .018, exposure: 1.02,
      lightDirectionDeg: 135, contactShadowMm: 80, contactShadowOpacity: .13 },
  },
  'island-daylight': {
    name: '岩岛清朗日光', version: 1,
    environment: { ambientColor: '#FFFAEE', ambientOpacity: .012, exposure: 1.025,
      lightDirectionDeg: 50, contactShadowMm: 60, contactShadowOpacity: .18 },
  },
} satisfies Record<string, { name: string; version: number; environment: VisualEnvironment }>)

export type SampleAtmosphereProfileId = keyof typeof SAMPLE_ATMOSPHERE_PROFILES
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const baselineError = () => new Error('样板氛围只用于新建的明确基线；不覆盖已有人工、私密或其他氛围效果。')
const islandEnvironment: VisualEnvironment = {
  ambientColor: '#E8E7C9', ambientOpacity: .025, exposure: 1.02,
  lightDirectionDeg: 50, contactShadowMm: 55, contactShadowOpacity: .2,
}
// Exact source-recipe witnesses include identity, visibility, locks, geometry,
// seeds and every paint parameter. A matching ID alone grants no replacement.
const islandFilter: VisualFilter = {
  id: 'q1-paper-tone', floorId: 'visual-floor', layerId: 'visual-layer-effects', visibility: 'public', editLocked: false,
  target: { kind: 'scene' }, preset: 'warm', exposure: 1.01, saturation: 1.03, contrast: 1.04,
  vignette: .025, grain: .012, seed: 'q1-paper-1', enabled: true,
}
const islandFog: VisualFog = {
  id: 'q1-water-haze', floorId: 'visual-floor', layerId: 'visual-layer-effects', visibility: 'public', editLocked: false,
  boundaryMm: [{ x: 800, y: 14900 }, { x: 6600, y: 15400 }, { x: 10800, y: 16200 }, { x: 11400, y: 17700 }, { x: 800, y: 17700 }],
  color: '#D9E8CF', opacity: .035, directionDeg: 12, scaleMm: 1900, seed: 'q1-water-haze-1', enabled: true,
}

/** Returns a detached, fully checked new construction. Existing fixed artwork,
 * geometry, support and the input document remain intact on success or failure.
 * Ordinary visual commands retain dependency locks and the transaction budget. */
export function applySampleAtmosphere(scene: SceneDocument, profile: SampleAtmosphereProfileId): SceneDocument {
  if (!Object.hasOwn(SAMPLE_ATMOSPHERE_PROFILES, profile)) throw new Error('未知样板氛围配方。')
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`样板氛围基线无效：${checked.errors.map(issue => issue.message).join('；')}`)
  const source = checked.document, visual = visualBase(source), preset = source.presetSnapshot
  if (source.mapMode !== 'scene' || Object.keys(source.floors).length !== 1 || !visual) {
    throw new Error('样板氛围只支持单 Floor 场景；环境与调色尚未按楼层隔离。')
  }
  const commands: SceneCommand[] = []
  if (profile === 'outpost-daylight') {
    if (preset.presetId !== 'sceneweave-outpost-layout' || preset.presetVersion !== 1
      || !same(visual.environment, emptyVisualSystem().environment)
      || Object.keys(visual.filters).length || Object.keys(visual.fogs).length || Object.keys(visual.lights).length) throw baselineError()
  } else {
    if (!['sceneweave-refined-island', 'sceneweave-detailed-island'].includes(preset.presetId) || preset.presetVersion !== 1
      || !same(visual.environment, islandEnvironment) || !same(visual.filters, { [islandFilter.id]: islandFilter })
      || !same(visual.fogs, { [islandFog.id]: islandFog }) || Object.keys(visual.lights).length) throw baselineError()
    commands.push({ type: 'removeVisualEffect', kind: 'filter', id: islandFilter.id },
      { type: 'removeVisualEffect', kind: 'fog', id: islandFog.id })
  }
  commands.push({ type: 'setVisualEnvironment', environment: { ...SAMPLE_ATMOSPHERE_PROFILES[profile].environment } })
  return applyCommands(source, commands, {
    ids: { nextId: () => { throw new Error('样板氛围不能创建额外身份。') } }, clock: { now: () => source.updatedAt },
  })
}
