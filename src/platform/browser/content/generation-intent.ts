import type { GenerationBaseIntent, GenerationContentPort } from '../../../application/workspace/generation-intent.js'
import type { EditableProject } from '../../../application/workspace/project.js'
import { defaultWoodlandCoverages } from '../../../application/workspace/woodland-distribution.js'
import { checkCancelled, type ResourceOptions } from '../../../shared/ports/resources.js'
import { defaultVolcanoInput } from '../../../shared/generation/domains/volcano/index.js'
import { defaultMixedInputV19 } from '../../../shared/generation/domains/mixed/index.js'
import { planVolcanoPlatformBuilding } from '../../../shared/generation/domains/mixed/volcano-platform.js'
import { createRefinedBlankProject } from './refined-blank.js'
import { createForestBlankProject } from './shore-blank.js'
import { createMixedBlankProject } from './factories.js'
import type { ForestVegetation } from '../../../shared/generation/domains/forest/contracts.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { volcanicSurfaceDefinitionId } from '../../../shared/visual/volcanic-surfaces.js'

const blankOptions = (input: GenerationBaseIntent) => ({ title: input.title, widthMm: input.widthMm, heightMm: input.heightMm,
  sceneId: input.sceneId, preset: input.preset, gridVisible: input.gridVisible })

const ref = (id: string) => ({ id, version: 1 })
const interiorSurfaces = (prefix: string, finished: boolean) => ({
  floor: ref(prefix + 'refined-material-interior-material-planks'), wall: ref(prefix + 'refined-material-interior-material-plaster'),
  ...(finished ? { floorFinish: { kind: 'room-use-v1' as const, serviceMaterialRef: ref(prefix + 'refined-material-interior-material-flags') } } : {}),
})
const woodlandFinish = () => ({ kind: 'woodland-v1' as const, mossMaterialRef: ref('refined-material-island-material-moss'), soilMaterialRef: ref('shore-v1-material-sand-dry') })
const volcanoSurface = (key: string) => ref(volcanicSurfaceDefinitionId(key))
const volcanoSurfaces = () => ({ ground: volcanoSurface('wind-laid-ash'), mountain: volcanoSurface('fractured-basalt'),
  crater: volcanoSurface('cooled-lava-crust'), platform: volcanoSurface('worn-ash-path'), flow: volcanoSurface('molten-lava'), route: volcanoSurface('worn-ash-path') })
function plants(kind: 'prop' | 'decoration', entries: [string, number][]): ForestVegetation['palette'] {
  return entries.map(([key, weight]) => ({ key, kind, weight, definitionRef: ref('whole-plants-v1-prop-' + key) }))
}
function woodlandPalette() {
  return {
    palettes: { tree: plants('prop', [['oak-spreading', 1]]), shrub: plants('decoration', [['hazel-bush', 3], ['bramble-fruiting', 2]]),
      grass: plants('decoration', [['fern-full-crown', 4], ['wildflower-whole-clump', 1]]) },
    secondTree: plants('prop', [['pine-branched', 1]]),
  }
}

/** Prepare real source refs and connected waypoints for the first candidate.
 * These choices are stored in its ordinary replayable generation parameters. */
function mixedSceneDefaults(scene: SceneDocument, environment: 'forest' | 'volcano', seed: string, finished: boolean) {
  const input = defaultMixedInputV19(scene, environment, seed)
  const { building, outdoor, approach } = input.parameters
  building.materials = interiorSurfaces('mixed-interior-v1-', finished)
  for (const [role, key] of [['work', 'desk-writing'], ['table', 'table-long'], ['seat', 'chair-cushion']] as const) {
    const choice = ref('mixed-interior-v1-refined-prop-interior-' + key)
    if (scene.propDefinitions[choice.id]?.version === choice.version) building.arrangement.palette.push({ role, ref: choice })
  }
  if (outdoor.kind === 'volcano') {
    if (finished) {
      planVolcanoPlatformBuilding(input.parameters, seed)
      outdoor.parameters.materials = volcanoSurfaces()
      outdoor.parameters.route.boundaryBlendMm = 215
      approach.materialRef = outdoor.parameters.materials.route
    }
    return input
  }
  const p = outdoor.parameters, b = p.boundsMm, entry = p.entrances[0], clearing = p.clearings[0]
  const point = (x: number, y: number) => ({ x: b.x + Math.round(b.width * x), y: b.y + Math.round(b.height * y) })
  building.boundsMm = { ...point(.57, .18), width: Math.round(b.width * .32), height: Math.round(b.height * .31) }
  const variation = Number.parseInt(sha256Text(seed).slice(0, 4), 16) / 65535 - .5
  entry.positionMm = { x: b.x + entry.widthMm, y: point(0, .82).y }
  if (finished) p.groundFinish = woodlandFinish()
  const soil = p.groundFinish?.soilMaterialRef ?? ref('mixed-interior-v1-refined-material-interior-material-earth')
  if (p.ground.kind === 'new') p.ground.materialRef = ref('shore-v1-material-grass')
  const { palettes } = woodlandPalette()
  const coverage = defaultWoodlandCoverages(b)
  for (const row of p.zones[0].vegetation) {
    row.palette = palettes[row.role]
    row.coveragePpm = coverage[row.role]
  }
  const trail = p.routes[0]
  trail.materialRef = soil
  trail.viaMm = [point(.13, .77 + variation * .04), point(.22, .68 + variation * .035)]
  // The onward path begins where the trail reaches its clearing.
  p.entrances.push({ ...entry, id: 'clearing-exit', positionMm: { ...clearing.anchorMm } })
  approach.fromMm = { ...clearing.anchorMm }
  approach.viaMm = [point(.42, .59 + variation * .06), point(.50, .52 + variation * .05)]
  approach.materialRef = soil
  approach.widthMm = trail.widthMm
  return input
}

export function mixedGenerationContentForBase(base: EditableProject, environment: 'forest' | 'volcano', seed: string,
  appearance: 'finished' | 'refined' | 'initial', layerId?: string): Awaited<ReturnType<GenerationContentPort['mixed']>> {
  // Archive JSON sorts keys. The original selected layer remains authoritative.
  const scene = layerId ? { ...base.document, userLayers: { [layerId]: base.document.userLayers[layerId], ...base.document.userLayers } } : base.document
  if (appearance === 'initial') return { base, defaults: defaultMixedInputV19(scene, environment, seed), loungeFocus: false }
  return { base, defaults: mixedSceneDefaults(scene, environment, seed, appearance === 'finished'), secondTree: woodlandPalette().secondTree }
}

/** Adapt the portable cancellation contract at this browser-only boundary. */
async function withNativeSignal<T>(options: ResourceOptions, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  checkCancelled(options.signal)
  const controller = new AbortController(), abort = () => controller.abort()
  options.signal?.addEventListener?.('abort', abort, { once: true })
  try {
    checkCancelled(options.signal)
    const result = await action(controller.signal)
    checkCancelled(options.signal)
    return result
  } finally { options.signal?.removeEventListener?.('abort', abort) }
}

/** Fixed catalogue identities stay beside the factories that supply their real
 * bytes and licences. Application intent only consumes roles and references. */
export const browserGenerationContent: GenerationContentPort = {
  interior: (input, options) => withNativeSignal(options, async signal => {
    const base = await createRefinedBlankProject('interior', blankOptions(input), signal)
    const palette = [
      { role: 'bed' as const, ref: { id: 'refined-prop-interior-bed-indigo', version: 1 } },
      { role: 'seat' as const, ref: { id: 'refined-prop-interior-chair-slat', version: 1 } },
      { role: 'table' as const, ref: { id: 'refined-prop-interior-table-round', version: 1 } },
      { role: 'table' as const, ref: { id: 'refined-prop-interior-table-long', version: 1 } },
      { role: 'storage' as const, ref: { id: 'refined-prop-interior-cupboard-linen', version: 1 } },
      { role: 'work' as const, ref: { id: 'refined-prop-interior-counter-kitchen', version: 1 } },
      { role: 'work' as const, ref: { id: 'refined-prop-interior-desk-writing', version: 1 } },
      { role: 'hearth' as const, ref: { id: 'refined-prop-interior-stove-masonry', version: 1 } },
      { role: 'shelf' as const, ref: { id: 'refined-prop-interior-shelf-books', version: 1 } },
    ].filter(row => base.document.propDefinitions[row.ref.id]?.version === row.ref.version)
    return { base, palette, materials: interiorSurfaces('', true) }
  }),
  forest: (input, options) => withNativeSignal(options, async signal => ({
    base: await createForestBlankProject(blankOptions(input), signal),
    groundMaterial: ref('shore-v1-material-grass'), routeMaterial: woodlandFinish().soilMaterialRef, groundFinish: woodlandFinish(),
    ...woodlandPalette(),
  })),
  volcano: (input, options) => withNativeSignal(options, async signal => {
    const { createNaturalVolcanoBlankProject } = await import('./volcanic-surfaces-catalog.js')
    const base = await createNaturalVolcanoBlankProject(blankOptions(input), signal)
    const defaults = defaultVolcanoInput(base.document, input.seed)
    defaults.parameters.materials = volcanoSurfaces()
    return { base, defaults, naturalShape: true, flowMaterials: { cold: volcanoSurface('cooled-lava-crust'), hot: volcanoSurface('molten-lava') } }
  }),
  mixed: (input, options) => withNativeSignal(options, async signal => {
    const finished = (input.algorithmVersion ?? 19) === 19
    const base = await createMixedBlankProject(input.environment, blankOptions(input), signal, finished)
    return mixedGenerationContentForBase(base, input.environment, input.seed, finished ? 'finished' : 'refined')
  }),
}
