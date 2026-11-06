import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures'
import { createCompositionContent } from '../../shared/appearance/graph'
import { toCurrentSceneDocument } from '../../shared/model/current-scene'
import type { EditableProject } from '../../application/workspace/project'
import { captureSceneClipboard, pasteSceneClipboard } from './scene-clipboard'

function project() {
  let next = 0
  const document = toCurrentSceneDocument({ ...structuredClone(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1 })
  return { ...createCompositionContent(document, { ids: { nextId: () => `clipboard-${++next}` }, clock: { now: () => '2026-11-06T00:00:00.000Z' } }) } as EditableProject
}

describe('bounded scene clipboard', () => {
  it('captures no mutation and permits unrelated revisions while every paste uses fresh IDs', () => {
    const source = project(), before = structuredClone(source)
    const copied = captureSceneClipboard(source, ['item'])
    expect(source).toEqual(before)
    expect(copied.marker).not.toContain('item')
    source.document.revision++
    source.document.title = 'Unrelated edit'
    const first = pasteSceneClipboard(source, copied), second = pasteSceneClipboard(source, copied)
    expect(first[0]).toMatchObject({ type: 'copyProp', id: 'item', offsetMm: { x: 300, y: 300 } })
    expect(first).not.toEqual(second)
    expect(source.document.props).toEqual(before.document.props)
  })

  it('rejects a changed, deleted or reborn source, changed appearance and another project', () => {
    const source = project(), copied = captureSceneClipboard(source, ['item'])
    const change = (mutate: (copy: EditableProject) => void) => {
      const next = structuredClone(source); mutate(next)
      expect(() => pasteSceneClipboard(next, copied)).toThrow(/重新复制/)
    }
    change(next => { next.document.props.item.positionMm.x++ })
    change(next => { delete next.document.props.item })
    change(next => { next.historyIdentity.propTokens.item = 'new-birth' })
    change(next => { next.appearance.instanceAdjustments.item = [{ id: 'opacity', enabled: true, kind: 'opacity', value: 0.5 }] })
    change(next => { next.document.sceneId = 'other-scene' })
  })

  it('rechecks locks at paste and rejects unsupported capture without clearing objects', () => {
    const source = project(), copied = captureSceneClipboard(source, ['item'])
    source.document.userLayers[source.document.entityLayers.item].editLocked = true
    expect(() => pasteSceneClipboard(source, copied)).toThrow(/锁定/)
    expect(() => captureSceneClipboard(source, [])).toThrow(/选择对象/)
    expect(() => captureSceneClipboard(source, [Object.keys(source.document.floors)[0]])).toThrow()
    expect(source.document.props.item).toBeDefined()
  })
})
