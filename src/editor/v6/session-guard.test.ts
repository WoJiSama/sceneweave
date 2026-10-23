import { describe, expect, it } from 'vitest'
import { workspaceTransitionReasonV6, type WorkspaceTransientV6 } from './session-guard'

const idle: WorkspaceTransientV6 = { busy: false, preparing: false, newScene: false, candidate: false,
  placement: false, prefabPlacement: false, sketch: false, outdoorSketch: false,
  restore: false, structureRestore: false, structure: false, buildingForm: false, outdoorForm: false, assetImportForm: false,
  appearanceForm: false, prefabForm: false, buildingInspector: false, outdoorInspector: false, selectionForm: false, displayForm: false, catalogForm: false }

describe('unified workspace transition guard', () => {
  it('permits leaving the settled session without requiring selection, view or undo to be discarded', () => {
    expect(workspaceTransitionReasonV6(idle)).toBeNull()
  })

  it.each([
    ['busy', '保存'], ['preparing', '取消准备'], ['newScene', '取消新建'], ['candidate', '取消打开'],
    ['placement', '取消放置'], ['prefabPlacement', '取消组合放置'], ['sketch', '取消绘图'], ['outdoorSketch', '结束画布取点'],
    ['restore', '取消候选'], ['structureRestore', '取消候选'], ['structure', '取消候选'],
    ['buildingForm', '取消建筑草稿'], ['outdoorForm', '取消室外草稿'], ['assetImportForm', '取消素材导入草稿'],
    ['appearanceForm', '取消外观草稿'], ['prefabForm', '取消组合草稿'], ['buildingInspector', '取消建筑属性草稿'],
    ['catalogForm', '取消素材整理草稿'],
    ['outdoorInspector', '取消室外属性草稿'], ['selectionForm', '取消批量参数草稿'], ['displayForm', '取消显示设置草稿'],
  ] as const)('blocks %s with a concrete way to finish it', (field, expected) => {
    expect(workspaceTransitionReasonV6({ ...idle, [field]: true })).toContain(expected)
  })

  it('lets the current tool convert its own draft to a candidate while other tools remain blocked', () => {
    const building = { ...idle, sketch: true, buildingForm: true }
    expect(workspaceTransitionReasonV6(building, ['sketch', 'buildingForm'])).toBeNull()
    expect(workspaceTransitionReasonV6(building, 'buildingForm')).toContain('建筑绘图')
    expect(workspaceTransitionReasonV6(building, ['outdoorSketch', 'outdoorForm'])).toContain('建筑绘图')
    expect(workspaceTransitionReasonV6({ ...idle, assetImportForm: true }, 'assetImportForm')).toBeNull()
    expect(workspaceTransitionReasonV6({ ...building, structure: true }, ['sketch', 'buildingForm'])).toContain('候选尚未结束')
  })

  it.each(['appearanceForm', 'prefabForm', 'buildingInspector', 'outdoorInspector', 'selectionForm', 'displayForm'] as const)(
    'keeps %s bound to its target until that panel completes or explicitly cancels it', form => {
      const dirty = { ...idle, [form]: true }
      // Leaving and changing selection use the non-completing guard. A different
      // panel cannot consume this draft just because it shares a preview method.
      expect(workspaceTransitionReasonV6(dirty)).not.toBeNull()
      expect(workspaceTransitionReasonV6(dirty, 'buildingForm')).not.toBeNull()
      expect(workspaceTransitionReasonV6(dirty, form)).toBeNull()
      expect(workspaceTransitionReasonV6({ ...dirty, [form]: false })).toBeNull()
    },
  )
})
