import { NumberInput } from '../native-canvas/controls'
import type { RoomExtensionDraft } from '../native-canvas/room-extension'

export default function RoomExtensionPanel({ draft, unit, disabled, onChange, onPreview, onCancel }: {
  draft: RoomExtensionDraft; unit: 'm' | 'ft'; disabled: boolean
  onChange: (changes: Partial<Pick<RoomExtensionDraft, 'wall' | 'purpose' | 'depthMm'>>) => void
  onPreview: () => void; onCancel: () => void
}) {
  return <section className="building-panel" aria-label="沿墙扩建房间">
    <h2>沿墙扩建房间</h2>
    <fieldset className="workspace-form-fields" disabled={disabled}>
      <label className="building-field">外墙<select value={draft.wall?.id ?? ''} onChange={event => onChange({ wall: draft.walls.find(wall => wall.id === event.target.value) ?? null })}>
        <option value="">在图上点外墙，或在这里选择</option>
        {draft.walls.map(wall => <option key={wall.id} value={wall.id}>{wall.label}</option>)}
      </select></label>
      <label className="building-field">新房间名称<input value={draft.purpose} maxLength={200} onChange={event => onChange({ purpose: event.target.value })}/></label>
      <NumberInput displayUnit={unit} label="扩建进深" value={draft.depthMm} onCommit={depthMm => onChange({ depthMm })}/>
      <button type="button" className="primary asset-wide" disabled={!draft.wall || draft.depthMm <= 0} onClick={onPreview}>预览相邻房间</button>
      <button type="button" className="secondary asset-wide" onClick={onCancel}>取消扩建</button>
    </fieldset>
  </section>
}
