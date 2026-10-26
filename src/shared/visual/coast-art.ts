import type { VisualSampleArt } from './sample-art.js'

/** Independent original vector drawings. No reference-image pixels or third-party source are included. */
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
function prop(key: string, name: string, body: string, widthMm: number, heightMm: number,
  footprintMm: { width: number; height: number }, tags: string[], rock = false): VisualSampleArt {
  return { key: `coast-${key}`, name, kind: 'prop', sourceSvg: svg(body), widthMm, heightMm, footprintMm,
    blocksMovement: rock, blocksSight: false, renderLayer: rock ? 'object' : 'ground', shadowClass: rock ? 'furniture' : 'none', tags }
}
function material(key: string, name: string, color: string, body: string, tileMm: number, tags: string[]): VisualSampleArt {
  return { key: `coast-material-${key}`, name, kind: 'material', sourceSvg: svg(`<rect x="0" y="0" width="512" height="512" fill="${color}"/>${body}`), widthMm: tileMm, heightMm: tileMm, tags }
}
function fraction(seed: number, i: number): number { let h = Math.imul(seed + i * 109, 0x45d9f3b); h ^= h >>> 16; return (Math.imul(h, 0x45d9f3b) >>> 0) / 4294967296 }
const n = (value: number) => Math.round(value * 10) / 10
function grain(seed: number, count: number, colors: string[], opacity: number): string {
  return Array.from({ length: count }, (_, i) => `<circle cx="${n(fraction(seed, i * 3) * 512)}" cy="${n(fraction(seed, i * 3 + 1) * 512)}" r="${n(.45 + fraction(seed, i * 3 + 2) * 1.05)}" fill="${colors[i % colors.length]}" opacity="${opacity}"/>`).join('')
}
const reefSplit = prop('reef-split', '裂脊礁石',
  '<path d="M44 273L83 187L155 163L187 85L264 65L313 113L373 96L443 171L456 241L425 284L467 338L414 389L332 409L284 448L201 419L130 438L69 377Z" fill="#676C64" stroke="#414E48" stroke-width="6" stroke-linejoin="round"/><path d="M83 187L155 163L187 85L264 65L244 184L194 241L139 260L44 273L69 377L147 337L202 351L205 265L254 227L296 125L313 113L291 248L337 286L443 171L456 241L425 284L467 338L375 347L332 409L284 448L279 330L241 305L201 419L202 351L130 438L147 337L69 377Z" fill="#899083" stroke="#59675F" stroke-width="3.5" stroke-linejoin="round"/><path d="M107 202L164 179L199 109L246 89M334 125L369 120L419 173M99 366L137 349M304 403L335 367L399 354" fill="none" stroke="#B7B6A0" stroke-width="7" stroke-linecap="round"/><path d="M246 184L238 208L251 224L244 263L265 284L279 330M337 286L345 317L375 347M194 241L191 275L205 304" fill="none" stroke="#3D524B" stroke-width="5" stroke-linejoin="round"/><path d="M81 304L115 286L147 295L153 319L114 335L86 324ZM319 359L347 337L378 345L374 371L341 384Z" fill="#70816B" stroke="#4E6758" stroke-width="3"/>',
  2100, 1750, { width: 1530, height: 1270 }, ['礁石', '裂脊', 'rock', 'reef', 'ridge'], true)
const reefShelf = prop('reef-shelf', '潮蚀页岩',
  '<path d="M41 313L72 228L123 212L130 149L190 112L241 131L278 95L351 119L383 161L439 173L469 237L441 285L475 329L429 378L361 389L327 429L257 410L204 434L153 404L87 397Z" fill="#6B7167" stroke="#43534C" stroke-width="6" stroke-linejoin="round"/><path d="M72 228L131 242L169 194L225 212L246 160L300 175L352 149L383 199L449 223L441 285L475 329L429 378L361 389L327 429L257 410L204 434L153 404L87 397L41 313Z" fill="#909181" stroke="#657366" stroke-width="4"/><path d="M49 304Q130 282 209 305T369 300L451 286M65 342Q149 320 225 344T392 337L457 334M98 378Q166 354 245 379T407 371" fill="none" stroke="#55675B" stroke-width="13" stroke-linecap="round"/><path d="M56 297Q138 277 211 298T371 293M78 332Q149 315 228 335T389 328M131 367Q191 353 248 369T380 362" fill="none" stroke="#C0BA9E" stroke-width="4" stroke-linecap="round"/><path d="M141 231L169 194L225 212M300 175L352 149L383 199" fill="none" stroke="#BEC0A2" stroke-width="6" stroke-linecap="round"/><path d="M267 249L290 229L320 235L330 253L300 268L273 264Z" fill="#758970" stroke="#566F5B" stroke-width="3"/>',
  2350, 1600, { width: 1730, height: 1130 }, ['礁石', '页岩', 'rock', 'reef', 'shelf'], true)
const reefPool = prop('reef-pool', '凹心潮池岩',
  '<path d="M55 276L84 176L146 141L176 93L256 73L316 103L383 106L433 169L463 250L430 312L448 362L372 411L303 408L242 441L161 415L94 371Z" fill="#666F64" stroke="#42544A" stroke-width="6" stroke-linejoin="round"/><path d="M84 176L146 141L176 93L256 73L316 103L383 106L433 169L387 205L400 258L367 322L303 345L245 381L170 356L129 308L130 241Z" fill="#989886" stroke="#647568" stroke-width="3.5"/><path d="M168 223L213 176L281 163L335 195L364 249L336 304L272 328L210 307L173 271Z" fill="#496F66" stroke="#56695B" stroke-width="8" stroke-linejoin="round"/><path d="M190 231L224 199L274 189L322 211L337 247L316 283L268 298L221 283L191 262Z" fill="#7EA59A"/><path d="M203 235Q242 219 281 233T324 235M222 268Q257 255 291 267" fill="none" stroke="#C3D5BB" stroke-width="3" opacity=".7" stroke-linecap="round"/><path d="M103 184L159 159L190 114L246 99M339 127L371 133L410 178M101 338L138 360L173 373M324 374L361 353L407 346" fill="none" stroke="#C3BE9F" stroke-width="6" stroke-linecap="round"/><path d="M95 255L116 238L139 245L145 271L119 286L98 275ZM337 326L358 309L382 319L386 340L362 354Z" fill="#75886D" stroke="#566F59" stroke-width="3"/>',
  2000, 1850, { width: 1450, height: 1320 }, ['礁石', '潮池', 'rock', 'reef', 'pool'], true)
function grass(key: string, name: string, seed: number, widthMm: number, heightMm: number, colors: string[]): VisualSampleArt {
  let body = '<path d="M99 262Q167 218 251 235Q334 213 407 267Q328 298 251 281Q176 301 99 262Z" fill="#9B9470" opacity=".16"/>'
  // Separate, visibly different leaf lengths and curved directions, seen from above.
  for (let i = 0; i < 25; i++) {
    const angle = fraction(seed, i * 3) * Math.PI * 2, length = 58 + fraction(seed, i * 3 + 1) * 154
    const sx = 256 + Math.cos(angle * 2.4) * 30, sy = 256 + Math.sin(angle * 1.4) * 23
    const ex = sx + Math.cos(angle) * length, ey = sy + Math.sin(angle) * length * .82
    const cx = (sx + ex) / 2 - Math.sin(angle) * 30, cy = (sy + ey) / 2 + Math.cos(angle) * 30
    body += `<path d="M${n(sx)} ${n(sy)}Q${n(cx - 12)} ${n(cy - 8)} ${n(ex)} ${n(ey)}Q${n(cx + 14)} ${n(cy + 7)} ${n(sx + 4)} ${n(sy + 5)}Z" fill="${colors[i % colors.length]}" stroke="#596E52" stroke-width="2"/><path d="M${n(sx + 2)} ${n(sy + 1)}Q${n(cx)} ${n(cy)} ${n(ex)} ${n(ey)}" fill="none" stroke="#B8B98B" stroke-width="1.2" opacity=".65"/>`
  }
  return prop(key, name, body, widthMm, heightMm, { width: Math.round(widthMm * .45), height: Math.round(heightMm * .4) }, ['海草', '海岸草', 'grass', 'vegetation', 'coastal'])
}
const shellFan = prop('shell-fan', '象牙扇贝簇',
  '<path d="M55 315Q53 182 169 161Q284 185 275 313L185 385L136 382Z" fill="#DDD4B2" stroke="#8E8B70" stroke-width="5"/><path d="M166 174L163 372M94 208L151 370M235 209L177 371M63 281L142 370M263 277L187 369" fill="none" stroke="#AEA786" stroke-width="5"/><path d="M300 212Q293 126 369 112Q443 134 439 220L384 266L351 263Z" fill="#DBBE9E" stroke="#8B8771" stroke-width="5"/><path d="M369 125L367 255M323 150L359 251M412 154L379 251" fill="none" stroke="#B09C81" stroke-width="4"/><path d="M332 369L358 340L392 344L408 373L384 398L349 395Z" fill="#BCBCA4" stroke="#8C937C" stroke-width="4"/>',
  560, 410, { width: 430, height: 260 }, ['贝壳', '扇贝', 'shell', 'debris'])
const shellSpiral = prop('shell-spiral', '淡赭螺壳',
  '<path d="M101 315Q80 227 147 160Q218 92 310 127Q410 160 416 260Q414 368 304 398Q169 432 101 315Z" fill="#CDBB96" stroke="#8B8870" stroke-width="7"/><path d="M154 308Q116 210 207 171Q302 132 355 220Q405 309 315 344Q232 376 204 305Q180 245 240 222Q291 201 314 248Q330 288 295 301Q265 314 256 285" fill="none" stroke="#9C9175" stroke-width="11" stroke-linecap="round"/><path d="M136 302Q108 223 173 179M215 156Q283 127 333 186M353 302Q343 327 318 336" fill="none" stroke="#E2D3AD" stroke-width="6" stroke-linecap="round"/>',
  260, 230, { width: 180, height: 160 }, ['贝壳', '螺壳', 'shell', 'spiral'])
const starfish = prop('starfish', '沙赭海星',
  '<path d="M256 52Q273 52 292 133L311 186Q346 190 417 176Q460 169 438 195L353 272Q356 302 394 376Q412 410 384 398L279 347Q253 357 192 414Q162 438 168 402L184 291Q164 267 88 231Q51 213 87 207L198 189Q219 162 241 78Q247 52 256 52Z" fill="#BB9571" stroke="#8F8168" stroke-width="6" stroke-linejoin="round"/><path d="M256 90L259 266L412 190M259 266L377 377M259 266L180 394M259 266L91 219" fill="none" stroke="#D6BE96" stroke-width="9" stroke-linecap="round"/><circle cx="259" cy="266" r="26" fill="#C6A47B" stroke="#A18A6D" stroke-width="4"/><path d="M249 143h10M242 185h12M306 239l7 6M343 218l7 6M301 302l-5 7M330 329l-5 7M222 306l7 6M202 346l7 6M173 242l-3 8M132 225l-3 8" fill="none" stroke="#91795E" stroke-width="4" stroke-linecap="round"/>',
  340, 330, { width: 250, height: 240 }, ['海星', '海滩细节', 'starfish', 'shell', 'debris'])
const driftwood = prop('driftwood', '分叉盐漂木',
  '<path d="M39 304L111 281L161 254L196 218L254 195L303 134L329 129L316 167L364 147L403 152L353 181L324 210L383 213L467 257L432 271L371 244L313 242L261 280L221 303L160 329L96 350L52 343Z" fill="#86765C" stroke="#575E4D" stroke-width="8" stroke-linejoin="round"/><path d="M67 319L129 301L179 276L210 244L264 223L309 171M260 251L307 226L352 176M203 270L194 305L159 323M319 229L374 231L433 257" fill="none" stroke="#B2A084" stroke-width="8" stroke-linecap="round"/><path d="M85 329L140 310M207 249L244 235M330 205L353 192M355 232L388 243" fill="none" stroke="#D0BA95" stroke-width="4" stroke-linecap="round"/><path d="M115 315l20 -12M223 255l21 -13M287 226l16 -10" stroke="#565E4E" stroke-width="4" stroke-linecap="round"/>',
  2300, 1150, { width: 1860, height: 470 }, ['漂木', '枯枝', 'driftwood', 'debris', 'coastal'])
const wrack = prop('wrack', '潮痕褐藻',
  '<path d="M54 263Q115 233 172 260T291 255T450 260M93 290Q148 267 210 289T346 285" fill="none" stroke="#77744F" stroke-width="8" stroke-linecap="round"/>' +
  Array.from({ length: 17 }, (_, i) => { const x = 74 + i * 21, y = 242 + fraction(418, i) * 40, side = i % 2 ? 1 : -1; return `<path d="M${n(x)} ${n(y)}Q${n(x - 21)} ${n(y + side * 31)} ${n(x + 9)} ${n(y + side * 48)}Q${n(x + 32)} ${n(y + side * 26)} ${n(x)} ${n(y)}Z" fill="${i % 3 ? '#8A8057' : '#5F7053'}" stroke="#5F684B" stroke-width="2.5"/>` }).join(''),
  1250, 500, { width: 940, height: 230 }, ['海藻', '潮痕', 'wrack', 'seaweed', 'debris'])
const pebbles = prop('pebbles', '潮磨卵石',
  '<path d="M51 266Q45 227 87 213Q131 205 147 242Q159 277 111 289Q69 296 51 266Z" fill="#8F9586" stroke="#647365" stroke-width="5"/><path d="M203 195Q203 150 252 147Q301 146 310 191Q315 230 267 237Q223 239 203 195Z" fill="#737F73" stroke="#53685C" stroke-width="5"/><path d="M335 303Q342 262 388 265Q435 271 443 308Q445 344 399 350Q350 353 335 303Z" fill="#A8AA91" stroke="#717D68" stroke-width="5"/><path d="M176 342Q180 319 209 322Q235 327 233 350Q229 375 202 372Q176 367 176 342Z" fill="#697D70" stroke="#4E695C" stroke-width="4"/><path d="M66 241Q97 218 128 241M220 180Q255 158 291 183M356 294Q393 276 426 300" fill="none" stroke="#D0C8A6" stroke-width="4" stroke-linecap="round"/>',
  900, 550, { width: 660, height: 330 }, ['卵石', '碎石', 'pebbles', 'rock', 'debris'])
const sandLines = '<path d="M31 112Q66 101 99 110M243 218Q288 205 329 216M125 390Q161 379 198 388M398 441Q428 433 458 440" fill="none" stroke="#A69169" stroke-width="1.3" opacity=".32" stroke-linecap="round"/><path d="M34 107Q67 98 96 105M246 212Q287 201 327 209M127 384Q164 375 198 383" fill="none" stroke="#E4D3A4" stroke-width="1.2" opacity=".55" stroke-linecap="round"/>'
const waterLines = '<path d="M-16 73Q31 61 77 73T170 73M246 164Q290 154 333 164T421 164M58 289Q104 278 151 289T245 289M327 427Q370 418 413 427T500 427" fill="none" stroke="#A5C2B3" stroke-width="2" opacity=".36" stroke-linecap="round"/><path d="M17 87Q43 81 69 85M279 175Q306 168 331 173M99 302Q126 294 153 299M378 439Q404 433 430 437" fill="none" stroke="#D0DCC2" stroke-width="1.5" opacity=".38" stroke-linecap="round"/>'

export const REFINED_COAST_ART: readonly VisualSampleArt[] = Object.freeze([
  reefSplit, reefShelf, reefPool,
  grass('grass-fan', '扇展海岸草', 53, 1150, 960, ['#81916A', '#919B73', '#70815E']),
  grass('grass-wind', '偏丛盐地草', 137, 1350, 830, ['#8B9770', '#6F855F', '#A1A37B']),
  shellFan, shellSpiral, starfish, driftwood, wrack, pebbles,
  material('dry-sand', '暖赭干沙', '#C7AB77', sandLines + grain(557, 240, ['#E7D6AE', '#968966', '#C2B38A'], .3), 4600, ['沙地', '干沙', 'sand', 'beach']),
  material('wet-sand', '潮痕湿沙', '#A58E68', sandLines + grain(617, 170, ['#CEBB91', '#877D5E'], .23), 4400, ['沙地', '湿沙', 'sand', 'wet']),
  material('shallows', '青灰浅水', '#7EAAA2', waterLines + grain(761, 100, ['#B8CDB6', '#608F89'], .14), 5800, ['浅水', '海水', 'water', 'shallows']),
  material('deep-water', '靛青深水', '#527E89', waterLines + grain(839, 90, ['#86ADA3', '#3F6A76'], .12), 6400, ['深水', '海水', 'water', 'deep']),
])
export const REFINED_COAST_LICENSE = 'Sceneweave Refined Coast Artwork, version 1\nCopyright (c) 2026 Sceneweave contributors\n\nOriginal deterministic SVG artwork for the M2-Q2 refined coast asset batch, created for Sceneweave with coding assistance. No reference-map imagery or third-party assets are embedded.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
