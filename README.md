# 织境 · Sceneweave

**把故事画成可以探索的地方。**

Sceneweave 是面向桌面角色扮演的二维场景地图编辑器，用同一工程保存可编辑的建筑、室外地形、素材、图层和历史，支持 CoC、D&D 与匕首之心场景制作及 PNG 导出。

[在线预览](https://wojisama.github.io/sceneweave/)由[GitHub Pages工作流](https://github.com/WoJiSama/sceneweave/actions/workflows/deploy.yml)更新。工程保存在当前站点的浏览器 IndexedDB；站点发布不提供工程云同步。请定期导出 `.sceneweave` 备份。

## 当前能力与边界

- 统一工作区支持建筑、室外、组合、图层、非破坏性外观、命名快照与有限局部恢复。
- 接收新标识完整 v1/v2/v3 工程；旧整页工作台和旧格式产品入口已退役，旧用户数据不删除。
- 自然地形支持多地貌固定种子候选、有限笔刷、局部重生成及区域地图/独立下钻；实际支持范围和拒绝边界见[地形设计](docs/55-terrain-generation-design.md)。
- AI 为可选能力：流式对话、受限工具、隔离草稿、SVG/本地PNG，以及保护后一次采用。手工编辑不依赖模型在线。
- 完整Q4、视觉回读、用户P3和整体性能门仍待验收；具体状态只在[路线图](docs/07-roadmap.md)和相应历史台账维护，技术通过不代表美术签收。

当前顺序：**基础修复与必要验证 → T8–T12开发 → T13冻结与技术回归 → M2-E完整AI、视觉及交付验收 → M3**。开发期只做相关测试与少量样图；最终从[统一验收入口](docs/55-terrain-generation-design.md#terrain-acceptance)执行。

## 本地运行

建议使用 Node.js 24 LTS（`.nvmrc` 为 24.14.1），依赖由 `package-lock.json` 锁定。

```sh
npm ci
npm run dev
```

打开终端显示的地址，默认 [http://127.0.0.1:5173](http://127.0.0.1:5173)。更换端口、浏览器或清除站点数据不会自动迁移工程。

从首页新建场景、打开样板或导入完整工程；在工作区放置/编辑、预览并采用候选，再保存或导出。新建与切换失败、取消时保留当前内容。完整操作合同见[交互与架构参考](docs/reference/editor-and-architecture.md#doc-02)。

AI后端地址可使用 `https://124.223.95.142`。维护者应用凭据来自被Git忽略的本机配置，填入连接框后仅保留在页面内存；供应商密钥只放服务端。服务启动、配置和部署方法见[贡献说明](CONTRIBUTING.md#m2-1本地任务服务)。本文不核验线上部署版本或证书当前状态。

## 开发与验证

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

日常只运行受改动影响的检查；完整回归和正式性能按当前阶段安排。命令与环境见[贡献说明](CONTRIBUTING.md)，用例入口见[测试说明](tests/README.md)，验收口径见[质量计划](docs/09-quality-plan.md)。正式性能须冻结输入并独占串行运行。

## 文档与许可

从[文档导航](docs/README.md)开始；需求、数据、AI、存储、路线和质量各保留一个主定义。固定场景、技术参考与历史证据分开收纳，旧编号可在[历史索引](docs/archive/README.md)追溯。

原创代码与文档采用 [MIT License](LICENSE)。素材、规则、参考项目和依赖各自遵守其许可，见[许可边界](docs/10-rules-assets-and-licensing.md)。本仓库不包含官方规则书或参考仓库源码。
