/** The package schema and reader capabilities evolve independently of the application build. */
export const PROJECT_FORMAT = 'sceneweave-complete-project'
export const PROJECT_SCHEMA_VERSION = 1
export const PROJECT_EXTENSIONS_READER_VERSION = 2
export const PROJECT_LANDSCAPE_READER_VERSION = 3
export const PROJECT_READER_VERSION = PROJECT_LANDSCAPE_READER_VERSION

declare const __SCENEWEAVE_BUILD_VERSION__: string
export const PROJECT_WRITER_BUILD = typeof __SCENEWEAVE_BUILD_VERSION__ === 'string' ? __SCENEWEAVE_BUILD_VERSION__ : 'unbundled'

export class ProjectReaderVersionError extends Error {
  constructor(readonly schemaVersion: number, readonly minReaderVersion: number) {
    super(`此工程使用格式 v${schemaVersion}，需要支持该格式及读取协议 v${minReaderVersion} 的织境。请更新织境后重新打开原文件。`)
    this.name = 'ProjectReaderVersionError'
  }
}

const positiveVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/** Inspect bounded manifest JSON before interpreting any version-specific entries. */
export function checkProjectReader(header: unknown): asserts header is Record<string, unknown> {
  if (header === null || typeof header !== 'object' || Array.isArray(header) || !('format' in header) || header.format !== PROJECT_FORMAT
    || !('schemaVersion' in header) || !positiveVersion(header.schemaVersion)) throw new Error('请选择有效的 Sceneweave 完整工程 v1 文件。')
  const minimum = 'minReaderVersion' in header ? header.minReaderVersion : 1
  if (!positiveVersion(minimum)) throw new Error('工程清单的最低读取协议版本须为正整数。')
  if (header.schemaVersion > PROJECT_SCHEMA_VERSION || minimum > PROJECT_READER_VERSION) throw new ProjectReaderVersionError(header.schemaVersion, minimum)
}
