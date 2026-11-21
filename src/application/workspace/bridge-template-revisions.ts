import { z } from 'zod'
import { selectManualCommandBudget } from '../../shared/budget/manual-request.js'
import { createPublicVisibility } from '../../shared/geometry/visibility.js'
import { prepareLibraryEntries } from '../../shared/library/content.js'
import type { CatalogSelector } from '../../shared/library/types.js'
import type { Path } from '../../shared/model/scene.js'
import { pathAssemblyRecipeSchema, type PathAssemblyCommand } from '../../shared/path-assembly/contracts.js'
import { checkCancelled, type CompleteValidationOptions } from '../../shared/ports/resources.js'
import { captureSceneTemplateEntries, loadSceneTemplate, prepareSceneTemplate, type SceneTemplateEntry } from '../../shared/scene-templates/content.js'
import { canonicalJson, captureJson } from '../../shared/validation/json.js'
import { id } from '../../shared/validation/primitives.js'
import { prepareCatalogAdoption, prepareCompositionCommands, type PrepareOptions } from './prepare.js'
import { fromVerifiedBundle, toBundle, tryDeriveEditableProject, validateEditableProject, type EditableProject } from './project.js'

const revisionFields = ['finish', 'section', 'dimensions', 'fit', 'lamps', 'structure', 'sides', 'shoulderMm', 'endClearanceMm', 'gaps'] as const
export type BridgeTemplateField = typeof revisionFields[number]
const revisionRequest = z.object({
  bridgeId: id,
  name: z.string().trim().min(1).max(80),
  fields: z.array(z.enum(revisionFields)).min(1).max(revisionFields.length)
    .refine(fields => new Set(fields).size === fields.length),
}).strict()

function bridgePath(project: EditableProject, pathId: string) {
  const path = Object.hasOwn(project.document.paths, pathId) ? project.document.paths[pathId] : undefined
  if (!path?.assembly?.bridge) throw new Error('请选择一座桥梁实例。')
  return path
}

function settings(path: Path) {
  return { ...path.assembly!.recipe, finish: path.assembly!.bridge!.finish }
}

function changedFields(before: Path, after: Path) {
  const base = settings(before), next = settings(after)
  return revisionFields.filter(field => canonicalJson(base[field] ?? null) !== canonicalJson(next[field] ?? null))
}

async function readBridgeTemplate(entry: SceneTemplateEntry, validation: CompleteValidationOptions) {
  const bundle = await loadSceneTemplate(entry.bytes, validation)
  const project = fromVerifiedBundle(bundle, validation)
  const path = bridgePath(project, Object.keys(project.document.paths)[0])
  if (entry.name !== project.document.title) throw new Error('模板库名称与完整内容不符。')
  return { project, path }
}

function assertOriginal(path: Path, entry: SceneTemplateEntry) {
  if (path.assembly!.bridge!.templateKey !== entry.key) throw new Error('桥梁实例所用的原模板已变化。请刷新后重新选择。')
}

export async function describeBridgeTemplateChanges(project: EditableProject, bridgeId: string, entry: SceneTemplateEntry, validation: CompleteValidationOptions) {
  const path = bridgePath(project, bridgeId), [original] = captureSceneTemplateEntries([entry])
  assertOriginal(path, original)
  const base = await readBridgeTemplate(original, validation)
  return changedFields(base.path, path)
}

function applySettings(target: Path, source: Path, fields: readonly BridgeTemplateField[]): PathAssemblyCommand {
  const values = settings(source)
  const { finish, ...recipe } = { ...settings(target), ...Object.fromEntries(fields.map(field => [field, values[field]])) }
  const { elevationMm, visibility } = target.assembly!.bridge!
  return { type: 'setPathAssembly', id: target.id, floorId: target.floorId, centerlineMm: target.centerlineMm,
    widthMm: target.widthMm, recipe: pathAssemblyRecipeSchema.parse(Object.fromEntries(Object.entries(recipe).filter(([, value]) => value !== undefined))),
    bridge: { finish, elevationMm, visibility } }
}

async function adoptRecipeSources(target: EditableProject, source: EditableProject, command: PathAssemblyCommand, options: PrepareOptions) {
  const { section, lamps } = command.recipe
  const selectors: CatalogSelector[] = []
  if (section.kind === 'prop' || section.kind === 'prefab') selectors.push({ kind: section.kind, definitionId: section.ref.id })
  if (lamps?.ref && !selectors.some(row => row.kind === 'prop' && row.definitionId === lamps.ref!.id)) selectors.push({ kind: 'prop', definitionId: lamps.ref.id })
  const incoming = selectors.filter(({ kind, definitionId }) => Object.hasOwn(kind === 'prefab' ? source.document.prefabDefinitions : source.document.propDefinitions, definitionId))
  if (!incoming.length) return { project: target, operationCost: 0 }
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  const entries = await prepareLibraryEntries(toBundle(source), incoming, validation)
  return prepareCatalogAdoption(target, entries, options)
}

export async function prepareBridgeTemplateRevision(input: EditableProject, entry: SceneTemplateEntry, raw: unknown, options: PrepareOptions) {
  const request = revisionRequest.parse(captureJson(raw)), path = bridgePath(input, request.bridgeId)
  const [original] = captureSceneTemplateEntries([entry])
  assertOriginal(path, original)
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  const base = await readBridgeTemplate(original, validation)
  const changes = changedFields(base.path, path)
  if (request.fields.some(field => !changes.includes(field))) throw new Error('所选桥梁改动已变化，请重新比较原模板。')
  if (base.path.visibility === 'public' && !createPublicVisibility(input.document).path(path.id)) throw new Error('主持人专用桥梁请另存为独立模板。')
  const command = applySettings(base.path, path, request.fields)
  const catalog = await adoptRecipeSources(base.project, input, command, options)
  const budget = selectManualCommandBudget(catalog.project, [command])
  const edited = await prepareCompositionCommands(catalog.project, [command], { ...options, budget, initialOperationCost: catalog.operationCost })
  return prepareSceneTemplate(toBundle(edited), { name: request.name, bridgeId: base.path.id, revisesBridgeTemplate: original.key,
    noteIds: Object.keys(edited.document.notes), maskIds: Object.keys(edited.document.regions) }, { ...options, validation })
}

export async function prepareBridgeTemplateSync(input: EditableProject, bridgeId: string, originalEntry: SceneTemplateEntry, nextEntry: SceneTemplateEntry, options: PrepareOptions) {
  const path = bridgePath(input, bridgeId), locked = path.editLocked || input.document.userLayers[input.document.entityLayers[path.id]]?.editLocked
  if (locked) throw new Error('桥梁或所在图层已锁定。')
  const [original, next] = captureSceneTemplateEntries([originalEntry, nextEntry])
  assertOriginal(path, original)
  const validation = { ...options.validation, signal: options.signal ?? options.validation.signal }
  const [base, revision] = await Promise.all([readBridgeTemplate(original, validation), readBridgeTemplate(next, validation)])
  if (revision.path.assembly!.bridge!.templateKey !== original.key || revision.path.visibility !== base.path.visibility) {
    throw new Error('请选择以当前原模板为来源的桥梁新版。')
  }
  const changes = changedFields(base.path, revision.path), manual = new Set(changedFields(base.path, path))
  if (!changes.length) throw new Error('这个新版没有可同步的桥梁设置。')
  const applied = changes.filter(field => !manual.has(field)), preserved = changes.filter(field => manual.has(field))
  const command = applySettings(path, revision.path, applied)
  const catalog = applied.length ? await adoptRecipeSources(input, revision.project, command, options) : { project: input, operationCost: 0 }
  const budget = selectManualCommandBudget(catalog.project, [command])
  const edited = applied.length ? await prepareCompositionCommands(catalog.project, [command], { ...options, budget, initialOperationCost: catalog.operationCost }) : input
  const currentPath = bridgePath(edited, path.id), assembly = currentPath.assembly!
  const result = { ...edited, document: { ...edited.document, paths: { ...edited.document.paths,
    [path.id]: { ...currentPath, assembly: { ...assembly, bridge: { ...assembly.bridge!, templateKey: next.key } } },
  } } }
  checkCancelled(validation.signal)
  const project = tryDeriveEditableProject(result, edited, validation) ?? await validateEditableProject(result, validation)
  return { project, budget, applied, preserved }
}
