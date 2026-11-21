import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import { effectiveEditLocked } from '../../shared/commands/layers'
import type { SceneDocument } from '../../shared/model/scene'
import type { PathEnd } from '../../shared/path-assembly/bridge-link-contracts'
import { nearbyPipePorts, pipePortLabels } from '../../shared/path-assembly/pipe-geometry'
import type { VisualBoundary } from '../../shared/visual/types'

export default function PipeLinkControls({ scene, fence, end, onPreview, onSelect }: {
  scene: SceneDocument
  fence: VisualBoundary
  end: PathEnd
  onPreview: (commands: SceneCommand[], label: string) => void
  onSelect?: (id: string) => void
}) {
  const [selection, setSelection] = useState(''), label = end === 'start' ? '起点' : '终点'
  const link = fence.fence!.pipeLinks?.[end]
  const ports = link || fence.fence!.recipe.endClearanceMm ? [] : nearbyPipePorts(scene, fence, end).filter(target => !effectiveEditLocked(scene, target.propId))
  const labelFor = ({ propId, port }: (typeof ports)[number]) => {
    const ref = scene.props[propId].definitionRef
    const name = ref && scene.propDefinitions[ref.id]?.name
    return `${name ? `${name} · ` : ''}${propId} · ${pipePortLabels[port]}`
  }
  const target = selection === '' ? undefined : ports[Number(selection)]
  return <div className="outdoor-object-list">
    <strong>{label}{link ? ' · 已连接' : ' · 空闲'}</strong>
    {link ? <>
      <span>{labelFor(link)}</span>
      {onSelect && <button type="button" className="secondary" onClick={() => onSelect(link.propId)}>选择{label}相接设备</button>}
      <button type="button" className="secondary" onClick={() => onPreview([{ type: 'setPipeLink', id: fence.id, end, target: null }], `断开管线${label}链接`)}>预览断开管线{label}</button>
    </> : <>
      <label>附近管口<select aria-label={`管线${label}附近管口`} value={selection} onChange={event => setSelection(event.target.value)} disabled={!ports.length}>
        <option value="">{ports.length ? '选择设备管口' : '附近无空闲管口'}</option>
        {ports.map((port, index) => <option key={`${port.propId}:${port.port}`} value={index}>{labelFor(port)}</option>)}
      </select></label>
      <button type="button" disabled={!target} className="secondary" onClick={() => {
        if (target) onPreview([{ type: 'setPipeLink', id: fence.id, end, target }], `连接管线${label}与设备`)
      }}>预览连接管线{label}</button>
    </>}
  </div>
}
