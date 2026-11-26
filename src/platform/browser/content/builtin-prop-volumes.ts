import type { ProjectData } from '../../../shared/model/project.js'
import type { PropVolume } from '../../../shared/model/prop-volume.js'
import type { SceneDocument, VersionRef } from '../../../shared/model/scene.js'
import { cloneJson } from '../../../shared/validation/json.js'

// Dimensions describe the authored objects in millimetres. Add each profile
// as a fixed revision so saved projects can continue resolving the original.
const fixed: Record<string, [PropVolume['kind'], number]> = {
  'b2-p-01': ['table', 770], 'b2-p-02': ['seat', 460], 'b2-p-03': ['seat', 440],
  'b2-p-06': ['box', 1900], 'b2-p-08': ['table', 760], 'b2-p-09': ['round', 520], 'b2-p-10': ['lamp', 430],
  'b3-p-01': ['tree', 4300], 'b3-p-02': ['tree', 3600], 'b3-p-03': ['rock', 680], 'b3-p-04': ['rock', 520],
  'm1d-p-01': ['box', 650], 'm1d-p-02': ['box', 1480], 'm1d-p-04': ['lamp', 700], 'm1d-p-05': ['tent', 1500],
  'content-p-refined-tree-broadleaf': ['tree', 4600], 'content-p-refined-shrub-round': ['rock', 670],
  'content-p-bench': ['seat', 460], 'content-p-hearth': ['box', 920], 'content-p-worktable': ['table', 890],
  'content-p-sideboard': ['box', 940], 'content-p-bed-single': ['box', 590], 'content-p-wardrobe': ['box', 2000],
}
const furniture: Record<string, [PropVolume['kind'], number]> = {
  'bed-indigo': ['box', 580], 'table-round': ['table', 760], 'table-long': ['table', 770],
  'chair-slat': ['seat', 465], 'chair-cushion': ['seat', 450], 'armchair': ['box', 790],
  'cupboard-linen': ['box', 1720], 'counter-kitchen': ['box', 910], 'desk-writing': ['table', 765],
  'stove-masonry': ['box', 940], 'shelf-books': ['box', 1830], 'crate-small': ['box', 540],
  'lantern-brass': ['lamp', 380], 'basket-linen': ['round', 290],
}
const plants: Record<string, [PropVolume['kind'], number]> = {
  'oak-spreading': ['tree', 5100], 'birch-young': ['tree', 4100], 'pine-branched': ['tree', 4800], 'willow-river': ['tree', 4900],
  'hazel-bush': ['rock', 860], 'bramble-fruiting': ['rock', 650], 'juniper-low': ['rock', 560],
  'fern-full-crown': ['rock', 370], 'dock-rosette': ['rock', 240], 'sedge-tussock': ['rock', 440],
  'reed-whole-clump': ['rock', 780], 'wildflower-whole-clump': ['rock', 350],
}
const profiles = new Map([
  ...Object.entries(fixed),
  ...Object.entries(furniture).map(([key, profile]) => [`refined-prop-interior-${key}`, profile] as const),
  ...Object.entries(plants).map(([key, profile]) => [`whole-plants-v1-prop-${key}`, profile] as const),
])

const revisionId = (id: string) => `${id}-oblique-v1`

export function addBuiltinPropVolumes(scene: SceneDocument): Map<string, string> {
  const revised = new Map<string, string>()
  for (const source of Object.values(scene.propDefinitions)) {
    const { id } = source
    if (source.version !== 1 || source.defaultVolume) continue
    const profile = profiles.get(id)
    if (!profile) continue
    const [kind, heightMm] = profile, nextId = revisionId(id)
    if (Object.hasOwn(scene.propDefinitions, nextId)) throw new Error(`立体素材固定身份已占用：${nextId}`)
    scene.propDefinitions[nextId] = { ...cloneJson(source), id: nextId, version: 2, name: `${source.name} · 立体版`, defaultVolume: { kind, heightMm } }
    revised.set(id, nextId)
  }
  return revised
}

export function withBuiltinPropVolumes(project: ProjectData): ProjectData {
  const document = { ...project.document, propDefinitions: { ...project.document.propDefinitions } }
  const revised = addBuiltinPropVolumes(document)
  const bindings = project.licenseBindings.flatMap(binding => {
    const id = binding.subjectKind === 'propDefinition' ? revised.get(binding.subjectId) : undefined
    return id ? [{ ...binding, subjectId: id }] : []
  })
  return { ...project, document, licenseBindings: [...project.licenseBindings, ...bindings] }
}

export function preferredObliqueProp(scene: SceneDocument, id: string): VersionRef {
  const revised = scene.propDefinitions[revisionId(id)]
  return revised?.version === 2 ? { id: revised.id, version: revised.version } : { id, version: 1 }
}
