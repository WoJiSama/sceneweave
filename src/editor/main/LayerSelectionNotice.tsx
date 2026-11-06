import type { SceneDocument } from '../../shared/model/scene'

type Props = {
  scene: SceneDocument; currentLayerId: string; hiddenLayerIds: ReadonlySet<string>
  soloLayerId: string | null; currentOnly: boolean; disabled: boolean
  onShow: (id: string) => void; onExitSolo: () => void; onAllLayers: () => void; onOpenLayers: () => void
}

/** These controls only restore session visibility/scope; locks remain explicit edits. */
export default function LayerSelectionNotice({ scene, currentLayerId, hiddenLayerIds, soloLayerId, currentOnly, disabled, onShow, onExitSolo, onAllLayers, onOpenLayers }: Props) {
  const current = scene.userLayers[currentLayerId], solo = soloLayerId ? scene.userLayers[soloLayerId] : null
  const hidden = Object.keys(scene.userLayers).filter(id => hiddenLayerIds.has(id))
  const locked = Object.values(scene.userLayers).filter(layer => layer.editLocked)
  if (!currentOnly && !hidden.length && soloLayerId === null && !locked.length) return null
  return <section className="workspace-selection-notice" aria-label="当前选择限制">
    <div><strong>选择与显示</strong><button type="button" className="secondary" onClick={onOpenLayers}>管理图层</button></div>
    {currentOnly && <p>仅能选择「{current?.name ?? '当前图层'}」中的对象。<button type="button" disabled={disabled} onClick={onAllLayers}>改为所有可见图层</button></p>}
    {soloLayerId !== null && <p>{solo ? `正在独显「${solo.name}」，其余图层暂不可见。` : '独显的图层已移除，请退出独显恢复其他图层。'}<button type="button" disabled={disabled} onClick={onExitSolo}>退出独显</button></p>}
    {hidden.length > 0 && <p>{hidden.length} 个图层已手动隐藏；可在图层中逐层显示。{current && hiddenLayerIds.has(current.id) && <>当前「{current.name}」也已隐藏。<button type="button" disabled={disabled} onClick={() => onShow(current.id)}>显示当前图层</button></>}</p>}
    {locked.length > 0 && <p>{locked.length} 个图层已锁定{current?.editLocked ? `，包括当前「${current.name}」` : ''}。框选/全选会排除受锁保护的对象；可从对象列表选择查看，再到图层明确解锁。</p>}
  </section>
}
