export interface BaseMapGenerationSettingsValue {
  mode: 'worker' | 'server'
  baseUrl: string
  token: string
  quality?: 'standard' | 'detailed'
  preset?: 'default' | 'lightweight' | 'surface-rules' | 'highland'
  budgetMode?: 'auto' | 'small' | 'standard' | 'expanded'
}

/** Connection values stay in Workbench memory and never enter a project. */
export default function BaseMapGenerationSettings({ value, disabled, onChange }: {
  value: BaseMapGenerationSettingsValue
  disabled: boolean
  onChange: (value: BaseMapGenerationSettingsValue) => void
}) {
  const preset = value.preset ?? 'default'
  const supportsAiContinuation = preset === 'default' || preset === 'lightweight'
  return <section className="terrain-generation-panel" aria-label="程序底图生成方式">
    <h2>底图生成</h2>
    <label>生成位置<select aria-label="程序底图生成位置" value={value.mode} disabled={disabled}
      onChange={event => onChange({ ...value, mode: event.target.value as 'worker' | 'server' })}>
      <option value="worker">本机生成 · 可离线使用</option>
      <option value="server">服务端生成 · 不调用模型</option>
    </select></label>
    <label>生成配方<select aria-label="程序底图生成配方" value={preset} disabled={disabled}
      onChange={event => onChange({ ...value, preset: event.target.value as typeof preset })}>
      <option value="default">默认配方</option>
      <option value="lightweight">轻量底图</option>
      <option value="surface-rules">连续地表与成片植被</option>
      <option value="highland">高台植被与岩阶过渡</option>
    </select></label>
    <p>配方决定下次生成的地形和布景。全图画风可在「氛围 → 画风」调整。</p>
    <label>画面细节<select aria-label="程序底图画面细节" value={value.quality ?? 'standard'} disabled={disabled}
      onChange={event => onChange({ ...value, quality: event.target.value as 'standard' | 'detailed' })}>
      <option value="standard">标准细节</option><option value="detailed">精细细节</option>
    </select></label>
    <label>编辑容量<select aria-label="程序底图预算选择" value={value.budgetMode ?? 'auto'} disabled={disabled}
      onChange={event => onChange({ ...value, budgetMode: event.target.value as 'auto' | 'small' | 'standard' | 'expanded' })}>
      <option value="auto">自动 · 按地图和本机检测选择</option><option value="small">较小容量 · 节省资源</option>
      <option value="standard">标准容量</option><option value="expanded">扩展容量</option>
    </select></label>
    <p>容量在生成前确定，生成中不会自动降低画面细节。{preset !== 'lightweight' && '此配方在自动模式下至少使用标准容量。'}</p>
    <p>{supportsAiContinuation
      ? '预览后可采用底图继续手工编辑，也可连接支持接续的 AI。AI 失败或取消时会保留底图候选。'
      : '采用底图后可继续手工编辑。此配方当前仅支持手工接续。'}</p>
    {value.mode === 'server' && <>
      <label>后端地址<input aria-label="程序底图后端地址" type="url" placeholder="https://your-server.example" value={value.baseUrl} disabled={disabled}
        autoComplete="off" onChange={event => onChange({ ...value, baseUrl: event.target.value })}/></label>
      <label>应用访问凭据<input aria-label="程序底图应用访问凭据" type="password" value={value.token} maxLength={4096} disabled={disabled}
        autoComplete="off" onChange={event => onChange({ ...value, token: event.target.value })}/></label>
      <p>生成会向此后端发送生成设置、素材信息及当前工程标识；不发送当前地图内容、历史或图片，不调用模型。地址和凭据只保留在当前页面。</p>
      <details className="workspace-advanced"><summary>技术详情 · 服务端请求</summary><p>请求包含新候选的空白场景及固定素材信息，用当前工程标识校验候选。地址与应用访问凭据仅保存在页面内存，不写入工程。</p></details>
    </>}
  </section>
}
