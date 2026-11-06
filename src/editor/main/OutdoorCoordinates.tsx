import { outdoorCoordinateSummary } from './outdoor-coordinates'

export default function OutdoorCoordinates({ text, onChange, label, ariaLabel, minimum = 3, unit }: {
  text: string; onChange: (value: string) => void; label: string; ariaLabel: string; minimum?: number; unit: 'm' | 'ft'
}) {
  return <div className="outdoor-coordinates">
    <p className="outdoor-coordinate-summary" aria-live="polite">{outdoorCoordinateSummary(text, minimum, unit)}</p>
    <details className="outdoor-advanced"><summary>精确坐标 · {label}</summary>
      <label>{label} · mm<textarea aria-label={ariaLabel} rows={4} value={text} onChange={event => onChange(event.target.value)}/></label>
      <small>每行 x, y，使用整数毫米。展开或收起会保留输入；预览后再确认采用。</small>
    </details>
  </div>
}
