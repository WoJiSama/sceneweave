# M1-C / C1b：框选、多选与上下文菜单验证

日期：2026-10-21。应用版本：`0.2.0-m1-c1b`。本批按用户“做c1b”授权实现；本地源码未提交，Git历史基线仍为`62ba55b`。本页记录本批实际能力和适用验证，不覆写[23](23-m1c-c1a-validation.md)或更早证据。

## 1. 实际实现

- 选择集合只保留在编辑会话中，不写入SceneDocument、revision、历史或PNG。点击替换、Shift增加、Option/Alt减去；工具栏提供对应按钮、包含/相交开关和全选。对象树也支持Shift/Alt点击或Enter增减选。框选在松开指针时才采用，Escape、失焦、失去捕获和取消事件保留原选择，平移与待放置互斥。
- 命中使用逆视口变换后的毫米坐标。物件按旋转后实际图像矩形选择，阴影和物理占地不扩大命中；结构使用实际墙体多边形、地面轮廓和编辑控制点。默认完整包含，切换后任何实际轮廓接触也相交；拖动方向不改变规则。
- 组合默认是一个选择单元，使用真实成员轮廓并集，组合包围盒中的空隙不算成员。工具栏成员开关、双击和树中成员入口可进入成员选择，显式选择组与子项时去重。散布成员仍独立选择，继承容器编辑锁；没有把散布整体当作普通物件变换。
- 框选和全选排除有效锁定单元并显示数量，点击和树仍能查看锁定项。锁判断复用领域命令影响集；最终命令仍执行自身依赖/锁和全图校验。`hiddenIds`为纯选择函数的暂态过滤接口，本批没有用户图层或隐藏管理UI，相关C1c验收保持开放。
- 多选面板显示对象数量、类型、共同/混合旋转与可见范围及有效锁数。物件/组合可统一平移、围绕共同图像范围中心旋转；复制和删除支持已开放的物件类型。移动/旋转/复制/删除先显示候选，取消不写入，采用使用一个`workspace.execute`和一次撤销；负角度与跨360度归一化，位置以整数毫米提交。
- 复制通过有限`copyProp`克隆实例当前外观、固定定义、物理占地、支撑/房间归属、阴影等字段，生成未占用ID并在相同绘制带置顶；固化源的有效私密受众。组合/散布成员须先明确拆开/退出后才可复制，避免脱组丢失关系。新关系继续检查支撑和房间锁；资源不重置为目录默认。
- 混合不支持类型、编辑锁、锚点注记、非法边界或引用导致整批拒绝，不跳过失败项。保留现有每事务最多256条命令限制；500/2000件场景可选择，但超过上限的批量操作明确禁用，不拆成多次保存。整组变换仍遵守既有有限组合命令。
- 对象、多选、空白菜单区分目标；右键最上层未选对象替换，右键已选对象保留多选，重叠列表可选被遮挡项，空白保留原选择。菜单打开不修改工程，支持动作显示真实禁用原因。复制/删除/锁入口与面板复用同一命令构建及Workspace事务路径。
- 空白放置捕获菜单打开时的世界位置，选现有素材后进入C1a真实位图待放置流程，再采用。菜单键、Shift+F10、更多操作、方向键/Enter、含素材选择器的Tab路径与Escape焦点返回提供等价入口。输入框的原生右键继续保留；全局快捷键忽略输入、IME及打开的应用菜单。

## 2. 验证方法与结果

使用Node.js24.14.1/npm11.11.0、Apple M1 / MacBookPro17,1 / 16GiB、Darwin25.6.0和系统Chrome；浏览器独立上下文，1512×982窗口。Node资源测试的既有原生解码替身边界保留，真实资源、依赖与图像解码由浏览器补充。

| 检查 | 实际结果 | 范围与证据 |
|---|---|---|
| 全部单元 | 34文件、432项通过 | [单元汇总](evidence/m1-c1b/unit-results.json)；选择几何、锁/成员、复制、量化、原子事务等新增负例及既有回归 |
| `npm run build` | 通过，含TypeScript与生产打包 | [构建日志](evidence/m1-c1b/build.log)；保留Zod注释和应用chunk超过500kB警告，不当作性能结论 |
| C1b真实浏览器专项 | 11项通过、正常退出，59.5s | [逐项结果](evidence/m1-c1b/browser-focused-results.json)、[命令/附件hash](evidence/m1-c1b/browser-focused-summary.json)；7项功能和4组真实素材负载 |
| 完整浏览器回归及定向复验 | 85个独立用例均有通过记录 | [通过证据并集](evidence/m1-c1b/browser-verified-results.json)；全量84通过/1失败，修复旧测试等待后该1项正常通过；各命令退出状态分开保留，不写成单轮85/85成功 |
| 正常生产构建UI | 通过 | [生产记录](evidence/m1-c1b/production-verified/production-smoke.json)：3件物件/18定义，r3取消不写入，批量采用至r4；完整包179020bytes，刷新保留r4，选择未持久化，无pageerror，DEV/性能API均不存在 |
| 生产界面视检 | 本窗口检查通过 | [多选面板](evidence/m1-c1b/production-verified/production-multiselect.png)、[批量候选](evidence/m1-c1b/production-verified/production-batch-preview.png)、[菜单及焦点](evidence/m1-c1b/production-verified/production-context-menu.png)；1512×982，不外推其他窗口/触屏 |

专项覆盖真实25%/适应全图/800%及平移后的框选，45°物件的实际轮廓、包含/相交、Shift/Alt和按钮增减、全选与对象树键盘、Escape后延迟松手、失焦/失捕获、中键/空格平移互斥、批量移动/旋转/复制/删除的预览/取消/单调撤销、非法末项目/边界整批拒绝、锁排除及显式查看、右键保留/替换/重叠候选、捕获空白世界位置、键盘素材选择路径、原生输入菜单及玩家禁用编辑、真实组与成员及结构混选禁用。直接附件见[变换选择](evidence/m1-c1b/browser-focused/c1b-transformed-selection.json)、[原子批次](evidence/m1-c1b/browser-focused/c1b-atomic-batches.json)、[拒绝及锁](evidence/m1-c1b/browser-focused/c1b-rejection-and-locks.json)、[上下文点位](evidence/m1-c1b/browser-focused/c1b-context-selection.json)、[键盘菜单](evidence/m1-c1b/browser-focused/c1b-keyboard-menu.json)和[组合/结构](evidence/m1-c1b/browser-focused/c1b-groups-and-structures.json)。

完整回归及定向复验覆盖85个独立用例，包含原74项和新增11项；没有以提前终止或报告服务退出码130代替正常命令成功。最终链接/锚点、表格、需求映射、源码指纹与历史保护检查见[机械检查](evidence/m1-c1b/document-checks.json)。环境与命令逐项见[运行记录](evidence/m1-c1b/verification-environment.json)，[源码指纹](evidence/m1-c1b/source-fingerprints.json)保留本批可复核状态。生产UI复现：先`npm run build`并另启`npm run preview -- --port 4173 --strictPort`，运行`node docs/evidence/m1-c1b/production-smoke.mjs`；默认输出到带时间戳的忽略目录，可用`SCENEWEAVE_C1B_EVIDENCE_DIR`指定新的证据位置，不覆盖历史批次。

## 3. 修复与非成功执行

审查阶段修复了批量复制按顶层优先生成导致副本叠放反转、负转与跨360归一、共同旋转半毫米浮点稳定量化、父容器锁与锚注记锁的提示区分，以及墙/门窗/连接选择顺序与实际GM渲染不一致。选择与命令复用核心量化/锁影响集和既有墙排序；新增顺序扰动与原子负例。取消手势改为抑制这一次松手产生的click，下一次指针按下恢复；未越过阈值的普通单击仍正常选择。

浏览器首轮前4项通过，第5项断言用请求的理想浮点鼠标位置，而真实contextmenu事件屏幕坐标经过整数化；测试改为捕获可信事件后独立反算。该轮trace/worker清理挂起，只中断本轮拥有的进程，退出130；不是一次成功命令。[首轮记录及现场](evidence/m1-c1b/previous-attempts/coordinate-expectation/run-summary.json)保留4通过、1失败、1中断、5未运行。

第二轮前5项通过，第6项玩家预览正确拒绝未被固定遮罩覆盖的GM物件：夹具漏配遮罩，产品隐私检查保持原样；补覆盖实际图像及阴影的固定mask。该轮失败清理再次挂起，终止本轮拥有的worker后退出130，reporter仅提交5通过/6未报告完成；不把未完成项记通过或已定稿失败。[第二轮记录及现场](evidence/m1-c1b/previous-attempts/private-mask-fixture/run-summary.json)保留安全拒绝说明。后续关闭trace采集，保留真实截图与JSON，最终11项正常退出通过。源码未为测试降低隐私或事务检查。

全量真实Chrome执行85项，84通过，唯一失败来自既有C0取消结构候选后的立即视口断言：输入已恢复，但ResizeObserver调度的rAF尚未把平移像素从候选视口的`-36.024844720496894`还原为原值`-40`。仅在该旧测试取消后补与候选打开时相同的双rAF等待，保持原数值和精度，不修改产品逻辑或放宽容差；该1项定向复验正常退出通过，10.3s。[全量原结果](evidence/m1-c1b/browser-full-initial-results.json)、[现场](evidence/m1-c1b/previous-attempts/c0-cancel-resize/run-summary.json)及[定向通过](evidence/m1-c1b/c0-resize-recheck-results.json)分别保留。全量失败后HTML reporter自动开启报告服务，结束本轮拥有的报告服务后退出130，不记命令成功。随后额外运行C0整文件，6项均报告通过，但Chrome退出后worker收尾挂起，终止本轮runner后退出130；[额外结果](evidence/m1-c1b/c0-file-recheck-results.json)单列，不记成功命令、不据此重复扩大全量。[全部浏览器命令摘要](evidence/m1-c1b/browser-verification-summary.json)保留每轮退出状态；唯一原失败项另有上述正常退出的独立通过记录。

生产视检后只把多选面板的可见范围值翻译为“公开/仅主持人”；再次构建及生产UI通过，随后全量回归针对这一最终呈现运行。

## 4. 实际选择负载与剩余性能问题

专项复用B5正式归档的四份完整工程，执行成员模式下从画布内侧100mm到对角内侧100mm的真实框选，再恢复单件选择。每组只有一次被记录的框选；9个可信输入（8次pointermove及pointerdown）和指针松开后的双rAF用于浏览器调度观察，窗口含人为拖动过程。它不是命中/面板/绘制的分别计时，不是物理显示或GPU完成测量，也没有足够样本推算p95。

| 样板 / 实际物件 | 实际选中物件 / 含结构总数 | 框选前后底图绘制次数 | pointerdown至松开后双rAF | 本手势最大rAF间隔 |
|---|---|---|---|---|
| 书房500 | 500 / 519 | 1 / 1 | 280.6ms | 116.7ms |
| 书房2000 | 2000 / 2019 | 1 / 1 | 448.8ms | 283.4ms |
| 岩岛500 | 500 / 531 | 1 / 1 | 269.5ms | 116.7ms |
| 岩岛2000 | 2000 / 2031 | 1 / 1 | 502.0ms | 350.1ms |

四组均保持文档、历史及仓库存档不变，超过256条命令的操作显示禁用原因，没有自动拆批。[汇总](evidence/m1-c1b/selection-load-summary.json)及[书房500](evidence/m1-c1b/browser-focused/c1b-study-500-selection.json)、[书房2000](evidence/m1-c1b/browser-focused/c1b-study-2000-selection.json)、[岩岛500](evidence/m1-c1b/browser-focused/c1b-island-500-selection.json)、[岩岛2000](evidence/m1-c1b/browser-focused/c1b-island-2000-selection.json)含实际素材/唯一像素量、成员、稳定ID和原始帧间隔。

本次已观察到大量对象一次选中后的明显调度间隔，500物件也有116.7ms单帧间隔，不能宣称普通编辑100ms p95或完整交互性能通过。后续先拆分选择集合、覆盖层、面板和对象树更新成本再优化，保持真实几何、锁/隐藏过滤及不重绘底图的正确性；C1c扩大到图层选择时复用相同四组回归，并补连续样本和各子区间。浏览器/GPU资源峰值未在本批重测。

## 5. 结论边界

C1b不增加持久字段、格式或资源限额，不引入用户图层、命名快照/局部恢复、通用自由拖动物件、全套绘图或AI。当前编辑锁菜单只开放已有有限类型及prefab容器。建筑/地形多选变换、整组复制/删除等未支持动作禁用并说明原因，专用属性工具仍保留。

用户图层及隐藏/当前图层范围由C1c处理，命名快照与独立物件局部恢复由C1d处理；主题P3、完整SCN-01至04、跨浏览器、中文输入法真实人工检查、小团验收及全交互性能仍待完成。真实指针负载回归与调度观察不替代B5/C0正式采样，也不关闭完整QA-PERF-04。
