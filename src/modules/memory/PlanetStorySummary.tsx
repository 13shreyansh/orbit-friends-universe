import { BookHeart } from 'lucide-react'
import type { PlanetMemory } from './planetMemory'
import { buildMemoryStory } from './planetMemory'
import styles from './PlanetStorySummary.module.css'

export function PlanetStorySummary({ friendName, memories }: { friendName: string; memories: PlanetMemory[] }) {
  return <section className={styles.story}><header><BookHeart size={14} /><strong>Our story</strong></header><p>{buildMemoryStory(friendName, memories)}</p></section>
}
