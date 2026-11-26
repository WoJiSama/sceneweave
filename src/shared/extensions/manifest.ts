import { isPackageId, isPackageNamespace, isPositiveVersion } from '../assets/package-identity.js'
import { captureBytes } from '../project/binary.js'
import { parseBoundedJson } from '../project/json.js'
import { hasExactKeys } from '../project/limits.js'
import { freezeJson, inspectJsonInput } from '../validation/json.js'

export interface ExtensionPointVersion {
  readonly point: string
  readonly apiVersion: number
}

export interface ExtensionContribution extends ExtensionPointVersion {
  readonly id: string
  readonly data: unknown
}

export interface ExtensionManifest {
  readonly format: 'sceneweave-extension'
  readonly schemaVersion: 1
  readonly namespace: string
  readonly version: number
  readonly contributions: readonly ExtensionContribution[]
}

export const EXTENSION_MANIFEST_LIMITS = Object.freeze({ bytes: 64 * 1024, contributions: 64, depth: 16, values: 4096 })

function fail(message: string): never { throw new Error(`扩展清单无效：${message}`) }

function checkHeader(header: unknown): asserts header is Record<string, unknown> {
  if (!header || typeof header !== 'object' || !('format' in header) || header.format !== 'sceneweave-extension'
    || !('schemaVersion' in header) || !isPositiveVersion(header.schemaVersion)) fail('缺少扩展清单格式或有效的清单版本。')
  if (header.schemaVersion !== 1) fail(`当前读取器不支持扩展清单 v${header.schemaVersion}。`)
}

/** The envelope owns its JSON. Each host interprets only the data of a selected interface. */
export function parseExtensionManifest(input: Uint8Array): ExtensionManifest {
  let root: unknown
  try {
    const bytes = captureBytes(input, EXTENSION_MANIFEST_LIMITS.bytes)
    root = parseBoundedJson(bytes, { values: 0 }, EXTENSION_MANIFEST_LIMITS)
  } catch (error) {
    return fail(error instanceof Error ? error.message.replace(/^完整v1工程无效：/, '') : '无法读取清单。')
  }
  checkHeader(root)
  if (!hasExactKeys(root, ['format', 'schemaVersion', 'namespace', 'version', 'contributions'])
    || !isPackageNamespace(root.namespace) || !isPositiveVersion(root.version)) fail('须提供发布者/包标识、正整数发行版本及确切的清单字段。')
  if (!Array.isArray(root.contributions) || root.contributions.length > EXTENSION_MANIFEST_LIMITS.contributions) fail('扩展项须为最多 64 项的数组。')
  const issue = inspectJsonInput(root)
  if (issue) fail(issue.message)
  const ids = new Set<string>()
  const contributions = root.contributions.map((entry: unknown) => {
    if (!hasExactKeys(entry, ['id', 'point', 'apiVersion', 'data']) || !isPackageId(entry.id)
      || !isPackageNamespace(entry.point) || !isPositiveVersion(entry.apiVersion)) fail('每个扩展项须提供本地标识、命名空间扩展点、正整数接口版本和数据。')
    if (ids.has(entry.id)) fail(`包内扩展项标识重复：${entry.id}。`)
    ids.add(entry.id)
    return { id: entry.id, point: entry.point, apiVersion: entry.apiVersion, data: entry.data }
  })
  return freezeJson({ format: 'sceneweave-extension', schemaVersion: 1, namespace: root.namespace, version: root.version, contributions })
}
