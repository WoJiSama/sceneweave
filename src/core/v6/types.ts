import type { SceneCommandV3 } from '../v3/commands'
import type { PointMm, PropV2, SceneDocumentV3, ShadowClass, SurfaceRef, SurfaceStyle, VersionRef, Visibility } from '../v3/types'
import { HISTORY_LIMITS_V4 } from '../v4/types'

export type OutdoorIdentityKindV6 = 'terrainArea' | 'terrainPoint' | 'terrainSegment' | 'terrainEdge' | 'terrainConnection' | 'path' | 'scatterGroup' | 'scatterExclusion'
export interface OutdoorIdentityTokenV6 { kind: OutdoorIdentityKindV6; token: string; topologyToken: string; topologyHash: string }
/** V6 persists outdoor birth/topology continuity; the effective scene stays strict v3. */
export interface HistoryIdentityV6 {
  version: 3
  lineageId: string
  rootSceneId: string
  propTokens: Record<string, string>
  prefabTokens: Record<string, string>
  outdoorTokens: Record<string, OutdoorIdentityTokenV6>
}
export type PropAppearanceSnapshotV6 = Pick<PropV2, 'definitionRef' | 'appearance' | 'visualBoundsMm' | 'shadowClass' | 'shadowOverride'>
export type AppearanceSourceV6 =
  | { id: string; kind: 'prop'; parentSourceId: string | null; snapshot: PropAppearanceSnapshotV6 }
  | { id: string; kind: 'surface'; parentSourceId: string | null; snapshot: SurfaceStyle }
export type AppearanceAdjustmentV6 = { id: string; enabled: boolean } & (
  | { kind: 'tint'; value: string | null }
  | { kind: 'brightness'; value: number }
  | { kind: 'opacity'; value: number }
  | { kind: 'shadowClass'; value: ShadowClass }
)
export type AdjustmentKindV6 = AppearanceAdjustmentV6['kind']
export interface BitmapVariantV6 { id: string; sourceAssetId: string; tint: string | null; brightness: number; outputAssetId: string }
export interface PrefabAppearanceTemplateV6 {
  definitionRef: VersionRef
  visibility: Visibility
  members: Record<string, { sourceId: string; adjustments: AppearanceAdjustmentV6[] }>
}
export interface AppearanceGraphV6 {
  version: 1
  sources: Record<string, AppearanceSourceV6>
  propSources: Record<string, string>
  surfaceSources: Record<string, string>
  instanceAdjustments: Record<string, AppearanceAdjustmentV6[]>
  layerAdjustments: Record<string, AppearanceAdjustmentV6[]>
  variants: Record<string, BitmapVariantV6>
  prefabAppearanceTemplates: Record<string, PrefabAppearanceTemplateV6>
}
export interface CompositionContentV6 { document: SceneDocumentV3; historyIdentity: HistoryIdentityV6; appearance: AppearanceGraphV6 }
export type AppearanceScopeV6 = { kind: 'targets'; ids: string[] } | { kind: 'layer'; layerId: string }
export interface AppearanceScopePlanV6 { targetIds: string[]; inapplicableIds: string[]; affectedIds: string[]; commandCost: number }
export type CompositionCommandV6 = SceneCommandV3
  | { type: 'setAppearanceAdjustment'; scope: AppearanceScopeV6; adjustment: AppearanceAdjustmentV6 }
  | { type: 'toggleAppearanceAdjustment'; scope: AppearanceScopeV6; adjustmentId: string; enabled: boolean }
  | { type: 'removeAppearanceAdjustment'; scope: AppearanceScopeV6; adjustmentId: string }
  | { type: 'setAppearanceSource'; ids: string[]; sourceId: string }
  | { type: 'createPrefab'; id: string; definitionId: string; name: string; ids: string[]; anchorMm: PointMm; licenseRef?: string; tags?: string[] }
  | { type: 'instantiatePrefab'; id: string; definitionRef: VersionRef; memberIds: Record<string, string>; anchorMm: PointMm; rotationDeg?: number; layerId: string; supportRef: SurfaceRef }
  | { type: 'duplicatePrefab'; id: string; newId: string; memberIds: Record<string, string>; offsetMm: PointMm }
  | { type: 'deletePrefab'; id: string; memberIds: string[] }
  | { type: 'detachPrefabMember'; groupId: string; propId: string }
  | { type: 'resetPrefabMember'; groupId: string; key: string; newId?: string; supportRef?: SurfaceRef }

export const COMPOSITION_LIMITS_V6 = Object.freeze({ identities: 65_536, sources: 65_536, sourceDepth: 16, adjustmentsPerTarget: 64, variants: 4096, commandCost: 256 })
export const HISTORY_LIMITS_V6 = Object.freeze({ ...HISTORY_LIMITS_V4, identityProps: COMPOSITION_LIMITS_V6.identities })
