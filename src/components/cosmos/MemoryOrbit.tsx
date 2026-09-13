import { useMemo } from 'react'
import type { Person } from '../../types/person'
import { useSceneStore } from '../../store/useSceneStore'
import { useMemoriesForPerson } from '../../hooks/useMemoriesForPerson'
import { getPersonWorldPosition, getPlanetRadius, hashSeed } from '../../utils/relationshipVisuals'
import { MemoryNode } from './MemoryNode'

interface MemoryOrbitProps {
  person: Person
  maxMemoryCount: number
}

const ORBIT_RADIUS_PADDING = 1.05

export function MemoryOrbit({ person, maxMemoryCount }: MemoryOrbitProps) {
  const mode = useSceneStore((state) => state.mode)
  const visible = mode === 'memories'

  const memories = useMemoriesForPerson(person.id)
  const personPosition = useMemo(() => getPersonWorldPosition(person), [person])
  const planetRadius = useMemo(
    () => getPlanetRadius(person.memoryCount, maxMemoryCount),
    [person.memoryCount, maxMemoryCount],
  )
  const orbitRadius = planetRadius + ORBIT_RADIUS_PADDING

  const layout = useMemo(() => {
    const angleStep = (Math.PI * 2) / Math.max(memories.length, 1)
    return memories.map((memory, index) => {
      const seed = hashSeed(memory.id)
      return {
        memory,
        angle: index * angleStep + seed * 0.4,
        elevation: (seed - 0.5) * 0.7,
      }
    })
  }, [memories])

  if (memories.length === 0) return null

  return (
    <group position={personPosition}>
      {layout.map(({ memory, angle, elevation }) => (
        <MemoryNode
          key={memory.id}
          memory={memory}
          angle={angle}
          elevation={elevation}
          orbitRadius={orbitRadius}
          visible={visible}
        />
      ))}
    </group>
  )
}
