import { z } from 'zod'
import { effectiveEditLocked } from '../../shared/commands/layers.js'
import { captureJson } from '../../shared/validation/json.js'
import { prepareLibraryEntry } from '../../shared/library/content.js'
import type { PreparedLibraryEntry } from '../../shared/library/types.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { prepareCompositionCommands, type PrepareOptions } from './prepare.js'
import { captureEditableInput, toBundle, validateEditableProject, type EditableProject } from './project.js'

const requestSchema = z.object({
  ids: z.array(z.string().min(1).max(256)).min(1).max(128).refine(ids => new Set(ids).size === ids.length),
  name: z.string().trim().min(1).max(80),
}).strict()

/** Creates a detached fixed composition from the actual selection. Preparation
 * never adopts the temporary group or changes the source workspace/revision.
 * Existing prefab slots are reduced to live members only by the normal unpack
 * command; appearance freezing/ancestors and private visibility stay owned by
 * the existing composition executor and neutral library closure extractor. */
export async function prepareDressingTemplate(input: EditableProject, raw: unknown, options: PrepareOptions): Promise<PreparedLibraryEntry> {
  const captured = captureEditableInput(input), request = requestSchema.parse(captureJson(raw))
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  checkCancelled(validation.signal)
  let source = await validateEditableProject(captured, validation)
  const scene = source.document, props = new Set<string>(), groups: string[] = []
  for (const id of request.ids) {
    if (effectiveEditLocked(scene, id)) throw new Error('保存布景涉及锁定对象或图层，请先明确解除编辑锁。')
    const group = scene.prefabInstances[id]
    if (group) {
      groups.push(id)
      for (const member of Object.values(group.members)) if (member.propId) props.add(member.propId)
    } else if (scene.props[id]) props.add(id)
    else throw new Error('布景模板请选择独立物件或完整固定组合；房间与建筑使用场景模板。')
  }
  if (!props.size || props.size > 128) throw new Error('布景模板须包含1–128件现存物件。')
  for (const group of Object.values(scene.prefabInstances)) {
    if (Object.values(group.members).some(member => member.propId && props.has(member.propId)) && !groups.includes(group.id)) {
      throw new Error('请选择完整组合，不能只提取其中部分成员。')
    }
  }
  for (const row of Object.values(scene.attachments ?? {})) if (props.has(row.child.id)) throw new Error('当前布景模板尚不提取附着关系，请先明确处理完整附着范围。')
  for (const row of Object.values(scene.attachmentSurfaces ?? {})) if (props.has(row.owner.id)) throw new Error('当前布景模板尚不提取附着宿主，请先明确处理完整附着范围。')
  if (Object.values(scene.decorationClusters ?? {}).some(cluster => Object.values(cluster.members).some(member => member.entityId && props.has(member.entityId)))) throw new Error('布景簇人工记录需要完整场景模板，不能静默转成独立成员。')
  if (groups.length) source = await prepareCompositionCommands(source, groups.map(id => ({ type: 'unpackPrefab' as const, id })), options)
  const ids = [...props], anchorMm = {
    x: Math.round(ids.reduce((sum, id) => sum + source.document.props[id].positionMm.x, 0) / ids.length),
    y: Math.round(ids.reduce((sum, id) => sum + source.document.props[id].positionMm.y, 0) / ids.length),
  }
  const definitionId = options.runtime.ids.nextId()
  const prepared = await prepareCompositionCommands(source, [{ type: 'createPrefab', id: options.runtime.ids.nextId(), definitionId,
    name: request.name, ids, anchorMm, tags: ['当前布景', '场景复用'] }], options)
  checkCancelled(validation.signal)
  return prepareLibraryEntry(toBundle(prepared), { kind: 'prefab', definitionId }, validation)
}
