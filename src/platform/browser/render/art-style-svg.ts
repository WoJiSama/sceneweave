import { normalizeStaticSvg, type NormalizedStaticSvg } from '../../../shared/ai/svg.js'
import type { SvgAuthoringSource } from '../../../shared/model/project.js'
import type { ActiveArtStyle } from '../../../shared/visual/art-style.js'
import { decodeUtf8, sha256Bytes } from '../../../shared/project/binary.js'

export function checkArtStyleSvg(bytes: Uint8Array, source: SvgAuthoringSource): NormalizedStaticSvg {
  if (bytes.length !== source.normalizedSizeBytes || sha256Bytes(bytes) !== source.normalizedSha256) throw new Error('画风使用的 SVG 源字节与固定记录不一致。')
  const svg = normalizeStaticSvg(decodeUtf8(bytes))
  if (svg.normalizedSha256 !== source.normalizedSha256) throw new Error('画风使用的 SVG 源未按固定格式规范化。')
  return svg
}

export function colorArtStyleSvg(svg: NormalizedStaticSvg, { preset, parameters }: ActiveArtStyle): NormalizedStaticSvg {
  const tea = preset === 'tea', depth = parameters.depth / 100, ink = parameters.ink / 100
  const paint = svg.normalizedSource.replace(/ (fill|stroke|stop-color)="#([\da-f]{3,8})"/g, (_, channel: string, value: string) => {
    const hex = value.length <= 4 ? [...value].map(digit => digit + digit).join('') : value
    const rgb = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
    const lightness = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255
    const fillTone = depth * (tea ? -48 * (1 - lightness) ** 2 + 14 * lightness : 25 * Math.sin(lightness * Math.PI))
    // Existing stroke geometry gains pigment without thickening into nearby holes.
    const strokeTone = channel === 'stroke' ? ink * (tea ? -16 : -28) : 0
    const coolPaper = !tea && channel !== 'stroke' ? depth * 9 * lightness : 0
    const saturation = 1 - depth * (tea ? .13 : .24)
    const values = rgb.map(value => value * saturation + lightness * 255 * (1 - saturation) + fillTone + strokeTone + coolPaper)
    const colored = values.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')
    return ` ${channel}="#${colored}${hex.slice(6)}"`
  })
  return normalizeStaticSvg(paint)
}
