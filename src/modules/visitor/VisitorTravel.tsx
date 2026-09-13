import { useMemo } from 'react'
import type { SpatialNodeState } from '../../product/contracts'
import { CometRide } from '../../components/cosmos/CometRide'
import { spatialNodeVector, type VisitorVehicleConfig } from './visitorRoute'

interface VisitorTravelProps {
  active: boolean
  origin: SpatialNodeState | null
  destination: SpatialNodeState | null
  vehicle: VisitorVehicleConfig
  showCharacterIntro: boolean
  onApproachingArrival: () => void
  onComplete: () => void
}

/** Transportation is intentionally unaware of profiles, friendships and stores. */
export function VisitorTravel({
  active,
  origin,
  destination,
  vehicle,
  showCharacterIntro,
  onApproachingArrival,
  onComplete,
}: VisitorTravelProps) {
  const originVector = useMemo(() => spatialNodeVector(origin), [origin])
  const destinationVector = useMemo(() => spatialNodeVector(destination), [destination])

  return (
    <group userData={{ vehicleType: vehicle.type, passengerName: vehicle.passengerName }}>
      <CometRide
        active={active}
        origin={originVector}
        destination={destinationVector}
        passengerAssetUrl={vehicle.passengerAssetUrl}
        showCharacterIntro={showCharacterIntro}
        onApproachingArrival={onApproachingArrival}
        onArrive={onComplete}
      />
    </group>
  )
}
