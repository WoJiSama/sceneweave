import type { AppearanceGraph } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import type { PathAssembly } from './contracts.js'
import { assemblyMemberFingerprint } from './validation.js'

type PlacedMember = Extract<PathAssembly['members'][string], { state: 'placed' }>

export function isRetainedAssemblyMember(scene: SceneDocument, member: PlacedMember, graph?: AppearanceGraph): boolean {
  const prop = scene.props[member.propId], layerId = scene.entityLayers[member.propId]
  if (!prop || member.manualAppearance || prop.editLocked || scene.userLayers[layerId]?.editLocked) return true
  const source = graph?.sources[graph.propSources[member.propId]]
  const unchanged = assemblyMemberFingerprint(prop, layerId) === member.fingerprint
    || source?.kind === 'prop' && assemblyMemberFingerprint({ ...prop, ...source.snapshot }, layerId) === member.fingerprint
  return !unchanged
    || Object.values(scene.notes).some(note => note.anchor.type === 'entity' && note.anchor.entityId === prop.id)
    || Object.values(scene.attachmentSurfaces ?? {}).some(row => row.owner.kind === 'prop' && row.owner.id === prop.id)
    || Object.values(scene.attachments ?? {}).some(row => row.child.kind === 'prop' && row.child.id === prop.id)
}
