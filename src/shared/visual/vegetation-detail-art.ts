import type { FixedPresentation } from '../terrain-generation/contracts.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

export type VegetationDetailRole = 'tree' | 'shrub' | 'grass'
export interface VegetationDetailArt extends VisualSampleArt {
  role: VegetationDetailRole
  presentation: FixedPresentation
  /** Root in the fixed 512-square SVG, mapped to instance world position. */
  rootPixel: { x: number; y: number }
}
export const VEGETATION_DETAIL_VERSION = 1 as const
export const VEGETATION_DETAIL_LICENSE_REF = 'MIT-Sceneweave-Vegetation-Detail-1'
export const VEGETATION_DETAIL_LICENSE = `Sceneweave Vegetation Detail Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic SVG artwork created for Sceneweave with coding assistance. No reference-map pixels or third-party assets are embedded. The six silhouettes, dimensions and physical footprints form a separate fixed batch; existing artwork is not replaced.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
const outline = 'stroke="#465C47" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"'
const root = '<path d="M246 274L254 235L267 273M253 259L228 244M259 258L282 238" fill="none" stroke="#766B49" stroke-width="8" stroke-linecap="round"/>'
const leafMarks = (rows: readonly (readonly [number, number, number])[]) => rows.map(([x, y, radius], index) =>
  `<path d="M${x-radius} ${y}q${radius*.7} ${-radius*.7} ${radius} ${-radius*.2}q${radius*.65} ${-radius*.5} ${radius*.9} 1M${x-radius*.35} ${y+radius*.5}l${radius*.5} ${-radius*.35}" fill="none" stroke="${index%3===0?'#CBD09A':'#B6C180'}" stroke-width="3" stroke-linecap="round" opacity=".65"/>`).join('')
function art(key: string, name: string, role: VegetationDetailRole, body: string, widthMm: number, heightMm: number,
  footprintMm: { width: number; height: number }, ground = false, rootY = 256): VegetationDetailArt {
  return { key, name, kind: 'prop', role, sourceSvg: svg(body), widthMm, heightMm, footprintMm, rootPixel: { x: 256, y: rootY },
    blocksMovement: role === 'tree', blocksSight: role === 'tree', renderLayer: role === 'tree' ? 'canopy' : ground ? 'ground' : 'object',
    shadowClass: role === 'tree' || !ground ? 'vegetation' : 'none',
    tags: ['原创', '植被细节v1', role, role === 'tree' ? '树木' : role === 'shrub' ? '灌木与蕨' : '草簇', '俯视', '固定轮廓与占地'],
    presentation: { mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null } }
}

const broadOak = art('tree-spreading-oak', '裂叶阔冠栎', 'tree',
  `<path d="M45 264Q22 234 58 209Q37 176 78 161Q64 122 113 116Q126 77 165 95Q192 61 225 89Q257 58 288 87Q330 58 351 96Q395 78 408 119Q459 121 447 161Q487 181 460 217Q493 250 456 274Q469 313 427 326Q424 369 380 356Q353 402 315 372Q278 408 246 378Q206 409 176 377Q128 396 117 354Q67 366 69 320Q28 309 45 264Z" fill="#768B5A" ${outline}/>
  <path d="M57 243Q102 266 133 244Q163 270 196 246Q227 277 261 252Q301 277 331 250Q369 271 401 246Q426 264 460 236L455 277Q470 310 424 319Q423 356 384 344Q355 385 316 360Q277 391 246 367Q204 393 178 365Q135 382 125 344Q80 354 79 316Q47 307 57 280Z" fill="#5E764D"/>
  <path d="M90 174Q113 144 147 157Q148 119 183 132Q205 101 237 122Q267 95 296 121Q329 98 350 133Q389 119 408 155Q377 178 347 161Q312 184 281 165Q246 187 216 167Q183 187 154 168Q125 184 104 174Z" fill="#A4B577"/>
  ${root}${leafMarks([[91,218,22],[153,152,24],[219,144,25],[289,139,22],[369,169,25],[410,229,21],[127,298,23],[198,327,27],[282,337,23],[365,315,24]])}`,
  3300, 2800, { width: 680, height: 620 })

const narrowBirch = art('tree-narrow-birch', '窄冠碎叶桦', 'tree',
  `<path d="M184 420Q142 405 157 365Q116 346 141 308Q100 278 129 247Q101 209 137 184Q115 143 155 126Q154 81 198 82Q213 44 249 69Q286 40 309 80Q353 75 355 122Q391 143 369 181Q406 208 378 242Q405 280 372 307Q392 346 355 364Q369 404 331 418Q308 459 270 435Q223 468 200 431Z" fill="#7E9568" ${outline}/>
  <path d="M169 354Q197 368 220 347Q245 371 271 349Q303 371 332 348L352 365Q362 400 330 405Q308 444 272 421Q229 449 210 417Q179 424 172 394Z" fill="#617F57"/>
  <path d="M161 181Q177 150 199 164Q191 129 218 133Q224 97 249 115Q274 92 293 125Q326 119 331 156Q310 180 284 165Q257 188 233 167Q204 191 181 175Z" fill="#ADBDA0"/>
  <path d="M255 267L245 156M252 235L203 201M254 251L305 217M252 282L218 335M258 291L304 329" fill="none" stroke="#D0CFAD" stroke-width="6" stroke-linecap="round"/>
  ${root}${leafMarks([[172,224,16],[207,156,17],[278,152,18],[340,208,17],[169,302,16],[209,365,18],[283,390,18],[334,319,17]])}`,
  1800, 3000, { width: 460, height: 500 })

const splitPine = art('tree-broken-fan-pine', '偏枝扇针松', 'tree',
  `<path d="M250 268L235 211L210 166M250 255L296 195L318 145M253 261L342 257M248 267L171 308M252 269L279 357" fill="none" stroke="#7C704F" stroke-width="13" stroke-linecap="round"/>
  <path d="M211 48L236 102L285 132L253 146L287 181L242 186L266 229L217 214L194 248L170 209L126 207L151 173L105 151L158 121L181 78Z" fill="#5E805B" ${outline}/>
  <path d="M350 104L366 157L414 188L382 204L438 243L390 249L413 283L364 279L333 317L311 277L267 281L287 242L250 217L305 184L323 131Z" fill="#6F9160" ${outline}/>
  <path d="M157 258L186 297L230 314L208 339L252 370L210 383L223 426L174 411L135 450L119 404L70 411L96 367L52 338L104 312L123 274Z" fill="#62825A" ${outline}/>
  <path d="M284 306L308 345L352 373L321 390L352 429L309 433L283 475L257 435L218 442L239 404L207 380L257 352Z" fill="#4E7354" ${outline}/>
  <path d="M209 77L219 116L254 136L220 143L241 174L210 165M348 134L353 168L386 190L351 201L387 235L353 226M151 289L163 318L196 334L159 347L187 375L148 366M284 337L292 365L320 383L285 390L311 419" fill="none" stroke="#AAC089" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  ${root}`,
  2600, 3100, { width: 560, height: 580 })

const lowThicket = art('shrub-notched-thicket', '缺口低灌丛', 'shrub',
  `<path d="M51 277Q30 249 63 229Q50 194 89 184Q88 149 126 147Q144 113 176 136Q205 111 229 144Q265 121 283 156Q327 142 341 180Q380 164 394 201Q440 199 449 232Q481 254 453 280Q467 313 430 324Q410 358 379 338Q342 371 315 345Q286 370 258 343Q222 370 197 344Q158 362 146 330Q103 347 93 313Q57 315 51 277Z" fill="#6B8651" ${outline}/>
  <path d="M82 252Q115 269 144 249Q169 275 195 253Q221 277 250 254Q278 281 307 258Q340 278 367 255Q402 273 438 250L449 280Q458 307 427 314Q408 344 379 325Q342 354 316 333Q284 353 258 330Q225 354 198 331Q164 350 151 317Q118 332 106 304Q81 303 82 281Z" fill="#537347"/>
  <path d="M107 209Q129 178 153 194Q159 165 185 181Q208 160 230 188Q259 166 276 196Q305 184 319 211Q292 226 267 211Q239 235 214 215Q186 231 165 211Q138 229 119 217Z" fill="#A1AE69"/>
  ${leafMarks([[109,251,18],[169,211,18],[236,221,20],[315,238,17],[385,259,19],[209,301,18],[304,308,18]])}`,
  1400, 900, { width: 560, height: 380 })

const splitFern = art('shrub-splayed-fern', '疏展双心蕨', 'shrub',
  `<path d="M253 286Q199 233 86 164M250 282Q227 190 217 65M258 282Q303 205 409 123M259 284Q349 273 466 302M253 289Q266 365 317 448M247 285Q172 319 79 390" fill="none" stroke="#56734D" stroke-width="8" stroke-linecap="round"/>
  ${[[-1,1,86,164],[1,1,409,123],[-1,-1,79,390],[1,-1,466,302]].map(([sx,sy,x,y]) => `<path d="M253 285Q${(253+x)/2+sx*20} ${(285+y)/2-sy*20} ${x} ${y}" fill="none" stroke="#A1B676" stroke-width="3"/>`).join('')}
  ${Array.from({length:6},(_,branch)=>{const end=[[86,164],[217,65],[409,123],[466,302],[317,448],[79,390]][branch];return Array.from({length:5},(_,i)=>{const t=.22+i*.14,x=253+(end[0]-253)*t,y=285+(end[1]-285)*t,dx=end[0]-253,dy=end[1]-285,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l,r=44-i*5;return `<path d="M${x} ${y}q${nx*r-dx*.06} ${ny*r-dy*.06} ${nx*r*1.1-dx*.12} ${ny*r*1.1-dy*.12}Q${x+nx*r*.32} ${y+ny*r*.32} ${x} ${y}q${-nx*r-dx*.06} ${-ny*r-dy*.06} ${-nx*r*1.1-dx*.12} ${-ny*r*1.1-dy*.12}Q${x-nx*r*.32} ${y-ny*r*.32} ${x} ${y}Z" fill="${(branch+i)%3===0?'#A0B77C':(branch+i)%3===1?'#7E9F66':'#5F855B'}" stroke="#4B704F" stroke-width="2.4"/>`}).join('')}).join('')}`,
  1200, 1250, { width: 420, height: 420 }, true, 285)

const bentGrass = art('grass-bent-verge', '弯叶疏草簇', 'grass',
  `<path d="M190 408Q166 284 75 194Q171 224 215 337Q187 177 155 91Q254 181 245 352Q266 213 338 95Q310 241 286 368Q348 264 446 223Q356 328 319 408Q262 434 190 408Z" fill="#7D965A" ${outline}/>
  <path d="M188 392Q142 289 105 237M220 388Q207 234 177 154M252 401Q266 251 310 164M281 405Q336 314 395 258" fill="none" stroke="#B9C180" stroke-width="4" stroke-linecap="round"/>
  <path d="M86 399l29 -35M355 430l41 -15M147 454l20 -10M397 376l20 -30" fill="none" stroke="#819455" stroke-width="7" stroke-linecap="round" opacity=".75"/>`,
  1350, 1050, { width: 650, height: 420 }, true, 410)

/** Six original silhouettes, immutable at this fixed batch/version. */
export const VEGETATION_DETAIL_ART: readonly VegetationDetailArt[] = freezeJson([broadOak, narrowBirch, splitPine, lowThicket, splitFern, bentGrass])
export const vegetationDetailAssetId = (key: string): string => `vegetation-detail-v1-art-${key}`
export const vegetationDetailDefinitionId = (key: string): string => `vegetation-detail-v1-prop-${key}`
export const VEGETATION_DETAIL_SPECS = freezeJson(VEGETATION_DETAIL_ART.map(value => ({ key: value.key, name: value.name, role: value.role,
  version: VEGETATION_DETAIL_VERSION, assetId: vegetationDetailAssetId(value.key), definitionId: vegetationDetailDefinitionId(value.key),
  widthMm: value.widthMm, heightMm: value.heightMm, rootPixel: value.rootPixel,
  visualBoundsMm: { x: -Math.round(value.rootPixel.x / 512 * value.widthMm), y: -Math.round(value.rootPixel.y / 512 * value.heightMm), width: value.widthMm, height: value.heightMm }, footprintMm: value.footprintMm!, presentation: value.presentation,
  blocksMovement: value.blocksMovement!, blocksSight: value.blocksSight!, renderLayer: value.renderLayer!, shadowClass: value.shadowClass! })))
