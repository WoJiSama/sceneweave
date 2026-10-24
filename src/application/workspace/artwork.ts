import type { AuthoringDraft } from '../../shared/ai/authoring-protocol.js'
import type { CompositionCommand, CompositionContent } from '../../shared/model/appearance.js'
import type { LicenseBinding } from '../../shared/model/project.js'
import type { CompleteValidationOptions } from '../../shared/ports/resources.js'
import { checkCancelled, SvgCapabilityError } from '../../shared/ports/resources.js'
import { normalizeStaticSvg } from '../../shared/ai/svg.js'
import { addPropAppearanceSource } from '../../shared/appearance/graph.js'
import { applyCompositionCommands } from '../../shared/appearance/commands.js'
import { canonicalJson, encodeUtf8 } from '../../shared/validation/json.js'
import { sha256Bytes, sha256Text } from '../../shared/validation/hash.js'
import { normalizePngChunks } from '../../shared/project/image-bytes.js'
import { captureEditableDraft, type EditableProject } from './project.js'
import { materializeProject } from './prepare.js'

const contentOf = (project: EditableProject): CompositionContent => ({ document: project.document, historyIdentity: project.historyIdentity, appearance: project.appearance })
/** A task owns recipes, never trusted PNGs, asset metadata or resource ports. */
export async function materializeAuthoringArtwork(input: EditableProject, draft: AuthoringDraft, validation: CompleteValidationOptions): Promise<EditableProject> {
  let project = input
  for (const step of draft.state.steps) for (let index = 0; index < step.operations.length; index++) {
    const operation = step.operations[index]
    if (operation.kind !== 'svg' && operation.kind !== 'style') continue
    checkCancelled(validation.signal)
    project = captureEditableDraft(project)
    const identity = (label: string) => `ai-art-${sha256Text(canonicalJson([draft.start.seed, step.index, index, label]))}`
    const runtime = { ids: { nextId: () => { throw new Error('素材采用不能分配未记账身份。') } }, clock: { now: () => draft.start.preparedAt } }
    if (operation.kind === 'svg') {
      if (!validation.svg) throw new SvgCapabilityError()
      const prop = project.document.props[operation.id]
      if (!prop) throw new Error('SVG目标在草稿中已不存在。')
      const normalized = normalizeStaticSvg(operation.sourceSvg), scale = operation.longEdgePx / Math.max(normalized.viewBox.width, normalized.viewBox.height)
      const dimensions = { width: Math.max(1, Math.round(normalized.viewBox.width * scale)), height: Math.max(1, Math.round(normalized.viewBox.height * scale)) }
      const pixels = await validation.svg.rasterize(normalized, dimensions, validation)
      checkCancelled(validation.signal)
      if (pixels.width !== dimensions.width || pixels.height !== dimensions.height || pixels.rgba.length !== dimensions.width * dimensions.height * 4) throw new Error('SVG实际像素尺寸无效。')
      const png = normalizePngChunks(await validation.images.encodePng(pixels, validation)), hash = sha256Bytes(png)
      checkCancelled(validation.signal)
      const oldDefinition = prop.definitionRef ? project.document.propDefinitions[prop.definitionRef.id] : null
      const oldAsset = prop.appearance.kind === 'image' ? project.document.assets[prop.appearance.assetId] : null
      const reference = oldDefinition ?? oldAsset
      if (!reference?.origin.canEmbed) throw new Error('SVG派生必须有可保全的原件与许可。')
      const assetId = identity('asset'), definitionId = identity('definition')
      if (project.document.assets[assetId] || project.document.propDefinitions[definitionId]) throw new Error('SVG固定派生身份冲突。')
      project.document.assets[assetId] = { id: assetId, sha256: hash, mimeType: 'image/png', pixelWidth: dimensions.width, pixelHeight: dimensions.height,
        logicalSizeMm: { width: prop.visualBoundsMm.width, height: prop.visualBoundsMm.height }, licenseRef: reference.licenseRef, origin: structuredClone(reference.origin) }
      project.assets[hash] = { sha256: hash, mimeType: 'image/png', sizeBytes: png.length, pixelWidth: dimensions.width, pixelHeight: dimensions.height }
      project.authoringSources[assetId] = { kind: 'svg', sourceSha256: normalized.sourceSha256, normalizedSha256: normalized.normalizedSha256,
        sourceSizeBytes: normalized.sourceSizeBytes, normalizedSizeBytes: normalized.normalizedSizeBytes, rasterSha256: hash, processorId: normalized.processorId, processorVersion: normalized.processorVersion }
      const oldSource = project.appearance.sources[project.appearance.propSources[prop.id]]
      const originalAppearance = oldSource?.kind === 'prop' ? oldSource.snapshot.appearance : prop.appearance
      const appearance = { kind: 'image' as const, assetId, tint: originalAppearance.tint, opacity: originalAppearance.opacity }
      project.document.propDefinitions[definitionId] = { id: definitionId, catalogId: definitionId, version: 1, name: operation.name, tags: oldDefinition?.tags.filter(tag => !tag.startsWith('sceneweave:')) ?? [],
        origin: structuredClone(reference.origin), licenseRef: reference.licenseRef, defaultAppearance: appearance, defaultVisualBoundsMm: structuredClone(prop.visualBoundsMm),
        defaultFootprintMm: structuredClone(prop.footprintMm), defaultFootprintOffsetMm: structuredClone(prop.footprintOffsetMm), defaultBlocksMovement: prop.blocksMovement,
        defaultBlocksSight: prop.blocksSight, defaultRenderLayer: prop.renderLayer, defaultShadowClass: prop.shadowClass }
      const binding = project.licenseBindings.find(value => value.subjectKind === (oldDefinition ? 'propDefinition' : 'asset') && value.subjectId === reference.id)
      if (!binding) throw new Error('SVG原件确切许可绑定缺失。')
      for (const [subjectKind, subjectId] of [['asset', assetId], ['propDefinition', definitionId]] as const) project.licenseBindings.push({ ...binding, subjectKind, subjectId } as LicenseBinding)
      const previous = project.appearance.propSources[prop.id]
      const sourceId = addPropAppearanceSource(project.appearance, { definitionRef: { id: definitionId, version: 1 }, appearance, visualBoundsMm: prop.visualBoundsMm, shadowClass: prop.shadowClass, shadowOverride: prop.shadowOverride }, previous)
      const sourceResources = project.resources, added = new Map([[hash, png], [normalized.sourceSha256, encodeUtf8(normalized.sourceSvg)], [normalized.normalizedSha256, encodeUtf8(normalized.normalizedSource)]])
      project.resources = Object.freeze({ read: (sha: string) => added.has(sha) ? Promise.resolve(added.get(sha)!.slice()) : sourceResources.read(sha) })
      Object.assign(project, applyCompositionCommands(contentOf(project), [{ type: 'setAppearanceSource', ids: [prop.id], sourceId }], runtime))
    } else {
      const commands: CompositionCommand[] = []
      for (const kind of ['tint', 'brightness', 'opacity'] as const) if (operation[kind] !== undefined) {
        const adjustment = kind === 'tint' ? { id: identity(kind), kind, enabled: true, value: operation.tint! } : kind === 'brightness' ? { id: identity(kind), kind, enabled: true, value: operation.brightness! } : { id: identity(kind), kind, enabled: true, value: operation.opacity! }
        commands.push({ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: operation.ids }, adjustment })
      }
      Object.assign(project, applyCompositionCommands(contentOf(project), commands, runtime))
    }
    project = await materializeProject(project, { validation, runtime })
  }
  return project
}
