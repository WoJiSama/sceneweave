import { FURNITURE_COLLECTION_ART, FURNITURE_COLLECTION_LICENSE_REF } from './furniture-collection-art.js'
import type { FurnitureCategory } from '../assets/furniture-collection.js'
import { encodeUtf8, freezeJson } from '../validation/json.js'
import { sha256Bytes } from '../validation/hash.js'
import type { VisualSampleArt } from './sample-art.js'
import { FURNITURE_REFINEMENT_BED_TABLE_PAINTS } from './furniture-refinement-bed-table.js'
import { FURNITURE_REFINEMENT_CHAIR_CABINET_PAINTS } from './furniture-refinement-chair-cabinet.js'

/** Fixed material derivatives, never new furniture designs. The original SVG
 * drawing remains byte-for-byte before the appended local interior paint layer.
 * The original source keys and physical metadata remain independent and intact.
 * Candidate art is pending user review, even after assistant technical checks. */
export interface FurnitureRefinementCandidate {
  sourceKey: string
  category: FurnitureCategory
  styleId: string
  licenseRef: typeof FURNITURE_COLLECTION_LICENSE_REF
  /** Evidence/provenance, never interpreted as a new base furniture design. */
  derivation: {
    kind: 'interior-material-study'
    version: 1
    baseDesignContribution: 0
    originalSvgRetained: true
    sourceSvgSha256: string
    physicalGeometryChanged: false
    materialChanges: readonly string[]
    review: 'candidate-pending-user-review'
  }
  art: VisualSampleArt
}

export function deriveFurnitureMaterial(category: FurnitureCategory, styleId: string, paint: string, changes: readonly string[]): FurnitureRefinementCandidate {
  const sourceKey = `${category}-${styleId}`, original = FURNITURE_COLLECTION_ART.find(row => row.key === sourceKey)
  if (!original || !original.sourceSvg.endsWith('</svg>')) throw new Error(`Missing furniture refinement source: ${sourceKey}`)
  const localSize = category === 'bed' ? [400, 600] : category === 'table' ? [600, 400] : category === 'chair' ? [400, 400] : [600, 360]
  const paintLayer = `<g transform="scale(${original.widthMm / localSize[0]} ${original.heightMm / localSize[1]})">${paint}</g>`
  return {
    sourceKey, category, styleId, licenseRef: FURNITURE_COLLECTION_LICENSE_REF,
    derivation: { kind: 'interior-material-study', version: 1, baseDesignContribution: 0, originalSvgRetained: true,
      sourceSvgSha256: sha256Bytes(encodeUtf8(original.sourceSvg)), physicalGeometryChanged: false,
      materialChanges: changes, review: 'candidate-pending-user-review' },
    art: { ...original, key: `${sourceKey}-material-study-1`, name: `${original.name} · 材质试样1`,
      sourceSvg: original.sourceSvg.slice(0, -6) + paintLayer + '</svg>',
      tags: [...(original.tags ?? []), '材质精修候选', '独立派生', '非新增设计'] },
  }
}

const paints = [...FURNITURE_REFINEMENT_BED_TABLE_PAINTS, ...FURNITURE_REFINEMENT_CHAIR_CABINET_PAINTS]
const paintBySource = new Map(paints.map(row => [`${row.category}-${row.styleId}`, row]))
if (paints.length !== FURNITURE_COLLECTION_ART.length || paintBySource.size !== FURNITURE_COLLECTION_ART.length
  || FURNITURE_COLLECTION_ART.some(row => !paintBySource.has(row.key))) throw new Error('Furniture material derivatives must cover each original design exactly once')

/** Same source ordering and one derivative per original. This count describes
 * material variants, adding zero base plans to the existing 96 designs. */
export const FURNITURE_COLLECTION_REFINEMENT_CANDIDATES: readonly FurnitureRefinementCandidate[] = freezeJson(
  FURNITURE_COLLECTION_ART.map(original => {
    const row = paintBySource.get(original.key)!
    return deriveFurnitureMaterial(row.category, row.styleId, row.paint, row.changes)
  }),
)

export const FURNITURE_COLLECTION_REFINEMENT_ART: readonly VisualSampleArt[] = freezeJson(
  FURNITURE_COLLECTION_REFINEMENT_CANDIDATES.map(row => row.art),
)
