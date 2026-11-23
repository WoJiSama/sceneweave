import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { COLOR_CURVE_CHANNELS, colorCurveTable, identityColorCurve, MAX_COLOR_CURVE_POINTS,
  type ColorCurveChannel, type ColorCurvePoint, type ColorFilter } from '../../shared/visual/color-filter'

const channels: Record<ColorCurveChannel, string> = { rgb: 'RGB 综合', red: '红', green: '绿', blue: '蓝' }
const chartInset = 12
const chartSize = 255 + chartInset * 2
const grid = [0, 64, 128, 192, 255]
const byte = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

function NumberControl({ label, value, min, max, step = 1, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <label>{label}<input type="number" aria-label={label} value={draft ?? value} min={min} max={max} step={step}
    disabled={disabled} onChange={event => setDraft(event.currentTarget.value)} onBlur={event => {
      const next = event.currentTarget.valueAsNumber
      setDraft(null)
      if (draft !== null && Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
    }} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape' && draft !== null) { event.stopPropagation(); setDraft(null) }
    }}/></label>
}

function ToneCurve({ curves, onChange }: { curves: ColorFilter['curves']; onChange: (curves: ColorFilter['curves']) => void }) {
  const [channel, setChannel] = useState<ColorCurveChannel>('rgb')
  const [selected, setSelected] = useState(0)
  const grab = useRef<{ pointer: number; index: number } | null>(null)
  const points = curves[channel]
  const active = Math.min(selected, points.length - 1)
  const first = active === 0, last = active === points.length - 1
  const setPoints = (next: ColorCurvePoint[]) => onChange({ ...curves, [channel]: next })
  const move = (index: number, input: number, output: number) => {
    const point = points[index]
    if (!point || !Number.isFinite(input) || !Number.isFinite(output)) return
    const x = index === 0 || index === points.length - 1 ? point.input
      : Math.max(points[index - 1].input + 1, Math.min(points[index + 1].input - 1, byte(input)))
    const y = byte(output)
    if (point.input === x && point.output === y) return
    setPoints(points.map((current, i) => i === index ? { input: x, output: y } : current))
  }
  const remove = (index: number) => {
    if (index === 0 || index === points.length - 1) return
    setPoints(points.filter((_, i) => i !== index))
    setSelected(index - 1)
  }
  const reset = () => { setPoints(identityColorCurve()); setSelected(0) }
  const pointAfter = points.findIndex((point, index) => index > 0 && point.input - points[index - 1].input > 1)
  const insert = (index: number, point: ColorCurvePoint) => {
    setPoints([...points.slice(0, index), point, ...points.slice(index)])
    setSelected(index)
  }
  const pointerPoint = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { input: byte((event.clientX - rect.left) / rect.width * chartSize - chartInset),
      output: byte(255 + chartInset - (event.clientY - rect.top) / rect.height * chartSize) }
  }
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || event.currentTarget.closest('fieldset:disabled')) return
    const target = event.target as SVGElement
    const point = pointerPoint(event)
    let index = target.hasAttribute('data-curve-point') ? Number(target.getAttribute('data-curve-point'))
      : points.findIndex(row => row.input === point.input)
    if (index < 0) {
      if (points.length >= MAX_COLOR_CURVE_POINTS) return
      index = points.findIndex(row => row.input > point.input)
      insert(index, point)
    }
    setSelected(index)
    grab.current = { index, pointer: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const drag = (event: PointerEvent<SVGSVGElement>) => {
    if (grab.current?.pointer !== event.pointerId) return
    const point = pointerPoint(event)
    move(grab.current.index, point.input, point.output)
  }
  const key = (event: KeyboardEvent<SVGCircleElement>, index: number) => {
    if (event.currentTarget.closest('fieldset:disabled')) return
    const point = points[index], step = event.shiftKey ? 10 : 1
    switch (event.key) {
      case 'ArrowLeft': move(index, point.input - step, point.output); break
      case 'ArrowRight': move(index, point.input + step, point.output); break
      case 'ArrowDown': move(index, point.input, point.output - step); break
      case 'ArrowUp': move(index, point.input, point.output + step); break
      case 'Backspace': case 'Delete': remove(index); break
      default: return
    }
    event.preventDefault()
  }
  const values = colorCurveTable(points)
  const path = Array.from(values, (output, input) => `${input + chartInset},${255 + chartInset - output}`).join(' ')
  return <section className="tone-curve" aria-label="自定义调色曲线">
    <div className="art-style-parameters" role="group" aria-label="曲线通道">
      {COLOR_CURVE_CHANNELS.map(key => <button key={key} type="button" aria-pressed={key === channel}
        aria-label={channels[key]} onClick={() => { setChannel(key); setSelected(0); grab.current = null }}>{key === 'rgb' ? 'RGB' : channels[key]}</button>)}
    </div>
    <svg className="tone-curve-chart" data-channel={channel} viewBox={`0 0 ${chartSize} ${chartSize}`} role="group"
      aria-label={`${channels[channel]}曲线图`} onPointerDown={start} onPointerMove={drag} onLostPointerCapture={() => { grab.current = null }}>
      {grid.map(tick => <path key={tick} className="tone-curve-grid"
        d={`M${chartInset} ${tick + chartInset}h255 M${tick + chartInset} ${chartInset}v255`}/>)}
      <path className="tone-curve-diagonal" d={`M${chartInset} ${chartInset + 255}l255 -255`}/>
      <polyline className="tone-curve-line" points={path}/>
      {points.map(({ input, output }, index) => <circle key={index} data-curve-point={index} className="tone-curve-point"
        role="button" tabIndex={0} aria-label={`控制点 ${index + 1}，输入 ${input}，输出 ${output}`} aria-pressed={index === active}
        onFocus={() => setSelected(index)} onKeyDown={event => key(event, index)}
        cx={input + chartInset} cy={255 + chartInset - output} r={index === active ? 6 : 5}/>)}
    </svg>
    <div className="tone-curve-values">
      <NumberControl label="曲线输入" min={first ? 0 : points[active - 1].input + 1}
        max={last ? 255 : points[active + 1].input - 1} disabled={first || last}
        value={points[active].input} onChange={next => move(active, next, points[active].output)}/>
      <NumberControl label="曲线输出" min={0} max={255}
        value={points[active].output} onChange={next => move(active, points[active].input, next)}/>
    </div>
    <div className="art-style-actions">
      <button type="button" className="secondary" disabled={points.length >= MAX_COLOR_CURVE_POINTS || pointAfter < 0}
        onClick={() => {
          const index = !last && points[active + 1].input - points[active].input > 1 ? active + 1 : pointAfter
          const input = Math.round((points[index - 1].input + points[index].input) / 2)
          insert(index, { input, output: byte(values[input]) })
        }}>添加控制点</button>
      <button type="button" className="secondary" disabled={first || last} onClick={() => remove(active)}>删除控制点</button>
      <button type="button" className="secondary" onClick={reset}>重置此曲线</button>
    </div>
  </section>
}

export function ArtStyleSlider({ label, value, min = 0, disabled, onChange, step = 1 }: {
  label: string; value: number; min?: number; disabled?: boolean; step?: number; onChange: (value: number) => void
}) {
  return <label className="art-style-slider">
    <span>{label}</span><output>{min < 0 && value > 0 ? '+' : ''}{value}%</output>
    <input type="range" aria-label={label} min={min} max={100} step={step} value={value}
      disabled={disabled} onChange={event => onChange(event.currentTarget.valueAsNumber)}/>
  </label>
}

export function ColorFilterControls({ value, onChange, original }: {
  value: ColorFilter; onChange: (value: ColorFilter) => void; original?: boolean
}) {
  const update = (key: 'warmth' | 'strength' | 'saturation' | 'contrast', next: number) => onChange({ ...value, [key]: next })
  return <section className="art-style-module" aria-label={original ? '原画调色' : '色彩滤镜'}>
    <label className="art-style-toggle">
      <input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.currentTarget.checked })}/>
      <span>{original ? '原画调色' : '启用调色'}</span>
    </label>
    <fieldset disabled={!value.enabled}>
      <ArtStyleSlider label="冷暖" value={value.warmth} min={-100} step={.1} onChange={next => update('warmth', next)}/>
      <details className="workspace-advanced">
        <summary>曲线与更多调色</summary>
        <div className="art-style-advanced">
          <ToneCurve curves={value.curves} onChange={curves => onChange({ ...value, curves })}/>
          <ArtStyleSlider label="调色强度" value={value.strength} onChange={next => update('strength', next)}/>
          <NumberControl label="曝光" min={.25} max={2} step={.01} value={value.exposure} onChange={exposure => onChange({ ...value, exposure })}/>
          <ArtStyleSlider label="色彩浓度" value={value.saturation} min={-100} step={.1} onChange={next => update('saturation', next)}/>
          <ArtStyleSlider label="对比度" value={value.contrast} min={-100} step={.1} onChange={next => update('contrast', next)}/>
        </div>
      </details>
    </fieldset>
  </section>
}
