import { SCENE_COLLECTION_SCENARIOS } from '../../../shared/assets/scene-collection-plan.js'
import { freezeJson } from '../../../shared/validation/json.js'
import { createSceneCollectionScenarioDocument, materializeSceneCollectionScenario, type ScenarioProp, type ScenarioSpec } from './scene-collection-scenario-kit.js'

const p=(id:string,category:string,x:number,y:number,support:string,variant:string|number=0,rotation=0):ScenarioProp=>({id,category,x,y,support,variant,rotation})
const n=(id:string,category:string,x:number,y:number,support:string,variant:string,rotation=0):ScenarioProp=>({...p(id,category,x,y,support,variant,rotation),naturalFallback:true})
const f=(id:string,category:string,x:number,y:number,support:string,style:string,rotation=0):ScenarioProp=>({id,category,x,y,support,style,rotation})
const base=(id:string,widthMm:number,heightMm:number)=>({id,name:SCENE_COLLECTION_SCENARIOS.find(row=>row.id===id)!.name,era:'fantasy' as const,widthMm,heightMm,wallMaterial:'stone-surface-slate-cleavage'})
const route=(id:string,points:readonly (readonly [number,number])[])=>({id,name:'真实主要活动通路',from:{type:'point' as const,positionMm:{x:points[0][0],y:points[0][1]}},to:{type:'point' as const,positionMm:{x:points.at(-1)![0],y:points.at(-1)![1]}},clearanceMm:1000,mode:'current' as const,assumedOpenDoorIds:[],routeHintMm:points.map(([x,y])=>({x,y}))})

// A compact clearing surrounded by independently editable species. The cloth tents are solid
// shelters in plan; the bedrolls and cooking area remain outside their actual footprints.
const woodland:ScenarioSpec={...base('woodland-camp',30000,26000),rooms:[],openings:[],
 grounds:[{id:'camp-wood',name:'林地腐殖土',bounds:[500,500,29000,25000],material:'earth-surface-forest-humus'},
  {id:'camp-clearing',name:'已踩实的营地空地',bounds:[7500,6500,16000,15000],boundary:[{x:7500,y:8500},{x:11000,y:6500},{x:22000,y:7300},{x:23500,y:14000},{x:21800,y:21400},{x:11200,y:21500},{x:7600,y:17000}],material:'earth-surface-trodden-loam',priority:1}],
 paths:[{id:'camp-trail',centerlineMm:[{x:15500,y:24500},{x:15500,y:19500},{x:14700,y:14500},{x:18200,y:13000}],widthMm:1500,supportRefs:[{kind:'terrainArea',id:'camp-wood'},{kind:'terrainArea',id:'camp-clearing'}],material:'earth-surface-trodden-loam'}],
 props:[n('camp-birch','tree',3500,3800,'camp-wood','tree-birch'),n('camp-larch','tree',11700,3300,'camp-wood','tree-larch'),n('camp-pine','tree',25600,4100,'camp-wood','tree-broken-pine'),n('camp-beech','tree',4200,21000,'camp-wood','tree-beech'),n('camp-cypress','tree',26600,21900,'camp-wood','tree-cypress'),
  n('camp-holly','shrub',2800,11300,'camp-wood','shrub-holly'),n('camp-juniper','shrub',26800,11600,'camp-wood','shrub-juniper'),n('camp-hawthorn','shrub',26400,17500,'camp-wood','shrub-hawthorn'),
  n('camp-boulder','rock',5400,14300,'camp-wood','rock-rounded-granite'),n('camp-flint','rock',22600,23800,'camp-wood','rock-flint'),
  p('camp-leaf-tent','tent',10700,9800,'camp-clearing','tent-leaf'),p('camp-pod-tent','tent',20100,10700,'camp-clearing','tent-pod'),
  p('camp-bed-a','bedroll',10100,14500,'camp-clearing','bedroll-leaf'),p('camp-bed-b','bedroll',12000,14500,'camp-clearing','bedroll-petal'),
  p('camp-chest','chest',11500,12200,'camp-clearing','chest-leaf-coffer'),p('camp-chest-b','chest',20500,13500,'camp-clearing','chest-bark-pod'),
  p('camp-fire','brazier',18100,16300,'camp-clearing','brazier-leaf'),n('camp-log','fallen-log',18100,18700,'camp-clearing','fallen-log-beech'),
  p('camp-kit','camp-kit',19900,15800,'camp-clearing','camp-kit-leaf-bowl'),p('camp-kit-b','camp-kit',19900,17000,'camp-clearing',1),
  p('camp-supply','exploration-supply',21600,14800,'camp-clearing',0),p('camp-supply-b','exploration-supply',12700,17400,'camp-clearing',1),
  p('camp-basket','basket',10700,18800,'camp-clearing','basket-elven-leaf'),p('camp-lamp','lantern',13300,11900,'camp-clearing','lantern-seedpod'),
  n('camp-grass-a','grass-clump',6700,6000,'camp-wood','grass-clump-fescue'),n('camp-grass-b','grass-clump',25600,15300,'camp-wood','grass-clump-dry'),n('camp-grass-c','grass-clump',10400,23000,'camp-wood','grass-clump-wet'),
  n('camp-fern','fern-clump',6600,18000,'camp-wood','fern-clump-bracken'),n('camp-mushrooms','fungus-clump',6500,23000,'camp-wood','fungus-clump-bracket'),p('camp-embers','soot',18200,16100,'camp-clearing','soot-spark-scatter'),
  n('camp-edge-birch','tree',3000,8500,'camp-wood','tree-birch'),n('camp-edge-beech','tree',3700,15700,'camp-wood','tree-beech'),n('camp-edge-larch','tree',7800,3200,'camp-wood','tree-larch'),n('camp-edge-cherry','tree',17600,2900,'camp-wood','tree-cherry'),
  n('camp-edge-pine','tree',27000,15000,'camp-wood','tree-broken-pine'),n('camp-edge-pear','tree',25500,19000,'camp-wood','tree-pear'),n('camp-edge-south','tree',8000,23000,'camp-wood','tree-larch'),n('camp-edge-south-east','tree',18200,23000,'camp-wood','tree-birch')],
 groups:[{id:'camp-sleeping',name:'可拆叶帐与行李',members:['camp-leaf-tent','camp-chest']},{id:'camp-cooking',name:'可拆火盆与围坐木',members:['camp-fire','camp-log','camp-kit']}],
 lights:[{id:'camp-fire-glow',x:18100,y:16300,radiusMm:3300,intensity:.18},{id:'camp-seed-light',x:13300,y:11900,radiusMm:2100,color:'#C9DAA5'}],
 routes:[route('camp-arrival',[[15500,24300],[15500,19800],[14600,17500],[14600,14000],[17300,13200]])]}

const outpost:ScenarioSpec={...base('mountain-outpost',25000,22000),
 grounds:[{id:'post-ground',name:'山道石砾缓坡',bounds:[500,500,24000,21000],material:'sand-surface-stony-desert'}],
 rooms:[{id:'post-shelter',name:'废哨守卫室',bounds:[2500,2500,10500,9000],material:'stone-surface-slate-cleavage',support:'post-ground'},
  {id:'post-stock',name:'山行补给库',bounds:[2500,11500,6500,6500],material:'earth-surface-packed-yard',support:'post-ground'}],
 openings:[{id:'post-front',axis:'x',lineMm:13000,atMm:7400,widthMm:1800,kind:'door',entrance:true},{id:'post-stock-door',axis:'y',lineMm:11500,atMm:6900,widthMm:1500,kind:'door'},{id:'post-watch-window',axis:'y',lineMm:2500,atMm:8900,widthMm:1700,kind:'window'}],
 paths:[{id:'post-mountain-road',centerlineMm:[{x:17600,y:19500},{x:16900,y:14500},{x:15800,y:8300},{x:15000,y:8300}],widthMm:1800,supportRefs:[{kind:'terrainArea',id:'post-ground'}],material:'earth-surface-trodden-loam'}],
 props:[f('post-table','table',6500,5300,'post-shelter','dwarven'),f('post-chair','chair',6500,7100,'post-shelter','dwarven',180),
  p('post-rack','weapon-rack',10100,4100,'post-shelter','weapon-rack-hex'),p('post-bed-a','bedroll',4200,9000,'post-shelter','bedroll-dwarf'),p('post-bed-b','bedroll',6100,9100,'post-shelter','bedroll-gothic'),
  p('post-chest','chest',8300,10100,'post-shelter','chest-hex-vault'),p('post-brazier','brazier',10900,10100,'post-shelter','brazier-hex'),p('post-table-map','scroll-book',6250,5300,'post-shelter','scroll-book-stone'),p('post-lamp','lantern',6800,5300,'post-shelter','lantern-dwarf'),
  p('post-stock-chest-a','chest',4200,13500,'post-stock','chest-hex-vault'),p('post-stock-chest-b','chest',6000,13500,'post-stock','chest-buttress'),p('post-stock-barrel','barrel',7700,15800,'post-stock','barrel-stone-vat'),
  p('post-supply','exploration-supply',4000,16200,'post-stock',0),p('post-kit','camp-kit',5400,16400,'post-stock',1),
  {...p('post-stair-remnant','stairs',11900,15700,'post-ground','stairs-basalt'),decorative:true},p('post-railing','railing',20800,6200,'post-ground','railing-slab',90),
  p('post-barricade','barricade',21100,14200,'post-ground','barricade-hex'),n('post-rock-n','rock',17500,3000,'post-ground','rock-slate'),n('post-rock-ne','rock',22200,2500,'post-ground','rock-quartz-outcrop'),n('post-rock-se','rock',22100,18900,'post-ground','rock-rounded-granite'),
  p('post-rubble','rubble',11600,19800,'post-ground','rubble-mortar'),p('post-rubble-b','rubble',13700,18700,'post-ground','rubble-splinters'),p('post-soot','soot',10900,10000,'post-shelter','soot-ash-fall'),
  p('post-yard-chest','chest',20500,10100,'post-ground','chest-buttress'),p('post-yard-lamp','lantern',19000,10300,'post-ground','lantern-gothic'),p('post-sack','sack',7700,13400,'post-stock',1)],
 groups:[{id:'post-command',name:'可拆哨所桌椅',members:['post-table','post-chair']},{id:'post-supply-cache',name:'可拆远行补给箱',members:['post-stock-chest-a','post-stock-chest-b','post-supply']}],
 attachments:[{hostId:'post-table',heightMm:780,children:[{id:'post-table-map',x:-250,y:0},{id:'post-lamp',x:300,y:0}]}],
 lights:[{id:'post-brazier-glow',x:10900,y:10100,radiusMm:2500},{id:'post-road-light',x:19000,y:10300,radiusMm:2600}],
 routes:[route('post-road-entry',[[17600,20200],[16900,14500],[15800,8300],[11900,8300],[9000,8300]])],
 notes:[{id:'post-stair-note',x:11900,y:17800,text:'倒塌石阶为地面废料，不能由图片推断登高。实际进入哨所使用东侧1.8米门与山道。'}]}

const cavern:ScenarioSpec={...base('cavern-lair',24000,21000),
 grounds:[{id:'cave-bedrock',name:'洞底岩盘与洞口',bounds:[500,500,23000,20000],material:'sand-surface-black-volcanic'}],
 rooms:[{id:'cave-main',name:'有实体岩壁的主洞室',bounds:[2000,3500,12500,14000],thicknessMm:650,material:'earth-surface-trodden-loam',support:'cave-bedrock'},
  {id:'cave-side',name:'岩壁侧洞与俘虏区',bounds:[14500,3500,7500,9500],thicknessMm:650,material:'earth-surface-peat-fibres',support:'cave-bedrock'}],
 openings:[{id:'cave-mouth',axis:'y',lineMm:17500,atMm:7800,widthMm:2600,kind:'door',entrance:true},{id:'cave-side-mouth',axis:'x',lineMm:14500,atMm:9200,widthMm:2200,kind:'door'}],
 props:[n('cave-rock-a','rock',4500,6000,'cave-main','rock-slate'),n('cave-rock-b','rock',11600,6000,'cave-main','rock-quartz-outcrop'),n('cave-rock-c','rock',20300,15100,'cave-bedrock','rock-rounded-granite'),
  p('cave-stalagmite-a','stalagmite',4000,10000,'cave-main','stalagmite-twin'),p('cave-stalagmite-b','stalagmite',12500,14000,'cave-main','stalagmite-shield'),p('cave-stalagmite-c','stalagmite',20500,9000,'cave-side','stalagmite-broken'),
  p('cave-cage','cage',18200,6500,'cave-side','cage-bone'),p('cave-chest-a','chest',16500,11800,'cave-side','chest-bone-chest'),p('cave-chest-b','chest',19300,11800,'cave-side','chest-scale-trunk'),
  p('cave-fire','brazier',6400,12700,'cave-main','brazier-bone'),p('cave-bed-a','bedroll',4200,14700,'cave-main','bedroll-hide'),p('cave-bed-b','bedroll',6400,15500,'cave-main','bedroll-scale'),
  p('cave-kit','camp-kit',7800,13500,'cave-main',1),p('cave-supply','exploration-supply',10800,15500,'cave-main',1),p('cave-supply-b','exploration-supply',12400,10600,'cave-main',0),
  p('cave-barrel','barrel',7600,5300,'cave-main','barrel-bone-vat'),p('cave-chest-c','chest',7500,7100,'cave-main','chest-bone-chest'),
  n('cave-fungus-a','fungus-clump',3400,12500,'cave-main','fungus-clump-chanterelle'),n('cave-fungus-b','fungus-clump',12100,8100,'cave-main','fungus-clump-bracket'),n('cave-fungus-c','fungus-clump',21000,9000,'cave-side','fungus-clump-morel'),
  p('cave-web','cobweb',3600,5000,'cave-main','cobweb-funnel'),p('cave-web-b','cobweb',20500,5000,'cave-side','cobweb-torn'),p('cave-rubble','rubble',11500,15900,'cave-main','rubble-mortar'),p('cave-rubble-b','rubble',3500,18400,'cave-bedrock','rubble-splinters'),
  p('cave-lamp','lantern',16200,9700,'cave-side','lantern-bone'),p('cave-soot','soot',6400,12600,'cave-main','soot-radial-burn')],
 groups:[{id:'cave-rest',name:'可拆洞内火堆营具',members:['cave-fire','cave-kit','cave-bed-a']},{id:'cave-hoard',name:'独立掠物箱组',members:['cave-chest-a','cave-chest-b']}],
 lights:[{id:'cave-fire-glow',x:6400,y:12700,radiusMm:3100,intensity:.18},{id:'cave-captive-light',x:16200,y:9700,radiusMm:2600}],
 routes:[route('cave-entry-route',[[9100,19300],[9100,16600],[9700,12000],[11100,10300],[13200,10300],[15800,10300],[18200,10000]])]}

const prison:ScenarioSpec={...base('dungeon-prison',23000,20000),
 grounds:[{id:'prison-base',name:'地下岩盘',bounds:[500,500,22000,19000],material:'stone-surface-slate-cleavage'}],
 rooms:[{id:'prison-cell-a',name:'西侧独立牢房',bounds:[2000,2000,6500,6500],material:'earth-surface-packed-yard',support:'prison-base'},
  {id:'prison-cell-b',name:'东侧独立牢房',bounds:[8500,2000,6500,6500],material:'earth-surface-packed-yard',support:'prison-base'},
  {id:'prison-hall',name:'监牢检查廊',bounds:[2000,8500,13000,3500],material:'stone-surface-slate-cleavage',support:'prison-base'},
  {id:'prison-guard',name:'值守及备用门机件',bounds:[2000,12000,8000,6000],material:'wood-surface-pine-narrow',support:'prison-base'},
  {id:'prison-store',name:'收押物资间',bounds:[10000,12000,5000,6000],material:'stone-surface-slate-cleavage',support:'prison-base'},
  {id:'prison-hold',name:'笼具收押间',bounds:[15000,8500,6000,9500],material:'stone-surface-slate-cleavage',support:'prison-base'}],
 openings:[{id:'prison-entry',axis:'x',lineMm:21000,atMm:14300,widthMm:1800,kind:'door',entrance:true},{id:'prison-hold-door',axis:'x',lineMm:15000,atMm:9500,widthMm:1500,kind:'door'},
  {id:'prison-cell-a-door',axis:'y',lineMm:8500,atMm:5900,widthMm:1400,kind:'door'},{id:'prison-cell-b-door',axis:'y',lineMm:8500,atMm:11900,widthMm:1400,kind:'door'},
  {id:'prison-guard-door',axis:'y',lineMm:12000,atMm:5900,widthMm:1500,kind:'door'},{id:'prison-store-door',axis:'y',lineMm:12000,atMm:12100,widthMm:1500,kind:'door'}],
 props:[p('prison-bed-a','bedroll',3700,4400,'prison-cell-a','bedroll-gothic'),p('prison-bed-b','bedroll',10400,4400,'prison-cell-b','bedroll-gothic'),p('prison-bed-a2','bedroll',5400,4500,'prison-cell-a','bedroll-dwarf'),p('prison-bed-b2','bedroll',12100,4500,'prison-cell-b','bedroll-dwarf'),
  p('prison-cell-bowl-a','camp-kit',6800,3300,'prison-cell-a',1),p('prison-cell-bowl-b','camp-kit',13500,3300,'prison-cell-b',1),
  p('prison-cell-barrel-a','barrel',7100,5500,'prison-cell-a','barrel-gothic-basin'),p('prison-cell-barrel-b','barrel',13500,5500,'prison-cell-b','barrel-stone-vat'),
  p('prison-cage','cage',18000,12400,'prison-hold','cage-gothic'),p('prison-hold-barrel','barrel',16400,16400,'prison-hold','barrel-stone-vat'),p('prison-hold-chest','chest',19000,17300,'prison-hold','chest-buttress'),
  f('prison-desk','table',4400,14000,'prison-guard','gothic'),f('prison-chair','chair',4400,15600,'prison-guard','gothic',180),
  p('prison-log','scroll-book',4200,14000,'prison-guard',1),p('prison-desk-lamp','lantern',4750,14000,'prison-guard','lantern-gothic'),
  {...p('prison-spare-gate','cell-gate',8000,16600,'prison-guard','cell-gate-gothic'),decorative:true},{...p('prison-spare-trap','trap',7800,14200,'prison-guard','trap-dwarf'),decorative:true},
  p('prison-supply-a','exploration-supply',11300,14100,'prison-store',0),p('prison-supply-b','exploration-supply',13500,14100,'prison-store',1),p('prison-chest','chest',12600,16500,'prison-store','chest-hex-vault'),
  p('prison-lamp-west','lantern',3200,10300,'prison-hall','lantern-gothic'),p('prison-lamp-east','lantern',14100,11300,'prison-hall','lantern-dwarf'),
  p('prison-drag','drag-mark',17200,14500,'prison-hold','drag-mark-chain-scrape'),p('prison-rubble','rubble',4100,6900,'prison-cell-a','rubble-mortar'),p('prison-rubble-b','rubble',10500,7100,'prison-cell-b','rubble-splinters'),
  p('prison-brazier','brazier',3000,16900,'prison-guard','brazier-gothic'),p('prison-rack','weapon-rack',8000,12700,'prison-guard','weapon-rack-lancet'),p('prison-basket','basket',14000,17300,'prison-store','basket-dwarven-wire')],
 groups:[{id:'prison-guard-set',name:'可拆值守桌椅',members:['prison-desk','prison-chair']},{id:'prison-evidence',name:'可拆收押行李',members:['prison-supply-a','prison-supply-b','prison-chest']}],
 attachments:[{hostId:'prison-desk',heightMm:760,children:[{id:'prison-log',x:-200,y:0},{id:'prison-desk-lamp',x:350,y:0}]}],
 lights:[{id:'prison-west-glow',x:3200,y:10300,radiusMm:2800},{id:'prison-east-glow',x:14100,y:11300,radiusMm:2900},{id:'prison-guard-glow',x:3000,y:16900,radiusMm:2300}],
 routes:[route('prison-check-route',[[21800,15200],[20100,15200],[20100,10250],[16500,10250],[12500,10250],[6600,10250],[6600,7300]])],
 notes:[{id:'prison-gate-note',x:7800,y:17700,text:'南侧尖拱铁栅和捕兽夹是卸下待修的备件，不提供门洞或陷阱机制；两间独立牢房各有真实墙上门。'}]}

const tomb:ScenarioSpec={...base('tomb-sanctum',23000,21000),
 grounds:[{id:'tomb-rock',name:'墓室岩盘',bounds:[500,500,22000,20000],material:'sand-surface-quartz-grains'}],
 rooms:[{id:'tomb-sanctum-room',name:'先祖祭室',bounds:[2500,2500,18000,10000],material:'stone-surface-slate-cleavage',support:'tomb-rock'},
  {id:'tomb-crypt-west',name:'西侧安葬室',bounds:[2500,12500,6500,6000],material:'stone-surface-slate-cleavage',support:'tomb-rock'},
  {id:'tomb-entry',name:'净空仪式前厅',bounds:[9000,12500,5000,6000],material:'stone-surface-slate-cleavage',support:'tomb-rock'},
  {id:'tomb-crypt-east',name:'东侧安葬室',bounds:[14000,12500,6500,6000],material:'stone-surface-slate-cleavage',support:'tomb-rock'}],
 openings:[{id:'tomb-front',axis:'y',lineMm:18500,atMm:10600,widthMm:1800,kind:'door',entrance:true},{id:'tomb-sanctum-door',axis:'y',lineMm:12500,atMm:10500,widthMm:2000,kind:'door'},{id:'tomb-west-door',axis:'x',lineMm:9000,atMm:15100,widthMm:1500,kind:'door'},{id:'tomb-east-door',axis:'x',lineMm:14000,atMm:15100,widthMm:1500,kind:'door'}],
 props:[p('tomb-altar','altar',11500,6100,'tomb-sanctum-room','altar-crescent'),p('tomb-relic','relic',11500,6100,'tomb-sanctum-room','relic-leaf'),
  p('tomb-statue','statue',11500,3700,'tomb-sanctum-room','statue-serpent'),p('tomb-column-a','column',5900,7600,'tomb-sanctum-room','column-grooved'),p('tomb-column-b','column',17100,7600,'tomb-sanctum-room','column-grooved'),
  p('tomb-offering-west','offering-table',5800,4500,'tomb-sanctum-room','offering-table-crescent'),p('tomb-offering-east','offering-table',17100,4500,'tomb-sanctum-room','offering-table-crescent'),
  p('tomb-candle-a','candelabrum',9400,7200,'tomb-sanctum-room','candelabrum-gothic'),p('tomb-candle-b','candelabrum',13600,7200,'tomb-sanctum-room','candelabrum-gothic'),
  p('tomb-candle-c','candelabrum',10100,15700,'tomb-entry','candelabrum-star'),p('tomb-candle-d','candelabrum',12900,15700,'tomb-entry','candelabrum-star'),
  p('tomb-coffin-a','sarcophagus',4400,16200,'tomb-crypt-west','sarcophagus-crystal'),p('tomb-coffin-b','sarcophagus',6900,16200,'tomb-crypt-west','sarcophagus-hex'),
  p('tomb-coffin-c','sarcophagus',16000,16200,'tomb-crypt-east','sarcophagus-root'),p('tomb-coffin-d','sarcophagus',18500,16200,'tomb-crypt-east','sarcophagus-leaf'),
  p('tomb-stone-a','headstone',4400,13500,'tomb-crypt-west','headstone-crystal'),p('tomb-stone-b','headstone',6900,13500,'tomb-crypt-west','headstone-rune'),p('tomb-stone-c','headstone',16000,13500,'tomb-crypt-east','headstone-root'),p('tomb-stone-d','headstone',18500,13500,'tomb-crypt-east','headstone-leaf'),
  p('tomb-web-west','cobweb',3700,11300,'tomb-sanctum-room','cobweb-funnel'),p('tomb-web-east','cobweb',19300,11300,'tomb-sanctum-room','cobweb-torn'),p('tomb-rubble','rubble',7400,10300,'tomb-sanctum-room','rubble-mortar'),p('tomb-rubble-b','rubble',15400,10600,'tomb-sanctum-room','rubble-roof-tiles'),
  p('tomb-offering-relic','relic',5800,4500,'tomb-sanctum-room','relic-shell'),p('tomb-offering-book','scroll-book',17100,4500,'tomb-sanctum-room','scroll-book-stone')],
 groups:[{id:'tomb-west-burial',name:'可拆西墓石棺与墓碑',members:['tomb-coffin-a','tomb-stone-a']},{id:'tomb-ritual',name:'可拆月坛与两侧烛台',members:['tomb-altar','tomb-candle-a','tomb-candle-b']}],
 attachments:[{hostId:'tomb-altar',heightMm:1100,children:[{id:'tomb-relic',x:0,y:0}]},{hostId:'tomb-offering-west',heightMm:800,children:[{id:'tomb-offering-relic',x:0,y:0}]},{hostId:'tomb-offering-east',heightMm:800,children:[{id:'tomb-offering-book',x:0,y:0}]}],
 lights:[{id:'tomb-core-glow',x:11500,y:6600,radiusMm:3900,color:'#B7C5D6',intensity:.15},{id:'tomb-entry-glow',x:11500,y:15700,radiusMm:2600,intensity:.13}],
 routes:[route('tomb-procession',[[11500,19800],[11500,17400],[11500,13400],[11500,10500],[11500,8200]])]}

const arcane:ScenarioSpec={...base('arcane-workroom',22000,19000),
 grounds:[{id:'arcane-base',name:'塔底院坪',bounds:[500,500,21000,18000],material:'earth-surface-packed-yard'}],
 rooms:[{id:'arcane-study',name:'书卷研究及起居',bounds:[2000,2000,9000,14500],material:'wood-surface-pine-narrow',support:'arcane-base'},
  {id:'arcane-lab',name:'炼金实验工房',bounds:[11000,2000,9000,9000],material:'brick-surface-hex-ceramic',support:'arcane-base'},
  {id:'arcane-ritual',name:'隔离的仪式室',bounds:[11000,11000,9000,5500],material:'stone-surface-slate-cleavage',support:'arcane-base'}],
 openings:[{id:'arcane-front',axis:'y',lineMm:16500,atMm:7500,widthMm:1600,kind:'door',entrance:true},{id:'arcane-lab-door',axis:'x',lineMm:11000,atMm:7600,widthMm:1600,kind:'door'},{id:'arcane-ritual-door',axis:'y',lineMm:11000,atMm:15700,widthMm:1600,kind:'door'},{id:'arcane-window',axis:'y',lineMm:2000,atMm:5700,widthMm:1800,kind:'window'}],
 props:[p('arcane-bookcase-a','bookshelf',3600,5100,'arcane-study','bookshelf-suspended',90),p('arcane-bookcase-b','bookshelf',3600,8000,'arcane-study','bookshelf-slate',90),
  f('arcane-desk','table',7400,5400,'arcane-study','arcanist'),f('arcane-chair','chair',7400,7100,'arcane-study','arcanist',180),
  p('arcane-desk-book','scroll-book',7050,5400,'arcane-study',0),p('arcane-desk-relic','relic',7750,5400,'arcane-study',1),
  f('arcane-bed','bed',4200,12800,'arcane-study','arcanist'),f('arcane-cabinet','cabinet',5600,15700,'arcane-study','arcanist'),p('arcane-chest','chest',6500,14500,'arcane-study','chest-octagon-case'),
  p('arcane-alchemy','alchemy-bench',13900,4000,'arcane-lab','alchemy-bench-crystal'),p('arcane-alchemy-potion','potion',13600,4000,'arcane-lab',0),p('arcane-alchemy-potion-b','potion',14300,4000,'arcane-lab',1),
  p('arcane-crystal','crystal-device',17900,4600,'arcane-lab','crystal-device-spiral'),p('arcane-bench','workbench',13800,6800,'arcane-lab','workbench-fantasy-rune'),p('arcane-tools','craft-tool',13800,7000,'arcane-lab',0),
  p('arcane-shelf-a','shelf',18700,8200,'arcane-lab','shelf-star'),p('arcane-shelf-b','shelf',12200,9900,'arcane-lab','shelf-gothic'),p('arcane-shelf-potion','potion',18700,8200,'arcane-lab',2),
  p('arcane-circle','magic-circle',14300,13700,'arcane-ritual','magic-circle-hex'),p('arcane-ritual-crystal','crystal-device',18200,14200,'arcane-ritual','crystal-device-crescent'),
  p('arcane-lamp','lantern',7400,5850,'arcane-study','lantern-orb'),p('arcane-lab-lamp','lantern',14300,7000,'arcane-lab','lantern-orb'),
  p('arcane-basket','basket',7800,11700,'arcane-study','basket-arcanist'),p('arcane-scroll-bundle','scroll-book',7800,12600,'arcane-study',2),p('arcane-supply','exploration-supply',18400,10100,'arcane-lab',0),p('arcane-scatters','scattered-paper',6300,10500,'arcane-study',0)],
 groups:[{id:'arcane-reading',name:'可拆星仪桌椅',members:['arcane-desk','arcane-chair']},{id:'arcane-experiment',name:'可拆炼金与修理工位',members:['arcane-alchemy','arcane-bench']}],
 attachments:[{hostId:'arcane-desk',heightMm:780,children:[{id:'arcane-desk-book',x:-350,y:0},{id:'arcane-desk-relic',x:350,y:0},{id:'arcane-lamp',x:0,y:450}]},
  {hostId:'arcane-alchemy',heightMm:900,children:[{id:'arcane-alchemy-potion',x:-300,y:0},{id:'arcane-alchemy-potion-b',x:400,y:0}]},
  {hostId:'arcane-bench',heightMm:850,children:[{id:'arcane-tools',x:0,y:0},{id:'arcane-lab-lamp',x:500,y:0}]},{hostId:'arcane-shelf-a',heightMm:1100,children:[{id:'arcane-shelf-potion',x:0,y:0}]}],
 lights:[{id:'arcane-study-glow',x:7400,y:5900,radiusMm:2600,color:'#D7C2E7'},{id:'arcane-lab-glow',x:14300,y:7000,radiusMm:2600,color:'#C7E0DC'},{id:'arcane-circle-glow',x:14300,y:13700,radiusMm:2400,color:'#B7C2E2',intensity:.12}],
 routes:[route('arcane-entry-route',[[8300,17800],[8300,15600],[9200,12000],[9200,10400],[10000,8400],[12200,8700],[16300,8700],[16500,10300],[16500,12400]])]}

const elven:ScenarioSpec={...base('elven-home',29000,26000),wallMaterial:'wood-surface-split-reclaimed',
 grounds:[{id:'elf-garden',name:'林居苔草花园',bounds:[500,500,28000,25000],material:'grass-surface-forest-moss'}],
 rooms:[{id:'elf-living',name:'枝蔓起居及阅读',bounds:[9000,7500,10000,9000],material:'wood-surface-pine-narrow',support:'elf-garden'},
  {id:'elf-bedroom',name:'独立睡房',bounds:[19000,7500,6500,9000],material:'wood-surface-pine-narrow',support:'elf-garden'}],
 openings:[{id:'elf-front',axis:'y',lineMm:16500,atMm:13600,widthMm:1800,kind:'door',entrance:true},{id:'elf-bed-door',axis:'x',lineMm:19000,atMm:12600,widthMm:1600,kind:'door'},{id:'elf-window',axis:'y',lineMm:7500,atMm:13500,widthMm:2000,kind:'window'}],
 paths:[{id:'elf-garden-walk',centerlineMm:[{x:14500,y:24400},{x:14500,y:20000},{x:14500,y:17400}],widthMm:1400,supportRefs:[{kind:'terrainArea',id:'elf-garden'}],material:'earth-surface-forest-humus'}],
 props:[f('elf-table','table',13900,11200,'elf-living','elven'),f('elf-chair-a','chair',13900,12600,'elf-living','elven',180),f('elf-chair-b','chair',13900,9800,'elf-living','elven'),
  p('elf-bookshelf','bookshelf',10400,11100,'elf-living','bookshelf-living-root',90),p('elf-book','scroll-book',13600,11200,'elf-living','scroll-book-leaf'),p('elf-table-lamp','lantern',14300,11200,'elf-living','lantern-leaf-cage'),
  f('elf-bed','bed',22200,10300,'elf-bedroom','elven'),f('elf-cabinet','cabinet',23400,15300,'elf-bedroom','elven'),p('elf-screen','screen',20700,15000,'elf-bedroom','screen-root'),
  p('elf-basket','basket',17600,14800,'elf-living','basket-elven-leaf'),p('elf-chest','chest',24700,13300,'elf-bedroom','chest-leaf-coffer',90),
  n('elf-birch','tree',3800,4300,'elf-garden','tree-birch'),n('elf-larch','tree',12600,3600,'elf-garden','tree-larch'),n('elf-pear','tree',23100,3800,'elf-garden','tree-pear'),n('elf-cypress','tree',5200,21300,'elf-garden','tree-cypress'),n('elf-beech','tree',23200,21600,'elf-garden','tree-beech'),
  n('elf-holly','shrub',3700,12000,'elf-garden','shrub-holly'),n('elf-broom','shrub',7200,16500,'elf-garden','shrub-broom'),n('elf-rosemary','shrub',27400,12100,'elf-garden','shrub-rosemary'),
  n('elf-flower-a','flower-clump',10100,19200,'elf-garden','flower-clump-cowslip'),n('elf-flower-b','flower-clump',12000,20400,'elf-garden','flower-clump-yarrow'),n('elf-flower-c','flower-clump',17800,18500,'elf-garden','flower-clump-iris'),
  p('elf-garden-basket','basket',17900,20500,'elf-garden','basket-fey-petal'),p('elf-garden-lantern','lantern',12100,17500,'elf-garden','lantern-seedpod'),
  n('elf-grass','grass-clump',7000,6500,'elf-garden','grass-clump-fescue'),n('elf-ferns','fern-clump',4000,16200,'elf-garden','fern-clump-bracken'),p('elf-brazier','brazier',17400,9200,'elf-living','brazier-leaf')],
 groups:[{id:'elf-dining',name:'可拆枝蔓餐桌椅',members:['elf-table','elf-chair-a','elf-chair-b']},{id:'elf-bedroom-set',name:'可拆叶舟床与藤木柜',members:['elf-bed','elf-cabinet']}],
 attachments:[{hostId:'elf-table',heightMm:740,children:[{id:'elf-book',x:-300,y:0},{id:'elf-table-lamp',x:400,y:0}]}],
 lights:[{id:'elf-reading-glow',x:14300,y:11200,radiusMm:2800,color:'#C9DBAA'},{id:'elf-path-glow',x:12100,y:17500,radiusMm:2300,color:'#D9D3AA'}],
 routes:[route('elf-home-walk',[[14500,24200],[14500,19900],[14500,17400],[14500,14500],[17200,13600],[21500,13400],[23100,13400]])]}

const mine:ScenarioSpec={...base('dwarven-mine',28000,22000),
 grounds:[{id:'mine-bedrock',name:'矿坑岩盘',bounds:[500,500,27000,21000],material:'sand-surface-black-volcanic'}],
 rooms:[{id:'mine-work',name:'矿石分拣与锻修洞厅',bounds:[2000,2500,14500,16000],thicknessMm:500,material:'earth-surface-packed-yard',support:'mine-bedrock'},
  {id:'mine-gallery',name:'有实体岩壁的采掘支洞',bounds:[16500,2500,9500,10000],thicknessMm:500,material:'stone-surface-slate-cleavage',support:'mine-bedrock'}],
 openings:[{id:'mine-front',axis:'y',lineMm:18500,atMm:10800,widthMm:2400,kind:'door',entrance:true},{id:'mine-gallery-mouth',axis:'x',lineMm:16500,atMm:9100,widthMm:2400,kind:'door'}],
 paths:[{id:'mine-cart-run',centerlineMm:[{x:12000,y:19900},{x:12000,y:16000},{x:12000,y:10200},{x:22800,y:10200}],widthMm:1600,supportRefs:[{kind:'terrainArea',id:'mine-bedrock'}],material:'earth-surface-trodden-loam'}],
 props:[p('mine-forge','forge',4400,4800,'mine-work','forge-fantasy-hex'),p('mine-anvil','anvil',4700,7800,'mine-work','anvil-fantasy-hex'),p('mine-bench','workbench',8500,4900,'mine-work','workbench-fantasy-dwarf'),
  p('mine-tools','craft-tool',8200,4900,'mine-work',0),p('mine-tools-b','craft-tool',8900,4900,'mine-work',1),p('mine-bench-lantern','lantern',8500,5400,'mine-work','lantern-dwarf'),
  p('mine-column-a','column',14600,4800,'mine-work','column-basalt'),p('mine-column-b','column',14600,15400,'mine-work','column-metal-stone'),
  p('mine-hoist','loading-rig',20700,5600,'mine-gallery','loading-rig-fantasy-chainhoist'),n('mine-vein','rock',24600,9700,'mine-gallery','rock-quartz-outcrop'),
  p('mine-cart','handcart',8400,14000,'mine-work','handcart-fantasy-ore'),p('mine-cart-b','handcart',14800,12500,'mine-work','handcart-fantasy-relic'),
  p('mine-railing','railing',20100,11600,'mine-gallery','railing-slab'),n('mine-rock-a','rock',4700,11100,'mine-work','rock-slate'),n('mine-rock-b','rock',4400,16000,'mine-work','rock-rounded-granite'),
  p('mine-chest-a','chest',8200,7800,'mine-work','chest-hex-vault'),p('mine-chest-b','chest',10000,7800,'mine-work','chest-buttress'),
  p('mine-barrel','barrel',6500,17000,'mine-work','barrel-stone-vat'),p('mine-basket','basket',9200,17000,'mine-work','basket-dwarven-wire'),
  p('mine-rubble','rubble',24000,4000,'mine-gallery','rubble-mortar'),p('mine-rubble-b','rubble',18600,8500,'mine-gallery','rubble-splinters'),p('mine-soot','soot',4500,5300,'mine-work','soot-spark-scatter'),
  p('mine-lamp-gallery','lantern',22900,8200,'mine-gallery','lantern-dwarf'),p('mine-lamp-entry','lantern',14600,17600,'mine-work','lantern-dwarf'),
  p('mine-sack','sack',10400,14600,'mine-work',1),p('mine-supply','exploration-supply',10100,16300,'mine-work',0),p('mine-kit','camp-kit',10300,13100,'mine-work',1)],
 groups:[{id:'mine-hot-work',name:'可拆锻修炉砧',members:['mine-forge','mine-anvil']},{id:'mine-ore-stock',name:'可拆矿石运送与分拣',members:['mine-cart','mine-basket','mine-barrel']}],
 attachments:[{hostId:'mine-bench',heightMm:900,children:[{id:'mine-tools',x:-300,y:0},{id:'mine-tools-b',x:400,y:0},{id:'mine-bench-lantern',x:0,y:500}]}],
 lights:[{id:'mine-forge-glow',x:4400,y:4800,radiusMm:3000,intensity:.18},{id:'mine-gallery-glow',x:22900,y:8200,radiusMm:2900},{id:'mine-entry-glow',x:14600,y:17600,radiusMm:2500}],
 routes:[route('mine-ore-route',[[12000,20000],[12000,16500],[12000,10200],[17400,10200],[21800,10200]])],
 notes:[{id:'mine-support-note',x:20200,y:14500,text:'支洞有连续真实岩壁及2.4米开口。栏杆为平层工作区隔离，不授予高差通行；起重机、矿车和矿石均为可编辑独立静态物件。'}]}

/** Tighten the authored architecture and circulation while every fixed item retains its full
 * source size. Attachment offsets remain physical millimetres and are reapplied to each host. */
function compact(spec:ScenarioSpec,factor:number):ScenarioSpec{
 const mm=(value:number)=>Math.round(value*factor),point=(p:{x:number;y:number})=>({x:mm(p.x),y:mm(p.y)}),rect=(bounds:readonly [number,number,number,number])=>bounds.map(mm) as [number,number,number,number]
 const props=spec.props.map(prop=>({...prop,x:mm(prop.x),y:mm(prop.y)}))
 for(const attachment of spec.attachments??[]){const host=props.find(prop=>prop.id===attachment.hostId)!,r=(host.rotation??0)*Math.PI/180
  for(const child of attachment.children){const prop=props.find(prop=>prop.id===child.id)!;prop.x=Math.round(host.x+child.x*Math.cos(r)-child.y*Math.sin(r));prop.y=Math.round(host.y+child.x*Math.sin(r)+child.y*Math.cos(r))}}
 return {...spec,widthMm:mm(spec.widthMm),heightMm:mm(spec.heightMm),props,
  grounds:spec.grounds?.map(ground=>({...ground,bounds:rect(ground.bounds),boundary:ground.boundary?.map(point)})),
  rooms:spec.rooms.map(room=>({...room,bounds:rect(room.bounds)})),openings:spec.openings.map(opening=>{const widthMm=Math.max(opening.kind==='door'?(opening.entrance?1600:1400):1200,mm(opening.widthMm));return{...opening,lineMm:mm(opening.lineMm),atMm:Math.round(mm(opening.atMm+opening.widthMm/2)-widthMm/2),widthMm}}),
  paths:spec.paths?.map(path=>({...path,centerlineMm:path.centerlineMm.map(point)})),lights:spec.lights?.map(light=>({...light,x:mm(light.x),y:mm(light.y)})),notes:spec.notes?.map(note=>({...note,x:mm(note.x),y:mm(note.y)})),
  routes:spec.routes?.map(route=>({...route,from:route.from.type==='point'?{...route.from,positionMm:point(route.from.positionMm)}:route.from,to:route.to.type==='point'?{...route.to,positionMm:point(route.to.positionMm)}:route.to,routeHintMm:route.routeHintMm?.map(point)}))}
}

/** Eight authored fantasy uses; independently positioned at the immutable source dimensions. */
export const FANTASY_SCENARIO_SPECS:readonly ScenarioSpec[]=freezeJson([compact(woodland,.9),compact(outpost,.7),compact(cavern,.75),compact(prison,.8),compact(tomb,.75),compact(arcane,.75),compact(elven,.8),compact(mine,.8)])
function spec(id:string){const found=FANTASY_SCENARIO_SPECS.find(row=>row.id===id);if(!found)throw new Error(`未知西幻用途场景：${id}`);return found}
export function createSceneCollectionFantasyScenarioDocument(id:string,options:{sceneId?:string;now?:string}={}){return createSceneCollectionScenarioDocument(spec(id),options)}
export function createSceneCollectionFantasyScenarioProject(id:string,signal?:AbortSignal){return materializeSceneCollectionScenario(spec(id),signal)}
