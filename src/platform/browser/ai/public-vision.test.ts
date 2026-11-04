import { afterEach, describe, expect, it, vi } from 'vitest'
import { svgFixturePng, svgProjectFixture } from '../../../../tests/helpers/m24-svg-fixtures'
import { cloneJson } from '../../../shared/validation/json'
import { verifyVisionInput, VISION_LIMITS } from '../../../shared/ai/vision'
import type { EditableProject } from '../../../application/workspace/project'

const { render } = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('../render/renderer', () => ({ exportPublicViewportPng: render }))
import { renderPublicVision } from './public-vision'

afterEach(() => vi.resetAllMocks())
const project = (): EditableProject => {
  const bundle = svgProjectFixture().bundle
  return { ...cloneJson(bundle.project), resources: bundle.resources }
}
const bounds = () => ({ x: 1000, y: 1000, width: 1000, height: 1000 })
const blob = () => new Blob([svgFixturePng() as Uint8Array<ArrayBuffer>], { type: 'image/png' })

describe('actual public screenshot capture boundary', () => {
  it('binds captured metadata, crop, draft and exact PNG bytes despite caller changes during rendering', async () => {
    const input = project(), area = bounds(), draft = { draftRevision: 3, contentHash: 'a'.repeat(64) }
    const sceneId = input.document.sceneId, revision = input.document.revision
    render.mockImplementation(async () => {
      input.document.sceneId = 'replacement-scene'; input.document.revision++
      area.x = 2000; draft.draftRevision = 4; draft.contentHash = 'b'.repeat(64)
      await Promise.resolve()
      return blob()
    })
    const image = await renderPublicVision(input, area, undefined, draft)
    expect(image).toMatchObject({ sceneId, revision, boundsMm: bounds(), draft: { draftRevision: 3, contentHash: 'a'.repeat(64) } })
    expect(verifyVisionInput(image).bytes).toEqual(svgFixturePng())
    const [captured, capturedArea] = render.mock.calls[0]
    expect(captured.project.document).toMatchObject({ sceneId, revision })
    expect(capturedArea).toEqual(bounds())
  })

  it('reuses one captured bundle and crop for bounded resolution retries', async () => {
    const input = project(), area = bounds()
    render.mockImplementationOnce(async () => {
      input.document.revision++; area.width = 10
      return new Blob([new Uint8Array(VISION_LIMITS.imageBytes + 1)])
    }).mockResolvedValueOnce(blob())
    const image = await renderPublicVision(input, area)
    expect(render.mock.calls.map(call => call[2])).toEqual([768, 512])
    expect(render.mock.calls[1][0]).toBe(render.mock.calls[0][0])
    expect(image.boundsMm).toEqual(bounds())
  })

  it('returns no usable screenshot when cancelled while awaiting pixels or bytes', async () => {
    const controller = new AbortController()
    render.mockImplementation(async () => { controller.abort(); return blob() })
    await expect(renderPublicVision(project(), bounds(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const second = new AbortController()
    render.mockReset().mockResolvedValueOnce({ size: 20, arrayBuffer: async () => { second.abort(); return svgFixturePng().buffer } })
    await expect(renderPublicVision(project(), bounds(), second.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects a crop outside the complete export range before rendering', async () => {
    await expect(renderPublicVision(project(), { x: Number.MIN_SAFE_INTEGER, y: 0, width: 1, height: 1 })).rejects.toThrow(/截图范围/)
    expect(render).not.toHaveBeenCalled()
  })
})
