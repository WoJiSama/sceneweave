# 墨绘原野 · 室外原创候选

这是 Sceneweave VIS-02「双层岩岛」的6种材质与7类组件，目录包为 `sceneweave-handdrawn-outdoor@1`，工程中的主题仍为 `sceneweave-handdrawn@1`。状态为 **O / P2 待验收**，没有完成用户美术签收、完整主题P3或真实性能验收。

SVG由Sceneweave contributors以Codex辅助原创编写，没有描摹或嵌入参考截图、第三方图包、字体或商业规则内容，没有调用图像生成服务。保留可编辑SVG、栅格化工具、13张PNG、逐项真实hash/字节/像素/物理映射与[MIT原文](LICENSE.txt)。来源和实际属性以[manifest](manifest.json)为准。

在仓库根目录运行 `node tools/build-island-art.mjs`，使用项目已有Playwright与已安装Chrome在sRGB Canvas绘制SVG，然后写入仅IHDR/sRGB/IDAT/IEND块的确定PNG。PNG透明像素的RGB清零，组件边缘至少8源像素透明留白；投射阴影由场景主题绘制。Chrome版本可能影响抗锯齿字节，重新构建需复核manifest及美术表现。

源文件与静态分发目录 `public/assets/sceneweave-handdrawn-outdoor/` 对应。工程采纳实际字节、固定版本定义、完整实例与许可绑定，重开不依赖素材网络，也不根据seed重新撒物件。完整规格见[制作清单](../../docs/14-visual-and-assets.md#doc-15)，本批结果及边界见[B3验证](../../docs/archive/m0-m1-validation.md#doc-19)。B2室内素材保持独立。
