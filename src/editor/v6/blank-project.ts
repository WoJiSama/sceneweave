import { geometryDocumentForValidationV3 } from '../../core/v3/domain'
import { validateSceneV3 } from '../../core/v3/schema'
import { LAYER_ENTITY_COLLECTIONS_V3, type SceneDocumentV2, type SceneDocumentV3 } from '../../core/v3/types'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { validateCompleteProjectV6 } from '../../io/v6/project-file'
import type { CompleteProjectV6 } from '../../io/v6/types'
import { createBlankDocumentV2, type BlankDocumentOptionsV2 } from '../v2/blank-project'
import { adoptOutdoorCatalogV2, loadOutdoorCatalogResources } from './outpost-catalog'

/** Native creation, with no fictional migration source or old stored project to downgrade. */
export function createNativeOutdoorDocument(scene: SceneDocumentV2): SceneDocumentV3 {
  const document: SceneDocumentV3 = { ...structuredClone(scene), schemaVersion: 3, userLayers: {}, entityLayers: {} }
  for (const [index, floor] of Object.values(document.floors).entries()) {
    const id = `layer-default-${index}`
    document.userLayers[id] = { id, floorId: floor.id, name: '默认图层', order: 0, editLocked: false }
    for (const collection of LAYER_ENTITY_COLLECTIONS_V3) for (const entity of Object.values(document[collection])) if (entity.floorId === floor.id) document.entityLayers[entity.id] = id
  }
  const checked = validateSceneV3(document)
  if (!checked.ok) throw new Error(`新建室外场景校验失败：${checked.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  return checked.document
}

/** Blank geometry plus complete fixed indoor/outdoor/outpost catalogs and three editable group definitions. */
export function createOutdoorBlankDocument(options: BlankDocumentOptionsV2): SceneDocumentV3 {
  const document = createBlankDocumentV2(options)
  adoptOutdoorCatalogV2(document)
  return createNativeOutdoorDocument(document)
}

export async function createOutdoorBlankProject(options: BlankDocumentOptionsV2, signal?: AbortSignal): Promise<CompleteProjectV6> {
  signal?.throwIfAborted()
  const document = createOutdoorBlankDocument(options)
  const resources = await loadOutdoorCatalogResources(geometryDocumentForValidationV3(document), signal)
  const result: CompleteProjectV6 = { ...createCompositionContentV6(document), ...resources }
  await validateCompleteProjectV6(result, { signal })
  signal?.throwIfAborted()
  return result
}
