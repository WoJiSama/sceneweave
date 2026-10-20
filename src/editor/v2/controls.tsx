import { useLayoutEffect, useRef, useState } from 'react'

export function NumberInput({ label, value, onCommit, unit = 'mm', step }: { label: string; value: number; onCommit: (value: number) => void; unit?: string; step?: number }) {
  const [draft, setDraft] = useState(String(value))
  const cancelled = useRef(false)
  useLayoutEffect(() => setDraft(String(value)), [value])
  return <label className="asset-number"><span>{label}</span><div><input aria-label={label} type="number" value={draft} step={step ?? (unit === '°' ? 15 : 100)} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { cancelled.current = true; setDraft(String(value)); event.currentTarget.blur() }
  }} onBlur={() => {
    if (cancelled.current) { cancelled.current = false; return }
    const number = Number(draft)
    if (draft.trim() && Number.isFinite(number) && number !== value) onCommit(number)
    setDraft(String(value))
  }}/><small>{unit}</small></div></label>
}
