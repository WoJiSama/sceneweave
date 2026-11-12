import { auditHistoryMessage, type HistoryAuditMessage } from './history-audit-message.js'

self.onmessage = async (event: MessageEvent<HistoryAuditMessage>) => {
  try {
    const result = await auditHistoryMessage(event.data)
    self.postMessage({ ok: true, documentBytes: result.documentBytes })
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : '增量历史完整检查失败。' })
  }
}
