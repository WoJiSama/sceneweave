/** Provider-neutral instructions served with the actual tool schema and task state. */
export const IMAGE_ITEM_WORKFLOW = Object.freeze({
  id: 'sceneweave-image-items', version: 1,
  instructions: [
    '从获准地图制作可独立编辑的item。先读取image_import_workflow与inspect，核对原图摘要、范围、暂定比例、当前代次和下一步；每次修改使用最新generation。',
    '先区分三种范围：room定义房间地面；sourceBoundary保全原画墙沿和所有家具最外沿，未设置时仅用room；每件guide.boundaryPx只限制分割搜索，不能替代前两者。完成标定和两种房间范围后先assess_fidelity预检。',
    '明确家具、地毯、阴影、环境角色及遮挡顺序。先用粗范围和少量前景/背景笔迹生成局部选区，再用保留/排除笔修正。新任务显式algorithmVersion:2、edgeCoverage:boundary；boundaryPx用少量粗点限制环境线，给描边和叶尖留余量，触边警告须先处理。内部仍由算法找边。保存实际输入，不从最终PNG捏造笔迹。',
    '若本次tools/list包含image_import_local_segment，可显式使用本机语义模型辅助同色描边分离。contextBounds保留房间上下文，targetBounds圈单件并留余量，先给少量正负点；查看全部3个候选的原图/黑白/棋盘边缘，不按最高模型分数自动采用。返回的selectionMask和selectionOrigin一起交给extract_item或set_selection。模型点不等于硬保留画笔，检查正点及细部是否实际保留；局部纠错仍用共同画笔。未启用此能力时不假称已执行模型。',
    '候选主体完整后，少量漏边或带入背景优先用保留/排除画笔修正实际蒙版；模型提示点可能同时改变别处，不能当作硬画笔。先查看局部原图，明确要保留或删除的是物件还是环境，再画一笔并预览。细节辨不清时记录不确定，不靠连续重推模型或扩大预算掩盖。',
    '工具成功不代表视觉通过。用item_preview查看原色裁片的黑/白/棋盘背景及400%边缘；对照原图形状、描边、细枝孔洞，检查蓝毯/地板残留、削边和色边。',
    '预览remaining并移开物件检查露底。跨地毯与木板必须分区取样；不确定与不可见像素注明推断。源像素保真和增强候选分开，插值不恢复缺失细节。',
    'selectionMask只决定裁片。残影另用二值removalMask，必须包含全部选区且不超物件图框外32px；相邻物件用protectionMask，保护区不写入、不作取样或边界依据，不能与选区冲突。set_repair_scope使用最新generation及两范围，null显式清除；独立移除时cleanupPx归零。实际repairMask从item_preview核对。context只处理单一底材，需比移除图框宽高各多4px的干净大取样；完整原尺寸补片加低频颜色衔接仍可能错接板缝，须看图。',
    '切后优化先定位缺陷：二值斜边可试contour减轻部分硬边阶梯，edge只精修已有半透明覆盖，decontaminate只针对有真实邻近清空像素依据的色边；它们不能纠正错选主体。若提供image_import_enhancement_candidates，按target、direction、count生成2或3份只读候选和黑白棋盘预览，逐一与原色裁片比较。零变化不算改善，clarity放大不恢复未知细节。',
    '增强工具不修改原蒙版、复核或保真重建，不自动写场景。候选目录及candidates.json须另行保全，三条目制作包不嵌入派生PNG；实际采用走统一素材编辑页，以确切父源和同配方生成，再经现有保护、预览、一次采用、撤销和冷读链。',
    '复核绑定工具返回的inputHash、itemSha256与backgroundSha256。相关输入变化会使旧复核失效；助手复核不代替用户签收。未通过则记录具体位置与下一操作，继续修正。',
    '每个断点保存独立.sceneweave-image-work工作包，包含原图、未完成选区、笔迹和复核。普通.sceneweave仅保存采用资源，不依赖工作包打开。恢复先全验再切换，失败保留现有结果。',
    '验证新算法的简单辅助能力时，以5类各2次新任务冻结试做：粗范围最多12点、最多2轮纠错且每轮最多4笔；保留失败及超预算。日常任务按实际缺陷修正，不以大量精描或旧成品蒙版冒充简单辅助验证。',
    '严格遵守当前宿主权限；本工作流不授予外发原图、访问任意路径、重新计费或写入当前场景的权限。build_project只生成待审候选。',
  ].join('\n'),
  stages: ['source', 'scope', 'selection', 'edge-review', 'background-review', 'ready', 'adopted'],
})
