import type { LegacySource } from '../../shared/migration/types'

/** Download already verified original bytes; never parse or rewrite their content. */
export function prepareOriginalDownload(source: Pick<LegacySource, 'sourceSchemaVersion' | 'sourceHash'>, bytes: Uint8Array) {
  const archive = bytes[0] === 0x50 && bytes[1] === 0x4b
  const extension = archive ? 'sceneweave' : 'json'
  return {
    filename: `sceneweave-original-v${source.sourceSchemaVersion}-${source.sourceHash.slice(0, 12)}.${extension}`,
    blob: new Blob([bytes.slice().buffer], { type: archive ? 'application/octet-stream' : 'application/json' }),
  }
}
