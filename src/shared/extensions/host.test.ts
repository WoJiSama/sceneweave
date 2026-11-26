import { describe, expect, it } from 'vitest'
import { encodeUtf8 } from '../validation/json.js'
import { createExtensionHost } from './host.js'
import { EXTENSION_MANIFEST_LIMITS, parseExtensionManifest } from './manifest.js'

const point = { point: 'test.host/marks', apiVersion: 1 }
const entry = { id: 'map-marks', ...point, data: { labels: ['a', 'b'] } }
const manifest = { format: 'sceneweave-extension', schemaVersion: 1, namespace: 'example.org/campaign', version: 27, contributions: [entry] }
const json = (input: unknown) => encodeUtf8(JSON.stringify(input))

describe('declarative extension interfaces', () => {
  it('reports exact interfaces independently for each host and each contribution', () => {
    const newer = { ...point, apiVersion: 3 }, otherPoint = { point: 'test.host/other', apiVersion: 1 }
    const bytes = json({ ...manifest, contributions: [
      entry, { ...entry, ...newer, id: 'new' }, { ...entry, apiVersion: 2, id: 'between' }, { ...entry, ...otherPoint, id: 'other' },
    ] })
    const oldHost = createExtensionHost([point]), host = createExtensionHost([newer, point])
    expect(host.points).toEqual([{ point: point.point, versions: [1, 3] }])
    expect(oldHost.inspect(bytes).contributions.map(row => row.status)).toEqual(['compatible', 'unsupported-version', 'unsupported-version', 'unknown-point'])
    const result = host.inspect(bytes)
    expect(result).toMatchObject({ namespace: 'example.org/campaign', version: 27 })
    expect(result.contributions.map(row => [row.id, row.status, row.supportedVersions])).toEqual([
      ['map-marks', 'compatible', [1, 3]], ['new', 'compatible', [1, 3]],
      ['between', 'unsupported-version', [1, 3]], ['other', 'unknown-point', []],
    ])
    expect(result.readContribution('new', newer)).toEqual(entry.data)
    expect(() => result.readContribution('new', point)).toThrow(/v3.*v1/)
    expect(() => result.readContribution('new', otherPoint)).toThrow(/test.host\/other/)
    expect(() => result.readContribution('between', point)).toThrow(/v2.*1、3/)
    expect(() => result.readContribution('other', otherPoint)).toThrow(/未注册/)
    expect(() => result.readContribution('missing', point)).toThrow(/没有扩展项/)
    expect(createExtensionHost([]).inspect(bytes).contributions.every(row => row.status === 'unknown-point')).toBe(true)
  })

  it('owns the interface list, exact manifest bytes and selected data', () => {
    const registration = { ...point }, registrations = [registration]
    const host = createExtensionHost(registrations)
    registration.apiVersion = 9
    registrations.length = 0
    const bytes = json(manifest), result = host.inspect(bytes)
    bytes.fill(0)
    expect(result.contributions[0]).toMatchObject({ id: entry.id, status: 'compatible', supportedVersions: [1] })
    const data = result.readContribution(entry.id, point) as typeof entry.data
    expect(data).toEqual(entry.data)
    for (const value of [host, host.points, host.points[0], host.points[0].versions, result, result.contributions,
      result.contributions[0], result.contributions[0].supportedVersions, data, data.labels]) expect(Object.isFrozen(value)).toBe(true)
  })

  it('rejects duplicate registrations and ambiguous local contribution IDs across kinds or versions', () => {
    expect(() => createExtensionHost([point, { ...point }])).toThrow(/重复注册/)
    expect(() => createExtensionHost([{ ...point, point: 'no-namespace' }])).toThrow(/命名空间/)
    expect(() => createExtensionHost([{ ...point, apiVersion: 0 }])).toThrow(/正整数/)
    for (const duplicate of [entry, { ...entry, apiVersion: 2 }, { ...entry, point: 'other.host/marks' }]) {
      expect(() => parseExtensionManifest(json({ ...manifest, contributions: [entry, duplicate] }))).toThrow(/标识重复/)
    }
  })

  it('rejects malformed envelopes, invalid identities, unsupported schema versions and undeclared fields', () => {
    for (const patch of [{ format: 'other' }, { namespace: 'bad' }, { namespace: 'a/b/c' }, { namespace: 'EXAMPLE.org/campaign' },
      { version: 0 }, { version: 0.5 }, { permissions: ['workspace'] }, { contributions: null }]) {
      expect(() => parseExtensionManifest(json({ ...manifest, ...patch }))).toThrow(/扩展清单无效/)
    }
    expect(() => parseExtensionManifest(json({ ...manifest, schemaVersion: 2, newField: true }))).toThrow(/不支持扩展清单 v2/)
    for (const patch of [{ id: 'a/b' }, { point: '/marks' }, { apiVersion: -1 }, { data: undefined }, { entrypoint: 'main.js' }]) {
      expect(() => parseExtensionManifest(json({ ...manifest, contributions: [{ ...entry, ...patch }] }))).toThrow(/扩展清单无效/)
    }
    const source = JSON.stringify(manifest)
    expect(() => parseExtensionManifest(encodeUtf8(source.replace('"labels":', '"labels":null,"labels":')))).toThrow(/重复字段/)
    expect(() => parseExtensionManifest(encodeUtf8(source.replace('"labels":', '"__proto__":')))).toThrow(/__proto__/)
    expect(() => parseExtensionManifest(new Uint8Array([255]))).toThrow(/UTF-8/)
  })

  it('bounds inert data even for an unknown point', () => {
    const inspect = (data: unknown) => createExtensionHost([]).inspect(json({ ...manifest, contributions: [{ ...entry, data }] }))
    const { bytes, contributions, values, depth } = EXTENSION_MANIFEST_LIMITS
    expect(() => inspect('x'.repeat(bytes))).toThrow(/字节/)
    expect(() => inspect(Array(values).fill(null))).toThrow(/节点/)
    let nested: unknown = 'x'
    for (let i = 0; i < depth; i++) nested = [nested]
    expect(() => inspect(nested)).toThrow(/深度/)
    const entries = Array.from({ length: contributions }, (_, i) => ({ ...entry, id: String(i) }))
    expect(parseExtensionManifest(json({ ...manifest, contributions: entries })).contributions).toHaveLength(contributions)
    expect(() => parseExtensionManifest(json({ ...manifest, contributions: [...entries, entry] }))).toThrow(/64/)
  })
})
