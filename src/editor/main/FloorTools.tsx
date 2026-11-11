import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { NumberInput } from '../native-canvas/controls'
import { newId } from './runtime'

export default function FloorTools({ scene, floorId, disabled, onPreview, onDraftChange }: {
  scene: SceneDocument; floorId: string; disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
  onDraftChange: () => void
}) {
  const floor = scene.floors[floorId]
  const [name, setName] = useState(floor?.name ?? '')
  const [newName, setNewName] = useState('新楼层')
  const [width, setWidth] = useState(floor?.boundsMm.width ?? 20000)
  const [height, setHeight] = useState(floor?.boundsMm.height ?? 20000)
  if (!floor || scene.mapMode !== 'scene') return null
  return <details className="workspace-advanced" aria-label="楼层管理" onChangeCapture={onDraftChange}>
    <summary>楼层管理 · {Object.keys(scene.floors).length} 层</summary>
    <p>各层独立编辑、预览和出图。使用画布上方的“当前楼层”切换；高程和楼层分别设置。</p>
    <fieldset disabled={disabled}>
      <label>当前楼层名称<input aria-label="当前楼层名称" maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
      <button type="button" className="secondary asset-wide" disabled={!name.trim()} onClick={() => onPreview([{ type: 'renameFloor', id: floorId, name }], '修改当前楼层名称')}>预览楼层改名</button>
      <h3>新建独立楼层</h3>
      <label>新楼层名称<input aria-label="新楼层名称" maxLength={80} value={newName} onChange={event => setNewName(event.target.value)}/></label>
      <NumberInput displayUnit={scene.units.display} label="新楼层宽度" value={width} onCommit={setWidth}/>
      <NumberInput displayUnit={scene.units.display} label="新楼层高度" value={height} onCommit={setHeight}/>
      <p className="asset-muted">新层从 (0, 0) 开始，固定输出范围与新世界范围相同。各层的世界与输出范围可在上方继续调整。原有默认输出会在新增第二层时明确保存在原层。</p>
      <button type="button" className="primary asset-wide" disabled={!newName.trim()} onClick={() => {
        const boundsMm = { x: 0, y: 0, width, height }
        onPreview([{ type: 'createFloor', id: newId(), name: newName, boundsMm, outputBoundsMm: { ...boundsMm }, newLayerId: newId(), layerName: '基础图层' }], `新建独立楼层 · ${newName}`)
      }}>预览新建楼层</button>
      {Object.keys(scene.floors).length > 1 && <button type="button" className="history-danger asset-wide" onClick={() => onPreview([{ type: 'deleteEmptyFloor', id: floorId }], '删除空楼层，核对完整依赖')}>预览删除当前空楼层</button>}
      <p className="asset-muted">只有没有内容和外观依赖的空楼层可以删除；修改可整笔撤销。</p>
    </fieldset>
  </details>
}
