import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Focus, Layers3, LockKeyhole, Plus, Trash2, UnlockKeyhole, X } from 'lucide-react'
import type { SceneCommand } from '../../shared/commands/commands'
import { entitiesInLayer, orderedLayers, previewLayerMove, previewLayerRemoval } from '../../shared/commands/layers'
import type { SceneDocument } from '../../shared/model/scene'
import { USER_LAYER_LIMIT } from '../../shared/model/scene'
import type { SelectionSession } from '../native-canvas/selection-session'

type Props = {
  scene: SceneDocument; session: SelectionSession; currentLayerId: string
  hiddenLayerIds: ReadonlySet<string>; soloLayerId: string | null; currentOnly: boolean; disabled: boolean
  onCurrent: (id: string) => void; onHidden: (id: string) => void; onSolo: (id: string) => void
  onScope: (value: boolean) => void; onCommand: (commands: SceneCommand[]) => void
  onSelectLayer: (id: string) => void
  moveRequest: number
  onPreview: (commands: SceneCommand[], description: string, ids?: string[]) => void
}

/** Selection subscribes here without causing the complete workbench to update. */
export default function UserLayerPanel({ scene, session, currentLayerId, hiddenLayerIds, soloLayerId, currentOnly, disabled, onCurrent, onHidden, onSolo, onScope, onCommand, onPreview, onSelectLayer, moveRequest }: Props) {
  const ids = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const layers = useMemo(() => orderedLayers(scene), [scene])
  const counts = useMemo(() => Object.fromEntries(layers.map(layer => [layer.id, entitiesInLayer(scene, layer.id).length])), [scene, layers])
  const [name, setName] = useState(''), [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [create, setCreate] = useState(false), [floorId, setFloorId] = useState(Object.keys(scene.floors)[0])
  const [pending, setPending] = useState<{ kind: 'move' | 'remove'; id?: string } | null>(null), [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; origin: HTMLElement } | null>(null)
  const menuNode = useRef<HTMLDivElement>(null)
  useEffect(() => { setPending(null); setRename(null); setError(null); setMenu(null) }, [scene])
  useEffect(() => { if (moveRequest) { setPending({ kind: 'move' }); setTarget('') } }, [moveRequest])
  useEffect(() => {
    if (!menu) return
    menuNode.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!menuNode.current?.contains(event.target as Node)) setMenu(null) }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [menu])
  const closeMenu = () => { const origin = menu?.origin; setMenu(null); requestAnimationFrame(() => origin?.isConnected && origin.focus({ preventScroll: true })) }
  const plan = useMemo(() => pending?.kind === 'move' ? previewLayerMove(scene, ids, target)
    : pending?.id ? previewLayerRemoval(scene, pending.id, target || undefined) : null, [scene, ids, pending, target])
  const floors = Object.values(scene.floors)
  const submitName = () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 80) { setError('图层名称须为 1–80 个字符。'); return }
    onCommand([{ type: 'createLayer', id: crypto.randomUUID(), floorId, name: trimmed }]); setName(''); setCreate(false)
  }
  return <section className="user-layer-panel" aria-label="用户图层">
    <div className="asset-section-heading"><Layers3 size={16}/><h2>用户图层</h2><span className="layer-total">{layers.length}/{USER_LAYER_LIMIT}</span><button aria-label="新建用户图层" title="新建图层" disabled={disabled || layers.length >= USER_LAYER_LIMIT} onClick={() => { setCreate(value => !value); setError(null) }}><Plus size={16}/></button></div>
    <p className="layer-session-hint">眼睛与独显只影响编辑视图</p>
    {create && <form className="layer-create" onSubmit={event => { event.preventDefault(); submitName() }}>
      {floors.length > 1 && <label>所在楼层<select aria-label="新图层所属楼层" value={floorId} disabled={disabled} onChange={event => setFloorId(event.target.value)}>{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label>}
      <input autoFocus aria-label="新图层名称" placeholder="例如：家具、线索" maxLength={80} value={name} disabled={disabled} onChange={event => setName(event.target.value)}/><button type="submit" className="primary" disabled={disabled || !name.trim()}>创建图层</button>
    </form>}
    <div className="user-layer-list">
      {floors.map(floor => <div key={floor.id}>
        {floors.length > 1 && <h3>{floor.name}</h3>}
        {layers.filter(layer => layer.floorId === floor.id).slice().reverse().map(layer => {
          const peers = layers.filter(peer => peer.floorId === layer.floorId), index = peers.findIndex(peer => peer.id === layer.id)
          const reorder = (delta: number) => { const next = peers.map(peer => peer.id); [next[index], next[index + delta]] = [next[index + delta], next[index]]; onCommand([{ type: 'reorderLayers', floorId: layer.floorId, ids: next }]) }
          const visible = !hiddenLayerIds.has(layer.id) && (soloLayerId === null || soloLayerId === layer.id)
          const openMenu = (origin: HTMLElement, x: number, y: number) => { if (!disabled) setMenu({ id: layer.id, x: Math.max(8, Math.min(window.innerWidth - 216, x)), y: Math.max(8, Math.min(window.innerHeight - 300, y)), origin }) }
          return <div key={layer.id} className={`user-layer-row${currentLayerId === layer.id ? ' current' : ''}${visible ? '' : ' hidden-layer'}`} data-layer-id={layer.id}
            onContextMenu={event => { event.preventDefault(); openMenu(event.currentTarget.querySelector<HTMLElement>('.layer-current')!, event.clientX, event.clientY) }}
            onKeyDown={event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); const b = event.currentTarget.getBoundingClientRect(); openMenu(event.target as HTMLElement, b.left + 20, b.bottom) } }}>
            <div className="user-layer-primary">
              <button className="layer-eye" aria-label={`${hiddenLayerIds.has(layer.id) ? '显示' : '隐藏'}图层 ${layer.name}`} aria-pressed={!hiddenLayerIds.has(layer.id)} disabled={disabled} onClick={() => onHidden(layer.id)}>{hiddenLayerIds.has(layer.id) ? <EyeOff size={15}/> : <Eye size={15}/>}</button>
              <button className="layer-current" aria-label={`设为当前图层 ${layer.name}`} aria-pressed={currentLayerId === layer.id} disabled={disabled} onClick={() => onCurrent(layer.id)}><span>{layer.name}</span><small>{counts[layer.id]} 项</small></button>
              <button aria-label={`${layer.editLocked ? '解锁' : '锁定'}图层 ${layer.name}`} title={layer.editLocked ? '解除图层锁' : '锁定图层内容与依赖'} disabled={disabled} aria-pressed={layer.editLocked} onClick={() => onCommand([{ type: 'setLayerLock', id: layer.id, locked: !layer.editLocked }])}>{layer.editLocked ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>}</button>
              <button aria-label={`${soloLayerId === layer.id ? '退出独显' : '独显图层'} ${layer.name}`} title="临时独显" aria-pressed={soloLayerId === layer.id} disabled={disabled} onClick={() => onSolo(layer.id)}><Focus size={14}/></button>
            </div>
            {currentLayerId === layer.id && <div className="user-layer-tools">
              <button disabled={disabled || layer.editLocked} onClick={() => setRename({ id: layer.id, name: layer.name })}>改名</button>
              <button aria-label={`选择图层成员 ${layer.name}`} title="选择本层可见且未锁定的画布对象" disabled={disabled || !visible || layer.editLocked} onClick={() => onSelectLayer(layer.id)}>选择此层</button>
              <button aria-label={`上移图层 ${layer.name}`} disabled={disabled || layer.editLocked || index >= peers.length - 1 || peers[index + 1]?.editLocked} onClick={() => reorder(1)}><ArrowUp size={12}/></button>
              <button aria-label={`下移图层 ${layer.name}`} disabled={disabled || layer.editLocked || index <= 0 || peers[index - 1]?.editLocked} onClick={() => reorder(-1)}><ArrowDown size={12}/></button>
              <button aria-label={`删除图层 ${layer.name}`} disabled={disabled || layer.editLocked || peers.length <= 1} onClick={() => { setPending({ kind: 'remove', id: layer.id }); setTarget('') }}><Trash2 size={12}/><span>删层</span></button>
            </div>}
          </div>
        })}
      </div>)}
    </div>
    {rename && <form className="layer-create" onSubmit={event => { event.preventDefault(); const name = rename.name.trim(); if (!name) return; onCommand([{ type: 'renameLayer', id: rename.id, name }]); setRename(null) }}><input autoFocus aria-label="修改图层名称" maxLength={80} value={rename.name} disabled={disabled} onChange={event => setRename({ ...rename, name: event.target.value })}/><button className="secondary" disabled={disabled || !rename.name.trim()}>保存名称</button><button type="button" aria-label="取消图层改名" onClick={() => setRename(null)}><X size={13}/></button></form>}
    <label className="layer-scope">选择范围<select aria-label="图层选择范围" value={currentOnly ? 'current' : 'all'} disabled={disabled} onChange={event => onScope(event.target.value === 'current')}><option value="all">所有可见图层</option><option value="current">仅当前图层</option></select></label>
    <button className="secondary asset-wide" disabled={disabled || !ids.length || ids.length > 256} onClick={() => { setPending({ kind: 'move' }); setTarget('') }}>移动所选到图层{ids.length ? ` · ${ids.length}` : ''}</button>
    {ids.length > 256 && <p className="layer-session-hint">所选超过单次 256 条操作预算</p>}
    {pending && <div className="layer-operation" aria-label={pending.kind === 'move' ? '移层范围预览' : '删层范围预览'}>
      <div><strong>{pending.kind === 'move' ? '移动所选' : '移走全部内容后删层'}</strong><button aria-label="取消图层操作" onClick={() => setPending(null)}><X size={14}/></button></div>
      <label>目标图层<select aria-label="图层操作目标" value={target} disabled={disabled} onChange={event => setTarget(event.target.value)}><option value="">{pending.kind === 'remove' && !counts[pending.id!] ? '空层，无需迁移' : '请选择目标图层'}</option>{layers.filter(layer => layer.id !== pending.id).map(layer => <option key={layer.id} value={layer.id}>{layer.name}{layer.editLocked ? ' · 已锁定' : ''}</option>)}</select></label>
      {plan && <><p>{plan.reason ?? `实际影响 ${plan.ids.length} 项内容${pending.kind === 'remove' ? '，并删除该图层' : ''}。组合和散布将作为整体迁移。`}</p>{plan.ids.length > 0 && <details open><summary>完整操作范围 · {plan.ids.length} 项</summary><textarea aria-label="图层操作完整 ID" readOnly value={plan.ids.join('\n')} rows={Math.min(6, plan.ids.length)}/></details>}
        <button className="primary asset-wide" disabled={disabled || !!plan.reason} onClick={() => onPreview(pending.kind === 'move' ? [{ type: 'moveEntitiesToLayer', ids: [...ids], layerId: target }] : [{ type: 'removeLayer', id: pending.id!, ...(target ? { targetLayerId: target } : {}) }], pending.kind === 'move' ? `移层 · 实际 ${plan.ids.length} 项内容` : `删除图层 · 迁移 ${plan.ids.length} 项内容`, plan.ids)}>预览图层修改</button></>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {menu && scene.userLayers[menu.id] && <div ref={menuNode} className="user-layer-menu" role="menu" aria-label="图层菜单" style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(); return }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')), current = items.indexOf(document.activeElement as HTMLButtonElement)
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus()
      }
    }}>
      <button role="menuitem" onClick={() => { onCurrent(menu.id); closeMenu() }}>设为当前图层</button>
      <button role="menuitem" disabled={hiddenLayerIds.has(menu.id) || soloLayerId !== null && soloLayerId !== menu.id || scene.userLayers[menu.id].editLocked} onClick={() => { onSelectLayer(menu.id); closeMenu() }}>选择图层成员</button>
      <button role="menuitem" onClick={() => { onHidden(menu.id); closeMenu() }}>{hiddenLayerIds.has(menu.id) ? '显示图层' : '隐藏图层'}</button>
      <button role="menuitem" onClick={() => { onSolo(menu.id); closeMenu() }}>{soloLayerId === menu.id ? '退出独显' : '独显图层'}</button>
      <button role="menuitem" onClick={() => { onCommand([{ type: 'setLayerLock', id: menu.id, locked: !scene.userLayers[menu.id].editLocked }]); closeMenu() }}>{scene.userLayers[menu.id].editLocked ? '解锁图层' : '锁定图层'}</button>
      <button role="menuitem" disabled={scene.userLayers[menu.id].editLocked} onClick={() => { setRename({ id: menu.id, name: scene.userLayers[menu.id].name }); closeMenu() }}>重命名图层</button>
      <button role="menuitem" disabled={!ids.length || ids.length > 256 || scene.userLayers[menu.id].editLocked} onClick={() => { setPending({ kind: 'move' }); setTarget(menu.id); closeMenu() }}>移动所选到此层…</button>
      <button role="menuitem" disabled={scene.userLayers[menu.id].editLocked || layers.filter(layer => layer.floorId === scene.userLayers[menu.id].floorId).length <= 1} onClick={() => { setPending({ kind: 'remove', id: menu.id }); setTarget(''); closeMenu() }}>移走内容后删除图层…</button>
    </div>}
  </section>
}
