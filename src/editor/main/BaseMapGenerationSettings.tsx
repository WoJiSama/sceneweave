export interface BaseMapGenerationSettingsValue {
  mode: 'worker' | 'server'
  baseUrl: string
  token: string
}

/** Connection values stay in Workbench memory and never enter a project. */
export default function BaseMapGenerationSettings({ value, disabled, onChange }: {
  value: BaseMapGenerationSettingsValue
  disabled: boolean
  onChange: (value: BaseMapGenerationSettingsValue) => void
}) {
  return <section className="terrain-generation-panel" aria-label="程序底图生成方式">
    <h2>程序底图生成方式</h2>
    <label>生成位置<select aria-label="程序底图生成位置" value={value.mode} disabled={disabled}
      onChange={event => onChange({ ...value, mode: event.target.value as 'worker' | 'server' })}>
      <option value="worker">本机生成 · 可离线使用</option>
      <option value="server">服务端生成 · 不调用模型</option>
    </select></label>
    <p>生成后可直接采用底图，也可连接支持接续的 AI，在明确授权范围内继续修改。失败或取消 AI 仍保留合法底图。</p>
    {value.mode === 'server' && <>
      <label>后端地址<input aria-label="程序底图后端地址" type="url" placeholder="https://your-server.example" value={value.baseUrl} disabled={disabled}
        autoComplete="off" onChange={event => onChange({ ...value, baseUrl: event.target.value })}/></label>
      <label>应用访问凭据<input aria-label="程序底图应用访问凭据" type="password" value={value.token} maxLength={4096} disabled={disabled}
        autoComplete="off" onChange={event => onChange({ ...value, token: event.target.value })}/></label>
      <p>点击生成时，发送新候选的空白场景、生成设置、固定素材信息及用于校验的当前工程标识到所填后端；不发送当前地图内容、历史或图片，不调用模型。地址和凭据仅保留在当前页面内存。</p>
    </>}
  </section>
}
