import { useRef } from 'react'
import { CircleHelp } from 'lucide-react'

export default function WorkspaceHelp() {
  const disclosure = useRef<HTMLDetailsElement>(null)
  const close = () => {
    if (!disclosure.current) return
    disclosure.current.open = false
    disclosure.current.querySelector('summary')?.focus()
  }
  return <details className="workspace-help" ref={disclosure} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation(); close()
    }
  }}>
    <summary><CircleHelp size={15}/>操作帮助</summary>
    <section aria-label="制作流程与快捷键" tabIndex={0}>
      <h2>工作区怎么用</h2>
      <p>最左侧按制作顺序排列：场景、生成、地形、建筑、素材与布景、氛围。可以跳过生成或随时返回前面的工具；底部的 AI 和历史在整个制作过程中都可使用。</p>
      <dl>
        <div><dt>左侧内容</dt><dd>浏览全图的图层和对象、查找素材、选择创作任务，或查看生成、AI 与历史列表。「场景」集中管理图层和已有对象。</dd></div>
        <div><dt>右侧当前详情</dt><dd>查看所选对象、调整当前工具参数，或审阅素材来源、历史恢复与待采用修改。先核对面板中的作用对象和范围。</dd></div>
        <div><dt>画布上方工具条</dt><dd>选择、平移、绘制、放置、注记、遮罩和量尺。浏览左侧模块会保留当前选择、工具草稿与候选。</dd></div>
        <div><dt>顶部文件菜单</dt><dd>新建空白场景、打开工程文件、从样板开始、重新载入及备份工程；「导出」提供玩家地图、主持人地图和 VTT。</dd></div>
      </dl>
      <p>窄窗口一次展开一个侧栏。关闭侧栏只收起展示；用「返回当前工具与草稿」或「返回候选审阅」继续操作。素材详情中的返回按钮会回到之前的对象或任务。</p>
      <h3>从新建到交付</h3>
      <ol>
        <li>从顶部「文件」新建，或从左侧「生成」选择地图方案。</li>
        <li>在「地形」「建筑」选择任务，到右侧调整参数；在「素材与布景」挑选内容并放置到画布，再到「氛围」调整效果。</li>
        <li>出现候选时在右侧核对修改；需要确认范围的候选，勾选确认后再点「采用」。取消预览不会修改工程。</li>
        <li>已采用的编辑自动保存在此浏览器。用「导出」分享玩家地图，或从「文件」下载可继续编辑的工程备份。</li>
      </ol>
      <h3>工程快捷键</h3>
      <dl>
        <div><dt><kbd>Ctrl / ⌘ + Z</kbd></dt><dd>撤销上一次已采用的编辑</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + Shift + Z</kbd><br/>或 <kbd>Ctrl / ⌘ + Y</kbd></dt><dd>重做</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + S</kbd></dt><dd>保存到此浏览器</dd></div>
      </dl>
      <p>输入框保留文本快捷键；有未完成草稿、候选或弹窗时，请先按页面提示完成或取消。保存到浏览器不会下载工程文件。</p>
      <h3>先点击画布，再使用</h3>
      <dl>
        <div><dt><kbd>空格 + 拖动</kbd></dt><dd>平移视图</dd></div>
        <div><dt><kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd></dt><dd>放大 / 缩小 / 适应全图</dd></div>
        <div><dt><kbd>方向键</kbd></dt><dd>平移视图；按住 Shift 加快</dd></div>
        <div><dt><kbd>Shift + 点击 / 框选</kbd></dt><dd>增加选择</dd></div>
        <div><dt><kbd>Option / Alt + 点击 / 框选</kbd></dt><dd>减去选择</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + A</kbd></dt><dd>选择可编辑对象，跳过隐藏和锁定项；需先退出绘图、放置或笔刷</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + C</kbd> / <kbd>Ctrl / ⌘ + V</kbd></dt><dd>复制当前工程内的独立物件，再预览粘贴；每次在原件旁偏移 0.3 米，采用后可一次撤销。复制源改变后需重新复制，切换或重开工程会清空</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>当前房间、地形、区域、道路或连接取点完成后预览；矩形需两角，多边形至少三点，道路/连接至少两点。采用仍须审阅后点击按钮</dd></div>
        <div><dt><kbd>Delete</kbd> / <kbd>Backspace</kbd></dt><dd>预览删除所选物件；核对后采用，可一次撤销。需先退出绘图、放置或笔刷，锁定及依赖限制仍生效</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>取消当前绘图、放置或拖动；侧栏表单草稿可用对应的「取消草稿」按钮清除</dd></div>
      </dl>
      <p>物件内容只留在本次工程会话，系统剪贴板仅保存引用标记；不能粘贴到其他工程或应用。输入框仍使用普通文本复制粘贴。</p>
      <h3>列表与数值输入</h3>
      <p>最左导航用 ↑↓、Home、End 移动焦点，Enter 或空格打开模块；画布工具条用 ←→、Home、End 移动焦点。对象列表用 ↑↓、Home、End、Page Up / Page Down 浏览，Enter 或空格选择；配合 Shift 增选、Option / Alt 减选。</p>
      <p>Esc 先关闭当前菜单、弹窗、素材详情或所属侧栏；关闭侧栏后，回到画布再按 Esc 才取消当前画布操作。</p>
      <p>属性数值输入中，Enter 确认当前字段，Esc 恢复原值。绘图取点完成后，将焦点移回画布按 Enter，或点「预览房间」「预览绘制结果」。</p>
      <button className="secondary" type="button" onClick={close}>关闭操作帮助</button>
    </section>
  </details>
}
