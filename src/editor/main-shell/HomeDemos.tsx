import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Box, LayoutGrid, RotateCcw } from 'lucide-react'
import manifest from '../../platform/browser/content/home-showcase-manifest.json'
import { DEFAULT_OBLIQUE_CAMERA } from '../../platform/browser/render/oblique-camera'
import { tutorialHref } from '../../tutorial/location'
import { ArtStyleComparison } from '../native-canvas/ArtStyleComparison'
import { artStyleClip, INITIAL_ART_STYLE_DIVIDER } from '../native-canvas/art-style-divider'
import { useObliqueView } from '../native-canvas/useObliqueView'
import { homeSections } from './location'
import { sceneImage } from './SampleShowcase'
import './home-demos.css'

const tavern = manifest.entries.fantasy, outdoors = manifest.entries.wilderness
type Style = keyof typeof tavern.artStyles
const styleLabels = { original: '原画', handDrawn: '手绘', tea: '茶绘', lineArt: '线稿' } satisfies Record<Style, string>
const styleOptions = Object.keys(styleLabels) as Style[]

function StyleChoice({ label, value, onChange }: { label: string; value: Style; onChange: (value: Style) => void }) {
  return <label className="home-style-choice">{label}
    <select value={value} onChange={event => onChange(event.target.value as Style)}>
      {styleOptions.map(style => <option key={style} value={style}>{styleLabels[style]}</option>)}
    </select>
  </label>
}

function StyleImage({ style, clipPath }: { style: Style; clipPath: string }) {
  const image = tavern.artStyles[style]
  return <img style={{ clipPath }} alt={`${tavern.name} · ${styleLabels[style]}`}
    src={`${import.meta.env.BASE_URL}assets/home-scenes/${image.file}?v=${image.sha256}`} width={image.width} height={image.height}
    loading="lazy" decoding="async" draggable={false}/>
}

export function HomeArtStyleDemo({ onOpen, disabled }: { onOpen: () => void; disabled: boolean }) {
  const [first, setFirst] = useState<Style>('original'), [second, setSecond] = useState<Style>('handDrawn')
  const [divider, setDivider] = useState(INITIAL_ART_STYLE_DIVIDER)
  const stage = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ x: 0, y: 0, width: tavern.artStyles.original.width, height: tavern.artStyles.original.height })
  useLayoutEffect(() => {
    const element = stage.current!
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width && height) setArea({ x: 0, y: 0, width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <section className="home-demo" aria-labelledby={homeSections.artStyle}>
    <div className="home-demo-copy">
      <h2 id={homeSections.artStyle} tabIndex={-1}>拖线对比地图画风</h2>
      <p>给余烬酒馆选两种画风。拖动线身或中点可移动分隔线，按住任一端的圆点绕中点拖动，可旋转 360°。</p>
      <div className="home-demo-links">
        <button type="button" className="secondary" disabled={disabled} onClick={onOpen}>打开酒馆副本<ArrowRight size={16} aria-hidden="true"/></button>
        <a href={tutorialHref('atmosphere', 'art-style-compare')}><BookOpen size={15} aria-hidden="true"/>画风教程</a>
      </div>
    </div>
    <div className="home-demo-panel">
      <div className="home-style-toolbar">
        <StyleChoice label="A 侧画风" value={first} onChange={setFirst}/>
        <StyleChoice label="B 侧画风" value={second} onChange={setSecond}/>
      </div>
      <div className="home-style-stage" ref={stage}>
        <StyleImage style={first} clipPath={artStyleClip(divider, area, area, true)}/>
        <StyleImage style={second} clipPath={artStyleClip(divider, area, area, false)}/>
        <ArtStyleComparison divider={divider} area={area} labels={[`A · ${styleLabels[first]}`, `B · ${styleLabels[second]}`]} onChange={setDivider}/>
      </div>
    </div>
  </section>
}

async function prepareOutdoors(canvas: HTMLCanvasElement, signal: AbortSignal) {
  const [{ readHomeShowcaseArchive }, { prepareObliquePreview }] = await Promise.all([
    import('../../platform/browser/content/home-showcase'), import('../../platform/browser/render/oblique-renderer'),
  ])
  const bundle = await readHomeShowcaseArchive('wilderness', signal)
  return prepareObliquePreview(canvas, bundle, { audience: 'gm', signal })
}

function OutdoorsImage() {
  return <img src={sceneImage('wilderness')} width={outdoors.width} height={outdoors.height}
    alt="溪岸巡林补给站的正俯视地图，显示小屋、树木和跨溪木桥" loading="lazy" draggable={false}/>
}

function OutdoorsPreview({ oblique, activate }: { oblique: boolean; activate: () => void }) {
  const { canvas, camera, setCamera, setZoom, phase, ready, error, handlers } = useObliqueView(prepareOutdoors, {
    enabled: oblique, activate, tiltOnOpen: true, wheelZoom: false,
  })
  const visible = oblique && !error && phase !== 'loading'
  return <>
    <div className="home-orbit-stage" role="group" aria-label="溪岸地图取景" aria-describedby="home-orbit-instructions"
      tabIndex={ready ? -1 : 0} aria-busy={oblique && phase === 'loading' && !error} {...handlers}>
      {!visible && <OutdoorsImage/>}
      {oblique && <canvas ref={canvas} width={1120} height={700} aria-label="可旋转的溪岸地图" aria-hidden={!visible} tabIndex={ready ? 0 : -1}
        data-visible={visible} data-ready={ready}/>}
      {oblique && (error ? <p className="home-orbit-status" role="alert">{error} 可切回正俯视继续浏览。</p>
        : phase === 'loading' && <p className="home-orbit-status" role="status">正在准备 3D 地形和素材…</p>)}
    </div>
    {oblique && <div className="home-camera-controls">
      <label>俯角<input type="range" min={30} max={90} value={Math.round(camera.elevationDeg)} disabled={!ready}
        onChange={event => setCamera(current => ({ ...current, elevationDeg: Number(event.target.value) }))}/></label>
      <label>缩放<input type="range" min={.65} max={4} step={.05} value={camera.zoom} disabled={!ready}
        onChange={event => setZoom(Number(event.target.value))}/></label>
      <button type="button" className="secondary" disabled={!ready} onClick={() => setCamera(DEFAULT_OBLIQUE_CAMERA)}><RotateCcw size={15} aria-hidden="true"/>重置视角</button>
    </div>}
  </>
}

export function HomeObliqueDemo({ onOpen, disabled }: { onOpen: () => void; disabled: boolean }) {
  const [oblique, setOblique] = useState(false)
  return <section className="home-demo" aria-labelledby={homeSections.oblique}>
    <div className="home-demo-copy">
      <h2 id={homeSections.oblique} tabIndex={-1}>从正俯视转到 3D</h2>
      <p id="home-orbit-instructions">按住地图拖动即可进入 3D。左右拖动环绕小屋和木桥，上下拖动改变俯角，松手停在当前视角。也可以用方向键取景。</p>
      <div className="home-demo-links">
        <button type="button" className="secondary" disabled={disabled} onClick={onOpen}>打开溪岸副本<ArrowRight size={16} aria-hidden="true"/></button>
        <a href={tutorialHref('scene', 'oblique')}><BookOpen size={15} aria-hidden="true"/>取景与出图教程</a>
      </div>
    </div>
    <div className="home-demo-panel">
      <div className="home-orbit-toolbar" role="group" aria-label="溪岸地图视角">
        <button type="button" className="secondary" aria-pressed={!oblique} onClick={() => setOblique(false)}><LayoutGrid size={16} aria-hidden="true"/>正俯视</button>
        <button type="button" className="secondary" aria-pressed={oblique} onClick={() => setOblique(true)}><Box size={16} aria-hidden="true"/>3D 斜俯视</button>
      </div>
      <OutdoorsPreview oblique={oblique} activate={() => setOblique(true)}/>
    </div>
  </section>
}
