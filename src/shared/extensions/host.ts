import { isPackageId, isPackageNamespace, isPositiveVersion } from '../assets/package-identity.js'
import { parseExtensionManifest, type ExtensionPointVersion } from './manifest.js'

export interface ExtensionMatch extends ExtensionPointVersion {
  readonly id: string
  readonly status: 'compatible' | 'unknown-point' | 'unsupported-version'
  readonly supportedVersions: readonly number[]
}

const noVersions: readonly number[] = Object.freeze([])

/** A host advertises only its own interfaces. Inspection is read-only and never runs package code. */
export function createExtensionHost(interfaces: readonly ExtensionPointVersion[]) {
  const versionsByPoint = new Map<string, number[]>()
  for (const { point, apiVersion } of interfaces) {
    if (!isPackageNamespace(point) || !isPositiveVersion(apiVersion)) throw new Error('宿主扩展点须有命名空间和正整数接口版本。')
    const versions = versionsByPoint.get(point) ?? []
    if (versions.includes(apiVersion)) throw new Error(`宿主重复注册扩展接口 ${point} v${apiVersion}。`)
    versions.push(apiVersion)
    versionsByPoint.set(point, versions)
  }
  const points = Object.freeze(Array.from(versionsByPoint, ([point, versions]) =>
    Object.freeze({ point, versions: Object.freeze(versions.sort((a, b) => a - b)) })))

  function inspect(input: Uint8Array) {
    const manifest = parseExtensionManifest(input)
    const contributions = Object.freeze(manifest.contributions.map(({ id, point, apiVersion }): ExtensionMatch => {
      const supportedVersions = versionsByPoint.get(point) ?? noVersions
      const status = !supportedVersions.length ? 'unknown-point' : supportedVersions.includes(apiVersion) ? 'compatible' : 'unsupported-version'
      return Object.freeze({ id, point, apiVersion, status, supportedVersions })
    }))

    /** Select an exact interface before handing its opaque JSON to the domain validator. */
    function readContribution(id: string, expected: ExtensionPointVersion): unknown {
      if (!isPackageId(id)) throw new Error('请选择有效的包内扩展项标识。')
      const index = contributions.findIndex(entry => entry.id === id)
      if (index < 0) throw new Error(`扩展 ${manifest.namespace} 中没有扩展项 ${id}。`)
      const match = contributions[index]
      if (match.status === 'unknown-point') throw new Error(`扩展项 ${id} 需要宿主未注册的扩展点 ${match.point}。`)
      if (match.status === 'unsupported-version') throw new Error(`扩展项 ${id} 需要 ${match.point} v${match.apiVersion}，宿主支持版本 ${match.supportedVersions.join('、')}。`)
      if (match.point !== expected.point || match.apiVersion !== expected.apiVersion) throw new Error(`扩展项 ${id} 声明的是 ${match.point} v${match.apiVersion}，此入口需要 ${expected.point} v${expected.apiVersion}。`)
      return manifest.contributions[index].data
    }
    return Object.freeze({ namespace: manifest.namespace, version: manifest.version, contributions, readContribution })
  }
  return Object.freeze({ points, inspect })
}
