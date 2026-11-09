import type { AssetQualityReport } from './quality.js'
import { canonicalJson, captureJson, freezeJson } from '../validation/json.js'
import { sha256Text } from '../validation/hash.js'

/** Session-only screening bound to the exact pixels, calibration and policy.
 * This is not a resource-validation certificate or an art/P3 approval. */
export interface AssetQualityAssessment {
  readonly key: string
  readonly name: string
  readonly sha256: string
  readonly report: AssetQualityReport
}
export function createAssetQualityAssessment(name: string, sha256: string, report: AssetQualityReport): AssetQualityAssessment {
  if (typeof name !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('素材初筛缺少确切名称或图片摘要。')
  const owned = captureJson({ name, sha256, report })
  return freezeJson({ key: sha256Text(canonicalJson(owned)), ...owned })
}
export function assetQualityAcknowledgmentsComplete(assessments: readonly AssetQualityAssessment[], acknowledgedKeys: readonly string[] = []): boolean {
  const accepted = new Set(acknowledgedKeys)
  return assessments.every(item => item.report.status !== 'blocked' && (item.report.status !== 'review' || accepted.has(item.key)))
}
export function assertAssetQualityAccepted(assessments: readonly AssetQualityAssessment[], acknowledgedKeys: readonly string[] = []): void {
  const blocked = assessments.find(item => item.report.status === 'blocked')
  if (blocked) throw new Error(`素材「${blocked.name}」未通过质量初筛：${blocked.report.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('；')}`)
  if (!assetQualityAcknowledgmentsComplete(assessments, acknowledgedKeys)) throw new Error('请逐项复核素材质量提示后再采用；也可以取消并更换图片或修正尺寸。')
}
