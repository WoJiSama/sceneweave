import { definitionPresentation, topDownPresentation } from '../appearance/presentation.js'
import { propAppearanceSnapshot } from '../appearance/graph.js'
import { createPublicVisibility } from '../geometry/visibility.js'
import type { ProjectData } from '../model/project.js'
import type { PropAppearanceSnapshot } from '../model/appearance.js'
import { canonicalJson } from '../validation/json.js'
import type { AuthoringStartV4 } from './authoring-protocol-v4.js'

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null)
function deny(): never { throw new Error('当前工程AI创作无效：任务改变了固定源、表现参数或派生素材。') }
/** Fixed resources stay immutable. Native placement may bind a new source to
 * an already granted definition/template and its exact fixed presentation. */
export function assertCurrentAuthoringResourceEvolution(start: AuthoringStartV4, after: ProjectData, generatedSnapshots: readonly PropAppearanceSnapshot[] = []): void {
  const before = start.project, original = before.appearance, next = after.appearance
  for (const key of ['assets', 'licenses', 'licenseBindings', 'authoringSources'] as const) if (!same(before[key], after[key])) deny()
  for (const key of ['assets', 'propDefinitions', 'prefabDefinitions', 'materials', 'styleThemes'] as const) if (!same(before.document[key], after.document[key])) deny()
  if (!same(original.variants, next.variants)) deny()
  for (const [id, value] of Object.entries(original.sources)) if (!same(value, next.sources[id])) deny()
  for (const [id, value] of Object.entries(original.presentations ?? {})) if (!same(value, next.presentations?.[id])) deny()

  const snapshots: PropAppearanceSnapshot[] = [...generatedSnapshots], allowedSources = new Set<string>()
  const definitionIds = new Set([...(start.scope.placement?.definitionIds ?? []), ...(start.scope.scene?.definitionIds ?? []), ...(start.scope.visual?.definitionIds ?? [])])
  for (const id of definitionIds) {
    const definition = before.document.propDefinitions[id]
    if (!definition) deny()
    snapshots.push({ definitionRef: { id, version: definition.version }, appearance: definition.defaultAppearance,
      visualBoundsMm: definition.defaultVisualBoundsMm, shadowClass: definition.defaultShadowClass, shadowOverride: null })
  }
  const permitSource = (id: string) => {
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const source = original.sources[id]
      if (!source || source.kind !== 'prop') deny()
      allowedSources.add(id); snapshots.push(source.snapshot)
      id = source.parentSourceId ?? ''
    }
  }
  const visible = createPublicVisibility(before.document)
  for (const id of new Set([...start.scope.targetIds, ...(start.scope.scene?.entityIds ?? []), ...(start.scope.visual?.entityIds ?? [])])) {
    const prop = before.document.props[id]
    if (prop && visible.prop(prop) && original.propSources[id]) permitSource(original.propSources[id])
  }
  for (const id of start.scope.scene?.prefabDefinitionIds ?? []) {
    const definition = before.document.prefabDefinitions[id], template = original.prefabAppearanceTemplates[id]
    if (!definition || !template) deny()
    for (const member of definition.members) snapshots.push(propAppearanceSnapshot(member.propTemplate))
    for (const member of Object.values(template.members)) permitSource(member.sourceId)
  }
  // Existing default roots supply fixed near-side semantics without granting
  // unrelated historical/private snapshots of the same definition.
  for (const [id, source] of Object.entries(original.sources)) if (source.kind === 'prop' && source.parentSourceId === null
    && snapshots.some(snapshot => same(snapshot, source.snapshot))) allowedSources.add(id)

  const admitted = new Set<string>(), visiting = new Set<string>()
  const admit = (id: string): void => {
    if (admitted.has(id) || allowedSources.has(id)) return
    if (visiting.has(id)) deny()
    visiting.add(id)
    const source = next.sources[id], presentation = next.presentations?.[id]
    if (!source || source.kind !== 'prop' || !presentation || original.sources[id]
      || !snapshots.some(snapshot => same(snapshot, source.snapshot))) deny()
    if (source.snapshot.appearance.kind === 'image') {
      const asset = before.document.assets[source.snapshot.appearance.assetId]
      if (!asset || !before.assets[asset.sha256]) deny()
    }
    if (source.snapshot.definitionRef) {
      const definition = before.document.propDefinitions[source.snapshot.definitionRef.id]
      if (!definition || definition.version !== source.snapshot.definitionRef.version) deny()
    }
    const parent = source.parentSourceId
    if (parent) admit(parent)
    const expected = parent ? next.presentations?.[parent]
      : definitionPresentation(original, source.snapshot.definitionRef) ?? topDownPresentation()
    if (!expected || !same(expected, presentation)) deny()
    admitted.add(id); visiting.delete(id)
  }
  for (const id of Object.keys(next.presentations ?? {})) if (!Object.hasOwn(original.presentations ?? {}, id)) admit(id)
}
