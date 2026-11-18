import { Check, Figure, LessonLink, type TutorialChapter } from './lesson'

export const aiTools: TutorialChapter = {
  id: 'ai', label: 'AI 与外部工具', title: '连接 AI、审阅草稿与使用本机工具',
  description: '按需要用对话咨询、授权场景草稿，或让外部助手通过本机工具制作。',
  start: <>只想按参数出图时，从<LessonLink chapter="generation">生成地图</LessonLink>开始，保留本机生成。应用内 AI 需要能访问的自有后端和由该后端签发的应用凭据。</>,
  sections: [
    { id: 'connect', title: '连接自有后端并发起对话', body: <>
      <ol>
        <li>从编辑器左侧打开「AI」。展开连接设置，在「自有后端地址」填完整服务地址，在「后端应用凭据」填后端签发的应用凭据。模型供应商密钥由服务器配置。</li>
        <li>点「连接 AI 后端」，查看后端验证结果和能力。遇到连接失败时，先按界面信息检查地址、凭据、服务运行状态，以及后端是否允许当前站点访问，再重新连接。</li>
        <li>普通对话可问「做一个两室驿站，我该先确定哪些参数？」。确认发送范围后点「发送新任务」。模型可回答并使用实际支持的只读查询。需要画地图时，把建议带回生成或手工编辑。</li>
        <li>任务卡可查状态和工具记录，也可按任务 ID 只读查询。需要停止服务器任务时点「取消任务」。隐藏面板会保留对话。上一次请求结果未知时，先查询该任务，等界面确认后再决定是否继续。</li>
      </ol>
      <Figure file="ai" width={269} height={219} alt="AI 连接设置中的自有后端地址、后端应用凭据与连接按钮">
        在这里填写自有后端地址和应用凭据，连接后检查可用能力。
      </Figure>
    </> },
    { id: 'draft', title: '只授权这次草稿需要的范围', body: <>
      <ol>
        <li>先打开主持人视图和目标工程。在「AI → 场景草稿」确认后端支持当前工程协议。做小改动时，可先在画布选公开物件，例如驿站的圆桌，再点「使用画布选中对象」。</li>
        <li>在授权范围只勾选需要的操作，例如「移动」与「旋转」。若还要摆新物件，明确选素材和放置表面。要求可写「把圆桌向东小幅移动，保留两扇门口通行。」</li>
        <li>检查本次发送内容和预算，确认元数据与公开内容授权后，点「创建独立草稿任务」。后端支持视觉复核时，可另行授权本次实际玩家画面。进行中可从任务卡查看实际进度和已用额度。</li>
        <li>完成后在草稿里看实际画面、对象 ID、完整差异和支撑变化。核对门、通路和玩家可见性，确认后勾选「已检查范围和差异，采用前创建保护快照」，再点「保护当前并一次采用 AI 草稿」。</li>
        <li>工程已有新修订时，以当前场景重新建草稿。需要先保留合法候选，可下载完整草稿备份。若有效结果与目标不符，可「暂不采用此草稿」，回到手工调整。</li>
      </ol>
      <Check>采用后的改动能在工作台选中并继续编辑。切换玩家视图，确认玩家能看到的物件与预期一致。</Check>
    </> },
    { id: 'cli', title: '用地图 CLI 生成林中建筑候选', body: <>
      <p>以下命令在 Sceneweave 源码目录运行。先运行 <code>npm ci</code> 和 <code>npx playwright install chromium</code>。用工作流目录查看当前支持的入口、字段和输出。</p>
      <pre>{`node tools/harness/sceneweave.mjs workflows
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building --step generate
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building --schema
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building --effects`}</pre>
      <ol>
        <li>按 <code>parameters</code> 步骤查看字段。先执行 <code>node tools/harness/sceneweave.mjs example</code>，保存输出的 JSON，再修改用途、房间等实际支持的参数。也可用 <code>capabilities</code> 查看支持范围。</li>
        <li>按 <code>generate</code> 步骤执行。把命令中的路径换成你的绝对路径，输出目录需尚不存在，且上一级目录已存在。</li>
      </ol>
      <pre>{`node tools/harness/sceneweave.mjs generate --input "/absolute/request.json" --output "/absolute/new-map" --allow forest-building --budget standard`}</pre>
      <ol start={3}>
        <li>按 <code>review</code> 核对 <code>result.json</code> 的状态、诊断和缺项，打开 <code>preview.png</code> 查看房间、路线和入口。</li>
        <li>按 <code>deliver</code> 检查 <code>status: complete</code>，再用首页「打开工程文件」导入输出的 <code>map.sceneweave</code>。重新打开后继续编辑，并按需要导出。</li>
      </ol>
    </> },
    { id: 'mcp', title: '用图片 MCP 继续外部拆解任务', body: <>
      <p>有图像查看能力和本机 MCP 工具的外部助手，可以按<LessonLink chapter="images">标定、拆件与补底</LessonLink>的同一流程接续。配置图片服务时使用实际原图、许可、署名和输出目录。</p>
      <pre>{`node tools/image-import/server.mjs --image "/absolute/map.jpg" --license-file "/absolute/license.txt" --attribution "实际作者与来源" --output "/absolute/existing-output"`}</pre>
      <ol>
        <li>用实际宿主的 <code>tools/list</code> 核对工具。读 <code>sceneweave_workflow</code> 的 <code>sceneweave-image-items</code> 工作流和 <code>image_import_workflow</code> 的当前状态，再查看输入字段和授权范围。</li>
        <li>每次修改带最新 <code>generation</code>。用真实裁片预览核边缘、透明度和补底，记录未解决的部位。若状态过期，重新读取后按最新结果继续。</li>
        <li>换环境时带上实际制作工作包和它的 <code>.workflow.json</code> 伴随文件。用宿主支持的接续入口核对进度后继续。要在页面编辑已经完成的地图，打开输出的完整工程。</li>
      </ol>
    </> },
  ],
}
