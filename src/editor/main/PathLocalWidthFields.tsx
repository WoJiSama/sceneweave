import { useState, type Dispatch, type SetStateAction } from 'react'
import { ROUTE_FRACTION, ROUTE_WIDTH_SECTION_LIMIT, routeWidthSectionsSchema, type RouteWidthSection } from '../../shared/geometry/route-width'
import type { SceneDocument } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'

export function readPathWidthSections(sections: readonly RouteWidthSection[]) {
  return sections.length ? routeWidthSectionsSchema.parse([...sections].sort((a, b) => a.startPpm - b.startPpm)) : null
}

export default function PathLocalWidthFields({ sections, setSections, widthMm, unit }: {
  sections: readonly RouteWidthSection[]
  setSections: Dispatch<SetStateAction<RouteWidthSection[]>>
  widthMm: number
  unit: SceneDocument['units']['display']
}) {
  const [error, setError] = useState('')
  const update = (index: number, changes: Partial<RouteWidthSection>) => {
    setError('')
    setSections(current => current.map((section, at) => index === at ? { ...section, ...changes } : section))
  }
  const add = () => {
    const ordered = [...sections].sort((a, b) => a.startPpm - b.startPpm)
    const boundaries = [0, ...ordered.flatMap(section => [section.startPpm, section.endPpm]), ROUTE_FRACTION]
    const gaps = boundaries.flatMap((point, index) => index % 2 === 1 ? [{ start: boundaries[index - 1], end: point }] : [])
    const gap = gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
    if (gap.end - gap.start < 4) { setError('路线剩余区间不足，请调整已有局部净宽。'); return }
    const inset = Math.floor((gap.end - gap.start) / 4)
    setError('')
    setSections([...ordered, { startPpm: gap.start + inset, endPpm: gap.end - inset, widthMm }])
  }
  return <details open={sections.length > 0} data-route-width-choices>
    <summary>局部路宽</summary>
    <small>沿路起点到终点设置区间。其余路段使用整体宽度，两端自动过渡。</small>
    {sections.map((section, index) => <fieldset key={index}>
      <legend>局部路段 {index + 1}</legend>
      <div className="composition-fields">
        <label>起点（%）<input type="number" min="0" max="100" step="0.1" aria-label={`路段 ${index + 1} 起点百分比`} value={section.startPpm / 10_000}
          onChange={event => update(index, { startPpm: Math.round(Number(event.target.value) * 10_000) })}/></label>
        <label>终点（%）<input type="number" min="0" max="100" step="0.1" aria-label={`路段 ${index + 1} 终点百分比`} value={section.endPpm / 10_000}
          onChange={event => update(index, { endPpm: Math.round(Number(event.target.value) * 10_000) })}/></label>
      </div>
      <NumberInput label="本段净宽" ariaLabel={`路段 ${index + 1} 净宽`} displayUnit={unit} value={section.widthMm}
        onCommit={value => update(index, { widthMm: value })}/>
      <button type="button" className="secondary" onClick={() => { setError(''); setSections(current => current.filter((_, at) => at !== index)) }}>移除此路段的局部宽度</button>
    </fieldset>)}
    {error && <p className="asset-form-error" role="alert">{error}</p>}
    <button type="button" className="secondary asset-wide" disabled={sections.length >= ROUTE_WIDTH_SECTION_LIMIT} onClick={add}>添加局部路宽</button>
  </details>
}
