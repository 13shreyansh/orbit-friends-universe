import type { ConfirmedMemorySummary } from '../types/memoryObject'

export type ProductPhase = 'auth' | 'onboarding' | 'genesis' | 'arrival' | 'universe'

export type UniverseScale = 'planet' | 'galaxy' | 'nebula'

export type PlanetArchetype = 'terran' | 'oceanic' | 'volcanic' | 'crystalline' | 'verdant'

export type RelationType =
  | 'family'
  | 'friend'
  | 'partner'
  | 'colleague'
  | 'classmate'
  | 'mentor'
  | 'community'
  | 'past'
  | 'other'

export type RelationshipStatus = 'active' | 'dormant' | 'faded'

export interface PlanetPalette {
  deep: string
  surface: string
  highlight: string
  atmosphere: string
}

export interface PlanetVisualConfig {
  version: 1
  generatorVersion?: 'planet-generator.v1'
  generationMode?: 'system' | 'personality' | 'guide' | 'legacy'
  archetype: PlanetArchetype
  seed: number
  radius: number
  terrain: number
  roughness: number
  oceanLevel: number
  cloudDensity: number
  atmosphereStrength: number
  ring: boolean
  ringColor: string
  satellites: number
  palette: PlanetPalette
  backgroundSkinId?: string
  externalAssetUrl?: string
  customShaderId?: string
}

/** Open semantic identifiers supplied by the backend. They are not UI categories. */
export type ActivityKind = string
export type ActivityMediaType = 'image' | 'audio' | 'video'
export type EcosystemKind = string

export interface EcosystemTraits {
  vitality: number
  serenity: number
  intensity: number
  connection: number
  motion: number
  memory: number
  novelty: number
}

export interface ActivityMedia {
  type: ActivityMediaType
  url: string
  mimeType: string
  name: string
  size: number
  durationSeconds?: number | null
}

export interface EcosystemEffect {
  version: 1
  kind: EcosystemKind
  seed: number
  intensity: number
  signalStrength: number
  landmarkCount: number
  primaryColor: string
  secondaryColor: string
  traits: EcosystemTraits
}

export interface ActivityPost {
  id: string
  authorUserId: string
  authorName: string
  planetId: string
  kind: ActivityKind
  title: string
  text: string
  eventName: string
  location: string
  tags: string[]
  visibility: 'friends' | 'public'
  media: ActivityMedia[]
  ecosystemEffect: EcosystemEffect
  publishedAt: string
  analysisStatus?: 'queued' | 'completed' | 'unavailable'
  deliveryStatus?: 'uploading' | 'published' | 'failed'
  broadcast: {
    active: boolean
    visible: boolean
    canClose: boolean
    seenAt?: string | null
  }
}

export interface ActivityDraft {
  title: string
  text: string
  eventName: string
  location: string
  tags: string[]
  visibility: 'friends' | 'public'
}

export interface PlanetIdentity {
  name: string
  motto: string
  description: string
  tags: string[]
  mass: number
  influence: number
}

export interface SocialPlanet {
  id: string
  ownerId: string
  ownerName: string
  identity: PlanetIdentity
  visual: PlanetVisualConfig
  position: [number, number, number]
  relationshipStrength: number
  isSelf?: boolean
}

export interface SpatialVector3 {
  x: number
  y: number
  z: number
}

/** Versioned output of the backend relationship simulation.
 * Rendering consumes this snapshot and never re-derives placement from
 * relationship fields such as intimacy or interaction count. */
export interface SpatialNodeState {
  planetId: string
  position: SpatialVector3
  velocity: SpatialVector3
  gravityVector: SpatialVector3
  mass: number
  relationshipForce: number
  clusterId: string | null
  orbitBand: number
  sphericalPosition?: {
    radius: number
    azimuth: number
    elevation: number
  }
}

export interface SpatialEdgeState {
  sourcePlanetId: string
  targetPlanetId: string
  strength: number
  restLength: number
  flow: number
}

export interface SpatialSnapshot {
  schemaVersion: 1 | 2
  coordinateSystem: 'social-cartesian-v1' | 'social-spherical-v1'
  layoutAlgorithmVersion?: string
  graphVersion?: string
  generatedAt: string
  centerPlanetId: string
  nodes: SpatialNodeState[]
  edges: SpatialEdgeState[]
  bounds: {
    radius: number
    center: SpatialVector3
  }
}

export interface MemorySignal {
  id: string
  memoryId: string
  senderUserId: string
  senderName: string
  recipientUserId: string
  sourcePlanetId: string | null
  targetPlanetId: string | null
  memoryVersion: number
  summary: string
  eventTime: string
  active: boolean
  visible: boolean
  seenAt?: string | null
  createdAt: string
}

export interface SpatialWindowPagination {
  offset: number
  limit: number
  total: number
  nextOffset: number | null
  hasMore: boolean
}

export interface UniverseWindowPayload {
  planets: SocialPlanet[]
  relationships: SocialRelationship[]
  activities: ActivityPost[]
  snapshot: SpatialSnapshot
  pagination: SpatialWindowPagination
}

export interface NebulaSummary {
  id: string
  slug: string
  joinCode: string
  name: string
  description: string
  ownerUserId: string
  memberCount: number
  joined: boolean
  role: 'owner' | 'moderator' | 'member' | null
  theme: Record<string, unknown>
}

export interface NebulaDirectoryPayload {
  joined: NebulaSummary[]
  recommended: NebulaSummary[]
  searchResults: NebulaSummary[]
  catalog: NebulaSummary[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface NebulaMember {
  userId: string
  role: 'owner' | 'moderator' | 'member'
  joinedAt: string
  status: 'broadcasting' | 'active' | 'quiet'
  distance: number
  planet: SocialPlanet
  latestActivityId: string | null
}

export interface NebulaSpace {
  nebula: NebulaSummary
  graph: {
    backend: string
    version: string
    edgeCount: number
  }
  snapshot: SpatialSnapshot
  members: NebulaMember[]
  activities: ActivityPost[]
  pagination: SpatialWindowPagination
}

export interface SpatialSimulationInput {
  centerPlanet: SocialPlanet
  planets: SocialPlanet[]
  previousSnapshot?: SpatialSnapshot
}

export interface UserProfile {
  id: string
  email: string
  emailVerified?: boolean
  displayName: string
  bio: string
  tags: string[]
  planetId: string | null
  /** User-owned 3D character carried by visitor vehicles. */
  avatar3dAssetUrl?: string | null
}

export type EducationLevel =
  | 'primary'
  | 'secondary'
  | 'vocational'
  | 'associate'
  | 'bachelor'
  | 'master'
  | 'doctorate'
  | 'other'

export type PersonalityType =
  | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP'
  | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
  | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ'
  | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP'

export interface ProfilePlace {
  name: string
  countryCode?: string
  latitude?: number
  longitude?: number
}

export interface ProfilePeriod {
  startDate?: string
  endDate?: string
  isCurrent?: boolean
}

export interface ProfileAttribute {
  key: string
  label?: string
  category?: string
  value: string | number | boolean | string[]
  period?: ProfilePeriod
  place?: ProfilePlace
  verification?: 'unverified' | 'self_attested' | 'verified'
  visibility?: 'private' | 'connections' | 'public'
}

export interface ProfileIntakePayload {
  displayName: string
  bio?: string
  birthDate?: string
  birthPlace?: ProfilePlace
  personalityType?: PersonalityType
  residences?: Array<{
    place: ProfilePlace
    period?: ProfilePeriod
  }>
  education?: Array<{
    institution: string
    level: EducationLevel
    fieldOfStudy?: string
    period: ProfilePeriod
    place?: ProfilePlace
  }>
  work?: Array<{
    organization: string
    role: string
    industry?: string
    seniority?: 'intern' | 'individual' | 'lead' | 'manager' | 'executive' | 'founder' | 'other'
    period: ProfilePeriod
    place?: ProfilePlace
    highlights?: string[]
  }>
  projects?: Array<{
    title: string
    kind?: string
    domain?: string
    description?: string
    period?: { startDate?: string; endDate?: string; isCurrent?: boolean }
    collaboratorCount?: number
  }>
  skills?: Array<{ name: string; category?: string; proficiency?: number }>
  interests?: Array<{ name: string; category?: string }>
  achievements?: Array<{ title: string; kind?: string; occurredAt?: string; description?: string }>
  /** Forward-compatible facts. The backend, not the client, owns scoring weights. */
  attributes?: ProfileAttribute[]
}

export interface PlanetScoreResult {
  algorithmVersion: 'mass.v2'
  massScore: number
  physicalMass: number
  visualRadius: number
  confidence: number
  memoryCount: number
  behaviorEventCount: number
  socialBehaviorEventCount: number
  features: ScoreFeature[]
  computedAt: string
}

export interface ScoreFeature {
  name: string
  value: number
  weight: number
  contribution: number
  confidence: number
}

export interface ProfileGraphNode {
  id: string
  kind: string
  label: string
  properties: Record<string, unknown>
}

export interface ProfileGraphEdge {
  id: string
  source: string
  target: string
  type: string
  properties: Record<string, unknown>
}

export interface ProfileGraphDocument {
  graphId: string
  ownerUserId: string
  schemaVersion: 'profile_graph.v1'
  graphVersion: string
  ontology: {
    shape: 'property_graph'
    nodeKinds: string[]
    edgeTypes: string[]
  }
  nodes: ProfileGraphNode[]
  edges: ProfileGraphEdge[]
  metadata: Record<string, unknown>
}

export interface AuthSession {
  userId: string
  token: string
  readOnly?: boolean
}

export interface SocialRelationship {
  id: string
  ownerUserId: string
  targetUserId: string
  targetPlanetId: string
  targetName: string
  relationType: RelationType
  identityLabel: string
  description: string
  strength: number
  score: {
    algorithmVersion: 'relationship.v4'
    relationshipType: string
    strength: number
    profileAffinity: number | null
    dynamicEvidence: number
    confidence: number
    memoryCount: number
    behaviorEventCount: number
    features: ScoreFeature[]
    profileFeatures: ScoreFeature[]
    computedAt: string
  }
  status: RelationshipStatus
  startedAt: string | null
}

export interface RelationshipDraft {
  targetUserId: string
  relationType: RelationType
  identityLabel: string
  description: string
  status?: RelationshipStatus
  startedAt?: string | null
}

export interface TimelineRecord {
  id: string
  relationshipId: string
  eventTime: string
  eventType: string
  intimacy: number
  interactionFrequency: number
  emotionalTone: string
  description: string
  sourceMemoryId: string | null
}

export interface CosmosPayload {
  profile: UserProfile
  selfPlanet: SocialPlanet | null
  friendPlanets: SocialPlanet[]
  /** Distant database-backed people shown before the first real connection. */
  samplePlanets?: SocialPlanet[]
  relationships: SocialRelationship[]
  memories: ConfirmedMemorySummary[]
  timeline: TimelineRecord[]
  activities: ActivityPost[]
  memorySignals?: MemorySignal[]
  universePagination?: SpatialWindowPagination
}

export interface DiscoverableUser {
  id: string
  displayName: string
  bio: string
  planetId: string | null
  planetName: string
  planetReady?: boolean
  connected?: boolean
  canConnect?: boolean
  profileAffinity?: number | null
  affinityConfidence?: number
  profileFeatures?: ScoreFeature[]
}

export interface PlanetCustomizationRequest {
  prompt: string
  current: PlanetVisualConfig
  profile: Pick<UserProfile, 'displayName' | 'bio' | 'tags'>
}

export interface PlanetCustomizationResult {
  visual: PlanetVisualConfig
  rationale?: string
}

export interface TravelRequest {
  originPlanetId: string
  destinationPlanetId: string
  vehicle: 'comet'
}

export interface PlanetRendererExtension {
  id: string
  label: string
  fragmentShader?: string
  vertexShader?: string
  assetUrl?: string
}
