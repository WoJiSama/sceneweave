import type { InteriorLayoutParameters, InteriorGenerationInput } from '../../shared/generation/domains/interior/contracts.js'
import { defaultBuildingWallHeight } from '../../shared/model/building-height.js'
import { forestRectangle } from '../../shared/generation/domains/forest/index.js'
import type { ForestGenerationInput, ForestVegetation } from '../../shared/generation/domains/forest/contracts.js'
import { VOLCANO_CALDERA_VERSION, VOLCANO_DEFAULTS, type VolcanoDesign, type VolcanoGenerationInput } from '../../shared/generation/domains/volcano/contracts.js'
import { MIXED_VOLCANO_LAYOUT_VERSION, type MixedGenerationInput } from '../../shared/generation/domains/mixed/contracts.js'
import type { TaskBudgetProfile } from '../../shared/budget/task-budget.js'
import { checkCancelled, type ResourceOptions } from '../../shared/ports/resources.js'
import type { PreparationContext } from '../../shared/ports/runtime.js'
import { captureJson, freezeJson } from '../../shared/validation/json.js'
import type { EditableProject } from './project.js'
import { forestCampZones, forestZonesForDistribution, type WoodlandDistribution } from './woodland-distribution.js'
import { planWoodlandTrails } from './woodland-trails.js'

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
  woodlandDistribution?: WoodlandDistribution
}
export interface VolcanoGenerationUiRequest {
  title: string; widthMm: number; heightMm: number; seed: string
  mountainElevationMm: number; craterElevationMm: number
  craterWidthPercent: number; craterHeightPercent: number; craterCenterYPercent: number
  routeWidthMm: number; connectionKind: 'stairs' | 'ramp'
  craterHazard: boolean; craterBlocksMovement: boolean; craterMovementCostMultiplier: number
  flowEnabled: boolean; flowWidthMm: number; lavaAppearance: 'cold' | 'hot'
  flowHazard: boolean; flowBlocksMovement: boolean; flowMovementCostMultiplier: number
  shape?: VolcanoDesign['shape']; entranceSide?: VolcanoDesign['entranceSide']; breachSide?: VolcanoDesign['breachSide']
}
export interface MixedGenerationUiRequest {
  title: string; environment: 'forest' | 'volcano'; widthMm: number; heightMm: number; seed: string
  roomCount: number; purpose: string; furniture: boolean; vegetationMultiplier: number
  algorithmVersion?: MixedGenerationInput['algorithmVersion']
  woodlandDistribution?: WoodlandDistribution
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
    materials?: InteriorLayoutParameters['materials']
  }>
  forest(input: GenerationBaseIntent, options: ResourceOptions): Promise<{
    base: EditableProject; groundMaterial: MaterialRef; routeMaterial: MaterialRef
    groundFinish?: ForestGenerationInput['parameters']['groundFinish']
    palettes: Record<'tree' | 'shrub' | 'grass', ForestVegetation['palette']>
    secondTree?: ForestVegetation['palette']
  }>
  volcano(input: GenerationBaseIntent, options: ResourceOptions): Promise<{
    base: EditableProject; defaults: VolcanoGenerationInput; flowMaterials: Record<'cold' | 'hot', MaterialRef>
  }>
  mixed(input: GenerationBaseIntent & { environment: 'forest' | 'volcano'; algorithmVersion?: MixedGenerationInput['algorithmVersion'] }, options: ResourceOptions): Promise<{
    base: EditableProject; defaults: MixedGenerationInput
    secondTree?: ForestVegetation['palette']
    loungeFocus?: false
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

function furnishLounges(rooms: InteriorLayoutParameters['rooms']) {
  let lounges = 0
  for (const room of rooms) {
    if (!room.furnishingFocus && /休息室|起居室|会客室|\b(?:lounge|common room|break room)\b/i.test(room.purpose)) {
      room.furnishingFocus = lounges++ % 2 === 0 ? 'fireside-v1' : 'reading-v1'
    }
  }
  return rooms
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
        version: 1, algorithmVersion: 22, seed: owned.seed, parameters: {
          floorId: floor.id, layerId: layer.id, boundsMm: { ...floor.boundsMm }, wallThicknessMm: owned.wallThicknessMm,
          wallHeightMm: defaultBuildingWallHeight(owned.rooms.map(room => room.purpose)),
          rooms: owned.arrangement.furniture ? furnishLounges(owned.rooms) : owned.rooms, relations: owned.relations, corridor: owned.corridor,
          materials: captureJson(content.materials ?? { floor: null, wall: null }), arrangement: { ...owned.arrangement, palette },
        },
      } }
    }
    case 'forest': {
      if (intent.request.woodlandDistribution !== undefined && !['auto', 'uniform', 'copses'].includes(intent.request.woodlandDistribution)) throw new Error('请选择可用的植被分布。')
      const owned = intent.request, content = await options.content.forest(baseIntent, resourceOptions)
      checkCancelled(options.signal)
      const { floor, layer } = groundLayer(content.base, '森林与营地'), bounds = floor.boundsMm
      const selectedProfile = profile()
      // A square entrance cap projects farther sideways on a diagonal branch.
      const inset = Math.max(Math.ceil(owned.routeWidthMm / 2) + 300,
        content.groundFinish?.kind === 'woodland-v2' ? Math.ceil(owned.routeWidthMm / Math.SQRT2) + 1 : 0)
      const centre = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
      const positionMm = owned.entranceSide === 'west' ? { x: bounds.x + inset, y: centre.y }
        : owned.entranceSide === 'east' ? { x: bounds.x + bounds.width - inset, y: centre.y }
          : owned.entranceSide === 'north' ? { x: centre.x, y: bounds.y + inset } : { x: centre.x, y: bounds.y + bounds.height - inset }
      const directionDeg = { west: 0, north: 90, east: 180, south: 270 }[owned.entranceSide], supportRef = { kind: 'generated-ground' as const }
      const clearings = owned.clearings.map(row => {
        const rectangle = { ...row.boundsMm, x: bounds.x + row.boundsMm.x, y: bounds.y + row.boundsMm.y }
        return { id: row.id, supportRef, boundaryMm: forestRectangle(rectangle), anchorMm: { x: Math.round(rectangle.x + rectangle.width / 2), y: Math.round(rectangle.y + rectangle.height / 2) }, clearanceMm: 300 }
      })
      const parameters: ForestGenerationInput['parameters'] = {
        floorId: floor.id, layerId: layer.id, boundsMm: { ...bounds }, ground: { kind: 'new', elevationMm: 0, materialRef: captureJson(content.groundMaterial) },
        ...(content.groundFinish ? { groundFinish: captureJson(content.groundFinish) } : {}),
        zones: [{ id: 'woodland', supportRef, boundaryMm: forestRectangle(bounds), vegetation: [
          { role: 'tree', coveragePpm: owned.treeCoveragePpm, spacingMm: 2500, clusterRadiusMm: 6000, clearanceMm: 200, palette: captureJson(content.palettes.tree) },
          { role: 'shrub', coveragePpm: owned.shrubCoveragePpm, spacingMm: 800, clusterRadiusMm: 4000, clearanceMm: 180, palette: captureJson(content.palettes.shrub) },
          { role: 'grass', coveragePpm: owned.grassCoveragePpm, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 180, palette: captureJson(content.palettes.grass) },
        ] }], clearings, entrances: [{ id: 'entry', supportRef, positionMm, directionDeg, widthMm: owned.routeWidthMm }],
        routes: clearings.map(row => ({ id: `route:${row.id}`, fromEntranceId: 'entry', toClearingId: row.id, viaMm: [], widthMm: owned.routeWidthMm, materialRef: captureJson(content.routeMaterial) })),
      }
      if (parameters.groundFinish?.kind === 'woodland-v2') {
        planWoodlandTrails(parameters, owned.seed)
        parameters.zones = forestCampZones(content.base.document, parameters, owned.seed, selectedProfile, owned.woodlandDistribution, content.secondTree)
      } else {
        parameters.zones = forestZonesForDistribution(content.base.document, parameters, owned.seed, owned.woodlandDistribution, content.secondTree)
        if (parameters.groundFinish) planWoodlandTrails(parameters, owned.seed)
      }
      return { kind: 'new-project', domain: 'forest', base: content.base, profile: selectedProfile, input: { version: 1, algorithmVersion: 2, seed: owned.seed, parameters } }
    }
    case 'volcano': {
      const owned = intent.request, content = await options.content.volcano(baseIntent, resourceOptions)
      checkCancelled(options.signal)
      const input = captureJson(content.defaults), p = input.parameters
      p.mountain.elevationMm = owned.mountainElevationMm
      Object.assign(p.crater, { elevationMm: owned.craterElevationMm, hazard: owned.craterHazard, blocksMovement: owned.craterBlocksMovement, movementCostMultiplier: owned.craterMovementCostMultiplier })
      p.ascent.kind = owned.connectionKind; p.descent.kind = owned.connectionKind
      p.route.widthMm = owned.routeWidthMm
      const flow = { widthMm: owned.flowWidthMm, hazard: owned.flowHazard, blocksMovement: owned.flowBlocksMovement, movementCostMultiplier: owned.flowMovementCostMultiplier }
      p.materials.flow = captureJson(content.flowMaterials[owned.lavaAppearance])
      const shape = owned.shape ?? VOLCANO_DEFAULTS.shape
      const design: VolcanoDesign = { shape, entranceSide: owned.entranceSide ?? VOLCANO_DEFAULTS.entranceSide,
        breachSide: owned.breachSide ?? (shape === 'natural' ? VOLCANO_DEFAULTS.breachSide : 'none'),
        craterWidthPercent: owned.craterWidthPercent, craterHeightPercent: owned.craterHeightPercent, craterCenterYPercent: owned.craterCenterYPercent }
      p.flow = owned.flowEnabled ? { centerlineMm: p.flow?.centerlineMm ?? [p.descent.fromMm, p.descent.toMm], ...flow } : null
      return { kind: 'new-project', domain: 'volcano', base: content.base, input: { ...input, algorithmVersion: VOLCANO_CALDERA_VERSION, design }, profile: profile() }
    }
    case 'mixed': {
      const owned = intent.request
      if (!Number.isSafeInteger(owned.roomCount) || owned.roomCount < 1 || owned.roomCount > 4) throw new Error('房间数量须为1–4的整数。')
      const version = owned.algorithmVersion
      if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > (owned.environment === 'volcano' ? MIXED_VOLCANO_LAYOUT_VERSION : 19))) {
        throw new Error('请选择当前室外环境支持的混合生成算法版本。')
      }
      if (owned.woodlandDistribution !== undefined && !['auto', 'uniform', 'copses'].includes(owned.woodlandDistribution)) throw new Error('请选择可用的植被分布。')
      const content = await options.content.mixed({ ...baseIntent, environment: owned.environment, algorithmVersion: owned.algorithmVersion }, resourceOptions)
      checkCancelled(options.signal)
      const input = captureJson(content.defaults), p = input.parameters, bounds = p.building.boundsMm
      if (owned.algorithmVersion !== undefined) input.algorithmVersion = owned.algorithmVersion
      const clearArea = Math.max(1, (bounds.width - p.building.wallThicknessMm) * (bounds.height - p.building.wallThicknessMm))
      p.building.rooms = Array.from({ length: owned.roomCount }, (_, index) => ({ id: `room-${index + 1}`, purpose: owned.purpose,
        minAreaMm2: Math.max(1, Math.floor(clearArea / (owned.roomCount * 3))), maxAreaMm2: clearArea, minClearSideMm: 1200 }))
      p.building.wallHeightMm = defaultBuildingWallHeight([owned.purpose])
      p.building.relations = []
      p.building.arrangement.furniture = owned.furniture
      if (owned.furniture && input.algorithmVersion >= 19 && content.loungeFocus !== false) furnishLounges(p.building.rooms)
      if (p.outdoor.kind === 'forest') for (const zone of p.outdoor.parameters.zones) for (const row of zone.vegetation) row.coveragePpm = Math.min(1000000, Math.round(row.coveragePpm * owned.vegetationMultiplier))
      if (p.outdoor.kind === 'forest') p.outdoor.parameters.zones = forestZonesForDistribution(content.base.document, p.outdoor.parameters, owned.seed, owned.woodlandDistribution, content.secondTree, p)
      return { kind: 'new-project', domain: 'mixed', base: content.base, input, profile: profile() }
    }
  }
}
