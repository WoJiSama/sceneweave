import type { CatalogKind } from '../../../shared/library/types.js'
import type { AssetRecord } from '../../../shared/model/project.js'

export interface FixedDownloadItem { id: string; kind: CatalogKind; name: string; hashes: string[] }
export interface FixedDownloadManifest {
  items: FixedDownloadItem[]
  assets: Record<string, AssetRecord>
  paths: Record<string, string>
}
