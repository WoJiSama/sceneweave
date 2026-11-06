import { useId, useLayoutEffect, useRef, useState } from 'react'
import { formatLengthInput, parseLengthInput, type LengthDisplayUnit } from './length-input'

export function NumberInput({ label, ariaLabel, value, onCommit, unit = 'mm', displayUnit, step }: { label: string; ariaLabel?: string; value: number; onCommit: (value: number) => void; unit?: string; displayUnit?: LengthDisplayUnit; step?: number }) {
  const formatted = displayUnit ? formatLengthInput(value, displayUnit) : String(value)
  const [draft, setDraft] = useState(formatted), [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const cancelled = useRef(false)
  useLayoutEffect(() => { setDraft(formatted); setError(null) }, [formatted])
  return <label className="asset-number"><span>{label}</span><div><input aria-label={ariaLabel ?? label} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} type="number" value={draft} step={step ?? (displayUnit ? 'any' : unit === '°' ? 15 : 100)} onChange={event => { setDraft(event.target.value); setError(null) }} onKeyDown={event => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.currentTarget.blur() }
    if (event.key === 'Escape') { cancelled.current = true; setDraft(formatted); setError(null); event.currentTarget.blur() }
  }} onBlur={() => {
    if (cancelled.current) { cancelled.current = false; return }
    if (draft === formatted) return
    if (!displayUnit) {
      const number = Number(draft)
      if (draft.trim() && Number.isFinite(number) && number !== value) onCommit(number)
      setDraft(String(value)); return
    }
    try {
      const number = parseLengthInput(draft, displayUnit)
      if (number !== value) onCommit(number)
      // Only the owner's accepted value advances the field; rejected edits keep the prior value.
      setDraft(formatted); setError(null)
    } catch (failure) { setDraft(formatted); setError(`${failure instanceof Error ? failure.message : String(failure)} 已保留原值。`) }
  }}/><small>{displayUnit ?? unit}</small></div>{error && <small id={errorId} role="alert" className="asset-form-error">{error}</small>}</label>
}
