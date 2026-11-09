import { describe, expect, it } from 'vitest'
import { assessAssetQuality, type AssetQualityContext } from './quality.js'
import { assertAssetQualityAccepted, assetQualityAcknowledgmentsComplete, createAssetQualityAssessment } from './quality-review.js'

const context: AssetQualityContext = { kind: 'prop', widthMm: 1000, heightMm: 1000 }
const raster = (alpha = 255) => ({ width: 32, height: 32, rgba: new Uint8ClampedArray(Array.from({ length: 32 * 32 }, () => [80, 100, 120, alpha]).flat()) })
const report = () => assessAssetQuality(raster(), context)
const assessment = (name = '  木桌_02 🌲  ', hash = 'a'.repeat(64)) => createAssetQualityAssessment(name, hash, report())

describe('exact session-only quality acknowledgments', () => {
  it('binds an acknowledgment to the exact name, image hash, calibration, policy and complete report', () => {
    const original = assessment(), sourceReport = report()
    expect(assessment().key).toBe(original.key)
    const changedContext = assessAssetQuality(raster(), { ...context, widthMm: 2000 })
    const changes = [assessment('木桌_02 🌲'), assessment(undefined, 'b'.repeat(64)),
      createAssetQualityAssessment(original.name, original.sha256, changedContext),
      createAssetQualityAssessment(original.name, original.sha256, { ...sourceReport, policyId: 'future-policy' as never }),
      createAssetQualityAssessment(original.name, original.sha256, { ...sourceReport, issues: sourceReport.issues.map((issue, index) => index ? issue : { ...issue, message: issue.message + ' 更新' }) }),
      createAssetQualityAssessment(original.name, original.sha256, { ...sourceReport, metrics: { ...sourceReport.metrics, maximumAlpha: 254 } }),
    ]
    for (const changed of changes) {
      expect(changed.key).not.toBe(original.key)
      expect(assetQualityAcknowledgmentsComplete([changed], [original.key])).toBe(false)
      expect(() => assertAssetQualityAccepted([changed], [original.key])).toThrow(/逐项复核/)
    }
    expect(assetQualityAcknowledgmentsComplete([original], [original.key])).toBe(true)
  })

  it('requires every distinct warned item and never treats a generic or unrelated acknowledgment as sufficient', () => {
    const first = assessment('First'), second = assessment('Second'), values = [first, second]
    const keys = [first.key], beforeValues = JSON.stringify(values), beforeKeys = [...keys]
    expect(assetQualityAcknowledgmentsComplete(values)).toBe(false)
    expect(assetQualityAcknowledgmentsComplete(values, ['accepted', 'true'])).toBe(false)
    expect(assetQualityAcknowledgmentsComplete(values, keys)).toBe(false)
    expect(() => assertAssetQualityAccepted(values, keys)).toThrow(/逐项复核/)
    expect(() => assertAssetQualityAccepted(values, [first.key, second.key])).not.toThrow()
    expect(JSON.stringify(values)).toBe(beforeValues); expect(keys).toEqual(beforeKeys)
    expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.report)).toBe(true)
    expect(first.name).toBe('First')
  })

  it('cannot acknowledge a blocked transparent image into an adoptable item', () => {
    const blocked = createAssetQualityAssessment('Invisible', 'b'.repeat(64), assessAssetQuality(raster(0), context))
    expect(blocked.report.status).toBe('blocked')
    expect(assetQualityAcknowledgmentsComplete([blocked], [blocked.key])).toBe(false)
    expect(() => assertAssetQualityAccepted([blocked], [blocked.key])).toThrow(/Invisible.*完全透明/)
  })

  it('lets a clean exact material proceed without requiring an unrelated art or P3 approval', () => {
    const clean = createAssetQualityAssessment('Plain tile', 'c'.repeat(64), assessAssetQuality(raster(), { kind: 'material', widthMm: 250, heightMm: 250 }))
    expect(clean.report.status).toBe('pass')
    expect(assetQualityAcknowledgmentsComplete([clean])).toBe(true)
    expect(() => assertAssetQualityAccepted([clean])).not.toThrow()
    expect(assetQualityAcknowledgmentsComplete([])).toBe(true)
    expect(clean).not.toHaveProperty('approved'); expect(clean).not.toHaveProperty('userSignoff')
  })

  it('refuses a missing or malformed exact image hash', () => {
    for (const hash of ['', 'A'.repeat(64), 'a'.repeat(63), 'untrusted-key']) {
      expect(() => createAssetQualityAssessment('Name', hash, report())).toThrow(/摘要/)
    }
  })
})
