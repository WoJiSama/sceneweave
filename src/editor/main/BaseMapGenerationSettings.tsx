export interface BaseMapGenerationSettingsValue {
  mode: 'worker' | 'server'
  baseUrl: string
  token: string
  quality?: 'standard' | 'detailed'
  surfacePalette?: 'shore' | 'classic' | 'surface-rules' | 'highland-v7'
  budgetMode?: 'auto' | 'small' | 'standard' | 'expanded'
}

/** Connection values stay in Workbench memory and never enter a project. */
export default function BaseMapGenerationSettings({ value, disabled, onChange }: {
  value: BaseMapGenerationSettingsValue
  disabled: boolean
  onChange: (value: BaseMapGenerationSettingsValue) => void
}) {
  return <section className="terrain-generation-panel" aria-label="程序底图生成方式">
    <h2>底图画面与生成位置</h2>
    <label>生成位置<select aria-label="程序底图生成位置" value={value.mode} disabled={disabled}
      onChange={event => onChange({ ...value, mode: event.target.value as 'worker' | 'server' })}>
      <option value="worker">本机生成 · 可离线使用</option>
      <option value="server">服务端生成 · 不调用模型</option>
    </select></label>
    <label>画面效果<select aria-label="程序底图地表外观" value={value.surfacePalette ?? 'shore'} disabled={disabled}
      onChange={event => onChange({ ...value, surfacePalette: event.target.value as 'shore' | 'classic' | 'surface-rules' | 'highland-v7' })}>
      <option value="shore">岸岩层次 · 暖岩、草缘与浅水</option><option value="classic">经典外观</option>
      <option value="surface-rules">连续地表与成片植被</option>
      <option value="highland-v7">高台植被与岩阶过渡</option>
    </select></label>
    <label>画面细节<select aria-label="程序底图画面细节" value={value.quality ?? 'standard'} disabled={disabled}
      onChange={event => onChange({ ...value, quality: event.target.value as 'standard' | 'detailed' })}>
      <option value="standard">标准细节</option><option value="detailed">精细细节</option>
    </select></label>
    <label>编辑容量<select aria-label="程序底图预算选择" value={value.budgetMode ?? 'auto'} disabled={disabled}
      onChange={event => onChange({ ...value, budgetMode: event.target.value as 'auto' | 'small' | 'standard' | 'expanded' })}>
      <option value="auto">自动 · 按地图和本机检测选择</option><option value="small">较小容量 · 节省资源</option>
      <option value="standard">标准容量</option><option value="expanded">扩展容量</option>
    </select></label>
    <p>容量在生成前确定，生成中不会自动降低画面细节。{(value.surfacePalette ?? 'shore') !== 'classic' && '当前画面效果在自动模式下至少使用标准容量。'}</p>
    <p>{value.surfacePalette === 'surface-rules'
      ? '连续地表与成片植被可采用后继续手工编辑；当前不支持 AI 接续。'
      : value.surfacePalette === 'highland-v7'
        ? '高台植被与岩阶过渡可采用后继续手工编辑；当前不支持 AI 接续。'
      : '生成后可采用底图继续手工编辑，也可连接支持接续的 AI，在明确授权范围内继续修改。AI 失败或取消仍保留合法底图。'}</p>
    <details className="workspace-advanced"><summary>技术详情 · 地表配方</summary>
      <p>当前配方标识：<code>{value.surfacePalette ?? 'shore'}</code>。</p>
      {(value.surfacePalette ?? 'shore') !== 'classic' && <p>{value.surfacePalette === 'surface-rules'
        ? '此配方保存连续材质覆盖与区域植物簇；生成前校验素材、许可和预算。'
        : value.surfacePalette === 'highland-v7'
          ? '高台树冠规则、受约束候选搜索与岩阶/崖缘视觉采用独立配方版本；v6 固定结果保持可重放。'
          : '岸岩层次保存完整岸带覆盖。'}</p>}
    </details>
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
