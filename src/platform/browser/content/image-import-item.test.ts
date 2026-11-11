import { describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { addPropAppearanceSource, createCompositionContent } from '../../../shared/appearance/graph.js'
import { definitionPresentation } from '../../../shared/appearance/presentation.js'
import { loadLibraryCapsule } from '../../../shared/library/content.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { prepareAssetPrefabVariant, prepareImageImportItemVariant, prepareImageImportMaterialVariant, type ImageImportItemChanges } from './image-import-item.js'

const changes: ImageImportItemChanges = { name: '编辑后的钢琴', widthMm: 2300, heightMm: 1700, footprintWidthMm: 1800, footprintHeightMm: 1200, blocksMovement: true }
async function source() {
  const bundle = fixture({ image: true })
  Object.assign(bundle.project, createCompositionContent(bundle.project.document, runtime))
  return fromBundle(bundle, validation)
}
describe('immutable editable catalog copies', () => {
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
  it('edits a symbol definition without an image-import tag and preserves its original source graph', async () => {
    const bundle = fixture({ image: true }), base = bundle.project.document.propDefinitions.definition
    bundle.project.document.propDefinitions.symbol = { ...structuredClone(base), id: 'symbol', catalogId: 'test.symbol',
      defaultAppearance: { kind: 'symbol', symbol: 'chair', tint: null, opacity: 1 } }
    bundle.project.licenseBindings.push({ ...bundle.project.licenseBindings[0], subjectKind: 'propDefinition', subjectId: 'symbol' })
    const project = await fromBundle(bundle, validation), before = canonicalJson(toBundle(project).project)
    const entry = await prepareImageImportItemVariant(project, 'symbol', { ...changes, footprintOffsetXmm: 37, footprintOffsetYmm: -12, blocksSight: true }, undefined, validation)
    const capsule = await loadLibraryCapsule(entry, validation), edited = capsule.project.document.propDefinitions[entry.item.selector.definitionId]
    expect(edited.defaultAppearance).toEqual(project.document.propDefinitions.symbol.defaultAppearance)
    expect(edited).toMatchObject({ defaultFootprintOffsetMm: { x: 37, y: -12 }, defaultBlocksSight: true })
    expect(canonicalJson(toBundle(project).project)).toBe(before)
    await expect(prepareImageImportItemVariant(project, 'symbol', { ...changes, sourceSvg: '<svg/>' }, undefined, validation)).rejects.toThrow('符号物件')
  })
  it('edits any fixed material and retains its texture, applicable surfaces and exact licence', async () => {
    const bundle = fixture({ image: true }), origin = bundle.project.document.assets.image.origin
    bundle.project.document.materials.wood = { id: 'wood', catalogId: 'test.wood', version: 1, name: '内置木板', tags: [],
      licenseRef: 'fixture-license', origin, textureAssetId: 'image', defaultTileSizeMm: { width: 200, height: 200 }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] }
    bundle.project.licenseBindings.push({ ...bundle.project.licenseBindings[0], subjectKind: 'material', subjectId: 'wood' })
    const project = await fromBundle(bundle, validation), before = canonicalJson(toBundle(project).project)
    const entry = await prepareImageImportMaterialVariant(project, 'wood', { name: '个人木板', widthMm: 300, heightMm: 450 }, undefined, validation)
    const capsule = await loadLibraryCapsule(entry, validation), edited = capsule.project.document.materials[entry.item.selector.definitionId]
    expect(edited).toMatchObject({ name: '个人木板', textureAssetId: 'image', defaultTileSizeMm: { width: 300, height: 450 }, applicableSurfaces: ['room', 'wall', 'terrain', 'path'] })
    expect(capsule.project.licenses).toEqual(project.licenses)
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })
  it('renames a prefab copy while retaining member geometry, fixed appearance and privacy', async () => {
    const bundle = fixture({ image: true }), prop = bundle.project.document.props.item, base = bundle.project.document.propDefinitions.definition
    bundle.project.document.prefabDefinitions.group = { id: 'group', catalogId: 'test.group', version: 1, name: '组合', tags: [],
      licenseRef: base.licenseRef, origin: base.origin, members: [{ key: 'member', propTemplate: {
        definitionRef: prop.definitionRef, appearance: prop.appearance, positionMm: { x: 100, y: 200 }, rotationDeg: 13,
        visualBoundsMm: prop.visualBoundsMm, footprintMm: prop.footprintMm, footprintOffsetMm: prop.footprintOffsetMm,
        blocksMovement: prop.blocksMovement, blocksSight: prop.blocksSight, renderLayer: prop.renderLayer, renderOrder: prop.renderOrder,
        shadowClass: prop.shadowClass, shadowOverride: prop.shadowOverride } }] }
    Object.assign(bundle.project, createCompositionContent(bundle.project.document, runtime))
    bundle.project.appearance.prefabAppearanceTemplates.group.visibility = 'gm'
    bundle.project.licenseBindings.push({ ...bundle.project.licenseBindings[0], subjectKind: 'prefabDefinition', subjectId: 'group' })
    const project = await fromBundle(bundle, validation), before = canonicalJson(toBundle(project).project)
    const entry = await prepareAssetPrefabVariant(project, 'group', { name: '个人组合' }, undefined, validation), capsule = await loadLibraryCapsule(entry, validation)
    const edited = capsule.project.document.prefabDefinitions[entry.item.selector.definitionId]
    expect(edited.name).toBe('个人组合')
    expect(edited.members).toEqual(project.document.prefabDefinitions.group.members)
    expect(capsule.project.appearance.prefabAppearanceTemplates[edited.id]).toEqual({ ...project.appearance.prefabAppearanceTemplates.group, definitionRef: { id: edited.id, version: 1 } })
    expect(entry.item.visibility).toBe('gm')
    expect(canonicalJson(toBundle(project).project)).toBe(before)
  })
  it('retains a near-side fixed presentation when making a resized copy', async () => {
    const bundle = fixture({ image: true }), base = bundle.project.document.propDefinitions.definition
    const presentation = { mode: 'nearSide' as const, rootAnchorMm: { x: 0, y: 0 }, orientation: 'fixedUpright' as const, fixedRotationDeg: 0 as const, footprintAxes: 'world' as const, groundShadowMm: null }
    addPropAppearanceSource(bundle.project.appearance, { definitionRef: { id: base.id, version: base.version }, appearance: base.defaultAppearance,
      visualBoundsMm: base.defaultVisualBoundsMm, shadowClass: base.defaultShadowClass, shadowOverride: null }, null, presentation)
    const project = await fromBundle(bundle, validation), entry = await prepareImageImportItemVariant(project, 'definition', changes, undefined, validation)
    const capsule = await loadLibraryCapsule(entry, validation)
    expect(definitionPresentation(capsule.project.appearance, { id: entry.item.selector.definitionId, version: 1 })).toEqual(presentation)
  })
})
