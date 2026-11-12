import { describe, expect, it, vi } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { encodeSourcePng } from '../project/png-rgba.js'
import { sha256Bytes, decodeUtf8 } from '../project/binary.js'
import { encodeUtf8, cloneJson } from '../validation/json.js'
import { imageWorkStateSchema, parseImageWorkState, readImageWorkPackage, writeImageWorkPackage, type ImageWorkState } from './workflow.js'

const png = encodeSourcePng({ width: 2, height: 2, rgba: new Uint8ClampedArray([20, 40, 60, 255, 90, 80, 70, 255, 33, 44, 55, 255, 150, 140, 130, 255]) })
function state(): ImageWorkState {
  const hash = sha256Bytes(png)
  return { format: 'sceneweave-image-work', version: 1, id: 'room-piano', revision: 0,
    image: { sha256: hash, pixelWidth: 2, pixelHeight: 2 }, original: { sha256: hash, sizeBytes: png.length, name: '琴房.png', mimeType: 'image/png' },
    rights: { licenseText: '', attribution: '', canEmbed: false }, draft: { title: '琴房', calibration: null, roomPointsPx: [], layers: [],
      rulerPointsPx: [{ x: 0, y: 1 }], distanceInput: '暂定', originPx: { x: 0, y: 0 } },
    active: { name: '未完成物件', polygon: [{ x: 0, y: 0 }], donor: [], renderLayer: 'object', blocksMovement: false,
      fillPolygonPx: [{ x: 0, y: 1 }], fillDonorPx: [{ x: 1, y: 1 }],
      guided: { bounds: { x: 0, y: 0, width: 2, height: 2 }, foreground: [], background: [], algorithmVersion: 2, edgeCoverage: 'boundary' } },
    notes: '尚未完成选区', nextAction: '添加前景笔', scaleStatus: 'provisional',
    journal: [{ action: 'mark', note: '第一点', inputHash: hash, outputHash: hash, paramsJson: '{"points":[{"x":0,"y":0}]}' }], reviews: [] }
}

describe('portable image-item work package', () => {
  it('preserves an unfinished ruler, source, empty guidance and draft independently of a complete scene', async () => {
    const input = state(), bytes = await writeImageWorkPackage(input, png, png)
    const work = await readImageWorkPackage(bytes)
    expect(work.state).toEqual(input)
    expect(work.original).toEqual(png); expect(work.normalized).toEqual(png)
    expect(Object.isFrozen(work.state.active?.guided?.foreground)).toBe(true)
    const entries = unzipSync(bytes)
    expect(Object.keys(entries).sort()).toEqual(['normalized.png', 'original.bin', 'state.json'])
    work.original[0] = 0
    expect((await readImageWorkPackage(bytes)).original).toEqual(png)
  })

  it('captures mutable caller state and source bytes before its first await', async () => {
    const original = png.slice(), normalized = png.slice(), input = state()
    const pending = writeImageWorkPackage(input, original, normalized)
    input.notes = 'later edit'; original.fill(0); normalized.fill(0)
    const bytes = await pending, work = await readImageWorkPackage(bytes)
    expect(work.state.notes).toBe('尚未完成选区'); expect(work.original).toEqual(png)
    const reading = readImageWorkPackage(bytes)
    bytes.fill(0)
    expect((await reading).normalized).toEqual(png)
  })

  it('preserves an explicitly emptied selection without turning it back into the coarse polygon', async () => {
    const input = state()
    input.active!.emptySelectionBounds = { x: 0, y: 0, width: 2, height: 2 }
    const work = await readImageWorkPackage(await writeImageWorkPackage(input, png, png))
    expect(work.state.active?.emptySelectionBounds).toEqual(input.active!.emptySelectionBounds)
    expect(work.state.active?.selectionMask).toBeUndefined()
    input.active!.emptySelectionBounds = { x: 1, y: 1, width: 2, height: 2 }
    expect(() => parseImageWorkState(input)).toThrow(/范围/)
  })

  it('rejects ZIP payload tampering even when central/local lengths still agree', async () => {
    const archive = zipSync(unzipSync(await writeImageWorkPackage(state(), png, png)), { level: 0 })
    const view = new DataView(archive.buffer)
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true)
    archive[start + 1] ^= 1
    await expect(readImageWorkPackage(archive)).rejects.toThrow(/CRC/)
  })

  it('rejects valid-CRC archives with mismatched byte hashes, metadata or unknown paths', async () => {
    const entries = unzipSync(await writeImageWorkPackage(state(), png, png))
    const modified = JSON.parse(decodeUtf8(entries['state.json'])) as ImageWorkState
    modified.image.sha256 = 'a'.repeat(64)
    await expect(readImageWorkPackage(zipSync({ ...entries, 'state.json': encodeUtf8(JSON.stringify(modified)) }))).rejects.toThrow(/SHA-256/)
    modified.image.sha256 = sha256Bytes(png); modified.image.pixelWidth = 3
    await expect(readImageWorkPackage(zipSync({ ...entries, 'state.json': encodeUtf8(JSON.stringify(modified)) }))).rejects.toThrow(/尺寸/)
    modified.image.pixelWidth = 2; modified.original.sizeBytes++
    await expect(readImageWorkPackage(zipSync({ ...entries, 'state.json': encodeUtf8(JSON.stringify(modified)) }))).rejects.toThrow(/长度/)
    await expect(readImageWorkPackage(zipSync({ ...entries, 'extra.json': encodeUtf8('{}') }))).rejects.toThrow(/路径/)
    await expect(readImageWorkPackage(zipSync({ 'state.json': entries['state.json'], 'normalized.png': png }))).rejects.toThrow(/必要条目/)
  })

  it('rejects unknown state fields, accessors, out-of-bounds marks and malformed journal parameters', () => {
    expect(() => parseImageWorkState({ ...state(), accepted: true })).toThrow()
    const getter = vi.fn(() => 'untrusted'), input = state()
    Object.defineProperty(input, 'notes', { enumerable: true, get: getter })
    expect(() => parseImageWorkState(input)).toThrow(/访问器/); expect(getter).not.toHaveBeenCalled()
    const outside = state(); outside.active!.guided!.foreground = [{ points: [{ x: 3, y: 0 }], radiusPx: 1 }]
    expect(() => parseImageWorkState(outside)).toThrow(/范围/)
    const invalid = state(); invalid.journal[0].paramsJson = '{unfinished'
    expect(() => parseImageWorkState(invalid)).toThrow()
    const captured = parseImageWorkState(state())
    expect(imageWorkStateSchema.parse(cloneJson(captured))).toEqual(captured)
  })

  it('validates complete layers using the ordinary recipe contract while preserving partial room input', () => {
    const value = state()
    value.draft.layers.push({ id: 'chair', name: '椅子', polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }],
      donor: { x: 0, y: 0, width: 1, height: 1 }, renderLayer: 'object', blocksMovement: false })
    value.draft.roomPointsPx = [{ x: 0, y: 0 }]
    expect(parseImageWorkState(value).draft.roomPointsPx).toHaveLength(1)
    value.draft.layers.push(cloneJson(value.draft.layers[0]))
    expect(() => parseImageWorkState(value)).toThrow(/重复/)
  })

  it('preserves cancellation before encoding and while reading the next ZIP member', async () => {
    await expect(writeImageWorkPackage(state(), png, png, { aborted: true })).rejects.toMatchObject({ name: 'AbortError' })
    const bytes = await writeImageWorkPackage(state(), png, png), signal = { aborted: false }
    const pending = readImageWorkPackage(bytes, signal); signal.aborted = true
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
