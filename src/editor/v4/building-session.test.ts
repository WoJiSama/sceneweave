import { describe, expect, it } from 'vitest'
import { parseBoundary, rectangleFromPoints, rectanglePoints, rulerDistance, snapBuildingPoint } from './building-session'

describe('建筑暂态坐标', () => {
  it('吸附整数毫米，并对负半步远离零量化', () => {
    expect(snapBuildingPoint({ x: -150, y: 149 }, 100)).toEqual({ x: -200, y: 100 })
    expect(snapBuildingPoint({ x: -.2, y: .2 }, 1)).toEqual({ x: 0, y: 0 })
    expect(() => snapBuildingPoint({ x: 1, y: 1 }, 0)).toThrow()
  })
  it('矩形不依赖点击顺序，允许检查零尺寸后再交领域拒绝', () => {
    const bounds = rectangleFromPoints({ x: 5000, y: 6000 }, { x: 1000, y: 2000 })
    expect(rectanglePoints(bounds)).toEqual([{ x: 1000, y: 2000 }, { x: 5000, y: 2000 }, { x: 5000, y: 6000 }, { x: 1000, y: 6000 }])
  })
  it('多边形输入拒绝分数/缺列，保留顶点次序交完整几何检查', () => {
    expect(parseBoundary('100,100; 600 100\n600，500')).toEqual([{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 500 }])
    expect(() => parseBoundary('0,0;1.5,0;1,2')).toThrow('整数毫米')
    expect(() => parseBoundary('0,0;1,0')).toThrow('3–128')
  })
  it('斜线量尺使用欧氏距离与原始分量，显示不改工程', () => {
    expect(rulerDistance({ x: 1000, y: 1000 }, { x: 4000, y: 5000 })).toEqual({ distanceMm: 5000, dxMm: 3000, dyMm: 4000 })
  })
})
