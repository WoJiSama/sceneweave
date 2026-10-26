import { describe, expect, it } from 'vitest'
import { safeTaskError } from './store.js'

describe('safe task error diagnostics', () => {
  it('distinguishes provider rate limiting from the task budget and never offers automatic retry', () => {
    expect(safeTaskError('provider_rate_limit')).toEqual({
      code: 'provider_rate_limit',
      message: '模型渠道触发限流；已保留现有草稿与进度，未自动重试。',
      retryable: false,
      requestState: 'unknown',
    })
  })
  it('preserves request outcome independently of the fixed provider rate-limit message', () => {
    for (const requestState of ['not_sent', 'unknown', 'finished'] as const) {
      expect(safeTaskError('provider_rate_limit', requestState)).toMatchObject({
        code: 'provider_rate_limit', message: '模型渠道触发限流；已保留现有草稿与进度，未自动重试。', retryable: false, requestState,
      })
    }
  })
  it('keeps the existing budget and execution-limit diagnostics', () => {
    for (const code of ['request_limit', 'task_storage_limit', 'provider_limit']) {
      expect(safeTaskError(code, 'finished')).toEqual({ code, message: '任务已达到本次执行预算上限。', retryable: false, requestState: 'finished' })
    }
    expect(safeTaskError('execution_limit').message).toBe('任务执行时间已达上限。')
  })
  it('keeps the existing restart and generic progress diagnostics', () => {
    expect(safeTaskError('service_restarted').message).toBe('服务已重启；上一请求结果未知，请明确选择是否继续。')
    expect(safeTaskError('provider_response')).toEqual({ code: 'provider_response', message: '任务未完成；已保留可查询的进度。', retryable: false, requestState: 'unknown' })
  })
})
