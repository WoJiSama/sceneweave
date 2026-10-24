import type { Workspace } from '../../src/application/workspace/workspace'
import type { EditableProject } from '../../src/application/workspace/project'
import type { CompositionCommand } from '../../src/shared/model/appearance'
import { toBundle } from '../../src/application/workspace/project'
import { effectiveAdjustments } from '../../src/shared/appearance/graph'
import { canonicalJson } from '../../src/shared/validation/json'
import { sha256Bytes, decodeUtf8 } from '../../src/shared/project/binary'
import { projectResourceHashes } from '../../src/shared/project/source-resources'

export const ASSIMILATION_IDS = ['assim-a', 'assim-b', 'assim-delete', 'assim-detach', 'range-a', 'range-b', 'outside-same']

/** Fixture placement uses ordinary guarded native commands, never direct document mutation. */
export async function seedAssimilation(workspace: Workspace) {
  const project = workspace.getState().project!, scene = project.document
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const definition = Object.values(scene.propDefinitions).find(item => item.name === '铜色桌灯')!
  if (!definition) throw new Error('Required built-in lamp missing')
  const points = [[2500, 2500], [4500, 2500], [2500, 4500], [4500, 4500], [6500, 3000], [10500, 3000], [15500, 9000]]
  await workspace.execute(ASSIMILATION_IDS.map((id, index) => ({ type: 'addProp', id, floorId, layerId,
    definitionRef: { id: definition.id, version: definition.version }, positionMm: { x: points[index][0], y: points[index][1] }, supportRef: { kind: 'floor', id: floorId } })))
  await workspace.execute([{ type: 'createTerrainArea', id: 'later-terrace', floorId, layerId,
    boundaryMm: [{ x: 10000, y: 7500 }, { x: 14500, y: 7500 }, { x: 14500, y: 11000 }, { x: 10000, y: 11000 }] }])
  await workspace.flush()
  return { floorId, layerId, definitionId: definition.id }
}

export function assimilationState(project: EditableProject) {
  return { document: structuredClone(project.document), identity: structuredClone(project.historyIdentity),
    appearance: structuredClone(project.appearance), sources: structuredClone(project.authoringSources), licenses: structuredClone(project.licenses),
    licenseBindings: structuredClone(project.licenseBindings), adjustments: Object.fromEntries(Object.keys(project.document.props).map(id => [id, effectiveAdjustments(project, id)])) }
}

export async function executeAndSave(workspace: Workspace, commands: CompositionCommand[]) {
  await workspace.execute(commands); await workspace.flush()
}

export async function verifyResourceClosure(project: EditableProject) {
  const bundle = toBundle(project), hashes = projectResourceHashes(bundle.project), verified: string[] = []
  for (const hash of hashes) {
    if (sha256Bytes(await bundle.resources.read(hash)) !== hash) throw new Error(`Resource mismatch: ${hash}`)
    verified.push(hash)
  }
  const sourceTexts = []
  for (const source of Object.values(project.authoringSources)) {
    sourceTexts.push({ original: decodeUtf8(await bundle.resources.read(source.sourceSha256)),
      normalized: decodeUtf8(await bundle.resources.read(source.normalizedSha256)), rasterSha256: source.rasterSha256 })
  }
  return { hashes: verified.sort(), sourceTexts, licenseJson: canonicalJson(project.licenses), bindingsJson: canonicalJson(project.licenseBindings) }
}
