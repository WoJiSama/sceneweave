import type { ReactNode } from 'react'
import { tutorialHref } from './location'

export type TutorialChapter = {
  id: string
  label: string
  title: string
  description: string
  start: ReactNode
  sections: { id: string; title: string; body: ReactNode }[]
}

export function LessonLink({ chapter, section, children }: { chapter: string; section?: string; children: ReactNode }) {
  return <a href={tutorialHref(chapter, section)}>{children}</a>
}

export function tutorialImage(file: string) {
  return `${import.meta.env.BASE_URL}assets/tutorial/${file}.webp`
}

export function Figure({ file, width, height, alt, children }: {
  file: string; width: number; height: number; alt: string; children: ReactNode
}) {
  const src = tutorialImage(file)
  return <figure className="tutorial-figure">
    <a href={src} target="_blank" rel="noopener" style={{ width }} aria-label={`在新标签页查看图片：${alt}`}>
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async"/>
    </a>
    <figcaption>{children}</figcaption>
  </figure>
}

export function Check({ children }: { children: ReactNode }) {
  return <div className="tutorial-check"><strong>核对结果</strong><p>{children}</p></div>
}
