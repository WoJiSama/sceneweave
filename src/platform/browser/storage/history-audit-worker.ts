import { auditHistoryRecords, type HistoryHead, type HistoryVersion, type HistoryPin } from './history-records.js'

self.onmessage = (event: MessageEvent<{ owner: string; head: HistoryHead | null; versions: HistoryVersion[]; pins: HistoryPin[] }>) => {
  try {
    const { owner, head, versions, pins } = event.data
    const result = auditHistoryRecords(owner, head, versions, pins)
    self.postMessage({ ok: true, documentBytes: result.documentBytes })
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : '增量历史完整检查失败。' })
  }
}
