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
    <h2>程序底图生成方式</h2>
    <label>生成位置<select aria-label="程序底图生成位置" value={value.mode} disabled={disabled}
      onChange={event => onChange({ ...value, mode: event.target.value as 'worker' | 'server' })}>
      <option value="worker">本机生成 · 可离线使用</option>
      <option value="server">服务端生成 · 不调用模型</option>
    </select></label>
    <label>地表配方<select aria-label="程序底图地表外观" value={value.surfacePalette ?? 'shore'} disabled={disabled}
      onChange={event => onChange({ ...value, surfacePalette: event.target.value as 'shore' | 'classic' | 'surface-rules' | 'highland-v7' })}>
      <option value="shore">岸岩层次 · 暖岩、草缘与浅水</option><option value="classic">经典外观</option>
      <option value="surface-rules">可编辑覆盖与区域布景</option>
      <option value="highland-v7">高台植被与岩阶过渡 v7</option>
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
    {(value.surfacePalette ?? 'shore') !== 'classic' && <p>{value.surfacePalette === 'surface-rules' ? '规则地表会保存连续材质覆盖与区域植物簇；生成前校验素材、许可和预算。' : value.surfacePalette === 'highland-v7' ? '高台树冠规则、受约束候选搜索与岩阶/崖缘视觉采用独立配方版本；v6 固定结果保持可重放。' : '岸岩层次会保存完整岸带覆盖。'}自动模式至少使用标准容量。</p>}
    <p>{value.surfacePalette === 'surface-rules'
      ? '本次容量在开始前确定，画面细节不会在生成中自动降低。此配方保存连续地表和区域植被规则；当前 AI 接续尚不支持这些规则，生成后可直接采用并继续手工编辑。'
      : value.surfacePalette === 'highland-v7'
        ? '本次容量在开始前确定，画面细节不会在生成中自动降低。高台与连接表现使用独立配方；此候选含区域植被规则，当前可直接采用并继续手工编辑，AI 接续尚未开放。'
      : '本次容量在开始前确定，画面细节不会在生成中自动降低。生成后可直接采用底图，也可连接支持接续的 AI，在明确授权范围内继续修改。失败或取消 AI 仍保留合法底图。'}</p>
    {value.mode === 'server' && <>
      <label>后端地址<input aria-label="程序底图后端地址" type="url" placeholder="https://your-server.example" value={value.baseUrl} disabled={disabled}
        autoComplete="off" onChange={event => onChange({ ...value, baseUrl: event.target.value })}/></label>
      <label>应用访问凭据<input aria-label="程序底图应用访问凭据" type="password" value={value.token} maxLength={4096} disabled={disabled}
        autoComplete="off" onChange={event => onChange({ ...value, token: event.target.value })}/></label>
      <p>点击生成时，发送新候选的空白场景、生成设置、固定素材信息及用于校验的当前工程标识到所填后端；不发送当前地图内容、历史或图片，不调用模型。地址和凭据仅保留在当前页面内存。</p>
    </>}
  </section>
}
