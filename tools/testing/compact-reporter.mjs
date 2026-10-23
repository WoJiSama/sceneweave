import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** Content addressed attachments avoid repeating the same project/resource payload in reporter JSON. */
export default class CompactReporter {
  constructor() {
    this.output = path.resolve(process.env.SCENEWEAVE_EVIDENCE_DIR ?? 'work/playwright-compact')
    fs.mkdirSync(path.join(this.output, 'attachments'), { recursive: true })
    this.report = { startedAt: new Date().toISOString(), method: 'Playwright assertions; attachments addressed by SHA-256, oversized files recorded without pretending they were retained.', tests: [] }
  }
  onBegin(config, suite) { this.report.expectedTests = suite.allTests().length; this.report.workers = config.workers }
  onTestEnd(test, result) {
    const attachments = result.attachments.map(attachment => {
      const bytes = attachment.body ?? (attachment.path && fs.existsSync(attachment.path) ? fs.readFileSync(attachment.path) : null)
      if (!bytes) return { name: attachment.name, contentType: attachment.contentType, retained: false }
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const ext = { 'application/json': '.json', 'image/png': '.png', 'application/zip': '.zip', 'text/plain': '.txt' }[attachment.contentType] ?? '.bin'
      const retained = bytes.length <= 8 * 1024 * 1024
      const relativePath = `attachments/${sha256}${ext}`
      if (retained && !fs.existsSync(path.join(this.output, relativePath))) fs.writeFileSync(path.join(this.output, relativePath), bytes)
      return { name: attachment.name, contentType: attachment.contentType, sha256, sizeBytes: bytes.length, retained, ...(retained ? { path: relativePath } : {}) }
    })
    this.report.tests.push({ title: test.titlePath().join(' / '), file: path.relative(process.cwd(), test.location.file), line: test.location.line,
      status: result.status, expectedStatus: test.expectedStatus, retry: result.retry, durationMs: result.duration,
      errors: result.errors.map(error => ({ message: error.message, stack: error.stack })), attachments })
  }
  onEnd(result) {
    this.report.status = result.status; this.report.durationMs = result.duration
    this.report.finishedAt = new Date().toISOString()
    this.report.counts = this.report.tests.reduce((counts, test) => { counts[test.status] = (counts[test.status] ?? 0) + 1; return counts }, {})
    fs.writeFileSync(path.join(this.output, 'report.json'), JSON.stringify(this.report, null, 2) + '\n')
  }
}
