import type {
  ActivityDraft,
  ActivityMedia,
  ActivityPost,
  AuthSession,
  CosmosPayload,
  DiscoverableUser,
  NebulaDirectoryPayload,
  NebulaSpace,
  NebulaSummary,
  PlanetIdentity,
  PlanetScoreResult,
  PlanetVisualConfig,
  ProfileGraphDocument,
  ProfileIntakePayload,
  RelationshipDraft,
  SocialPlanet,
  SpatialSnapshot,
  UniverseWindowPayload,
  UserProfile,
} from '../contracts'
import type {
  AnalysisJobRecord,
  ConfirmedMemoryDetail,
  ConfirmedMemoryListItem,
  MemoryObject,
  MemoryDraftEnvelope,
  MemoryRevisionRecord,
} from '../../types/memoryObject'
import type {
  AgentConversation,
  AgentFeedback,
  AgentFeedbackRating,
  AgentMessage,
  AgentMessageAccepted,
  AgentRun,
  AgentRunEvent,
  ConversationStatus,
  CursorPage,
} from '../../types/agentConversation'
import type { DirectConversation, DirectMessage, DirectMessageAccepted } from '../../types/directChat'
import { calibrateServerClock } from '../../utils/time'

interface ApiValidationIssue {
  msg?: string
}

interface ApiErrorBody {
  error?: string
  detail?: string | ApiValidationIssue[]
}

export class ApiRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

let activeSessionToken = ''

export function adoptSessionToken(value: string) { activeSessionToken = value }

function token() {
  if (activeSessionToken) return activeSessionToken
  try {
    const persisted = JSON.parse(localStorage.getItem('social-cosmos-product-v1') || '{}')
    return persisted.state?.session?.token || ''
  } catch {
    return ''
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const sessionToken = token()
  const isFormData = init.body instanceof FormData
  const requestStartedAt = Date.now()
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(!isFormData ? { 'content-type': 'application/json' } : {}),
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...init.headers,
    },
  })
  calibrateServerClock(response.headers.get('x-server-time'), requestStartedAt)
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody
  if (!response.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((issue) => issue.msg).filter(Boolean).join(' ')
      : body.detail
    throw new ApiRequestError(body.error || detail || `Request failed with ${response.status}.`, response.status)
  }
  return body
}

async function uploadFileWithRetry(path: string, file: File, signal?: AbortSignal): Promise<ActivityMedia> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const body = new FormData()
    body.append('file', file)
    try {
      return await request<ActivityMedia>(path, { method: 'POST', body, signal })
    } catch (cause) {
      lastError = cause
      if (cause instanceof ApiRequestError && cause.status < 500) throw cause
      if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw lastError
}

function withQuery(path: string, values: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `${path}?${encoded}` : path
}

function parseAgentEvent(block: string): AgentRunEvent | null {
  let id = 0
  let event = ''
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) id = Number(line.slice(3).trim())
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!Number.isInteger(id) || id < 1 || !event || data.length === 0) return null
  const payload = JSON.parse(data.join('\n')) as Record<string, unknown>
  return { id, event: event as AgentRunEvent['event'], data: payload }
}

export interface AuthPayload extends CosmosPayload {
  session: AuthSession
}

export const apiClient = {
  getAuthConfig() {
    return request<{ emailVerificationRequired: boolean; emailDeliveryConfigured: boolean }>('/api/public/auth-config')
  },
  async signUp(credentials: { email: string; password: string; displayName?: string; verificationCode?: string }) {
    const payload = await request<AuthPayload>('/api/auth/signup', { method: 'POST', body: JSON.stringify(credentials) })
    activeSessionToken = payload.session.token
    return payload
  },
  requestSignupVerification(email: string) {
    return request<{
      accepted: boolean
      expiresIn: number
      resendAfter: number
      message: string
    }>('/api/auth/email-verification/send', {
      method: 'POST',
      body: JSON.stringify({ email, purpose: 'signup' }),
    })
  },
  async signIn(credentials: { email: string; password: string; displayName?: string }) {
    const payload = await request<AuthPayload>('/api/auth/signin', { method: 'POST', body: JSON.stringify(credentials) })
    activeSessionToken = payload.session.token
    return payload
  },
  async signOut() {
    try {
      return await request<{ ok: boolean }>('/api/auth/signout', { method: 'POST' })
    } finally {
      activeSessionToken = ''
    }
  },
  getCosmos() {
    return request<CosmosPayload>('/api/cosmos')
  },
  getProfileIntake() {
    return request<ProfileIntakePayload>('/api/v1/users/me/intake')
  },
  saveProfileIntake(body: ProfileIntakePayload) {
    return request<{
      profile: UserProfile
      graph: { graphVersion: string; nodes: unknown[]; edges: unknown[] }
      planetScore: PlanetScoreResult
      snapshot: SpatialSnapshot | null
    }>('/api/v1/users/me/intake', { method: 'PUT', body: JSON.stringify(body) })
  },
  updateProfile(values: Partial<Pick<UserProfile, 'displayName' | 'bio' | 'tags'>>) {
    return request<{ profile: UserProfile }>('/api/profile', { method: 'POST', body: JSON.stringify(values) })
  },
  createPlanet(identity: PlanetIdentity, visual: PlanetVisualConfig) {
    return request<{ planet: SocialPlanet; profile: UserProfile }>('/api/planets', {
      method: 'POST', body: JSON.stringify({ identity, visual }),
    })
  },
  discoverUsers(includeAffinity = false, query = '') {
    return request<{ users: DiscoverableUser[] }>(withQuery('/api/users/discover', {
      includeAffinity: String(includeAffinity),
      q: query.trim(),
    }))
  },
  getUserAffinity(userId: string) {
    return request<Pick<DiscoverableUser, 'profileAffinity' | 'affinityConfidence' | 'profileFeatures'> & { userId: string }>(
      `/api/users/${encodeURIComponent(userId)}/affinity`,
    )
  },
  createRelationship(draft: RelationshipDraft) {
    return request<CosmosPayload>('/api/relationships', { method: 'POST', body: JSON.stringify(draft) })
  },
  analyzeMemory(input: { sourceType: string; rawText: string; imageName?: string; imageUrl?: string }, signal?: AbortSignal) {
    return request<MemoryObject>('/api/memories/analyze', {
      method: 'POST', body: JSON.stringify(input), signal,
    })
  },
  saveMemory(memory: MemoryObject, relationshipId?: string) {
    return request<{ memory: MemoryObject; cosmos: CosmosPayload }>('/api/memories', {
      method: 'POST', body: JSON.stringify({ memory, relationshipId }),
    })
  },
  listMemorySignals() {
    return request<{ signals: import('../contracts').MemorySignal[] }>('/api/v1/memory-signals')
  },
  markMemorySignalRead(signalId: string) {
    return request<{ signal: import('../contracts').MemorySignal }>(
      `/api/v1/memory-signals/${encodeURIComponent(signalId)}/read`,
      { method: 'POST' },
    )
  },
  closeMemorySignal(signalId: string) {
    return request<{ signal: import('../contracts').MemorySignal }>(
      `/api/v1/memory-signals/${encodeURIComponent(signalId)}/close`,
      { method: 'POST' },
    )
  },
  getProfileGraph() {
    return request<ProfileGraphDocument>('/api/v1/users/me/graph')
  },
  getPlanetScore() {
    return request<PlanetScoreResult>('/api/v1/planets/me/score')
  },
  createTextIngestion(rawText: string, relationshipId?: string, signal?: AbortSignal) {
    return request<AnalysisJobRecord>('/api/v1/ingestion/jobs', {
      method: 'POST', body: JSON.stringify({ sourceType: 'text', rawText, relationshipId }), signal,
    })
  },
  analyzeIngestionJob(jobId: string, signal?: AbortSignal) {
    return request<{ job: AnalysisJobRecord; draft: MemoryDraftEnvelope | null }>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/analyze`,
      { method: 'POST', signal },
    )
  },
  confirmMemoryDraft(
    draftId: string,
    expectedVersion: number,
    memory: MemoryObject,
    relationshipId?: string,
  ) {
    return request<{ memory: MemoryObject; revision: MemoryRevisionRecord; cosmos: CosmosPayload }>(
      `/api/v1/memory-drafts/${encodeURIComponent(draftId)}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedVersion, memory, relationshipId, reason: 'user_reviewed_draft' }),
      },
    )
  },
  rejectMemoryDraft(draftId: string, expectedVersion: number) {
    return request<MemoryDraftEnvelope>(
      `/api/v1/memory-drafts/${encodeURIComponent(draftId)}/reject`,
      { method: 'POST', body: JSON.stringify({ expectedVersion }) },
    )
  },
  cancelAnalysisJob(jobId: string, expectedVersion: number) {
    return request<AnalysisJobRecord>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ expectedVersion }) },
    )
  },
  getAnalysisJob(jobId: string) {
    return request<AnalysisJobRecord>(`/api/v1/jobs/${encodeURIComponent(jobId)}`)
  },
  deleteAnalysisJob(jobId: string, expectedVersion: number) {
    return request<{ deleted: boolean; jobId: string; auditId: string }>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion, reason: 'user_deleted_terminal_job' }),
      },
    )
  },
  listIngestionJobs(values: { status?: string; cursor?: string | null; limit?: number } = {}) {
    return request<CursorPage<AnalysisJobRecord>>(withQuery('/api/v1/ingestion/jobs', values))
  },
  getMemoryDraft(draftId: string) {
    return request<MemoryDraftEnvelope>(`/api/v1/memory-drafts/${encodeURIComponent(draftId)}`)
  },
  listMemories(values: {
    cursor?: string | null
    limit?: number
    relationshipId?: string | null
    from?: string | null
    to?: string | null
    query?: string | null
  } = {}) {
    return request<CursorPage<ConfirmedMemoryListItem>>(withQuery('/api/v1/memories', values))
  },
  getMemoryDetail(memoryId: string) {
    return request<ConfirmedMemoryDetail>(`/api/v1/memories/${encodeURIComponent(memoryId)}`)
  },
  getMemoryRevisions(memoryId: string) {
    return request<MemoryRevisionRecord[]>(
      `/api/v1/memories/${encodeURIComponent(memoryId)}/revisions`,
    )
  },
  reviseMemory(
    memoryId: string,
    expectedVersion: number,
    memory: MemoryObject,
    relationshipId: string | null,
  ) {
    return request<{ memory: MemoryObject; revision: MemoryRevisionRecord; cosmos: CosmosPayload }>(
      `/api/v1/memories/${encodeURIComponent(memoryId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion,
          memory,
          relationshipId,
          reason: 'user_edit',
        }),
      },
    )
  },
  deleteMemory(memoryId: string) {
    return request<{ deleted: boolean; memoryId: string; cosmos: CosmosPayload }>(
      `/api/v1/memories/${encodeURIComponent(memoryId)}`,
      { method: 'DELETE' },
    )
  },
  createAgentConversation(body: { title: string; relationshipId?: string | null }) {
    return request<AgentConversation>('/api/v1/agent/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: body.title, mode: 'memory_companion', relationshipId: body.relationshipId }),
    })
  },
  listAgentConversations(values: { cursor?: string | null; limit?: number; status?: ConversationStatus } = {}) {
    return request<CursorPage<AgentConversation>>(withQuery('/api/v1/agent/conversations', values))
  },
  getAgentConversation(conversationId: string) {
    return request<AgentConversation>(`/api/v1/agent/conversations/${encodeURIComponent(conversationId)}`)
  },
  updateAgentConversation(
    conversationId: string,
    body: { title?: string; status?: ConversationStatus },
  ) {
    return request<AgentConversation>(`/api/v1/agent/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },
  deleteAgentConversation(conversationId: string) {
    return request<{ deleted: boolean; conversationId: string }>(
      `/api/v1/agent/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' },
    )
  },
  listAgentMessages(conversationId: string, values: { cursor?: string | null; limit?: number } = {}) {
    return request<CursorPage<AgentMessage>>(withQuery(
      `/api/v1/agent/conversations/${encodeURIComponent(conversationId)}/messages`,
      values,
    ))
  },
  getActiveAgentRun(conversationId: string) {
    return request<AgentRun | null>(
      `/api/v1/agent/conversations/${encodeURIComponent(conversationId)}/active-run`,
    )
  },
  sendAgentMessage(conversationId: string, body: { clientMessageId: string; content: string }) {
    return request<AgentMessageAccepted>(
      `/api/v1/agent/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  },
  getAgentRun(runId: string) {
    return request<AgentRun>(`/api/v1/agent/runs/${encodeURIComponent(runId)}`)
  },
  cancelAgentRun(runId: string) {
    return request<AgentRun>(`/api/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
  },
  saveAgentFeedback(messageId: string, rating: AgentFeedbackRating, comment = '') {
    return request<AgentFeedback>(`/api/v1/agent/messages/${encodeURIComponent(messageId)}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    })
  },
  async *streamAgentRunEvents(
    runId: string,
    options: { lastEventId?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentRunEvent, number> {
    const sessionToken = token()
    const response = await fetch(`/api/v1/agent/runs/${encodeURIComponent(runId)}/events`, {
      headers: {
        accept: 'text/event-stream',
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        ...(options.lastEventId ? { 'last-event-id': String(options.lastEventId) } : {}),
      },
      signal: options.signal,
    })
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({})) as ApiErrorBody
      const detail = Array.isArray(body.detail)
        ? body.detail.map((issue) => issue.msg).filter(Boolean).join(' ')
        : body.detail
      throw new Error(body.error || detail || `Event stream failed with ${response.status}.`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastEventId = options.lastEventId ?? 0
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const event = parseAgentEvent(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event && event.id > lastEventId) {
          lastEventId = event.id
          yield event
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (done) break
    }
    return lastEventId
  },
  uploadActivityMedia(file: File) {
    return uploadFileWithRetry('/api/activity-media', file)
  },
  listDirectConversations(limit = 50) {
    return request<{ items: DirectConversation[]; nextCursor: string | null }>(
      withQuery('/api/v1/chat/conversations', { limit }),
    )
  },
  createDirectConversation(targetUserId: string) {
    return request<DirectConversation>('/api/v1/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    })
  },
  listDirectMessages(conversationId: string, values: { cursor?: string | null; limit?: number } = {}) {
    return request<{ items: DirectMessage[]; nextCursor: string | null }>(withQuery(
      `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`, values,
    ))
  },
  sendDirectMessage(conversationId: string, body: { clientMessageId: string; content: string }) {
    return request<DirectMessageAccepted>(
      `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  },
  markDirectConversationRead(conversationId: string) {
    return request<DirectConversation>(
      `/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST' },
    )
  },
  uploadMemoryMedia(file: File, signal?: AbortSignal) {
    return uploadFileWithRetry('/api/memory-media', file, signal)
  },
  createActivity(draft: ActivityDraft, media: ActivityMedia[] = []) {
    return request<{ activity: ActivityPost; analysis: { status: 'queued' } }>('/api/activities', {
      method: 'POST',
      body: JSON.stringify({ ...draft, media }),
    })
  },
  markActivityBroadcastRead(activityId: string) {
    return request<{ activity: ActivityPost; cosmos: CosmosPayload }>(`/api/activities/${activityId}/broadcast/read`, { method: 'POST' })
  },
  closeActivityBroadcast(activityId: string) {
    return request<{ activity: ActivityPost }>(`/api/activities/${activityId}/broadcast/close`, { method: 'POST' })
  },
  customizePlanet(body: unknown) {
    return request<{ visual: PlanetVisualConfig; rationale?: string; provider?: string }>(
      '/api/ai/planet-customization',
      { method: 'POST', body: JSON.stringify(body) },
    )
  },
  getUniverseSnapshot() {
    return request<SpatialSnapshot>('/api/v1/universe/snapshot')
  },
  getUniverseWindow(offset = 0, limit = 12) {
    return request<UniverseWindowPayload>(withQuery('/api/v1/universe/window', { offset, limit }))
  },
  recordPlanetInteraction(planetId: string, kind: 'view' | 'visit') {
    return request<{
      event: { id: string; eventType: string; targetUserId: string; occurredAt: string }
      cosmos: CosmosPayload
    }>(`/api/planets/${planetId}/interactions`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    })
  },
  getNebulae(query = '', page = 1, pageSize = 6) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (query.trim()) params.set('q', query.trim())
    return request<NebulaDirectoryPayload>(`/api/nebulae?${params.toString()}`)
  },
  createNebula(body: { name: string; description?: string; theme?: Record<string, unknown> }) {
    return request<NebulaSummary>('/api/nebulae', { method: 'POST', body: JSON.stringify(body) })
  },
  joinNebula(nebulaId: string) {
    return request<NebulaSummary>(`/api/nebulae/${nebulaId}/join`, { method: 'POST' })
  },
  joinNebulaByCode(joinCode: string) {
    return request<NebulaSummary>('/api/nebulae/join-by-code', {
      method: 'POST', body: JSON.stringify({ joinCode }),
    })
  },
  getNebulaSpace(nebulaId: string, offset = 0, limit = 24) {
    return request<NebulaSpace>(withQuery(`/api/nebulae/${nebulaId}/space`, { offset, limit }))
  },
}
