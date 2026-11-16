import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { SceneCommand } from '../../shared/commands/commands'
import { propFootprint } from '../../shared/geometry/geometry'
import { effectiveEditLocked } from '../../shared/commands/layers'
import { NumberInput } from '../native-canvas/controls'
import { newId } from './runtime'

export default function AttachmentTools({ scene, id, disabled, onPreview }: { scene: SceneDocument; id: string; disabled: boolean; onPreview: (commands: SceneCommand[], description: string) => void }) {
  const prop = scene.props[id], wall = scene.walls[id], owner = prop ?? wall
  const candidates = Object.values(scene.attachmentSurfaces ?? {}).filter(surface => surface.owner.id !== id && (surface.capabilities.includes('support') || surface.capabilities.includes('hang')))
  const [height, setHeight] = useState(800), [surfaceId, setSurfaceId] = useState(candidates[0]?.id ?? '')
  const [local, setLocal] = useState({ x: 0, y: 0 }), [along, setAlong] = useState(1000), [extent, setExtent] = useState(300)
  const [follow, setFollow] = useState<'follow' | 'fixed'>('follow'), [side, setSide] = useState<'left' | 'right'>('left')
  const [start, setStart] = useState(0), [end, setEnd] = useState(wall ? Math.floor(Math.hypot(scene.vertices[wall.endVertexId].xMm - scene.vertices[wall.startVertexId].xMm, scene.vertices[wall.endVertexId].yMm - scene.vertices[wall.startVertexId].yMm)) : 2000)
  const [low, setLow] = useState(0), [high, setHigh] = useState(2400)
  if (!owner) return null
  const owned = Object.values(scene.attachmentSurfaces ?? {}).filter(surface => surface.owner.id === id)
  const relation = Object.values(scene.attachments ?? {}).find(row => row.child.id === id && row.mode !== 'embed')
  const surface = scene.attachmentSurfaces?.[surfaceId]
  const unit = scene.units.display
  return <details className="asset-details" data-attachment-tools><summary>承托与挂接</summary>
    <fieldset disabled={disabled || effectiveEditLocked(scene, id)}>
      {prop && <><NumberInput label="承托面离底高度" value={height} displayUnit={unit} onCommit={setHeight}/><button className="secondary asset-wide" onClick={() => onPreview([{ type: 'addAttachmentSurface', id: newId(), owner: { kind: 'prop', id }, feature: { kind: 'propTop', polygonLocalMm: propFootprint({ ...prop, positionMm: { x: 0, y: 0 }, rotationDeg: 0 }), heightLocalMm: height }, capabilities: ['support'] }], '建立物件承托面')}>预览建立顶面</button></>}
      {wall && <><label>挂接墙侧<select value={side} onChange={event => setSide(event.target.value as typeof side)}><option value="left">沿墙起点左侧</option><option value="right">沿墙起点右侧</option></select></label>
        <NumberInput label="挂接区起距" value={start} displayUnit={unit} onCommit={setStart}/><NumberInput label="挂接区终距" value={end} displayUnit={unit} onCommit={setEnd}/>
        <NumberInput label="挂接区底高" value={low} displayUnit={unit} onCommit={setLow}/><NumberInput label="挂接区顶高" value={high} displayUnit={unit} onCommit={setHigh}/>
        <button className="secondary asset-wide" onClick={() => onPreview([{ type: 'addAttachmentSurface', id: newId(), owner: { kind: 'wall', id }, feature: { kind: 'wallSide', referenceVertexId: wall.startVertexId, side, startMm: start, endMm: end, lowMm: low, highMm: high }, capabilities: ['hang'] }], '建立墙侧挂接面')}>预览建立挂接面</button></>}
      {owned.map((row, index) => <p className="asset-muted" key={row.id}>本物件表面 {index + 1} · {row.feature.kind === 'propTop' ? '承托' : '挂接'}<button className="secondary" onClick={() => onPreview([{ type: 'removeAttachmentSurface', id: row.id }], '移除未使用的附着面')}>移除表面</button></p>)}
      {prop && (relation ? <><p className="asset-muted">已{relation.mode === 'hang' ? '挂接' : '承托'} · {relation.follow === 'follow' ? '跟随宿主' : '固定位置'}</p><button className="secondary asset-wide" onClick={() => onPreview([{ type: 'detachPropAttachment', id: relation.id }], '解除附着并检查当前根基支撑')}>预览解除附着</button></> : <>
        <label>附着表面<select aria-label="物件附着表面" value={surfaceId} onChange={event => setSurfaceId(event.target.value)}><option value="">选择表面</option>{candidates.map(row => <option key={row.id} value={row.id}>{scene.propDefinitions[scene.props[row.owner.id]?.definitionRef?.id ?? '']?.name ?? (row.owner.kind === 'wall' ? '墙侧' : '表面')} · {row.id.slice(0, 8)}</option>)}</select></label>
        {surface?.feature.kind === 'propTop' ? <><NumberInput label="面上相对 X" value={local.x} displayUnit={unit} onCommit={x => setLocal({ ...local, x })}/><NumberInput label="面上相对 Y" value={local.y} displayUnit={unit} onCommit={y => setLocal({ ...local, y })}/></> : surface?.feature.kind === 'wallSide' ? <><NumberInput label="沿墙挂点距离" value={along} displayUnit={unit} onCommit={setAlong}/><NumberInput label="挂点高度" value={height} displayUnit={unit} onCommit={setHeight}/><NumberInput label="物件竖向高度" value={extent} displayUnit={unit} onCommit={setExtent}/></> : null}
        <label>宿主变化<select value={follow} onChange={event => setFollow(event.target.value as typeof follow)}><option value="follow">保持面上位置并跟随</option><option value="fixed">固定当前世界位置</option></select></label>
        <button className="secondary asset-wide" disabled={!surface || surface.feature.kind !== 'propTop' && surface.feature.kind !== 'wallSide'} onClick={() => {
          if (!surface || surface.feature.kind !== 'propTop' && surface.feature.kind !== 'wallSide') return
          const horizontal = surface.feature.kind === 'propTop'
          onPreview([{ type: 'bindPropAttachment', id: newId(), childId: id, surfaceId, mode: horizontal ? 'support' : 'hang', follow, anchorState: 'manual',
            anchor: horizontal ? { kind: 'horizontal', localMm: local, heightOffsetMm: 0, rotationOffsetDeg: 0 } : { kind: 'vertical', referenceVertexId: surface.feature.kind === 'wallSide' ? surface.feature.referenceVertexId : '', alongMm: along, heightMm: height, heightExtentMm: extent, normalOffsetMm: 0, rotationOffsetDeg: 0 } }], horizontal ? '预览物件放上承托面' : '预览物件挂到墙侧')
        }}>预览附着</button></>)}
    </fieldset>
  </details>
}
