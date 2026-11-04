import type { Decoration, DecorationCluster, PointMm, Prop, SceneDocument } from '../model/scene.js'
import { propFootprint } from '../geometry/geometry.js'
import { cloneJson } from '../validation/json.js'

export const decorationRecords = (scene: Readonly<SceneDocument>): Record<string, Decoration> => scene.decorations ?? {}
export const decorationClusterRecords = (scene: Readonly<SceneDocument>): Record<string, DecorationCluster> => scene.decorationClusters ?? {}
const scaled = (value: number, ppm: number): number => Math.round(value * ppm / 1_000_000)
/** Temporary physical/paint input only. Never stored as a Prop or granted collision. */
export function decorationAsProp(scene: Readonly<SceneDocument>, row: Decoration): Prop {
  const definition = scene.propDefinitions[row.definitionRef.id]
  if (!definition || definition.version !== row.definitionRef.version) throw new Error(`轻量装饰缺少固定定义：${row.id}。`)
  const b = definition.defaultVisualBoundsMm
  return { id: row.id, floorId: row.floorId, editLocked: row.editLocked, visibility: row.visibility,
    definitionRef: cloneJson(row.definitionRef), appearance: cloneJson(definition.defaultAppearance),
    positionMm: cloneJson(row.positionMm), rotationDeg: row.rotationDeg,
    visualBoundsMm: { x: scaled(b.x, row.scalePpm), y: scaled(b.y, row.scalePpm), width: Math.max(1, scaled(b.width, row.scalePpm)), height: Math.max(1, scaled(b.height, row.scalePpm)) },
    footprintMm: { width: Math.max(1, scaled(definition.defaultFootprintMm.width, row.scalePpm)), height: Math.max(1, scaled(definition.defaultFootprintMm.height, row.scalePpm)) },
    footprintOffsetMm: { x: scaled(definition.defaultFootprintOffsetMm.x, row.scalePpm), y: scaled(definition.defaultFootprintOffsetMm.y, row.scalePpm) },
    blocksMovement: false, blocksSight: false, supportRef: cloneJson(row.supportRef), renderLayer: definition.defaultRenderLayer,
    renderOrder: row.renderOrder, shadowClass: definition.defaultShadowClass, shadowOverride: null }
}
export const decorationFootprint = (scene: Readonly<SceneDocument>, row: Decoration): PointMm[] => propFootprint(decorationAsProp(scene, row))
/**
 * Generation may run on a pure Scene without the optional appearance hints.
 * Every legal fixed root is inside its image, so this envelope conservatively
 * contains both centered top-down and root-anchored near-side paint. Exact
 * selection/render geometry is supplied by the validated appearance path.
 */
export function conservativePropPaintEnvelope(prop: Pick<Prop, 'positionMm' | 'visualBoundsMm' | 'rotationDeg'>): PointMm[] {
  const radius = Math.ceil(Math.hypot(prop.visualBoundsMm.width, prop.visualBoundsMm.height))
  const p = prop.positionMm
  return [{ x: p.x - radius, y: p.y - radius }, { x: p.x + radius, y: p.y - radius }, { x: p.x + radius, y: p.y + radius }, { x: p.x - radius, y: p.y + radius }]
}
