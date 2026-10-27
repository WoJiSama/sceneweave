import type { FixedPresentation } from '../terrain-generation/contracts.js'
import type { SceneCommand } from '../commands/commands.js'
import type { PointMm, Prop, SceneDocument, ShadowClass, SurfaceRef, SurfaceStyle, VersionRef, Visibility } from './scene.js'
import type { HistoryIdentity } from './history.js'

export type PropAppearanceSnapshot = Pick<Prop, 'definitionRef' | 'appearance' | 'visualBoundsMm' | 'shadowClass' | 'shadowOverride'>
export type AppearanceSource =
  | { id: string; kind: 'prop'; parentSourceId: string | null; snapshot: PropAppearanceSnapshot }
  | { id: string; kind: 'surface'; parentSourceId: string | null; snapshot: SurfaceStyle }
export type AppearanceAdjustment = { id: string; enabled: boolean } & (
  | { kind: 'tint'; value: string | null }
  | { kind: 'brightness'; value: number }
  | { kind: 'opacity'; value: number }
  | { kind: 'shadowClass'; value: ShadowClass }
)
export type AdjustmentKind = AppearanceAdjustment['kind']
export interface BitmapVariant { id: string; sourceAssetId: string; tint: string | null; brightness: number; outputAssetId: string }
export interface PrefabAppearanceTemplate {
  definitionRef: VersionRef
  visibility: Visibility
  members: Record<string, { sourceId: string; adjustments: AppearanceAdjustment[] }>
}
export interface AppearanceGraph {
  version: 1 | 2
  presentations?: Record<string, FixedPresentation>
  sources: Record<string, AppearanceSource>
  propSources: Record<string, string>
  surfaceSources: Record<string, string>
  instanceAdjustments: Record<string, AppearanceAdjustment[]>
  layerAdjustments: Record<string, AppearanceAdjustment[]>
  variants: Record<string, BitmapVariant>
  prefabAppearanceTemplates: Record<string, PrefabAppearanceTemplate>
}
export interface CompositionContent { document: SceneDocument; historyIdentity: HistoryIdentity; appearance: AppearanceGraph }
export type AppearanceScope = { kind: 'targets'; ids: string[] } | { kind: 'layer'; layerId: string }
export interface AppearanceScopePlan { targetIds: string[]; inapplicableIds: string[]; affectedIds: string[]; commandCost: number }
export type CompositionCommand = SceneCommand
  | { type: 'setAppearanceAdjustment'; scope: AppearanceScope; adjustment: AppearanceAdjustment }
  | { type: 'toggleAppearanceAdjustment'; scope: AppearanceScope; adjustmentId: string; enabled: boolean }
  | { type: 'removeAppearanceAdjustment'; scope: AppearanceScope; adjustmentId: string }
  | { type: 'setAppearanceSource'; ids: string[]; sourceId: string }
  | { type: 'createPrefab'; id: string; definitionId: string; name: string; ids: string[]; anchorMm: PointMm; licenseRef?: string; tags?: string[] }
  | { type: 'instantiatePrefab'; id: string; definitionRef: VersionRef; memberIds: Record<string, string>; anchorMm: PointMm; rotationDeg?: number; layerId: string; supportRef: SurfaceRef }
  | { type: 'duplicatePrefab'; id: string; newId: string; memberIds: Record<string, string>; offsetMm: PointMm }
  | { type: 'deletePrefab'; id: string; memberIds: string[] }
  | { type: 'detachPrefabMember'; groupId: string; propId: string }
  | { type: 'resetPrefabMember'; groupId: string; key: string; newId?: string; supportRef?: SurfaceRef }

export const COMPOSITION_LIMITS = Object.freeze({ identities: 65_536, sources: 65_536, sourceDepth: 16, adjustmentsPerTarget: 64, variants: 4096, commandCost: 256 })
