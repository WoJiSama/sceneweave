import type { WorkflowCapability, WorkflowHost, WorkflowRequirement } from './catalog.js'

const page = (entry: string, reason: string): WorkflowCapability => ({ state: 'page-only', entry, reason })
const available = (entry: string, toolNames?: string[]): WorkflowCapability => ({ state: 'available', entry, reason: '当前宿主提供此入口；执行仍按实际输入、授权及预算检查。', ...(toolNames ? { toolNames } : {}) })

/** Page operations remain user actions. A connected chat cannot inherit them. */
export function pageWorkflowHost(): WorkflowHost {
  return { name: 'page', tools: [], capabilities: {
    'map-discovery': page('外部助手调用资料', '本机 CLI 或 MCP 可以调用通用制图入口。'),
    'map-generate': page('生成 → 预览', '页面使用现有生成和绘制工具；外部调用通过本机 harness。'),
    'map-inspect': page('选择并查看场景对象', '页面通过画布与详情检查候选。'),
    'map-edit': page('打开工程文件 → 编辑', '在页面审阅工程副本后可继续编辑。'),
    'map-verify': page('打开工程文件 → 导入核对', '本机制图工具可独立复核保存的候选及预览。'),
    'forest-parameters': available('生成 → 混合场景 → 林中建筑'),
    'forest-generation': available('混合场景 → 预览'), 'project-preview': available('混合场景候选预览'),
    'project-delivery': available('保存为新工程 → 保存/导出 → 重开'),
    'draft-read': page('选择对象/图层并查看详情', '手工查看可用；AI草稿须另外连接并授权。'),
    'draft-edit': page('AI → 场景草稿授权', 'AI编辑须先建立真实有限授权；手工编辑可直接使用现有工具。'),
    'draft-check': page('草稿检查与差异审阅', '以实际候选检查为准。'),
    'page-adopt': available('候选审阅 → 采用/保存新副本'),
    'image-read': available('素材 → 图片拆解'), 'image-select': available('图片拆解 → 辅助选区/切割'),
    'image-preview': available('图片/素材预览 → 黑白棋盘与移转审阅'), 'image-build': available('图片拆解 → 制作工作包/完整工程候选'),
    'image-repair': available('图片拆解 → 移除范围与底材'),
    'image-repair-analysis': available('图片拆解 → 补底分析'),
    'image-surface-refine': available('图片拆解 → 地面外观细修'),
    'asset-refine': available('素材 → 编辑素材副本 → 图像处理'),
    'ocean-generation': available('生成 → 自然地形 → 岩岛/海岸 → 添加静态海面与布景 → 预览'),
    'floor-navigation': available('场景 → 楼层入口与定位；楼层管理创建普通Floor'),
  } }
}

export function harnessWorkflowHost(): WorkflowHost {
  return { name: 'harness', tools: [], capabilities: {
    'map-discovery': available('sceneweave.mjs map capabilities / map example / map schema'),
    'map-generate': available('sceneweave.mjs map generate'),
    'map-inspect': available('sceneweave.mjs map inspect'),
    'map-edit': available('sceneweave.mjs map edit'),
    'map-verify': available('sceneweave.mjs map verify'),
    'forest-parameters': available('sceneweave.mjs example / capabilities'),
    'forest-generation': available('sceneweave.mjs generate --input ABS_JSON --output NEW_ABS_DIR --allow forest-building --budget small|standard|expanded'),
    'project-preview': available('生成输出 preview.png；视觉读取由外部助手实际能力决定'),
    'project-delivery': available('result.json complete / map.sceneweave；页面导入续编'),
    'page-adopt': page('普通页面导入并审阅', 'CLI只交付独立工程，不写用户浏览器数据库。'),
    'ocean-generation': page('生成 → 自然地形 → 海洋选项', '当前CLI没有海洋生成执行命令，请使用页面。'),
    'floor-navigation': page('场景 → 楼层入口与定位', '楼层入口在页面编辑，当前CLI没有对应执行命令。'),
    'image-read': { state: 'not-connected', entry: 'tools/image-import/server.mjs', reason: '地图CLI未加载图片源；请显式启动图片MCP宿主。' },
  } }
}

export function mapMcpWorkflowHost(tools: WorkflowHost['tools']): WorkflowHost {
  const names = new Set(tools.map(tool => tool.name))
  const entries = {
    'map-discovery': 'sceneweave_map_example', 'map-generate': 'sceneweave_map_generate',
    'map-inspect': 'sceneweave_map_inspect', 'map-edit': 'sceneweave_map_edit', 'map-verify': 'sceneweave_map_verify',
    'project-preview': 'sceneweave_map_preview', 'project-delivery': 'sceneweave_map_generate',
  } as const
  const capabilities: WorkflowHost['capabilities'] = { 'page-adopt': page('普通页面导入并审阅', 'MCP 交付独立工程。') }
  for (const [requirement, tool] of Object.entries(entries) as Array<[keyof typeof entries, string]>) {
    if (names.has(tool)) capabilities[requirement] = available(tool, [tool])
  }
  return { name: 'map-mcp', tools, capabilities }
}

const requirementsWithImageItem = new Set<WorkflowRequirement>([
  'image-preview', 'image-repair', 'image-repair-analysis', 'image-surface-refine', 'asset-refine',
])

/** Only tools actually exposed by this session can satisfy a tool requirement. */
export function toolWorkflowHost(name: 'conversation' | 'authoring' | 'image-mcp', tools: WorkflowHost['tools'],
  options: { remainingToolCalls?: number; progress?: WorkflowHost['progress']; hasImageItems?: boolean } = {}): WorkflowHost {
  const names = new Set(tools.map(tool => tool.name))
  const capabilities: WorkflowHost['capabilities'] = {
    'forest-parameters': page('生成 → 混合场景参数表单', '本任务只可指导或填写获准参数；生成由用户在页面触发。'),
    'forest-generation': page('混合场景 → 预览', '当前模型任务未开放语义生成执行工具。'),
    'project-preview': page('候选预览与公开画面授权', '以页面当前候选及本次真实图片授权为准。'),
    'project-delivery': page('页面保存/导出', '最终保存与采用仍由原页面/CLI入口负责。'),
    'page-adopt': page('候选审阅 → 保护采用/保存新副本', '模型不直接写主工程或替用户签收。'),
    'ocean-generation': page('生成 → 自然地形 → 海洋选项', '当前模型工具没有海洋生成执行权；由用户在页面预览。'),
    'floor-navigation': page('场景 → 楼层入口与定位', '当前模型工具没有跨层入口执行命令；由用户在页面操作。'),
  }
  const requirements: Partial<Record<WorkflowRequirement, string[]>> = {
    'draft-read': ['sceneweave_read_scene'], 'draft-edit': ['sceneweave_edit_scene', 'sceneweave_edit_props', 'sceneweave_apply_stage', 'sceneweave_apply_visual_correction'],
    'draft-check': ['sceneweave_check_draft', 'sceneweave_visual_review'], 'image-read': ['image_import_workflow'],
    'image-select': ['image_import_extract_item', 'image_import_set_selection'],
    'image-preview': ['image_import_item_preview'], 'image-build': ['image_import_build_project', 'image_import_export_work'],
    'image-repair': ['image_import_set_repair_scope', 'image_import_set_surfaces'],
    'image-repair-analysis': ['image_import_analyze_repair'],
    'image-surface-refine': ['image_import_surface_candidate', 'image_import_set_surface_refinement'],
    'asset-refine': ['image_import_enhancement_candidates', 'image_import_subject_candidates', 'image_import_matte_candidates'],
  }
  for (const [requirement, alternatives] of Object.entries(requirements) as Array<[WorkflowRequirement, string[]]>) {
    const found = alternatives.filter(tool => names.has(tool))
    capabilities[requirement] = found.length ? options.remainingToolCalls !== undefined && options.remainingToolCalls <= 0
      ? { state: 'budget-exhausted', entry: found.join(' / '), reason: '本任务工具预算已耗尽；保留已有结果，不自动创建新任务。', toolNames: found }
      : options.hasImageItems === false && requirementsWithImageItem.has(requirement)
        ? { state: 'missing-input', entry: found.join(' / '), reason: '当前还没有已拆物件；先检查原图并建立有效item，再预览或优化。', toolNames: found }
        : available(found.join(' / '), found)
      : { state: 'not-connected', entry: name === 'conversation' ? '页面相应制作入口或另行授权的工具宿主' : '', reason: '本次真实工具目录未开放此操作。' }
  }
  return { name, capabilities, tools, ...(options.progress ? { progress: options.progress } : {}) }
}
