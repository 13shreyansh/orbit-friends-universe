import { Html, Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ActivityPost, SocialPlanet, SpatialSnapshot } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { isBroadcastVisible, latestActivitiesByPlanet } from '../activity/activitySelectors'
import { GalaxyActivitySignal } from '../activity/GalaxyActivitySignal'
import { PlanetRenderer } from '../planet/PlanetRenderer'
import { resolvePlanetVisual } from '../planet/planetVisualResolver'
import { useProgressiveReveal } from '../universe/useProgressiveReveal'
import { DemoSun } from '../../demo/DemoSun'

interface GalaxyViewProps {
  selfPlanet: SocialPlanet
  friendPlanets: SocialPlanet[]
  snapshot: SpatialSnapshot
  distanceSnapshot?: SpatialSnapshot
  selectedPlanetId: string | null
  activities: ActivityPost[]
  showLabels?: boolean
  onSelectPlanet: (planetId: string) => void
  onSelectActivity: (activity: ActivityPost) => void
  onCloseBroadcast: (activityId: string) => void
}

function nodePosition(snapshot: SpatialSnapshot, planetId: string): [number, number, number] {
  const node = snapshot.nodes.find((candidate) => candidate.planetId === planetId)
  return node ? [node.position.x, node.position.y, node.position.z] : [0, 0, 0]
}

export function GalaxyView({
  selfPlanet,
  friendPlanets,
  snapshot,
  distanceSnapshot = snapshot,
  selectedPlanetId,
  activities,
  showLabels = true,
  onSelectPlanet,
  onSelectActivity,
  onCloseBroadcast,
}: GalaxyViewProps) {
  const { t } = useI18n()
  const { size } = useThree()
  // Album chapters keep the original mass and positions; enlarge only their rendered surface.
  const isAlbum = selfPlanet.ownerId.startsWith('album-owner-')
  const isFriends = selfPlanet.ownerId.startsWith('friends-')
  const planetDisplayScale = isAlbum ? 1.9 : isFriends ? 0.85 : 0.68
  const fieldScale: [number, number, number] = isFriends ? [1.3, 1, 1.3] : size.width < 700 ? [0.72, 0.86, 0.72] : [1, 1, 1]
  const activityByPlanet = useMemo(() => {
    const latest = latestActivitiesByPlanet(activities)
    return new Map([...latest].filter(([, activity]) => isBroadcastVisible(activity)))
  }, [activities])
  const selfActivity = activityByPlanet.get(selfPlanet.id) ?? null
  const selfPosition = nodePosition(distanceSnapshot, selfPlanet.id)
  const selfVisual = useMemo(() => resolvePlanetVisual(selfPlanet), [selfPlanet])
  const friendVisuals = useMemo(
    () => new Map(friendPlanets.map((planet) => [planet.id, resolvePlanetVisual(planet)])),
    [friendPlanets],
  )
  const orderedFriends = useMemo(() => [...friendPlanets].sort((left, right) => {
    const leftPosition = nodePosition(snapshot, left.id)
    const rightPosition = nodePosition(snapshot, right.id)
    return Math.hypot(...leftPosition) - Math.hypot(...rightPosition)
  }), [friendPlanets, snapshot])
  const visibleCount = useProgressiveReveal(orderedFriends.length, `${selfPlanet.id}:${snapshot.graphVersion}`, 3, 150)
  const visibleFriends = orderedFriends.slice(0, visibleCount)
  const visiblePlanetIds = useMemo(
    () => new Set([selfPlanet.id, ...visibleFriends.map((planet) => planet.id)]),
    [selfPlanet.id, visibleFriends],
  )

  return (
    <group scale={fieldScale}>
      {snapshot.edges.filter((edge) => visiblePlanetIds.has(edge.sourcePlanetId) && visiblePlanetIds.has(edge.targetPlanetId)).map((edge) => {
        const start = nodePosition(snapshot, edge.sourcePlanetId)
        const end = nodePosition(snapshot, edge.targetPlanetId)
        const midpoint = new THREE.Vector3(...start).lerp(new THREE.Vector3(...end), 0.5)
        midpoint.y += Math.max(0.5, new THREE.Vector3(...start).distanceTo(new THREE.Vector3(...end)) * 0.11)
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(...start),
          midpoint,
          new THREE.Vector3(...end),
        )
        return (
          <Line
            key={`${edge.sourcePlanetId}-${edge.targetPlanetId}`}
            points={curve.getPoints(28)}
            color="#f2a27f"
            transparent
            opacity={0.08 + edge.strength * 0.24}
            lineWidth={0.6 + edge.strength * 0.7}
            depthWrite={false}
          />
        )
      })}

      <group position={nodePosition(snapshot, selfPlanet.id)}>
        {selfActivity && (
          <GalaxyActivitySignal
            activity={selfActivity}
            radius={selfVisual.radius * 0.95}
            showLabel={false}
            canClose={selfActivity.broadcast?.canClose}
            onClose={() => onCloseBroadcast(selfActivity.id)}
            onSelect={() => onSelectActivity(selfActivity)}
          />
        )}
        {isFriends ? <DemoSun/> : <PlanetRenderer config={selfVisual} scale={0.95} selected={selectedPlanetId === selfPlanet.id} />}
        {showLabels && <Html position={[0, 1.45, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ color: '#ffe1a9', fontSize: 10, letterSpacing:2, whiteSpace: 'nowrap', textShadow: '0 2px 8px #29143f' }}>{isFriends ? `${selfPlanet.identity.name.toUpperCase()} · YOU` : t('common.you')}</div>
        </Html>}
      </group>

      {visibleFriends.map((planet) => {
        const activity = activityByPlanet.get(planet.id) ?? null
        const visual = friendVisuals.get(planet.id) ?? planet.visual
        const position = nodePosition(distanceSnapshot, planet.id)
        const distance = Math.hypot(position[0] - selfPosition[0], position[1] - selfPosition[1], position[2] - selfPosition[2])
        return (
          <group key={planet.id} position={nodePosition(snapshot, planet.id)}>
            {activity && (
              <GalaxyActivitySignal
                activity={activity}
                radius={visual.radius * 0.68}
                showLabel={showLabels}
                onSelect={() => onSelectActivity(activity)}
              />
            )}
            <PlanetRenderer
              config={visual}
              scale={planetDisplayScale}
              selected={selectedPlanetId === planet.id}
              onClick={() => onSelectPlanet(planet.id)}
            />
            {showLabels && <Html position={[0, visual.radius * (isAlbum ? 2.35 : isFriends ? 1.4 : 0.95), 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'auto' }}>
              <button
                type="button"
                onClick={() => onSelectPlanet(planet.id)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid rgba(255,211,170,.24)',
                  borderRadius: 10,
                  background: 'rgba(20,16,36,.78)',
                  color: 'rgba(255,225,209,.86)',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'block',fontSize:12 }}>{isFriends ? planet.identity.name : planet.ownerName}</span>
                {!isFriends && <span style={{ display: 'block', marginTop: 4, color: 'rgba(255,196,154,.72)', fontSize: 9 }}>{t('galaxy.distance', { distance: distance.toFixed(1) })}</span>}
              </button>
            </Html>}
          </group>
        )
      })}
    </group>
  )
}
