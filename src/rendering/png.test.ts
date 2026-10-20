import { describe, expect, it } from 'vitest'
import { createHouse } from '../core/seed'
import { PNG_MAX_LONG_EDGE, PNG_MAX_PIXELS, renderPng } from './png'

describe('PNG export boundaries', () => {
  it('rejects unsupported sizes before allocating a browser canvas', async () => {
    for (const longEdge of [0, 255, 4097, 8192, 1000.5, Number.NaN]) await expect(renderPng(createHouse(), 'gm', { longEdge })).rejects.toThrow('256–4096')
    expect(PNG_MAX_LONG_EDGE).toBe(4096)
    expect(PNG_MAX_PIXELS).toBe(16_777_216)
  })

  it('checks audience safety before trying to draw', async () => {
    const scene = createHouse()
    scene.regions = {}
    await expect(renderPng(scene, 'player')).rejects.toThrow('遮罩未覆盖')
  })

  it('fails clearly outside a canvas browser while preserving the document', async () => {
    const scene = createHouse()
    const before = structuredClone(scene)
    await expect(renderPng(scene, 'gm')).rejects.toThrow('Canvas 的浏览器')
    expect(scene).toEqual(before)
  })
})
