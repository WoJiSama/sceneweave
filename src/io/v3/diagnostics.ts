/** Safe project-local identities only; never source paths or GM-authored content. */
export interface ProjectDiagnosticV3 {
  code: string
  message: string
  entityId?: string
  dependencyId?: string
  sha256?: string
  path?: string
  expectedVersion?: number
  actualVersion?: number
}

export interface ProjectDependencySummaryV3 {
  assets: number
  bitmapBlobs: number
  materials: number
  propDefinitions: number
  prefabDefinitions: number
  styleThemes: number
  licenseBindings: number
  licenseTexts: number
  bitmapPixels: number
}

export interface ProjectDiagnosticsV3 {
  complete: boolean
  issues: ProjectDiagnosticV3[]
  summary: ProjectDependencySummaryV3 | null
}

/** Presentation protection only; never reduces validation or admits an incomplete file. */
export const PROJECT_DIAGNOSTIC_LIMIT_V3 = 256
const boundedText = (value: string, limit: number) => `${value.slice(0, limit).replace(/[\x00-\x1f\x7f]/g, ' ')}${value.length > limit ? '…' : ''}`

export class ProjectValidationErrorV3 extends Error {
  readonly issues: ProjectDiagnosticV3[]
  constructor(issues: readonly ProjectDiagnosticV3[]) {
    const visible = issues.length > PROJECT_DIAGNOSTIC_LIMIT_V3 ? PROJECT_DIAGNOSTIC_LIMIT_V3 - 1 : issues.length
    const copies = issues.slice(0, visible).map(issue => ({ ...issue, code: boundedText(issue.code, 64), message: boundedText(issue.message, 2048),
      ...(issue.entityId ? { entityId: boundedText(issue.entityId, 256) } : {}),
      ...(issue.dependencyId ? { dependencyId: boundedText(issue.dependencyId, 256) } : {}),
      ...(issue.path ? { path: boundedText(issue.path, 384) } : {}),
    }))
    if (visible < issues.length) copies.push({ code: 'DIAGNOSTIC_LIMIT', message: `另有 ${issues.length - visible} 项问题未展示；此处仅显示前 ${visible} 项。完整工程校验仍然失败，请分批修复后重试。` })
    const summary = copies.slice(0, 8).map(issue => `${issue.entityId ? `${issue.entityId}：` : ''}${issue.message.replace(/^M1 工程无效：/, '')}`).join('；')
    super(`M1 工程无效：${summary}${copies.length > 8 ? `；另有问题，请查看依赖清单（最多展示 ${PROJECT_DIAGNOSTIC_LIMIT_V3} 项）。` : ''}`)
    this.name = 'ProjectValidationErrorV3'
    this.issues = copies
  }
}

/** Preserve cancellation and already contextualized failures across public IO boundaries. */
export function projectErrorV3(error: unknown, context: Partial<Omit<ProjectDiagnosticV3, 'message'>> = {}): never {
  if (error instanceof DOMException && error.name === 'AbortError') throw error
  if (error instanceof ProjectValidationErrorV3) throw error
  // Only our bounded validators provide the public reason. Browser/decoder errors
  // may contain machine paths or implementation details and are replaced upstream.
  const message = error instanceof Error && error.message.startsWith('M1 工程无效：')
    ? error.message.replace(/^M1 工程无效：/, '') : '工程处理失败；原工程和输入文件已保留。'
  throw new ProjectValidationErrorV3([{ code: 'INVALID_PROJECT', ...context, message }])
}
