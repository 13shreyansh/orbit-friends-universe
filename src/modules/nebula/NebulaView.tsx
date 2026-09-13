import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ActivityPost, NebulaMember, NebulaSpace, SpatialNodeState } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { isBroadcastVisible, latestActivitiesByPlanet } from '../activity/activitySelectors'
import { GalaxyActivitySignal } from '../activity/GalaxyActivitySignal'
import { PlanetRenderer } from '../planet/PlanetRenderer'
import { resolvePlanetVisual } from '../planet/planetVisualResolver'
import { useProgressiveReveal } from '../universe/useProgressiveReveal'

interface NebulaViewProps {
  space: NebulaSpace
  selectedPlanetId: string | null
  showLabels?: boolean
  onSelectPlanet: (planetId: string) => void
  onSelectActivity: (activity: ActivityPost) => void
  onCloseBroadcast: (activityId: string) => void
}

interface InstancedPlanetsProps {
  members: NebulaMember[]
  nodes: Map<string, SpatialNodeState>
  onSelectPlanet: (planetId: string) => void
}

const MAX_DETAILED_PLANETS = 32

function positionOf(node: SpatialNodeState | undefined): [number, number, number] {
  return node ? [node.position.x, node.position.y, node.position.z] : [0, 0, 0]
}

function NebulaInstancedPlanets({ members, nodes, onSelectPlanet }: InstancedPlanetsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    members.forEach((member, index) => {
      const node = nodes.get(member.planet.id)
      if (!node) return
      dummy.position.set(node.position.x, node.position.y, node.position.z)
      const visualScale = THREE.MathUtils.clamp(0.42 + member.planet.visual.radius * 0.18, 0.46, 0.78)
      dummy.scale.setScalar(visualScale)
      dummy.rotation.set(0, (member.planet.visual.seed % 628) / 100, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      mesh.setColorAt(index, new THREE.Color(member.planet.visual.palette.surface))
    })
    mesh.count = members.length
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [dummy, members, nodes])

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.002
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.instanceId === undefined) return
    event.stopPropagation()
    const member = members[event.instanceId]
    if (member) onSelectPlanet(member.planet.id)
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, members.length)]}
      frustumCulled
      onClick={handleClick}
      onPointerOver={() => { document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = '' }}
    >
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial vertexColors roughness={0.78} metalness={0.06} emissive="#152337" emissiveIntensity={0.16} />
    </instancedMesh>
  )
}

export function NebulaView({
  space,
  selectedPlanetId,
  showLabels = true,
  onSelectPlanet,
  onSelectActivity,
  onCloseBroadcast,
}: NebulaViewProps) {
  const { t } = useI18n()
  const orderedMembers = useMemo(
    () => [...space.members].sort((left, right) => Number(right.planet.isSelf) - Number(left.planet.isSelf) || left.distance - right.distance),
    [space.members],
  )
  const visibleCount = useProgressiveReveal(orderedMembers.length, `${space.nebula.id}:${space.graph.version}`, 6, 150)
  const visibleMembers = orderedMembers.slice(0, visibleCount)
  const visiblePlanetIds = useMemo(() => new Set(visibleMembers.map((member) => member.planet.id)), [visibleMembers])
  const nodes = useMemo(
    () => new Map(space.snapshot.nodes.map((node) => [node.planetId, node])),
    [space.snapshot.nodes],
  )
  const activities = useMemo(() => {
    const latest = latestActivitiesByPlanet(space.activities)
    return new Map([...latest].filter(([, activity]) => isBroadcastVisible(activity)))
  }, [space.activities])
  const detailedPlanetIds = useMemo(() => {
    const prioritized = [...visibleMembers]
      .sort((left, right) => {
        const leftPriority = left.planet.isSelf || left.planet.id === selectedPlanetId || activities.has(left.planet.id) ? 0 : 1
        const rightPriority = right.planet.isSelf || right.planet.id === selectedPlanetId || activities.has(right.planet.id) ? 0 : 1
        return leftPriority - rightPriority || left.distance - right.distance
      })
      .slice(0, MAX_DETAILED_PLANETS)
    return new Set(prioritized.map((member) => member.planet.id))
  }, [activities, selectedPlanetId, visibleMembers])
  const detailedMembers = useMemo(
    () => visibleMembers.filter((member) => detailedPlanetIds.has(member.planet.id)),
    [detailedPlanetIds, visibleMembers],
  )
  const instancedMembers = useMemo(
    () => visibleMembers.filter((member) => !detailedPlanetIds.has(member.planet.id)),
    [detailedPlanetIds, visibleMembers],
  )
  const labeledPlanetIds = useMemo(() => {
    const ordered = [...visibleMembers].sort((left, right) => left.distance - right.distance)
    const lastIndex = Math.max(0, ordered.length - 1)
    const sampleIndexes = [0, 0.08, 0.2, 0.36, 0.52, 0.68, 0.84, 1]
      .map((position) => Math.round(lastIndex * position))
    const ids = new Set(sampleIndexes.map((index) => ordered[index]?.planet.id).filter(Boolean))
    if (selectedPlanetId) ids.add(selectedPlanetId)
    return ids
  }, [selectedPlanetId, visibleMembers])
  const signalMembers = useMemo(
    () => visibleMembers.filter((member) => activities.has(member.planet.id)).slice(0, 24),
    [activities, visibleMembers],
  )
  const linePositions = useMemo(() => {
    const focusIds = new Set([
      space.snapshot.centerPlanetId,
      selectedPlanetId,
    ].filter((planetId): planetId is string => Boolean(planetId)))
    const visibleEdges = space.snapshot.edges
      .filter((edge) => visiblePlanetIds.has(edge.sourcePlanetId) && visiblePlanetIds.has(edge.targetPlanetId))
      .sort((left, right) => {
        const leftFocused = Number(focusIds.has(left.sourcePlanetId) || focusIds.has(left.targetPlanetId))
        const rightFocused = Number(focusIds.has(right.sourcePlanetId) || focusIds.has(right.targetPlanetId))
        return rightFocused - leftFocused || right.strength - left.strength
      })
      .slice(0, 60)
    const values: number[] = []
    visibleEdges.forEach((edge) => {
      const source = nodes.get(edge.sourcePlanetId)
      const target = nodes.get(edge.targetPlanetId)
      if (!source || !target) return
      values.push(
        source.position.x, source.position.y, source.position.z,
        target.position.x, target.position.y, target.position.z,
      )
    })
    return new Float32Array(values)
  }, [nodes, selectedPlanetId, space.snapshot.centerPlanetId, space.snapshot.edges, visiblePlanetIds])

  return (
    <group>
      {linePositions.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#78cfc9" transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineSegments>
      )}

      <NebulaInstancedPlanets members={instancedMembers} nodes={nodes} onSelectPlanet={onSelectPlanet} />

      {detailedMembers.map((member) => {
        const node = nodes.get(member.planet.id)
        if (!node) return null
        const visual = resolvePlanetVisual(member.planet)
        const selected = member.planet.id === selectedPlanetId
        const labelVisible = showLabels && (labeledPlanetIds.has(member.planet.id) || selected)
        return (
          <group key={member.userId} position={positionOf(node)}>
            <PlanetRenderer
              config={visual}
              ecologyMaturity={space.activities.filter((activity) => activity.planetId === member.planet.id).length / 10}
              scale={member.planet.isSelf ? 0.88 : 0.62}
              selected={selected}
              onClick={() => onSelectPlanet(member.planet.id)}
            />
            {labelVisible && (
              <Html position={[0, visual.radius * (member.planet.isSelf ? 1.22 : 0.92), 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'auto' }}>
                <button
                  type="button"
                  onClick={() => onSelectPlanet(member.planet.id)}
                  style={{
                    padding: '4px 7px',
                    border: `1px solid ${member.status === 'broadcasting' ? 'rgba(118,230,213,.5)' : 'rgba(255,255,255,.13)'}`,
                    borderRadius: 5,
                    background: 'rgba(7,12,31,.76)',
                    color: 'rgba(236,249,255,.84)',
                    fontSize: 9,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  {member.planet.isSelf ? t('common.you') : member.planet.ownerName}
                </button>
              </Html>
            )}
          </group>
        )
      })}

      {signalMembers.map((member) => {
        const node = nodes.get(member.planet.id)
        const activity = activities.get(member.planet.id)
        if (!node || !activity) return null
        return (
          <group key={`signal-${activity.id}`} position={positionOf(node)}>
            <GalaxyActivitySignal
              activity={activity}
              radius={Math.max(0.7, member.planet.visual.radius * 0.62)}
              showLabel={showLabels && signalMembers.indexOf(member) < 8}
              canClose={activity.broadcast.canClose}
              onClose={() => onCloseBroadcast(activity.id)}
              onSelect={() => onSelectActivity(activity)}
            />
          </group>
        )
      })}
    </group>
  )
}
