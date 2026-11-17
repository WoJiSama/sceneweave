# 检查方法

按本次能力和改动选择检查，结果直接说明通过、失败或未运行。记录命令、实际结果和必要环境即可；只有性能、模型或外部软件兼容需要额外注明负载/输入、设备、版本和方法。不再要求每次建立编号报告、复制源码快照或回填多份台账。

<a id="core-journey"></a>
## 编辑、保存、重开与PNG

使用现有[完整页面旅程](../tests/complete-journey-ux.spec.ts)，覆盖桌面和390px页面上的生成、编辑、撤销重做、保存重开、完整备份、空存储导入及双受众4K PNG。用普通生产构建执行，测试创建独立浏览器存储，不读写用户个人库。

1. `npm run build`，再用`npm run preview -- --port 4173 --strictPort`启动同版产物。
2. PowerShell中设置`$env:SCENEWEAVE_TEST_BASE_URL='http://127.0.0.1:4173/sceneweave/'`。
3. 运行`npx playwright test tests/complete-journey-ux.spec.ts --workers=1 --retries=0`。
4. 查看实际下载的完整工程、重开结果和PNG。若失败，修复相关原因并重跑受影响用例，保留失败输出用于定位。

通过条件：编辑实际生效；撤销重做正确；重开后的完整内容与资源保持；备份导入可继续编辑；PNG尺寸正确、能够解码。上述旅程并不穷举秘密几何；涉及受众或渲染修改时，另运行对应保密像素用例。当前文档整理没有重新执行这条完整旅程。

<a id="checks"></a>
## 按改动选择

| 改动 | 检查入口 |
|---|---|
| 纯逻辑/领域命令 | `npx vitest run <相关文件>` |
| 共享边界 | `npm run check:architecture`、`npm run check:shared` |
| 类型或生产接线 | `npm run typecheck`、`npm run build` |
| 页面操作 | `npx playwright test tests/<相关文件>.spec.ts` |
| 工作流正文/元数据 | `npm run workflows:sync`、`npm run check:workflows`，以及`src/shared/ai/workflows/catalog.test.ts` |
| AI服务 | `npm run ai:test -- <相关文件>`；受控响应与真实付费模型分开 |
| 全量回归 | `npm test`、`npm run ai:test`、`npm run test:e2e`；在整合或发布需要时执行 |

默认Playwright配置启动开发服务；设置`SCENEWEAVE_TEST_BASE_URL`后使用指定服务。系统Chrome/Edge可用`SCENEWEAVE_BROWSER_CHANNEL`选择。依赖本机作品或环境变量的专项未提供输入时保持未运行，不算通过；具体条件见相应用例和[测试导航](../tests/README.md)。

保存/历史/导入改动需检查完整往返、坏资源拒绝、取消/配额保全及CAS冲突；渲染/秘密改动需检查GM和player实际像素、隐藏几何变形及文件元数据。不能通过删断言、丢资源或缩小原目标把失败改为成功。

<a id="performance"></a>
## 性能

先复现有体感的问题并定位瓶颈，再选择现有运行器。生产测量独占串行，使用相同输入/操作和正常构建，记录设备、浏览器、对象/资源负载、样本数、p50/p95/max及缺样。诊断插桩、低样本观察和跨机器数字分别说明，不混成正式分布。

500物件交互目标仍为帧p95≤33ms、领域提交p95≤100ms；2000物件作为压力评估，保存与导出耗时另列。Windows Working Set/私有提交与macOS RSS分开，未测峰值不能由单点heap或理论分配替代。当前整体性能仍有未解决项，见[剩余事项](roadmap.md#remaining)。

具体工具只在[性能工具说明](../tools/performance/README.md)维护。其他会话正在测量时，不并行运行构建、浏览器测试或新的性能任务。

<a id="external"></a>
## 真实效果与发布

- UVTT兼容以明确版本的目标软件和导入器实际导入为准，检查比例、墙门、秘密、灯光和玩家视角。
- AI收益比较相同需求的完整交付、人工修正、缺项和实际用量；mock、工具成功或回复速度不能代替。
- 视觉检查实际全景和关键近景。用户美术签收由用户完成，自动化和代理看图分别说明。
- 能力可以按明确范围独立交付。提交、推送、部署与公开发布按当前授权执行；历史授权不延续。

测试截图、下载包、trace及诊断输出放被忽略的`work/`或测试输出目录。可复现夹具和回归测试留在仓库；完成后的临时流水无需再写进文档。
