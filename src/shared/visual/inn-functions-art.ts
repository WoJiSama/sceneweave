import type { VisualSampleArt } from './sample-art.js'
import { REFINED_INTERIOR_ART, REFINED_INTERIOR_LICENSE } from './interior-art.js'

// Select individual original objects, never an existing room composition.
const selected = ['bed-indigo', 'table-round', 'table-long', 'chair-cushion', 'stove-masonry', 'counter-kitchen', 'cupboard-linen']
const borrowed = REFINED_INTERIOR_ART.filter(art => selected.some(key => art.key === `interior-${key}`) || ['interior-material-planks', 'interior-material-flags'].includes(art.key))
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
const grain = Array.from({ length: 12 }, (_, i) => `<path d="M${50 + i * 36} 65q-10 95 0 182t-2 192" fill="none" stroke="#C8B799" stroke-width="1.8" opacity=".4"/>`).join('')
const frame = (body: string) => '<rect x="24" y="35" width="464" height="444" rx="9" fill="#736B59" stroke="#414A3E" stroke-width="7"/><rect x="37" y="49" width="438" height="414" rx="4" fill="#9E8D70" stroke="#C8B590" stroke-width="3"/>' + grain + body
function prop(key: string, name: string, widthMm: number, heightMm: number, tags: string[], body: string): VisualSampleArt {
  return { key, name, kind: 'prop', widthMm, heightMm, footprintMm: { width: widthMm - 100, height: heightMm - 100 },
    sourceSvg: svg(body), blocksMovement: true, blocksSight: false, renderLayer: 'object', shadowClass: 'furniture', tags: ['灰橡旅舍', '原创', ...tags] }
}
const linen = prop('linen-open-rack', '叠巾开放布草架', 1800, 750, ['布草', '储藏', '搁架', 'shelf', 'linen', 'storage'], frame(
  '<rect x="56" y="83" width="400" height="343" fill="#545E4C"/><path d="M53 260H460" stroke="#B19B76" stroke-width="14"/>' +
  [0, 1, 2, 3, 4, 5].map((n) => { const x = 69 + n % 3 * 127, y = 98 + Math.floor(n / 3) * 180; return `<rect x="${x}" y="${y}" width="112" height="135" rx="7" fill="${n % 2 ? '#B3B69D' : '#D0C9AE'}" stroke="#7A8C72" stroke-width="3"/><path d="M${x + 7} ${y + 26}h98m-98 31h98m-98 31h98m-98 29h98" stroke="#E0D6BB" stroke-width="3"/><path d="M${x + 68} ${y + 4}v125" stroke="#93A08B" opacity=".6" stroke-width="3"/>` }).join('')))
const pantry = prop('pantry-rack', '陶罐食材架', 1700, 800, ['厨房', '食材', '搁架', 'shelf', 'pantry', 'kitchen'], frame(
  '<rect x="57" y="84" width="399" height="342" fill="#535B47"/><path d="M54 259H460" stroke="#B49D77" stroke-width="13"/>' +
  [0, 1, 2, 3, 4, 5].map(n => { const x = 123 + n % 3 * 132, y = 163 + Math.floor(n / 3) * 177; return `<ellipse cx="${x}" cy="${y}" rx="51" ry="65" fill="${n % 2 ? '#A99370' : '#929A80'}" stroke="#444F3C" stroke-width="4"/><ellipse cx="${x}" cy="${y - 8}" rx="38" ry="43" fill="#C3B596" stroke="#777F61" stroke-width="3"/><ellipse cx="${x}" cy="${y - 8}" rx="21" ry="25" fill="#7F8260"/><path d="M${x - 32} ${y - 39}q27 -19 58 0" fill="none" stroke="#DDD0AE" stroke-width="3"/>` }).join('')))
const nightstand = prop('nightstand', '床边单抽矮柜', 650, 650, ['床边', '客房', '储物柜', 'storage', 'nightstand', 'bedroom'], frame(
  '<rect x="64" y="79" width="384" height="322" rx="6" fill="#AD9B7B" stroke="#6B7057" stroke-width="5"/><path d="M46 422H466" stroke="#505C46" stroke-width="10"/><path d="M219 439H293" stroke="#D1BF91" stroke-width="11" stroke-linecap="round"/><path d="M88 103q149 18 336 0M83 365q148 -17 341 -3" fill="none" stroke="#CABA99" stroke-width="3"/>'))
const washstand = prop('washstand', '陶盆洗漱台', 1200, 650, ['洗漱', '盥洗', '工作台', 'work', 'wash', 'guest'], frame(
  '<ellipse cx="220" cy="246" rx="142" ry="160" fill="#BFC4AA" stroke="#647A62" stroke-width="8"/><ellipse cx="220" cy="245" rx="119" ry="136" fill="#D9D6B9" stroke="#9DAF94" stroke-width="5"/><ellipse cx="220" cy="250" rx="92" ry="102" fill="#95B2A5"/><path d="M155 228q49 -40 110 -8M159 290q54 22 112 -5" fill="none" stroke="#C7D6BA" stroke-width="3"/><path d="M389 95h61v294h-61Z" fill="#C9C8AD" stroke="#829779" stroke-width="3"/><path d="M400 108v264M418 108v264M436 108v264" stroke="#E0D9BB" stroke-width="3"/>'))
const prep = prop('prep-block', '菜板备餐台', 1800, 850, ['厨房', '备餐', '工作台', 'work', 'prep', 'kitchen'], frame(
  '<rect x="66" y="78" width="278" height="334" rx="19" fill="#C2AE85" stroke="#716C4F" stroke-width="5"/><path d="M89 95v294m36 -294v294m36 -294v294m36 -294v294m36 -294v294m36 -294v294m36 -294v294" stroke="#9E956E" stroke-width="2"/><path d="M166 166q93 -43 117 70q-13 73 -101 59Z" fill="#AEB18B" stroke="#6A7E58" stroke-width="4"/><path d="M187 171q-2 76 73 105M184 215l55 -24" fill="none" stroke="#D0CDA1" stroke-width="4"/><path d="M388 134l33 3l-18 196l-21 -1Z" fill="#B6BCA8" stroke="#5C6F58" stroke-width="3"/><path d="M382 330l23 2l-4 72l-27 -2Z" fill="#746750" stroke="#485840" stroke-width="4"/>'))
const chest = prop('linen-chest', '铁扣布草箱', 1200, 800, ['布草', '储藏', '储物柜', 'storage', 'linen', 'chest'], frame(
  '<path d="M135 47v416M377 47v416" stroke="#66715B" stroke-width="23"/><path d="M136 53v404M378 53v404" stroke="#A0A88A" stroke-width="4"/><path d="M46 406H466" stroke="#536048" stroke-width="7"/><rect x="224" y="383" width="65" height="59" rx="8" fill="#A6AC87" stroke="#4B6148" stroke-width="4"/><circle cx="257" cy="413" r="7" fill="#4C5945"/>'))
export const INN_FUNCTION_ART: readonly VisualSampleArt[] = [...borrowed, linen, pantry, nightstand, washstand, prep, chest]
export const INN_FUNCTION_LICENSE = REFINED_INTERIOR_LICENSE
export const innDefinitionId = (key: string) => `inn-function-v1-prop-${key}`
export const innAssetId = (key: string) => `inn-function-v1-art-${key}`
export const innMaterialId = (key: string) => `inn-function-v1-material-${key}`
