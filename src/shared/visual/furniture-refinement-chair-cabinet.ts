import { FURNITURE_STYLES, type FurnitureStyle } from '../assets/furniture-collection.js'
import { PEASANT_REFINEMENT_PAINTS, fill, line, n, random, woodGrain, type FurnitureMaterialPaint } from './furniture-refinement-materials.js'

/** Additional interior paint, using the chair's 400×400 and cabinet's 600×360
 * original drawing coordinates. Each case follows the actual source plan.
 * It does not replace the source, fill its alpha, or change physical geometry. */
const repeat = (count: number, draw: (index: number) => string) => Array.from({ length: count }, (_, index) => draw(index)).join('')
const pale = '#ECE0C2', shade = '#51463B'

/** A small, explicitly inset patch of woven cloth or worn leather. The caller
 * selects a rectangle contained inside the actual rounded/polygonal cushion. */
function upholstery(x: number, y: number, width: number, height: number, seed: number, leather = false): string {
  const fibres = repeat(Math.floor(width * height / (leather ? 700 : 185)), index => {
    const xx = x + 5 + random(seed, index * 3) * (width - 16), yy = y + 5 + random(seed, index * 3 + 1) * (height - 12)
    return `M${n(xx)} ${n(yy)}l${n(1.5 + random(seed, index * 3 + 2) * 3)} ${leather ? '.8' : '.2'}`
  })
  return line(fibres, shade, leather ? .42 : .36, leather ? .12 : .085)
    + line(`M${x + 7} ${y + 12}q${n(width * .16)} 3 ${n(width * .2)} ${n(height * .24)}M${x + width - 8} ${y + 17}q${n(-width * .17)} 2 ${n(-width * .2)} ${n(height * .2)}M${x + 10} ${y + height - 12}q${n(width * .16)} -3 ${n(width * .23)} ${n(-height * .18)}`, shade, leather ? 1 : .75, .22)
    + line(`M${x + 9} ${y + 13}q${n(width * .16)} 4 ${n(width * .2)} ${n(height * .22)}M${x + width - 10} ${y + 19}q${n(-width * .17)} 3 ${n(-width * .2)} ${n(height * .18)}M${x + 12} ${y + height - 10}q${n(width * .16)} -3 ${n(width * .22)} ${n(-height * .17)}`, pale, 1, .32)
    + line(`M${x + 12} ${y + 4}q${n(width * .33)} -3 ${width - 24} 0M${x + 12} ${y + height - 4}q${n(width * .4)} 3 ${width - 24} 0`, leather ? '#3E3D37' : '#F1E7CB', .7, .25)
}

function stone(x: number, y: number, width: number, height: number, seed: number): string {
  const insetX=Math.min(5,width/4),insetY=Math.min(5,height/4)
  const innerWidth=width-insetX*2,innerHeight=height-insetY*2
  return repeat(Math.floor(width * height / 210), index => {
    const length=Math.min(1+random(seed,index*3+2)*2,innerWidth*.3)
    const xx=x+insetX+random(seed,index*3)*Math.max(0,innerWidth-length)
    const yy=y+insetY+random(seed,index*3+1)*innerHeight
    return line(`M${n(xx)} ${n(yy)}l${n(length)} -.3`,index%3?'#35454A':'#E2DDCB',index%2?.45:.6,.18)
  }) + (width>=50&&height>=30
    ? line(`M${x + 12} ${y + height * .3}l${n(width * .18)} ${n(height * .09)} ${n(width * .14)} ${n(-height * .04)}m${n(width * .2)} ${n(height * .17)}l${n(width * .1)} ${n(height * .08)} ${n(width * .12)} ${n(-height * .03)}`, '#D4D3BF', .65, .34)
    : '')
}

function chair(index: number, style: FurnitureStyle): string {
  const p=style.palette
  switch(index){
    case 0: return PEASANT_REFINEMENT_PAINTS.chair
    // The dark rectangle is woven rope, not a solid wood seat. Keep its grid.
    case 1: return woodGrain(69,65,262,22,201,false,false)
      + woodGrain(82,101,12,26,203,true,false)+woodGrain(306,101,12,26,205,true,false)
      + line('M70 63h259M80 88h244',p[1],1.2,.6)
      + repeat(8,i=>line(`M${91+i*30} 151v145`,p[1],.65,.55))
      + repeat(7,i=>line(`M100 ${146+i*23}h201`,p[0],.55,.48))
      + line('M87 140h223M87 322h223',shade,1,.38)
    // Rounded wooden seat and a bentwood horseshoe back/arms.
    case 2: return woodGrain(111,177,178,129,211)
      + line('M109 165q89-4 182 0M104 308q94 11 193-1',p[1],1.3,.55)
      + line('M79 125Q69 64 132 61h134q61 6 57 64',p[1],1.4,.55)
      + line('M61 130q-26 89 8 157m269-157q27 89-8 157',p[1],1,.55)
      + line('M103 289q62 8 112 3M151 206l30-1M249 270l24-1',shade,.65,.35)
    // Slatted seat, separate straight back rail and four short back uprights.
    case 3: return [0,1,2,3].map(i=>woodGrain(99+i*58,158,22,148,221+i,true,false)).join('')
      + woodGrain(94,59,211,22,227,false,false)
      + repeat(4,i=>woodGrain(108+i*58,101,7,30,229+i,true,false))
      + line('M98 57h208M103 322h193',p[1],1.1,.6)
      + line('M107 315h190',shade,.8,.38)
    // Canvas seat and crossed metal/leather straps: no wood over the diagonal.
    case 4: return upholstery(157,163,83,32,241,true)
      + upholstery(94,217,61,36,242,true)+upholstery(247,213,57,41,243,true)
      + upholstery(164,275,72,28,244,true)
      + line('M83 74l224 42M311 75L88 115',p[1],1.4,.55)
      + line('M80 150l236 166M318 150L85 316',p[1],.85,.45)
      + line('M88 151h35M282 151h29M89 314h36M280 314h29',p[1],1,.45)
    // Leather/fur centre, antler forks and curved wood arms have different marks.
    case 5: return upholstery(121,167,158,131,251,true)
      + line('M72 148Q39 75 89 49l29 33 15-49 22 58m171 60q38-75-13-102l-28 33-16-49-22 58',p[1],.75,.54)
      + line('M61 130q-26 89 8 157m269-157q27 89-8 157',p[1],1,.52)
      + line('M141 192l7 7m27 47 5 4m38-63 6 7m27 75-5 4',shade,.65,.27)
    case 6: return upholstery(106,157,188,144,261)
      + woodGrain(119,105,164,15,263,false,false)
      + woodGrain(56,147,15,129,265,true,false)+woodGrain(329,147,15,129,267,true,false)
      + line('M71 105Q84 67 123 80M278 80q38-11 50 25',p[1],1.3,.55)
      + line('M57 147v130M329 147v130',p[1],1,.55)
    case 7: return upholstery(101,166,198,132,271)
      + woodGrain(72,316,256,11,273,false,false)
      + woodGrain(56,145,15,144,275,true,false)+woodGrain(329,145,15,144,277,true,false)
      + line('M68 117l18-34 34 8 35-34 30 17M215 74l29-17 33 34 34-9 20 35',p[1],1.2,.6)
      + line('M75 318h250M58 151v133M331 151v133',p[4],1,.6)
    case 8: return upholstery(128,182,146,110,281)
      + line('M85 150q-13-50 23-59 20-34 39-38M315 150q11-47-19-59-18-34-37-39',p[1],1.3,.58)
      + line('M61 130q-26 89 8 157m269-157q27 89-8 157',p[1],1,.5)
      + line('M119 185q80 16 161 0',p[4],.8,.4)
    // Stone surround, opaque textile seat and four bronze inlays.
    case 9: return stone(107,124,184,8,291)+stone(89,323,219,13,293)
      + stone(85,168,4,121,295)+stone(311,168,4,121,297)
      + upholstery(108,160,184,133,299)
      + line('M85 74h231M96 337h208',p[1],1.4,.65)
      + line('M100 130h196',shade,.7,.38)
    case 10: return upholstery(140,174,120,101,301,true)
      + line('M69 193Q39 85 138 56Q200 28 264 56Q358 85 331 193',p[1],1.35,.6)
      + line('M87 262q14 42 54 59M259 322q39-16 55-58',p[1],1.2,.5)
      + line('M142 289q57 19 114 1',shade,.8,.3)
    case 11: return upholstery(124,163,151,132,311)
      + woodGrain(138,110,123,25,313,false,false)
      + woodGrain(56,148,15,130,315,true,false)+woodGrain(329,148,15,130,317,true,false)
      + line('M110 104l88-51 88 51M58 148v129M331 148v129',p[1],1,.52)
      + line('M135 316h128',p[1],1,.45)
    case 12: return upholstery(111,172,176,122,321,true)
      + line('M78 163L55 54 87 39 119 126m202 37L345 54 313 39 281 126',p[1],1.05,.5)
      + line('M52 184l9 98m285-98-9 98',p[1],1,.5)
      + line('M138 317l4 7M166 322l4 7M194 324l4 7M220 323l4 8M249 319l3 7M277 314l4 7',p[1],.75,.6)
      + line('M111 174l20-8M266 161l19 7M93 271l11 19',shade,.75,.35)
    case 13: return upholstery(102,178,194,129,331)
      + woodGrain(141,109,118,17,333,false,false)
      + woodGrain(56,148,15,130,335,true,false)+woodGrain(329,148,15,130,337,true,false)
      + line('M111 115l32-30 57-29 57 29 29 28',p[1],1.15,.58)
      + line('M58 150v130M331 150v130',p[4],.85,.5)
    case 14: return upholstery(115,183,170,116,341)
      + line('M77 132l-15-27 9-36 43 40M146 104l20-13 24 17M211 108l23-17 20 13M285 109l42-40 10 36-15 27',p[1],1.1,.56)
      + line('M54 167l-16 75 40 53m268-128 16 75-40 53',p[1],1,.5)
      + line('M126 215q20 24 42 3M180 215q20 24 42 3M234 215q20 24 42 3',p[1],.8,.4)
    // Six separate petals remain separate; their centres are safely inside.
    case 15: return upholstery(147,174,106,98,351)
      + repeat(6,i=>`<g transform="rotate(${i*60} 200 219)">${line('M200 75q10 15 5 35',p[1],1.15,.5)}${line('M205 80q8 13 4 25',p[2],.65,.25)}</g>`)
      + line('M151 277q46 16 96 0',p[1],1,.4)
    // Brass tube and woven cane. Tiny paired strokes follow actual cane grid.
    case 16: return line('M68 161Q47 66 138 52H264Q353 66 331 161',p[1],1.1,.7)
      + line('M97 174h204M98 310h203',p[2],.65,.4)
      + repeat(9,i=>line(`M${99+i*25} 181v111`,p[1],.5,.55))
      + repeat(7,i=>line(`M111 ${184+i*17}h180`,p[0],.45,.5))
    // White enamel and tubular frame receive cool paint wear, not timber grain.
    case 17: return line('M74 159Q48 50 150 48H249Q350 48 328 159',p[1],.8,.75)
      + line('M106 186q3-22 22-24M274 163q19 3 22 25M108 294q9 19 28 20', '#F2F0DC',1,.45)
      + line('M126 177l12-1M273 292l12-1M155 307l16 1',p[2],.5,.25)
      + line('M139 222q52-36 101-1M147 262q46 31 94-1',p[1],.55,.38)
    case 18: return upholstery(123,164,154,136,371,true)
      + woodGrain(77,60,246,20,373,false,false)
      + woodGrain(56,148,15,131,375,true,false)+woodGrain(329,148,15,131,377,true,false)
      + repeat(5,i=>woodGrain(90+i*52,100,8,26,379+i,true,false))
      + line('M79 58h243M57 150v129M331 150v129',p[1],1.15,.6)
      + line('M126 308h146',p[1],.7,.4)
    case 19: return upholstery(126,177,147,121,391)
      + line('M64 164Q28 62 144 44Q216 27 272 61Q345 78 333 167',p[1],1.05,.62)
      + line('M61 130q-26 89 8 157m269-157q27 89-8 157',p[1],1,.55)
    case 20: return upholstery(107,182,186,121,401)
      + line('M105 126l22-30 43-19h60l43 19 22 30',p[1],.85,.5)
      + line('M201 80v42M162 87l12 35M239 87l-11 35',p[1],.75,.45)
      + line('M59 173v112M334 173v112',p[1],1,.6)
      + line('M108 307q86 4 184 0',p[2],.7,.32)
    case 21: return upholstery(115,178,169,121,411,true)
      + line('M70 144Q60 69 132 67q65-28 135 0 72 2 63 77',p[1],1.4,.57)
      + line('M61 130q-26 89 8 157m269-157q27 89-8 157',p[1],1,.5)
      + line('M150 216l7 3m37-3 7 2m36-2 8 3',p[1],.75,.5)
      + line('M120 298q79 11 160 0',shade,.7,.35)
    case 22: return woodGrain(86,66,228,21,421,false,false)
      + [0,1,2].map(i=>woodGrain(96,181+i*44,207,28,423+i,false,i===1)).join('')
      + line('M88 63h227M99 168h201M99 310h201',p[1],1,.6)
      + line('M103 190h191M103 234h191M103 278h191',shade,.65,.32)
    case 23: return upholstery(118,183,164,114,431)
      + line('M76 149Q66 76 128 68q72-30 143 0 63 6 55 81',p[1],1.1,.5)
      + line('M94 128q39-12 56-3M250 125q19-9 51 3',shade,.65,.24)
      + line('M80 186q-4 37 1 72M321 186q3 36-1 72',p[1],.8,.55)
      + line('M128 307q72 9 144 0',p[1],.9,.45)
    default: throw new Error('Unknown chair material refinement')
  }
}

function cabinet(index: number, style: FurnitureStyle): string {
  const p=style.palette
  switch(index){
    case 0: return PEASANT_REFINEMENT_PAINTS.cabinet
    // Seven wooden ventilation slats, separated by the original dark gaps.
    case 1: return repeat(7,i=>woodGrain(84+i*66,99,32,125,501+i,true,i%3===0))
      + woodGrain(51,64,495,5,511,false,false)
      + line('M52 61h492M87 97v127M153 97v127M219 97v127M285 97v127M351 97v127M417 97v127M483 97v127',p[1],1,.55)
      + woodGrain(62,275,223,4,513,false,false)+woodGrain(310,275,223,4,515,false,false)
      + line('M67 289h209M313 289h210',shade,.7,.45)
    case 2: return woodGrain(55,68,224,83,521)+woodGrain(318,68,224,83,523)
      + woodGrain(55,182,224,76,525)+woodGrain(318,182,224,76,527)
      + line('M54 60h225M318 60h226M56 177h222M320 177h221',p[1],1,.55)
      + line('M291 63v90M291 181v78M307 63v90M307 181v78',shade,.7,.4)
      + line('M63 284h219M316 284h218',p[1],1,.5)
    // Four cloth cubbies; wood stays on the outer frame and lower drawers.
    case 3: return repeat(4,i=>upholstery(66+i*127,111,84,113,531+i))
      + woodGrain(38,90,7,150,537,true,false)+woodGrain(556,91,7,150,539,true,false)
      + line('M43 81h506M43 250h506',p[1],1,.6)
      + repeat(4,i=>line(`M${51+i*130} 266h103M${51+i*130} 279h103`,i%2?p[1]:shade,.7,.5))
    // Military metal rails remain visible between separate inset wood panels.
    case 4: return woodGrain(72,78,212,35,541,false,false)+woodGrain(320,78,206,35,543,false,false)
      + woodGrain(73,141,211,74,545,true)+woodGrain(320,141,206,74,547,true)
      + woodGrain(73,247,138,36,549,false,false)+woodGrain(386,247,140,36,551,false,false)
      + line('M65 67h467M64 128h225M315 128h216M64 234h226M315 234h215',p[1],1,.52)
      + line('M239 284h120',p[1],.8,.5)
    // Exposed logs surround a central hide; grain never crosses the hide.
    case 5: return woodGrain(59,84,17,177,561,true,false)+woodGrain(515,84,17,177,562,true,false)
      + repeat(3,i=>woodGrain(188+i*129,246,17,15,563+i,true,false))
      + upholstery(139,131,316,62,567,true)
      + woodGrain(53,60,492,8,569,false,false)+woodGrain(53,290,492,7,571,false,false)
      + line('M58 58h485M59 294h484',p[1],1.1,.6)
      + line('M141 214l26-5 46 4 67-5 63 4 56-6 42 5',p[1],.7,.35)
    case 6: return woodGrain(84,83,183,54,581,false,false)+woodGrain(334,83,183,54,583,false,false)
      + woodGrain(84,201,183,55,585,false,false)+woodGrain(334,201,183,55,587,false,false)
      + woodGrain(83,287,216,5,589,false,false)+woodGrain(323,287,216,5,591,false,false)
      + line('M85 75h430M78 86v164M522 86v164M89 268h421',p[1],1.15,.6)
      + line('M126 169l56-55 56 55-56 55Z M360 169l56-55 56 55-56 55Z',p[1],.7,.35)
    // Curved belly and oval inlay: separate upper/lower wood bands and flanks.
    case 7: return woodGrain(129,102,341,18,601,false,false)
      + woodGrain(123,243,355,24,603,false,false)
      + woodGrain(89,133,98,95,605,true)+woodGrain(414,133,96,95,607,true)
      + line('M91 91q207-51 417 0M95 263q205 45 411 0',p[1],1.2,.6)
      + line('M242 168q9-37 48-39M310 128q40 2 49 36',p[1],.7,.45)
      + repeat(3,i=>line(`M${121+i*128} 290h101`,p[1],.8,.5))
    case 8: return woodGrain(117,133,35,82,611,true,false)+woodGrain(445,132,34,82,613,true,false)
      + woodGrain(237,139,36,77,615,true,false)+woodGrain(329,139,36,77,617,true,false)
      + woodGrain(150,270,296,10,619,false,false)
      + line('M89 111Q300 51 511 111M91 254q210 59 418 0',p[1],1.1,.55)
      + line('M188 163q-4-20 7-23M398 163q-3-18 8-23',p[1],.75,.5)
    // Stone shoulders and bronze diamonds, wood inset left/right of the inlays.
    case 9: return stone(118,54,363,39,621)
      + stone(44,122,18,131,623)+stone(540,122,16,132,625)
      + woodGrain(87,119,22,116,627,true,false)+woodGrain(189,121,72,111,629,true)
      + woodGrain(339,121,73,111,631,true)+woodGrain(491,121,22,111,633,true,false)
      + line('M114 48h371M81 111h440',p[1],1.25,.58)
      + line('M61 273h219M318 273h219',p[1],.95,.5)
    case 10: return woodGrain(107,109,170,116,641,true)+woodGrain(322,109,170,116,643,true)
      + woodGrain(157,74,283,11,645,false,false)+woodGrain(146,258,307,11,647,false,false)
      + line('M88 88Q301 46 512 88M91 252q208 55 416 0',p[1],1.2,.58)
      + line('M289 95v143M308 95v143',shade,.6,.3)
      + line('M160 281h36M400 281h36',p[1],.8,.55)
    // Polygonal wood panels outside the central star/diamond instrument.
    case 11: return woodGrain(149,107,58,106,651,true)+woodGrain(393,107,55,106,653,true)
      + woodGrain(233,76,132,15,655,false,false)+woodGrain(238,248,125,17,657,false,false)
      + line('M163 70h273M91 147l65-73M444 75l72 72M159 275h278',p[1],1.1,.55)
      + line('M277 142l24-23 23 23M276 198l25 23 23-23',p[1],.65,.5)
      + line('M160 287h126M313 287h125',p[1],.85,.5)
    // Leather skin between seven bone ribs and two diagonal lashings.
    case 12: return upholstery(105,151,28,73,661,true)+upholstery(180,165,28,30,663,true)
      + upholstery(255,109,28,29,665,true)+upholstery(330,108,28,25,667,true)
      + upholstery(405,161,28,36,669,true)+upholstery(480,150,28,70,670,true)
      // Follow the exact original bone/cord centres; leather patches above
      // sit between those ribs and on one side of both diagonal lashings.
      + repeat(7,i=>line(`M${74+i*75} 77q15 85-3 193`,p[1],.8,.55))
      + line('M64 95l474 163M63 257L536 92',p[1],.75,.32)
      + line('M272 285h54',p[1],.75,.5)
    case 13: return repeat(3,i=>woodGrain(111+i*149,153,73,76,671+i,true))
      + repeat(3,i=>line(`M${109+i*149} 136l39-22 39 22`,p[1],1,.52))
      + woodGrain(112,67,138,15,677,false,false)+woodGrain(350,67,137,15,679,false,false)
      + line('M69 104v149M530 104v149M76 264h448',p[1],1.05,.5)
      + woodGrain(77,279,208,5,681,false,false)+woodGrain(315,279,208,5,683,false,false)
    // Keep the scale engraving: narrow grain strips sit between scale rows.
    case 14: return woodGrain(124,117,352,10,691,false,false)
      + woodGrain(124,170,352,10,693,false,false)+woodGrain(124,223,352,10,695,false,false)
      + woodGrain(102,278,177,5,697,false,false)+woodGrain(321,278,177,5,699,false,false)
      + line('M98 91l26-20 87 13M387 84l89-13 27 20M87 255h422',p[1],1,.5)
      + line('M100 293h175M323 293h174',p[1],.8,.55)
    // Pod-shaped belly, curved cap, split doors and two separate handles.
    case 15: return woodGrain(130,158,144,85,701,true)+woodGrain(327,158,141,84,703,true)
      + line('M103 104Q300 49 498 104',p[1],1.2,.65)
      + line('M102 127Q299 79 497 127',p[2],.7,.35)
      + line('M118 251q76 31 165 29M318 280q91-3 163-28',p[1],1,.5)
      + line('M290 153v103M309 153v103',shade,.6,.32)
    // Brass/glass pharmacy cabinet: separate pane reflections and brass rails.
    case 16: return line('M71 57h459M49 78v180M551 78v180',p[1],1,.75)
      + line('M75 78h209M315 78h207M75 246h209M315 246h207',p[1],.8,.55)
      + line('M104 108l47 37M117 103l64 49M361 107l44 35M377 101l63 49M113 185l39 33M363 188l48 39', '#EDF0D5',1.1,.3)
      + line('M66 281h215M319 281h215',p[1],.95,.65)
      + line('M68 295h211M321 295h211',p[2],.65,.4)
    // White enamel doors and cool metal frame; no oak grain on the paint.
    case 17: return line('M66 61h468M45 83v188M554 83v188',p[1],1,.72)
      + line('M79 106h202M317 106h202M79 228h202M317 228h202', '#F1EFDC',1.2,.45)
      + line('M91 121l28-1M251 215l23 1M329 122l20-1M478 214l28 1',p[2],.55,.2)
      + line('M75 281h204M320 281h203', '#F0EED7',1.1,.6)
      + line('M77 296h199M322 296h199',p[2],.65,.35)
    // Six oak slats over dark interstices; grain follows each slat vertically.
    case 18: return repeat(6,i=>woodGrain(77+i*80,100,42,122,721+i,true,i===1||i===4))
      + woodGrain(45,66,506,6,729,false,false)
      + line('M48 61h498M82 99v123M162 99v123M242 99v123M322 99v123M402 99v123M482 99v123',p[1],.9,.55)
      + woodGrain(56,278,221,4,731,false,false)+woodGrain(315,278,221,4,733,false,false)
      + line('M59 291h213M319 291h212',shade,.65,.4)
    case 19: return woodGrain(103,125,41,107,741,true,false)+woodGrain(227,126,51,106,743,true)
      + woodGrain(322,127,48,106,745,true)+woodGrain(455,125,38,107,747,true,false)
      + line('M87 95Q174 59 255 99M345 99q81-40 167-4',p[1],1.1,.6)
      + line('M90 256q99 40 197 27M313 283q100 14 197-27',p[1],1.05,.5)
      + line('M179 145q-7-15 6-23M407 144q-7-14 6-23',p[1],.75,.55)
      + line('M123 283h45M437 283h45',p[1],.85,.5)
    // Black lacquer and brass steps: restrained polished streaks, not grain.
    case 20: return line('M74 120v132M85 120v127M531 120v132M521 120v127',p[1],.8,.25)
      + line('M141 76h317M103 107h25M474 107h24M73 266h454',p[1],1,.55)
      + line('M105 141l29-4M456 237l33-2M214 247l22 1', '#DDD3BF',.55,.24)
      + line('M134 150l18-17 18 17M285 150l18-17 18 17M435 150l18-17 18 17',p[1],.7,.5)
      + line('M58 282h223M318 282h223',p[1],1,.6)
    case 21: return woodGrain(114,115,78,101,761,true)+woodGrain(409,115,76,101,763,true)
      + woodGrain(223,96,151,13,765,false,false)+woodGrain(228,232,142,9,767,false,false)
      + line('M87 91Q300 51 513 91M93 254q206 49 413 0',p[1],1.15,.6)
      + line('M238 159q10-26 48-28M314 131q35 1 48 27',p[1],.8,.48)
      + line('M101 276h195M321 276h175',p[1],.9,.5)
    // L-shaped top: left long panel, two right shelves and the short lower toe.
    case 22: return woodGrain(90,84,192,181,771,true)
      + woodGrain(345,83,156,43,773,false,false)+woodGrain(345,166,156,70,775)
      + woodGrain(84,292,202,5,777,false,false)
      + line('M86 77h201M343 77h160M85 275h201M343 250h159',p[1],1,.55)
      + line('M316 162v94M340 155h157',shade,.7,.34)
      + line('M408 266h43',p[1],.8,.6)
    // Wooden wardrobe and five discrete luggage-rack bars in the dark side bay.
    case 23: return woodGrain(66,83,148,168,781,true)+woodGrain(237,83,150,168,783,true)
      + repeat(5,i=>woodGrain(438+i*23,93,4,145,787+i,true,false))
      + woodGrain(44,56,511,5,795,false,false)
      + line('M67 77h322M65 260h326M426 75h119M427 259h116',p[1],1,.55)
      + line('M221 86v163M229 86v163',shade,.65,.3)
      + line('M57 282h158M238 282h158M431 288h110',p[1],.9,.5)
    default: throw new Error('Unknown cabinet material refinement')
  }
}

const chairChanges: readonly (readonly string[])[] = [
  ['复用已审乡野独板椅试样的座板木纹、靠背接合与钉头亮暗'],
  ['横向背梁与两根短撑分别加顺纹','编绳座面沿原经纬加纤维亮暗，不填绳隙'],
  ['圆角木座板增加横向木纹与克制磨亮','弯木围背和扶手沿原曲线加内侧亮暗'],
  ['四条座板和背梁分别沿结构加顺纹','独立背柱保留间隙，前缘加接合明暗'],
  ['皮布座面增加细孔与折痕','交叉背带及座面束带沿原条带加磨亮'],
  ['皮面座垫增加细孔和压痕','鹿角分叉及弯木扶手沿内芯增加明暗'],
  ['布面座垫增加细织纹与角部压褶','雕花背梁下木带和独立扶手增加顺纹'],
  ['软包增加细织纹及受压褶线','鎏金冠背、独立扶手及前木梁增加内侧亮暗'],
  ['叶形座垫中心增加织纹和压褶','枝蔓围背与曲扶手沿原内芯加细亮暗'],
  ['石围框增加细矿点和石脉','座垫保留织物表达，石缘与青铜嵌条分开加亮暗'],
  ['椭圆皮垫中心增加细孔及压痕','圆环木背及座圈沿实际弧线加磨亮'],
  ['多边形软垫增加织纹和角部压褶','菱晶背板、扶手保留原嵌饰，仅补木质内部顺纹'],
  ['缝皮座面增加细孔及折痕','骨柱、侧撑与前缘缝合分别加克制高光'],
  ['矩形软垫增加织纹和边缘压褶','尖冠背与独立扶手内部增加顺纹及接合亮暗'],
  ['翼形软垫内部增加织纹与褶线','龙角、侧翼与原鳞纹沿内侧加亮暗'],
  ['圆座垫增加织纹和压褶','六片独立花瓣沿各自中轴加细亮暗，保留瓣间透明区'],
  ['藤编座面沿原经纬加纤维亮暗','黄铜弯管沿管芯加反光，不添加木纹'],
  ['搪瓷座面增加克制擦痕与弧面反光','白漆铁管沿管芯加冷色高光，保留环内孔洞'],
  ['皮垫增加细孔和边缘压痕','橡木背梁、五根板条和扶手分别加定向顺纹'],
  ['织物座垫增加细织纹和压褶','卷草曲木背与扶手沿原弧线加反光'],
  ['扇形与主座软包分区增加褶线','黑色扶手及扇形镶线增加克制反光'],
  ['皮面座垫增加细孔和压痕','深木卷背与扶手沿内弧补磨亮，保留簇扣'],
  ['折叠木座的三段板面分段加横纹','背梁增加顺纹，座板前缘补接合亮暗'],
  ['簇扣软包增加织纹及边缘压褶','围背与卷臂沿内侧加柔和反光，保留原扣点'],
]
const cabinetChanges: readonly (readonly string[])[] = [
  ['复用已审乡野矮柜试样的分板木纹、抽面与五金亮暗'],
  ['七条通风木板分别加竖向顺纹，保留暗缝','外框与双抽前缘加接合亮暗'],
  ['四个实木面板按原中缝和横缝分别加横纹','双抽与板缘增加内侧磨亮'],
  ['四个布草分格内部增加织纹与压褶','外木框和四抽前缘分区补亮暗'],
  ['军械柜铁箍之间的木板分区加顺纹','金属横闩及包边沿内芯加磨亮'],
  ['原木立撑逐根加竖纹','中间皮面增加细孔及折痕，顶部原木和抽面另补亮暗'],
  ['雕花嵌框四角的木面分区加顺纹','菱形雕饰与双抽前缘保持原结构并补明暗'],
  ['曲腹上下木带与左右实木侧面分别加顺纹','椭圆嵌饰和三抽前缘补内侧反光'],
  ['枝蔓与叶饰之间的四条实木区域分别加顺纹','弧形上下沿及叶脉增加克制亮暗'],
  ['阶肩石框增加细矿点及石脉','青铜菱饰两侧的四块木板加竖纹，材质分开'],
  ['双门木面分别加竖向顺纹','曲面上下木带和两只把手增加磨亮'],
  ['六角柜左右侧板和上下木带分别加顺纹','中心星仪与抽面仅增加内侧亮暗'],
  ['七骨肋之间的皮面分区增加细孔与折痕','骨肋、斜束带和把手分开补反光'],
  ['三个尖拱门板分别加竖向顺纹','双肩木带及双抽前缘增加接合亮暗'],
  ['三排鳞纹之间的窄木带分别加横纹','保留鳞刻与龙爪嵌饰，双抽补亮暗'],
  ['荚形双门分别加竖向顺纹','弧顶、弧腹及中央接缝补柔和反光'],
  ['四块玻璃窗格分别补克制斜反射','黄铜框、横梁及双抽边缘分开加亮暗，不加木纹'],
  ['白漆搪瓷柜门增加小片擦痕及面反光','铁框和抽面边缘增加冷色反光，不加木纹'],
  ['六条橡木格栅分别加竖向顺纹并保留暗隙','顶部木梁和双抽前缘补接合明暗'],
  ['卷草嵌饰之间的四条木面分别加竖纹','曲顶、弧腹、叶饰与双把手分别补反光'],
  ['黑漆面保留平整，用克制短擦痕和窄反光表达','阶梯金属嵌边与三块菱形装饰单独补亮暗'],
  ['椭圆嵌饰两侧和上下实木分区加顺纹','鼓腹上下沿、椭圆边及双抽前缘增加磨亮'],
  ['L形左侧长面和右侧两格分别加定向顺纹','短下沿、转角接合与原把手补亮暗，保留缺口'],
  ['衣柜左面两块木板加竖向顺纹','五条行李托板分别加细木纹，保留板隙及两区结构'],
]

export const FURNITURE_REFINEMENT_CHAIR_CABINET_PAINTS: readonly FurnitureMaterialPaint[] = Object.freeze([
  ...FURNITURE_STYLES.map((style,index)=>({category:'chair' as const,styleId:style.id,paint:chair(index,style),changes:chairChanges[index]})),
  ...FURNITURE_STYLES.map((style,index)=>({category:'cabinet' as const,styleId:style.id,paint:cabinet(index,style),changes:cabinetChanges[index]})),
])
