import { describe, expect, it } from 'vitest'
import { prepareDressingTemplate } from './dressing-template.js'
import { fromBundle, toBundle } from './project.js'
import { prepareCompositionCommands } from './prepare.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { adoptLibraryEntries, loadLibraryCapsule } from '../../shared/library/content.js'
import { exportLibraryBackup, importLibraryBackup } from '../../shared/library/backup.js'
import { canonicalJson } from '../../shared/validation/json.js'

const options = { runtime, validation }
describe('current dressing captured as a detached reusable fixed template', () => {
  it('retains effective layer appearance and current poses across a real library backup and independent destination', async () => {
    let source = await fromBundle(fixture({ image: true }), validation)
    source = await prepareCompositionCommands(source, [{ type: 'setAppearanceAdjustment', scope: { kind: 'layer', layerId: source.document.entityLayers.item },
      adjustment: { id: 'layer-opacity', enabled: true, kind: 'opacity', value: .6 } }], options)
    const original = canonicalJson(toBundle(source).project)
    const entry = await prepareDressingTemplate(source, { ids: ['item'], name: '客房床边布景' }, options)
    expect(canonicalJson(toBundle(source).project)).toBe(original)
    const backup = await exportLibraryBackup({ entries: [entry], organizations: {} }, validation)
    const restored = await importLibraryBackup(backup, validation), loaded = await loadLibraryCapsule(restored.entries[0], validation)
    expect(loaded.project.document.props).toEqual({})
    expect(loaded.project.appearance.layerAdjustments).toEqual({})
    const definition = loaded.project.document.prefabDefinitions[entry.item.selector.definitionId]
    expect(definition.members).toHaveLength(1)
    expect(definition.members[0].propTemplate.positionMm).toEqual({ x: 0, y: 0 })
    const target = await fromBundle(fixture(), validation)
    const adopted = await adoptLibraryEntries(toBundle(target), restored.entries, validation)
    const catalog = await fromBundle(adopted.bundle, validation)
    const placed = await prepareCompositionCommands(catalog, [{ type: 'instantiatePrefab', id: 'new-group', definitionRef: { id: definition.id, version: 1 },
      memberIds: { 'member-1': 'new-member' }, layerId: target.document.entityLayers.item, supportRef: { kind: 'floor', id: 'blank-floor' }, anchorMm: { x: 12000, y: 12000 } }], options)
    expect(placed.document.props['new-member'].appearance.opacity).toBe(.6)
    expect(placed.document.props['new-member'].positionMm).toEqual({ x: 12000, y: 12000 })
    expect(placed.historyIdentity.propTokens['new-member']).not.toBe(source.historyIdentity.propTokens.item)
    expect(placed.document.props.item).toEqual(target.document.props.item)
    expect(canonicalJson(toBundle(source).project)).toBe(original)
  })

  it('captures actual living prefab members after manual changes without resurrecting deleted slots', async () => {
    let source = await fromBundle(fixture({ image: true }), validation)
    source = await prepareCompositionCommands(source, [{ type: 'createPrefab', id: 'original-group', definitionId: 'original-definition', name: '旧组合',
      ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], options)
    source = await prepareCompositionCommands(source, [{ type: 'deleteProp', id: 'other' }], options)
    source = await prepareCompositionCommands(source, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 37 } }], options)
    const before = canonicalJson(toBundle(source).project)
    const entry = await prepareDressingTemplate(source, { ids: ['original-group'], name: '当前组合快照' }, options)
    const capsule = await loadLibraryCapsule(entry, validation)
    const definition = capsule.project.document.prefabDefinitions[entry.item.selector.definitionId]
    expect(definition.members).toHaveLength(1)
    expect(definition.members[0].propTemplate.rotationDeg).toBe(37)
    expect(canonicalJson(toBundle(source).project)).toBe(before)
  })

  it('rejects partial containers, unsupported content, locked sources and cancellation', async () => {
    let source = await fromBundle(fixture({ image: true }), validation)
    source = await prepareCompositionCommands(source, [{ type: 'createPrefab', id: 'group', definitionId: 'definition-group', name: '完整组', ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], options)
    await expect(prepareDressingTemplate(source, { ids: ['item'], name: '部分' }, options)).rejects.toThrow(/完整组合/)
    source = await prepareCompositionCommands(source, [{ type: 'setEditLock', kind: 'prefabInstance', id: 'group', locked: true }], options)
    await expect(prepareDressingTemplate(source, { ids: ['group'], name: '锁定' }, options)).rejects.toThrow(/锁/)
    const controller = new AbortController(); controller.abort()
    await expect(prepareDressingTemplate(source, { ids: ['group'], name: '取消' }, { ...options, signal: controller.signal })).rejects.toThrow()
    await expect(prepareDressingTemplate(source, { ids: ['missing'], name: '缺失' }, options)).rejects.toThrow(/布景模板/)
  })
})
