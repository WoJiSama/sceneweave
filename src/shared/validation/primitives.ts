import { z } from 'zod'
import { propVolumeSchema } from '../model/prop-volume.js'
import { BRIDGE_ART_IDS } from '../path-assembly/profiles.js'
import { PROP_OVERRIDE_FIELDS, type MaterialPaint } from '../model/scene.js'
import { waterAppearanceSchema } from '../ocean/contracts.js'

export const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留键不能用作 ID')
export const int = z.number().finite().refine(Number.isSafeInteger, '必须是安全整数')
export const positive = int.refine(value => value > 0)
export const nonnegative = int.refine(value => value >= 0)
export const rank = int.refine(value => value >= -10000 && value <= 10000)
export const angle = z.number().finite().min(0).lt(360)
export const opacity = z.number().finite().min(0).max(1)
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const fixtureGlowSchema = z.object({ color, radiusMm: int.min(100).max(6000), intensity: z.number().finite().min(0).max(2) }).strict()
export const lightBeamSchema = z.object({ directionDeg: angle, apertureDeg: z.number().finite().min(5).max(170), softness: opacity }).strict()
export type LightBeam = z.infer<typeof lightBeamSchema>
const imageFraction = z.number().finite().min(0).max(1)
export const propGlowSchema = fixtureGlowSchema.extend({ anchor: z.object({ u: imageFraction, v: imageFraction }).strict(), beam: lightBeamSchema.optional() }).strict()
export const point = z.object({ x: int, y: int }).strict()
export const size = z.object({ width: positive, height: positive }).strict()
export const bounds = z.object({ x: int, y: int, width: positive, height: positive }).strict()
export const floorArtwork = z.object({ assetId: id, boundsMm: bounds }).strict()
export const unique = <T>(values: T[]) => new Set(values.map(value => JSON.stringify(value))).size === values.length
export const ids = z.array(id).refine(unique, '引用不能重复')
export const strings = z.array(z.string().min(1).max(256)).refine(unique, '文本不能重复')
export const versionRef = z.object({ id, version: positive }).strict()
export const origin = z.object({ kind: z.enum(['original', 'imported', 'generated']), attribution: z.string(), canEmbed: z.boolean() }).strict()
export const identity = { id, catalogId: id, version: positive, licenseRef: id, origin }
export const editable = { id, floorId: id, editLocked: z.boolean() }
export const visibility = z.enum(['public', 'gm'])
export const SIGHT_OCCLUDER_POINT_LIMIT = 32
export const sightOccluderSchema = z.object({
  id,
  pointsLocalMm: z.array(point).min(2).max(SIGHT_OCCLUDER_POINT_LIMIT).refine(points =>
    points.every((p, index) => index === 0 || p.x !== points[index - 1].x || p.y !== points[index - 1].y),
  '遮挡线相邻取点不能重合。'),
  visibility,
}).strict()
export type SightOccluder = z.infer<typeof sightOccluderSchema>
export const PIPE_PORTS = ['inlet', 'outlet'] as const
export const pipePortKind = z.enum(PIPE_PORTS)
export const pipePortsSchema = z.partialRecord(pipePortKind, point)
export type PipePorts = z.infer<typeof pipePortsSchema>
export const layer = z.enum(['ground', 'object', 'canopy'])
export const shadowClass = z.enum(['none', 'furniture', 'vegetation'])
export const shadow = z.object({ directionDeg: angle, offsetMm: nonnegative, blurMm: nonnegative, opacity, color }).strict()
export const appearance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), assetId: id, tint: color.nullable(), opacity, mirrorY: z.literal(true).optional(), glow: propGlowSchema.nullable().optional() }).strict(),
  z.object({ kind: z.literal('symbol'), symbol: z.enum(['table', 'chair', 'shelf', 'rug', 'crate']), bridgeArt: z.enum(BRIDGE_ART_IDS).optional(), detailPercent: int.min(35).max(180).optional(),
    tint: color.nullable(), opacity, mirrorY: z.literal(true).optional(), glow: propGlowSchema.nullable().optional() }).strict(),
])
export const surfaceRef = z.object({ kind: z.enum(['floor', 'terrainArea', 'room']), id }).strict()
export const groundRef = z.object({ kind: z.enum(['floor', 'terrainArea']), id }).strict()
const planarAlignment: z.ZodType<MaterialPaint['alignment']> = z.enum(['world', 'surface'])
export const paint = z.object({ materialRef: versionRef, tileSizeMm: size, rotationDeg: angle, alignment: planarAlignment, originMm: point, tint: color.nullable(), opacity }).strict()
export const overlay = z.object({ id, boundaryMm: z.array(point).min(3).max(512), paint, blendWidthMm: nonnegative, renderOrder: rank }).strict()
export const style = z.object({ base: paint, overlays: z.array(overlay) }).strict().nullable()
export const pathPaint = paint.extend({ alignment: z.enum(['world', 'surface', 'route']) })
export const pathSurfaceStyle = style.unwrap().extend({ base: pathPaint }).nullable()
export const edgeStyle = z.object({ strokeWidthMm: nonnegative, color, bandWidthMm: nonnegative }).strict()
export const templateShape = {
  volume: propVolumeSchema.optional(),
  waterAppearance: waterAppearanceSchema.optional(),
  sightOccluder: sightOccluderSchema.optional(),
  pipePorts: pipePortsSchema.optional(),
  definitionRef: versionRef.nullable(), appearance, positionMm: point, rotationDeg: angle, visualBoundsMm: bounds,
  footprintMm: size, footprintOffsetMm: point, blocksMovement: z.boolean(), blocksSight: z.boolean(),
  renderLayer: layer, renderOrder: rank, shadowClass, shadowOverride: shadow.nullable(),
}
export const overrideFields = z.array(z.enum(PROP_OVERRIDE_FIELDS)).refine(unique, '覆盖字段不能重复')
export const entityKind = z.enum(['vertex', 'room', 'wall', 'opening', 'prop', 'region', 'note', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'prefabInstance', 'scatterGroup'])
export const anchor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity'), entityKind, entityId: id }).strict(),
  z.object({ type: z.literal('point'), positionMm: point }).strict(),
])
export const movementCost = z.number().finite().min(1).max(100)
export const record = <T extends z.ZodType>(entry: T) => z.record(id, entry)

export const timestamp = z.string().datetime({ offset: false })
