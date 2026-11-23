import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, BookOpen, ChevronDown, ExternalLink, Layers3 } from 'lucide-react'
import { firstMap } from './first-map'
import { scene } from './scene'
import { building } from './building'
import { generation } from './generation'
import { terrain } from './terrain'
import { assets } from './assets'
import { images } from './images'
import { atmosphere } from './atmosphere'
import { delivery } from './delivery'
import { aiTools } from './ai'
import { OpenTutorialSample, tutorialImage } from './lesson'
import type { HomeShowcaseKind } from '../platform/browser/content/home-showcase'
import { tutorialHref } from './location'
import './tutorial.css'

const chapters = [firstMap, scene, building, generation, terrain, assets, images, atmosphere, delivery, aiTools]
const getHash = () => window.location.hash

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export default function TutorialPage({ onOpenSample }: { onOpenSample: (id: HomeShowcaseKind) => void }) {
  const hash = useSyncExternalStore(subscribeToHash, getHash)
  const [, chapterId, sectionId] = hash.split('/')
  const chapter = chapters.find(item => item.id === chapterId) ?? firstMap
  const section = chapter.sections.find(item => item.id === sectionId)
  const worksThrough = chapter === firstMap
  const [showChapters, setShowChapters] = useState(false)
  const chapterIndex = chapters.indexOf(chapter)
  const previous = chapters[chapterIndex - 1]
  const next = chapters[chapterIndex + 1]
  const outline = <><p>本章内容</p><ol>{chapter.sections.map(item => <li key={item.id}><a href={tutorialHref(chapter.id, item.id)} aria-current={item === section ? 'location' : undefined}>{item.title}</a></li>)}</ol></>

  useEffect(() => {
    const originalTitle = document.title
    document.title = `${chapter.label} · 织境使用教程`
    return () => { document.title = originalTitle }
  }, [chapter.label])

  useEffect(() => {
    // A pasted lesson link can arrive before the lazily loaded article exists.
    const id = section ? tutorialHref(chapter.id, section.id).slice(1) : 'tutorial-title'
    const heading = document.getElementById(id)
    heading?.focus({ preventScroll: true })
    if (section) heading?.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, 0)
  }, [chapter, section])

  return <OpenTutorialSample.Provider value={onOpenSample}><div className="tutorial-page">
    <header className="tutorial-header">
      <div className="tutorial-header-inner">
        <a href="#home" className="tutorial-brand" aria-label="织境首页"><Layers3 size={24} aria-hidden="true"/><span>织境 <small>Sceneweave</small></span></a>
        <a className="tutorial-open" href="#home" target="_blank" rel="noopener" aria-label="打开织境（新标签页）">打开织境<ExternalLink size={15} aria-hidden="true"/></a>
      </div>
    </header>

    <div className="tutorial-layout">
      <aside className="tutorial-sidebar">
        <button type="button" className="tutorial-chapter-toggle" aria-expanded={showChapters} aria-controls="tutorial-chapters" onClick={() => setShowChapters(!showChapters)}>
          <BookOpen size={17} aria-hidden="true"/>章节目录<ChevronDown size={16} aria-hidden="true"/>
        </button>
        <nav id="tutorial-chapters" className="tutorial-chapters" data-open={showChapters} aria-label="教程章节">
          <p className="tutorial-nav-heading">从零做一张地图</p>
          <a href={tutorialHref(firstMap.id)} aria-current={worksThrough ? 'page' : undefined} onClick={() => setShowChapters(false)}>{firstMap.label}</a>
          <p className="tutorial-nav-heading">按模块查用法</p>
          {chapters.slice(1).map(item => <a key={item.id} href={tutorialHref(item.id)} aria-current={item === chapter ? 'page' : undefined} onClick={() => setShowChapters(false)}>{item.label}</a>)}
        </nav>
      </aside>

      <main className="tutorial-article" aria-labelledby="tutorial-title">
        <header className="tutorial-article-header">
          <h1 id="tutorial-title" tabIndex={-1}>{chapter.title}</h1>
          <p>{chapter.description}</p>
          {worksThrough && <a className="tutorial-start-button" href={tutorialHref(chapter.id, chapter.sections[0].id)}>开始制作 <ArrowDown size={17} aria-hidden="true"/></a>}
        </header>

        {worksThrough && <figure className="tutorial-cover">
          <img src={tutorialImage('inn-player')} width={1200} height={800} alt="完成的林边驿站玩家地图，包含两间相邻的房间和大厅家具" fetchPriority="high"/>
          <figcaption>林边驿站 · 玩家地图</figcaption>
        </figure>}

        <nav className="tutorial-outline tutorial-outline-inline" aria-label="本章内容">{outline}</nav>
        <div className="tutorial-start"><strong>从这里开始</strong><p>{chapter.start}</p></div>

        {chapter.sections.map(item => <section className="tutorial-section" key={`${chapter.id}/${item.id}`} aria-labelledby={tutorialHref(chapter.id, item.id).slice(1)}>
          <h2 id={tutorialHref(chapter.id, item.id).slice(1)} tabIndex={-1}>{item.title}</h2>
          {item.body}
        </section>)}

        {(previous || next) && <nav className="tutorial-pagination" aria-label="继续阅读">
          {previous && <a href={tutorialHref(previous.id)}><ArrowLeft size={17} aria-hidden="true"/><span><small>上一章</small>{previous.label}</span></a>}
          {next && <a href={tutorialHref(next.id)}><span><small>下一章</small>{next.label}</span><ArrowRight size={17} aria-hidden="true"/></a>}
        </nav>}
      </main>

      <aside className="tutorial-outline-side">
        <nav className="tutorial-outline" aria-label="本章内容">{outline}</nav>
      </aside>
    </div>
  </div></OpenTutorialSample.Provider>
}
