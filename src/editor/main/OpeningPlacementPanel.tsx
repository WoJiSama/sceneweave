import { NumberInput } from '../native-canvas/controls'

export type OpeningTool = { kind: 'door' | 'window'; widthMm: number }
export default function OpeningPlacementPanel({ value, unit, disabled, onChange, onCancel }: {
  value: OpeningTool; unit: 'm' | 'ft'; disabled: boolean; onChange: (value: OpeningTool) => void; onCancel: () => void
}) {
  return <section className="opening-placement" aria-label="放置门窗">
    <h2>放置门窗</h2><p className="workspace-start-help">选择类型和净宽，然后点击墙上要放置的位置。预览会检查墙角、已有门窗和相邻房间。</p>
    <fieldset disabled={disabled}><label className="building-field">类型<select aria-label="画布门窗类型" value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as OpeningTool['kind'] })}><option value="door">门</option><option value="window">窗</option></select></label>
      <NumberInput label="画布门窗净宽" value={value.widthMm} displayUnit={unit} onCommit={widthMm => onChange({ ...value, widthMm })}/>
    </fieldset><p className="workspace-start-help">点击位置是门窗中心。Escape 或下方按钮可退出。</p><button className="secondary asset-wide" onClick={onCancel}>取消门窗工具</button>
  </section>
}
