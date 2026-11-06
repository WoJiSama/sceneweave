export interface TaskChoice<T extends string> { id: T; label: string; description?: string }

export default function TaskPicker<T extends string>({ label, value, choices, onChange }: {
  label: string; value: T; choices: readonly TaskChoice<T>[]; onChange: (value: T) => void
}) {
  return <div className="workspace-task-picker" role="group" aria-label={label}>
    {choices.map(choice => <button key={choice.id} aria-pressed={choice.id === value} onClick={() => onChange(choice.id)}>
      <strong>{choice.label}</strong>{choice.description && <small>{choice.description}</small>}
    </button>)}
  </div>
}
