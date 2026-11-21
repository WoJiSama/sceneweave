type NextAction = 'revise_arguments' | 'read_current_context' | 'refresh_candidate' | 'request_current_screenshot' | 'reduce_work' | 'stop_step'

const decisions = {
  invalid_arguments: { message: '参数不符合有限工具合同，请检查必填字段、操作类型和整数毫米。', nextAction: 'revise_arguments' },
  invalid_geometry: { message: '步骤未采用，请检查几何、支撑、附着距离与依赖后修正。', nextAction: 'revise_arguments' },
  invalid_svg: { message: 'SVG 不符合受限静态子集，请移除不受支持的内容并修正几何。', nextAction: 'revise_arguments' },
  outside_scope: { message: '对象、支撑、依赖或实际外轮廓超出本次授权范围。请停止这一步。', nextAction: 'stop_step' },
  locked_dependency: { message: '对象、图层或真实依赖已锁定。请保留现有草稿并停止这一步。', nextAction: 'stop_step' },
  restricted_dependency: { message: '候选涉及本次未获授权的依赖。请停止这一步。', nextAction: 'stop_step' },
  private_target: { message: '目标必须是本次授权范围内的公开对象。', nextAction: 'stop_step' },
  operation_budget: { message: '步骤的实际展开超过剩余预算。请缩小改动或在预算耗尽时结束任务。', nextAction: 'reduce_work' },
  tool_output_limit: { message: '工具回执超过上限。请缩小本次请求。', nextAction: 'reduce_work' },
  review_output_limit: { message: '视觉审查回执超过上限。请减少目标或候选操作。', nextAction: 'reduce_work' },
  stale_generation: { message: '草稿版本已变化。请读取当前草稿后再决定下一步。', nextAction: 'read_current_context' },
  stale_candidate: { message: '候选基线已变化。请读取当前草稿后重新准备。', nextAction: 'refresh_candidate' },
  invalid_candidate: { message: '候选凭据与实际候选不符。请重新准备候选。', nextAction: 'refresh_candidate' },
  stale_screenshot: { message: '视觉复核需要重新授权与当前草稿匹配的公开截图。', nextAction: 'request_current_screenshot' },
  unsupported_tool: { message: '本任务未开放此工具。', nextAction: 'stop_step' },
  unsupported_operation: { message: '本任务未开放此操作。', nextAction: 'stop_step' },
  vision_disabled: { message: '本任务尚未启用公开图片复核。', nextAction: 'stop_step' },
  preview_invalid: { message: '视觉修正候选未通过完整账本预演。', nextAction: 'revise_arguments' },
  forest_action_invalid: { message: '动作不符合当前状态。', nextAction: 'revise_arguments' },
  workflow_unavailable: { message: '工作流参数或版本不可用。', nextAction: 'read_current_context' },
} satisfies Record<string, { message: string; nextAction: NextAction }>

export type ToolRejectionCode = keyof typeof decisions

export class ToolRejected extends Error {
  constructor(readonly code: ToolRejectionCode) {
    super(decisions[code].message)
    this.name = 'ToolRejected'
  }
}

export function toolRejection(code: ToolRejectionCode, overrides: { message?: string; nextAction?: NextAction } = {}) {
  return { code, ...decisions[code], ...overrides }
}
