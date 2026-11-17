import { z } from 'zod'
import type { SceneDocument } from '../model/scene.js'
import { id } from '../validation/primitives.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { effectiveEditLocked } from '../commands/layers.js'
import { outdoorDependencies } from '../commands/outdoor.js'
import { assertIndependentPropUpdateUnlocked } from '../commands/base.js'
import { waterAppearanceSchema, waterSurfaceSchema } from './contracts.js'
import { validateOcean } from './validation.js'

export const waterCommandSchemas = [
  z.object({ type: z.literal('setWaterSurface'), id, settings: waterSurfaceSchema.nullable() }).strict(),
  z.object({ type: z.literal('setPropWaterAppearance'), id, settings: waterAppearanceSchema.nullable() }).strict(),
] as const
export type WaterCommand = z.infer<typeof waterCommandSchemas[number]>
export const isWaterCommand = (command: { type: string }): command is WaterCommand => command.type === 'setWaterSurface' || command.type === 'setPropWaterAppearance'

/** Detached draft only. The complete owner still checks resources, identities, budgets and CAS. */
export function applyWaterCommand(scene: SceneDocument, command: WaterCommand): { commandCost: number } {
  let affected: string[]
  if (command.type === 'setWaterSurface') {
    const area = scene.terrainAreas[command.id]
    if (!area) throw new Error('目标水面地形不存在。')
    affected = outdoorDependencies(scene, [area.id])
    if (affected.some(id => effectiveEditLocked(scene, id))) throw new Error('水面外观涉及锁定实体、图层或依赖。')
    if (canonicalJson(area.waterSurface ?? null) === canonicalJson(command.settings)) return { commandCost: 0 }
    if (command.settings) area.waterSurface = cloneJson(command.settings)
    else delete area.waterSurface
  } else {
    const prop = scene.props[command.id]
    if (!prop) throw new Error('目标水中物件不存在。')
    assertIndependentPropUpdateUnlocked(scene, prop)
    if (effectiveEditLocked(scene, prop.id) || effectiveEditLocked(scene, prop.supportRef.id)) throw new Error('物件或实际支撑水面已锁定。')
    if (canonicalJson(prop.waterAppearance ?? null) === canonicalJson(command.settings)) return { commandCost: 0 }
    if (command.settings) prop.waterAppearance = cloneJson(command.settings)
    else delete prop.waterAppearance
    for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) {
      const member = Object.values(group.members).find(row => row.propId === prop.id)
      if (member) {
        member.overrideFields = [...new Set([...member.overrideFields, 'waterAppearance' as const])]
        if ('state' in member) member.state = 'manual'
      }
    }
  }
  const errors = validateOcean(scene)
  if (errors.length) throw new Error(errors.map(row => row.message).join('；'))
  return { commandCost: 1 }
}
