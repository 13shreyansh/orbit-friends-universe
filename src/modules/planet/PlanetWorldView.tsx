import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import type { ActivityPost, SocialPlanet } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { PlanetEcosystem } from '../activity/PlanetEcosystem'
import { PlanetRenderer } from './PlanetRenderer'
import { authoredWorldLibrary } from './authoredWorldLibrary'
import { resolvePlanetVisual } from './planetVisualResolver'

interface PlanetWorldViewProps {
  planet: SocialPlanet
  activities: ActivityPost[]
  onSelectActivity: (activity: ActivityPost) => void
  onCloseBroadcast: (activityId: string) => void
  showLabel?: boolean
}

export function PlanetWorldView({ planet, activities, onSelectActivity, onCloseBroadcast, showLabel = true }: PlanetWorldViewProps) {
  const { t } = useI18n()
  const ecologyMaturity = 1 - Math.exp(-activities.length / 8)
  const visibleActivities = activities.slice(0, 16)
  const visual = useMemo(() => resolvePlanetVisual(planet), [planet])
  const ecologySurface = useMemo(() => authoredWorldLibrary.resolveEcologySurface(visual), [visual])
  const ecologyRadius = visual.radius * 1.38 * ecologySurface.radiusScale
  const closableActivityId = visibleActivities
    .filter((activity) => activity.broadcast.active && activity.broadcast.visible && activity.broadcast.canClose)
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0]?.id
  return (
    <group>
      <PlanetRenderer config={visual} scale={1.38} ecologyMaturity={ecologyMaturity} />
      {visibleActivities.map((activity, layerIndex) => (
        <PlanetEcosystem
          key={activity.id}
          activity={activity}
          radius={ecologyRadius}
          surface={ecologySurface}
          layerIndex={layerIndex}
          onSelect={onSelectActivity}
          canClose={activity.id === closableActivityId}
          onClose={() => onCloseBroadcast(activity.id)}
        />
      ))}
      {showLabel && <Html
        position={[0, -1.48, 0]}
        center
        zIndexRange={[4, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            minWidth: 260,
            textAlign: 'center',
            color: 'rgba(255,255,255,.92)',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ fontSize: 9, letterSpacing: '0.14em', color: 'rgba(136,211,248,.6)' }}>
            {planet.isSelf ? t('planet.yourPlanet') : planet.ownerName.toUpperCase()}
          </div>
          <strong style={{ display: 'block', marginTop: 6, fontSize: 15, fontWeight: 550 }}>
            {planet.identity.name}
          </strong>
          <span style={{ display: 'block', marginTop: 4, fontSize: 9, color: 'rgba(255,255,255,.45)' }}>
            {planet.identity.motto}
          </span>
        </div>
      </Html>}
    </group>
  )
}
