import { z } from 'zod'
import type { SceneCommand } from '../commands/commands.js'
import type { OutdoorCommand } from '../commands/outdoor.js'
import type { SceneDocument, TerrainConnection } from '../model/scene.js'
import { connectionCenterline, connectionRouteSchema, sampleConnectionRoute, type ConnectionRoute } from '../geometry/connection-route.js'
import { captureJson, cloneJson } from '../validation/json.js'
import { createTerrainSlopeCommand } from '../terrain-inlay/slope.js'
import { staircaseSchema, type StaircaseConfig } from './contracts.js'
import { planStaircase } from './geometry.js'

const optionsSchema = z.object({
  staircase: staircaseSchema.nullable(), route: connectionRouteSchema.optional(),
  widthMm: z.number().int().positive().optional(),
  transform: z.object({ rotationDeg: z.number().finite().min(-360).max(360), lengthScale: z.number().finite().positive().max(100) }).strict().optional(),
  bankWidthMm: z.object({ left: z.number().int().min(1).max(20_000), right: z.number().int().min(1).max(20_000) }).strict().optional(),
}).strict()
export interface StaircaseEdit {
  staircase: StaircaseConfig | null
  route?: ConnectionRoute
  widthMm?: number
  transform?: { rotationDeg: number; lengthScale: number }
  bankWidthMm?: { left: number; right: number }
}

/** Pure command preparation. Adoption still verifies the full live baseline,
 * dependencies, locks, identity and resources through the normal workspace. */
export function prepareStaircaseCommands(scene: SceneDocument, id: string, raw: StaircaseEdit): SceneCommand[] {
  const options = optionsSchema.parse(captureJson(raw)), current = scene.terrainConnections[id]
  if (!current || current.carvedStrip) throw Error('请选择普通高差连接或完整坡体上的阶梯。')
  const original = current.terrainInlay?.originalConnection ?? current
  const source: TerrainConnection = { ...cloneJson(original), editLocked: current.editLocked,
    visibility: current.visibility, blocksMovement: current.blocksMovement,
    movementCostMultiplier: current.movementCostMultiplier, surfaceStyle: cloneJson(current.surfaceStyle) }
  delete source.staircase
  if (current.staircase) source.staircase = cloneJson(current.staircase)
  if (options.route) source.route = cloneJson(options.route)
  let points = connectionCenterline(source)
  if (options.transform) {
    const { rotationDeg, lengthScale } = options.transform, angle = rotationDeg * Math.PI / 180, pivot = points[0]
    const transform = (point: { x: number; y: number }) => ({
      x: Math.round(pivot.x + ((point.x - pivot.x) * Math.cos(angle) - (point.y - pivot.y) * Math.sin(angle)) * lengthScale),
      y: Math.round(pivot.y + ((point.x - pivot.x) * Math.sin(angle) + (point.y - pivot.y) * Math.cos(angle)) * lengthScale),
    })
    if (source.route) {
      const route = { ...source.route, segments: source.route.segments.map(segment => ({ ...segment,
        start: transform(segment.start), control1: transform(segment.control1), control2: transform(segment.control2), end: transform(segment.end) })) }
      source.route = connectionRouteSchema.parse({ ...route, centerlineMm: sampleConnectionRoute(route) })
      points = source.route.centerlineMm
    } else points = points.map(transform)
  }
  source.from.positionMm = cloneJson(points[0]); source.to.positionMm = cloneJson(points.at(-1)!)
  if (options.widthMm !== undefined) source.widthMm = options.widthMm
  if (options.staircase === null) delete source.staircase
  else { source.staircase = cloneJson(options.staircase); planStaircase(points, source.widthMm, source.staircase) }
  const geometryChanged = JSON.stringify([original.from, original.to, original.route, original.widthMm]) !== JSON.stringify([source.from, source.to, source.route, source.widthMm])
  const changes: Extract<OutdoorCommand, { type: 'updateTerrainConnection' }>['changes'] = { staircase: options.staircase }
  if (geometryChanged) Object.assign(changes, { from: source.from, to: source.to, widthMm: source.widthMm, ...(source.route ? { route: source.route } : {}) })
  const update: SceneCommand = { type: 'updateTerrainConnection', id, changes }
  if (!current.terrainInlay || !geometryChanged && !options.bankWidthMm) return [update]
  if (!options.bankWidthMm) throw Error('重建坡体前请明确设置左右两侧延伸宽度。')
  const sourceScene = cloneJson(scene); sourceScene.terrainConnections[id] = source
  const adopt = createTerrainSlopeCommand(sourceScene, id, { bankWidthMm: options.bankWidthMm })
  return [
    { type: 'restoreTerrainInlaySource', id, disposition: 'restore-original-connection-and-ground' },
    update,
    { ...adopt, ...(current.terrainInlay.appearance ? { appearance: current.terrainInlay.appearance } : {}),
      ...(current.terrainInlay.finish ? { finish: cloneJson(current.terrainInlay.finish) } : {}) },
  ]
}
