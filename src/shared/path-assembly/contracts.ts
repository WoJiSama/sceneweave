import { z } from 'zod'
import { ROUTE_FRACTION, routeWidthSectionsSchema } from '../geometry/route-width.js'
import { fixtureGlowSchema, id, int, point, versionRef, visibility } from '../validation/primitives.js'
import type { SceneDocument } from '../model/scene.js'
import { sha256Text } from '../validation/hash.js'
import { LINE_PROFILE_IDS } from './profiles.js'
import { bridgeRoadLinksSchema } from './bridge-link-contracts.js'
import { pipeLinksSchema } from './pipe-contracts.js'

export const PATH_ASSEMBLY_MEMBER_LIMIT = 192
const millimetres = (min: number, max: number) => int.min(min).max(max)

const sectionLength = millimetres(100, 20000)
const fixedSection = [
  z.object({ kind: z.literal('steel'), lengthMm: sectionLength }).strict(),
  z.object({ kind: z.literal('timber'), lengthMm: sectionLength }).strict(),
  z.object({ kind: z.literal('prop'), ref: versionRef, lengthMm: sectionLength }).strict(),
  z.object({ kind: z.literal('prefab'), ref: versionRef, lengthMm: sectionLength }).strict(),
  z.object({ kind: z.literal('profile'), profile: z.enum(LINE_PROFILE_IDS), lengthMm: sectionLength }).strict(),
] as const
export const pathStyleSourceSchema = z.discriminatedUnion('kind', fixedSection)
const section = z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }).strict(), ...fixedSection])
const lineDetailSchema = millimetres(35, 180)
const dimensions = z.object({
  visualWidthMm: millimetres(20, 8000).optional(), footprintWidthMm: millimetres(20, 8000).optional(),
  detailPercent: lineDetailSchema.optional(),
}).strict()
const lamps = z.object({ every: int.min(1).max(64), ref: versionRef.optional(), glow: fixtureGlowSchema.optional() }).strict()
export type FixtureGlow = z.infer<typeof fixtureGlowSchema>
export const DEFAULT_FIXTURE_GLOW: FixtureGlow = { color: '#FFC477', radiusMm: 1500, intensity: .8 }

export const isPipeFittingMember = (key: string): boolean => /:(?:pipeBend|startSocket|endSocket)$/.test(key)
export const isPathLampMember = (key: string): boolean => /:(?:lamp|supportLamp|cornerLamp|landingLamp)$/.test(key)
const jointDimensions = z.object({
  lengthMm: millimetres(100, 4000), visualWidthMm: millimetres(20, 8000), footprintWidthMm: millimetres(20, 8000),
}).strict()
const bridgeReliefSchema = z.object({
  depthMm: millimetres(0, 6000),
  shadowOpacity: z.number().finite().min(0).max(.85),
}).strict()
export type BridgeRelief = z.infer<typeof bridgeReliefSchema>
export const DEFAULT_BRIDGE_RELIEF: BridgeRelief = { depthMm: 1500, shadowOpacity: .55 }

const bridgeStructureSchema = z.object({
  palette: z.enum(['riveted', 'alloy']),
  relief: bridgeReliefSchema.optional(),
  support: jointDimensions.extend({ spacingMm: millimetres(300, 20000) }).strict(),
  corner: jointDimensions.optional(),
  bridgehead: z.object({ ends: z.enum(['start', 'end', 'both']), lengthMm: millimetres(200, 6000), wideningMm: millimetres(20, 6000) }).strict().optional(),
}).strict()

export type BridgeStructure = z.infer<typeof bridgeStructureSchema>
export const DEFAULT_BRIDGE_STRUCTURE = {
  palette: 'riveted',
  support: { spacingMm: 3700, lengthMm: 680, visualWidthMm: 1080, footprintWidthMm: 380 },
  corner: { lengthMm: 470, visualWidthMm: 720, footprintWidthMm: 340 },
  bridgehead: { ends: 'both', lengthMm: 1200, wideningMm: 420 },
} as const satisfies BridgeStructure

const opening = z.object({ side: z.enum(['left', 'right', 'both']), fromMm: millimetres(0, 10000000), toMm: millimetres(1, 10000000) })
  .strict().refine(gap => gap.toMm > gap.fromMm, '边缘开口的结束里程须大于开始里程。')

const platformFenceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('segments'), segmentIds: z.array(id).min(1).max(128) }).strict(),
])
export const platformFenceBindingSchema = z.object({
  version: z.literal(1), platformId: id, selection: platformFenceSelectionSchema,
  openingPolicy: z.literal('structural').optional(), insetMm: millimetres(0, 10000).optional(),
}).strict()
export type PlatformFenceBinding = z.infer<typeof platformFenceBindingSchema>

export const pathAssemblyRecipeSchema = z.object({
  section, dimensions: dimensions.optional(), fit: z.literal(true).optional(),
  sides: z.enum(['left', 'right', 'both']),
  shoulderMm: millimetres(120, 10000),
  endClearanceMm: millimetres(0, 10000),
  lamps: lamps.optional(),
  structure: bridgeStructureSchema.optional(),
  gaps: z.array(opening).max(8).optional(),
}).strict()

export const pathStyleDefaultsSchema = z.object({
  lengthMm: sectionLength, dimensions: dimensions.optional(), fit: z.literal(true).optional(), lamps: lamps.optional(),
  structure: bridgeStructureSchema.optional(),
}).strict()
export type PathStyleDefaults = z.infer<typeof pathStyleDefaultsSchema>
export type PathStyleSource = z.infer<typeof pathStyleSourceSchema>
export const publishPathStyleSchema = z.object({
  type: z.literal('publishPathStyle'), id, name: z.string().trim().min(1).max(80),
  source: pathStyleSourceSchema, defaults: pathStyleDefaultsSchema, previousRef: versionRef.optional(),
}).strict()

export type PublishPathStyleCommand = z.infer<typeof publishPathStyleSchema>

const bridgeSettings = z.object({
  elevationMm: millimetres(-1000000, 1000000),
  finish: z.enum(['steel', 'timber']),
  visibility,
}).strict()

export const bridgeTemplateKeySchema = z.string().regex(/^[a-f0-9]{64}$/)

const member = z.discriminatedUnion('state', [
  z.object({ state: z.literal('placed'), propId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), manualAppearance: z.literal(true).optional() }).strict(),
  z.object({ state: z.literal('removed') }).strict(),
])

export const pathAssemblySchema = z.object({
  version: z.literal(1),
  recipe: pathAssemblyRecipeSchema,
  routeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  bridge: bridgeSettings.extend({ deckId: id, roadLinks: bridgeRoadLinksSchema.optional(), templateKey: bridgeTemplateKeySchema.optional() }).strict().optional(),
  members: z.record(z.string().regex(/^(left|right):\d{1,3}:\d{1,6}:(lamp|support|corner|supportLamp|cornerLamp|landingLamp|pipeBend|startSocket|endSocket|section:(body|[a-f0-9]{64}))$/), member).refine(rows => Object.keys(rows).length <= PATH_ASSEMBLY_MEMBER_LIMIT, '沿线构件记录超过上限。'),
}).strict()

export const pathAssemblyCommandSchema = z.object({
  type: z.literal('setPathAssembly'), id, floorId: id, layerId: id.optional(),
  centerlineMm: z.array(point).min(2).max(256), widthMm: millimetres(200, 50000),
  widthSections: routeWidthSectionsSchema.nullable().optional(),
  recipe: pathAssemblyRecipeSchema,
  bridge: bridgeSettings.optional(),
  roadRange: z.object({ startPpm: int.min(0).max(ROUTE_FRACTION - 1), endPpm: int.min(1).max(ROUTE_FRACTION) }).strict()
    .refine(range => range.endPpm > range.startPpm).optional(),
}).strict().refine(command => !!command.roadRange || command.centerlineMm.length <= 128, '沿线装配路线最多 128 个点。')

const fenceRecipeSchema = pathAssemblyRecipeSchema.omit({ sides: true, shoulderMm: true, structure: true }).strict()
export const fenceAssemblySchema = pathAssemblySchema.omit({ bridge: true }).extend({ recipe: fenceRecipeSchema,
  platformBinding: platformFenceBindingSchema.optional(), pipeLinks: pipeLinksSchema.optional() }).strict()
export const fenceAssemblyCommandSchema = z.object({
  type: z.literal('setFenceAssembly'), id, floorId: id, layerId: id,
  centerlineMm: z.array(point).min(2).max(33).optional(), closed: z.boolean().optional(), visibility, recipe: fenceRecipeSchema,
  platformBinding: platformFenceBindingSchema.nullable().optional(),
}).strict().refine(command => !!command.platformBinding || !!command.centerlineMm && command.closed !== undefined,
  '独立围栏须提供中心线和首尾关系。')
export const removeFenceAssemblySchema = z.object({ type: z.literal('removeFenceAssembly'), id }).strict()
export type FenceAssembly = z.infer<typeof fenceAssemblySchema>
export type FenceAssemblyCommand = z.infer<typeof fenceAssemblyCommandSchema>
export type FenceAssemblyRecipe = z.infer<typeof fenceRecipeSchema>

export type PathAssemblyRecipe = z.infer<typeof pathAssemblyRecipeSchema>
export type PathAssembly = z.infer<typeof pathAssemblySchema>
export type PathAssemblyCommand = z.infer<typeof pathAssemblyCommandSchema>

export function bridgeDeckIds(scene: Pick<SceneDocument, 'paths'>): Set<string> {
  return new Set(Object.values(scene.paths).flatMap(path => path.assembly?.bridge ? [path.assembly.bridge.deckId] : []))
}

export const pathSectionPartKey = (sourceKey: string) => 'section:' + (sourceKey === 'body' ? 'body' : sha256Text(sourceKey))
