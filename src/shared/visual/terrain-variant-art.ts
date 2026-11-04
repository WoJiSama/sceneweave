import type { VisualSampleArt } from './sample-art.js'
import type { FixedPresentation } from '../terrain-generation/contracts.js'
import { freezeJson } from '../validation/json.js'

export type TerrainVariantRole = 'tree' | 'rock' | 'shrub' | 'grass' | 'scree'
export interface TerrainVariantArt extends VisualSampleArt {
  role: TerrainVariantRole
  presentation: FixedPresentation
}
export const TERRAIN_VARIANT_LICENSE_REF = 'MIT-Sceneweave-Terrain-Variants-1'
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
const edge = 'stroke="#53634D" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"'
const stoneEdge = 'stroke="#626D64" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"'
const leaf = (rows: readonly (readonly [number, number, number])[]) => rows.map(([x,y,r],i) => `<path d="M${x-r} ${y}q${r*.65} ${-r*.55} ${r} ${-r*.2}q${r*.5} ${-r*.45} ${r} ${-r*.15}M${x-r*.25} ${y+r*.5}l${r*.4} ${-r*.35}" fill="none" stroke="${i%3===0?'#C5CF91':'#A4BA7A'}" stroke-width="2.2" stroke-linecap="round" opacity=".68"/>`).join('')
const twigs = (path: string) => `<path d="${path}" fill="none" stroke="#5B7151" stroke-width="3" stroke-linecap="round" opacity=".72"/>`
const crack = (path: string) => `<path d="${path}" fill="none" stroke="#65726B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
function art(key: string, name: string, role: TerrainVariantRole, body: string, widthMm: number, heightMm: number,
  footprintMm: { width: number; height: number }, rootY = 0): TerrainVariantArt {
  const upright = role === 'tree' || role === 'rock' || role === 'shrub', blocking = role === 'tree' || role === 'rock'
  const presentation: FixedPresentation = upright
    ? { mode: 'nearSide', rootAnchorMm: { x: 0, y: Math.round((rootY / 512 - .5) * heightMm) }, orientation: 'fixedUpright', fixedRotationDeg: 0,
      footprintAxes: 'world', groundShadowMm: [
        { x: -Math.round(footprintMm.width * .55), y: -Math.round(footprintMm.height * .45) },
        { x: Math.round(footprintMm.width * .55), y: -Math.round(footprintMm.height * .45) },
        { x: Math.round(footprintMm.width * .55), y: Math.round(footprintMm.height * .45) },
        { x: -Math.round(footprintMm.width * .55), y: Math.round(footprintMm.height * .45) },
      ] }
    : { mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null }
  return { key, name, kind: 'prop', role, sourceSvg: svg(body), widthMm, heightMm, footprintMm,
    blocksMovement: blocking, blocksSight: role === 'tree', renderLayer: role === 'tree' ? 'canopy' : role === 'rock' || role === 'shrub' ? 'object' : 'ground',
    shadowClass: role === 'tree' || role === 'shrub' ? 'vegetation' : role === 'rock' ? 'furniture' : 'none',
    tags: ['原创', '地形变体v1', role, role === 'tree' ? '树木' : role === 'rock' ? '岩石' : role === 'shrub' ? '灌丛' : role === 'grass' ? '草缘' : '碎石', upright ? '近侧视' : '俯视', upright ? 'fixed-upright' : 'ground-detail'], presentation }
}

const windOak = art('tree-wind-oak', '向湾偏冠树', 'tree',
  `<path d="M242 449Q250 412 239 352L213 297L231 288L258 334L284 267L303 276L271 357Q266 408 280 450L260 458Z" fill="#97825B" ${edge}/>
  <path d="M249 440L252 378M266 407L274 370M244 450L226 460M274 448L292 459" fill="none" stroke="#C3AE7F" stroke-width="3" stroke-linecap="round"/>
  <path d="M83 301Q47 285 61 252Q39 220 75 195Q63 164 108 149Q108 114 150 113Q170 77 213 91Q236 57 275 79Q319 58 348 93Q391 78 408 115Q453 115 451 157Q480 176 462 211Q481 247 445 264Q444 301 405 306Q391 339 350 328Q317 350 286 329Q251 350 224 327Q184 343 157 321Q111 336 102 305Z" fill="#799866" ${edge}/>
  <path d="M71 245Q112 262 142 244Q177 269 213 246Q246 274 282 249Q321 269 353 247Q395 265 436 236L451 256Q448 291 410 295Q388 326 352 313Q316 336 287 315Q250 337 224 312Q183 329 161 307Q120 319 105 293Q80 293 71 270Z" fill="#5F7D54"/>
  <path d="M100 191Q115 159 153 161Q149 128 191 132Q212 101 244 118Q278 88 307 116Q346 104 365 135Q405 128 419 165Q391 185 362 167Q328 187 298 167Q266 188 236 168Q204 191 176 171Q145 193 121 180Z" fill="#A1B878"/>
  ${leaf([[121,214,18],[180,155,21],[246,136,23],[318,147,20],[393,194,24],[171,276,20],[244,284,23],[329,286,21],[424,243,16]])}
  ${twigs('M209 258q27 -20 56 -7M302 240q25 -17 52 -6M147 219q18 -12 35 -8')}`,
  2100, 2250, { width: 480, height: 480 }, 450)

const fanPine = art('tree-fan-pine', '疏层扇冠松', 'tree',
  `<path d="M244 449L251 329L238 242L253 237L270 331L272 450L258 458Z" fill="#947B55" ${edge}/>
  <path d="M254 439L257 347M247 450L233 461M267 449L284 458" fill="none" stroke="#C1AA7B" stroke-width="3" stroke-linecap="round"/>
  <path d="M260 56Q240 94 202 117L224 130Q194 163 142 177L172 195Q137 231 78 253L117 269Q93 302 58 322Q97 345 140 326Q168 353 207 334Q245 358 282 337Q325 360 361 334Q406 351 454 328Q414 302 390 269L428 253Q374 231 346 199L376 184Q322 166 296 131L319 118Q277 93 260 56Z" fill="#62885F" ${edge}/>
  <path d="M259 79Q247 109 221 120L245 134Q222 161 185 175L217 190Q188 220 151 238Q194 247 222 232Q256 249 287 230Q318 244 351 235Q310 208 287 181L311 174Q281 156 267 131L282 120Q263 104 259 79Z" fill="#94B17B"/>
  <path d="M119 278Q161 293 194 278Q230 303 264 285Q299 307 335 286Q372 300 411 284L433 315Q402 332 366 319Q327 343 289 321Q249 342 214 322Q177 342 144 317Q106 334 80 320Z" fill="#4F7656"/>
  ${leaf([[147,306,18],[213,292,20],[288,302,23],[367,308,20],[188,221,17],[250,202,18],[310,218,17],[250,139,12]])}`,
  1900, 2400, { width: 450, height: 450 }, 450)

const forkTree = art('tree-fork-copse', '双枝分冠树', 'tree',
  `<path d="M245 452Q252 408 235 354L187 295L203 281L254 331L297 261L316 273L272 351Q267 407 282 451L263 460Z" fill="#9C855F" ${edge}/>
  <path d="M257 441L256 357M240 450L220 461M277 449L295 460" fill="none" stroke="#CAB586" stroke-width="3" stroke-linecap="round"/>
  <path d="M64 269Q36 240 66 209Q57 172 97 156Q98 121 135 117Q156 85 190 103Q225 77 252 112Q290 106 300 139Q337 163 311 190Q326 225 290 242Q284 278 249 274Q218 305 188 285Q151 303 124 282Q83 294 64 269Z" fill="#83A26B" ${edge}/>
  <path d="M274 185Q246 155 272 125Q266 89 304 78Q322 51 353 70Q389 56 407 85Q449 82 452 120Q481 145 455 174Q461 208 426 219Q403 250 370 232Q333 254 307 227Q272 224 274 185Z" fill="#739563" ${edge}/>
  <path d="M72 224Q106 239 137 223Q165 249 195 227Q227 249 255 224Q279 235 303 215Q309 240 282 249Q276 277 249 263Q221 290 189 271Q154 290 127 267Q91 279 72 253Z" fill="#618353"/>
  <path d="M284 123Q301 97 328 110Q339 81 363 98Q389 84 411 108Q438 110 437 137Q416 155 392 140Q363 161 340 142Q311 162 289 145Z" fill="#A9BF80"/>
  ${leaf([[112,189,19],[174,151,22],[229,180,18],[161,255,21],[335,133,17],[395,166,19],[360,211,17]])}`,
  2050, 2200, { width: 480, height: 460 }, 450)

const ridge = art('rock-layer-ridge', '横断层浅岩', 'rock',
  `<path d="M46 315L76 236L156 203L211 148L299 159L333 202L424 217L468 286L448 354L379 381L289 375L216 397L123 380L63 361Z" fill="#A5A791" ${stoneEdge}/>
  <path d="M76 236L158 240L211 148L254 215L299 159L333 202L424 217L391 272L468 286L448 316L362 325L289 304L216 329L123 308L46 315Z" fill="#D0BE96" ${stoneEdge}/>
  <path d="M63 335L123 329L216 351L291 329L362 348L444 333M82 356L141 353L217 375M291 352L362 370L414 355" fill="none" stroke="#6E8077" stroke-width="3"/>
  ${crack('M211 174L195 231L214 253L207 283M329 223L303 247L320 272M133 259L163 250L180 266')}
  <path d="M85 241L143 218M348 222L404 232M100 298L151 304" fill="none" stroke="#E5D4A8" stroke-width="4" stroke-linecap="round"/>
  <path d="M192 340l19 -9 22 7 -5 11 -24 4Z" fill="#8A9B73" opacity=".8"/>`,
  1850, 1200, { width: 1100, height: 620 }, 367)

const stack = art('rock-split-stack', '错层双叠岩', 'rock',
  `<path d="M82 325L109 248L192 219L265 243L322 217L399 266L438 337L406 397L316 418L228 403L147 420L92 383Z" fill="#899C91" ${stoneEdge}/>
  <path d="M109 248L192 219L265 243L322 217L399 266L356 315L282 303L230 333L158 310L82 325Z" fill="#CCBD9A" ${stoneEdge}/>
  <path d="M161 242L143 183L177 111L242 78L314 106L346 164L322 225L273 260L206 254Z" fill="#A6AD96" ${stoneEdge}/>
  <path d="M143 183L177 111L242 78L260 159L314 106L346 164L304 184L273 218L212 208Z" fill="#D9C8A1" ${stoneEdge}/>
  ${crack('M241 100L226 156L245 184L233 221M325 265L298 287L307 327M158 322L185 346L172 373')}
  <path d="M182 118L221 101M271 166L303 135M117 355L164 367M277 376L323 387L386 367" fill="none" stroke="#E3D2A8" stroke-width="3" stroke-linecap="round"/>
  <path d="M211 366l22 -12 27 9 -8 17 -30 1Z" fill="#8F9D70"/>`,
  1350, 1450, { width: 850, height: 700 }, 395)

const shelf = art('rock-tidal-shelf', '回入缺口层岩', 'rock',
  `<path d="M53 300L81 204L166 159L258 142L354 167L451 230L470 307L438 374L361 401L302 370L334 329L369 294L334 254L270 243L214 268L205 319L234 365L176 402L104 383L65 349Z" fill="#A2AA95" ${stoneEdge}/>
  <path d="M81 204L166 159L258 142L291 200L354 167L451 230L402 254L369 294L334 254L270 243L214 268L205 319L156 299L112 320L53 300Z" fill="#CFBF99" ${stoneEdge}/>
  <path d="M67 326L111 345L173 331M104 365L164 379M392 323L439 309M358 369L403 378" fill="none" stroke="#71867A" stroke-width="3.2"/>
  ${crack('M168 185L159 228L180 247M293 200L312 224L305 244M397 238L383 258')}
  <path d="M85 217L129 190M194 171L239 163M360 189L401 210" fill="none" stroke="#E7D7AD" stroke-width="3.8" stroke-linecap="round"/>`,
  1750, 1250, { width: 1000, height: 750 }, 372)

const heath = art('shrub-heath-mound', '矮苔圆簇灌丛', 'shrub',
  `<path d="M67 328Q40 299 71 272Q53 243 88 226Q84 193 121 188Q133 154 168 170Q191 134 222 158Q255 129 282 157Q318 140 340 171Q380 159 394 194Q439 195 441 230Q474 253 452 285Q470 321 435 341Q424 374 389 366Q357 397 329 375Q292 399 260 377Q223 402 192 375Q152 390 131 364Q90 375 80 345Z" fill="#839D66" ${edge}/>
  <path d="M67 298Q98 318 127 299Q155 330 188 307Q220 338 253 314Q287 340 317 313Q349 338 382 311Q416 329 452 299L448 328Q426 350 400 345Q373 377 340 359Q304 382 270 361Q232 387 200 361Q162 378 139 350Q99 362 80 337Z" fill="#63844F"/>
  ${leaf([[112,253,17],[171,218,20],[238,199,21],[309,218,19],[384,253,21],[177,305,19],[261,326,22],[349,315,18]])}`,
  1100, 850, { width: 420, height: 300 }, 373)

const spread = art('shrub-wind-spread', '贴地横展灌丛', 'shrub',
  `<path d="M43 327Q25 306 48 286Q37 262 66 251Q69 222 101 230Q123 202 149 222Q174 199 198 222Q218 189 243 211Q267 181 293 205Q320 185 345 210Q374 197 392 220Q425 209 442 237Q475 235 477 266Q496 285 478 307Q487 334 457 344Q442 372 413 359Q382 383 353 362Q323 383 295 362Q263 385 232 362Q200 384 173 362Q143 381 117 359Q85 372 67 348Q47 348 43 327Z" fill="#8CA76F" ${edge}/>
  <path d="M49 310Q82 326 106 308Q137 332 168 314Q198 339 228 316Q260 339 290 315Q322 335 352 315Q387 337 413 313Q448 331 477 308L465 337Q437 351 414 344Q382 368 355 348Q322 369 292 349Q260 371 233 350Q202 371 175 350Q143 368 116 346Q85 359 69 337Z" fill="#6B8C58"/>
  ${leaf([[89,277,15],[151,266,18],[218,250,17],[282,241,19],[350,260,17],[420,282,16],[208,322,14],[328,321,16]])}`,
  1450, 700, { width: 520, height: 260 }, 360)

const grassFan = art('grass-sedge-fan', '细叶斜展草簇', 'grass',
  `<path d="M238 395Q196 311 106 244Q176 265 228 329Q181 225 170 105Q226 185 251 317Q254 179 296 70Q299 205 276 326Q325 199 415 144Q352 259 287 363Q362 291 454 289Q370 331 285 401Z" fill="#8CA86C" stroke="#6B8957" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M251 392Q226 281 177 135M264 389Q272 226 294 109M277 389Q333 268 397 179M241 385L140 271M286 389L418 307" fill="none" stroke="#C8D49B" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M204 406q49 -28 103 -2M213 418l18 -6M282 415l17 5" fill="none" stroke="#6D8657" stroke-width="3" stroke-linecap="round"/>`,
  780, 820, { width: 260, height: 220 })

const grassFringe = art('grass-stone-fringe', '沿石碎叶草缘', 'grass',
  `<path d="M49 304Q83 296 122 319Q96 247 106 195Q137 242 153 302Q155 222 187 158Q190 244 181 315Q216 275 253 270Q221 314 201 336Q255 320 306 331Q296 256 321 201Q341 270 337 329Q362 236 412 207Q387 275 367 336Q421 307 465 317Q431 346 383 367Q332 376 289 361Q247 373 203 357Q162 376 123 354Q83 348 49 304Z" fill="#93AD73" stroke="#708A5A" stroke-width="2" stroke-linejoin="round"/>
  <path d="M146 336L113 223M174 337L185 190M323 351L323 228M355 350L400 230M86 327L112 338M237 342L267 346M404 345L436 333" fill="none" stroke="#D0D9A1" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M198 385l16 -15 25 4 8 14 -26 7Z M367 388l23 -13 20 10 -10 16 -26 -2Z" fill="#BEBA98" stroke="#7D8970" stroke-width="2"/>`,
  1250, 700, { width: 300, height: 220 })

const screeRibbon = art('scree-ribbon', '斜带碎岩片', 'scree',
  `<path d="M55 334L76 302L110 297L126 322L108 349L75 356Z M125 283L144 252L182 247L205 267L193 293L153 305Z M221 248L238 216L279 211L302 239L276 268L241 266Z M320 210L332 175L371 159L398 178L388 214L352 234Z M414 166L425 142L450 136L469 156L457 179L434 184Z" fill="#C7BC99" stroke="#7A897A" stroke-width="3" stroke-linejoin="round"/>
  <path d="M65 334L88 326L113 323M139 283L166 271L193 267M235 248L267 238L291 240M334 209L355 190L385 181M424 165L447 153L462 156" fill="none" stroke="#E1D3AF" stroke-width="3"/>
  ${crack('M85 309L90 330M170 255L173 275M263 218L255 241M367 168L359 193')}
  <path d="M88 386l15 -9 14 8 -5 12 -18 2Z M217 321l13 -12 17 7 2 13 -20 8Z M318 278l16 -9 15 9 -8 12 -17 -1Z" fill="#9EA98B" stroke="#7D8D79" stroke-width="2"/>`,
  1250, 850, { width: 300, height: 240 })

const screePocket = art('scree-pocket', '窝状细碎石', 'scree',
  `<path d="M130 233L153 202L189 194L208 220L192 249L156 255Z M227 182L249 158L280 164L290 192L264 211L236 203Z M321 221L340 189L374 193L395 219L378 246L342 249Z M191 315L210 280L246 276L264 303L245 335L212 337Z M292 321L308 281L350 278L375 304L355 340L317 347Z M125 340L141 317L167 324L170 348L148 363L128 356Z M253 378L269 358L290 367L292 389L270 402L251 392Z" fill="#C8BE9E" stroke="#7D8B79" stroke-width="3" stroke-linejoin="round"/>
  <path d="M144 232L175 216L198 221M239 183L261 174L281 189M334 220L358 207L385 220M205 311L231 293L256 301M306 319L335 297L365 307M134 339L154 333M260 378L282 374" fill="none" stroke="#E5D8B5" stroke-width="3"/>
  ${crack('M176 203L174 226M275 170L265 191M360 197L354 221M226 286L231 310M338 285L332 309')}`,
  1050, 1000, { width: 300, height: 260 })

/** Twelve distinct transparent silhouettes; every source has its own fixed identity. */
export const TERRAIN_VARIANT_ART: readonly TerrainVariantArt[] = freezeJson([
  windOak, fanPine, forkTree, ridge, stack, shelf, heath, spread, grassFan, grassFringe, screeRibbon, screePocket,
])
export const TERRAIN_VARIANT_LICENSE = 'MIT License\n\nSceneweave Terrain Variant Artwork, version 1\nCopyright (c) 2026 Sceneweave contributors\n\nOriginal deterministic SVG tree, rock, shrub, grass-edge and scree drawings created for Sceneweave with coding assistance. These twelve sources use independently drawn outlines, not repainted or scaled old artwork, reference-map pixels, traced source imagery or third-party assets. Raw SVG, normalized SVG, actual PNG, fixed millimetre dimensions, roots and declared physical defaults remain together.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
