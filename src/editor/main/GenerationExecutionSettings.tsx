export interface GenerationExecutionSettingsValue { mode: 'worker' | 'server'; baseUrl: string; token: string }

export default function GenerationExecutionSettings({ value, disabled, onChange }: {
  value: GenerationExecutionSettingsValue; disabled: boolean; onChange: (value: GenerationExecutionSettingsValue) => void
}) {
  return <section className="terrain-generation-panel" aria-label="参数地图生成方式">
    <h2>室内、森林等场景的生成位置</h2>
    <p>室内、森林、火山和混合场景共用此设置，不调用 AI 模型。先预览地图和未满足项，再保存为可继续编辑的新工程。</p>
    <label>生成位置<select aria-label="参数地图生成位置" value={value.mode} disabled={disabled}
      onChange={event => onChange({ ...value, mode: event.target.value as 'worker' | 'server' })}>
      <option value="worker">本机生成 · 可离线使用</option><option value="server">服务端生成 · 不调用模型</option>
    </select></label>
    {value.mode === 'server' && <>
      <label>后端地址<input aria-label="参数地图后端地址" type="url" placeholder="https://your-server.example" autoComplete="off"
        value={value.baseUrl} disabled={disabled} onChange={event => onChange({ ...value, baseUrl: event.target.value })}/></label>
      <label>应用访问凭据<input aria-label="参数地图应用访问凭据" type="password" maxLength={4096} autoComplete="off"
        value={value.token} disabled={disabled} onChange={event => onChange({ ...value, token: event.target.value })}/></label>
      <p>预览会向此后端发送生成参数、素材信息及当前工程标识；不发送当前地图内容、历史或图片。地址与凭据只保留在当前页面。失败后由你决定是否重新预览。</p>
      <details className="workspace-advanced"><summary>技术详情 · 服务端请求</summary><p>请求包含新候选的空白场景和固定素材信息。地址与应用访问凭据仅保存在页面内存，不写入工程。</p></details>
    </>}
    <p>局部重生成在本机执行。当前 AI 尚不能调用这些生成；不支持的布局与要求会在预览时说明。</p>
  </section>
}
