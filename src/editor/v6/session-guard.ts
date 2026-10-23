export const workspaceFormDraftLabelsV6 = {
  buildingForm: { name: '建筑表单', cancel: '取消建筑草稿' },
  outdoorForm: { name: '室外表单', cancel: '取消室外草稿' },
  assetImportForm: { name: '素材导入表单', cancel: '取消素材导入草稿' },
  catalogForm: { name: '素材个人整理', cancel: '取消素材整理草稿' },
  appearanceForm: { name: '外观参数', cancel: '取消外观草稿' },
  propAppearanceForm: { name: '物件换图', cancel: '取消换图草稿' },
  prefabForm: { name: '组合参数', cancel: '取消组合草稿' },
  buildingInspector: { name: '建筑属性', cancel: '取消建筑属性草稿' },
  outdoorInspector: { name: '室外属性', cancel: '取消室外属性草稿' },
  selectionForm: { name: '多选批量参数', cancel: '取消批量参数草稿' },
  displayForm: { name: '单位与格线设置', cancel: '取消显示设置草稿' },
} as const
export type WorkspaceFormDraftV6 = keyof typeof workspaceFormDraftLabelsV6
export type WorkspaceDraftV6 = 'placement' | 'prefabPlacement' | 'sketch' | 'outdoorSketch' | WorkspaceFormDraftV6
export interface WorkspaceTransientV6 extends Record<WorkspaceFormDraftV6, boolean> {
  busy: boolean
  preparing: boolean
  newScene: boolean
  candidate: boolean
  placement: boolean
  prefabPlacement: boolean
  sketch: boolean
  outdoorSketch: boolean
  restore: boolean
  structureRestore: boolean
  structure: boolean
}

/** Browsing is passive; departures and conflicting tools use the same reasons. */
export function workspaceTransitionReasonV6(state: WorkspaceTransientV6, completing?: WorkspaceDraftV6 | readonly WorkspaceDraftV6[]): string | null {
  const allowed = new Set(typeof completing === 'string' ? [completing] : completing ?? [])
  if (state.preparing) return '正在准备完整资源。请等待准备完成，或明确取消准备后再继续。'
  if (state.busy) return '当前操作仍在处理或保存，请等待完成后再继续。'
  if (state.newScene) return '新建场景尚未结束。请创建场景或取消新建后再继续。'
  if (state.candidate) return '待打开工程尚未确认。请保存并打开副本，或取消打开后再继续。'
  if (state.structure || state.restore || state.structureRestore) return '当前候选尚未结束。请先采用或明确取消候选；可以继续浏览侧栏与素材详情。'
  if (state.placement && !allowed.has('placement')) return '物件放置尚未结束。请继续放置或取消放置后再开始其他操作。'
  if (state.prefabPlacement && !allowed.has('prefabPlacement')) return '组合放置尚未结束。请预览并采用组合，或取消组合放置后再开始其他操作。'
  if (state.sketch && !allowed.has('sketch')) return '建筑绘图或量尺尚未结束。请继续当前工具或明确取消绘图后再开始其他操作。'
  if (state.outdoorSketch && !allowed.has('outdoorSketch')) return '室外画布取点尚未结束。请继续当前工具或结束画布取点后再开始其他操作。'
  for (const key of Object.keys(workspaceFormDraftLabelsV6) as WorkspaceFormDraftV6[]) {
    if (state[key] && !allowed.has(key)) {
      const label = workspaceFormDraftLabelsV6[key]
      return `${label.name}有尚未预览的输入。请完成当前草稿，或${label.cancel}后再继续。`
    }
  }
  return null
}
