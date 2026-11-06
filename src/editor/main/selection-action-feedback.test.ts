import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupLayerSceneV3, scatterLayerSceneV3 } from '../../core/v3/test-fixtures'
import * as presentation from '../../shared/appearance/presentation'
import { toCurrentSceneDocument } from '../../shared/model/current-scene'
import { selectionActionBehavior } from '../native-canvas/selection-actions'
import SelectionInspector from './SelectionInspector'

const native = (scene = groupLayerSceneV3()) => toCurrentSceneDocument({ ...structuredClone(scene), format: 'sceneweave-scene', schemaVersion: 1 })
afterEach(() => vi.restoreAllMocks())

describe('batch action feedback', () => {
  it('disables near-side rotation while keeping movement available and explains the restriction', () => {
    const scene = native()
    vi.spyOn(presentation, 'scenePresentation').mockImplementation((_scene, id) => id === 'left' ? {
      mode: 'nearSide', rootAnchorMm: { x: 0, y: 0 }, orientation: 'fixedUpright', fixedRotationDeg: 0, footprintAxes: 'world', groundShadowMm: null,
    } : undefined)
    const html = renderToStaticMarkup(createElement(SelectionInspector, { scene, ids: ['left', 'right'], busy: false, onAction: () => {}, onClear: () => {} }))
    expect(html.match(/<fieldset[^>]*aria-label="批量移动"[^>]*>/)?.[0]).not.toContain('disabled')
    expect(html.match(/<fieldset[^>]*aria-label="批量旋转"[^>]*>/)?.[0]).toContain('disabled')
    expect(html).toContain('近侧视物件保持世界直立朝向')
    expect(html).toContain('立即锁定所选')
    expect(html).toContain('预览删除所选')
  })

  it('keeps ordinary locks immediate and scatter group or member locks in preview', () => {
    const scene = native(scatterLayerSceneV3()), before = structuredClone(scene)
    for (const action of ['lock', 'unlock'] as const) {
      expect(selectionActionBehavior(scene, ['item'], action)).toEqual({ decorationEdit: false, scatterEdit: false, requiresPreview: false })
      for (const ids of [['scatter'], ['scatter-item-0'], ['item', 'scatter-item-0']]) {
        expect(selectionActionBehavior(scene, ids, action)).toEqual({ decorationEdit: false, scatterEdit: true, requiresPreview: true })
      }
    }
    for (const action of ['move', 'rotate', 'copy', 'delete'] as const) expect(selectionActionBehavior(scene, ['item'], action).requiresPreview).toBe(true)
    expect(scene).toEqual(before)
  })

  it('previews decoration and retained cluster-member lock changes without changing membership', () => {
    const scene = native(), prop = scene.props.left
    scene.decorations.grass = { id: 'grass', floorId: prop.floorId, editLocked: false, visibility: 'public', definitionRef: { id: 'grass-definition', version: 1 }, supportRef: prop.supportRef, positionMm: prop.positionMm, rotationDeg: 0, scalePpm: 1000000, renderOrder: 0 }
    scene.decorationClusters.cluster = { id: 'cluster', floorId: prop.floorId, editLocked: false, visibility: 'public', supportRef: prop.supportRef,
      boundsMm: scene.exportBoundsMm, seed: 'feedback', algorithmVersion: 'cluster-v1', palette: [], maxInstances: 2, spacingMm: 500, clusterRadiusMm: 1000, clearanceMm: 0,
      members: { retained: { kind: 'prop', entityId: 'left', state: 'detached' }, absent: { kind: 'decoration', entityId: null, state: 'deleted' } } }
    const before = structuredClone(scene)
    for (const action of ['lock', 'unlock'] as const) for (const id of ['grass', 'cluster', 'left']) {
      expect(selectionActionBehavior(scene, [id], action)).toEqual({ decorationEdit: true, scatterEdit: true, requiresPreview: true })
    }
    expect(scene).toEqual(before)
  })
})
