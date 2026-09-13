import { MemoryMedia } from './MemoryMedia'
import type { MemoryPage } from '../types'
import styles from '../MemoryBook.module.css'

interface PageContentProps {
  page: MemoryPage | null
  activeVideo: boolean
}

function formatDate(value?: number) {
  if (!value) return null
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(value)
}

function friendArchiveName(value?: string) {
  if (!value) return 'YOU × SOMEONE'
  const friendName = value.trim()
  return `YOU  ×  ${friendName.toUpperCase()}`
}

export function PageContent({ page, activeVideo }: PageContentProps) {
  if (!page) {
    return <div className={`${styles.pageContent} ${styles.blank}`}><i aria-hidden="true" /></div>
  }

  const date = formatDate(page.createdAt)

  return (
    <article className={`${styles.pageContent} ${styles[page.type]}`}>
      {page.type === 'cover' && (
        <div className={styles.coverContent}>
          <div className={styles.constellation} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <span />
            <span />
            <span />
          </div>
          <span>THE STORY WE SHARE</span>
          <strong>{page.title}</strong>
          <p>{page.id.startsWith('friends-') ? page.text : friendArchiveName(page.text)}</p>
          <small>A little universe of the life we share</small>
          <b aria-hidden="true" />
        </div>
      )}

      {(page.type === 'photo' || page.type === 'video') && (
        <>
          <header><span>{page.type === 'photo' ? 'PHOTOGRAPH' : 'MOVING MEMORY'}</span><strong>{page.title}</strong></header>
          <MemoryMedia page={page} active={activeVideo} />
          {date && <time>{date}</time>}
        </>
      )}

      {page.type === 'text' && (
        <>
          <header><span>ORBITAL NOTE</span><strong>{page.title}</strong></header>
          <p className={styles.storyText}>{page.text}</p>
          <footer>
            {date ? <time>{date}</time> : <span>Our orbit keeps growing</span>}
            <i aria-hidden="true" />
          </footer>
        </>
      )}
    </article>
  )
}
