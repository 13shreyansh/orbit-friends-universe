import type { MemorySignal, SpatialSnapshot, UniverseScale } from '../../product/contracts'
import type { CosmicBroadcastEvent } from './contracts'
import { GravitationalBroadcast } from './GravitationalBroadcast'
import { MeteorBroadcast } from './MeteorBroadcast'

interface CosmicBroadcastProps {
  event: CosmicBroadcastEvent | null
  selfPlanetId: string
  planetRadius: number
  scale: UniverseScale
  snapshot: SpatialSnapshot
  onSelectActivity: () => void
  onComplete: () => void
  memorySignal?: MemorySignal | null
  onSelectMemorySignal?: () => void
  onMemorySignalComplete?: () => void
}

export function CosmicBroadcast({
  event,
  selfPlanetId,
  planetRadius,
  scale,
  snapshot,
  onSelectActivity,
  onComplete,
  memorySignal = null,
  onSelectMemorySignal,
  onMemorySignalComplete,
}: CosmicBroadcastProps) {
  if (!event && !memorySignal) return null

  if (memorySignal && memorySignal.sourcePlanetId) {
    const sourceNode = snapshot.nodes.find((node) => node.planetId === memorySignal.sourcePlanetId)
    const target: [number, number, number] = scale === 'galaxy' && sourceNode
      ? [sourceNode.position.x, sourceNode.position.y, sourceNode.position.z]
      : [2.4, 1.3, -1.8]
    return (
      <MeteorBroadcast
        key={`memory-signal:${memorySignal.id}`}
        signal={{
          id: memorySignal.id,
          senderName: memorySignal.senderName,
          intensity: 1,
          primaryColor: '#a9eeff',
          secondaryColor: '#d8a4ff',
        }}
        target={target}
        fieldRadius={snapshot.bounds.radius}
        scale={scale}
        onSelect={onSelectMemorySignal ?? (() => undefined)}
        onComplete={onMemorySignalComplete ?? (() => undefined)}
      />
    )
  }

  if (!event) return null

  if (event.perspective === 'publisher') {
    const sourceNode = snapshot.nodes.find((node) => node.planetId === selfPlanetId)
    const source: [number, number, number] = scale === 'galaxy' && sourceNode
      ? [sourceNode.position.x, sourceNode.position.y, sourceNode.position.z]
      : [0, 0, 0]
    return (
      <group key={event.id} position={source}>
        <GravitationalBroadcast
          radius={scale === 'galaxy' ? planetRadius * 0.95 : planetRadius * 1.38}
          intensity={event.activity.ecosystemEffect.signalStrength}
          onComplete={onComplete}
        />
      </group>
    )
  }

  const sourceNode = snapshot.nodes.find((node) => node.planetId === event.activity.planetId)
  const target: [number, number, number] = scale === 'galaxy' && sourceNode
    ? [sourceNode.position.x, sourceNode.position.y, sourceNode.position.z]
    : [2.4, 1.3, -1.8]

  return (
    <MeteorBroadcast
      key={event.id}
      activity={event.activity}
      target={target}
      fieldRadius={snapshot.bounds.radius}
      scale={scale}
      onSelect={onSelectActivity}
      onComplete={onComplete}
    />
  )
}
