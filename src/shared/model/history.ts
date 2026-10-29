import type { ExtendedIdentityToken } from '../terrain-generation/contracts.js'
import type { TerrainIdentityToken } from '../terrain-generation/composition-contracts.js'

export type OutdoorIdentityKind = 'terrainArea' | 'terrainPoint' | 'terrainSegment' | 'terrainEdge' | 'terrainConnection' | 'path' | 'scatterGroup' | 'scatterExclusion'
export interface OutdoorIdentityToken { kind: OutdoorIdentityKind; token: string; topologyToken: string; topologyHash: string }
/** Birth records include deleted entities. Tokens and topology evidence are never reassigned. */
export interface HistoryIdentity {
  version: 1 | 2 | 3
  generationTokens?: Record<string, ExtendedIdentityToken>
  regionalTokens?: Record<string, ExtendedIdentityToken>
  presentationTokens?: Record<string, ExtendedIdentityToken>
  terrainTokens?: Record<string, TerrainIdentityToken>
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
