import { describe, expect, it } from 'vitest'
import { createHouse } from '../core/seed'
import { drawProjection, mapPalette } from './draw'
import { projectScene } from './projection'

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: unknown[][] } {
  const calls: unknown[][] = []
  const ctx = new Proxy<Record<string, unknown>>({}, {
    get(target, key: string) {
      if (key === 'measureText') return (value: string) => ({ width: value.length * 200 })
      if (key in target) return target[key]
      return (...args: unknown[]) => { calls.push([key, ...args]) }
    },
    set(target, key: string, value) { calls.push(['set', key, value]); target[key] = value; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('shared world-coordinate drawing', () => {
  it('applies an opaque player mask after the final label and restores caller state', () => {
    const { ctx, calls } = recordingContext()
    drawProjection(ctx, projectScene(createHouse(), 'player'))
    expect(calls[0]).toEqual(['save'])
    expect(calls.at(-1)).toEqual(['restore'])
    expect(calls.some(call => call[0] === 'setTransform' || call[0] === 'clearRect')).toBe(false)
    const finalFill = calls.findLastIndex(call => call[0] === 'fill')
    const lastText = calls.findLastIndex(call => call[0] === 'fillText')
    expect(finalFill).toBeGreaterThan(lastText)
    expect(calls.slice(lastText + 1, finalFill)).toContainEqual(['set', 'fillStyle', mapPalette.background])
    expect(calls.slice(lastText + 1, finalFill)).toContainEqual(['set', 'globalAlpha', 1])
    expect(calls.filter(call => call[0] === 'fillText').map(call => call[1])).toEqual(['会客厅', '书房'])
  })

  it('makes the exact same canvas calls for paired scenes with different secrets', () => {
    const scene = createHouse('same')
    const variant = structuredClone(scene)
    variant.vertices['v-g7'].yMm = 1900
    variant.vertices['v-h8'].yMm = 1900
    variant.notes['n-c3'].text = '秘密内容已改变'
    variant.props['p-h8'].rotationDeg = 30
    variant.openings['o-c3'].state = 'open'
    const a = recordingContext(), b = recordingContext()
    drawProjection(a.ctx, projectScene(scene, 'player'))
    drawProjection(b.ctx, projectScene(variant, 'player'))
    expect(a.calls).toEqual(b.calls)
  })

  it('honours the same grid and label switches for preview and PNG', () => {
    const { ctx, calls } = recordingContext()
    drawProjection(ctx, projectScene(createHouse(), 'gm'), { grid: false, labels: false })
    expect(calls.some(call => call[0] === 'fillText')).toBe(false)
    expect(calls).not.toContainEqual(['set', 'strokeStyle', mapPalette.grid])
  })
})
