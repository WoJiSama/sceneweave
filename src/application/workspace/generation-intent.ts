import type { InteriorLayoutParameters, InteriorGenerationInput } from '../../shared/generation/domains/interior/contracts.js'
import { forestRectangle } from '../../shared/generation/domains/forest/index.js'
import type { ForestGenerationInput, ForestVegetation } from '../../shared/generation/domains/forest/contracts.js'
import type { VolcanoGenerationInput } from '../../shared/generation/domains/volcano/contracts.js'
import type { MixedGenerationInput } from '../../shared/generation/domains/mixed/contracts.js'
import type { TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { checkCancelled, type ResourceOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { captureJson, freezeJson } from '../../shared/validation/json.js'
import type { EditableProject } from './project.js'

export interface InteriorGenerationUiRequest {
  title: string
  widthMm: number
  heightMm: number
  seed: string
  wallThicknessMm: number
  rooms: InteriorLayoutParameters['rooms']
  relations: InteriorLayoutParameters['relations']
  corridor: InteriorLayoutParameters['corridor']
  arrangement: Omit<InteriorLayoutParameters['arrangement'], 'palette'>
}
export interface ForestGenerationUiRequest {
  title: string
  widthMm: number
  heightMm: number
  seed: string
  clearings: Array<{ id: string; boundsMm: { x: number; y: number; width: number; height: number } }>
  entranceSide: 'west' | 'east' | 'north' | 'south'
  routeWidthMm: number
  treeCoveragePpm: number
  shrubCoveragePpm: number
  grassCoveragePpm: number
}
export interface VolcanoGenerationUiRequest {
  title: string; widthMm: number; heightMm: number; seed: string
  mountainElevationMm: number; craterElevationMm: number
  craterWidthPercent: number; craterHeightPercent: number; craterCenterYPercent: number
  routeWidthMm: number; connectionKind: 'stairs' | 'ramp'
  craterHazard: boolean; craterBlocksMovement: boolean; craterMovementCostMultiplier: number
  flowEnabled: boolean; flowWidthMm: number; lavaAppearance: 'cold' | 'hot'
  flowHazard: boolean; flowBlocksMovement: boolean; flowMovementCostMultiplier: number
}
export interface MixedGenerationUiRequest {
  title: string; environment: 'forest' | 'volcano'; widthMm: number; heightMm: number; seed: string
  roomCount: number; purpose: string; furniture: boolean; vegetationMultiplier: number
  algorithmVersion?: MixedGenerationInput['algorithmVersion']
}

export interface GenerationIntentRequests {
  interior: InteriorGenerationUiRequest
  forest: ForestGenerationUiRequest
  volcano: VolcanoGenerationUiRequest
  mixed: MixedGenerationUiRequest
}
export interface GenerationIntentInputs {
  interior: InteriorGenerationInput
  forest: ForestGenerationInput
  volcano: VolcanoGenerationInput
  mixed: MixedGenerationInput
}
export type GenerationIntentDomain = keyof GenerationIntentRequests
export type GenerationIntent<K extends GenerationIntentDomain = GenerationIntentDomain> = {
  [D in K]: { domain: D; request: GenerationIntentRequests[D] }
}[K]
export type PreparedGenerationIntent<K extends GenerationIntentDomain = GenerationIntentDomain> = {
  [D in K]: { kind: 'new-project'; domain: D; base: EditableProject; input: GenerationIntentInputs[D]; profile: TaskBudgetProfile }
}[K]
export interface GenerationBaseIntent {
  title: string; widthMm: number; heightMm: number; sceneId: string; seed: string
  preset: 'narrative'; gridVisible: false
}
type MaterialRef = VolcanoGenerationInput['parameters']['materials']['flow']
export interface GenerationContentPort {
  interior(input: GenerationBaseIntent, options: ResourceOptions): Promise<{
    base: EditableProject; palette: InteriorLayoutParameters['arrangement']['palette']
  }>
  forest(input: GenerationBaseIntent, options: ResourceOptions): Promise<{
    base: EditableProject; groundMaterial: MaterialRef; routeMaterial: MaterialRef
    palettes: Record<'tree' | 'shrub' | 'grass', ForestVegetation['palette']>
  }>
  volcano(input: GenerationBaseIntent, options: ResourceOptions): Promise<{
    base: EditableProject; defaults: VolcanoGenerationInput; flowMaterials: Record<'cold' | 'hot', MaterialRef>
  }>
  mixed(input: GenerationBaseIntent & { environment: 'forest' | 'volcano' }, options: ResourceOptions): Promise<{
    base: EditableProject; defaults: MixedGenerationInput
  }>
}
export interface GenerationIntentOptions extends ResourceOptions {
  runtime: PreparationContext
  content: GenerationContentPort
  selectBudget(input: { widthMm: number; heightMm: number; quality: 'standard'; mode: 'auto' }): TaskBudgetProfile
}

function groundLayer(base: EditableProject, label: string) {
  const floor = Object.values(base.document.floors)[0]
  const layer = floor && Object.values(base.document.userLayers).find(value => value.floorId === floor.id)
  if (!floor || !layer) throw new Error(`${label}缺少可用的地面图层。`)
  return { floor, layer }
}

/** Capture user intent before loading fixed content. This only prepares a
 * request: Workspace still owns validation, candidate leases and adoption. */
export function prepareGenerationIntent<K extends GenerationIntentDomain>(intent: GenerationIntent<K> & { domain: K }, options: GenerationIntentOptions): Promise<PreparedGenerationIntent<K>>
export async function prepareGenerationIntent(raw: GenerationIntent, options: GenerationIntentOptions): Promise<PreparedGenerationIntent> {
  checkCancelled(options.signal)
  const intent = captureJson(raw), dimensions = { widthMm: intent.request.widthMm, heightMm: intent.request.heightMm }
  if (!['interior', 'forest', 'volcano', 'mixed'].includes(intent.domain)) throw new Error('此生成意图尚未支持。')
  const baseIntent: GenerationBaseIntent = freezeJson({ title: intent.request.title, ...dimensions, sceneId: options.runtime.ids.nextId(),
    seed: intent.request.seed, preset: 'narrative' as const, gridVisible: false as const })
  const resourceOptions = { signal: options.signal }
  const profile = () => {
    checkCancelled(options.signal)
    return options.selectBudget({ ...dimensions, quality: 'standard', mode: 'auto' })
  }
  switch (intent.domain) {
    case 'interior': {
      const owned = intent.request, content = await options.content.interior(baseIntent, resourceOptions)
      checkCancelled(options.signal)
      const { floor, layer } = groundLayer(content.base, '室内布局'), palette = captureJson(content.palette)
      return { kind: 'new-project', domain: 'interior', base: content.base, profile: profile(), input: {
        version: 1, algorithmVersion: 3, seed: owned.seed, parameters: {
          floorId: floor.id, layerId: layer.id, boundsMm: { ...floor.boundsMm }, wallThicknessMm: owned.wallThicknessMm,
          rooms: owned.rooms, relations: owned.relations, corridor: owned.corridor,
          materials: { floor: null, wall: null }, arrangement: { ...owned.arrangement, palette },
        },
      } }
    }
    case 'forest': {
      const owned = intent.request, content = await options.content.forest(baseIntent, resourceOptions)
      checkCancelled(options.signal)
      const { floor, layer } = groundLayer(content.base, '森林与营地'), bounds = floor.boundsMm
      const selectedProfile = profile(), inset = Math.ceil(owned.routeWidthMm / 2) + 300
      const centre = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
      const positionMm = owned.entranceSide === 'west' ? { x: bounds.x + inset, y: centre.y }
        : owned.entranceSide === 'east' ? { x: bounds.x + bounds.width - inset, y: centre.y }
          : owned.entranceSide === 'north' ? { x: centre.x, y: bounds.y + inset } : { x: centre.x, y: bounds.y + bounds.height - inset }
      const directionDeg = { west: 0, north: 90, east: 180, south: 270 }[owned.entranceSide], supportRef = { kind: 'generated-ground' as const }
      const clearings = owned.clearings.map(row => {
        const rectangle = { ...row.boundsMm, x: bounds.x + row.boundsMm.x, y: bounds.y + row.boundsMm.y }
        return { id: row.id, supportRef, boundaryMm: forestRectangle(rectangle), anchorMm: { x: Math.round(rectangle.x + rectangle.width / 2), y: Math.round(rectangle.y + rectangle.height / 2) }, clearanceMm: 300 }
      })
      return { kind: 'new-project', domain: 'forest', base: content.base, profile: selectedProfile, input: { version: 1, algorithmVersion: 1, seed: owned.seed, parameters: {
        floorId: floor.id, layerId: layer.id, boundsMm: { ...bounds }, ground: { kind: 'new', elevationMm: 0, materialRef: captureJson(content.groundMaterial) },
        zones: [{ id: 'woodland', supportRef, boundaryMm: forestRectangle(bounds), vegetation: [
          { role: 'tree', coveragePpm: owned.treeCoveragePpm, spacingMm: 2500, clusterRadiusMm: 6000, clearanceMm: 200, palette: captureJson(content.palettes.tree) },
          { role: 'shrub', coveragePpm: owned.shrubCoveragePpm, spacingMm: 800, clusterRadiusMm: 4000, clearanceMm: 180, palette: captureJson(content.palettes.shrub) },
          { role: 'grass', coveragePpm: owned.grassCoveragePpm, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 180, palette: captureJson(content.palettes.grass) },
        ] }], clearings, entrances: [{ id: 'entry', supportRef, positionMm, directionDeg, widthMm: owned.routeWidthMm }],
        routes: clearings.map(row => ({ id: `route:${row.id}`, fromEntranceId: 'entry', toClearingId: row.id, viaMm: [], widthMm: owned.routeWidthMm, materialRef: captureJson(content.routeMaterial) })),
      } } }
    }
    case 'volcano': {
      const owned = intent.request, content = await options.content.volcano(baseIntent, resourceOptions)
      checkCancelled(options.signal)
      const input = captureJson(content.defaults), p = input.parameters, bounds = p.boundsMm
      p.mountain.elevationMm = owned.mountainElevationMm
      Object.assign(p.crater, { elevationMm: owned.craterElevationMm, hazard: owned.craterHazard, blocksMovement: owned.craterBlocksMovement, movementCostMultiplier: owned.craterMovementCostMultiplier })
      const crater = { x: bounds.x + Math.round(bounds.width * .55), y: bounds.y + Math.round(bounds.height * (owned.craterCenterYPercent - owned.craterHeightPercent / 2) / 100), width: Math.round(bounds.width * owned.craterWidthPercent / 100), height: Math.round(bounds.height * owned.craterHeightPercent / 100) }
      p.crater.boundaryMm = forestRectangle(crater)
      const y = Math.round(crater.y + crater.height / 2)
      p.ascent.kind = owned.connectionKind; p.descent.kind = owned.connectionKind
      p.descent.fromMm = { x: crater.x - Math.round(bounds.width * .04), y }
      p.descent.toMm = { x: crater.x + Math.min(Math.round(bounds.width * .04), Math.round(crater.width / 4)), y }
      p.route.widthMm = owned.routeWidthMm
      p.route.toCraterViaMm = y === p.platform.anchorMm.y ? [] : [{ x: p.platform.anchorMm.x, y }]
      p.flow = owned.flowEnabled ? { centerlineMm: [{ x: Math.round(crater.x + crater.width * .72), y: Math.round(crater.y + crater.height * .25) }, { x: Math.round(crater.x + crater.width * .72), y: Math.round(crater.y + crater.height * .75) }], widthMm: owned.flowWidthMm, hazard: owned.flowHazard, blocksMovement: owned.flowBlocksMovement, movementCostMultiplier: owned.flowMovementCostMultiplier } : null
      p.materials.flow = captureJson(content.flowMaterials[owned.lavaAppearance])
      return { kind: 'new-project', domain: 'volcano', base: content.base, input, profile: profile() }
    }
    case 'mixed': {
      const owned = intent.request
      if (!Number.isSafeInteger(owned.roomCount) || owned.roomCount < 1 || owned.roomCount > 4) throw new Error('房间数量须为1–4的整数。')
      if (owned.algorithmVersion !== undefined && ![1, 2, 3].includes(owned.algorithmVersion)) throw new Error('混合生成算法版本须为1、2或3。')
      const content = await options.content.mixed({ ...baseIntent, environment: owned.environment }, resourceOptions)
      checkCancelled(options.signal)
      const input = captureJson(content.defaults), p = input.parameters, bounds = p.building.boundsMm
      if (owned.algorithmVersion !== undefined) input.algorithmVersion = owned.algorithmVersion
      const clearArea = Math.max(1, (bounds.width - p.building.wallThicknessMm) * (bounds.height - p.building.wallThicknessMm))
      p.building.rooms = Array.from({ length: owned.roomCount }, (_, index) => ({ id: `room-${index + 1}`, purpose: owned.purpose,
        minAreaMm2: Math.max(1, Math.floor(clearArea / (owned.roomCount * 3))), maxAreaMm2: clearArea, minClearSideMm: 1200 }))
      p.building.relations = []
      p.building.arrangement.furniture = owned.furniture
      if (p.outdoor.kind === 'forest') for (const zone of p.outdoor.parameters.zones) for (const row of zone.vegetation) row.coveragePpm = Math.min(1000000, Math.round(row.coveragePpm * owned.vegetationMultiplier))
      return { kind: 'new-project', domain: 'mixed', base: content.base, input, profile: profile() }
    }
  }
}
