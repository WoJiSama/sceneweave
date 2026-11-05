import type { FixedPresentation } from '../terrain-generation/contracts.js'
import type { VisualSampleArt } from './sample-art.js'
import { freezeJson } from '../validation/json.js'

export interface TerrainVariantV2Art extends VisualSampleArt {
  role: 'tree'
  presentation: FixedPresentation
}

export const TERRAIN_VARIANT_V2_LICENSE_REF = 'MIT-Sceneweave-Terrain-Variants-2'

const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path d="M243 443Q251 406 239 354L216 305L233 296L258 337L279 286L298 294L274 356Q267 405 279 443L260 451Z" fill="#9A8057" stroke="#53634D" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M251 435L255 366M242 444L224 453M276 443L291 452" fill="none" stroke="#C3AA7B" stroke-width="3" stroke-linecap="round"/>
  <path d="M115 307Q91 293 104 269Q83 247 103 224Q95 199 120 184Q119 157 147 150Q159 122 188 132Q205 108 230 124Q252 105 272 127Q300 115 313 139Q343 136 351 164Q381 173 376 201Q400 222 383 245Q391 273 366 288Q360 318 332 318Q313 338 287 322Q264 341 241 323Q214 341 193 319Q160 331 147 311Z" fill="#78976A" stroke="#53634D" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M111 270Q137 282 159 267Q183 287 207 269Q231 287 255 270Q281 287 305 268Q337 284 376 259L368 286Q356 307 332 302Q313 325 289 306Q265 325 242 306Q216 326 194 302Q165 318 149 296Q124 302 111 283Z" fill="#5E8054"/>
  <path d="M125 204Q140 174 171 179Q173 150 201 154Q223 131 245 151Q271 134 289 156Q321 151 332 179Q357 187 359 211Q336 225 314 209Q292 226 270 207Q248 225 226 207Q200 225 180 206Q153 222 133 212Z" fill="#A5BB80"/>
  <path d="M147 238Q167 223 189 238M211 245Q233 229 253 244M276 238Q300 222 323 237M164 278Q185 262 207 277M250 286Q272 265 294 281M322 272Q340 260 356 267" fill="none" stroke="#C5CF91" stroke-width="3" stroke-linecap="round" opacity=".72"/>
  <path d="M197 266q24 -18 49 -8M278 259q20 -15 39 -7M157 250q15 -12 30 -8" fill="none" stroke="#5B7151" stroke-width="3" stroke-linecap="round" opacity=".72"/>
</svg>`

const widthMm = 1300
const heightMm = 1450
const footprintMm = { width: 320, height: 320 }
const rootY = 440

export const TERRAIN_VARIANT_V2_ART: readonly TerrainVariantV2Art[] = freezeJson([{
  key: 'tree-highland-copse', name: '高台紧凑冠树', kind: 'prop', role: 'tree', sourceSvg,
  widthMm, heightMm, footprintMm, blocksMovement: true, blocksSight: true,
  renderLayer: 'canopy', shadowClass: 'vegetation',
  tags: ['原创', '地形变体v2', 'tree', '树木', '近侧视', 'fixed-upright'],
  presentation: {
    mode: 'nearSide', rootAnchorMm: { x: 0, y: Math.round((rootY / 512 - 0.5) * heightMm) },
    orientation: 'fixedUpright', fixedRotationDeg: 0, footprintAxes: 'world',
    groundShadowMm: [
      { x: -176, y: -144 }, { x: 176, y: -144 }, { x: 176, y: 144 }, { x: -176, y: 144 },
    ],
  },
}])

export const TERRAIN_VARIANT_V2_LICENSE = 'MIT License\n\nSceneweave Terrain Variant Artwork, version 2\nCopyright (c) 2026 Sceneweave contributors\n\nOriginal deterministic SVG artwork for the compact highland tree, created for Sceneweave with coding assistance. It is an independent source with fixed image dimensions, root anchor, physical footprint, presentation and actual PNG; it does not reuse reference-map pixels, traced imagery or third-party assets. This source is registered separately from terrain-variants-v1 so the earlier fixed catalogue and recipe remain unchanged.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
