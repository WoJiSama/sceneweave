import { beforeAll, describe, expect, it } from 'vitest'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { createTerrainVariantCatalogDocument } from '../../platform/browser/content/terrain-variant-catalog.js'
import { addPropAppearanceSource } from '../appearance/graph.js'
import { propPaintPolygon } from '../appearance/presentation.js'
import { TASK_BUDGET_PROFILES } from '../budget/task-budget.js'
import { applyCommands } from '../commands/commands.js'
import { polygonDistance, propFootprint, supportedPolygon } from '../geometry/geometry.js'
import type { AppearanceGraph } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import { emptyCompositionDocument } from '../terrain-generation/composition-materialize.js'
import { composeTerrainDocument } from '../terrain-generation/compose.js'
import { generateTerrainDocumentV5 } from '../terrain-generation/surface-generation.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { TERRAIN_VARIANT_SPECS } from '../visual/terrain-variant-specs.js'
import { visualBase } from '../visual/base.js'
import { decorationProtectedGeometry } from './generate.js'
import { buildIslandDressingCommands, buildIslandDressingCommandsV2 } from './island-dressing.js'

const ids = (prefix = 'island-v2') => { let i = 0; return () => `${prefix}-${++i}` }
const context = () => ({ ids: { nextId: ids('member') }, clock: { now: () => '2026-11-02T00:00:00Z' } })
let scene: SceneDocument, appearance: AppearanceGraph
beforeAll(() => {
  const base = createShoreBlankDocument('island', { sceneId: 'island-v2-unit', title: '固定岩岛', now: '2026-11-02T00:00:00Z', widthMm: 24000, heightMm: 18000, preset: 'narrative' })
  const result = generateTerrainDocumentV5(base, { sceneId: base.sceneId, kind: 'island', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000, algorithmVersion: 5, budgetProfileId: 'standard', quality: 'standard' })
  scene = { ...emptyCompositionDocument(composeTerrainDocument(base, result, 'birth', TASK_BUDGET_PROFILES.standard).document), schemaVersion: 6, decorations: {}, decorationClusters: {} }
  const catalog = createTerrainVariantCatalogDocument()
  Object.assign(scene.assets, catalog.assets); Object.assign(scene.propDefinitions, catalog.propDefinitions)
  appearance = { version: 2, presentations: {}, sources: {}, propSources: {}, surfaceSources: {}, instanceAdjustments: {}, layerAdjustments: {}, variants: {}, prefabAppearanceTemplates: {} }
  for (const spec of TERRAIN_VARIANT_SPECS) {
    const d = scene.propDefinitions[spec.definitionId]
    addPropAppearanceSource(appearance, { definitionRef: { id: d.id, version: d.version }, appearance: cloneJson(d.defaultAppearance), visualBoundsMm: cloneJson(d.defaultVisualBoundsMm), shadowClass: d.defaultShadowClass, shadowOverride: null }, null, spec.presentation)
  }
}, 60000)

describe('explicit island-dressing@2 actual crown and stair refinement', () => {
  it('adds visible crown plants with exact roots and full clearances, plus one valid natural-rock route; preserves the physical island and legacy algorithm', () => {
    const before = cloneJson(scene), plan = buildIslandDressingCommandsV2(scene, { nextId: ids(), appearance })
    const after = applyCommands(scene, plan.commands, context())
    expect(scene).toEqual(before)
    expect(after.terrainAreas).toEqual(before.terrainAreas)
    expect(after.paths).toEqual(before.paths)
    for (const [id, prop] of Object.entries(before.props)) expect(after.props[id]).toEqual(prop)
    const created = Object.values(after.props).filter(prop => !before.props[prop.id])
    expect(created.length).toBeGreaterThanOrEqual(6)
    expect(created.filter(prop => prop.definitionRef?.id.endsWith('tree-wind-oak'))).toHaveLength(1)
    expect(created.filter(prop => prop.definitionRef?.id.includes('-shrub-')).length).toBeGreaterThanOrEqual(3)
    expect(created.filter(prop => prop.definitionRef?.id.includes('-grass-')).length).toBeGreaterThanOrEqual(2)
    const crown = Object.values(before.terrainAreas).find(area => area.id === 'terrain-high')!
    const bounds = { left: Math.min(...crown.boundaryMm.map(point => point.positionMm.x)), right: Math.max(...crown.boundaryMm.map(point => point.positionMm.x)),
      top: Math.min(...crown.boundaryMm.map(point => point.positionMm.y)), bottom: Math.max(...crown.boundaryMm.map(point => point.positionMm.y)) }
    const occupiedQuadrants = new Set(created.map(prop => `${prop.positionMm.x < (bounds.left + bounds.right) / 2 ? 'w' : 'e'}${prop.positionMm.y < (bounds.top + bounds.bottom) / 2 ? 'n' : 's'}`))
    expect(occupiedQuadrants.size).toBeGreaterThanOrEqual(3)
    const protections = decorationProtectedGeometry(after, { floorId: created[0].floorId, visibility: 'public', clearanceMm: 400 })
    for (const prop of created) {
      const spec = TERRAIN_VARIANT_SPECS.find(spec => spec.definitionId === prop.definitionRef?.id)!
      const paint = propPaintPolygon(prop, spec.presentation)
      expect(protections.every(record => polygonDistance(paint, record.polygon) >= record.marginMm)).toBe(true)
      expect(supportedPolygon(after, propFootprint(prop), prop.supportRef, prop.floorId)).toBe(true)
    }
    expect(after.terrainConnections['terrain-stairs'].route?.stairStyle).toBe('naturalRock')
    expect(after.terrainConnections['terrain-stairs'].widthMm).toBe(1500)
    const lowerId = after.terrainConnections['terrain-stairs'].from.surfaceRef.id === crown.id
      ? after.terrainConnections['terrain-stairs'].to.surfaceRef.id : after.terrainConnections['terrain-stairs'].from.surfaceRef.id
    expect(after.terrainConnections['terrain-stairs'].surfaceStyle?.base).toEqual(before.terrainAreas[lowerId].surfaceStyle?.base)
    expect(after.terrainConnections['terrain-stairs'].surfaceStyle?.overlays).toEqual(before.terrainConnections['terrain-stairs'].surfaceStyle?.overlays)
    expect(Object.values(after.decorationClusters!).find(cluster => cluster.supportRef.id === lowerId)?.maxInstances).toBe(20)
    const visual = visualBase(after)
    if (!visual) throw new Error('visual3')
    expect(Object.values(visual.edgeLooks).filter(look => {
      const binding = visual.boundaries[look.boundaryId]?.binding
      return look.kind === 'cliff' && binding?.kind === 'terrain' && binding.sides.some(side => side.areaId === crown.id)
    }).every(look => look.widthMm === 720 && look.repeatMm === 500)).toBe(true)
    const checked = validateSceneDocument(after)
    expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.errors)).toBe(true)
    expect(() => buildIslandDressingCommandsV2(after, { nextId: ids('repeat'), appearance })).toThrow(/重复追加/)
  })

  it('can refine an already dressed legacy map while retaining every old cluster/manual/deleted record', () => {
    const old = applyCommands(scene, buildIslandDressingCommands(scene, { nextId: ids('legacy') }).commands, context())
    const plan = buildIslandDressingCommandsV2(old, { nextId: ids('refine'), appearance }), after = applyCommands(old, plan.commands, context())
    expect(after.decorationClusters).toEqual(old.decorationClusters)
    expect(after.decorations).toEqual(old.decorations)
    for (const [id, prop] of Object.entries(old.props)) expect(after.props[id]).toEqual(prop)
    expect(plan.commands.some(command => command.type === 'createDecorationCluster')).toBe(false)
  })

  it('rejects locked stairs and conflicting fixed presentation before a candidate can overwrite them', () => {
    const locked = cloneJson(scene); locked.terrainConnections['terrain-stairs'].editLocked = true
    expect(() => buildIslandDressingCommandsV2(locked, { nextId: ids(), appearance })).toThrow(/锁定/)
    const changed = cloneJson(appearance)
    for (const presentation of Object.values(changed.presentations!)) if (presentation.mode === 'nearSide') presentation.rootAnchorMm.y += 1
    expect(() => buildIslandDressingCommandsV2(scene, { nextId: ids(), appearance: changed })).toThrow(/固定表现/)
  })

  it('samples public support first, then rejects the complete candidate when private coverage invalidates a chosen plant', () => {
    const plan = buildIslandDressingCommandsV2(scene, { nextId: ids('privacy-base'), appearance })
    const tree = plan.commands.find(command => command.type === 'addProp' && command.definitionRef.id.endsWith('tree-wind-oak'))
    expect(tree?.type).toBe('addProp')
    if (!tree || tree.type !== 'addProp') throw new Error('The fixed crown tree candidate is missing.')
    const hidden = cloneJson(scene), crown = hidden.terrainAreas[tree.supportRef!.id], size = 500
    hidden.terrainAreas['private-crown-cover'] = { ...cloneJson(crown), id: 'private-crown-cover', visibility: 'gm', coveragePriority: crown.coveragePriority + 1,
      surfaceStyle: null, boundaryMm: [
        { x: tree.positionMm.x - size / 2, y: tree.positionMm.y - size / 2 },
        { x: tree.positionMm.x + size / 2, y: tree.positionMm.y - size / 2 },
        { x: tree.positionMm.x + size / 2, y: tree.positionMm.y + size / 2 },
        { x: tree.positionMm.x - size / 2, y: tree.positionMm.y + size / 2 },
      ].map((positionMm, index) => ({ id: `private-crown-p${index}`, segmentId: `private-crown-s${index}`, positionMm })) }
    hidden.entityLayers['private-crown-cover'] = hidden.entityLayers[crown.id]
    const generation = getLegacyGeneration(hidden)
    for (const check of Object.values(generation?.checks ?? {})) check.state = 'unchecked'
    const validated = validateSceneDocument(hidden)
    expect(validated.ok, validated.ok ? '' : JSON.stringify(validated.errors)).toBe(true)
    expect(() => buildIslandDressingCommandsV2(hidden, { nextId: ids('privacy-hidden'), appearance })).toThrow(/完整场景支撑或保留区域冲突/)
  })
})
