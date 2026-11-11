import type { ExtendedIdentityToken } from '../terrain-generation/contracts.js'
import type { TerrainIdentityToken } from '../terrain-generation/composition-contracts.js'

export type OutdoorIdentityKind = 'terrainArea' | 'terrainPoint' | 'terrainSegment' | 'terrainEdge' | 'terrainConnection' | 'path' | 'scatterGroup' | 'scatterExclusion'
export interface OutdoorIdentityToken { kind: OutdoorIdentityKind; token: string; topologyToken: string; topologyHash: string }
export interface DecorationIdentityToken { kind: 'decoration' | 'decorationCluster'; token: string; topologyToken: string; topologyHash: string }
export interface SurfaceRuleIdentityToken { kind: 'surfaceRule'; token: string; topologyToken: string; topologyHash: string }
export type StructureIdentityKind = 'floor' | 'room' | 'wall' | 'vertex' | 'opening' | 'pathAttachment'
export interface StructureIdentityToken { kind: StructureIdentityKind; token: string; topologyToken: string; topologyHash: string }
/** Birth records include deleted entities. Tokens and topology evidence are never reassigned. */
export interface HistoryIdentity {
  version: 1 | 2 | 3 | 4 | 5
  /** Aggregate container births and retired IDs. Representation edits retain
   * tokens; split/merge/copy allocate new containers instead of reusing IDs. */
  aggregateTokens?: Record<string, string>
  generationTokens?: Record<string, ExtendedIdentityToken>
  regionalTokens?: Record<string, ExtendedIdentityToken>
  presentationTokens?: Record<string, ExtendedIdentityToken>
  terrainTokens?: Record<string, TerrainIdentityToken>
  decorationTokens?: Record<string, DecorationIdentityToken>
  surfaceRuleTokens?: Record<string, SurfaceRuleIdentityToken>
  /** Persistent structural continuity, independent of generation provenance.
   * Absence on an earlier development project grants no structural witness. */
  structureTokens?: Record<string, StructureIdentityToken>
  lineageId: string
  rootSceneId: string
  propTokens: Record<string, string>
  prefabTokens: Record<string, string>
  outdoorTokens: Record<string, OutdoorIdentityToken>
}
export const HISTORY_LIMITS = Object.freeze({
  namedPerScene: 32, protectionPerScene: 32, archiveSnapshots: 64, identityProps: 65_536,
  storedResourceBytes: 256 * 1024 * 1024, storedDocumentBytes: 128 * 1024 * 1024,
  storedOriginalBytes: 128 * 1024 * 1024, archiveDocumentBytes: 128 * 1024 * 1024,
})
