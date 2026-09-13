import { Html } from '@react-three/drei'
import type { MemoryPage as MemoryPageData, PageDirection } from '../types'
import { PageContent } from './PageContent'
import styles from '../MemoryBook.module.css'

interface MemoryPageProps {
  page: MemoryPageData | null
  side: 'left' | 'right'
  pageWidth: number
  activeVideo: boolean
  turning: PageDirection | null
  compact: boolean
}

export function MemoryPage({ page, side, pageWidth, activeVideo, turning, compact }: MemoryPageProps) {
  const isTurning = (side === 'right' && turning === 'next') || (side === 'left' && turning === 'previous')
  const classNames = [
    styles.pageAnchor,
    compact ? styles.compact : '',
    isTurning ? styles.turningContent : '',
  ].filter(Boolean).join(' ')

  return (
    <Html
      transform
      center
      distanceFactor={compact ? 2.2 : 1.42}
      position={[side === 'left' ? -pageWidth / 2 : pageWidth / 2, 0, 0.07]}
      style={{ pointerEvents: page?.type === 'video' ? 'auto' : 'none' }}
    >
      <div className={classNames} data-page-side={side}>
        <PageContent page={page} activeVideo={activeVideo} />
      </div>
    </Html>
  )
}
