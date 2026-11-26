# 测试导航

按能力选择已有测试，不再在本页追加完成次数或逐次证据。执行规则及核心页面旅程见[检查方法](../docs/testing.md)，实际测试名和本机输入条件以用例源码为准。

## 常用命令

```sh
npm test
npm run ai:test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:e2e:production
```

定向运行使用`npx vitest run <文件>`、`npm run test:e2e -- tests/<文件>.spec.ts`或`npm run test:e2e:production -- tests/<文件>.spec.ts`。生产回归先运行`npm run build`，该入口会启动生产预览。两个入口都支持通过`SCENEWEAVE_TEST_BASE_URL`指定已启动的对应服务。系统浏览器用`SCENEWEAVE_BROWSER_CHANNEL=chrome`或`msedge`，默认使用Playwright Chromium。

## 按能力定位

| 要检查的能力 | 入口 |
|---|---|
| 编辑→保存→重开→PNG | 生产配置中的[complete-journey-ux.spec.ts](complete-journey-ux.spec.ts)和[core-convergence-journey.spec.ts](core-convergence-journey.spec.ts) |
| 完整工程、历史、冲突、失败保全 | `complete-project-*.spec.ts`、`backup-delivery-ux.spec.ts`；`src/platform/browser/storage`及`src/shared/project`相关单测 |
| 导航、键盘、窄屏和导出菜单 | `workspace-*.spec.ts`、`keyboard-narrow-acceptance.spec.ts`、`clipboard-ux.spec.ts` |
| 玩家保密和实际PNG | `fixed-sample-privacy*.spec.ts`、`prop-contact-privacy.spec.ts`、`src/shared/projection`相关单测 |
| 建筑、门墙、通路 | `building-*.spec.ts`、`path-checks.spec.ts`和共享geometry/commands单测 |
| 地形、连接和山路 | `terrain-*.spec.ts`、`staircase-tools.spec.ts`和共享terrain/terrain-inlay/stairs单测 |
| 海洋与多层船图 | `ocean-*.spec.ts`；跨浏览器专项配置为[ocean-acceptance.config.ts](ocean-acceptance.config.ts) |
| 家具、模板、素材库 | `room-furnishing.spec.ts`、`scene-template*.spec.ts`、`asset-expansion.spec.ts` |
| 图片拆解、修补和增强 | `image-*.spec.ts`、`asset-refinement.spec.ts`及共享image-import/asset-refinement单测 |
| 共享工作流、林中建筑有限循环 | `shared-workflow.spec.ts`、`forest-loop.spec.ts`、`src/shared/ai/workflows/catalog.test.ts` |
| AI服务与客户端 | `npm run ai:test`及browser AI相关单测；默认受控响应不调用真实付费模型 |

## 专项和本机输入

部分历史、CAS、真实作品、秘密配对及多seed地形用例依赖显式环境变量和本机完整包。默认配置排除或未给输入时跳过；需要执行时先读对应文件和配置。不能把发现的用例数、skip或只加载成功写成通过。

生产回归在设置`SCENEWEAVE_DETAIL_ARTIFACT`后可运行`detail-floor-privacy-acceptance.spec.ts`，设置`SCENEWEAVE_NOTE_PRIVACY_INPUTS`后可运行`note-privacy-notice.spec.ts`。布置及加载相关生产回归也可通过同一入口按文件选择。混合文件中专查生产构建的用例使用`@production`标记。

测试使用当前完整工程 v1 夹具。保留严格几何拒绝例和真实资源校验。

保存、受众、渲染或共同算法变更按影响选择复验。性能另用正常构建和[性能工具](../tools/performance/README.md)串行测量；其他会话正在测量时不要并行启动构建或浏览器检查。

截图、下载包和trace留测试输出或忽略的`work/`。功能说明写[已完成功能](../docs/completed.md)，剩余缺口写[roadmap](../docs/roadmap.md)，不恢复历史台账。
