import { describe, expect, it } from 'vitest'
import { connectionPoints, newConnectionRouteDraft, readConnectionRoute, routeControlText } from './ConnectionRouteFields'

describe('connection route coordinate drafts', () => {
  it('preserves exact classic endpoints and polyline bends with existing separators', () => {
    const text = ' -1000 , 0 \r\n1000，0\n1000 2000'
    const points = connectionPoints(text)
    expect(points).toEqual([{ x: -1000, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 2000 }])
    expect(readConnectionRoute('-1000.0,0\n1e3 0', newConnectionRouteDraft())).toEqual({ points: points.slice(0, 2) })
    const result = readConnectionRoute(text, { ...newConnectionRouteDraft(), mode: 'polyline' })
    expect(result.points).toEqual([points[0], points[2]])
    expect(result.route!.centerlineMm).toContainEqual(points[1])
  })

  it('rejects omitted endpoint components in classic and polyline modes', () => {
    for (const mode of ['classic', 'polyline'] as const) {
      for (const row of ['1000,', ',1000', '1000,,2000', '1000， ，2000']) {
        expect(() => readConnectionRoute(`0,0\n${row}`, { ...newConnectionRouteDraft(), mode })).toThrow('第2行')
      }
    }
  })

  it('round trips complete cubic control sources without changing their coordinates', () => {
    const draft = { ...newConnectionRouteDraft(), mode: 'cubic' as const, controls: '0，0；1000 0 ; 2000,1000 ; 3000，1000' }
    const route = readConnectionRoute('', draft).route!
    expect(route.segments[0]).toMatchObject({ start: { x: 0, y: 0 }, control1: { x: 1000, y: 0 }, control2: { x: 2000, y: 1000 }, end: { x: 3000, y: 1000 } })
    expect(readConnectionRoute('', { ...draft, controls: routeControlText(route.segments) }, route).route).toEqual(route)
  })

  it('rejects missing cubic components before materializing a route', () => {
    for (const controls of [
      ',0;1000,0;2000,1000;3000,1000',
      '0,0;1000,0;2000,1000;3000,',
      '0,,0;1000,0;2000,1000;3000,1000',
      '0,0;;1000,0;2000,1000;3000,1000',
      '0,0;1000， ，0;2000,1000;3000,1000',
    ]) {
      expect(() => readConnectionRoute('', { ...newConnectionRouteDraft(), mode: 'cubic', controls })).toThrow('第1段')
    }
  })
})
