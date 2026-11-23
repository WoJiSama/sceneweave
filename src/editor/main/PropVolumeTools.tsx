import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import { effectiveEditLocked } from '../../shared/commands/layers'
import { propFootprint } from '../../shared/geometry/geometry'
import { propVolumeKinds, type PropVolume } from '../../shared/model/prop-volume'
import type { Prop, SceneDocument } from '../../shared/model/scene'
import { defaultVolume } from '../../shared/projection/spatial-props'
import { NumberInput } from '../native-canvas/controls'
import { newId } from './runtime'

const labels: Record<PropVolume['kind'], string> = { flat: '平面', box: '木箱', table: '桌子', seat: '座具', round: '桶 / 柱',
  rock: '岩石', tree: '树', tent: '帐篷', rail: '护栏', lamp: '灯具' }

export default function PropVolumeTools({ prop, scene, disabled, onPreview }: {
  prop: Prop; scene: SceneDocument; disabled: boolean; onPreview: (commands: SceneCommand[], title: string) => void
}) {
  const inferred = defaultVolume(prop, prop.definitionRef ? scene.propDefinitions[prop.definitionRef.id]?.tags ?? [] : [])
  const tops = Object.values(scene.attachmentSurfaces ?? {}).filter(surface => surface.owner.kind === 'prop' && surface.owner.id === prop.id
    && surface.feature.kind === 'propTop' && surface.capabilities.includes('support'))
  const [kind, setKind] = useState<PropVolume['kind'] | 'auto'>(prop.volume?.kind ?? 'auto')
  const [heightMm, setHeight] = useState(prop.volume?.heightMm || Math.round(inferred.heightMm) || 800)
  const [support, setSupport] = useState(tops.length > 0)
  const [warning, setWarning] = useState('')
  const occupied = Object.values(scene.attachments ?? {}).some(attachment => attachment.mode === 'support' && tops.some(top => top.id === attachment.surfaceId))
  const save = () => {
    setWarning('')
    if (!support && occupied) { setWarning('箱顶已有附着的物件。请先在物件的「承托与挂接」中解除附着。'); return }
    const volume = kind === 'auto' ? null : { kind, heightMm: kind === 'flat' ? 0 : heightMm }
    const commands: SceneCommand[] = [{ type: 'setPropVolume', id: prop.id, volume }]
    if (!support) for (const top of tops) commands.push({ type: 'removeAttachmentSurface', id: top.id })
    if (kind === 'box' && support && !tops.length) commands.push({ type: 'addAttachmentSurface', id: newId(), owner: { kind: 'prop', id: prop.id }, capabilities: ['support'],
      feature: { kind: 'propTop', heightLocalMm: heightMm, polygonLocalMm: propFootprint({ ...prop, positionMm: { x: 0, y: 0 }, rotationDeg: 0 }) } })
    onPreview(commands, '设置物件立体形状与箱顶承托')
  }
  return <details className="asset-details"><summary>立体形状</summary><fieldset disabled={disabled || effectiveEditLocked(scene, prop.id)}>
    <label>结构模板<select aria-label="立体结构模板" value={kind} onChange={event => {
      const value = event.target.value as typeof kind
      setKind(value)
      if (value === 'box' && prop.volume?.kind !== 'box' && !tops.length) setSupport(true)
    }}><option value="auto">沿用素材建议</option>{propVolumeKinds.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
    {kind !== 'flat' && kind !== 'auto' && <NumberInput label="立体高度" displayUnit={scene.units.display} value={heightMm} onCommit={setHeight}/>}
    {(kind === 'box' || tops.length > 0) && <label className="composition-check"><input type="checkbox" checked={support} onChange={event => setSupport(event.target.checked)}/>箱顶可放物件</label>}
    {support && tops.length > 0 && kind !== 'auto' && <p className="asset-muted">已采用的承托面决定立体高度与落点。可在「承托与挂接」中重设承托面。</p>}
    {warning && <p role="alert">{warning}</p>}
    <button type="button" className="secondary asset-wide" disabled={kind !== 'flat' && kind !== 'auto' && (heightMm <= 0 || heightMm > 20_000)} onClick={save}>预览立体设置</button>
  </fieldset></details>
}
