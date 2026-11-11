import { describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { loadLibraryCapsule } from '../../../shared/library/content.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { prepareImageImportItemVariant, type ImageImportItemChanges } from './image-import-item.js'

const changes: ImageImportItemChanges = { name: '编辑后的钢琴', widthMm: 2300, heightMm: 1700, footprintWidthMm: 1800, footprintHeightMm: 1200, blocksMovement: true }
async function source() {
  const bundle = fixture({ image: true })
  bundle.project.document.propDefinitions.definition.tags.push('图片拆解')
  Object.assign(bundle.project, createCompositionContent(bundle.project.document, runtime))
  return fromBundle(bundle, validation)
}
describe('fixed copies of extracted image items', () => {
  it('creates an editable-size fixed definition while retaining original pixels and exact licence', async () => {
    const project = await source(), before = canonicalJson(toBundle(project).project)
    const entry = await prepareImageImportItemVariant(project, 'definition', changes, undefined, validation)
    const capsule = await loadLibraryCapsule(entry, validation), definition = capsule.project.document.propDefinitions[entry.item.selector.definitionId]
    expect(definition).toMatchObject({ name: changes.name, defaultVisualBoundsMm: { x: -1150, y: -850, width: 2300, height: 1700 },
      defaultFootprintMm: { width: 1800, height: 1200 }, defaultBlocksMovement: true })
    expect(definition.id).not.toBe('definition')
    expect(definition.origin).toEqual(project.document.propDefinitions.definition.origin)
    expect(capsule.project.licenses).toEqual(project.licenses)
    const asset = capsule.project.document.assets.image
    expect(await capsule.resources.read(asset.sha256)).toEqual(await project.resources.read(asset.sha256))
    expect(capsule.project.licenseBindings.find(binding => binding.subjectKind === 'propDefinition')!.licensePath)
      .toEqual(project.licenseBindings.find(binding => binding.subjectKind === 'propDefinition')!.licensePath)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
    const repeated = await prepareImageImportItemVariant(project, 'definition', changes, undefined, validation)
    expect(repeated.item.identity).toEqual(entry.item.identity)
  })
  it('rejects invalid edited dimensions and cancellation without mutating the source', async () => {
    const project = await source(), before = canonicalJson(toBundle(project).project)
    await expect(prepareImageImportItemVariant(project, 'definition', { ...changes, footprintWidthMm: 0 }, undefined, validation)).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(prepareImageImportItemVariant(project, 'definition', changes, controller.signal, validation)).rejects.toMatchObject({ name: 'AbortError' })
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })
})
