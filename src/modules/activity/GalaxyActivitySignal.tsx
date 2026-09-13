import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import type { ActivityPost } from '../../product/contracts'
import { useI18n } from '../../product/i18n'
import { activityHeadline } from './ecosystemPresentation'

interface GalaxyActivitySignalProps {
  activity: ActivityPost
  radius: number
  showLabel?: boolean
  onSelect: () => void
  canClose?: boolean
  onClose?: () => void
}

export function GalaxyActivitySignal({ activity, radius, showLabel = true, onSelect, canClose = false, onClose }: GalaxyActivitySignalProps) {
  const { t } = useI18n()
  const pulseRef = useRef<THREE.Group>(null)
  const effect = activity.ecosystemEffect

  useFrame((state) => {
    if (!pulseRef.current) return
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.4 + effect.seed) * 0.045
    pulseRef.current.scale.setScalar(pulse)
    pulseRef.current.rotation.y += 0.0025
  })

  const beamHeight = radius * (5.2 + effect.signalStrength * 3.2)

  return (
    <group userData={{ activityId: activity.id, signalStrength: effect.signalStrength }}>
      <group ref={pulseRef}>
        <mesh position={[0, radius + beamHeight * 0.5, 0]}>
          <cylinderGeometry args={[radius * 0.018, radius * 0.018, beamHeight, 20, 1, true]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.96}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, radius + beamHeight * 0.5, 0]}>
          <cylinderGeometry args={[radius * 0.045, radius * 0.045, beamHeight, 24, 1, true]} />
          <meshBasicMaterial
            color="#a7e7ff"
            transparent
            opacity={0.32 + effect.signalStrength * 0.1}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, radius + beamHeight * 0.5, 0]}>
          <cylinderGeometry args={[radius * 0.11, radius * 0.11, beamHeight, 24, 1, true]} />
          <meshBasicMaterial
            color="#4f9dff"
            transparent
            opacity={0.055 + effect.signalStrength * 0.035}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, radius * 1.02, 0]} scale={[1, 0.18, 1]}>
          <sphereGeometry args={[radius * 0.42, 32, 20]} />
          <meshBasicMaterial
            color={effect.primaryColor}
            transparent
            opacity={0.32}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh scale={1.24}>
          <sphereGeometry args={[radius, 48, 32]} />
          <meshBasicMaterial
            color={effect.primaryColor}
            transparent
            opacity={0.075 + effect.signalStrength * 0.08}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, radius * 1.02, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[radius * 1.38, radius * 0.025, 12, 128]} />
          <meshBasicMaterial
            color={effect.secondaryColor}
            transparent
            opacity={0.46}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, radius * 1.04, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[radius * 0.72, radius * 0.045, 12, 96]} />
          <meshBasicMaterial
            color={effect.primaryColor}
            transparent
            opacity={0.62}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
      <pointLight
        color={effect.primaryColor}
        intensity={1.4 + effect.signalStrength * 2.2}
        distance={radius * 5}
      />
      {(showLabel || canClose) && <Html
        position={[0, radius + beamHeight * 0.76, 0]}
        center
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'auto' }}
      >
        <div style={{ display: 'grid', justifyItems: 'center', gap: 5 }}>
        {showLabel && (
        <button
          type="button"
          onClick={onSelect}
          style={{
            minWidth: 118,
            padding: '5px 8px',
            border: `1px solid ${effect.primaryColor}66`,
            borderRadius: 999,
            background: 'rgba(10, 14, 42, .82)',
            boxShadow: `0 0 24px ${effect.primaryColor}38`,
            color: effect.primaryColor,
            fontSize: 8,
            letterSpacing: '.12em',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {t('galaxy.newEcology')} · {activity.eventName || activity.tags?.[0] || activityHeadline(activity, t)}
        </button>
        )}
        {canClose && onClose && (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            style={{
              padding: '4px 9px',
              border: '1px solid rgba(207,240,255,.28)',
              borderRadius: 999,
              background: 'rgba(8,15,33,.72)',
              color: 'rgba(225,248,255,.8)',
              fontSize: 8,
              letterSpacing: '.08em',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            × {t('broadcast.close')}
          </button>
        )}
        </div>
      </Html>}
    </group>
  )
}
