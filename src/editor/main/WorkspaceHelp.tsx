import { useRef, type KeyboardEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import { tutorialHash, tutorialHref } from '../../tutorial/location'

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
      <p><a href={tutorialHref('atmosphere', 'art-style')} target="_blank" rel="noopener">全图画风教程（新标签页）</a></p>
      <p>在「氛围 → 画风」切换「按材质绘制笔触」可预览新旧画法，点「采用画风」保存到整个工程。</p>
      <p><a href={tutorialHref('scene', 'oblique')} target="_blank" rel="noopener">斜俯视取景教程（新标签页）</a></p>
      <p>斜俯视可以取消加载或出图。在墙、门窗和物件的属性中可设置 3D 尺寸。导入的图片物件默认平贴，可在素材副本中选择立体形状、上传侧面图并旋转预览。</p>
      <h2>保存、备份与分享</h2>
      <dl>
        <div><dt>浏览器自动保存</dt><dd>已采用的编辑保存在此浏览器、此站点。换浏览器、端口、设备或清除站点数据前，从「文件」下载备份。</dd></div>
        <div><dt>可编辑 .sceneweave</dt><dd>含实际资源、许可和秘密，供主持人保管。准备文件时可点「取消备份」。用「文件」→「打开工程文件」恢复编辑。</dd></div>
        <div><dt>空白场景的常用素材</dt><dd>地面和房间木地板随新图保存。顶栏「自选下载」可提前下载所选或全部地图素材图片，编辑时会复用本地图片。采用后原图和许可随工程备份。</dd></div>
        <div><dt>玩家 / 主持人 PNG</dt><dd>「导出」生成当前楼层的图片。玩家 PNG 过滤秘密，可与玩家分享。主持人 PNG 含秘密。</dd></div>
      </dl>
      <p>发起下载后，请在浏览器下载列表确认文件。保存失败时，使用页面的恢复选项下载当前工程、重试保存或另存副本。</p>
      <h3>工作区怎么用</h3>
      <ol>
        <li>从首页「新建场景」或「文件」创建一片可编辑的平地。点「房间」取两个对角，再点「完成房间」。独立新房间可一步撤销，涉及已有对象时会先显示影响。</li>
        <li>选中房间，点「沿墙扩建」并从外墙向外拖，或分别点外墙和外沿。「填写尺寸」可精确指定进深。用「放置门窗」在墙上开门，也可以在房间里摆放单件、组合或按用途布置家具。</li>
        <li>在房间详情展开「房间关联对象」，可选中墙上的门窗、室内物件、由房间支撑的道路或挂在它们上的注记。给已有建筑组开窗、挂线索时，组成员会一起更新。</li>
        <li>物件完整移进房间后自动归入。拖过门槛会显示原房间和目标房间，采用后可一次撤销。停在门槛上时，可在物件属性的「归属房间」手动选择。</li>
        <li>在「地形」绘路或布置植被时，选择实际支撑面。在完整自然组的地面上新增道路、散布植被或新建独立房屋，采用后即可随地形一起移动。跨两个独立组的道路、坡道和共用边缘保留双方关系，单移一侧前须先处理这些连接。</li>
        <li>在「生成」里选内容类型并设定占地。开始后回到画布查看轮廓、空间与细节逐步成形，也可点「跳到完整预览」。点选对象核对后，选择「加入当前画布」或「放弃生成」。</li>
        <li>采用海岸或岩岛后，在「场景」搜索礁石、崖壁或台阶。点选后可在画布拖动轮廓或路线节点、在详情调整崖面和踏面。石头可移动、旋转，并在「外观变体」中更换石形。</li>
        <li>在「地形 → 修改地形」预览局部联动时，可按 Escape 或点「取消局部地形预览」。</li>
        <li>「地形 → 起伏笔刷」可跨相邻地块塑形，也可调整切口周围的岩体顶部。经过标红的固定道路或台阶时，先点「保留承托地形」，再预览和采用。整笔可一次撤销。</li>
        <li>在「素材与布景 → 布景与模板」保存完整房间时，可以连同桌面及桌上附着的物件复用。到另一个工程预览并放置后，设为随动的物件会跟随原来承托它的桌面。</li>
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
      <p>窄屏点击侧边图标选模块，点顶栏的「当前详情」打开右侧内容，抽屉右上角可关闭。画布工具栏的「选项」可调整框选、组合成员与子格吸附。</p>
      <dl>
        <div><dt><kbd>空格 + 拖动</kbd></dt><dd>平移视图</dd></div>
        <div><dt><kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd></dt><dd>放大 / 缩小 / 适应全图</dd></div>
        <div><dt><kbd>方向键</kbd></dt><dd>平移视图；按住 Shift 加快</dd></div>
        <div><dt><kbd>Shift + 点击 / 框选</kbd></dt><dd>增加选择</dd></div>
        <div><dt><kbd>Option / Alt + 点击 / 框选</kbd></dt><dd>减去选择</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + A</kbd></dt><dd>选择可编辑对象，跳过隐藏和锁定项；需先退出绘图、放置或笔刷</dd></div>
        <div><dt><kbd>Ctrl / ⌘ + C</kbd> / <kbd>Ctrl / ⌘ + V</kbd></dt><dd>复制当前工程内的独立物件，再预览粘贴；每次在原件旁偏移 0.3 米，采用后可一次撤销。复制源改变后需重新复制，切换或重开工程会清空</dd></div>
        <div><dt><kbd>Enter</kbd></dt><dd>当前房间、地形、区域、道路或连接取点完成后预览；矩形需两角，多边形至少三点，道路/连接至少两点。采用仍须审阅后点击按钮</dd></div>
        <div><dt><kbd>Delete</kbd> / <kbd>Backspace</kbd></dt><dd>按选区预览删除。单选删该物件，选择组合删整个组合。核对后采用，可一次撤销</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>取消当前绘图、放置或拖动；侧栏表单草稿可用对应的「取消草稿」按钮清除</dd></div>
      </dl>
      <p>自动选路时，拖动转弯可固定途经点。聚焦手柄后可用方向键微调、用空格选中。选中内部固定点可「固定歇脚平台」并调长度和高程。「恢复平台自动」保留途经点，「恢复此点自动」一起解除该点与平台。</p>
      <p>物件内容只留在本次工程会话，系统剪贴板仅保存引用标记；不能粘贴到其他工程或应用。输入框仍使用普通文本复制粘贴。</p>
      <h3>列表与数值输入</h3>
      <p>最左导航用 ↑↓、Home、End 移动焦点，Enter 或空格打开模块；画布工具条用 ←→、Home、End 移动焦点。对象列表用 ↑↓、Home、End、Page Up / Page Down 浏览，Enter 或空格选择；配合 Shift 增选、Option / Alt 减选。</p>
      <p>在菜单或帮助内按 Esc 可关闭当前面板并回到入口。回到画布后，按 Esc 可取消当前画布操作。</p>
      <p>属性数值输入中，Enter 确认当前字段，Esc 恢复原值。绘图取点完成后，将焦点移回画布按 Enter，或点「预览房间」「预览绘制结果」。</p>
      <button className="secondary" type="button" onClick={() => { if (disclosure.current) closeWorkspaceDisclosure(disclosure.current) }}>关闭操作帮助</button>
    </section>
  </details>
}
