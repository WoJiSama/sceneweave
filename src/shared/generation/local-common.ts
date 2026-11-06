import type { SceneCommand } from '../commands/commands.js'
import type { CompositionContent } from '../model/appearance.js'
import type { SceneDocument } from '../model/scene.js'
import type { GenerationFieldGroup, GenerationReference } from '../terrain-generation/contracts.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'
import { generationInputHash, managedOutputHash, resolveGenerationEntity } from '../terrain-generation/integrity.js'
import { cloneJson } from '../validation/json.js'
import { hashGenerationValue } from './contracts.js'

export type LocalWrite = { kind: GenerationReference['kind']; entityId: string; fields: GenerationFieldGroup[] }
export interface LocalDomainResult { document: SceneDocument; writes: LocalWrite[]; readIds: string[]; notes: string[]; commands?: SceneCommand[] }
export function localOwner(document: SceneDocument, kind: GenerationReference['kind'], entityId: string) {
  const rows = Object.values(getLegacyGeneration(document)!.ownership).filter(row => row.target.kind === kind && row.target.entityId === entityId)
  if (rows.length !== 1) throw new Error(`目标缺少唯一生成归属：${entityId}`)
  return rows[0]
}
export function assertLocalManaged(content: CompositionContent, kind: GenerationReference['kind'], entityId: string, fields: GenerationFieldGroup[], whollyManaged = false) {
  const document = content.document, owner = localOwner(document, kind, entityId), rule = getLegacyGeneration(document)!.rules[owner.ruleId]
  const entity = resolveGenerationEntity(document, owner.target)
  if (!entity || !rule || ['deleted', 'detached'].includes(owner.state) || whollyManaged && owner.state !== 'managed'
    || fields.some(field => !owner.managedFields.includes(field) || owner.manualFields.includes(field))) throw new Error(`目标已人工修改、删除或退出，不能覆盖：${entityId}`)
  if (entity.editLocked || document.userLayers[document.entityLayers[entityId]]?.editLocked || rule.editLocked || document.userLayers[rule.layerId]?.editLocked) throw new Error(`目标、依赖规则或图层已锁定：${entityId}`)
  return owner
}
/** Reclaim only explicitly authorized generated writes. Native commands still
 * perform all geometry/lock/budget checks before their manual hook is reconciled. */
export function finishLocalOwnership(before: SceneDocument, document: SceneDocument, writes: LocalWrite[], recipeId: string): void {
  const gen = getLegacyGeneration(document)!, old = getLegacyGeneration(before)!, recipe = gen.recipes[recipeId]
  if (!recipe || !('domain' in recipe) || recipe.domain === 'mixed') throw new Error('局部更新须选择明确的建筑、森林或火山子配方；组合配方不授予重建权限。')
  for (const write of writes) {
    const prior = Object.values(old.ownership).find(row => row.target.kind === write.kind && row.target.entityId === write.entityId)
    if (prior) {
      const row = gen.ownership[prior.id]
      if (!row) throw new Error('局部更新不能丢弃归属。')
      if (!resolveGenerationEntity(document, row.target)) continue
      for (const field of write.fields) if (prior.managedFields.includes(field) && !prior.manualFields.includes(field)) {
        row.managedFields = [...new Set([...row.managedFields, field])]
        row.manualFields = row.manualFields.filter(value => value !== field)
      }
      if (resolveGenerationEntity(document, row.target)) row.state = row.manualFields.length ? 'manual' : 'managed'
      continue
    }
    const entity = resolveGenerationEntity(document, { kind: write.kind, entityId: write.entityId, parentId: null, fieldGroup: 'geometry' })
    if (!entity) continue
    const id = (key: string) => `local-${hashGenerationValue([recipeId, write.kind, write.entityId, key]).slice(0,32)}`
    const ownerId = id('owner'), ruleId = id('rule'), target = { kind: write.kind, entityId: write.entityId, parentId: null, fieldGroup: 'geometry' as const }
    gen.ownership[ownerId] = { id: ownerId, ruleId, target, outputKey: `${recipeId}:${write.kind}:${write.entityId}`, managedFields: [...write.fields], manualFields: [], state: 'managed', birthToken: id('birth') }
    gen.rules[ruleId] = { id: ruleId, kind: recipe.domain === 'interior' ? 'building' : recipe.domain, recipeRef: { id: recipeId, version: recipe.recipeVersion }, floorId: String(entity.floorId), layerId: document.entityLayers[write.entityId], visibility: entity.visibility === 'gm' ? 'gm' : 'public', editLocked: false,
      inputs: [], outputs: write.fields.map(fieldGroup => ({ ...target, fieldGroup })), parameters: { widthMm: 0, minWidthMm: 0, maxWidthMm: 0, roughness: 0, densityFactor: 0 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  }
  for (const rule of Object.values(gen.rules)) {
    const inputHash = generationInputHash(document, rule), outputHash = managedOutputHash(document, rule)
    if (inputHash !== rule.inputHash || outputHash !== rule.managedOutputHash) {
      if (rule.editLocked || document.userLayers[rule.layerId]?.editLocked) throw new Error('局部更新需要改写锁定的生成规则。')
      rule.inputHash = inputHash; rule.managedOutputHash = outputHash
    }
  }
}
export const localClone = (content: CompositionContent): CompositionContent => cloneJson(content)
