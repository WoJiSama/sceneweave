import { describe, expect, it } from 'vitest'
import { outdoorCoordinateSummary, outdoorPoints, pointText } from './outdoor-coordinates'

describe('outdoor coordinate drafts', () => {
  it('preserves negative integer-mm coordinates and accepts both existing separators', () => {
    const points = outdoorPoints('-1000, 250;3000，250\n3000 2250')
    expect(points).toEqual([{ x: -1000, y: 250 }, { x: 3000, y: 250 }, { x: 3000, y: 2250 }])
    expect(outdoorPoints(pointText(points))).toEqual(points)
  })
  it('keeps incomplete, decimal and oversized inputs out of geometry commands', () => {
    expect(() => outdoorPoints('0,0\n1000,0')).toThrow('3–2048')
    expect(() => outdoorPoints('0,0\n1000.1,0\n1000,1000')).toThrow('第 2 行')
    expect(() => outdoorPoints('0,0\n9007199254740992,0\n1000,1000')).toThrow('第 2 行')
    expect(() => outdoorPoints(Array(2049).fill('0,0').join('\n'))).toThrow('3–2048')
  })
  it('rejects missing coordinates without silently filling zero or removing punctuation', () => {
    for (const row of ['1,', ',1', '1,,2', '1， ，2', '1, ,2']) {
      const text = `0,0\n${row}\n1000,1000`
      expect(() => outdoorPoints(text)).toThrow('第 2 行')
      expect(outdoorCoordinateSummary(text, 3, 'm')).toContain('坐标待完善')
    }
  })
  it('distinguishes an empty draft, incomplete drawing and malformed coordinates', () => {
    expect(outdoorCoordinateSummary('', 3, 'm')).toContain('尚未取点')
    expect(outdoorCoordinateSummary('0,0\n1000,0', 3, 'm')).toBe('已取 2 个点，还需至少 1 个点。')
    expect(outdoorCoordinateSummary('bad input', 3, 'm')).toContain('坐标待完善')
  })
  it('summarizes metres or feet while retaining the same source coordinates', () => {
    const text = '-1000,250\n3000,250\n3000,2250'
    expect(outdoorCoordinateSummary(text, 3, 'm')).toBe('3 个点 · 范围 4 × 2 m')
    expect(outdoorCoordinateSummary(text, 3, 'ft')).toBe('3 个点 · 范围 13.123 × 6.562 ft')
    expect(outdoorCoordinateSummary('-9007199254740991,0\n9007199254740991,1', 2, 'm')).toContain('预览时校验')
  })
})
