import type { Prop, PropGlow } from '../../shared/model/scene'
import { DEFAULT_FIXTURE_GLOW } from '../../shared/path-assembly/contracts'

const defaultGlow: PropGlow = { ...DEFAULT_FIXTURE_GLOW, anchor: { u: .5, v: .5 } }

export function PropGlowControls({ glow, onChange }: { glow: Prop['appearance']['glow']; onChange: (value: PropGlow | null) => void }) {
  return <>
    <label className="composition-check"><input type="checkbox" checked={!!glow}
      onChange={event => onChange(event.target.checked ? defaultGlow : null)}/>启用物件照光</label>
    {glow && <>
      <label>光色<input type="color" aria-label="物件光色" value={glow.color}
        onChange={event => onChange({ ...glow, color: event.target.value })}/></label>
      <label>照光半径 mm<input type="number" min={100} max={6000} step={1} value={Number.isNaN(glow.radiusMm) ? '' : glow.radiusMm}
        onChange={event => onChange({ ...glow, radiusMm: event.target.valueAsNumber })}/></label>
      <label>照光强度<input type="number" min={0} max={2} step={.05} value={Number.isNaN(glow.intensity) ? '' : glow.intensity}
        onChange={event => onChange({ ...glow, intensity: event.target.valueAsNumber })}/></label>
      <div className="workspace-field-pair" role="group" aria-label="发光点在图像中的位置">
        <label>发光点 X %<input type="number" min={0} max={100} step="any" value={Number.isNaN(glow.anchor.u) ? '' : glow.anchor.u * 100}
          onChange={event => onChange({ ...glow, anchor: { ...glow.anchor, u: event.target.valueAsNumber / 100 } })}/></label>
        <label>发光点 Y %<input type="number" min={0} max={100} step="any" value={Number.isNaN(glow.anchor.v) ? '' : glow.anchor.v * 100}
          onChange={event => onChange({ ...glow, anchor: { ...glow.anchor, v: event.target.valueAsNumber / 100 } })}/></label>
      </div>
    </>}
  </>
}
