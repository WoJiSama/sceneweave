import { z } from 'zod'
import { PROP_OVERRIDE_FIELDS } from '../model/scene.js'

export const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留键不能用作 ID')
export const int = z.number().finite().refine(Number.isSafeInteger, '必须是安全整数')
export const positive = int.refine(value => value > 0)
export const nonnegative = int.refine(value => value >= 0)
export const rank = int.refine(value => value >= -10000 && value <= 10000)
export const angle = z.number().finite().min(0).lt(360)
export const opacity = z.number().finite().min(0).max(1)
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const point = z.object({ x: int, y: int }).strict()
export const size = z.object({ width: positive, height: positive }).strict()
export const bounds = z.object({ x: int, y: int, width: positive, height: positive }).strict()
export const unique = <T>(values: T[]) => new Set(values.map(value => JSON.stringify(value))).size === values.length
export const ids = z.array(id).refine(unique, '引用不能重复')
export const strings = z.array(z.string().min(1).max(256)).refine(unique, '文本不能重复')
export const versionRef = z.object({ id, version: positive }).strict()
export const origin = z.object({ kind: z.enum(['original', 'imported', 'generated']), attribution: z.string(), canEmbed: z.boolean() }).strict()
export const identity = { id, catalogId: id, version: positive, licenseRef: id, origin }
export const editable = { id, floorId: id, editLocked: z.boolean() }
export const visibility = z.enum(['public', 'gm'])
export const layer = z.enum(['ground', 'object', 'canopy'])
export const shadowClass = z.enum(['none', 'furniture', 'vegetation'])
export const shadow = z.object({ directionDeg: angle, offsetMm: nonnegative, blurMm: nonnegative, opacity, color }).strict()
export const appearance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), assetId: id, tint: color.nullable(), opacity }).strict(),
  z.object({ kind: z.literal('symbol'), symbol: z.enum(['table', 'chair', 'shelf', 'rug', 'crate']), tint: color.nullable(), opacity }).strict(),
])
export const surfaceRef = z.object({ kind: z.enum(['floor', 'terrainArea', 'room']), id }).strict()
export const groundRef = z.object({ kind: z.enum(['floor', 'terrainArea']), id }).strict()
export const paint = z.object({ materialRef: versionRef, tileSizeMm: size, rotationDeg: angle, alignment: z.enum(['world', 'surface']), originMm: point, tint: color.nullable(), opacity }).strict()
export const overlay = z.object({ id, boundaryMm: z.array(point).min(3).max(512), paint, blendWidthMm: nonnegative, renderOrder: rank }).strict()
export const style = z.object({ base: paint, overlays: z.array(overlay) }).strict().nullable()
export const edgeStyle = z.object({ strokeWidthMm: nonnegative, color, bandWidthMm: nonnegative }).strict()
export const templateShape = {
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
