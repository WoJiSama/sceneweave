import data from '../../src/platform/browser/content/scenes-data.json'
import { createShoreBlankDocument } from '../../src/platform/browser/content/shore-blank.js'
import { taskBudgetProfile } from '../../src/shared/budget/task-budget.js'
import type { InteriorGenerationInput } from '../../src/shared/generation/domains/interior/contracts.js'
import type { ForestGenerationInput } from '../../src/shared/generation/domains/forest/contracts.js'
import { defaultVolcanoInput, VOLCANO_CALDERA_VERSION, VOLCANO_DEFAULTS, type VolcanoGenerationInput, type VolcanoParameters } from '../../src/shared/generation/domains/volcano/index.js'
import { defaultMixedInput, MIXED_VOLCANO_LAYOUT_VERSION, type MixedGenerationInput } from '../../src/shared/generation/domains/mixed/index.js'
import { planVolcanoPlatformBuilding } from '../../src/shared/generation/domains/mixed/volcano-platform.js'
import type { SceneDocument } from '../../src/shared/model/scene.js'
import { sceneSchema } from '../../src/shared/validation/scene.js'

type Inputs = { interior: InteriorGenerationInput; forest: ForestGenerationInput; volcano: VolcanoGenerationInput; mixed: MixedGenerationInput }
const stamp = '2026-11-05T00:00:00.000Z'
const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]

function prepareCalderaFixture(parameters: VolcanoParameters) {
  const { shape, entranceSide, breachSide, craterWidthPercent, craterHeightPercent, craterCenterYPercent,
    mountainElevationMm, craterElevationMm, connectionKind, flowWidthMm } = VOLCANO_DEFAULTS
  parameters.mountain.elevationMm = mountainElevationMm
  parameters.crater.elevationMm = craterElevationMm
  parameters.ascent.kind = parameters.descent.kind = connectionKind
  if (parameters.flow) parameters.flow.widthMm = flowWidthMm
  return { shape, entranceSide, breachSide, craterWidthPercent, craterHeightPercent, craterCenterYPercent }
}

export function calderaFixtureInput(base: SceneDocument, seed: string = VOLCANO_DEFAULTS.seed): VolcanoGenerationInput {
  const input = defaultVolcanoInput(base, seed)
  const design = prepareCalderaFixture(input.parameters)
  return { ...input, algorithmVersion: VOLCANO_CALDERA_VERSION, design }
}

export function mixedCalderaFixtureInput(base: SceneDocument, seed: string = VOLCANO_DEFAULTS.seed): MixedGenerationInput {
  const input = defaultMixedInput(base, 'volcano', seed)
  const { outdoor } = input.parameters
  if (outdoor.kind !== 'volcano') throw new Error('Expected a volcano fixture')
  planVolcanoPlatformBuilding(input.parameters, seed, true)
  const design = prepareCalderaFixture(outdoor.parameters)
  return { ...input, algorithmVersion: MIXED_VOLCANO_LAYOUT_VERSION, parameters: { ...input.parameters, outdoor },
    volcanoDesign: { ...design, fixedPlatform: true } }
}

/** Test-only fixed inputs shared by direct, Worker and HTTP checks. No browser
 * storage, image decoder, live resources or provider is involved. */
export function domainExecutionFixture<K extends keyof Inputs>(domain: K): { base: SceneDocument; input: Inputs[K]; profile: ReturnType<typeof taskBudgetProfile> } {
  if (domain === 'mixed') {
    const fixture = domainExecutionFixture('forest')
    const input = defaultMixedInput(fixture.base, 'forest', 'mixed-transport')
    input.algorithmVersion = 19
    return { ...fixture, input } as { base: SceneDocument; input: Inputs[K]; profile: ReturnType<typeof taskBudgetProfile> }
  }
  const widthMm = domain === 'volcano' ? 40000 : domain === 'forest' ? 32000 : 20000
  const heightMm = domain === 'volcano' ? 32000 : domain === 'forest' ? 24000 : 16000
  const base = createShoreBlankDocument('island', { sceneId: `d7-${domain}`, title: `D7 ${domain}`, now: stamp, widthMm, heightMm, preset: 'narrative' }, domain === 'forest', domain === 'forest')
  let input: Inputs[keyof Inputs]
  if (domain === 'interior') input = { version: 1, algorithmVersion: 19, seed: 'd7-interior', parameters: {
    floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 1000, y: 1000, width: 18000, height: 14000 }, wallThicknessMm: 200,
    rooms: [{ id: 'hall', purpose: '大厅', minAreaMm2: 8_000_000, maxAreaMm2: 240_000_000, minClearSideMm: 2000 }, { id: 'study', purpose: '书房', minAreaMm2: 8_000_000, maxAreaMm2: 240_000_000, minClearSideMm: 2000 }],
    relations: [{ a: 'hall', b: 'study', kind: 'adjacent', minimumSharedWallMm: 2000 }], corridor: { axis: 'none', clearWidthMm: 1500 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: false, doorWidthMm: 1200, clearWidthMm: 1000, palette: [] },
  } }
  else if (domain === 'forest') input = { version: 1, algorithmVersion: 2, seed: 'd7-forest', parameters: {
    floorId: 'visual-floor', layerId: 'visual-layer-ground', boundsMm: { x: 2000, y: 2000, width: 28000, height: 20000 }, ground: { kind: 'new', elevationMm: 0, materialRef: null },
    zones: [{ id: 'woods', supportRef: { kind: 'generated-ground' }, boundaryMm: rectangle(2500, 2500, 27000, 19000), vegetation: [
      { role: 'tree', coveragePpm: 80000, spacingMm: 2500, clusterRadiusMm: 6500, clearanceMm: 100,
        palette: [{ key: 'tree', kind: 'prop', definitionRef: { id: 'terrain-variants-v2-prop-tree-highland-copse', version: 1 }, weight: 1 }] },
      { role: 'grass', coveragePpm: 1000, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 100,
        palette: [{ key: 'grass', kind: 'decoration', definitionRef: { id: 'terrain-variants-v1-prop-grass-sedge-fan', version: 1 }, weight: 1 }] },
    ] }],
    clearings: [{ id: 'camp', supportRef: { kind: 'generated-ground' }, boundaryMm: rectangle(20000, 9000, 6000, 6000), anchorMm: { x: 23000, y: 12000 }, clearanceMm: 200 }],
    entrances: [{ id: 'west', supportRef: { kind: 'generated-ground' }, positionMm: { x: 4000, y: 12000 }, directionDeg: 0, widthMm: 1600 }],
    routes: [{ id: 'approach', fromEntranceId: 'west', toClearingId: 'camp', viaMm: [], widthMm: 1200, materialRef: null }],
  } }
  else {
    for (const id of ['content-m-basalt', 'content-m-volcanic-ash', 'content-m-lava', 'content-m-lava-hot']) {
      const material = data.scenes.volcano.document.materials[id as keyof typeof data.scenes.volcano.document.materials]
      base.materials[id] = sceneSchema.shape.materials.valueType.parse(material)
      base.assets[material.textureAssetId] = sceneSchema.shape.assets.valueType.parse(data.scenes.volcano.document.assets[material.textureAssetId as keyof typeof data.scenes.volcano.document.assets])
    }
    input = defaultVolcanoInput(base, 'd7-volcano')
  }
  return { base, input: input as Inputs[K], profile: taskBudgetProfile('standard') }
}
