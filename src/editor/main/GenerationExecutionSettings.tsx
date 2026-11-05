export interface GenerationExecutionSettingsValue { mode: 'worker' | 'server'; baseUrl: string; token: string }

export default function GenerationExecutionSettings({ value, disabled, onChange }: {
  value: GenerationExecutionSettingsValue; disabled: boolean; onChange: (value: GenerationExecutionSettingsValue) => void
}) {
  return <section className="terrain-generation-panel" aria-label="参数地图生成方式">
    <h2>参数地图生成方式</h2>
    <p>室内、森林和火山使用下方同一生成设置。先预览实际结果和未满足项，再保存为可继续编辑的新工程。</p>
    <label>生成位置<select aria-label="参数地图生成位置" value={value.mode} disabled={disabled}
      onChange={event => onChange({ ...value, mode: event.target.value as 'worker' | 'server' })}>
      <option value="worker">本机生成 · 可离线使用</option><option value="server">服务端生成 · 不调用模型</option>
    </select></label>
    {value.mode === 'server' && <>
      <label>后端地址<input aria-label="参数地图后端地址" type="url" placeholder="https://your-server.example" autoComplete="off"
        value={value.baseUrl} disabled={disabled} onChange={event => onChange({ ...value, baseUrl: event.target.value })}/></label>
      <label>应用访问凭据<input aria-label="参数地图应用访问凭据" type="password" maxLength={4096} autoComplete="off"
        value={value.token} disabled={disabled} onChange={event => onChange({ ...value, token: event.target.value })}/></label>
      <p>点击预览时向所填后端发送新候选的空白场景、固定素材信息、生成参数和当前工程标识，不发送当前地图、历史或图片。地址与凭据只保存在当前页面内存。失败后由你决定是否重新预览。</p>
    </>}
    <p>局部重生成在本机执行。当前 AI 尚不能调用这三类生成；不支持的布局与要求会在预览时说明。</p>
  </section>
}
