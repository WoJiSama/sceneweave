import { afterEach, describe, expect, it, vi } from 'vitest'
import { SVG_FIXTURE_SOURCE, svgFixtureValidation, svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { prepareCompositionCommands } from '../../application/workspace/prepare.js'
import { fromBundle, toBundle } from '../../application/workspace/project.js'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import { sha256Bytes } from '../project/binary.js'
import { validateProjectBundle } from '../project/resources.js'
import * as projectValidation from '../project/validate.js'
import { cloneJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { listCatalogItems, listSnapshotCatalogItems } from './content.js'

afterEach(() => vi.restoreAllMocks())

describe('catalog index over privately verified snapshots', () => {
  it('consumes exact validator-owned metadata while the public entry still performs its complete check', async () => {
    const bundle = await validateProjectBundle(fixture({ image: true }), validation)
    const validate = vi.spyOn(projectValidation, 'validateProjectData')
    const indexed = listSnapshotCatalogItems(bundle)
    expect(listSnapshotCatalogItems({ project: bundle.project, resources: bundle.resources })).toBe(indexed)
    expect(validate).not.toHaveBeenCalled()
    expect(listCatalogItems(bundle)).toEqual(indexed)
    expect(validate).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(indexed)).toBe(true)
    expect(Object.isFrozen(indexed[0].identity)).toBe(true)
    expect(() => { indexed[0].name = 'Poisoned cache' }).toThrow()
    expect(listSnapshotCatalogItems(bundle)[0].name).not.toBe('Poisoned cache')
  })

  it('retains the same fixed catalog after actual instance coordinate and angle transactions', async () => {
    const baseline = await fromBundle(fixture({ image: true }), validation)
    const before = listSnapshotCatalogItems(toBundle(baseline))
    const moved = await prepareCompositionCommands(baseline, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 4500, y: 4000 }, rotationDeg: 90 } }], { validation, runtime })
    const validate = vi.spyOn(projectValidation, 'validateProjectData')
    const after = listSnapshotCatalogItems(toBundle(moved))
    expect(after).toBe(before)
    expect(validate).not.toHaveBeenCalled()
    expect(listCatalogItems(toBundle(moved))).toEqual(after)
  })

  it('does not trust cloned metadata, frozen lookalikes, replacement resource ports or matching clocks', async () => {
    const bundle = await validateProjectBundle(fixture({ image: true }), validation)
    const indexed = listSnapshotCatalogItems(bundle)
    const validate = vi.spyOn(projectValidation, 'validateProjectData')
    const clone = { project: cloneJson(bundle.project), resources: bundle.resources }
    const frozen = freezeJson({ project: cloneJson(bundle.project), resources: bundle.resources })
    const replacementReader = { project: bundle.project, resources: { read: bundle.resources.read } }
    for (const input of [clone, frozen, replacementReader]) {
      expect(listSnapshotCatalogItems(input)).toEqual(indexed)
      expect(listSnapshotCatalogItems(input)).not.toBe(indexed)
    }
    expect(validate).toHaveBeenCalledTimes(6)
    clone.project.licenseBindings = []
    expect(clone.project.document.sceneId).toBe(bundle.project.document.sceneId)
    expect(clone.project.document.revision).toBe(bundle.project.document.revision)
    expect(() => listSnapshotCatalogItems(clone)).toThrow()
  })

  it('rechecks mutable callers on every read and rejects accessor wrappers without invoking them', () => {
    const bundle = fixture({ image: true })
    const first = listSnapshotCatalogItems(bundle)
    bundle.project.document.propDefinitions.definition.name = 'Updated fixed definition'
    const second = listSnapshotCatalogItems(bundle)
    expect(second.find(item => item.selector.definitionId === 'definition')!.name).toBe('Updated fixed definition')
    expect(second).not.toEqual(first)
    const read = vi.fn(() => bundle.project)
    expect(() => listSnapshotCatalogItems({ get project() { return read() }, resources: bundle.resources })).toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it('rebuilds a changed fixed definition and preserves its former immutable index', async () => {
    const raw = fixture({ image: true }), original = await validateProjectBundle(raw, validation)
    const first = listSnapshotCatalogItems(original)
    raw.project.document.propDefinitions.definition.name = 'New fixed item'
    const changed = await validateProjectBundle(raw, validation), next = listSnapshotCatalogItems(changed)
    const oldItem = first.find(item => item.selector.definitionId === 'definition')!, newItem = next.find(item => item.selector.definitionId === 'definition')!
    expect(next).not.toBe(first)
    expect(newItem.name).toBe('New fixed item')
    expect(newItem.identity.contentHash).not.toBe(oldItem.identity.contentHash)
    expect(listCatalogItems(changed)).toEqual(next)
    expect(listSnapshotCatalogItems(original)).toBe(first)
  })

  it('rebuilds license-dependent identities and retains complete current metadata validation', async () => {
    const raw = fixture({ image: true }), first = listSnapshotCatalogItems(await validateProjectBundle(raw, validation))
    const text = 'Updated complete catalog license', hash = sha256Bytes(encodeUtf8(text))
    raw.project.licenses = { [hash]: { sha256: hash, text } }
    raw.project.licenseBindings = raw.project.licenseBindings.map(binding => ({ ...binding, licensePath: `licenses/${hash}.txt` }))
    const changed = await validateProjectBundle(raw, validation), next = listSnapshotCatalogItems(changed)
    expect(next).not.toBe(first)
    expect(next.map(item => item.identity.key)).not.toEqual(first.map(item => item.identity.key))
    expect(listCatalogItems(changed)).toEqual(next)
    const invalid = { project: cloneJson(changed.project), resources: changed.resources }
    invalid.project.assets = {}
    expect(() => listSnapshotCatalogItems(freezeJson(invalid))).toThrow()
  })

  it('rebuilds original SVG identities even when normalized source and raster metadata stay equal', async () => {
    const options = svgFixtureValidation(), first = svgProjectFixture(), second = svgProjectFixture(SVG_FIXTURE_SOURCE.replace('><rect', '>\n<rect'))
    expect(first.normalized.normalizedSha256).toBe(second.normalized.normalizedSha256)
    expect(first.bundle.project.assets).toEqual(second.bundle.project.assets)
    const before = listSnapshotCatalogItems(await validateProjectBundle(first.bundle, options))
    const changed = await validateProjectBundle(second.bundle, options), after = listSnapshotCatalogItems(changed)
    expect(after).not.toBe(before)
    expect(after.map(item => item.identity.key)).not.toEqual(before.map(item => item.identity.key))
    expect(after).toEqual(listCatalogItems(changed))
  })

  it('keeps fixed catalog descriptions independent of live instance visibility and position', async () => {
    const raw = fixture({ image: true }), first = listSnapshotCatalogItems(await validateProjectBundle(raw, validation))
    raw.project.document.props.item.positionMm.x += 500
    raw.project.document.props.item.visibility = 'gm'
    Object.assign(raw.project, createCompositionContent(raw.project.document, runtime))
    const changed = await validateProjectBundle(raw, validation)
    expect(listSnapshotCatalogItems(changed)).toEqual(first)
    expect(listSnapshotCatalogItems(changed)).toEqual(listCatalogItems(changed))
  })
})
