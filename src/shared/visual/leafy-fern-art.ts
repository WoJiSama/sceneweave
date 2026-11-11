import type { FixedPresentation } from '../terrain-generation/contracts.js'
import type { VisualSampleArt } from './sample-art.js'
import { freezeJson } from '../validation/json.js'

export const LEAFY_FERN_KEY = 'shrub-splayed-fern-leafy' as const
export const LEAFY_FERN_VERSION = 1 as const
export const LEAFY_FERN_ASSET_ID = 'leafy-fern-v1-art-shrub-splayed-fern-leafy'
export const LEAFY_FERN_DEFINITION_ID = 'leafy-fern-v1-prop-shrub-splayed-fern-leafy'
export const LEAFY_FERN_LICENSE_REF = 'MIT-Sceneweave-Leafy-Fern-1'
export const LEAFY_FERN_LICENSE = `Sceneweave Leafy Fern Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic SVG artwork created for Sceneweave with coding assistance. The filled pinnae, seven independent fronds and soft original color masses are authored in code. No reference-map pixels, third-party assets or externally generated images are embedded. This separate fixed source never replaces the six vegetation-detail-v1 artworks or their bytes.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

interface PixelPoint { x: number; y: number }
export interface LeafyFernPinna { start: PixelPoint; tip: PixelPoint; outwardControl: PixelPoint; inwardControl: PixelPoint; fill: string }
export interface LeafyFernArt extends VisualSampleArt { role:'shrub';rootPixel:PixelPoint;presentation:FixedPresentation }
const rootPixel = { x:256,y:288 }, rounded = (n: number) => Math.round(n*100)/100
const pixel = (x: number,y: number): PixelPoint => ({x:rounded(x),y:rounded(y)})
const coord = (p: PixelPoint) => `${p.x} ${p.y}`
const fronds = [{angle:-116,length:178},{angle:-74,length:204},{angle:-33,length:225},{angle:8,length:236},{angle:49,length:218},{angle:92,length:200},{angle:143,length:168}]
const colors = ['#7F9E69','#94AC78','#6F925F','#8AA671','#789A66','#9AB27F','#749361']
const pinnae: LeafyFernPinna[] = [], stems: string[] = []
for(const [branch,frond] of fronds.entries()) {
  const angle=frond.angle*Math.PI/180,ux=Math.sin(angle),uy=-Math.cos(angle),nx=Math.cos(angle),ny=Math.sin(angle)
  const end=pixel(rootPixel.x+ux*frond.length,rootPixel.y+uy*frond.length)
  stems.push(`<path d="M${coord(rootPixel)}L${coord(end)}" fill="none" stroke="#5D7F52" stroke-width="7" stroke-linecap="round"/>`)
  for(const along of [.18,.31,.44,.57,.70,.83,.93]) for(const side of [-1,1]) {
    const start=pixel(rootPixel.x+ux*frond.length*along,rootPixel.y+uy*frond.length*along),spread=58*(1-along)+12
    pinnae.push({start,tip:pixel(start.x+nx*side*spread+ux*16,start.y+ny*side*spread+uy*16),
      outwardControl:pixel(start.x+nx*side*spread*.55-ux*18,start.y+ny*side*spread*.55-uy*18),
      inwardControl:pixel(start.x+nx*side*spread*.50+ux*24,start.y+ny*side*spread*.50+uy*24),fill:colors[branch]})
  }
}
/** The actual filled SVG controls, also available for nondegenerate leaf-area checks. */
export const LEAFY_FERN_PINNAE: readonly LeafyFernPinna[] = freezeJson(pinnae)
const leaves = LEAFY_FERN_PINNAE.map(leaf=>`<path d="M${coord(leaf.start)}Q${coord(leaf.outwardControl)} ${coord(leaf.tip)}Q${coord(leaf.inwardControl)} ${coord(leaf.start)}Z" fill="${leaf.fill}" stroke="#638357" stroke-width="1.8" stroke-linejoin="round"/>`).join('')
const presentation: FixedPresentation = {mode:'topDown',rootAnchorMm:{x:0,y:0},orientation:'rotateWithGround',groundShadowMm:null}
export const LEAFY_FERN_ART: readonly LeafyFernArt[] = freezeJson([{
  key:LEAFY_FERN_KEY,name:'舒叶羽状蕨',kind:'prop',role:'shrub',widthMm:1200,heightMm:1250,rootPixel,
  footprintMm:{width:420,height:420},blocksMovement:false,blocksSight:false,renderLayer:'ground',shadowClass:'none',
  tags:['原创','蕨','灌木','shrub','fern','俯视','实心羽状叶','固定叶面v1'],presentation,
  sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${stems.join('')}${leaves}<path d="M239 292Q240 276 256 276Q271 277 274 291Q267 305 253 303Q242 303 239 292Z" fill="#6A8958"/><path d="M247 291Q253 281 262 287" fill="none" stroke="#ACBB88" stroke-width="4" stroke-linecap="round"/></svg>`,
}])
export const LEAFY_FERN_SPEC = freezeJson({key:LEAFY_FERN_KEY,name:LEAFY_FERN_ART[0].name,role:'shrub' as const,version:LEAFY_FERN_VERSION,
  catalogId:`prop.sceneweave.leafy-fern-v1.${LEAFY_FERN_KEY}`,assetId:LEAFY_FERN_ASSET_ID,definitionId:LEAFY_FERN_DEFINITION_ID,
  widthMm:1200,heightMm:1250,rootPixel,visualBoundsMm:{x:-600,y:-703,width:1200,height:1250},footprintMm:{width:420,height:420},
  blocksMovement:false,blocksSight:false,renderLayer:'ground' as const,shadowClass:'none' as const,presentation})
