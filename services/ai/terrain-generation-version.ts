import type { AuthoringOperation } from '../../src/shared/ai/authoring-protocol.js'

/** Select the current shoreline algorithm only for fresh tool input, before its identity is fixed. */
export function selectNewTerrainGenerationVersion<T extends AuthoringOperation>(operation: T): T {
  if (operation.kind !== 'terrainGenerate' || operation.request.algorithmVersion !== undefined
    || (operation.request.kind !== 'island' && operation.request.kind !== 'coast')) return operation
  return { ...operation, request: { ...operation.request, algorithmVersion: 2 } }
}
