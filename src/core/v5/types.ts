import type { SceneCommandV3 } from '../v3/commands'
import type { PointMm, PropV2, SceneDocumentV3, ShadowClass, SurfaceRef, SurfaceStyle, VersionRef, Visibility } from '../v3/types'
import { HISTORY_LIMITS_V4 } from '../v4/types'

/** V5 versions composition/history metadata; the effective scene stays strict v3. */
export interface HistoryIdentityV5 {
  version: 2
  lineageId: string
  rootSceneId: string
  propTokens: Record<string, string>
  prefabTokens: Record<string, string>
}
export type PropAppearanceSnapshotV5 = Pick<PropV2, 'definitionRef' | 'appearance' | 'visualBoundsMm' | 'shadowClass' | 'shadowOverride'>
export type AppearanceSourceV5 =
  | { id: string; kind: 'prop'; parentSourceId: string | null; snapshot: PropAppearanceSnapshotV5 }
  | { id: string; kind: 'surface'; parentSourceId: string | null; snapshot: SurfaceStyle }
export type AppearanceAdjustmentV5 = { id: string; enabled: boolean } & (
  | { kind: 'tint'; value: string | null }
  | { kind: 'brightness'; value: number }
  | { kind: 'opacity'; value: number }
  | { kind: 'shadowClass'; value: ShadowClass }
)
export type AdjustmentKindV5 = AppearanceAdjustmentV5['kind']
export interface BitmapVariantV5 { id: string; sourceAssetId: string; tint: string | null; brightness: number; outputAssetId: string }
export interface PrefabAppearanceTemplateV5 {
  definitionRef: VersionRef
  visibility: Visibility
  members: Record<string, { sourceId: string; adjustments: AppearanceAdjustmentV5[] }>
}
export interface AppearanceGraphV5 {
  version: 1
  sources: Record<string, AppearanceSourceV5>
  propSources: Record<string, string>
  surfaceSources: Record<string, string>
  instanceAdjustments: Record<string, AppearanceAdjustmentV5[]>
  layerAdjustments: Record<string, AppearanceAdjustmentV5[]>
  variants: Record<string, BitmapVariantV5>
  prefabAppearanceTemplates: Record<string, PrefabAppearanceTemplateV5>
}
export interface CompositionContentV5 { document: SceneDocumentV3; historyIdentity: HistoryIdentityV5; appearance: AppearanceGraphV5 }
export type AppearanceScopeV5 = { kind: 'targets'; ids: string[] } | { kind: 'layer'; layerId: string }
export interface AppearanceScopePlanV5 { targetIds: string[]; inapplicableIds: string[]; affectedIds: string[]; commandCost: number }
export type CompositionCommandV5 = SceneCommandV3
  | { type: 'setAppearanceAdjustment'; scope: AppearanceScopeV5; adjustment: AppearanceAdjustmentV5 }
  | { type: 'toggleAppearanceAdjustment'; scope: AppearanceScopeV5; adjustmentId: string; enabled: boolean }
  | { type: 'removeAppearanceAdjustment'; scope: AppearanceScopeV5; adjustmentId: string }
  | { type: 'setAppearanceSource'; ids: string[]; sourceId: string }
  | { type: 'createPrefab'; id: string; definitionId: string; name: string; ids: string[]; anchorMm: PointMm; licenseRef?: string; tags?: string[] }
  | { type: 'instantiatePrefab'; id: string; definitionRef: VersionRef; memberIds: Record<string, string>; anchorMm: PointMm; rotationDeg?: number; layerId: string; supportRef: SurfaceRef }
  | { type: 'duplicatePrefab'; id: string; newId: string; memberIds: Record<string, string>; offsetMm: PointMm }
  | { type: 'deletePrefab'; id: string; memberIds: string[] }
  | { type: 'detachPrefabMember'; groupId: string; propId: string }
  | { type: 'resetPrefabMember'; groupId: string; key: string; newId?: string; supportRef?: SurfaceRef }

export const COMPOSITION_LIMITS_V5 = Object.freeze({ identities: 65_536, sources: 65_536, sourceDepth: 16, adjustmentsPerTarget: 64, variants: 4096, commandCost: 256 })
export const HISTORY_LIMITS_V5 = Object.freeze({ ...HISTORY_LIMITS_V4, identityProps: COMPOSITION_LIMITS_V5.identities })
