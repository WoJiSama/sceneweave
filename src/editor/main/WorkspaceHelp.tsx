import { useRef, type KeyboardEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import { tutorialHash } from '../../tutorial/location'

export function closeWorkspaceDisclosure(disclosure: HTMLDetailsElement) {
  disclosure.open = false
  disclosure.querySelector('summary')?.focus()
}

export function onWorkspaceDisclosureEscape(event: KeyboardEvent<HTMLDetailsElement>) {
  if (event.defaultPrevented || event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !event.currentTarget.open) return
  event.preventDefault()
  event.stopPropagation()
  closeWorkspaceDisclosure(event.currentTarget)
}

export default function WorkspaceHelp({ disclosureGroup }: { disclosureGroup: string }) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  return <details className="workspace-help" name={disclosureGroup} ref={disclosure} onKeyDown={onWorkspaceDisclosureEscape}>
    <summary><CircleHelp aria-hidden="true" size={15}/>操作帮助</summary>
    <section className="workspace-file-surface" aria-label="制作流程与快捷键" tabIndex={0}>
      <p><a href={tutorialHash} target="_blank" rel="noopener">阅读完整教程（新标签页）</a></p>
      <h2>保存、备份与分享</h2>
      <dl>
        <div><dt>浏览器自动保存</dt><dd>已采用的编辑保存在此浏览器、此站点。换浏览器、端口、设备或清除站点数据前，从「文件」下载备份。</dd></div>
        <div><dt>可编辑 .sceneweave</dt><dd>含实际资源、许可和秘密，供主持人保管。用「文件」→「打开工程文件」恢复编辑。</dd></div>
        <div><dt>玩家 / 主持人 PNG</dt><dd>「导出」生成当前楼层的图片。玩家 PNG 过滤秘密，可与玩家分享。主持人 PNG 含秘密。</dd></div>
      </dl>
      <p>发起下载后，请在浏览器下载列表确认文件。保存失败时，使用页面的恢复选项下载当前工程、重试保存或另存副本。</p>
      <h3>工作区怎么用</h3>
      <ol>
        <li>从「文件」新建或打开工程，也可在左侧「生成」选择地图方案。</li>
        <li>从左侧选择制作任务，到右侧调整参数，在画布绘制或放置。切换模块和收起侧栏会保留草稿、候选与选区。</li>
        <li>在右侧审阅候选并选择采用或取消。用「返回当前工具与草稿」或「返回候选审阅」继续未完成的操作。</li>
        <li>用顶栏撤销、重做和查看保存状态。工程备份包含已采用的编辑。</li>
      </ol>
      <h3>工程快捷键</h3>
      <dl>
        <div><dt><kbd>Ctrl / ⌘ + Z</kbd></dt><dd>撤销上一次已采用的编辑</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + Shift + Z</kbd><br/>或 <kbd>Ctrl / ⌘ + Y</kbd></dt><dd>重做</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + S</kbd></dt><dd>保存到此浏览器</dd></div>
      </dl>
      <p>输入框保留文本快捷键。有未完成草稿、候选或弹窗时，请先按页面提示完成或取消。</p>
      <h3>先点击画布，再使用</h3>
      <p>窄屏可在画布工具栏的「选项」中调整框选、组合成员与子格吸附。</p>
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
      <p>在菜单或帮助内按 Esc 可关闭当前面板并回到入口。回到画布后，按 Esc 可取消当前画布操作。</p>
      <p>属性数值输入中，Enter 确认当前字段，Esc 恢复原值。绘图取点完成后，将焦点移回画布按 Enter，或点「预览房间」「预览绘制结果」。</p>
      <button className="secondary" type="button" onClick={() => { if (disclosure.current) closeWorkspaceDisclosure(disclosure.current) }}>关闭操作帮助</button>
    </section>
  </details>
}
