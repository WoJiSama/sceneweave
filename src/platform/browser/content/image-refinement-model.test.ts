import { afterEach, describe, expect, it, vi } from 'vitest'
import { svgFixturePng } from '../../../../tests/helpers/m24-svg-fixtures.js'
import { imageEditCapabilities, imageEditInputHash, chooseImageEditSize, inspectImageEditPng, encodeImageEditBase64, sha256Bytes } from '../../../shared/asset-refinement/model-protocol.js'
import { getImageEditCapabilities, requestImageEdit, type ImageEditRequestStateEvent } from './image-refinement-model.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const connection = { baseUrl: 'https://backend.example.test', token: 'private-application-token' }
const input = () => { const pngBytes = svgFixturePng(); return { clientRequestId: 'image-edit-1', sourceSha256: sha256Bytes(pngBytes), pngBytes, prompt: 'Refine only existing details' } }
function result(changes: Record<string, unknown> = {}) {
  const source = input(), dimensions = inspectImageEditPng(source.pngBytes, 'input'), size = chooseImageEditSize(dimensions.width, dimensions.height)
  return { schemaVersion: 1, sourceSha256: source.sourceSha256, inputHash: imageEditInputHash(source, 'configured-model', size),
    outputHash: source.sourceSha256, model: 'configured-model', requestId: 'provider-request-1', requestedSize: size, pngBase64: encodeImageEditBase64(source.pngBytes), ...changes }
}

describe('image refinement model transport', () => {
  it('negotiates the dedicated capability using an in-memory application credential and returns unavailable explicitly', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(imageEditCapabilities()))
    vi.stubGlobal('fetch', fetcher)
    expect(await getImageEditCapabilities(connection)).toMatchObject({ available: false, model: null, requiredBackground: 'transparent', providerSupport: 'configured-unverified' })
    expect(fetcher).toHaveBeenCalledWith(connection.baseUrl + '/v1/image-edit/capabilities', expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${connection.token}` } }))
  })
  it('submits original PNG bytes once and verifies source, input and output provenance before returning bytes', async () => {
    const before = input(), events: ImageEditRequestStateEvent[] = [], fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(events).toEqual([{ clientRequestId: before.clientRequestId, state: 'unknown' }])
      expect(JSON.parse(init!.body as string)).toEqual({ schemaVersion: 1, clientRequestId: before.clientRequestId, sourceSha256: before.sourceSha256, prompt: before.prompt, pngBase64: encodeImageEditBase64(before.pngBytes) })
      expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error')
      return Response.json(result())
    })
    vi.stubGlobal('fetch', fetcher)
    const output = await requestImageEdit(connection, before, undefined, event => events.push(event))
    expect(output.pngBytes).toEqual(before.pngBytes); expect(output.pngBytes).not.toBe(before.pngBytes)
    expect(output).toMatchObject({ model: 'configured-model', requestId: 'provider-request-1', clientRequestId: before.clientRequestId, sourceSha256: before.sourceSha256, outputHash: before.sourceSha256 })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(events).toEqual([{ clientRequestId: before.clientRequestId, state: 'unknown' }, { clientRequestId: before.clientRequestId, state: 'finished' }])
  })
  it.each([{ sourceSha256: 'a'.repeat(64) }, { outputHash: 'b'.repeat(64) }, { inputHash: 'c'.repeat(64) }, { pngBase64: 'https://private.test/image.png' }])('rejects mismatched provenance or URL output without fetching it', async change => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result(change))); vi.stubGlobal('fetch', fetcher)
    await expect(requestImageEdit(connection, input())).rejects.toMatchObject({ code: 'image_edit_protocol', requestState: 'unknown' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('never retries a network failure or a server duplicate receipt', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('private network detail') }); vi.stubGlobal('fetch', fetcher)
    await expect(requestImageEdit(connection, input())).rejects.toMatchObject({ code: 'image_edit_connection', requestState: 'unknown', clientRequestId: 'image-edit-1', message: expect.stringContaining('请求 ID：image-edit-1') }); expect(fetcher).toHaveBeenCalledOnce()
    fetcher.mockResolvedValueOnce(Response.json({ schemaVersion: 1, error: { code: 'image_edit_duplicate_request', requestState: 'unknown', retryable: false } }, { status: 409 }))
    await expect(requestImageEdit(connection, input())).rejects.toMatchObject({ code: 'image_edit_duplicate_request', requestState: 'unknown' }); expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('keeps cancellation state distinct before and after a possible paid request', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
    vi.stubGlobal('fetch', fetcher)
    const events: ImageEditRequestStateEvent[] = [], early = new AbortController(); early.abort()
    await expect(requestImageEdit(connection, input(), early.signal, event => events.push(event))).rejects.toMatchObject({ code: 'image_edit_cancelled', requestState: 'not_sent' }); expect(fetcher).not.toHaveBeenCalled()
    expect(events).toEqual([])
    const late = new AbortController(), pending = requestImageEdit(connection, input(), late.signal, event => events.push(event))
    expect(events).toEqual([{ clientRequestId: 'image-edit-1', state: 'unknown' }])
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); late.abort()
    await expect(pending).rejects.toMatchObject({ code: 'image_edit_cancelled', requestState: 'unknown', clientRequestId: 'image-edit-1' }); expect(fetcher).toHaveBeenCalledOnce()
    expect(events.at(-1)).toEqual({ clientRequestId: 'image-edit-1', state: 'unknown' })
  })
  it('retains a finished service failure and its client ID without repeating the dispatched request', async () => {
    const events: ImageEditRequestStateEvent[] = []
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ schemaVersion: 1, error: { code: 'image_edit_storage_unavailable', requestState: 'finished', retryable: false } }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(requestImageEdit(connection, input(), undefined, event => events.push(event))).rejects.toMatchObject({ code: 'image_edit_storage_unavailable', requestState: 'finished', clientRequestId: 'image-edit-1' })
    expect(events).toEqual([{ clientRequestId: 'image-edit-1', state: 'unknown' }, { clientRequestId: 'image-edit-1', state: 'finished' }])
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('updates the provisional dispatch record when the service confirms no model request was sent', async () => {
    const events: ImageEditRequestStateEvent[] = []
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ schemaVersion: 1, error: { code: 'image_edit_unavailable', requestState: 'not_sent', retryable: false } }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(requestImageEdit(connection, input(), undefined, event => events.push(event))).rejects.toMatchObject({ requestState: 'not_sent' })
    expect(events).toEqual([{ clientRequestId: 'image-edit-1', state: 'unknown' }, { clientRequestId: 'image-edit-1', state: 'not_sent' }])
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects source hash, prompt budget and unsafe connection values before upload', async () => {
    const fetcher = vi.fn<typeof fetch>(), onState = vi.fn(); vi.stubGlobal('fetch', fetcher)
    for (const change of [{ sourceSha256: 'a'.repeat(64) }, { prompt: 'x'.repeat(2001) }, { clientRequestId: '' }]) await expect(requestImageEdit(connection, { ...input(), ...change }, undefined, onState)).rejects.toMatchObject({ code: 'image_edit_invalid_source', requestState: 'not_sent' })
    await expect(requestImageEdit({ ...connection, baseUrl: 'http://external.test' }, input(), undefined, onState)).rejects.toMatchObject({ code: 'image_edit_configuration', requestState: 'not_sent' })
    for (const baseUrl of ['http://external.test', 'https://private:secret@backend.test', 'https://backend.test/v1']) await expect(getImageEditCapabilities({ ...connection, baseUrl })).rejects.toMatchObject({ code: 'image_edit_configuration', requestState: 'not_sent' })
    expect(fetcher).not.toHaveBeenCalled()
    expect(onState).not.toHaveBeenCalled()
  })
})
