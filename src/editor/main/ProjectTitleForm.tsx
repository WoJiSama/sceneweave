import { useState } from 'react'

export default function ProjectTitleForm({ title, disabled, onChange, onSave, onCancel }: {
  title: string; disabled: boolean; onChange: (dirty: boolean) => void; onSave: (title: string) => void; onCancel: () => void
}) {
  const [value, setValue] = useState(title)
  const trimmed = value.trim()
  return <form className="workspace-project-title-form" onSubmit={event => { event.preventDefault(); if (trimmed && trimmed.length <= 120) onSave(trimmed) }}>
    <label>工程名称<input value={value} maxLength={120} disabled={disabled} onChange={event => { setValue(event.target.value); onChange(event.target.value !== title) }}/></label>
    {!trimmed && <p role="status">请输入工程名称。</p>}
    <div className="workspace-title-actions"><button className="primary" type="submit" disabled={disabled || !trimmed || trimmed === title}>保存名称</button><button className="secondary" type="button" disabled={disabled || value === title} onClick={onCancel}>取消改名</button></div>
  </form>
}
