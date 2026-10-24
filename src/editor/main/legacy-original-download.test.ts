import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { prepareOriginalDownload } from './legacy-original-download'
import { sha256Bytes } from '../../shared/project/binary'

describe('native history original download', () => {
  it('keeps original UTF-8 JSON bytes, whitespace and privacy-neutral filename', async () => {
    const bytes = new TextEncoder().encode('{\n "privateTitle": "private-fixture-name", "schemaVersion": 5\n}\n')
    const sourceHash = sha256Bytes(bytes), prepared = prepareOriginalDownload({ sourceSchemaVersion: 5, sourceHash }, bytes)
    bytes.fill(0)
    const actual = new Uint8Array(await prepared.blob.arrayBuffer())
    expect(sha256Bytes(actual)).toBe(sourceHash)
    expect(new TextDecoder().decode(actual)).toBe('{\n "privateTitle": "private-fixture-name", "schemaVersion": 5\n}\n')
    expect(prepared.filename).toBe(`sceneweave-original-v5-${sourceHash.slice(0, 12)}.json`)
    expect(prepared.filename).not.toContain('private-fixture-name')
    expect(prepared.blob.type).toBe('application/json')
  })

  it('downloads an original archive with its exact uploaded bytes and sceneweave extension', async () => {
    const bytes = zipSync({ 'manifest.json': new TextEncoder().encode('{"schemaVersion":6}') })
    const sourceHash = sha256Bytes(bytes), prepared = prepareOriginalDownload({ sourceSchemaVersion: 6, sourceHash }, bytes)
    expect(new Uint8Array(await prepared.blob.arrayBuffer())).toEqual(bytes)
    expect(prepared.filename).toBe(`sceneweave-original-v6-${sourceHash.slice(0, 12)}.sceneweave`)
    expect(prepared.blob.type).toBe('application/octet-stream')
  })
})
