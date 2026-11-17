import { z } from 'zod'
import type { SceneCommand } from '../commands/commands.js'
import { createBasePlacedProp } from '../commands/base.js'
import type { SceneDocument } from '../model/scene.js'
import { propFootprint, polygonInside, polygonsOverlap, supportedPolygon, terrainPoints } from '../geometry/geometry.js'
import { terrainSurfaceRole } from '../visual/shore-surfaces.js'
import { terrainRandomUnit } from '../terrain-generation/field.js'
import { marineDefinitionId } from '../assets/marine-collection.js'
import { transportDefinitionId } from '../assets/transport-collection.js'
import { WATER_PRESETS, type WaterAppearance } from './contracts.js'
import { captureJson, cloneJson } from '../validation/json.js'

export const oceanDressingSettingsSchema = z.object({ recipeVersion: z.union([z.literal(1), z.literal(2)]), seed: z.string().min(1).max(128),
  preset: z.enum(['calm', 'rough']), creatures: z.boolean(), boat: z.boolean() }).strict()
export type OceanDressingSettings = z.infer<typeof oceanDressingSettingsSchema>
export const OCEAN_DRESSING_ITEMS = [
  { id: transportDefinitionId('boat-medieval-dinghy'), name: '小舟', category: 'boat', appearance: { mode: 'surface', surfaceEffects: { ripples: .55, wakeLengthMm: 1200 } } },
  { id: marineDefinitionId('dolphin'), name: '海豚', category: 'creature', appearance: { mode: 'surface', surfaceEffects: { ripples: .45, wakeLengthMm: 600 } } },
  { id: marineDefinitionId('reef-shark'), name: '礁鲨', category: 'creature', appearance: { mode: 'submerged', depth: .38 } },
  { id: marineDefinitionId('silver-school'), name: '鱼群', category: 'creature', appearance: { mode: 'submerged', depth: .18 } },
  { id: marineDefinitionId('kraken'), name: '海怪', category: 'creature', appearance: { mode: 'partial', depth: .35, submergedFraction: .55, surfaceEffects: { ripples: .55, wakeLengthMm: 0 } } },
] satisfies { id: string; name: string; category: string; appearance: WaterAppearance }[]

/** A finite post-generation stage. Geometry, curves, paint and physical rules
 * remain owned by the ordinary terrain pipeline and command executor. */
export function planOceanDressing(document: SceneDocument, raw: OceanDressingSettings) {
  const settings = oceanDressingSettingsSchema.parse(captureJson(raw)), scene = cloneJson(document), commands: SceneCommand[] = []
  const water = Object.values(scene.terrainAreas).filter(area => ['water', 'shallow'].includes(terrainSurfaceRole(scene, area))).sort((a, b) => a.id.localeCompare(b.id))
  if (!water.length) throw new Error('当前底图没有可识别的水域，不能应用海洋布景。')
  for (const area of water) {
    if (area.waterSurface) throw new Error('海洋生成步骤只用于新的底图，已有水面请使用普通编辑工具。')
    const shallow = terrainSurfaceRole(scene, area) === 'shallow'
    const spacing = Math.max(shallow ? 2600 : 2100, Math.ceil(Math.sqrt(scene.floors[area.floorId].boundsMm.width * scene.floors[area.floorId].boundsMm.height / 2000)))
    area.waterSurface = { ...WATER_PRESETS[shallow ? 'shallow' : settings.preset], waveSpacingMm: spacing, seed: `${settings.seed.slice(0, 80)}-${area.id.slice(-40)}` }
    commands.push({ type: 'setWaterSurface', id: area.id, settings: area.waterSurface })
    if (shallow && area.boundaryBlendMm === undefined) commands.push({ type: 'updateTerrainArea', id: area.id, changes: { boundaryBlendMm: 400 } })
  }
  const placed: string[] = [], skipped: string[] = [], occupied: ReturnType<typeof propFootprint>[] = []
  let attempts = 0
  const items = [...OCEAN_DRESSING_ITEMS.entries()]
  if (settings.recipeVersion === 2) items.sort(([ai, a], [bi, b]) => {
    const size = (id: string) => { const bounds = scene.propDefinitions[id]?.defaultVisualBoundsMm; return bounds ? bounds.width * bounds.height : 0 }
    return size(b.id) - size(a.id) || ai - bi
  })
  for (const [index, item] of items) {
    if (item.category === 'boat' ? !settings.boat : !settings.creatures) continue
    const definition = scene.propDefinitions[item.id]
    if (!definition) throw new Error(`缺少海洋布景的固定素材：${item.name}`)
    let accepted = false
    for (let trial = 0; trial < 96 && !accepted; trial++) {
      attempts++
      const area = water[trial % water.length], bounds = scene.floors[area.floorId].boundsMm
      const random = (axis: number) => terrainRandomUnit(`${settings.seed}:ocean-stage${settings.recipeVersion}:${index}`, `${trial}:${axis}`)
      const positionMm = { x: Math.round(bounds.x + bounds.width * (.07 + random(0) * .86)), y: Math.round(bounds.y + bounds.height * (.07 + random(1) * .86)) }
      const id = `ocean-stage${settings.recipeVersion}-prop-${index}`, rotationDeg = Math.floor(random(2) * 360)
      if (scene.props[id]) throw new Error('海洋布景身份已占用，不能覆盖已有物件。')
      const prop = createBasePlacedProp(scene, item.id, positionMm, { ids: { nextId: () => id }, clock: { now: () => scene.updatedAt } }, { id, floorId: area.floorId, rotationDeg, supportRef: { kind: 'terrainArea', id: area.id } })
      // Test the whole rotated picture, not just its anchor or smaller footprint.
      const b = prop.visualBoundsMm, picture = propFootprint({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
      if (!polygonInside(picture, terrainPoints(area)) || !supportedPolygon(scene, picture, prop.supportRef, prop.floorId)
        || occupied.some(other => polygonsOverlap(other, picture))) continue
      commands.push({ type: 'addProp', id, floorId: area.floorId, layerId: scene.entityLayers[area.id], definitionRef: { id: item.id, version: definition.version }, positionMm, rotationDeg, supportRef: prop.supportRef },
        { type: 'setPropWaterAppearance', id, settings: item.appearance })
      occupied.push(picture); placed.push(item.name); accepted = true
    }
    if (!accepted) skipped.push(`${item.name}：没有容纳完整旋转图像的可见水域`)
  }
  return { commands, report: { recipeVersion: settings.recipeVersion, seed: settings.seed, waterCount: water.length, placed, skipped, attempts } }
}
