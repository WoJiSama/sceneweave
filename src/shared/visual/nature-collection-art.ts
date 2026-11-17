import { NATURE_DESIGNS, type NatureDesign } from '../assets/nature-collection.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

type Pt = readonly [number, number]
type Crown = readonly [number, number, number, number]
type Foliage = 'oak' | 'light' | 'dark' | 'silver' | 'autumn' | 'pine'
const f = (n: number) => Math.round(n * 100) / 100
const rep = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i)).join('')
const rnd = (seed: number, i: number) => { let n = Math.imul(seed + i * 2371, 0x45d9f3b); n ^= n >>> 16; n = Math.imul(n, 0x45d9f3b); return (n >>> 0) / 4294967296 }
const p = (d: string, fill = 'none', stroke = 'none', sw = 1) => d ? `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>` : ''
const e = (x: number, y: number, rx: number, ry: number, fill: string, stroke = 'none', sw = 1) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
const g = (transform: string, body: string) => `<g transform="${transform}">${body}</g>`
const poly = (pts: readonly Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z'
function smooth(pts: readonly Pt[]): string { return `M${f((pts[0][0] + pts[pts.length - 1][0]) / 2)} ${f((pts[0][1] + pts[pts.length - 1][1]) / 2)}` + pts.map(([x, y], i) => { const next = pts[(i + 1) % pts.length]; return `Q${f(x)} ${f(y)} ${f((x + next[0]) / 2)} ${f((y + next[1]) / 2)}` }).join('') + 'Z' }
function rough(x: number, y: number, rx: number, ry: number, seed: number, n = 31, amount = .19): Pt[] { return Array.from({ length: n }, (_, i) => { const a = i * Math.PI * 2 / n, r = 1 - amount + rnd(seed, i) * amount; return [x + rx * r * Math.cos(a), y + ry * r * Math.sin(a)] }) }
function inside(x: number, y: number, pts: readonly Pt[]): boolean { let on = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) on = !on } return on }
const shrink = (pts: readonly Pt[], x: number, y: number, sx: number, sy = sx): Pt[] => pts.map(([a, b]) => [x + (a - x) * sx, y + (b - y) * sy])
const leafColors: Record<Foliage, readonly string[]> = {
  oak: ['#557443', '#718B51', '#8FA465', '#3F603B'], light: ['#7B9D58', '#9EB46C', '#BED08B', '#648349'],
  dark: ['#335442', '#45674B', '#6F8558', '#294639'], silver: ['#899A7A', '#ADBA96', '#CDD0A9', '#657E6A'],
  autumn: ['#826B40', '#A68B4D', '#C2A25C', '#647049'], pine: ['#466754', '#5B7A5C', '#8CA078', '#314F45'],
}
/** Many irregular leaf marks share four paths so surface detail does not consume the SVG path budget. */
function leafMarks(pts: readonly Pt[], seed: number, style: Foliage, count: number, length = 8, narrow = false): string {
  const paths = ['', '', '', ''], xs = pts.map(t => t[0]), ys = pts.map(t => t[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
  let placed = 0
  for (let i = 0; i < count * 12 && placed < count; i++) {
    const x = x0 + rnd(seed, i * 5) * w, y = y0 + rnd(seed, i * 5 + 1) * h, a = rnd(seed, i * 5 + 2) * Math.PI * 2
    const len = length * (.5 + rnd(seed, i * 5 + 3)), dx = Math.cos(a) * len, dy = Math.sin(a) * len, thick = (narrow ? .13 : .42) * len
    const nx = -Math.sin(a) * thick, ny = Math.cos(a) * thick
    if (![[-1, 0], [1, 0], [0, 1], [0, -1]].every(([u, v]) => inside(x + dx * u + nx * v, y + dy * u + ny * v, pts))) continue
    paths[placed % 4] += `M${f(x - dx)} ${f(y - dy)}Q${f(x + nx)} ${f(y + ny)} ${f(x + dx)} ${f(y + dy)}Q${f(x - nx)} ${f(y - ny)} ${f(x - dx)} ${f(y - dy)}Z`
    placed++
  }
  return paths.map((d, i) => p(d, leafColors[style][i])).join('')
}
function clump(x: number, y: number, rx: number, ry: number, seed: number, style: Foliage = 'oak', density = 50, narrow = false): string {
  const pts = rough(x, y, rx, ry, seed, 33, .25), small = rough(x - rx * .14, y - ry * .17, rx * .74, ry * .69, seed + 19, 25, .3)
  const patch=['','']
  for(let n=0;n<9;n++){const xx=x+(rnd(seed,n)-.5)*rx,yy=y+(rnd(seed+3,n)-.5)*ry,part=rough(xx,yy,rx*(.16+rnd(seed+2,n)*.19),ry*(.17+rnd(seed+4,n)*.2),seed+n,19,.35);if(part.every(([a,b])=>inside(a,b,pts)))patch[n%2]+=smooth(part)}
  return p(smooth(pts), `url(#${style})`, leafColors[style][3], .6) + `<g opacity=".23">${p(smooth(small), leafColors[style][2])}${p(patch[0],leafColors[style][0])}${p(patch[1],leafColors[style][2])}</g>` + leafMarks(pts, seed + 1, style, Math.round(density*1.7), Math.max(4, Math.min(rx, ry) * .073), narrow)
}
function woodLine(d: string, width: number, color = '#82704D'): string { return p(d, 'none', '#493F30', width + 3) + p(d, 'none', color, width) + p(d, 'none', '#B6A17B', Math.max(.8, width * .13)) }
function treeBranches(layout: readonly Crown[], seed: number, pale = false, sparse = false): string {
  return layout.map(([x,y],n)=>{const sx=300+(rnd(seed,n)-.5)*27,sy=304+(rnd(seed+1,n)-.5)*29,dx=x-sx,dy=y-sy,len=Math.hypot(dx,dy)||1,nx=-dy/len*(sparse?10:16),ny=dx/len*(sparse?10:16),mx=sx+dx*.43+(rnd(seed+2,n)-.5)*45,my=sy+dy*.43+(rnd(seed+3,n)-.5)*39
    return p(`M${f(sx+nx)} ${f(sy+ny)}Q${f(mx+nx*.55)} ${f(my+ny*.55)} ${x} ${y}Q${f(mx-nx*.48)} ${f(my-ny*.48)} ${f(sx-nx)} ${f(sy-ny)}Z`,pale?'url(#birch)':'url(#bark)','#514D38',.7)+p(`M${f(sx)} ${f(sy)}Q${f(mx)} ${f(my)} ${x} ${y}`,'none',pale?'#DDD8BD':'#B59A6C',sparse?1:1.7)
  }).join('')
}
function sprays(x: number, y: number, angle: number, length: number, width: number, seed: number, style: Foliage, thin = false): string {
  const paths = ['', '', '', '']
  for (let i = 0; i < 29; i++) { const t = .04 + i / 30, yy = -t * length, spread = width * (1 - t) * (.65 + rnd(seed, i) * .35), side = i % 2 ? 1 : -1; paths[i % 4] += `M${f(side * 2)} ${f(yy + 10)}Q${f(side * spread * .45)} ${f(yy - length * .07)} ${f(side * spread)} ${f(yy + 13 - length * .04)}Q${f(side * spread * .4)} ${f(yy + 3)} 0 ${f(yy + 13)}Z` }
  return g(`translate(${x} ${y}) rotate(${angle})`, p(`M0 4Q7 ${-length * .5} 0 ${-length}`, 'none', thin ? '#A8B381' : '#5B7052', thin ? 1.5 : 4) + paths.map((d, i) => `<g opacity="${thin ? '.8' : '1'}">${p(d, leafColors[style][i])}</g>`).join(''))
}
const treeLayouts: readonly (readonly Crown[])[] = [
  [[162,196,112,101],[301,141,106,98],[435,201,119,111],[164,344,119,112],[310,294,119,112],[431,387,104,113],[286,450,110,88]],
  [[206,183,133,125],[363,165,132,112],[159,324,107,122],[304,305,139,131],[438,309,101,124],[260,450,127,91],[400,435,111,100]],
  [[159,158,81,77],[310,118,72,66],[445,194,83,76],[130,353,80,75],[290,300,58,60],[425,376,85,79],[302,485,71,63]],
  [[111,254,73,113],[216,146,115,88],[386,135,114,81],[492,253,74,119],[380,334,111,115],[234,328,122,127],[300,466,115,75]],
  [[143,206,67,69],[287,119,70,64],[432,199,70,70],[173,366,65,79],[381,361,77,70],[306,478,68,62]],
  [[184,158,108,100],[359,142,117,103],[448,298,96,118],[338,400,123,132],[165,389,108,116],[234,290,121,107]],
  [[112,281,71,103],[224,172,113,106],[390,156,109,108],[462,327,90,130],[340,345,124,122],[234,458,115,87]],
  [[149,197,96,95],[316,139,110,100],[456,253,93,111],[180,388,111,111],[352,369,119,129]],
  [[136,212,90,91],[297,139,92,94],[463,220,85,93],[137,399,85,85],[306,413,106,110],[456,393,82,80]],
  [[251,125,114,79],[210,253,119,110],[392,229,83,124],[346,401,126,126],[217,458,91,81]],
  [[146,177,63,62],[292,121,66,60],[443,191,65,66],[146,384,70,67],[425,384,68,69],[297,478,70,59]],
  [[173,184,116,95],[340,146,123,95],[448,253,101,120],[155,341,97,139],[313,351,113,140],[424,420,86,101],[271,468,103,76]],
  [[183,174,111,111],[391,183,123,112],[162,378,107,128],[366,371,145,133]],
  [[269,133,102,90],[351,236,107,103],[240,326,110,117],[340,438,106,102]],
  [[142,220,86,102],[272,119,120,78],[451,201,98,117],[159,399,102,103],[342,332,143,129],[425,449,89,78]],
  [[167,206,107,104],[352,172,122,100],[434,335,102,119],[258,396,132,133]],
  [[294,125,79,78],[200,266,96,110],[365,265,99,111],[274,432,127,111]],
  [[137,253,86,97],[274,150,111,108],[433,222,102,112],[201,399,110,105],[398,399,110,108]],
  [[139,178,74,63],[339,137,100,67],[461,291,72,91],[190,396,93,81],[363,434,109,73]],
  [[256,151,101,102],[351,275,114,129],[259,421,119,107]],
  [[134,239,87,112],[283,145,83,82],[459,245,84,99],[338,386,114,112],[172,438,92,70]],
  [[142,171,93,83],[324,127,102,80],[464,270,84,103],[146,363,97,108],[330,425,103,103],[468,430,71,69]],
  [[182,180,98,64],[369,129,139,64],[456,276,95,74],[350,397,145,84]],
  [], [], [],
  [[128,218,100,62],[296,141,158,62],[480,261,86,88],[160,403,128,64],[375,408,161,75]],
  [], [],
  [[135,186,100,114],[284,115,103,75],[456,189,101,100],[117,364,80,96],[290,287,141,130],[478,372,78,115],[257,468,121,91],[402,465,88,75]],
]
function tree(i: number): string {
  const layout = treeLayouts[i], seed = 1000 + i * 73
  if ([23, 24, 25].includes(i)) {
    const angles = [-161,-123,-87,-43,-8,32,74,119,158], lengths = [197,236,240,222,196,222,242,220,206]
    return clump(300,300,i===25?70:134,i===25?70:128,seed,'pine',50,true) + angles.map((a, n) => sprays(300,300,a,lengths[n],i===24?85:75,seed+n,i===25?'light':'pine',i===25)).join('') + angles.filter((_,n)=>n%2===0).map((a,n)=>sprays(296,285,a+21,lengths[n]*.66,47,seed+n+23,i===25?'light':'pine',i===25)).join('')+clump(291,279,48,52,seed,'pine',29,true)
  }
  if (i === 27 || i === 28) {
    const branches:readonly (readonly Pt[])[]=[[[301,313],[266,239],[180,175],[100,198]],[[299,304],[294,202],[347,135],[322,78]],[[297,307],[371,271],[443,241],[508,151]],[[303,314],[366,372],[439,410],[429,493]],[[302,312],[252,379],[186,419],[114,393]]]
    let body=branches.map((v,n)=>{const wide=n===1?33:23,head=v[0],tail=v[3],mx=(v[1][0]+v[2][0])/2,my=(v[1][1]+v[2][1])/2
      return p(`M${head[0]-wide/2} ${head[1]}C${v[1][0]-wide*.25} ${v[1][1]} ${v[2][0]-4} ${v[2][1]} ${tail[0]} ${tail[1]}C${v[2][0]+5} ${v[2][1]+4} ${v[1][0]+wide*.25} ${v[1][1]+7} ${head[0]+wide/2} ${head[1]+8}Z`,'url(#bark)','#514B37',.8)+p(`M${head[0]} ${head[1]}C${v[1][0]} ${v[1][1]} ${v[2][0]} ${v[2][1]} ${tail[0]} ${tail[1]}`,'none','#B6A17A',1.6)+woodLine(`M${mx} ${my}q${n%2?-45:47} -14 ${n%2?-65:78} ${n%2?-76:32}`,5)+woodLine(`M${v[1][0]} ${v[1][1]}q${n%2?40:-37} 24 ${n%2?38:-64} ${n%2?66:-53}`,6)+p(`M${tail[0]-3} ${tail[1]-2}l5 3`,'none','#CFBB94',1.5)
    }).join('')
    body += p(smooth(rough(300,300,60,51,seed,15,.3)),'url(#bark)','#453C2E',2)+p('M285 279l18 31-5 25m-1-44l22 15','none','#B19C74',3)
    return body + (i===28 ? clump(441,352,82,115,seed,'pine',85,true) + clump(393,457,76,65,seed+2,'pine',55,true) : '')
  }
  let body = treeBranches(layout,seed,i===4||i===14,i===2||i===4||i===18)
  if(i===29)body=woodLine('M300 300Q259 238 162 148M300 300Q387 351 479 434M300 300Q309 402 242 492',45)+body
  const style: Foliage = i===5?'autumn':i===18?'silver':i===19?'dark':i>=20?'pine':i===4||i===2?'light':'oak'
  if(![2,4,10,18,22,26].includes(i))body+=clump(298,297,i===19?112:i===13?107:190,i===19?149:i===13?166:181,seed+89,style,145,i>=20)
  if([2,4,10,18,22,26].includes(i))body+=layout.filter((_,n)=>n%2===0).map(([x,y,rx,ry],n)=>clump(300+(x-300)*.55+12,300+(y-300)*.56-13,rx*.53,ry*.57,seed+n+88,style,28,i>=20||i===18)).join('')
  body+=layout.map(([x,y,rx,ry],n)=>clump(x,y,rx,ry,seed+n*7,style,i===2||i===4?45:74,[11,18,19,20,21,22,26].includes(i))).join('')
  if(i===7)body+=rep(16,n=>{const x=136+rnd(seed,n*3)*330,y=144+rnd(seed,n*3+1)*300;return layout.some(([a,b,rx,ry])=>((x-a)/rx)**2+((y-b)/ry)**2<.7)?rep(5,k=>g(`translate(${f(x)} ${f(y)}) rotate(${k*69+n*17})`,p('M0 2Q-13-21-3-42Q9-25 0 2Z',k%2?'#8BA766':'#A6B777'))):''})
  if(i===11)body+=rep(53,n=>{const x=115+rnd(seed,n)*370,y=125+rnd(seed+1,n)*331;return layout.some(([a,b,rx,ry])=>((x-a)/rx)**2+((y-b)/ry)**2<.52)?longLeaf(x,y,40+rnd(seed+2,n)*43,3,n*19,'#94A76B'):''})
  if(i===15||i===16)body+=rep(25,n=>{const x=134+rnd(seed,n)*322,y=140+rnd(seed+1,n)*310;return layout.some(([a,b,rx,ry])=>((x-a)/rx)**2+((y-b)/ry)**2<.7)?e(x,y,3.7,3.4,i===15?'#B7A45A':'#B8AC6B','#6E7343',.6):''})
  if(i===17)body+=layout.map(([x,y,rx,ry],n)=>leafMarks(rough(x,y,rx*.8,ry*.8,seed+n),seed+n,'silver',70,4)).join('')
  return body
}

function berries(pts: readonly Pt[], seed: number, count: number, color: string): string {
  return rep(count,n=>{const x=70+rnd(seed,n*2)*460,y=70+rnd(seed,n*2+1)*460;return inside(x,y,pts)?e(x,y,3.6,3.3,color,'#494E33',.6)+e(x-1,y-1,1,1,'#D1BA8C'):''})
}
function shrub(i: number): string {
  const seed=3300+i*43, narrow=[6,7,8,9,10,22,24,25,28,29].includes(i), style:Foliage=[4,5,6,17,21].includes(i)?'dark':[24,25,26,27,29].includes(i)?'silver':i===8?'autumn':'light'
  const layouts: readonly (readonly Crown[])[]=[
    [[190,209,128,127],[386,188,131,107],[173,393,109,101],[359,366,141,139]],
    [[133,245,85,126],[316,159,116,97],[452,331,98,119],[250,421,122,100]],
    [[141,208,94,98],[332,143,134,75],[469,284,69,127],[258,390,139,122]],
    [[153,175,92,94],[385,171,109,90],[174,409,107,96],[430,387,79,110]],
    [[190,196,127,123],[385,233,128,141],[269,402,146,118]],
    [[190,226,134,136],[369,196,125,106],[367,386,135,129],[191,417,118,78]],
    [[131,277,83,120],[301,176,112,99],[464,292,80,111],[296,414,135,105]],
    [[132,217,83,99],[315,125,101,69],[480,299,62,109],[335,452,115,71],[168,429,87,71]],
    [[167,207,116,104],[369,178,129,78],[438,377,101,108],[209,404,134,107]],
    [[157,185,110,107],[404,226,132,143],[201,388,129,140]],
    [[122,214,72,96],[335,135,94,80],[468,285,71,110],[342,450,103,72],[140,403,71,92]],
    [[185,181,120,101],[386,201,125,117],[203,394,136,109],[414,410,99,88]],
    [[125,198,83,85],[338,139,134,84],[473,289,63,113],[339,435,126,95],[136,401,88,96]],
    [[185,157,114,91],[402,214,95,136],[184,362,122,119],[395,442,96,74]],
    [[131,242,74,122],[333,152,128,98],[454,343,98,121],[255,424,115,96]],
    [[189,215,135,141],[394,221,132,134],[297,413,145,108]],
    [[146,251,93,140],[327,164,134,103],[427,377,119,124],[230,447,110,71]],
    [[100,293,48,111],[236,164,87,103],[407,162,111,82],[468,343,74,123],[272,431,112,80]],
    [[136,235,87,120],[315,151,104,89],[464,315,79,131],[255,425,125,92]],
    [[153,183,106,111],[381,178,127,104],[430,398,109,113],[178,405,113,111]],
    [[156,251,99,135],[343,147,112,86],[452,360,91,116],[262,427,122,94]],
    [[166,213,116,123],[362,182,130,108],[429,385,109,118],[216,402,131,112]],
    [[120,241,67,108],[291,132,92,74],[469,243,76,117],[364,424,120,87],[169,415,81,83]],
    [[182,217,128,141],[375,172,136,89],[439,358,99,111],[236,419,145,101]],
    [[112,275,62,117],[288,168,121,97],[463,272,75,122],[313,426,146,98]],
    [[144,210,93,98],[355,148,125,83],[466,322,78,126],[277,423,143,97]],
    [[139,263,88,135],[340,170,141,97],[433,397,116,105],[206,421,115,83]],
    [[167,210,111,127],[390,194,122,111],[309,403,159,120]],
    [[130,231,74,118],[318,142,111,87],[475,307,64,128],[302,430,138,99]],
    [[159,222,104,130],[354,159,121,87],[454,361,87,109],[224,418,133,97]],
  ]
  const layout=layouts[i], outer=rough(300,300,247,241,seed,36,.17)
  const leafy=(x:number,y:number)=>layout.some(([cx,cy,rx,ry])=>((x-cx)/rx)**2+((y-cy)/ry)**2<.7)
  if([8,9,10,22,28,29].includes(i)){
    const colors=i===9||i===10?'#CFB057':i===8||i===29?'#AA85A3':'#9DA6B7'
    const sites:readonly Pt[]=[[206,264],[356,220],[378,372],[226,409],[302,320]]
    let out=sites.map(([x,y],n)=>clump(x,y,i===22?62:i===10?65:91,i===22?47:i===10?58:76,seed+n,style,41,true)).join('')
    out+=rep(i===9?19:i===22?11:15,n=>{const [sx,sy]=sites[n%sites.length],angle=n*137.5+(rnd(seed,n)-.5)*53,len=(i===22?112:i===10?105:67)+rnd(seed+1,n)*57,bend=(rnd(seed+2,n)-.5)*61,leafCount=i===10?7:i===22?9:13
      const stem=p(`M0 3Q${f(bend)} ${f(-len*.47)} 0 ${f(-len)}`,'none',i===22?'#8E7955':'#839264',i===22?3.4:i===10?2.3:1.6)
      let leafShapes='',leafVeins='',thorns=''
      for(let k=0;k<leafCount;k++){const t=.08+k*.85/leafCount,u=1-t,x=2*u*t*bend,y=-len*(.94*u*t+t*t),side=k%2?1:-1,leafLen=i===22?27+rnd(seed+k,n)*18:i===9?12:i===10?8:i===29?20:16,leafWidth=i===22?4:i===9?1.4:i===10?1.7:2.1,a=(side*(i===22?39:58)+(rnd(seed+k,n)-.5)*21)*Math.PI/180,point=(xx:number,yy:number)=>`${f(x+xx*Math.cos(a)-yy*Math.sin(a))} ${f(y+xx*Math.sin(a)+yy*Math.cos(a))}`
        leafShapes+=`M${point(0,2)}Q${point(-leafWidth,-leafLen*.46)} ${point(0,-leafLen)}Q${point(leafWidth*1.2,-leafLen*.55)} ${point(0,2)}Z`
        leafVeins+=`M${point(0,0)}Q${point(5,-leafLen*.5)} ${point(0,-leafLen)}`
        if(i===9)thorns+=`M${f(x)} ${f(y)}l${side*12} -10`
      }
      const leaves=p(leafShapes,`url(#${style})`,'#607A4B',.7)+p(leafVeins,'none','#C0CC93',.8)+p(thorns,'none','#6F7654',1.5)
      const flowers=i===22?'':i===29?rep(9,k=>e((rnd(seed+k,n)-.5)*10,-len+7+k*3.8,3.3,3.1,colors,'#8F8196',.5)):rep(i===8?5:3,k=>e((rnd(seed+k,n)-.5)*17,-len+4+(rnd(seed+3+k,n)-.5)*17,i===8?2.8:4,i===8?2.6:3.8,colors))
      return g(`translate(${sx} ${sy}) rotate(${f(angle)})`,stem+leaves+flowers)
    })
    return out
  }
  if([12,14,17,18].includes(i)){
    const vines:readonly (readonly Pt[])[]=[[[92,358],[91,158],[310,203],[476,122]],[[123,447],[347,395],[284,244],[492,359]],[[174,129],[283,227],[436,330],[435,472]]]
    let out=vines.map(v=>p(`M${v[0][0]} ${v[0][1]}C${v[1][0]} ${v[1][1]} ${v[2][0]} ${v[2][1]} ${v[3][0]} ${v[3][1]}`,'none','#6E7250',4)).join('')
    out+=vines.map((v,j)=>rep(13,n=>{const t=.04+n*.073,u=1-t,x=u*u*u*v[0][0]+3*u*u*t*v[1][0]+3*u*t*t*v[2][0]+t*t*t*v[3][0],y=u*u*u*v[0][1]+3*u*u*t*v[1][1]+3*u*t*t*v[2][1]+t*t*t*v[3][1],angle=n*131+j*47,leaf=i===17?g(`translate(${f(x)} ${f(y)}) rotate(${angle})`,p('M0 9L-19-1-12-13-17-27-2-22 7-36 13-18 28-16 18-4 21 8Z','url(#dark)','#456847',.7)+p('M0 9L7-28M0 9l-12-27M0 9l21-19','none','#A1B58A',.7)):rep(i===12?3:2,k=>longLeaf(x,y,28+rnd(seed+n+k,j)*17,10,angle+k*(i===12?55:177),`url(#${style})`));return leaf+(i===14&&n%5===0?blossom(x,y,12,seed+n,'#C8AAAD',5):i===12&&n%4===0?e(x,y,4,4,'#514351'):'')})).join('')
    return out
  }
  let body=treeBranches(layout,seed,false,true)+clump(300,300,i===6||i===24?159:181,i===6||i===24?147:175,seed+99,style,134,narrow)
  if(i===17||i===18)body+=woodLine('M105 343Q149 70 429 162Q550 241 392 450Q183 519 105 343',8)
  body+=layout.map(([x,y,rx,ry],n)=>clump(x,y,rx,ry,seed+n*17,style,[3,10,12,14,18,20,22].includes(i)?31:58,narrow)).join('')
  if([1,2,4,11,12,13,15,16,20,21,25].includes(i))body+=rep(52,n=>{const x=85+rnd(seed+3,n*2)*430,y=85+rnd(seed+3,n*2+1)*430;return leafy(x,y)?e(x,y,3.6,3.3,({1:'#A15B40',2:'#536475',4:'#AB5B46',11:'#4E596D',12:'#4A4050',13:'#B56550',15:'#B4BC73',16:'#BA6851',20:'#B77F78',21:'#414E48',25:'#C79646'} as Record<number,string>)[i],'#525C3D',.6):''})
  if([3,8,9,10,14,18,19,23,28,29].includes(i))body+=rep(36,n=>{const x=95+rnd(seed,n)*410,y=98+rnd(seed+2,n)*403;if(!leafy(x,y))return'';const color=[9,10].includes(i)?'#D2B75D':i===8||i===29?'#B795B0':i===28?'#95A2BC':i===14?'#D0B2B1':'#D2CBAA';return e(x,y,3.6,2.8,color)+e(x+3.3,y+1,2.2,2.6,color)})
  if(i===22||i===10)body+=rep(16,n=>{const a=n*2.399+seed,x=300+Math.cos(a)*(167+rnd(seed,n)*75),y=300+Math.sin(a)*(164+rnd(seed+1,n)*76);return woodLine(`M300 300Q${f((x+300)/2-20)} ${f((y+300)/2)} ${f(x)} ${f(y)}`,2.5,i===22?'#987052':'#8B9762')})
  return body
}

function stoneMarks(pts: readonly Pt[], seed: number, count=180, pale=false): string {
  const paths=['','','',''], xs=pts.map(t=>t[0]),ys=pts.map(t=>t[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0
  for(let n=0;n<count;n++){const x=x0+rnd(seed,n*4)*w,y=y0+rnd(seed,n*4+1)*h,dx=2+rnd(seed,n*4+2)*6,dy=1+rnd(seed,n*4+3)*3;if(!inside(x,y,pts)||!inside(x+dx,y+dy,pts)||!inside(x+dx/2,y-2,pts))continue;paths[n%4]+=`M${f(x)} ${f(y)}l${f(dx*.45)} -2 ${f(dx*.55)} ${f(dy+2)}Z`}
  const colors=pale?['#DFD7BC','#AAAE98','#C3C4A9','#929D88']:['#A6AC96','#6F7A6B','#C6C6A8','#82917B']
  return `<g opacity=".55">${paths.map((d,n)=>p(d,colors[n])).join('')}</g>`
}
function rockBody(x:number,y:number,rx:number,ry:number,seed:number,material='granite',rounded=false):string {
  const pts=rough(x,y,rx,ry,seed,rounded?31:18,rounded?.14:.24),draw=smooth
  const left=shrink(pts,x,y,.83,.83).map(([a,b])=>[a-rx*.06,b-ry*.08] as const)
  const patches=['','']
  for(let n=0;n<12;n++){const xx=x+(rnd(seed,n)-.5)*rx*1.2,yy=y+(rnd(seed+1,n)-.5)*ry*1.2,rrx=rx*(.055+rnd(seed+2,n)*.07),rry=ry*(.05+rnd(seed+3,n)*.07),part=rough(xx,yy,rrx,rry,seed+n,11,.4);if(part.every(([a,b])=>inside(a,b,pts)))patches[n%2]+=smooth(part)}
  return p(draw(pts),`url(#${material})`,'#626E60',1)+`<g opacity=".2">${p(draw(left),'#DED5AF')}${p(patches[0],'#CDD0B0')}${p(patches[1],'#728875')}</g>`+stoneMarks(pts,seed+2,Math.min(330,Math.round(rx*ry/160)),['chalk','calcite','sandstone','marble'].includes(material))
}
function clipped(pts:readonly Pt[],x0:number,y0:number,x1:number,y1:number):string {let d='',start:Pt|null=null,last:Pt|null=null;const flush=()=>{if(start&&last)d+=`M${f(start[0])} ${f(start[1])}L${f(last[0])} ${f(last[1])}`;start=null;last=null};for(let n=1;n<180;n++){const t=n/180,x=x0+(x1-x0)*t,y=y0+(y1-y0)*t;if(inside(x,y,pts)){if(!start)start=[x,y];last=[x,y]}else flush()}flush();return d}
function strata(pts:readonly Pt[],seed:number,kind='parallel',count=13,color='#7C7D69'):string {
  let d=''
  for(let n=0;n<count;n++){const y=75+n*450/count,curve=kind==='wavy'?40:6;let last:Pt|null=null;for(let j=0;j<100;j++){const x=40+j*5.2,yy=y+Math.sin(x/84+n*.6)*curve+(x-300)*(kind==='slanted'?.25:.07);if(inside(x,yy,pts)){d+=`${last?'L':'M'}${f(x)} ${f(yy)}`;last=[x,yy]}else last=null}}
  return p(d,'none',color,kind==='wavy'?6:2.3)+p(d,'none',kind==='wavy'?'#C0BFA3':'#C5C0A0',kind==='wavy'?2: .65)
}
function pits(pts:readonly Pt[],seed:number,count:number,pale=false):string {return rep(count,n=>{const x=83+rnd(seed,n*3)*438,y=85+rnd(seed,n*3+1)*430,rad=4+rnd(seed,n*3+2)*15;return [[x-rad,y],[x+rad,y],[x,y-rad],[x,y+rad]].every(([a,b])=>inside(a,b,pts))?e(x,y,rad,rad*.73,pale?'#8F9983':'#3D4C43',pale?'#D4CFB2':'#8D9C82',1.3)+p(`M${f(x-rad*.66)} ${f(y+rad*.23)}q${f(rad*.66)} ${f(rad*.7)} ${f(rad*1.32)} 0`,'none',pale?'#E0D8B8':'#A3AA8C',1.1):''})}
function rock(i:number):string {
  const seed=7000+i*71,rounded=[1,22,25,29].includes(i),pts=shrink(rough(300,300,254,230,seed,rounded?31:18,rounded?.14:.24),300,300,.94)
  const joints=(lines:readonly (readonly [number,number,number,number])[],sw=3,color='#657562')=>p(lines.map(([x,y,a,b])=>clipped(pts,x,y,a,b)).join(''),'none',color,sw)
  let body=rockBody(300,300,254,230,seed,['sandstone-bed','wind-sandstone','ironstone'].includes(NATURE_DESIGNS.filter(d=>d.category==='rock')[i].key.replace('rock-',''))?'sandstone':[8,9].includes(i)?'limestone':i===11?'chalk':[12,13,14].includes(i)?'basalt':i===19?'marble':'granite',i===1||i===22||i===25||i===29)
  switch(i){
    case 0:return body+joints([[82,178,263,276],[263,276,506,187],[263,276,242,487],[386,223,461,404]],4)+joints([[89,180,264,271],[269,278,248,480]],1,'#C1C5A7')
    case 1:return body+p(smooth(rough(365,344,116,104,seed+3,24,.17)),'none','#D3C8A6',7)+p('M129 219Q160 101 316 114M381 475q81-13 100-76','none','#6A7665',5)+pits(pts,seed,8)
    case 2:return rockBody(219,375,161,145,seed,'granite',true)+rockBody(419,346,126,153,seed+1,'granite',true)+rockBody(280,191,188,140,seed+2,'granite',true)
    case 3:return rockBody(306,355,254,166,seed,'sandstone')+strata(shrink(rough(306,355,254,166,seed,18,.24),306,355,.94),seed,'slanted',18,'#A18C67')+rockBody(285,232,221,167,seed+1,'sandstone')+strata(shrink(rough(285,232,221,167,seed+1,18,.24),285,232,.94),seed,'slanted',18,'#A18C67')
    case 4:return body+pits(pts,seed,14,true)+strata(pts,seed,'wavy',7,'#AC956F')+p('M109 344Q230 231 426 296Q449 372 383 416Q220 473 109 344Z','#8B8063','#B9A580',5)
    case 5:return body+strata(pts,seed,'wavy',8,'#866C4A')+rep(14,n=>{const x=125+rnd(seed,n)*350,y=125+rnd(seed+1,n)*350;return inside(x,y,pts)?p(smooth(rough(x,y,13+rnd(seed+2,n)*24,12+rnd(seed+3,n)*20,seed+n,13,.3)),'#96754D','#B89C70',1):''})
    case 6:return rep(7,n=>rockBody(288+(n%2?17:-13),149+n*45,224-n%3*17,57,seed+n,'slate')+strata(shrink(rough(288+(n%2?17:-13),149+n*45,224-n%3*17,57,seed+n,18,.24),288+(n%2?17:-13),149+n*45,.91),seed+n,'slanted',13,'#737F76'))
    case 7:return rockBody(253,363,210,147,seed,'slate')+strata(shrink(rough(253,363,210,147,seed,18,.24),253,363,.93),seed,'slanted',16,'#A1B39E')+rockBody(352,224,197,151,seed+1,'slate')+strata(shrink(rough(352,224,197,151,seed+1,18,.24),352,224,.93),seed+1,'slanted',17,'#A1B39E')
    case 8:return body+pits(pts,seed,38,true)
    case 9:return [[190,190,131,126],[414,188,131,119],[162,396,108,132],[366,379,112,137],[486,430,63,85]].map(([x,y,rx,ry],n)=>rockBody(x,y,rx,ry,seed+n,'limestone')+strata(shrink(rough(x,y,rx,ry,seed+n,18,.24),x,y,.9),seed+n,'slanted',8,'#99A690')).join('')
    case 10:return [[150,204,88,79],[326,155,115,93],[441,334,99,115],[217,403,137,102]].map(([x,y,rx,ry],n)=>rockBody(x,y,rx,ry,seed+n,'flint',true)+p(smooth(rough(x+7,y-8,rx*.67,ry*.68,seed+n+3,16,.16)),'url(#basalt)','#B6B69C',2)).join('')
    case 11:return body+rep(17,n=>{const a=n*2.399,x=300+Math.cos(a)*(188+rnd(seed,n)*66),y=300+Math.sin(a)*(160+rnd(seed+1,n)*65);return rockBody(x,y,9+rnd(seed+2,n)*12,7+rnd(seed+3,n)*9,seed+n,'chalk')})+p('M101 220L280 319 477 240M281 319l48 161','none','#A8A992',3)
    case 12:return rockBody(300,300,250,239,seed,'basalt')+[[183,184,107,112],[365,154,106,102],[461,324,92,120],[301,331,111,115],[155,403,100,111],[350,485,104,66]].map(([x,y,rx,ry],n)=>{const count=n%3===0?5:6,corners=Array.from({length:count},(_,k)=>{const a=k*Math.PI*2/count+rnd(seed+n,k)*.14;return[x+rx*Math.cos(a),y+ry*Math.sin(a)] as const});return p(poly(corners),'url(#basalt)','#3D4B43',3)+stoneMarks(corners,seed+n,80)+p(poly(shrink(corners,x,y,.87)),'none','#87937E',1)}).join('')
    case 13:return body+strata(pts,seed,'wavy',21,'#485D50')+p('M121 205Q273 110 452 203M152 422q108 44 248-20','none','#43584B',5)
    case 14:return body+pits(pts,seed,62)
    case 15:return body+joints([[83,156,249,273],[249,273,307,252],[307,252,461,444],[249,273,206,399],[307,252,389,157]],17,'#D1D0B5')+joints([[83,156,249,273],[307,252,461,444],[249,273,206,399]],5,'#E2DCC4')
    case 16:return rockBody(300,310,243,201,seed,'granite')+[[178,232,54,74],[303,171,67,92],[422,261,62,76],[307,386,71,64],[159,391,44,57]].map(([x,y,rx,ry],n)=>{const a=rnd(seed,n)*.7,outer=rough(x,y,rx,ry,seed+n,6,.15);return p(poly(outer),'url(#quartz)','#8C9A8C',1)+p(`M${x} ${y}L${outer[0][0]} ${outer[0][1]}L${outer[1][0]} ${outer[1][1]}Z`,'#DFDDC0')+p(`M${x} ${y}L${outer[3][0]} ${outer[3][1]}`,'none','#A5B6A7',1.4)+p(`M${x} ${y}l${f(a*8)} -4`,'none','#F0E6CD',2)}).join('')
    case 17:return body+strata(pts,seed,'wavy',16,'#5E6B5D')
    case 18:return body+strata(pts,seed,'wavy',22,'#7A8A7A')+stoneMarks(pts,seed+5,220,true)
    case 19:return body+p('M112 185Q209 279 298 244T479 358M298 244q-28-73 17-116M362 291q-80 87-39 166','none','#E1D9BE',5)+p('M116 336Q273 457 452 229','none','#8F9E8A',2)
    case 20:return body+rep(35,n=>{const x=100+rnd(seed,n*3)*400,y=98+rnd(seed,n*3+1)*400,rad=9+rnd(seed,n*3+2)*22;return inside(x,y,shrink(pts,300,300,.83))?p(smooth(rough(x,y,rad,rad*.74,seed+n,17,.2)),n%3?'#A7AA90':'#7E8E7C','#CBC4A4',1.5):''})
    case 21:return body+rep(28,n=>{const x=115+rnd(seed,n*3)*371,y=112+rnd(seed,n*3+1)*374,rad=11+rnd(seed,n*3+2)*28;return inside(x,y,shrink(pts,300,300,.79))?p(poly(rough(x,y,rad,rad*.8,seed+n,5,.25)),n%3?'#9F9980':'#C1B696','#707C69',2):''})
    case 22:return body+strata(pts,seed,'parallel',8,'#97A28B')+p('M109 376Q145 423 198 439L176 384Z','#6E8170')
    case 23:return rockBody(168,326,119,164,seed,'granite',true)+rockBody(381,190,168,129,seed+1,'granite',true)+rockBody(399,407,137,125,seed+2,'granite',true)
    case 24:return rep(19,n=>{const a=n*2.399,dist=Math.sqrt(n/19)*192,x=300+Math.cos(a)*dist,y=300+Math.sin(a)*dist*.92;return g(`rotate(${f(rnd(seed+1,n)*70-35)} ${f(x)} ${f(y)})`,rockBody(x,y,51+rnd(seed+2,n)*42,39+rnd(seed+3,n)*36,seed+n,'slate'))})
    case 25:return body+strata(pts,seed,'parallel',9,'#7E8E7A')+clump(143,340,65,29,seed,'dark',20)+clump(418,431,45,22,seed+2,'oak',16)
    case 26:{const hollow=rough(291,286,158,133,seed+1,29,.2);return body+pits(pts,seed,23)+p(smooth(hollow),'#777C6A','#B9B79A',9)+stoneMarks(shrink(hollow,291,286,.88),seed+3,170)+p('M187 212l41 18 33-19m75 140 29-23 34 12M210 335l-16-31 18-17','none','#5E6558',2.5)}
    case 27:return body+joints([[86,173,251,263],[251,263,202,489],[251,263,481,150],[251,263,455,414]],9,'#536456')+rockBody(466,414,69,69,seed+3,'slate')
    case 28:return body+pits(pts,seed,31,true)+p('M101 286Q153 147 275 124Q172 205 147 328Z','#D0C8A9','#ABAF95',2)+p('M335 461Q469 468 509 348Q421 418 335 422Z','#B6B79D','#6F7F6D',2)
    case 29:return body+strata(pts,seed,'slanted',24,'#879985')+p('M100 235q42-107 133-113','none','#D0CFB1',4)
    default:throw new Error('未知自然岩体。')
  }
}

function barkTexture(pts:readonly Pt[],seed:number,kind='oak',count=110):string {
  const paths=['','','','']
  for(let n=0;n<count;n++){const x=-240+rnd(seed,n*3)*480,y=-85+rnd(seed,n*3+1)*170,len=8+rnd(seed,n*3+2)*55,dy=(rnd(seed+2,n)-.5)*8;if(!inside(x,y,pts)||!inside(x+len,y+dy,pts)||!inside(x+len*.5,y+dy*.5+4,pts))continue;paths[n%4]+=`M${f(x)} ${f(y)}q${f(len*.52)} ${f(dy*.5+3)} ${f(len)} ${f(dy)}`}
  const colors=kind==='birch'?['#625F50','#8A8876','#DED6B7','#5F5D50']:kind==='charred'?['#1F2C29','#546053','#71715D','#3C493F']:kind==='bare'?['#D0BC91','#A99771','#8D7F60','#C2AD82']:['#574B35','#AD9164','#786345','#C1A372']
  return paths.map((d,n)=>p(d,'none',colors[n],kind==='birch'?2.2:1.7)).join('')
}
function log(x:number,y:number,length:number,width:number,angle:number,seed:number,kind='oak'):string {
  const pts:Pt[]=[[-235,-55],...Array.from({length:18},(_,n)=>[-222+n*26,-65+(rnd(seed,n)-.5)*20] as const),[241,-48],[236,-17],[244,21],[235,59],...Array.from({length:18},(_,n)=>[220-n*26,64+(rnd(seed+1,n)-.5)*19] as const),[-234,43],[-230,6]]
  const fill=kind==='birch'?'url(#birch)':kind==='charred'?'url(#charcoal)':kind==='bare'?'url(#cut)':kind==='wet'?'url(#wetwood)':'url(#bark)'
  const body=p(smooth(pts),fill,'#4A4A37',1.2)+p('M-217-43Q-76-64 67-48T218-38','none',kind==='birch'?'#DDD8BE':kind==='bare'?'#CEBC92':'#A38B60',2)+barkTexture(pts,seed,kind,160)+e(-228,0,6,52,kind==='charred'?'#5B614C':'url(#cut)','#6A6147',1)+p('M-228-39q6 29 0 78','none','#CDB48A',1.3)
  return g(`translate(${x} ${y}) rotate(${angle}) scale(${length/490} ${width/178})`,body)
}
function shelfFungus(x:number,y:number,rx:number,ry:number,angle:number,seed:number):string {
  return g(`translate(${x} ${y}) rotate(${angle})`,p(`M${-rx*.4} 0Q${-rx*1.2} ${-ry*.95} 0 ${-ry}Q${rx*1.23} ${-ry*.93} ${rx*.47} 0Z`,'url(#fungus)','#6E6750',1.1)+p(`M${-rx*.43} ${-ry*.2}Q${-rx*.68} ${-ry*.73} 0 ${-ry*.73}Q${rx*.8} ${-ry*.68} ${rx*.5} ${-ry*.16}`,'none','#B9A07A',2)+p(`M${-rx*.25} ${-ry*.12}Q0 ${-ry*.5} ${rx*.3} ${-ry*.1}`,'none','#D3BD90',2)+stoneMarks(rough(0,-ry*.5,rx*.55,ry*.44,seed),seed,20,true))
}
function fallenLog(i:number):string {
  const seed=10000+i*51
  const base=(kind='oak',angle=-8)=>log(300,300,490,171,angle,seed,kind)
  const stub=(d:string,w=22)=>woodLine(d,w)
  switch(i){
    case 0:return stub('M236 272l-57-101M373 323l62 112')+base()+e(337,277,18,11,'#746044','#BEA078',2)
    case 1:return stub('M273 276l-33-78',17)+base('bare',5)+p('M135 297q130-37 284 4','none','#A5A38B',9)
    case 2:return stub('M201 287l-64-91M395 305l43 93',15)+base('birch',-5)+p('M168 244l42-13-13 32-32-3ZM382 316l57-11-24 29-30 1Z','#BFB598','#E0D6B5',2)
    case 3:return stub('M194 292l-41-90M364 304l53 100',23)+base('oak',4)+p('M132 277l55-13 39 9 39-18 43 9 51-11 38 7 46-7M150 337l59-16 44 11 48-15 53 8 44-19','none','#A38255',7)
    case 4:return log(296,240,482,110,-4,seed)+log(307,373,471,110,3,seed+1)+p('M85 296L221 274 449 299 521 323 348 321 194 302Z','url(#cut)','#6A6147',2)
    case 5:return base()+p('M107 294Q222 231 412 253L500 287Q341 350 163 329Z','#3A4435','#B29A6E',7)+p('M142 296q147-19 290-7','none','#5B6043',5)
    case 6:return stub('M155 300Q101 223 68 132M155 300Q84 314 61 396M155 300Q172 414 138 481M155 300L84 231M116 188l29-53',17)+log(348,305,398,144,-5,seed)+p(smooth(rough(153,296,72,83,seed,20,.3)),'url(#bark)','#504B36',2)+stoneMarks(rough(153,296,61,70,seed),seed,38)
    case 7:return log(223,339,337,154,-10,seed)+log(412,221,293,116,-42,seed+1)+log(417,383,280,127,31,seed+2)
    case 8:return base('wet')+clump(224,253,126,36,seed,'dark',56)+clump(411,289,77,40,seed+1,'oak',39)
    case 9:return base('wet')+rep(5,n=>shelfFungus(146+n*75,342-n%2*6,43+n%2*13,58-n%3*7,180+n*3,seed+n))
    case 10:return base('charred',2)+p('M124 292l74-29 41 35 63-21 49 29 86-27M157 329l43-66m83 15-6 67m85-55 9 43','none','#1F2C29',5)+stoneMarks(rough(302,305,217,64,seed),seed,80,true)
    case 11:return stub('M229 275l-59-66M411 297l48 78',21)+base('bare')+p('M129 294q100-45 198 5t152-13M122 317q95-41 198 6t141-3','none','#B29D73',2)
    case 12:return log(275,312,413,168,-6,seed)+p('M461 229L540 215 492 273 554 275 479 310 538 359 448 358Z','url(#cut)','#806B49',2)+stub('M198 300l-48-109',20)
    case 13:return base('wet',6)+p('M135 304q109-21 242 6M242 339l79-11','none','#64705C',5)+p('M160 274q130-27 248 18','none','#91A087',2)
    case 14:return stub('M104 411Q237 300 481 223',72)+stub('M341 272Q406 335 504 369M203 336Q184 228 234 153',29)+log(300,299,400,104,-24,seed,'bare')+stub('M471 226l49-70M492 364l37 52',12)
    case 15:return stub('M87 383Q200 138 495 260',104)+p('M87 383Q200 138 495 260','none','#C1A171',3)+stub('M285 239Q324 348 390 430',25)+p('M113 380Q220 185 479 267M104 367Q204 163 485 246','none','#5E5138',2)
    case 16:return stub('M118 320L76 201M118 320L91 426',18)+log(333,221,448,125,-22,seed)+log(333,389,444,147,21,seed+1)+p(smooth(rough(128,309,57,66,seed)),'url(#bark)')
    case 17:return log(218,319,328,134,-5,seed)+stub('M349 312L498 141M348 310L550 289M346 311L485 465M429 221l-12-102M455 279l66-75M418 388l110 14',21)+clump(487,150,58,56,seed,'oak',31)+clump(506,452,52,41,seed+1,'oak',24)
    case 18:return base()+p('M88 285L238 276 329 249 512 273 430 296 302 299 152 337Z','url(#cut)','#6F6347',2)+p('M121 302L270 284 414 277 483 286','none','#343A2C',15)+p('M141 304l105-10 71 8','none','#BC9E69',2)
    case 19:return base()+p('M103 263q152-32 375 9M111 281q186-22 374 12M119 318q179-22 362 3M124 340q196-20 343-5','none','#A98C61',8)+p('M123 281q161-18 344 9M136 322q165-10 325-1','none','#C8AA79',1.5)
    case 20:return log(300,305,478,182,8,seed)+[[178,293,38,33],[319,327,47,39],[424,303,29,35]].map(([x,y,rx,ry],n)=>p(smooth(rough(x,y,rx,ry,seed+n,22,.16)),'url(#bark)','#AD946A',2)+e(x,y,rx*.42,ry*.4,'#6B593E','#BA9E72',2)).join('')
    case 21:return base('wet',-3)+p('M101 321q162-17 401-3','none','#77724F',15)+grass(176,369,seed,.45,'dark')+grass(405,251,seed+1,.42,'dark')
    case 22:return log(154,316,210,171,-12,seed,'wet')+log(335,298,175,151,8,seed+1,'wet')+log(480,320,106,111,-21,seed+2,'wet')+rep(13,n=>{const x=122+rnd(seed,n)*360,y=373+rnd(seed+1,n)*58;return p(poly(rough(x,y,8+rnd(seed+2,n)*16,5+rnd(seed+3,n)*8,seed+n,5,.3)),'url(#cut)','#6A654A',1)})
    case 23:return stub('M129 222l-33-76M441 320l65 115M261 395l-62 72',9)+log(288,238,463,71,10,seed,'birch')+log(314,327,467,82,-18,seed+1)+log(318,396,402,62,8,seed+2,'bare')
    default:throw new Error('未知倒木。')
  }
}

function roots(x:number,y:number,rx:number,ry:number,seed:number,amount=7):string {
  return rep(amount,n=>{const a=n*2.399+seed*.1+(rnd(seed+2,n)-.5)*.7,r=1.13+rnd(seed,n)*.61,ex=x+Math.cos(a)*rx*r,ey=y+Math.sin(a)*ry*r,bx=x+Math.cos(a)*rx*.46,by=y+Math.sin(a)*ry*.46,ox=-Math.sin(a)*rx*.18,oy=Math.cos(a)*ry*.18,mx=(bx+ex)/2-Math.sin(a)*(rnd(seed+3,n)-.5)*63,my=(by+ey)/2+Math.cos(a)*(rnd(seed+3,n)-.5)*63;return p(`M${f(bx+ox)} ${f(by+oy)}Q${f(mx+ox*.65)} ${f(my+oy*.65)} ${f(ex+ox*.07)} ${f(ey+oy*.07)}Q${f(ex+Math.cos(a)*4)} ${f(ey+Math.sin(a)*4)} ${f(ex-ox*.07)} ${f(ey-oy*.07)}Q${f(mx-ox*.4)} ${f(my-oy*.4)} ${f(bx-ox)} ${f(by-oy)}Z`,'url(#bark)','#514B35',.8)+p(`M${f(bx)} ${f(by)}Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}`,'none','#AC9164',1.2)+(n%2?woodLine(`M${f(mx)} ${f(my)}q${f((ex-mx)*.48-oy*.5)} ${f((ey-my)*.48+ox*.5)} ${f((ex-mx)*.63-oy*.7)} ${f((ey-my)*.63+ox*.7)}`,2):'')})
}
function stumpBody(x:number,y:number,rx:number,ry:number,seed:number,kind='oak',root=true):string {
  const outer=rough(x,y,rx,ry,seed,29,.17),cut=rough(x-5,y-6,rx*.81,ry*.8,seed+1,30,.11)
  return (root?roots(x,y,rx,ry,seed):'')+p(smooth(outer),kind==='birch'?'url(#birch)':kind==='charred'?'url(#charcoal)':'url(#bark)','#494A35',1.3)+p(smooth(cut),kind==='charred'?'#3E493B':'url(#cut)','#7E7754',1.3)+rep(6,n=>p(smooth(shrink(cut,x+rx*.1,y-ry*.13,.12+n*.12)),'none',kind==='charred'?'#62694E':n%2?'#A18A5E':'#C9AE7C',1))+p(rep(22,n=>{const a=n*2.399;return `M${f(x+Math.cos(a)*rx*.88)} ${f(y+Math.sin(a)*ry*.88)}l${f(-Math.cos(a)*rx*(.06+rnd(seed,n)*.1))} ${f(-Math.sin(a)*ry*(.06+rnd(seed,n)*.1))}`}),'none','#524C33',2)+stoneMarks(cut,seed,64,true)+p('M'+f(x-rx*.7)+' '+f(y+ry*.14)+`l${f(rx*.42)} ${f(-ry*.12)}m${f(rx*.88)} ${f(ry*.23)}l${f(-rx*.25)} ${f(-ry*.15)}`,'none','#766744',2)
}
function stump(i:number):string {
  const seed=13000+i*61,base=(kind='oak')=>stumpBody(300,300,132,121,seed,kind)
  switch(i){
    case 0:return base()+p('M219 206l26 55M349 347l36 41M319 212l-9 45','none','#534A32',3)
    case 1:return roots(300,300,144,130,seed,5)+stumpBody(300,300,139,128,seed,'bare',false)+woodLine('M210 249L122 162M383 353L481 443',19,'#93917A')
    case 2:return roots(300,300,114,101,seed,6)+stumpBody(241,289,91,96,seed,'birch',false)+stumpBody(368,308,84,83,seed+1,'birch',false)
    case 3:return base()+e(303,296,51,43,'#9D7145','#B99D68',2)+p('M343 234q16 20 7 42','none','#C9AF61',8)
    case 4:return roots(300,300,137,100,seed,10)+stumpBody(300,300,111,107,seed,'oak',false)
    case 5:return base()+p(smooth(rough(295,299,91,78,seed+1,26,.19)),'#303F30','#A08B5D',4)+p('M367 267L439 242 457 288 373 315Z','#3C4935','#8E7C51',2)
    case 6:return base()+[[202,250,47,36],[381,272,52,39],[342,387,39,32]].map(([x,y,rx,ry],n)=>stumpBody(x,y,rx,ry,seed+n,'oak',false)).join('')
    case 7:return roots(300,300,128,113,seed,7)+[[211,232,51,47],[321,201,54,46],[408,273,45,48],[340,361,69,63],[218,366,58,58]].map(([x,y,rx,ry],n)=>stumpBody(x,y,rx,ry,seed+n,'oak',false)).join('')+woodLine('M344 301Q473 346 497 427M235 303L110 284',5)
    case 8:return base()+[[227,220,44,40],[385,236,43,39],[373,370,44,41],[219,366,39,43]].map(([x,y,rx,ry],n)=>stumpBody(x,y,rx,ry,seed+n,'oak',false)).join('')+woodLine('M218 226l-64-77M387 238l75-52',5)
    case 9:return base()+p(smooth(rough(299,295,96,84,seed+1)),'#B28756','#D0AD7A',2)+p('M220 367q70 27 151-7','none','#40513D',14)
    case 10:return roots(300,300,154,111,seed,6)+stumpBody(300,300,107,95,seed,'oak',false)+woodLine('M380 295Q470 233 494 161',6)+clump(493,160,30,37,seed,'light',12)
    case 11:return base()+p(smooth(rough(312,286,81,67,seed+2,25,.2)),'#655840','#B59B70',2)+rep(3,n=>p(smooth(rough(312,286,35+n*13,28+n*11,seed+n,24,.15)),'none','#8F7851',1.2))
    case 12:return base()+p('M300 300L198 227M300 300L325 188M300 300L421 305M300 300L328 411M300 300L208 378','none','#4E4A31',10)+p('M300 300L202 229M300 300L328 408','none','#C6AB75',2)
    case 13:return roots(300,300,143,115,seed,7)+p('M164 341L190 225 233 171 256 272 299 139 321 266 378 175 403 312 429 375 303 418Z','url(#cut)','#625B3D',3)+p('M192 338l41-144M244 373l53-198M306 381l66-173','none','#C9AE7D',3)
    case 14:return base()+p('M294 188L263 308 303 417 372 394 343 298 371 209Z','#3C4231','#87734B',3)+p('M263 308l31-120m49 110 28-89','none','#C4A476',3)
    case 15:return base('charred')+pits(rough(300,300,111,94,seed),seed,18)+p('M234 238l32 58-25 72M310 207l25 82-4 89M384 281l-46 29','none','#202D28',5)
    case 16:return base()+clump(239,365,112,46,seed,'dark',55)+clump(406,292,48,65,seed+1,'oak',27)
    case 17:return base()+[[211,348,74,69,220],[248,408,76,67,196],[366,386,66,58,165]].map(([x,y,rx,ry,a],n)=>shelfFungus(x,y,rx,ry,a,seed+n)).join('')
    case 18:return roots(300,300,157,134,seed,7)+stumpBody(300,300,159,142,seed,'wet',false)+p(smooth(rough(305,304,116,102,seed+1,32,.21)),'url(#wetwood)','#8F835B',5)+stoneMarks(rough(306,305,102,86,seed),seed,48)
    case 19:return base()+rep(7,n=>{const a=n*2.39,x=300+Math.cos(a)*94,y=300+Math.sin(a)*86;return p(`M${f(x-18)} ${f(y-11)}l${f(22+Math.cos(a)*34)} ${f(-24+Math.sin(a)*35)} ${f(-7-Math.cos(a)*19)} ${f(43-Math.sin(a)*13)}Z`,'url(#cut)','#88724D',1.3)})
    case 20:return roots(300,300,133,113,seed,6)+stumpBody(272,302,119,111,seed,'oak',false)+stumpBody(406,262,82,64,seed+1,'oak',false)
    case 21:return roots(300,300,145,126,seed,8)+stumpBody(221,245,94,88,seed,'oak',false)+stumpBody(379,253,100,92,seed+1,'oak',false)+stumpBody(302,393,109,95,seed+2,'oak',false)
    case 22:return roots(300,300,155,130,seed,9)+stumpBody(283,294,145,129,seed,'oak',false)+p(smooth(rough(331,289,81,69,seed+3)),'#3C4935','#B69B6D',3)+stumpBody(424,372,48,49,seed+4,'oak',false)
    case 23:return base()+[[137,247,45,31],[425,207,39,34],[403,413,35,31],[168,419,43,29]].map(([x,y,rx,ry],n)=>rockBody(x,y,rx,ry,seed+n,'granite',true)).join('')
    default:throw new Error('未知树桩。')
  }
}

function calcite(x:number,y:number,rx:number,ry:number,seed:number,layers=5,material='calcite',offset:Pt=[-.15,-.18]):string {
  let body=p(smooth(rough(x,y,rx,ry,seed,37,.2)),`url(#${material})`,'#858973',1.1)
  body+=rep(layers,n=>{const scale=.83-n*.09,cx=x+rx*offset[0]*(n+1)/layers,cy=y+ry*offset[1]*(n+1)/layers;return p(smooth(rough(cx,cy,rx*scale,ry*scale,seed+n+1,31,.22)),`url(#${material})`)})
  const lines=rep(33,n=>{const a=n*2.399+rnd(seed,n)*.3,start=.56+rnd(seed+1,n)*.25,end=.16+rnd(seed+2,n)*.29;return `M${f(x+Math.cos(a)*rx*start)} ${f(y+Math.sin(a)*ry*start)}Q${f(x+Math.cos(a+.07)*rx*(start+end)/2)} ${f(y+Math.sin(a+.07)*ry*(start+end)/2)} ${f(x+Math.cos(a)*rx*end+rx*offset[0])} ${f(y+Math.sin(a)*ry*end+ry*offset[1])}`})
  return body+`<g opacity=".37">${p(lines,'none','#E2D3AF',1.4)}</g>`+stoneMarks(rough(x,y,rx*.85,ry*.85,seed),seed,140,true)+p(smooth(rough(x+rx*offset[0],y+ry*offset[1],rx*.055,ry*.047,seed+1,12,.3)),'#E0D2AC')
}
function stalagmite(i:number):string {
  const seed=17000+i*67,base=(mat='calcite')=>calcite(300,300,232,218,seed,5,mat)
  switch(i){
    case 0:return calcite(300,300,224,221,seed,6)
    case 1:return calcite(200,322,144,179,seed)+calcite(403,265,143,166,seed+1)
    case 2:return calcite(300,300,246,221,seed,2)+[[166,211,93,95],[345,154,101,87],[443,332,86,105],[272,404,113,111],[143,416,59,68]].map(([x,y,rx,ry],n)=>calcite(x,y,rx,ry,seed+n+1,4)).join('')
    case 3:return calcite(300,300,240,196,seed,6,'calcite',[-.37,-.16])
    case 4:return base()+p(smooth(rough(267,263,98,88,seed+1,29,.12)),'url(#cutstone)','#E0D1AC',3)+rep(5,n=>p(smooth(rough(269,263,18+n*17,14+n*15,seed+n+2,28,.1)),'none','#B8A980',1.8))
    case 5:return calcite(300,310,263,230,seed,6,'calcite',[-.19,-.29])+p('M83 341q111-31 132-122M112 410q94-57 121-121M410 455q-57-68-82-150','none','#B5B394',4)
    case 6:return calcite(303,301,254,131,seed,2)+calcite(142,306,78,92,seed+1,4)+calcite(309,269,84,101,seed+2,4)+calcite(457,308,69,80,seed+3,4)
    case 7:return base()+rep(4,n=>p(smooth(rough(295,292,84+n*34,73+n*34,seed+n,31,.14)),'none',n%2?'#A68B63':'#E0CDA4',9))
    case 8:return calcite(296,321,244,201,seed,3)+calcite(269,217,178,134,seed+1,3)+calcite(316,290,113,93,seed+2,3)
    case 9:return base('rustcalcite')+p('M267 267q28 74 141 177M255 275q-23 89 7 192','none','#AE8156',6)
    case 10:return calcite(300,300,246,217,seed,3)+rep(18,n=>{const a=n*2.399,dist=40+Math.sqrt(rnd(seed,n))*133;return calcite(300+Math.cos(a)*dist,300+Math.sin(a)*dist,25+rnd(seed+1,n)*31,25+rnd(seed+2,n)*25,seed+n,2)})
    case 11:return calcite(300,300,253,133,seed,5,'calcite',[-.16,-.15])+p('M113 315Q281 221 481 285','none','#E1D5B3',5)
    case 12:return calcite(300,300,236,208,seed,2)+rep(22,n=>{const a=n*2.399,dist=30+Math.sqrt(rnd(seed,n))*160;return calcite(300+Math.cos(a)*dist,300+Math.sin(a)*dist,17+rnd(seed+1,n)*22,22+rnd(seed+2,n)*24,seed+n,2)})
    case 13:return calcite(300,300,258,225,seed,4,'calcite',[.28,-.22])
    case 14:return calcite(220,290,162,205,seed)+calcite(425,194,119,132,seed+1)+calcite(437,414,106,117,seed+2)
    case 15:return calcite(300,300,249,242,seed,7,'cutstone',[-.05,-.05])
    case 16:return base()+p('M267 258q-50 63-63 135M277 260q54 37 111 133','none','#969F86',9)+e(266,258,12,10,'#DCD9BA','#BFC4A5',2)+e(263,255,4,3,'#F0E6CC')
    case 17:return base('cutstone')+pits(rough(300,300,218,196,seed),seed,28,true)
    case 18:return base()+p(clipped(shrink(rough(300,300,232,218,seed,37,.2),300,300,.92),83,208,268,277)+clipped(shrink(rough(300,300,232,218,seed,37,.2),300,300,.92),268,277,472,441),'none','#8B8A70',6)+calcite(467,425,65,67,seed+1,2)
    case 19:return base()+p('M94 357q194 66 415-4M147 428q151 41 307-2','none','#A49670',20)+p('M118 365q196 58 362-4','none','#C1B18A',3)
    case 20:return calcite(300,300,257,211,seed,1)+[[145,211,53,56],[260,166,48,49],[421,176,53,61],[459,360,59,63],[331,401,61,68],[165,393,51,58],[304,291,65,65]].map(([x,y,rx,ry],n)=>calcite(x,y,rx,ry,seed+n+1,4)).join('')
    case 21:return calcite(299,307,251,183,seed,2)+calcite(155,335,81,93,seed+1,4)+calcite(319,251,111,103,seed+2,5)+calcite(454,347,72,82,seed+3,4)
    case 22:return calcite(304,339,244,184,seed,4)+calcite(257,218,159,141,seed+1,5)
    case 23:return base()+p(rep(12,n=>{const a=n*2.399;return `M${f(300+Math.cos(a)*190)} ${f(300+Math.sin(a)*182)}Q${f(300+Math.cos(a+.1)*120)} ${f(300+Math.sin(a+.1)*113)} 270 262`}),'none','#C0B893',8)+p(rep(12,n=>{const a=n*2.399;return `M${f(300+Math.cos(a)*190)} ${f(300+Math.sin(a)*182)}L${f(300+Math.cos(a)*75)} ${f(300+Math.sin(a)*70)}`}),'none','#E0D2AD',2)
    default:throw new Error('未知洞穴石笋。')
  }
}

function grass(x:number,y:number,seed:number,scale=1,style:Foliage='light',kind=0):string {
  const paths=['','','',''],tips=['','']
  for(let n=0;n<105;n++){
    const a=rnd(seed,n*5)*Math.PI*2,len=(37+rnd(seed,n*5+1)*177)*(kind===5?.85:1),bx=(rnd(seed,n*5+2)-.5)*70,by=(rnd(seed,n*5+3)-.5)*66,tx=bx+Math.cos(a)*len,ty=by+Math.sin(a)*len*(kind===5?.53:1),bend=(rnd(seed,n*5+4)-.5)*39,w=kind===2?6:kind===1?4.3:kind===3?1.7:3
    paths[n%4]+=`M${f(bx)} ${f(by)}Q${f((bx+tx)/2+bend)} ${f((by+ty)/2-bend)} ${f(tx)} ${f(ty)}Q${f((bx+tx)/2+bend+w)} ${f((by+ty)/2-bend+w)} ${f(bx+w)} ${f(by+w)}Z`
    if(kind===3||kind===6)tips[n%2]+=`M${f(tx-4)} ${f(ty-2)}l3-6 4 3-3 6Z`
  }
  return g(`translate(${x} ${y}) scale(${scale})`,e(0,0,31,26,'#69744C')+paths.map((d,n)=>p(d,leafColors[style][n])).join('')+(kind===6||kind===3?tips.map((d,n)=>p(d,n?'#BEAC72':'#D2BE87')).join(''):''))
}
function grassClump(i:number):string {
  const seed=21000+i*47
  if(i===7)return grass(166,231,seed,.62,'dark',3)+grass(400,190,seed+1,.58,'light')+grass(357,408,seed+2,.69,'dark',3)+p('M155 265q29 30 74 12M350 445q50 9 76-12','none','#646B45',2)
  if(i===5)return grass(300,300,seed,1.07,'autumn',5)+grass(283,322,seed+1,.86,'light',5)
  return grass(300,300,seed,1.03,i===4?'autumn':'light',i)
}
function frond(x:number,y:number,length:number,width:number,angle:number,seed:number,kind=0):string {
  let leaves='', veins=''
  const count=kind===2?18:13,curve=kind===2?20:9
  for(let n=0;n<count;n++){
    const t=.1+n*.85/count,cy=-t*length,cx=Math.sin(t*Math.PI)*curve,spread=width*Math.sin(t*Math.PI)*(.9+rnd(seed,n)*.15)
    for(const side of [-1,1]){const xx=cx+side*spread,yy=cy-length*.052;leaves+=`M${f(cx)} ${f(cy+7)}Q${f(cx+side*spread*.58)} ${f(cy+3)} ${f(xx)} ${f(yy)}Q${f(cx+side*spread*.58)} ${f(cy-16)} ${f(cx)} ${f(cy-4)}Z`;veins+=`M${f(cx)} ${f(cy+2)}L${f(xx)} ${f(yy)}`}
  }
  return g(`translate(${x} ${y}) rotate(${angle})`,p(leaves,kind===2?'#86A464':'url(#light)','#486B45',.55)+p(veins,'none','#B6C58B',.65)+p(`M0 5Q${curve*1.7} ${-length*.5} 0 ${-length}`,'none','#B6C18A',1.9))
}
function longLeaf(x:number,y:number,length:number,width:number,angle:number,color='url(#light)'):string {
  return g(`translate(${x} ${y}) rotate(${angle})`,p(`M0 2Q${-width} ${-length*.46} 0 ${-length}Q${width*1.2} ${-length*.55} 0 2Z`,color,'#607A4B',.7)+p(`M0 0Q5 ${-length*.5} 0 ${-length}`,'none','#C0CC93',1))
}
function fernClump(i:number):string {
  const seed=23000+i*49,angles=[-167,-124,-71,-13,36,83,137]
  switch(i){
    case 0:return [-132,-5,116].map((a,n)=>frond(300,300,232-n*12,91,a,seed+n)).join('')+frond(300,300,136,54,49,seed+3)
    case 1:return angles.map((a,n)=>frond(300+rnd(seed,n)*21-10,300+rnd(seed+1,n)*29-14,164+rnd(seed,n)*70,53,a+(rnd(seed+3,n)-.5)*23,seed+n)).join('')
    case 2:return angles.map((a,n)=>frond(300+rnd(seed,n)*25-12,300+rnd(seed+1,n)*21-10,157+rnd(seed,n)*88,35,a+8+(rnd(seed+3,n)-.5)*17,seed+n,2)).join('')
    case 3:return [-151,-112,-69,-17,39,94,141].map((a,n)=>longLeaf(300+rnd(seed,n)*32-16,300+rnd(seed+2,n)*28-14,123+rnd(seed+1,n)*111,25+rnd(seed+2,n)*10,a+(rnd(seed+3,n)-.5)*21)).join('')+longLeaf(312,308,113,24,49)
    case 4:return log(300,339,457,96,-7,seed,'wet')+frond(176,324,191,47,-52,seed)+frond(301,324,212,46,9,seed+1)+frond(408,324,196,42,56,seed+2)
    case 5:return rep(11,n=>{const a=n*2.399,tx=300+Math.cos(a)*(86+rnd(seed,n)*100),ty=300+Math.sin(a)*(94+rnd(seed+1,n)*86);return p(`M300 300Q${f((tx+300)/2-19)} ${f((ty+300)/2-9)} ${f(tx)} ${f(ty)}`,'none','#454F36',1.4)+g(`translate(${f(tx)} ${f(ty)}) rotate(${n*37})`,[-38,0,39].map((angle,k)=>g(`rotate(${angle})`,p('M0 3Q-9-17 0-32','none','#4F5E3A',1)+p('M0-13Q-26-20-20-37Q-4-48 17-37Q25-20 0-13Z','url(#light)','#517846',.6)+p('M0-13v-29M0-13l-12-22M0-13l14-21','none','#BFCD92',.6))).join(''))})
    case 6:return rockBody(417,354,102,113,seed,'granite',true)+[-130,-76,-14,52,131].map((a,n)=>frond(246,278,150+rnd(seed,n)*37,33,a,seed+n)).join('')
    case 7:return [[210,226,42],[388,278,34],[289,416,31]].map(([x,y,rad],n)=>p(`M300 312Q${f((x+300)/2+24)} ${f((y+312)/2-12)} ${x} ${y}`,'none','#567F48',7)+p(`M${x-rad} ${y}q0 ${-rad} ${rad} ${-rad}q${rad} 0 ${rad} ${rad}q0 ${rad*.9} ${-rad*.9} ${rad*.9}q${-rad*.8} 0 ${-rad*.8} ${-rad*.8}q0 ${-rad*.65} ${rad*.65} ${-rad*.65}q${rad*.5} 0 ${rad*.5} ${rad*.5}`,'none','#507949',10)+p(`M${x-rad} ${y}q0 ${-rad} ${rad} ${-rad}q${rad} 0 ${rad} ${rad}q0 ${rad*.9} ${-rad*.9} ${rad*.9}`,'none','#B2C795',3)).join('')+frond(300,312,140,33,-92,seed)+frond(300,312,149,31,58,seed+1)
    default:throw new Error('未知蕨丛。')
  }
}
function blossom(x:number,y:number,size:number,seed:number,color:string,petals=7):string {
  return rep(petals,n=>{const a=n*Math.PI*2/petals+(rnd(seed,n)-.5)*.2,ex=x+Math.cos(a)*size*.55,ey=y+Math.sin(a)*size*.55;return g(`rotate(${f(a*180/Math.PI)} ${f(ex)} ${f(ey)})`,e(ex,ey,size*.55,size*.26,color,'#A89D70',.45))})+e(x,y,size*.22,size*.22,'#CDB25E','#8E864D',.7)+e(x-1,y-1,size*.07,size*.07,'#E1CE8A')
}
function flowerClump(i:number):string {
  const seed=25000+i*53,sites=[[151,213],[282,153],[428,221],[191,399],[375,375],[310,284]] as const
  let body=sites.map(([x,y],n)=>i===4?rep(3,k=>frond(x,y,62+rnd(seed+k,n)*25,18,n*61+k*127,seed+n+k)):rep(i===2||i===7?4:6,k=>longLeaf(x,y,31+rnd(seed+k,n)*54,i===2?4:i===7?7:i===3?12:i===6?21:15,k*137+n*23,`url(#${i===5?'silver':'light'})`))).join('')
  body+=sites.map(([x,y],n)=>{
    const xx=x+(rnd(seed,n)-.5)*35,yy=y+(rnd(seed+1,n)-.5)*31
    if(i===4)return rep(13,k=>{const a=k*2.399,rad=Math.sqrt(rnd(seed+k,n))*34;return blossom(xx+Math.cos(a)*rad,yy+Math.sin(a)*rad,6,seed+k,'#DAD5BE',5)})
    if(i===2)return p(`M${x} ${y+32}q-27-41 4-62`,'none','#849B5C',3)+g(`rotate(${n*47} ${xx} ${yy})`,p(`M${xx-17} ${yy-10}Q${xx} ${yy+12} ${xx+17} ${yy-9}L${xx+12} ${yy+24}Q${xx} ${yy+34} ${xx-13} ${yy+22}Z`,'#8599B4','#5C7890',1)+e(xx,yy-9,16,7,'#65768E','#B3B8C0',1))
    if(i===3)return p(smooth(rough(xx,yy,25,24,seed+n,23,.25)),'#7E5E81','#566E46',1)+rep(23,k=>{const a=k*2.399;return p(`M${f(xx+Math.cos(a)*8)} ${f(yy+Math.sin(a)*8)}l${f(Math.cos(a)*18)} ${f(Math.sin(a)*18)}`,'none',k%2?'#B794AC':'#99769B',1.5)})
    if(i===5)return g(`rotate(${n*63} ${xx} ${yy})`,p(`M${xx-19} ${yy-16}Q${xx+6} ${yy-37} ${xx+21} ${yy-5}L${xx+10} ${yy+22}Q${xx-8} ${yy+35} ${xx-21} ${yy+10}Z`,'#B38A9C','#8B7681',1)+e(xx,yy,8,13,'#665066','#D4B6BD',2)+e(xx-2,yy-2,2,2,'#D5C2B3'))
    return blossom(xx,yy,i===7?28:15+rnd(seed+2,n)*9,seed+n,i===0?'#DFD8BD':i===1||i===6?'#D7B858':'#8D92BB',i===0?11:i===7?3:5)
  }).join('')
  return body
}
function cap(x:number,y:number,rx:number,ry:number,seed:number,kind=0):string {
  const pts=rough(x,y,rx,ry,seed,kind===1?33:29,kind===1?.21:.1)
  let body=p(smooth(pts),kind===2?'url(#redcap)':kind===3?'url(#silver)':kind===1?'url(#goldcap)':'url(#fungus)','#73694F',1.2)+p(smooth(rough(x-rx*.12,y-ry*.14,rx*.69,ry*.63,seed+1,25,.13)),'none',kind===2?'#B57457':'#C0A47C',1.1)
  if(kind===1)body+=e(x-rx*.1,y-ry*.07,rx*.24,ry*.24,'#A2844D','#D0AF6C',2)
  if(kind===2)body+=rep(19,n=>{const xx=x+(rnd(seed,n)-.5)*rx*1.5,yy=y+(rnd(seed+1,n)-.5)*ry*1.5;return inside(xx,yy,pts)?p(smooth(rough(xx,yy,3+rnd(seed+2,n)*5,2+rnd(seed+3,n)*3,seed+n,7,.3)),'#DED5B1'):''})
  if(kind===3)body+=p(rep(24,n=>{const a=n*2.399;return `M${f(x+Math.cos(a)*rx*.14)} ${f(y+Math.sin(a)*ry*.14)}L${f(x+Math.cos(a)*rx*.88)} ${f(y+Math.sin(a)*ry*.88)}`}),'none','#697969',1.8)
  if(kind===7)body+=rep(33,n=>{const xx=x+(rnd(seed,n)-.5)*rx*1.48,yy=y+(rnd(seed+1,n)-.5)*ry*1.48;return inside(xx,yy,pts)?p(smooth(rough(xx,yy,4+rnd(seed+2,n)*8,5+rnd(seed+3,n)*8,seed+n,7,.3)),'#685E43','#BEAA7E',1.3):''})
  return body+stoneMarks(shrink(pts,x,y,.88),seed+3,32,true)
}
function fungusClump(i:number):string {
  const seed=27000+i*41
  if(i===4)return log(302,325,451,107,-12,seed,'wet')+shelfFungus(183,323,88,108,204,seed)+shelfFungus(320,279,102,124,15,seed+1)+shelfFungus(439,354,76,101,165,seed+2)
  if(i===5)return [[205,252,97,93],[402,350,116,106],[204,435,50,53]].map(([x,y,rx,ry],n)=>{const pts=Array.from({length:16},(_,k)=>{const a=k*Math.PI/8,r=k%2?.47:1;return[x+Math.cos(a)*rx*r,y+Math.sin(a)*ry*r] as const});return p(smooth(pts),'url(#cut)','#746A4D',1.4)+cap(x,y,rx*.42,ry*.41,seed+n,6)+e(x-2,y-3,6,5,'#5C6045','#B3A076',1)}).join('')
  if(i===6)return [[210,203,88,84],[384,247,85,78],[186,371,80,73],[331,400,93,89],[439,391,44,47],[303,300,49,46]].map(([x,y,rx,ry],n)=>cap(x,y,rx,ry,seed+n,6)+e(x+4,y-7,rx*.07,ry*.06,'#877A53','#CBB98D',1.1)).join('')
  return [[204,228,116,108],[407,309,113,122],[228,425,89,77],[377,471,44,42]].map(([x,y,rx,ry],n)=>cap(x,y,rx,ry,seed+n,i)).join('')
}
function reedClump(i:number):string {
  const seed=29000+i*59,sites=[[179,237],[382,170],[407,385]] as const
  let body=sites.map(([x,y],n)=>i===4?grass(x,y,seed+n,.68,'autumn',5):rep(i===1||i===5?12:15,k=>longLeaf(x+(rnd(seed+k,n)-.5)*22,y+(rnd(seed+2+k,n)-.5)*20,54+rnd(seed+k,n)*99,i===5?13:i===1?8:4.5,k*137+n*31,`url(#${i===3?'autumn':'light'})`))).join('')
  if(i===7)body=woodLine('M150 327Q242 242 357 299T464 381',11,'#81794F')+sites.map(([x,y],n)=>grass(x,y,seed+n,.61,'dark',2)).join('')
  if(i===4)return body+p('M104 326l377 98M147 379l307-133M198 177l193 301','none','#A59163',4)+p('M104 326l100 33m49-108 52 63','none','#C9B27C',1)
  return body+sites.map(([x,y],n)=>{
    if(i===5)return blossom(x+13,y-25,21,seed+n,'#D2B451',3)
    const colors=i===3?['#B6A47A','#C9B78A']:i===6?['#9F7399','#C19AB0']:['#7F7752','#B0A071']
    if(i===1)return p(`M${x} ${y+30}q21-31 6-64`,'none','#798657',3)+e(x+6,y-34,10,16,'#716344','#A09367',1)
    return rep(i===2?3:8,k=>{const a=k*2.399,rad=3+Math.sqrt(rnd(seed+k,n))*23;return e(x+Math.cos(a)*rad,y-20+Math.sin(a)*rad,3.2,i===6?5.5:2.3,colors[k%2])})
  }).join('')
}
function litterLeaf(x:number,y:number,length:number,width:number,angle:number,seed:number,oak=false):string {
  const pts=oak?Array.from({length:22},(_,k)=>{const a=k*Math.PI/11,r=k%2?.72:1;return[Math.cos(a)*width*r,Math.sin(a)*length*r] as const}):rough(0,0,width,length,seed,15,.22)
  return g(`translate(${x} ${y}) rotate(${angle})`,p(smooth(pts),'url(#litter)','#85774F',.8)+p(`M0 ${length+9}Q-3 0 0 ${-length*.85}`,'none','#D0B07A',1.4)+p(`M0 8l${-width*.6} ${-length*.48}M0-2l${width*.6} ${-length*.43}`,'none','#8F794D',.7))
}
function cone(x:number,y:number,scale:number,angle:number,seed:number):string {
  return g(`translate(${x} ${y}) rotate(${angle}) scale(${scale})`,p(smooth(rough(0,0,41,66,seed,23,.1)),'url(#bark)','#625137',1.4)+rep(32,n=>{const yy=-48+Math.floor(n/5)*17,xx=(n%5-2)*13+(Math.floor(n/5)%2?5:0);return xx*xx/1400+yy*yy/3900<.9?p(`M${xx-9} ${yy-3}q9-12 18 0l-2 10q-6 7-14 0Z`,n%3?'#A58C60':'#BEA171','#5D5137',1):''}))
}
function leafLitter(i:number):string {
  const seed=31000+i*31
  if(i===1){let d=['',''];for(let n=0;n<230;n++){const x=76+rnd(seed,n*3)*447,y=99+rnd(seed,n*3+1)*390,a=rnd(seed,n*3+2)*Math.PI*2;d[n%2]+=`M${f(x)} ${f(y)}l${f(Math.cos(a)*29)} ${f(Math.sin(a)*29)}`};return d.map((v,n)=>p(v,'none',n?'#B3A177':'#7A7953',1.7)).join('')+cone(354,322,.47,32,seed)}
  if(i===3)return woodLine('M92 353Q271 271 497 194M279 278L347 113M251 291L194 185',8,'#CBC8AC')+rep(23,n=>litterLeaf(98+rnd(seed,n)*405,133+rnd(seed+1,n)*315,9+rnd(seed+2,n)*13,6+rnd(seed+3,n)*7,n*53,seed+n))
  if(i===4)return cone(186,261,1.1,-26,seed)+cone(370,210,.86,43,seed+1)+cone(371,414,1.24,115,seed+2)+rep(32,n=>p(`M${f(112+rnd(seed,n)*366)} ${f(157+rnd(seed+1,n)*296)}l${f((rnd(seed+2,n)-.5)*42)} ${f((rnd(seed+3,n)-.5)*38)}`,'none','#A29566',1.7))
  if(i===5)return rep(18,n=>{const x=128+rnd(seed,n)*349,y=122+rnd(seed+1,n)*349;return g(`translate(${f(x)} ${f(y)}) rotate(${n*47})`,p(n%2?'M0 0Q-7-49 17-59Q36-36 0 0Q-15-35-38-31Q-39-11 0 0Z':'M0 37Q-18 3 0-38Q17-2 0 37Z','url(#cut)','#84774F',1)+p(n%2?'M0 0l17-59M0 0l-38-31':'M0 32v-64','none','#B5A177',1))})
  if(i===6)return rep(15,n=>{const x=139+rnd(seed,n)*327,y=132+rnd(seed+1,n)*330,pts=rough(x,y,24+rnd(seed+2,n)*34,16+rnd(seed+3,n)*25,seed+n,9,.3);return p(poly(pts),'url(#bark)','#60553B',1.1)+stoneMarks(pts,seed+n,14,true)})
  if(i===7)return woodLine('M84 202Q247 310 500 391M118 412L433 159M216 310L210 120M336 270L478 282M289 341L317 481',9)+rep(11,n=>litterLeaf(131+rnd(seed,n)*337,146+rnd(seed+1,n)*291,15+rnd(seed+2,n)*15,10,n*51,seed+n,true))
  return rep(i===2?25:37,n=>litterLeaf(103+rnd(seed,n)*391,109+rnd(seed+1,n)*384,17+rnd(seed+2,n)*28,11+rnd(seed+3,n)*13,n*57,seed+n,i===2))
}
function shell(x:number,y:number,rx:number,ry:number,angle:number,seed:number):string {
  return g(`translate(${x} ${y}) rotate(${angle})`,p(`M${-rx*.35} ${ry*.66}Q${-rx*1.15} ${-ry*.2} ${-rx*.6} ${-ry*.8}Q0 ${-ry*1.2} ${rx*.65} ${-ry*.7}Q${rx*1.17} ${-ry*.1} ${rx*.33} ${ry*.66}Z`,'url(#shell)','#9B9477',1.1)+p(rep(8,n=>{const a=-Math.PI*.93+n*Math.PI*.87/7;return `M0 ${f(ry*.57)}Q${f(Math.cos(a)*rx*.46)} ${f(-ry*.21)} ${f(Math.cos(a)*rx*.85)} ${f(Math.sin(a)*ry*.91)}`}),'none','#B0A78B',1.4)+stoneMarks(rough(0,0,rx*.69,ry*.65,seed),seed,17,true))
}
function seaweed(seed:number,dry=false):string {
  return p('M112 424Q203 320 302 286T471 159','none',dry?'#9A895C':'#67815E',5)+rep(11,n=>{const t=n/11,x=112+t*350,y=424-t*267,a=(n%2?62:-68)+(rnd(seed+3,n)-.5)*37,sine=Math.sin(a*Math.PI/180),cosine=Math.cos(a*Math.PI/180),len=Math.min(104+rnd(seed,n)*114,(sine<0?x-50:550-x)/Math.abs(sine),(y-50)/Math.max(.1,cosine));return g(`translate(${f(x)} ${f(y)}) rotate(${f(a)})`,p(`M0 5Q-39 ${-len*.24} 2 ${-len*.54}Q33 ${-len*.78} 0 ${-len}Q53 ${-len*.79} 19 ${-len*.49}Q-11 ${-len*.23} 0 5Z`,dry?'url(#litter)':'url(#kelp)','#637A5D',1.1)+p(`M0 5Q-17 ${-len*.27} 10 ${-len*.53}T0 ${-len}`,'none',dry?'#B7A177':'#A6B58A',1.2))})
}
function shoreDetail(i:number):string {
  const seed=34000+i*47
  switch(i){
    case 0:return [[166,231,75,82,-31],[383,171,54,65,31],[381,396,90,84,124],[151,421,40,51,43]].map(([x,y,rx,ry,a],n)=>shell(x,y,rx,ry,a,seed+n)).join('')+rep(10,n=>{const x=147+rnd(seed,n)*289,y=147+rnd(seed+1,n)*290;return p(poly(rough(x,y,9,7,seed+n,5,.4)),'#D0C6A6','#9A9B7D',1)})
    case 1:return rep(22,n=>{const x=114+rnd(seed,n)*372,y=118+rnd(seed+1,n)*365,rad=14+rnd(seed+2,n)*32;return rockBody(x,y,rad,rad*(.5+rnd(seed+3,n)*.4),seed+n,n%3?'granite':'sandstone',true)})
    case 2:return seaweed(seed)
    case 3:return woodLine('M78 391Q246 307 486 213M234 319Q240 199 330 127M369 265l117 101M441 232l41-94',32,'#BDB89B')+p('M109 383Q251 317 469 225','none','#7B806B',3)+shell(300,302,20,27,78,seed)
    case 4:return seaweed(seed,true)+rep(17,n=>litterLeaf(119+rnd(seed,n)*361,139+rnd(seed+1,n)*321,26+rnd(seed+2,n)*27,4.5,n*51,seed+n))+shell(180,371,24,29,-35,seed)
    case 5:return p(smooth([[147,299],[191,220],[287,187],[397,228],[445,294],[411,359],[307,393],[204,356]]),'url(#shell)','#938B6E',2)+p('M151 294l-29-18 16 39-13 20 41-5M440 287l28-9-13 27 10 25-36-5','none','#BEB293',5)+p('M193 292q97-69 203 4M215 329q90-31 166 7','none','#B4A78A',2)+p('M220 354l58-13 18 46M385 348l-26-20','none','#807F65',2)+p(poly(rough(457,434,30,23,seed,6,.3)),'url(#shell)','#9E967B',1)
    case 6:return grass(300,300,seed,1.13,'autumn',5)+woodLine('M98 334l399 72M127 402l337-179M148 198l279 242',5,'#BAA375')
    case 7:return woodLine('M101 391Q251 232 474 211M252 288L206 117M327 247l92 192M389 224l89-93',29,'#8C8B72')+woodLine('M109 387Q247 238 471 214M252 288l-34-150',3,'#C6C2A4')+p('M139 372q53-46 93-53','none','#4E6655',6)
    default:throw new Error('未知岸边细节。')
  }
}

export const NATURE_COLLECTION_LICENSE_REF = 'MIT-Sceneweave-Nature-Collection-1'
export const NATURE_COLLECTION_LICENSE = `Sceneweave Nature Collection, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic top-down SVG drawings of cross-period vegetation, fallen wood, rocks, cave deposits and natural ground details, authored with coding assistance. No third-party art, reference-map pixels or external textures are included. Species and geological process names describe illustrative visual interpretations, not scientific identification. Tree trunk footprints are separate from canopy spans. Natural prop pictures do not create terrain heights, caves, pools, traversable rock platforms or permissions to cross elevation changes. Technical validation, art review and user acceptance remain separate.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const gradient = (id:string,colors:readonly string[]) => `<radialGradient id="${id}" cx="34%" cy="27%" r="77%" fx="29%" fy="23%">${colors.map((color,i)=>`<stop offset="${i*100/(colors.length-1)}%" stop-color="${color}"/>`).join('')}</radialGradient>`
const defs = `<defs>${Object.entries(leafColors).map(([id,c])=>gradient(id,[c[2],c[1],c[0],c[3]])).join('')}${[
  ['bark',['#A98E63','#87724D','#6C5C3F','#4E4934']], ['cut',['#D3BD8E','#B8A074','#9A8459','#7B6E4B']],
  ['birch',['#E1DAC0','#C6C6A9','#A4AE92','#858F77']], ['charcoal',['#70755F','#4B5747','#35463A','#27382F']],
  ['wetwood',['#8D8A65','#6F7756','#515F46','#3A4D3B']], ['granite',['#C7C4A8','#A6AE96','#889782','#657B6B']],
  ['sandstone',['#D7C298','#BFA87B','#A08D65','#7C7F60']], ['limestone',['#D2CFB2','#B2BA9F','#95A38C','#728A76']],
  ['chalk',['#E8E0C5','#D1D0B3','#B6C1A3','#92A88E']], ['slate',['#AAB9A5','#879F8E','#6A8779','#4F6E64']],
  ['flint',['#CBC8AE','#B0B39B','#8C9B84','#657D6B']], ['basalt',['#8E9B87','#6C8373','#4E6C5E','#354F46']],
  ['quartz',['#E6E0C7','#CCD5BF','#AEBEAF','#849E95']], ['marble',['#DAD9BE','#BAC7AD','#A1B99F','#7E9A86']],
  ['calcite',['#E6D7B0','#D0C49C','#B7B48D','#929C7D']], ['cutstone',['#D2C8A6','#BBB89A','#9CA98B','#7E947D']],
  ['rustcalcite',['#D9C299','#C0A47B','#A68C62','#8C8F69']], ['fungus',['#D6BC8C','#B69A6B','#997E54','#7A704A']],
  ['redcap',['#C78F71','#B87657','#975C43','#766046']], ['goldcap',['#DBBD76','#C4A65F','#A28B50','#827F4E']],
  ['litter',['#CDB27D','#B49B65','#988453','#7A7A4D']], ['shell',['#E1D6B8','#C7BFA0','#B2B497','#929F83']],
  ['kelp',['#B2BD8C','#8EA67C','#6F906B','#52775D']],
].map(([id,colors])=>gradient(id as string,colors as string[])).join('')}</defs>`

function artwork(design:NatureDesign,index:number):VisualSampleArt {
  const treeLike=design.category==='tree',detail=['grass-clump','fern-clump','flower-clump','fungus-clump','reed-clump','leaf-litter','shore-detail'].includes(design.category)
  const body=({tree,shrub,rock,'fallen-log':fallenLog,stump,stalagmite,'grass-clump':grassClump,'fern-clump':fernClump,'flower-clump':flowerClump,'fungus-clump':fungusClump,'reed-clump':reedClump,'leaf-litter':leafLitter,'shore-detail':shoreDetail}[design.category])(index)
  const trunk=treeLike?Math.max(450,Math.round(Math.min(design.widthMm,design.heightMm)*(index===29?.2:index===27?.16:.13))):0
  return {key:design.key,name:design.name,kind:'prop',widthMm:design.widthMm,heightMm:design.heightMm,
    sourceSvg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${design.widthMm/2} ${design.heightMm/2}">${defs}<g transform="scale(${design.widthMm/1200} ${design.heightMm/1200})">${body}</g></svg>`,
    footprintMm:treeLike?{width:trunk,height:trunk}:{width:Math.round(design.widthMm*.84),height:Math.round(design.heightMm*.84)},
    blocksMovement:!detail,blocksSight:false,renderLayer:treeLike?'canopy':detail?'ground':'object',shadowClass:['rock','stalagmite'].includes(design.category)?'furniture':['leaf-litter','shore-detail'].includes(design.category)?'none':'vegetation',
    tags:['原创','自然环境',design.category,design.era,design.design,'严格俯视','跨年代自然物','装饰图像不授予地形高差通路',...(treeLike?['树干占地独立于树冠幅','canopy']:[]),...(design.category==='rock'||design.category==='stalagmite'?['不生成洞穴或平台或真实水池']:[])]}
}
export const NATURE_COLLECTION_ART:readonly VisualSampleArt[]=freezeJson(NATURE_DESIGNS.map(design=>artwork(design,NATURE_DESIGNS.filter(row=>row.category===design.category).findIndex(row=>row.key===design.key))))
