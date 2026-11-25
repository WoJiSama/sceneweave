import earcut from 'earcut'
import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import type { ObliqueCamera } from './oblique-camera'
export type SpatialPoint = [number, number, number]
export type SpatialColor = [number, number, number]
type UV = [number, number]
type TextureSource = HTMLCanvasElement | ImageBitmap
export interface MeshMask { image: HTMLCanvasElement; bounds: BoundsMm }
interface WallFade { center: PointMm; nearSide: PointMm }
export interface MeshMaterial {
  image?: TextureSource
  color?: SpatialColor
  opacity?: number
  alphaCutoff?: number
  repeat?: boolean
  unlit?: boolean
  wall?: WallFade
  canopy?: PointMm
  coverage?: MeshMask
  privacy?: MeshMask
}

const radians = (n: number) => n * Math.PI / 180
const unit = (p: SpatialPoint): SpatialPoint => {
  const length = Math.hypot(...p) || 1
  return [p[0] / length, p[1] / length, p[2] / length]
}
export const atHeight = (point: PointMm, z: number): SpatialPoint => [point.x, point.y, z]
export const rectangle = ({ x, y, width, height }: BoundsMm): PointMm[] =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]

export class ObliqueMesh {
  readonly batches = new Map<MeshMaterial, number[]>()
  private readonly materialAliases = new WeakMap<MeshMaterial, MeshMaterial>()
  private readonly opaqueMaterials = new Map<string, MeshMaterial>()
  private readonly objectIds = new WeakMap<object, number>()
  readonly materialLights = new WeakMap<MeshMaterial, SpatialPoint>()
  private light?: SpatialPoint
  private nextObjectId = 0
  bottom = 0
  top = 0
  private vertexCount = 0

  get triangleCount() { return this.vertexCount / 3 }

  useLight(direction: SpatialPoint) { this.light = direction }

  materialKey(material: MeshMaterial, light?: SpatialPoint) {
    const objectId = (value: object | undefined) => {
      if (!value) return 0
      let id = this.objectIds.get(value)
      if (!id) { id = ++this.nextObjectId; this.objectIds.set(value, id) }
      return id
    }
    return JSON.stringify([objectId(material.image), material.color ?? [1, 1, 1], !!material.repeat, !!material.unlit,
      material.alphaCutoff ?? .22, objectId(material.coverage), objectId(material.privacy), material.unlit ? null : light ?? null])
  }

  private batchMaterial(material: MeshMaterial) {
    // Layers that can fade retain their independent sorting and visibility.
    if (material.wall || material.canopy || (material.opacity ?? 1) < .998) return material
    const alias = this.materialAliases.get(material)
    if (alias) return alias
    const key = this.materialKey(material, this.light), existing = this.opaqueMaterials.get(key) ?? material
    this.opaqueMaterials.set(key, existing)
    this.materialAliases.set(material, existing)
    return existing
  }

  triangle(material: MeshMaterial, points: [SpatialPoint, SpatialPoint, SpatialPoint], uv: [UV, UV, UV], normal?: SpatialPoint) {
    if (this.vertexCount + 3 > 900_000) throw new Error('斜俯视几何超出预览预算，请缩小楼层内容后再试。')
    this.vertexCount += 3
    const [a, b, c] = points
    const u: SpatialPoint = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v: SpatialPoint = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = normal ?? unit([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]])
    material = this.batchMaterial(material)
    let vertices = this.batches.get(material)
    if (!vertices) {
      if (this.light && !material.unlit) this.materialLights.set(material, this.light)
      vertices = []
      this.batches.set(material, vertices)
    }
    for (let i = 0; i < 3; i++) {
      vertices.push(...points[i], ...n, ...uv[i])
      this.bottom = Math.min(this.bottom, points[i][2])
      this.top = Math.max(this.top, points[i][2])
    }
  }

  quad(material: MeshMaterial, [a, b, c, d]: [SpatialPoint, SpatialPoint, SpatialPoint, SpatialPoint],
    [ta, tb, tc, td]: [UV, UV, UV, UV] = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    this.triangle(material, [a, b, c], [ta, tb, tc])
    this.triangle(material, [a, c, d], [ta, tc, td])
  }

  cap(material: MeshMaterial, rings: readonly PointMm[][], height: (p: PointMm) => number, uv: (p: PointMm) => UV) {
    if (!rings[0]?.length) return
    const points = rings.flat(), holes = []
    let count = rings[0].length
    for (const hole of rings.slice(1)) { holes.push(count); count += hole.length }
    const faces = earcut(points.flatMap(p => [p.x, p.y]), holes)
    for (let i = 0; i < faces.length; i += 3) {
      const a = points[faces[i]], b = points[faces[i + 1]], c = points[faces[i + 2]]
      this.triangle(material, [atHeight(a, height(a)), atHeight(b, height(b)), atHeight(c, height(c))], [uv(a), uv(b), uv(c)])
    }
  }

  side(material: MeshMaterial, a: PointMm, b: PointMm, lowA: number, lowB: number, highA: number, highB: number,
    tileMm = 800, fittedUv?: [number, number]) {
    if (highA === lowA && highB === lowB) return
    const length = Math.hypot(b.x - a.x, b.y - a.y) / tileMm
    const aLow = atHeight(a, lowA), bLow = atHeight(b, lowB), aHigh = atHeight(a, highA), bHigh = atHeight(b, highB)
    const aUv: UV = [fittedUv?.[0] ?? 0, fittedUv ? 1 : (highA - lowA) / tileMm]
    const bUv: UV = [fittedUv?.[1] ?? length, fittedUv ? 1 : (highB - lowB) / tileMm]
    const aTop: UV = [aUv[0], 0], bTop: UV = [bUv[0], 0]
    if (highA !== lowA) this.triangle(material, [aLow, bLow, aHigh], [aUv, bUv, aTop])
    if (highB !== lowB) this.triangle(material, [bLow, bHigh, aHigh], [bUv, bTop, aTop])
  }

  solid(material: MeshMaterial, polygon: PointMm[], low: number, high: number, tileMm = 800, cap = true, sideTexture?: MeshMaterial) {
    if (high <= low) return
    const origin = polygon[0]
    if (!origin) return
    const area = polygon.reduce((sum, a, i) => {
      const b = polygon[(i + 1) % polygon.length]
      return sum + (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
    }, 0)
    if (area < 0) polygon = [...polygon].reverse()
    const span = (i: number) => {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length]
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    const perimeter = sideTexture && polygon.length > 4 ? polygon.reduce((sum, _, i) => sum + span(i), 0) : 0
    let distance = 0
    for (let i = 0; i < polygon.length; i++) {
      const next = perimeter ? distance + span(i) : 0
      const uv: [number, number] | undefined = sideTexture ? perimeter ? [distance / perimeter, next / perimeter] : [0, 1] : undefined
      this.side(sideTexture ?? material, polygon[i], polygon[(i + 1) % polygon.length], low, low, high, high, tileMm, uv)
      distance = next
    }
    if (cap) this.cap(material, [polygon], () => high, p => [p.x / tileMm, p.y / tileMm])
  }
}

const vertexSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec2 aUv;
  uniform vec3 uCenter;
  uniform vec2 uYaw, uPitch, uScale;
  uniform float uDepth;
  varying vec3 vNormal;
  varying vec2 vUv, vWorld;
  void main() {
    vec3 p = aPosition - uCenter;
    float x = dot(p.xy, uYaw);
    float y = dot(p.xy, vec2(-uYaw.y, uYaw.x));
    float depth = y*uPitch.y + p.z*uPitch.x;
    gl_Position = vec4(x*uScale.x, (p.z*uPitch.y-y*uPitch.x)*uScale.y, -depth/uDepth, 1.0);
    vNormal = aNormal;
    vUv = aUv;
    vWorld = aPosition.xy;
  }
`

const fragmentSource = `
  precision highp float;
  uniform sampler2D uImage, uCoverage, uPrivacy;
  uniform vec4 uCoverageBounds, uPrivacyBounds;
  uniform vec3 uColor, uSun;
  uniform float uOpacity, uRepeat, uUnlit, uAlphaCutoff;
  varying vec3 vNormal;
  varying vec2 vUv, vWorld;
  void main() {
    vec2 coverageUv = (vWorld-uCoverageBounds.xy)/uCoverageBounds.zw;
    if (texture2D(uCoverage, coverageUv).a < .01) discard;
    vec2 privacyUv = (vWorld-uPrivacyBounds.xy)/uPrivacyBounds.zw;
    if (texture2D(uPrivacy, privacyUv).a > .001) discard;
    vec4 texel = texture2D(uImage, uRepeat > .5 ? fract(vUv) : vUv);
    if (texel.a < uAlphaCutoff) discard;
    vec3 n = normalize(vNormal);
    float shade = mix(.66 + .43*max(0.0,dot(n,uSun)), 1.0, uUnlit);
    gl_FragColor = vec4(texel.rgb/texel.a*uColor*shade, uOpacity*texel.a);
  }
`

function compile(gl: WebGLRenderingContext | WebGL2RenderingContext, program: WebGLProgram, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(message ?? '斜俯视着色器不可用。')
  }
  gl.attachShader(program, shader)
  gl.deleteShader(shader)
}

/** One context owns the buffers and textures for the mounted preview. Camera changes
 * only update uniforms and translucent wall order. */
export function mountObliqueMesh(canvas: HTMLCanvasElement, mesh: ObliqueMesh, bounds: BoundsMm, sun: SpatialPoint, background: SpatialColor) {
  const options = { alpha: false, antialias: true, preserveDrawingBuffer: true }
  const gl2 = canvas.getContext('webgl2', options) as WebGL2RenderingContext | null
  const gl = gl2 ?? (canvas.getContext('webgl', options) as WebGLRenderingContext | null)
  if (!gl) throw new Error('当前设备无法准备 3D 预览。')
  const textures = {
    color: new Map<TextureSource | undefined | null, WebGLTexture>(),
    repeat: new Map<TextureSource | undefined | null, WebGLTexture>(),
    mask: new Map<TextureSource | undefined | null, WebGLTexture>(),
  }
  const colorDetails = new Map<TextureSource, WebGLTexture>()
  const buffers: WebGLBuffer[] = []
  const program = gl.createProgram()!
  const dispose = () => {
    for (const cache of Object.values(textures)) for (const texture of cache.values()) gl.deleteTexture(texture)
    for (const texture of colorDetails.values()) gl.deleteTexture(texture)
    for (const buffer of buffers) gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  try {
    compile(gl, program, gl.VERTEX_SHADER, vertexSource)
    compile(gl, program, gl.FRAGMENT_SHADER, fragmentSource)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? '无法载入 3D 预览。')
    gl.useProgram(program)
    const names = ['uCenter', 'uYaw', 'uPitch', 'uScale', 'uDepth', 'uSun', 'uImage', 'uCoverage', 'uPrivacy', 'uCoverageBounds', 'uPrivacyBounds', 'uColor', 'uOpacity', 'uRepeat', 'uUnlit', 'uAlphaCutoff'] as const
    const u = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)])) as Record<typeof names[number], WebGLUniformLocation>
    const attributes = [['aPosition', 3, 0], ['aNormal', 3, 3], ['aUv', 2, 6]].map(([name, size, offset]) =>
      ({ index: gl.getAttribLocation(program, String(name)), size: Number(size), offset: Number(offset) }))
    const powerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0
    const canMip = (image: TextureSource) => !!gl2 || (powerOfTwo(image.width) && powerOfTwo(image.height))
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic')
    const maxAnisotropy = anisotropy ? Math.min(4, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    const createTexture = (image: TextureSource | undefined | null, mode: keyof typeof textures) => {
      if (image && Math.max(image.width, image.height) > maxTextureSize) throw new Error('贴图尺寸超过当前 3D 设备上限。')
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      // ImageBitmap uses the decode options. Canvas uploads use the same
      // premultiplied representation so filtered transparent edges keep their color.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
      if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, image === null ? 0 : 255]))
      // Keep privacy and coverage lookups at their original resolution.
      const sampled = image && mode !== 'mask' && canMip(image)
      if (sampled) {
        gl.generateMipmap(gl.TEXTURE_2D)
        if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampled ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      const wrap = sampled && mode === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
      return texture
    }
    const upload = (image: TextureSource | undefined | null, mode: keyof typeof textures) => {
      const cache = textures[mode]
      const saved = cache.get(image)
      if (saved) return saved
      const texture = createTexture(image, mode)
      cache.set(image, texture)
      return texture
    }
    const defaultLight = unit(sun)
    type BatchEntry = [MeshMaterial, number[]]
    const singles: BatchEntry[] = [], crowns = new Map<string, BatchEntry[]>()
    for (const entry of mesh.batches) {
      const [material] = entry, { canopy, opacity = 1 } = material
      if (!canopy || opacity < .998) { singles.push(entry); continue }
      const cellX = Math.floor((canopy.x - bounds.x) / bounds.width * 4), cellY = Math.floor((canopy.y - bounds.y) / bounds.height * 4)
      const key = JSON.stringify([cellX, cellY, mesh.materialKey(material, mesh.materialLights.get(material))])
      const group = crowns.get(key)
      if (group) group.push(entry)
      else crowns.set(key, [entry])
    }
    const buffer = gl.createBuffer()!
    buffers.push(buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    const values = new Float32Array(mesh.triangleCount * 24)
    let cursor = 0
    const addBatch = ([material, vertices]: BatchEntry) => {
      const first = cursor / 8
      // Express positions relative to the output origin before float upload.
      // This preserves millimetre detail on maps authored far from zero.
      const min: SpatialPoint = [Infinity, Infinity, Infinity], max: SpatialPoint = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < vertices.length; i += 8, cursor += 8) {
        values[cursor] = vertices[i] - bounds.x
        values[cursor + 1] = vertices[i + 1] - bounds.y
        for (let j = 2; j < 8; j++) values[cursor + j] = vertices[i + j]
        for (let j = 0; j < 3; j++) {
          min[j] = Math.min(min[j], values[cursor + j])
          max[j] = Math.max(max[j], values[cursor + j])
        }
      }
      const shaderRepeat = material.repeat && material.image && !canMip(material.image)
      const center = min.map((n, i) => (n + max[i]) / 2) as SpatialPoint
      const radius = min.map((n, i) => (max[i] - n) / 2) as SpatialPoint
      return { material, first, center, radius, count: vertices.length / 8, light: mesh.materialLights.get(material) ?? defaultLight,
        image: upload(material.image, material.repeat ? 'repeat' : 'color'),
        coverage: upload(material.coverage?.image, 'mask'), privacy: upload(material.privacy?.image ?? null, 'mask'), shaderRepeat }
    }
    const fixed = singles.map(addBatch)
    const individualCrowns: ReturnType<typeof addBatch>[] = [], combinedCrowns: ReturnType<typeof addBatch>[] = []
    for (const entries of crowns.values()) {
      const rows = entries.map(addBatch)
      individualCrowns.push(...rows)
      const first = rows[0]
      const min = first.center.map((_, i) => Math.min(...rows.map(row => row.center[i] - row.radius[i])))
      const max = first.center.map((_, i) => Math.max(...rows.map(row => row.center[i] + row.radius[i])))
      combinedCrowns.push({ ...first, material: { ...first.material, canopy: undefined },
        center: min.map((n, i) => (n + max[i]) / 2) as SpatialPoint,
        radius: min.map((n, i) => (max[i] - n) / 2) as SpatialPoint,
        count: rows.reduce((total, row) => total + row.count, 0) })
    }
    const individualBatches = fixed.concat(individualCrowns), combinedBatches = fixed.concat(combinedCrowns)
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW)
    for (const { index, size, offset } of attributes) {
      gl.enableVertexAttribArray(index)
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 32, offset * 4)
    }
    let detailed = false
    const setDetailed = (value: boolean) => { detailed = value }
    const replaceColorDetail = (source: TextureSource, image: TextureSource) => {
      if (!textures.color.has(source)) return
      const texture = createTexture(image, 'color')
      if (gl.getError() !== gl.NO_ERROR) {
        gl.deleteTexture(texture)
        throw new Error('设备未能载入更清晰的地面贴图。')
      }
      const previous = colorDetails.get(source)
      colorDetails.set(source, texture)
      if (previous) gl.deleteTexture(previous)
    }
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniform1i(u.uImage, 0)
    gl.uniform1i(u.uCoverage, 1)
    gl.uniform1i(u.uPrivacy, 2)
    const maskBounds = (uniform: WebGLUniformLocation, box?: BoundsMm) =>
      gl.uniform4f(uniform, (box?.x ?? bounds.x) - bounds.x, (box?.y ?? bounds.y) - bounds.y, box?.width ?? 1, box?.height ?? 1)
    let activeLight: SpatialPoint | undefined
    const drawBatch = ({ material, first, count, light, image, coverage, privacy, shaderRepeat }: ReturnType<typeof addBatch>, opacity: number) => {
      const detail = detailed && material.image ? colorDetails.get(material.image) : undefined
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, detail || image)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coverage)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, privacy)
      maskBounds(u.uCoverageBounds, material.coverage?.bounds)
      maskBounds(u.uPrivacyBounds, material.privacy?.bounds)
      gl.uniform3fv(u.uColor, material.color ?? [1, 1, 1])
      gl.uniform1f(u.uOpacity, opacity)
      gl.uniform1f(u.uAlphaCutoff, material.alphaCutoff ?? .22)
      gl.uniform1f(u.uRepeat, Number(!!shaderRepeat))
      gl.uniform1f(u.uUnlit, Number(!!material.unlit))
      if (activeLight !== light) {
        gl.uniform3fv(u.uSun, light)
        activeLight = light
      }
      gl.drawArrays(gl.TRIANGLES, first, count)
    }
    const draw = (camera: ObliqueCamera) => {
      if (gl.isContextLost()) throw new Error('3D 预览设备已断开，请重新打开预览。')
      const yaw = radians(camera.azimuthDeg), pitch = radians(camera.elevationDeg)
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
      const spanX = Math.abs(cy) * bounds.width + Math.abs(sy) * bounds.height
      const spanY = (Math.abs(sy) * bounds.width + Math.abs(cy) * bounds.height) * sp + (mesh.top - mesh.bottom) * cp
      const scale = .92 * camera.zoom * Math.min(canvas.width / spanX, canvas.height / spanY)
      const center = camera.targetMm ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      const centerX = center.x - bounds.x, centerY = center.y - bounds.y, centerZ = (mesh.top + mesh.bottom) * .5
      const halfWidth = canvas.width / (2 * scale), halfHeight = canvas.height / (2 * scale)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(...background, 1)
      gl.depthMask(true)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniform3f(u.uCenter, centerX, centerY, centerZ)
      gl.uniform2f(u.uYaw, cy, sy)
      gl.uniform2f(u.uPitch, sp, cp)
      gl.uniform2f(u.uScale, 2 * scale / canvas.width, 2 * scale / canvas.height)
      gl.uniform1f(u.uDepth, Math.hypot(bounds.width, bounds.height, mesh.top - mesh.bottom) * 4)
      gl.disable(gl.BLEND)
      const batches = camera.fadeCanopy && camera.zoom > 1.16 ? individualBatches : combinedBatches
      const translucent: { batch: ReturnType<typeof addBatch>; opacity: number; depth: number }[] = []
      let drawCalls = 0, drawnTriangles = 0
      for (const batch of batches) {
        const x = batch.center[0] - centerX, y = batch.center[1] - centerY, z = batch.center[2] - centerZ
        const across = x * cy + y * sy, along = y * cy - x * sy
        const [rx, ry, rz] = batch.radius
        if (Math.abs(across) > halfWidth + rx * Math.abs(cy) + ry * Math.abs(sy)
          || Math.abs(z * cp - along * sp) > halfHeight + rz * cp + (rx * Math.abs(sy) + ry * Math.abs(cy)) * sp) continue
        const { wall, canopy, opacity = 1 } = batch.material
        const point = wall?.center ?? canopy ?? center
        const distance = Math.hypot((point.x - center.x) / bounds.width, (point.y - center.y) / bounds.height)
        const close = Math.max(0, Math.min(1, (camera.zoom - 1.16) * 1.4)) * Math.max(0, 1 - distance * camera.zoom)
        const facing = wall ? Math.max(0, wall.nearSide.x * -sy + wall.nearSide.y * cy) : 0
        const fade = wall ? close * facing * .9 : canopy && camera.fadeCanopy ? close * .9 : 0
        const alpha = opacity * (1 - fade)
        if (alpha <= 0) continue
        drawCalls++; drawnTriangles += batch.count / 3
        if (alpha < .998) translucent.push({ batch, opacity: alpha, depth: along * cp + z * sp })
        else drawBatch(batch, 1)
      }
      gl.enable(gl.BLEND)
      gl.depthMask(false)
      for (const row of translucent.sort((a, b) => a.depth - b.depth)) drawBatch(row.batch, row.opacity)
      gl.depthMask(true)
      if (gl.getError() !== gl.NO_ERROR) throw new Error('设备未能完成 3D 绘制。')
      return { drawCalls, drawnTriangles }
    }
    return { draw, dispose, maxTextureSize, replaceColorDetail, setDetailed, batchCount: combinedBatches.length }
  } catch (error) {
    dispose()
    throw error
  }
}
